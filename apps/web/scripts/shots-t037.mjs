// T037：アカウントのページの「AI の鍵」を 1440 と 390 で撮る（手元の開発サーバーと偽の GitHub）。
import { chromium } from '@playwright/test';
import { join } from 'node:path';

const base = 'http://localhost:5191';
const fake = 'http://localhost:4199';
const out = process.argv[2];
const browser = await chromium.launch();
for (const { width, height } of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'fake_user', value: `shots${width}${Date.now().toString(36)}`, url: fake }]);
  const page = await context.newPage();
  await page.goto(`${base}/auth/github?next=${encodeURIComponent('/account')}`);
  await page.waitForURL(`${base}/account`);
  const section = page.locator('section', { has: page.getByRole('heading', { name: 'AI の鍵' }) }).last();
  await section.getByLabel('鍵の名前').fill('仕事のパソコンの Claude Code');
  for (const box of await section.getByRole('checkbox').all()) await box.check();
  await section.getByRole('button', { name: '鍵を作る' }).click();
  await section.locator('[data-ai-key]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await section.scrollIntoViewIfNeeded();
  await section.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const path = join(out, `t037-account-ai-keys-${width}.png`);
  await page.screenshot({ path });
  console.log(path, 'overflow', overflow);
  await context.close();
}
await browser.close();
