// T020 のスクリーンショット（docs/screens/t020-*.png）。ふつうのテストでは撮らない。
// LD_SHOTS=1 npx playwright test --project=passkey e2e/shots-t020.spec.ts

import { expect, test, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const SCREENS = join(import.meta.dirname, '../../../docs/screens');
const FAKE_GOOGLE = `http://localhost:${process.env.LD_TEST_GOOGLE_PORT}`;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;

test.skip(!process.env.LD_SHOTS, 'LD_SHOTS=1 のときだけ撮る');

const shot = (page: Page, name: string, width: number, fullPage = true) => page.screenshot({ path: join(SCREENS, `t020-${name}-${width}.png`), fullPage });

async function addAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

for (const [width, height] of [
  [390, 844],
  [1440, 900],
]) {
  test(`幅${width}`, async ({ page, context }) => {
    await page.setViewportSize({ width, height });
    await addAuthenticator(page);
    const login = `lumen${randomBytes(3).toString('hex')}`;
    await context.addCookies([
      { name: 'fake_user', value: login, url: FAKE_GITHUB },
      { name: 'fake_google', value: login, url: FAKE_GOOGLE },
    ]);

    await page.goto('/login');
    await page.getByRole('button', { name: '回復のコードで入る' }).click();
    await page.evaluate(() => document.fonts.ready);
    await shot(page, 'login', width);

    await page.getByRole('link', { name: 'Google でログイン' }).click();
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await shot(page, 'signup-google', width);
    await page.getByRole('button', { name: 'はじめる' }).click();
    await expect(page.getByRole('button', { name: 'アカウントのメニュー' })).toBeVisible();

    await page.goto('/account');
    await expect(page.getByLabel('表示の名前')).toBeVisible();
    await page.getByLabel('パスキーの名前（任意）').fill('iPhone');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    await expect(page.getByText('iPhone', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '回復のコードを作り直す' }).click();
    await expect(page.locator('[data-recovery-code]')).toBeVisible();
    await page.getByLabel('自分のサイトの URL').fill('https://lumen.example/');
    await page.getByLabel('X の URL').fill('https://x.com/lumen');
    await page.getByRole('button', { name: '保存する' }).click();
    await expect(page.getByText('保存しました')).toBeVisible();
    await shot(page, 'account', width);

    await page.goto('/account/delete');
    await expect(page.getByRole('button', { name: '退会する' })).toBeVisible();
    await shot(page, 'delete', width);

    const origin = { Origin: new URL(page.url()).origin };
    for (const id of ['seed-trail-guide', 'seed-portfolio-landing']) await page.request.post(`/api/works/${id}/bookmark`, { headers: origin });
    await page.goto('/account/saved');
    await page.locator('[data-masonry][data-placed] article').first().waitFor();
    await page.waitForLoadState('networkidle');
    await shot(page, 'saved', width);

    // パスキーで新しく始める画面（ログアウトしてから）
    await page.goto('/');
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    await page.goto('/signup');
    await page.getByLabel('ユーザー名').fill(`${login}x`);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await shot(page, 'signup-passkey', width);
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    await expect(page.locator('[data-recovery-code]')).toBeVisible();
    await shot(page, 'recovery', width);
  });
}
