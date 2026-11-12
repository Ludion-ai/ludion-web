// 作品のページをリポジトリの形に（WS003）：頭、タブ、「この作品について」、言語の帯。
// playwright.config.ts の pages（Chromium）と work-repo-*（WebKit、Firefox）で流す。サーバーは pages（見本の作品と、自分だけの作品の見本が入っている）。
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PRIVATE_OWNER, privateFixtureId } from '../scripts/private-fixture.mjs';

const TOGGLE = 'fx-toggle';
const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/works/${TOGGLE}/${name}`, import.meta.url), 'utf8').split('\n');

async function openWork(page: Page, id: string) {
  await page.goto(`/p/${id}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
}

const about = (page: Page) => page.locator('[data-work-about]');
const panel = (page: Page, id: string) => page.locator(`[data-work-panel="${id}"]`);

test.describe('頭', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('@作者 / 題、状態の札、版、種類。数は下に1行。右に今のボタン', async ({ page }) => {
    await openWork(page, TOGGLE);
    const head = page.locator('[data-work-head]');
    await expect(head.getByRole('link', { name: '@fixture', exact: true })).toHaveAttribute('href', '/c/fixture');
    await expect(head.getByRole('heading', { level: 1 })).toHaveText('Quiet Switches');
    await expect(head.locator('[data-work-state]')).toHaveText('公開');
    await expect(head.locator('[data-work-state]')).toHaveAttribute('data-work-state', 'public');
    await expect(head).toContainText('版 1');
    await expect(head.getByText('部品 · トグル', { exact: true })).toBeVisible();
    // 右のボタン：いいね、保存、リミックス、共有（今あるボタン）。持ち主でない人に「新しい版を置く」と「設定」はない
    const actions = head.locator('[data-work-actions]');
    await expect(actions.getByRole('button')).toHaveText([/^\d+$/, '保存', 'リミックス', '共有']);
    await expect(page.getByRole('link', { name: '新しい版を置く' })).toHaveCount(0);
    // 数の行：見られた数、コピーされた数、いいね
    const counts = page.locator('[data-work-counts]');
    await expect(counts).toContainText(/見られた数 \d+/);
    await expect(counts).toContainText(/コピーされた数 \d+/);
    await expect(counts).toContainText(/いいね \d+/);
  });
});

test.describe('タブ', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('コード｜版｜系譜。初めはコード。替えても、動く作品の枠は作り直さない。コードの箱は HTML に残る', async ({ page }) => {
    let frameLoads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith(`/frame/${TOGGLE}/`)) frameLoads += 1;
    });
    await openWork(page, TOGGLE);
    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await expect(tabs).toHaveText([/^コード$/, /^版\s*1$/, /^系譜$/]);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeVisible();
    await expect(panel(page, 'versions')).toBeHidden();

    await page.locator('iframe[data-ld-frame]').evaluate((frame) => frame.setAttribute('data-same', ''));
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeHidden();
    await expect(panel(page, 'versions')).toBeVisible();
    await expect(panel(page, 'versions')).toContainText('版 1');
    await expect(panel(page, 'versions')).toContainText('今の版');
    // 動く作品は、どのタブでも出たまま。同じ iframe のままで、読み直していない
    await expect(page.locator('iframe[data-ld-frame][data-same]')).toBeVisible();
    // コードの箱（コピーされる文字の元）は、隠れていても HTML にある
    await expect(page.locator('[data-ld-code]')).toHaveCount(1);

    await tabs.nth(2).click();
    await expect(panel(page, 'lineage')).toBeVisible();
    await expect(panel(page, 'lineage')).toContainText('まだリミックスはありません');
    expect(frameLoads).toBe(1);
  });

  test('キー：矢印で隣のタブ、Home と End で端。選んだタブだけが Tab の順に入る', async ({ page }) => {
    await openWork(page, TOGGLE);
    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await tabs.nth(0).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toBeFocused();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('End');
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(tabs.nth(2)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(panel(page, 'code')).toBeVisible();
  });

  test('Worker の HTML：初めのタブはコードで、コードの箱とコピーのボタンが入っている。持ち主だけの物は入っていない', async ({ request }) => {
    const html = await (await request.get(`/p/${TOGGLE}`)).text();
    expect(html).toContain('data-ld-code');
    expect(html).toContain('data-work-about');
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>(?:<svg[\s\S]*?<\/svg>)?コード/);
    expect(html).not.toContain('新しい版を置く');
    expect(html).not.toContain('data-work-panel="settings"');
  });
});

test.describe('この作品について', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('地図から：描き方、操作、外から読む物、大きさ。キー操作と読み上げ（役目、状態、名前、フォーカスの枠）。言語の帯', async ({ page }) => {
    await openWork(page, TOGGLE);
    const box = about(page);
    await expect(box.getByRole('heading', { name: 'この作品について' })).toBeVisible();
    await expect(box.locator('[data-about-item="dom-css"]')).toHaveText('DOM + CSS');
    await expect(box.locator('[data-about-item="pointer"]')).toHaveText('ポインター');
    await expect(box).toContainText('外から読む物');
    await expect(box).toContainText('3 ファイル');
    await expect(box.getByRole('heading', { name: /キー操作と読み上げ/ })).toBeVisible();
    await expect(box.locator('[data-about-item="aria-role:switch"]')).toHaveText('switch');
    await expect(box.locator('[data-about-item="aria-state:aria-checked"]')).toHaveText('aria-checked');
    await expect(box.locator('[data-about-item="aria-name:aria-label"]')).toHaveText('aria-label');
    await expect(box.locator('[data-about-item="focus-visible::focus-visible"]')).toHaveText(':focus-visible');
    // 見本は ld upload を通っていないが、管理 API と同じ置き場（works/<id>/<version>）なので、検査の行が出る
    await expect(box.locator('[data-about-checked]')).toContainText('ld check のアクセシビリティ（axe）を通った');
    // 言語の帯：割合の合計は 100%（丸めの分だけずれる）
    const percents = (await box.locator('[data-about-languages] li').allTextContents()).map((text) => Number(/([\d.]+)%/.exec(text)![1]));
    expect(percents.length).toBeGreaterThanOrEqual(3);
    expect(Math.abs(percents.reduce((sum, value) => sum + value, 0) - 100)).toBeLessThan(0.5);
    await expect(box.locator('[data-about-languages]')).toContainText('CSS');
  });

  test('印を押すと、その行が出る。行の番号と文字は、本当のファイルのその行。もう一度押すか「閉じる」で閉じる', async ({ page }) => {
    await openWork(page, TOGGLE);
    const box = about(page);
    const peek = box.locator('[data-about-peek]');
    await expect(peek).toBeHidden();

    // 役目：part.html の role="switch" の最初の行
    const html = fixture('part.html');
    const roleLine = html.findIndex((line) => line.includes('role="switch"')) + 1;
    const role = box.locator('[data-about-item="aria-role:switch"]');
    await role.click();
    await expect(role).toHaveAttribute('aria-expanded', 'true');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText(`part.html の ${roleLine} 行目`);
    await expect(peek).toContainText('全部で 3 か所');
    const current = peek.locator('[aria-current="true"]');
    await expect(current).toHaveAttribute('data-line', String(roleLine));
    expect((await current.textContent())!.replace(/^\d+/, '').trimEnd()).toBe(html[roleLine - 1].trimEnd());

    // フォーカスの枠：part.css の :focus-visible の行へ替わる
    const css = fixture('part.css');
    const focusLine = css.findIndex((line) => line.includes(':focus-visible')) + 1;
    await box.locator('[data-about-item="focus-visible::focus-visible"]').click();
    await expect(role).toHaveAttribute('aria-expanded', 'false');
    await expect(peek).toContainText(`part.css の ${focusLine} 行目`);
    await expect(peek.locator('[aria-current="true"]')).toContainText(css[focusLine - 1].trim());
    // 前後の行も、ファイルの行の番号で出る
    await expect(peek.locator(`[data-line="${focusLine - 1}"]`)).toHaveCount(1);
    await expect(peek.locator(`[data-line="${focusLine + 1}"]`)).toHaveCount(1);

    await peek.getByRole('button', { name: '閉じる' }).click();
    await expect(peek).toBeHidden();
  });

  test('文書の作品：index.html の行を指す', async ({ page }) => {
    await openWork(page, 'mal-doc');
    const box = about(page);
    await expect(box).toContainText('1 ファイル');
    const first = box.locator('[data-about-item]').first();
    await first.click();
    await expect(box.locator('[data-about-peek]')).toContainText(/index\.html の \d+ 行目/);
  });
});

test.describe('持ち主', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('自分だけの作品：状態の札は「自分だけ」。「新しい版を置く」と「設定」のタブがあり、画像を付けるは設定の中', async ({ page, context, baseURL }) => {
    const id = privateFixtureId('mal-doc');
    await context.addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: baseURL! }]);
    await openWork(page, id);
    const head = page.locator('[data-work-head]');
    await expect(head.locator('[data-work-state]')).toHaveText('自分だけ');
    await expect(head.getByRole('link', { name: '新しい版を置く' })).toHaveAttribute('href', `/new?work=${id}`);
    await expect(page.locator('[data-private-notice]')).toContainText('自分だけの作品です');
    // いいね、保存、共有、リミックスは出さない（docs/tasks/T036.md）
    await expect(head.locator('[data-work-actions]').getByRole('button')).toHaveCount(0);

    const tabs = page.getByRole('tablist', { name: '作品の中身' }).getByRole('tab');
    await expect(tabs).toHaveText([/^コード$/, /^版\s*1$/, /^系譜$/, /^設定$/]);
    await expect(panel(page, 'settings')).toBeHidden();
    await tabs.nth(3).click();
    await expect(panel(page, 'settings')).toBeVisible();
    await expect(panel(page, 'settings').getByRole('link', { name: '自分の作品へ' })).toHaveAttribute('href', '/account/works');
    await expect(panel(page, 'settings').getByRole('button', { name: /に画像を付ける$/ })).toBeVisible();
  });

  test('ほかの人には、自分だけの作品は 404 のまま', async ({ request }) => {
    expect((await request.get(`/p/${privateFixtureId('mal-doc')}`, { maxRedirects: 0 })).status()).toBe(404);
  });
});

test.describe('スマホ（幅390）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('順は、頭 → 動く作品 → ボタン → 数 → タブ → この作品について。印は横に流し、ページは横にはみ出さない', async ({ page, browserName }) => {
    test.skip(browserName === 'firefox', 'Firefox は isMobile を持たない');
    await openWork(page, TOGGLE);
    const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
    const order = [
      await top('[data-work-head]'),
      await top('iframe[data-ld-frame]'),
      await top('button[aria-haspopup="dialog"] >> visible=true'),
      await top('[data-work-counts]'),
      await top('[role="tablist"]'),
      await top('[data-work-about]'),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // 頭のボタン（1024px以上の形）は出さない。種類の札は、頭ではなく数の行に出す（頭を2行に収める）
    await expect(page.locator('[data-work-actions]')).toBeHidden();
    await expect(page.locator('[data-work-head]').getByText('部品 · トグル', { exact: true })).toBeHidden();
    await expect(page.locator('[data-work-counts]').getByText('部品 · トグル', { exact: true })).toBeVisible();
    const head = (await page.locator('[data-work-head]').boundingBox())!;
    expect(head.height).toBeLessThan(80);
    // 印は1行に流す（折り返さない）。はみ出した分は、その行の中で横に送る
    const list = about(page).locator('dl').first();
    const tops = await list.locator('[data-about-item]').evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
