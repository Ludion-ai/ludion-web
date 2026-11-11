// ログイン中のヘッダー、メニュー、/saved のスクリーンショットを docs/screens/ に撮る（docs/tasks/T009.md）。
// 偽の GitHub で撮る。手元の .dev.vars に次の4行を書き、scripts/fake-github.mjs を動かしてから npm run dev：
//   GITHUB_CLIENT_ID=fake、GITHUB_CLIENT_SECRET=fake、GITHUB_WEB_URL=http://localhost:4179、GITHUB_API_URL=http://localhost:4179
// npm run shots:accounts（BASE_URL でサーバーを変えられる）
// 正解の画像と並べた比較（compare-account-1440.png）も作る。
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = join(root, 'docs/screens');
const baseUrl = process.env.BASE_URL ?? 'http://localhost:5173';
const fakeGitHub = `http://localhost:${process.env.LD_TEST_GITHUB_PORT ?? 4179}`;
/** 正解の画像の上にあるブラウザの枠の高さ（scripts/shots.mjs と同じ） */
const REFERENCE_CHROME = 46;
const SAVED_WORKS = ['seed-trail-guide', 'seed-portfolio-landing', 'fx-landing', 'fx-toggle', 'fx-habits'];

const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function shot(page, name, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage });
  console.log(`${name}.png  ${new URL(page.url()).pathname}  横のはみ出し ${await overflowOf(page)}px`);
}

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  // 走らせるたびに別の人。しおりが前の回から残らない
  const login = `shots-${width}-${Date.now().toString(36)}`;
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'fake_user', value: login, url: fakeGitHub }]);
  const page = await context.newPage();

  await page.goto(`${baseUrl}/auth/github?next=${encodeURIComponent('/account/saved')}`, { waitUntil: 'networkidle' });
  await page.getByText('まだ何も保存していません').waitFor();
  await shot(page, `saved-empty-${width}`);

  for (const id of SAVED_WORKS) {
    const response = await page.request.post(`${baseUrl}/api/works/${id}/bookmark`, { headers: { Origin: new URL(baseUrl).origin } });
    if (response.status() !== 200) throw new Error(`${id}：${response.status()}`);
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-masonry][data-placed] article').first().waitFor();
  await shot(page, `saved-${width}`, true);

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await page.getByRole('menu').waitFor();
  await shot(page, `account-menu-${width}`);
  await context.close();
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
  <figcaption>docs/screens/account-menu-1440.png</figcaption>
  <div class="frame"><img src="${dataUrl(join(outDir, 'account-menu-1440.png'))}"></div>
</figure>
<figure>
  <figcaption>docs/reference/home.png</figcaption>
  <div class="frame"><img style="margin-top:-${REFERENCE_CHROME}px" src="${dataUrl(join(root, 'docs/reference/home.png'))}"></div>
</figure>`);
await compare.screenshot({ path: join(outDir, 'compare-account-1440.png') });
console.log('compare-account-1440.png');

await browser.close();
