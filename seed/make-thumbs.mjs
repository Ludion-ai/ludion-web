// 見本のサムネイルとアバターを作る（SPEC.md 11）：無地の色面に題名を1行。
// 実行：npm run seed:thumbs（リポジトリの根で）。seed/files/ に書く。D1 と R2 に入れるのは npm run seed:dev。
//
// webp への書き出しは、Playwright の Chromium の canvas に任せる。依存を増やさないため。
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filesDir = join(root, 'seed/files');
const require = createRequire(join(root, 'apps/web/package.json'));
const { chromium } = require('@playwright/test');

const MAX_THUMB_BYTES = 80 * 1024;
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.25;

const works = JSON.parse(readFileSync(join(root, 'seed/works.json'), 'utf8'));
const fontPath = require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
const fontUrl = `data:font/woff2;base64,${readFileSync(fontPath).toString('base64')}`;

function isDark(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.evaluate(async (url) => {
  const face = new FontFace('Inter', `url(${url})`, { weight: '100 900' });
  document.fonts.add(await face.load());
}, fontUrl);

for (const work of works) {
  const ratio = work.thumb_h / work.thumb_w;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) throw new Error(`${work.id}: 縦横比 ${ratio} は ${MIN_RATIO}〜${MAX_RATIO} の外`);

  const dataUrl = await page.evaluate(
    ({ w, h, color, ink, title }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.font = '600 52px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, w / 2, h / 2, w - 96);
      return canvas.toDataURL('image/webp', 0.9);
    },
    {
      w: work.thumb_w,
      h: work.thumb_h,
      color: work.seed_color,
      ink: isDark(work.seed_color) ? '#FFFFFF' : '#16161D',
      title: work.title,
    },
  );

  const thumbKey = `works/${work.id}/${work.version}/thumb.webp`;
  const file = join(filesDir, thumbKey);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

  const bytes = statSync(file).size;
  if (bytes > MAX_THUMB_BYTES) throw new Error(`${work.id}: ${bytes} bytes は 80KB を超える`);
  console.log(`${thumbKey}  ${work.thumb_w}x${work.thumb_h}  ${(bytes / 1024).toFixed(1)}KB`);
}

const AVATAR_COLORS = { seed_a: '#7C8CF0', seed_b: '#3FA796', seed_c: '#E08A5B', seed_d: '#16161D' };
const avatarDir = join(filesDir, 'avatars');
mkdirSync(avatarDir, { recursive: true });
for (const [handle, color] of Object.entries(AVATAR_COLORS)) {
  const letter = handle.at(-1).toUpperCase();
  // 管理API のアバターと同じ形（96×96 の webp）
  const dataUrl = await page.evaluate(
    ({ color, letter }) => {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(48, 48, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(letter, 48, 62);
      return canvas.toDataURL('image/webp', 0.9);
    },
    { color, letter },
  );
  writeFileSync(join(avatarDir, `${handle}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`avatars/${handle}.webp`);
}
await browser.close();
