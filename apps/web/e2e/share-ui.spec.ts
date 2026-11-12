// リンクで見せる（SHARE001）の画面を、3つのブラウザで見る。見本（scripts/private-fixture.mjs）を読むだけで、状態は変えない
// （スイッチを押す試験は e2e/share.spec.ts。合言葉が変わると、同じ見本を使う frame-escape.spec.ts が落ちるため）。

import { expect, test, type Page } from '@playwright/test';
import { PRIVATE_OWNER, sharedFixtureId, sharedFixtureToken } from '../scripts/private-fixture.mjs';
import { WEBRTC_NAME } from '@ludion/render';
import { ownOrigin } from './visitor';

const ID = 'mal-nav';
const TOKEN = sharedFixtureToken(ID);

const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

test('ログインなしの人：作品が動き、札と知らせがある。数、いいね、リミックス、タブの列、持ち主の知らせはない', async ({ page }) => {
  await page.goto(`/s/${TOKEN}`);
  await hydrated(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-share-notice]')).toHaveText('リンクで見せている作品です。この作品は審査していません。パスワードやカードの番号を入れないでください。');
  await expect(page.locator('[data-work-state="shared"]:visible')).toHaveText('リンクで見せる');
  await expect(page.locator('iframe[data-ld-frame]').first()).toHaveAttribute('src', new RegExp(`^/share-frame/${TOKEN}/`));
  await expect(page.locator('iframe[data-ld-frame]').first()).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  await expect(page.getByRole('button', { name: '全部をコピー' })).toBeVisible();
  await expect(page.locator('[data-share-connect]')).toContainText('Ludion につなぐと、作った物が残る');
  await expect(page.locator('[data-work-actions]')).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('[data-share-owner]')).toHaveCount(0);
});

test.describe('持ち主（見本の持ち主のセッション）', () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: ownOrigin() }]);
  });

  test('/s/ では「リンクで見せています」と「オフにする」。設定のタブと「新しい版を置く」は出さない', async ({ page }) => {
    await page.goto(`/s/${TOKEN}`);
    await hydrated(page);
    const owner = page.locator('[data-share-owner]');
    await expect(owner).toContainText('リンクで見せています');
    await expect(owner.getByRole('button', { name: 'オフにする' })).toBeEnabled();
    await expect(page.locator('[data-work-new-version]')).toHaveCount(0);
  });

  test('作品のページの設定のタブ：スイッチはオンで、住所が出る。札と知らせも「リンクで見せる」', async ({ page }) => {
    await page.goto(`/p/${sharedFixtureId(ID)}`);
    await hydrated(page);
    await expect(page.locator('[data-private-notice]')).toContainText('リンクで見せています');
    await expect(page.locator('[data-work-state="shared"]:visible')).toHaveText('リンクで見せる');
    await page.getByRole('tab', { name: '設定' }).click();
    const toggle = page.getByRole('switch', { name: 'リンクで見せる' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('見せる住所')).toHaveValue(`${ownOrigin()}/s/${TOKEN}`);
  });
});

// FRAME002 の枠の守りが、合言葉の枠の中でも効いていること。見るのは「無いこと」だけ（RTC で始まる名前が undefined、入れ子の枠が 0）。
// 部品の作品（mal-cookie）と文書の作品（mal-doc）の、リンクで見せる見本を使う
for (const [kind, id] of [['部品', 'mal-cookie'], ['文書', 'mal-doc']] as const) {
  test(`${kind}の作品の /s/ の枠の中：RTC で始まる名前はどれも undefined。window.length は 0`, async ({ page }) => {
    const token = sharedFixtureToken(id);
    await page.goto(`/s/${token}`);
    await hydrated(page);
    const frameElement = page.locator('iframe[data-ld-frame]').first();
    await expect(frameElement).toHaveAttribute('src', new RegExp(`^/share-frame/${token}/`));
    await expect(frameElement).toHaveAttribute('data-ld-loaded', '');
    const frame = page.frames().find((one) => one.url().includes(`/share-frame/${token}/`));
    expect(frame, `/share-frame/${token}/`).toBeTruthy();
    const seen = await frame!.evaluate((source) => {
      const re = new RegExp(source);
      const w = window as unknown as Record<string, unknown>;
      const names = Object.getOwnPropertyNames(window).filter((name) => re.test(name));
      const named = ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCSessionDescription', 'RTCIceCandidate'];
      return { left: names.filter((name) => typeof w[name] !== 'undefined'), named: named.map((name) => typeof w[name]), frames: window.length };
    }, WEBRTC_NAME.source);
    expect(seen).toEqual({ left: [], named: ['undefined', 'undefined', 'undefined', 'undefined', 'undefined'], frames: 0 });
  });
}
