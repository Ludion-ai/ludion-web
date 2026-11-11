// T018 のスクリーンショット：作品のページを上から下まで。幅390、768、1440 を docs/screens/t018-*.png に撮る。
//
// node scripts/shots-t018.mjs                                  本番
// BASE_URL=http://127.0.0.1:4173 LD_WORK=fx-toggle node scripts/shots-t018.mjs  手元（OUT_PREFIX で名前を変えられる）
//
// 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count と GA4 を止める。
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'docs/screens');
const baseUrl = process.env.BASE_URL ?? 'https://ludion.ai';
const work = process.env.LD_WORK ?? 'toggle-daylight';
const prefix = process.env.OUT_PREFIX ?? 't018';

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();

for (const [width, height] of [[390, 844], [768, 1024], [1440, 900]]) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/api/count', (route) => route.abort());
  await context.route(/googletagmanager\.com|google-analytics\.com/, (route) => route.abort());
  const page = await context.newPage();
  const response = await page.goto(`${baseUrl}/p/${work}`, { waitUntil: 'load' });
  if (response.status() !== 200) throw new Error(`/p/${work}：${response.status()}`);
  await page.locator('[data-masonry][data-placed]').first().waitFor({ state: 'attached' });
  await page.evaluate(() => document.fonts.ready);

  // 下の並びは lazy なので、下まで動かして全部読ませる
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-masonry] img')].every((image) => image.complete && image.naturalWidth > 0), null, { timeout: 30000 });
  await page.waitForTimeout(500);

  const name = `${prefix}-${width}.png`;
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(`${name}  ${baseUrl}/p/${work}  横のはみ出し ${overflow}px`);

  // 全体の図では、固定の下のタブが最初の画面の位置に写る。ページの一番下で隠れないことは、こちらで見る
  if (width < 1024) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, `${prefix}-${width}-bottom.png`) });
    console.log(`${prefix}-${width}-bottom.png  ページの一番下`);
  }
  await context.close();
}

await browser.close();
