// サムネイル（thumb.webp）、OG画像（og.png）、アバター（avatar.webp）を作る（docs/tasks/T002.md「3」）。
// webp への書き出しは Chromium の canvas に任せる。依存を増やさないため（seed/make-thumbs.mjs と同じ）。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { Creator, Work } from '@ludion/render';
import { imageSize } from '@ludion/rules';
import { openFramePage, partRect, rootBackground } from './browser.ts';

const require = createRequire(import.meta.url);

export const MAX_THUMB_BYTES = 80 * 1024;
export const THUMB_WIDTH = 800;

/** 画像を描き直すための白紙のページ。 */
async function canvasPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.goto('about:blank');
  return page;
}

interface ComposeSpec {
  /** 元の画像（data URL） */
  src: string;
  /** 出来上がりの大きさ */
  width: number;
  height: number;
  /** スマホの画面：地の上に、角丸と影を付けて置く */
  phone?: { ground: string; frameWidth: number; frameHeight: number; canvasWidth: number; canvasHeight: number };
}

/** canvas で描き直し、80KB 以下に収まる画質で webp にする。 */
async function composeWebp(page: Page, spec: ComposeSpec, maxBytes: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    async ({ spec, maxBytes }) => {
      const img = new Image();
      img.src = spec.src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = spec.width;
      canvas.height = spec.height;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (spec.phone) {
        const ph = spec.phone;
        const scale = spec.width / ph.canvasWidth;
        ctx.scale(scale, scale);
        ctx.fillStyle = ph.ground;
        ctx.fillRect(0, 0, ph.canvasWidth, ph.canvasHeight);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'; // 作者の地を少し暗くする
        ctx.fillRect(0, 0, ph.canvasWidth, ph.canvasHeight);
        const x = (ph.canvasWidth - ph.frameWidth) / 2;
        const y = (ph.canvasHeight - ph.frameHeight) / 2;
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
        ctx.shadowBlur = 48;
        ctx.shadowOffsetY = 16;
        ctx.beginPath();
        ctx.roundRect(x, y, ph.frameWidth, ph.frameHeight, 24);
        ctx.fillStyle = ph.ground;
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, ph.frameWidth, ph.frameHeight, 24);
        ctx.clip();
        ctx.drawImage(img, x, y, ph.frameWidth, ph.frameHeight);
        ctx.restore();
      } else {
        ctx.drawImage(img, 0, 0, spec.width, spec.height);
      }
      let last = '';
      for (let quality = 0.92; quality >= 0.3; quality -= 0.06) {
        last = canvas.toDataURL('image/webp', quality);
        if (((last.length - last.indexOf(',') - 1) * 3) / 4 <= maxBytes) return last;
      }
      return last;
    },
    { spec, maxBytes },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

function pngDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** 部品のサムネイルで、部品が占める大きさの目安（docs/tasks/T003.md「4」）。 */
export const COMPONENT_FILL = { width: 0.6, maxHeight: 0.7 } as const;
export const COMPONENT_SCALE = { min: 1, max: 3 } as const;
/**
 * 幅いっぱいの部品：外接矩形が枠の幅のこの割合を超えたら、幅1280で描いて枠の上に寄せ、800×480 に縮める（docs/tasks/T005.md「0」）。
 * 高さ÷幅は 0.6。SPEC.md「3」のサムネイルの縦横比の下限の中に収まる。
 */
export const WIDE_COMPONENT = { ratio: 0.9, width: 1280, height: 768, thumbHeight: 480 } as const;

export interface ComponentFit {
  /** 幅いっぱいの部品。幅1280で描いて枠の上に寄せ、800×480 に縮めた */
  wide: boolean;
  /** 800 ÷ 枠の幅。ふつうの部品では deviceScaleFactor（1〜3）、幅いっぱいの部品では縮める割合（0.625） */
  scale: number;
  /** 枠の大きさ（CSS px）。撮ると scale 倍で 800×600（幅いっぱいの部品は 800×480）になる */
  viewport: { width: number; height: number };
  /** 撮った画像の中で、部品の外接矩形が占める割合 */
  fill: { width: number; height: number };
  /** 撮った画像の高さに対する、部品の上端の位置（0 なら枠の上に寄っている） */
  top: number;
}

/**
 * 部品の倍率を決める。外接矩形の幅が 800px の 60%（高さは 600px の 70% まで）になる倍率を、1〜3倍の中で選ぶ。
 * 枠の幅を 4 の倍数にして、800 ÷ 幅 を倍率にする（撮った画像がちょうど 800×600 になり、引き伸ばさずに済む）。
 * 部品の幅が枠の幅で変わることがあるので、測り直して落ち着くまで繰り返す。
 * 幅800の枠で、外接矩形が枠の幅の 90% を超えたら、幅いっぱいの部品として幅1280で描き、枠の上に寄せる（倍率を探さない）。
 */
export async function fitComponent(browser: Browser, work: Work): Promise<Omit<ComponentFit, 'fill' | 'top'>> {
  const probe = await openFramePage(browser);
  try {
    let width = THUMB_WIDTH;
    for (let i = 0; i < 5; i += 1) {
      await probe.show(work, 'author', width, (width * 3) / 4);
      const rect = await partRect(probe.page);
      if (i === 0 && rect.width > THUMB_WIDTH * WIDE_COMPONENT.ratio) {
        return { wide: true, scale: THUMB_WIDTH / WIDE_COMPONENT.width, viewport: { width: WIDE_COMPONENT.width, height: WIDE_COMPONENT.height } };
      }
      const wanted =
        rect.width > 0 && rect.height > 0
          ? Math.min((THUMB_WIDTH * COMPONENT_FILL.width) / rect.width, (600 * COMPONENT_FILL.maxHeight) / rect.height)
          : COMPONENT_SCALE.min;
      const scale = Math.min(COMPONENT_SCALE.max, Math.max(COMPONENT_SCALE.min, wanted));
      // 4 の倍数で、倍率が 1〜3 に収まる幅（268〜800）
      const next = Math.min(THUMB_WIDTH, Math.max(4 * Math.ceil(THUMB_WIDTH / COMPONENT_SCALE.max / 4), 4 * Math.round(THUMB_WIDTH / scale / 4)));
      if (next === width) break;
      width = next;
    }
    return { wide: false, scale: THUMB_WIDTH / width, viewport: { width, height: (width * 3) / 4 } };
  } finally {
    await probe.close();
  }
}

/**
 * サムネイル。作者の配色で、作品の背景（作者の --ld-bg）の上に描く。
 * - 部品：外接矩形の幅が 800px の 60%（高さは 70% まで）になる倍率（1〜3倍）を deviceScaleFactor にして、800×600 で撮る
 *   幅いっぱいの部品（幅800の枠で外接矩形が 90% を超える）は、幅1280で描いて枠の上に寄せ、1280×768 を撮って 800×480
 * - Webの画面：幅1280で描き、上から 1280×960 を撮り、800×600
 * - スマホの画面：390×844 で描き、1000×1250 の地の中央に角丸24pxと影を付けて置き、800×1000
 */
export async function makeThumb(
  browser: Browser,
  work: Work,
): Promise<{ webp: Buffer; width: number; height: number; fit?: ComponentFit }> {
  if (work.meta.type === 'component') return makeComponentThumb(browser, work);
  const isPhone = work.meta.type === 'screen' && work.meta.platform === 'mobile';
  const frame = await openFramePage(browser, { deviceScaleFactor: isPhone ? 2 : 1 });
  const canvas = await canvasPage(browser);
  try {
    if (isPhone) {
      await frame.show(work, 'author', 390, 844);
      const ground = await rootBackground(frame.page);
      const shot = await frame.page.screenshot({ type: 'png' });
      const webp = await composeWebp(
        canvas,
        {
          src: pngDataUrl(shot),
          width: 800,
          height: 1000,
          phone: { ground, frameWidth: 390, frameHeight: 844, canvasWidth: 1000, canvasHeight: 1250 },
        },
        MAX_THUMB_BYTES,
      );
      return { webp, width: 800, height: 1000 };
    }
    const [w, h] = [1280, 960];
    await frame.show(work, 'author', w, h);
    const shot = await frame.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: w, height: h } });
    const webp = await composeWebp(canvas, { src: pngDataUrl(shot), width: 800, height: 600 }, MAX_THUMB_BYTES);
    return { webp, width: 800, height: 600 };
  } finally {
    await canvas.close();
    await frame.close();
  }
}

async function makeComponentThumb(browser: Browser, work: Work): Promise<{ webp: Buffer; width: number; height: number; fit: ComponentFit }> {
  const { wide, scale, viewport } = await fitComponent(browser, work);
  const frame = await openFramePage(browser, { deviceScaleFactor: wide ? 1 : scale });
  const canvas = await canvasPage(browser);
  try {
    await frame.show(work, 'author', viewport.width, viewport.height, { placement: wide ? 'top' : 'center' });
    const rect = await partRect(frame.page);
    const shot = await frame.page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: viewport.width, height: viewport.height } });
    const size = imageSize(shot);
    // ふつうの部品は倍率を掛けて 800×600 ちょうどで撮る。幅いっぱいの部品は 1280×768 で撮って縮める
    const expected = wide ? viewport : { width: THUMB_WIDTH, height: 600 };
    if (!size || size.width !== expected.width || size.height !== expected.height) {
      throw new Error(`部品のサムネイルが ${expected.width}×${expected.height} で撮れなかった（${size?.width}×${size?.height}、倍率 ${scale}）`);
    }
    const height = wide ? WIDE_COMPONENT.thumbHeight : 600;
    const webp = await composeWebp(canvas, { src: pngDataUrl(shot), width: THUMB_WIDTH, height }, MAX_THUMB_BYTES);
    const fill = { width: (rect.width * scale) / THUMB_WIDTH, height: (rect.height * scale) / height };
    return { webp, width: THUMB_WIDTH, height, fit: { wide, scale, viewport, fill, top: (rect.y * scale) / height } };
  } finally {
    await canvas.close();
    await frame.close();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let interUrl: string | null = null;
function interDataUrl(): string {
  interUrl ??= `data:font/woff2;base64,${readFileSync(require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64')}`;
  return interUrl;
}

/** OG画像の題の大きさ（px）。2行に収まるまで、大きいほうから順に試す。 */
export const OG_TITLE_SIZE = { max: 48, min: 24, step: 2 } as const;

export interface OgTitle {
  fontSize: number;
  /** 折り返した後の行 */
  lines: string[];
}

/**
 * OG画像：1200×630。左にサムネイル、右に題名、@handle、ludion.ai。
 * 書体と色はサイトと同じ（SPEC.md「2」）。
 * 題は日本語の行頭禁則と文節で折り返す（line-break: strict、word-break: auto-phrase。auto-phrase は lang="ja" のときだけ効く）。
 * 2行に収まらないか、1つの文節が幅に入らなければ縮める。一番小さくしても入らないときだけ、文節の途中で切って2行で止める。
 */
export async function makeOg(browser: Browser, work: Work, creator: Creator, thumb: Buffer): Promise<Buffer> {
  return (await renderOg(browser, work, creator, thumb)).png;
}

export async function renderOg(browser: Browser, work: Work, creator: Creator, thumb: Buffer): Promise<{ png: Buffer; title: OgTitle }> {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  try {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@font-face{font-family:'Inter Variable';src:url(${interDataUrl()}) format('woff2');font-weight:100 900}
*{box-sizing:border-box}
html,body{margin:0;width:1200px;height:630px;background:#FFFFFF;color:#111114;font-family:'Inter Variable',"Noto Sans JP",system-ui,sans-serif}
main{display:flex;gap:56px;align-items:center;height:630px;padding:56px}
.thumb{flex:none;height:518px;max-width:690px;border:1px solid #ECECF0;border-radius:14px;box-shadow:0 8px 24px rgb(16 16 24 / .08);overflow:hidden;background:#F4F4F6}
.thumb img{display:block;height:100%;width:auto;max-width:690px;object-fit:cover;object-position:top}
.text{flex:1;min-width:0;height:518px;display:flex;flex-direction:column}
h1{margin:0;font-weight:700;letter-spacing:-0.02em;word-break:auto-phrase;line-break:strict;overflow-wrap:normal}
h1.forced{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.handle{margin-top:20px;font-size:24px;line-height:32px;font-weight:500;letter-spacing:-0.01em;color:#6B6B76}
.site{margin-top:auto;font-size:28px;line-height:32px;font-weight:800;letter-spacing:-0.02em}
</style></head><body><main>
<div class="thumb"><img alt="" src="data:image/webp;base64,${thumb.toString('base64')}"></div>
<div class="text"><h1 lang="ja">${escapeHtml(work.meta.title)}</h1><div class="handle">@${escapeHtml(creator.handle)}</div><div class="site">ludion.ai</div></div>
</main></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const title = await page.evaluate(({ max, min, step }) => {
      const h1 = document.querySelector('h1')!;
      const text = h1.firstChild!;
      /** 1文字ずつ位置を見て、行に分ける。 */
      const measure = () => {
        const rows = new Map<number, string>();
        const range = document.createRange();
        const chars = [...(text.textContent ?? '')];
        let offset = 0;
        for (const char of chars) {
          range.setStart(text, offset);
          range.setEnd(text, offset + char.length);
          offset += char.length;
          const rect = range.getClientRects()[0];
          if (!rect || rect.width === 0) continue; // 行末の空白
          const top = Math.round(rect.top + rect.height / 2);
          const row = [...rows.keys()].find((key) => Math.abs(key - top) < rect.height / 2) ?? top;
          rows.set(row, (rows.get(row) ?? '') + char);
        }
        return [...rows.values()].map((line) => line.trim());
      };
      const setSize = (size: number) => {
        h1.style.fontSize = `${size}px`;
        h1.style.lineHeight = `${Math.round((size * 7) / 6)}px`;
      };
      for (let size = max; size >= min; size -= step) {
        setSize(size);
        const lines = measure();
        if (lines.length <= 2 && h1.scrollWidth <= h1.clientWidth) return { fontSize: size, lines };
      }
      setSize(min);
      h1.classList.add('forced');
      return { fontSize: min, lines: measure().slice(0, 2) };
    }, OG_TITLE_SIZE);
    return { png: await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } }), title };
  } finally {
    await page.close();
  }
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
};

/** アバター：中央を正方形に切り抜き、96×96 の webp にする。 */
export async function makeAvatar(browser: Browser, file: string): Promise<Buffer> {
  const type = IMAGE_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`アバターの画像は ${Object.keys(IMAGE_TYPES).join('、')} のどれか（${file}）`);
  const src = `data:${type};base64,${readFileSync(file).toString('base64')}`;
  const page = await canvasPage(browser);
  try {
    const dataUrl = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const w = img.naturalWidth || 96;
      const h = img.naturalHeight || 96;
      const side = Math.min(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, 96, 96);
      return canvas.toDataURL('image/webp', 0.9);
    }, src);
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    await page.close();
  }
}

/**
 * 画像のない運営のレーベルのアバター：site-primary（#16161D）の地に、名前の頭文字を白の太字で置く。96×96 の webp。
 * 書体はサイトと同じ Inter。
 */
export async function makeMonogramAvatar(browser: Browser, name: string): Promise<Buffer> {
  const letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  const page = await browser.newPage({ viewport: { width: 96, height: 96 }, deviceScaleFactor: 1 });
  try {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Inter Variable';src:url(${interDataUrl()}) format('woff2');font-weight:100 900}
html,body{margin:0;width:96px;height:96px;background:#16161D}
div{width:96px;height:96px;display:grid;place-items:center;color:#FFFFFF;font:800 44px/1 'Inter Variable',"Noto Sans JP",system-ui,sans-serif;letter-spacing:-0.02em}
</style></head><body><div>${escapeHtml(letter)}</div></body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 96, height: 96 } });
    const dataUrl = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      return canvas.toDataURL('image/webp', 0.9);
    }, pngDataUrl(png));
    return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  } finally {
    await page.close();
  }
}

/** webp と png の縦横（ld list の表示と、テストのため）。Worker と同じ読み方（@ludion/rules）。 */
export { imageSize };
