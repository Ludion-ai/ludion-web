// 作品のページと作り手のページのスクリーンショットを docs/screens/ に撮る（docs/tasks/T007.md の終わりの条件）。
// 開発のデータで撮る：npm run seed:dev → npm run dev → npm run shots:pages（BASE_URL でサーバーを変えられる）
// 正解の画像のヘッダーとサイドバーと並べた比較（compare-page-1440.png）も作る。
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'docs/screens');
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';

const PAGES = [
  { name: 'page-component', path: '/p/fx-toggle' },
  { name: 'page-web', path: '/p/fx-landing' },
  { name: 'page-mobile', path: '/p/fx-habits' },
  { name: 'page-label', path: '/p/seed-furniture-store' },
  { name: 'creator', path: '/c/fixture' },
  { name: 'creator-label', path: '/c/seed_d' },
];
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
];
/** 正解の画像の上にあるブラウザの枠の高さ（scripts/shots.mjs と同じ） */
const REFERENCE_CHROME = 46;

const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

for (const { name, path } of PAGES) {
  for (const { width, height } of WIDTHS) {
    const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const response = await page.goto(baseUrl + path, { waitUntil: 'networkidle' });
    if (response.status() !== 200) throw new Error(`${path}：${response.status()}`);
    await page.evaluate(() => document.fonts.ready);
    const file = join(outDir, `${name}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name}-${width}.png  ${path}  横のはみ出し ${overflow}px`);
    await context.close();
  }
}

// Mobile に切り替えた Webの画面
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/p/fx-landing`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'モバイル', exact: true }).click();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(outDir, 'page-web-mobile-1440.png'), fullPage: true });
  console.log('page-web-mobile-1440.png');
  await page.close();
}

function dataUrl(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

const compare = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1440 + 1448 + 24, height: 900 + 32 } });
await compare.setContent(`<!doctype html>
<style>
  body { margin: 0; display: flex; gap: 24px; background: #888; font: 600 16px system-ui; color: #fff; }
  figure { margin: 0; }
  figcaption { height: 32px; line-height: 32px; padding-left: 8px; }
  .frame { height: 900px; overflow: hidden; }
  .frame img { display: block; }
</style>
<figure>
  <figcaption>docs/screens/page-web-1440.png（上の900px）</figcaption>
  <div class="frame"><img src="${dataUrl(join(outDir, 'page-web-1440.png'))}"></div>
</figure>
<figure>
  <figcaption>docs/reference/home.png（ヘッダーとサイドバーを比べる）</figcaption>
  <div class="frame"><img style="margin-top:-${REFERENCE_CHROME}px" src="${dataUrl(join(root, 'docs/reference/home.png'))}"></div>
</figure>`);
await compare.screenshot({ path: join(outDir, 'compare-page-1440.png') });
console.log('compare-page-1440.png');

await browser.close();
