// サイトを表す画像を作る（docs/tasks/T016.md「2.6」）。オーナーの裏方の道具で、作った画像はコミットする。
//   apps/web/public/og-home.png  1200×630。ホームの og:image。本番の承認済みの作品のサムネイルを Popular の順で並べる
//   apps/web/public/logo.png     512×512。構造化データの Organization の logo
//
// node scripts/make-site-images.mjs
//
// 並べるのは本番の /api/works にある作品だけ（CLAUDE.md 原則5）。サムネイルは works/<id>/thumb.webp を読み、本番の閲覧数は増やさない。
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(webDir, '../..');
const publicDir = join(webDir, 'public');

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(path).toString('base64')}`;

const { works } = await (await fetch('https://ludion.ai/api/works', { headers: { 'User-Agent': 'ludion-site-images' } })).json();
const font = dataUrl(join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), 'font/woff2');
const FG = '#111114';
const LOGO = '#E5412A';

// Header.tsx のロゴのマークと同じ形
const mark = (size) => `<svg viewBox="8 8 80 80" width="${size}" height="${size}"><path fill="${FG}" d="M8 8H56V24H24V72H8Z"/><path fill="${LOGO}" d="M88 88H40V72H72V24H88Z"/></svg>`;

const COLUMNS = 3;
const columns = Array.from({ length: COLUMNS }, () => ({ height: 0, cards: [] }));
for (const work of works) {
  const low = columns.reduce((best, column) => (column.height < best.height ? column : best));
  low.cards.push(`<img alt="" src="${dataUrl(join(root, 'works', work.id, 'thumb.webp'), 'image/webp')}" style="aspect-ratio:${work.thumb_w}/${work.thumb_h}">`);
  low.height += work.thumb_h / work.thumb_w;
}

const browser = await chromium.launch();

const og = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await og.setContent(
  `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(${font}) format('woff2');font-weight:100 900}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;overflow:hidden;background:#fff;display:flex}
.side{width:320px;flex:none;padding:48px;display:flex;flex-direction:column;justify-content:flex-end;gap:14px}
.brand{display:flex;align-items:center;gap:14px;font:800 44px/1 Inter,sans-serif;letter-spacing:-.02em;color:${FG}}
.grid{flex:1;display:flex;gap:16px;padding:0 16px 0 0;margin-top:-16px}
.column{flex:1;display:flex;flex-direction:column;gap:16px}
.column:nth-child(even){margin-top:-44px}
img{display:block;width:100%;object-fit:cover;border-radius:16px}
</style><div class="side"><div class="brand">${mark(34)}Ludion</div></div><div class="grid">${columns.map((column) => `<div class="column">${column.cards.join('')}</div>`).join('')}</div>`,
  { waitUntil: 'load' },
);
await og.evaluate(() => document.fonts.ready);
writeFileSync(join(publicDir, 'og-home.png'), await og.screenshot({ type: 'png' }));

const logo = await browser.newPage({ locale: 'ja-JP', viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await logo.setContent(`<!doctype html><style>body{margin:0;width:512px;height:512px;background:#fff;display:flex;align-items:center;justify-content:center}</style>${mark(320)}`);
writeFileSync(join(publicDir, 'logo.png'), await logo.screenshot({ type: 'png' }));

await browser.close();
console.log(`${works.length} 作品で og-home.png と logo.png を作った`);
