// スクリーンショットを docs/screens/ に撮り、目指す形の画像と並べた比較も作る。
// 開発サーバーを立ててから実行する：npm run dev → npm run shots
// 本番と同じ HTML で撮るなら：npm run build → npm run preview → BASE_URL=http://localhost:4173 npm run shots
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'docs/screens');
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';

const SHOTS = [
  { name: 'home-1440', width: 1440, height: 900 },
  { name: 'home-768', width: 768, height: 1024 },
  { name: 'home-390', width: 390, height: 844 },
];

const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

for (const { name, width, height } of SHOTS) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(`${name}.png  ${width}x${height}  横のはみ出し ${overflow}px`);
  await context.close();
}

// カーソルを乗せたカードと、キーボードでカードの保存までフォーカスしたところ
{
  const page = await browser.newPage({ locale: 'ja-JP', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('article').nth(1).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'home-hover-1440.png') });
  console.log('home-hover-1440.png  カードにカーソル');

  await page.mouse.move(0, 0);
  await page.locator('article').first().locator('> a').focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'focus-1440.png') });
  console.log('focus-1440.png  カードの保存にフォーカス');
  await page.close();
}

function dataUrl(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

// 幅390のホームと、目指す形（docs/reference/pinterest-mobile.png。中の絵は他人の作品なので、形だけを見る）を並べる
const compare = await browser.newPage({ locale: 'ja-JP', viewport: { width: 390 * 2 + 24, height: 844 + 32 } });
await compare.setContent(`<!doctype html>
<style>
  body { margin: 0; display: flex; gap: 24px; background: #888; font: 600 13px system-ui; color: #fff; }
  figure { margin: 0; width: 390px; }
  figcaption { height: 32px; line-height: 32px; padding-left: 8px; }
  .frame { height: 844px; overflow: hidden; }
  .frame img { display: block; width: 390px; }
</style>
<figure>
  <figcaption>docs/screens/home-390.png（390×844）</figcaption>
  <div class="frame"><img src="${dataUrl(join(outDir, 'home-390.png'))}"></div>
</figure>
<figure>
  <figcaption>docs/reference/pinterest-mobile.png（形だけ）</figcaption>
  <div class="frame"><img src="${dataUrl(join(root, 'docs/reference/pinterest-mobile.png'))}"></div>
</figure>`);
await compare.waitForLoadState('networkidle');
await compare.screenshot({ path: join(outDir, 'compare-pinterest-390.png') });
console.log('compare-pinterest-390.png');

await browser.close();
