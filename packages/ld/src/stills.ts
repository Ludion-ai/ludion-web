// 壁紙の静止画（WALL002）。アプリを入れない人が、OS の標準の機能で壁紙にする PNG を作る。
//
// 置く人（オーナー）のブラウザで、作品の枠を指定の大きさで開き、決めた時刻の絵を写す。サーバーでは作品を描画しない。
// 考え方はサムネイル（images.ts）と同じ。枠は全画面の住所（/p/<id>/wall）と同じ形（placement 'fill'、いつも動かす）。
// - 時刻：ページの時計（Date、タイマー、requestAnimationFrame）を Playwright の時計に替え、決めた時刻から決めた時間だけ進めて写す。
//   作品のコードには何も足さない。
// - GPU：WebGL の作品は、CPU だけの描画（SwiftShader）だと、作品が自分で細かさを落とすことがある。
//   本物の GPU で描けるブラウザを先に試し、だめなら今までのブラウザで作って、そのことを知らせる。

import { chromium, type Browser } from 'playwright';
import { FRAME_SANDBOX, buildFrameHtml, type Work } from '@ludion/render';
import { MAX_STILL_BYTES, STILL_SIZES, WALLPAPER_SUBTYPE, imageSize, stillFileName, type StillSize } from '@ludion/rules';
import { FONT_HOSTS, FRAME_URL } from './browser.ts';

/** 時刻を決めないときの時刻（その場所の時計で）。 */
export const STILL_DEFAULT_TIME = '21:00';
/** 読み込みから写すまでの時間（ミリ秒）。雨や動きが落ち着くまで。meta.json の capture.delay_ms が長ければ、そちらを使う。 */
export const STILL_RUN_MS = 8000;

export const isWallpaperWork = (work: Work) => work.meta.subtype === WALLPAPER_SUBTYPE;

export interface StillsBrowser {
  browser: Browser;
  /** WebGL の描き手の名前。CPU だけなら software が true */
  renderer: string;
  software: boolean;
  close(): Promise<void>;
}

const SOFTWARE_GL = /swiftshader|llvmpipe|software|basic render/i;

/** 本物の GPU で描けるブラウザを開く。GPU が使えなければ、ふつうのブラウザで開く。 */
export async function launchForStills(): Promise<StillsBrowser> {
  const gpuArgs = ['--enable-gpu', '--ignore-gpu-blocklist', ...(process.platform === 'win32' ? ['--use-angle=d3d11'] : [])];
  let browser: Browser;
  try {
    browser = await chromium.launch({ args: gpuArgs });
  } catch {
    browser = await chromium.launch();
  }
  const page = await browser.newPage();
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'なし';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
  await page.close();
  return { browser, renderer, software: renderer === 'なし' || SOFTWARE_GL.test(renderer), close: () => browser.close() };
}

/** "21:00" を、作品の公開の日のその時刻（その場所の時計）にする。 */
export function stillTime(work: Work, time = STILL_DEFAULT_TIME): Date {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) throw new Error(`時刻 "${time}" は HH:MM で書く（例：21:00）`);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(work.meta.published_at ?? '') ? work.meta.published_at : '2026-01-01';
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, Number(m[1]), Number(m[2]), 0, 0);
}

export interface Still {
  size: StillSize;
  name: string;
  png: Buffer;
}

/**
 * 1つの大きさの静止画。枠をその大きさで開き、時計を止めたまま読み込み、決めた時間だけ進めて写す。
 * 作品から外への通信は止める（書体を除く）。作品が投げたら止める。
 */
async function shootStill(browser: Browser, work: Work, size: StillSize, at: Date, runMs: number): Promise<Buffer> {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const html = buildFrameHtml(work, { palette: 'author', placement: 'fill', motion: true });
  try {
    await page.clock.install({ time: at });
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === FRAME_URL) {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}` }, body: html });
      }
      let host = '';
      try {
        host = new URL(url).hostname;
      } catch {
        // 読めない URL は止める
      }
      if (FONT_HOSTS.includes(host)) return route.continue().catch(() => undefined);
      return route.abort();
    });
    await page.goto(FRAME_URL, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.clock.runFor(runMs);
    // 止めた時計の最後のコマが画面に出るまで、本物の時間で少し待つ（時計は進めない）
    await page.waitForTimeout(300);
    if (errors.length > 0) throw new Error(`作品が投げた：${errors[0]}`);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size.width, height: size.height } });
    const got = imageSize(png);
    if (!got || got.width !== size.width || got.height !== size.height) {
      throw new Error(`静止画が ${size.width}×${size.height} で撮れなかった（${got?.width}×${got?.height}）`);
    }
    if (png.length > MAX_STILL_BYTES) {
      throw new Error(`${size.width}×${size.height} の静止画が ${(png.length / 1024 / 1024).toFixed(1)}MB で、上限 ${MAX_STILL_BYTES / 1024 / 1024}MB を超える`);
    }
    return png;
  } finally {
    await context.close();
  }
}

/** 壁紙の静止画を、3つの大きさで作る（大きい順）。 */
export async function makeStills(browser: Browser, work: Work, options: { time?: string } = {}): Promise<Still[]> {
  const at = stillTime(work, options.time);
  const delay = work.meta.capture?.delay_ms;
  const runMs = Math.max(STILL_RUN_MS, typeof delay === 'number' ? delay : 0);
  const stills: Still[] = [];
  for (const size of STILL_SIZES) stills.push({ size, name: stillFileName(size), png: await shootStill(browser, work, size, at, runMs) });
  return stills;
}
