// 雨の窓ぎわの起動を速くした直し（COLD001）で、最初のコマが前と同じか。
// 前：90 コマを毎回描き、9つのシェーダーを全部先に組み立てる。
// 後（今の作品）：89 コマは状態だけ進めて最後の1コマだけ描き、割れてから使う4つのシェーダーは最初のコマの後に組み立てる。
// 「前」は、今の作品の起動の2か所を前の書き方に戻して作る（描く所は同じコードなので、前の版と同じ絵になる）。
import { expect, test, type Browser } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FRAME_SANDBOX, buildFrameHtml, type Work } from '@ludion/render';
import { launch } from '../src/browser.ts';
import { REPO } from './helpers.ts';

const DIR = join(REPO, 'works/wallpaper-rain-window');
const read = (name: string) => readFileSync(join(DIR, name), 'utf8');

const FAST_WARM = '    for (let i = 0; i < 89; i++) scene.tick(1 / TUNE.city.hz, false, false);\n    sendScene(scene.tick(1 / TUNE.city.hz, false));\n';
const SLOW_WARM = '    let frame = null;\n    for (let i = 0; i < 90; i++) frame = scene.tick(1 / TUNE.city.hz, false);\n    sendScene(frame);\n';
const FIRST_ONLY = '      for (const [name, asked] of first) prog[name] = takeProgram(asked);\n';
const ALL_FIRST = `${FIRST_ONLY}      for (const [name, [vertex, fragment]] of Object.entries(LATER)) prog[name] = takeProgram(sendProgram(vertex, fragment));\n`;

function replaceOnce(text: string, from: string, to: string): string {
  expect(text.split(from).length - 1, `part.js に1か所だけある：${from.trim().slice(0, 60)}`).toBe(1);
  return text.replace(from, () => to);
}

/** 今の part.js の起動を、前の書き方（90 コマを毎回描く、シェーダーを全部先に組み立てる）に戻す。 */
function slowStart(js: string): string {
  return replaceOnce(replaceOnce(js, FAST_WARM, SLOW_WARM), FIRST_ONLY, ALL_FIRST);
}

type Scene = {
  setInks(table: number[][]): void;
  build(cw: number, ch: number, seed: number, aspect: number): void;
  tick(dt: number, calm: boolean, draw?: boolean): { city: Uint8Array; room: Uint8Array };
};

test('街と店内の絵：89 コマを状態だけ進めて描いた1コマは、90 コマ毎回描いたときと画素で同じ。その後のコマも同じ', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rain-window-'));
  const RealDate = Date;
  // 置き時計の針が、2つの流れの間で1秒進まないように、時刻を止める
  const fixed = new RealDate(2026, 10, 11, 21, 0, 7).getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args: []) {
      super(...((args.length ? args : [fixed]) as []));
    }
    static now() {
      return fixed;
    }
  } as DateConstructor;
  try {
    const file = join(dir, 'part.mjs');
    writeFileSync(file, `${read('part.js')}\nexport { createScene, INKS };\n`);
    const mod = (await import(pathToFileURL(file).href)) as { createScene(): Scene; INKS: number };
    const table = Array.from({ length: mod.INKS }, (_, i) => [((i * 37) % 97) / 97, ((i * 53) % 89) / 89, ((i * 71) % 83) / 83]);
    const step = 1 / 12;
    let compared = 0;
    for (const [cw, ch, aspect] of [[720, 450, 1.6], [583, 365, 1.6], [195, 422, 390 / 844], [400, 300, 4 / 3]]) {
      for (const seed of [1, 4242, 987654]) {
        const run = (fast: boolean) => {
          const scene = mod.createScene();
          scene.setInks(table);
          scene.build(cw, ch, seed, aspect);
          for (let i = 0; i < 89; i++) scene.tick(step, false, !fast);
          const first = scene.tick(step, false);
          const out = [Buffer.from(first.city), Buffer.from(first.room)];
          for (let i = 0; i < 24; i++) {
            const next = scene.tick(step, false);
            out.push(Buffer.from(next.city), Buffer.from(next.room));
          }
          return out;
        };
        const slow = run(false);
        const fast = run(true);
        expect(fast[0].equals(slow[0]), `${cw}×${ch} 種 ${seed}：最初のコマの街`).toBe(true);
        expect(fast[1].equals(slow[1]), `${cw}×${ch} 種 ${seed}：最初のコマの店内`).toBe(true);
        expect(Buffer.concat(fast.slice(2)).equals(Buffer.concat(slow.slice(2))), `${cw}×${ch} 種 ${seed}：その後の 24 コマ`).toBe(true);
        compared += 1;
      }
    }
    expect(compared).toBe(12);
  } finally {
    globalThis.Date = RealDate;
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 作品の枠を開き、時計を止めて、mount の中で描いた最初のコマを撮る。 */
async function firstFrame(browser: Browser, js: string, width: number, height: number): Promise<{ png: Buffer; errors: string[] }> {
  const meta = JSON.parse(read('meta.json')) as Work['meta'];
  const html = buildFrameHtml({ meta, html: read('part.html'), css: read('part.css'), js }, { palette: 'author', placement: 'fill', motion: true });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // 時刻と乱数を、前と後で同じにする。時計を止めるので、rAF も止まり、最初のコマのまま残る
  await page.clock.install({ time: new Date('2026-11-11T21:00:00') });
  await page.clock.pauseAt(new Date('2026-11-11T21:00:01'));
  await page.addInitScript(() => {
    let s = 12345;
    Math.random = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  });
  await page.route('**/*', (route) =>
    route.request().url() === 'http://ld-frame.localhost/'
      ? route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}` }, body: html })
      : route.abort(),
  );
  await page.goto('http://ld-frame.localhost/');
  await page.waitForFunction(() => document.getElementById('ld-host')?.getAttribute('data-ld-mount') === 'ok');
  const state = await page.evaluate(() => {
    const root = document.getElementById('ld-host')?.shadowRoot?.querySelector('[data-ld-part]');
    return { gl: root?.getAttribute('data-gl') ?? null, ready: !!root?.hasAttribute('data-ready') };
  });
  expect(state, 'WebGL で描けて、最初のコマを出した').toEqual({ gl: null, ready: true });
  // フェード（CSS の動き。止めた時計とは別に進む）が終わるのを待つ
  await page.waitForTimeout(800);
  const png = await page.screenshot();
  await context.close();
  return { png, errors };
}

test('最初のコマ：起動を速くした後と前で、画素で同じ（1280×800、390×844）', async () => {
  test.setTimeout(180_000);
  const browser = await launch();
  try {
    const now = read('part.js');
    const before = slowStart(now);
    for (const [width, height] of [[1280, 800], [390, 844]]) {
      const a = await firstFrame(browser, before, width, height);
      const b = await firstFrame(browser, now, width, height);
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
      // PNG を、ブラウザーの中で画素に戻して比べる
      const page = await browser.newPage();
      const diff = await page.evaluate(
        async ([x, y]) => {
          const pixels = async (b64: string) => {
            const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
            ctx.drawImage(bitmap, 0, 0);
            return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
          };
          const [p, q] = await Promise.all([pixels(x), pixels(y)]);
          let over = 0;
          let max = 0;
          for (let i = 0; i < p.length; i++) {
            const d = Math.abs(p[i] - q[i]);
            if (d > max) max = d;
            if (d > 2) over += 1;
          }
          return { length: p.length, sameSize: p.length === q.length, over, max };
        },
        [a.png.toString('base64'), b.png.toString('base64')] as const,
      );
      await page.close();
      expect(diff.sameSize).toBe(true);
      expect(diff.length).toBe(width * height * 4);
      // 同じ絵：2 を超えて違う値が1つもない（GPU の丸めの 1 だけは許す）
      expect(diff, `${width}×${height}`).toMatchObject({ over: 0 });
      expect(diff.max).toBeLessThanOrEqual(2);
    }
  } finally {
    await browser.close();
  }
});

test('割れてから使うシェーダー：最初のコマの直後に叩いても、少し後に叩いても、ひびと破片が描け、エラーがない', async () => {
  test.setTimeout(120_000);
  const browser = await launch();
  try {
    const meta = JSON.parse(read('meta.json')) as Work['meta'];
    const html = buildFrameHtml({ meta, html: read('part.html'), css: read('part.css'), js: read('part.js') }, { palette: 'author', placement: 'fill', motion: true });
    for (const wait of [0, 1000]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.text().includes('wallpaper-rain-window')) errors.push(message.text());
      });
      await page.route('**/*', (route) =>
        route.request().url() === 'http://ld-frame.localhost/'
          ? route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'Content-Security-Policy': `sandbox ${FRAME_SANDBOX}` }, body: html })
          : route.abort(),
      );
      await page.goto('http://ld-frame.localhost/', { waitUntil: 'commit' });
      await page.waitForFunction(() => document.getElementById('ld-host')?.getAttribute('data-ld-mount') === 'ok', null, { polling: 1 });
      if (wait) await page.waitForTimeout(wait);
      for (let i = 0; i < 4; i++) {
        await page.mouse.click(520 + i * 6, 360 + i * 4);
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(1200);
      const gl = await page.evaluate(() => document.getElementById('ld-host')?.shadowRoot?.querySelector('[data-ld-part]')?.getAttribute('data-gl') ?? null);
      expect(gl, `${wait}ms 後に叩いた`).toBeNull();
      expect(errors, `${wait}ms 後に叩いた`).toEqual([]);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
