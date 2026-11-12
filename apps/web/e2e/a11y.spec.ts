import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openHome, TOTAL } from './helpers';

/** axe-core を回し、全件を出力して、critical と serious の件数を返す。 */
async function runAxe(page: Page, label: string) {
  const { violations, passes } = await new AxeBuilder({ page }).analyze();
  const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  console.log(
    `axe [${label}] 通った規則 ${passes.length}、違反 ${violations.length}（critical+serious ${blocking.length}）` +
      violations.map((v) => `\n  - ${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`).join(''),
  );
  return blocking;
}

test.describe('axe-core（critical と serious が0件）', () => {
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 1100, height: 800 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    test(`幅${width}：ホーム`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await openHome(page);
      expect(await runAxe(page, `${width} ホーム`)).toEqual([]);
    });
  }

  test('幅1440：カードにカーソルを乗せた状態', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page);
    await page.locator('article').first().hover();
    await expect(page.locator('article').first().locator('button')).toHaveCSS('opacity', '1');
    expect(await runAxe(page, '1440 カードの hover')).toEqual([]);
  });

  test('幅1440：カードにキーボードでフォーカスした状態', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page);
    await page.getByRole('group', { name: '並び' }).getByRole('link', { name: '新着' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('article').first().locator('button')).toHaveCSS('opacity', '1');
    expect(await runAxe(page, '1440 カードのフォーカス')).toEqual([]);
  });

  // 保存を押した状態は e2e/accounts.spec.ts（ログインが要る）
  test('幅1440：チップを選んだ状態', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openHome(page);
    await page.getByRole('link', { name: 'Web', exact: true }).click();
    expect(await runAxe(page, '1440 チップ')).toEqual([]);
  });

  test('幅1440：検索で0件', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/?q=zzzz');
    await expect(page.getByRole('button', { name: '条件をはずす' })).toBeVisible();
    expect(await runAxe(page, '1440 検索0件')).toEqual([]);
  });

  test('幅390：検索欄を開いた状態', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await page.getByRole('button', { name: '検索を開く' }).click();
    expect(await runAxe(page, '390 検索欄')).toEqual([]);
  });

  test('知らない道の 404 のページ', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/not-built');
    await expect(page.getByText('このページはありません')).toBeVisible();
    expect(await runAxe(page, '1440 知らない道の 404')).toEqual([]);
  });
});

/** フォーカスの枠が SPEC 2 の値で、祖先の overflow にも切られず、全周が見えることを確かめる。 */
async function expectVisibleFocus(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    const style = getComputedStyle(element);
    const width = parseFloat(style.outlineWidth);
    const offset = parseFloat(style.outlineOffset);
    const rect = element.getBoundingClientRect();
    const reach = width + offset;
    const ring = { left: rect.left - reach, top: rect.top - reach, right: rect.right + reach, bottom: rect.bottom + reach };

    const clippedBy: string[] = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      const clipsX = parentStyle.overflowX !== 'visible';
      const clipsY = parentStyle.overflowY !== 'visible';
      if (parent === document.body || parent === document.documentElement) continue;
      if (!clipsX && !clipsY) continue;
      const box = parent.getBoundingClientRect();
      if (clipsX && (ring.left < box.left - 0.01 || ring.right > box.right + 0.01)) clippedBy.push(`x:${parent.tagName}`);
      if (clipsY && (ring.top < box.top - 0.01 || ring.bottom > box.bottom + 0.01)) clippedBy.push(`y:${parent.tagName}`);
    }
    return {
      name: element.getAttribute('aria-label') || element.textContent,
      outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`,
      offset: style.outlineOffset,
      clippedBy,
    };
  });
  expect(result.outline, `${label}（${result.name}）の枠`).toBe('2px solid rgb(22, 22, 29)');
  expect(result.offset, `${label}（${result.name}）の枠の間隔`).toBe('2px');
  expect(result.clippedBy, `${label}（${result.name}）の枠が切れていない`).toEqual([]);
  return result.name;
}

async function focusedName(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement;
    return element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;
  });
}

test.describe('キーボードだけで操作する', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Tab の順：ロゴ→検索→ダークモード→メニュー→ログイン→サイドバー（自分の作品まで）→チップ→並び→カード→保存。すべて枠が見える', async ({ page }) => {
    await openHome(page);
    const visited: string[] = [];
    // サイトの情報（利用規約など）は、サイドバーの下からヘッダーのメニューへ移った（T035「1」）
    for (let i = 0; i < 23; i += 1) {
      await page.keyboard.press('Tab');
      await expectVisibleFocus(page, `Tab ${i + 1}回目`);
      visited.push((await focusedName(page))!);
    }
    expect(visited).toEqual([
      'Ludion',
      '作品をさがす',
      'ダークモード',
      'メニュー',
      'ログイン',
      'ホーム',
      '探す',
      '保存',
      // ログインしていない人の「自分の作品」（WS001）。押すとログインへ
      '自分の作品',
      'すべて',
      'Web',
      'モバイル',
      'ダッシュボード',
      'EC',
      'ミニマル',
      '実験',
      'モーション',
      '壁紙',
      '人気',
      '新着',
      'Studio Portfolio Landing@seed_a',
      'Studio Portfolio Landingを保存',
      'Trail Guide App@seed_b',
    ]);
  });

  test('カードを全部たどっても、枠がカードの端で切れない', async ({ page }) => {
    await openHome(page);
    await page.locator('article').first().locator('> a').focus();
    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 24; i += 1) {
      await page.keyboard.press('Tab');
      await expectVisibleFocus(page, `カード ${i + 1}`);
    }
  });

  test('検索→チップ→並び→カード→保存 を通しで操作する', async ({ page }) => {
    await openHome(page);

    // 検索：Ctrl+K で入り、打って絞り、Esc で外す
    await page.keyboard.press('Control+k');
    const input = page.getByRole('searchbox');
    await expect(input).toBeFocused();
    await expectVisibleFocus(page, '検索欄');
    await page.keyboard.type('landing');
    await expect(page).toHaveURL('/?q=landing');
    await expect.poll(() => page.locator('article').count()).toBeLessThan(TOTAL);

    // チップ：Tab で進み、Enter で選ぶ
    const web = page.getByRole('link', { name: 'Web', exact: true });
    for (let i = 0; i < 20 && !(await web.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(web).toBeFocused();
    await expectVisibleFocus(page, 'チップ');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/?q=landing&c=web');
    await expect(web).toHaveAttribute('aria-current', 'true');
    await expect(web).toBeFocused();

    // 並び：Tab で進み、Enter で選ぶ
    const newest = page.getByRole('group', { name: '並び' }).getByRole('link', { name: '新着' });
    for (let i = 0; i < 10 && !(await newest.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(newest).toBeFocused();
    await expectVisibleFocus(page, '並び');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/?q=landing&c=web&sort=new');
    await expect(newest).toBeFocused();

    // カード：次の Tab で絵のリンク
    await page.keyboard.press('Tab');
    const card = page.getByRole('link', { name: /^Studio Portfolio Landing/ });
    await expect(card).toBeFocused();
    await expectVisibleFocus(page, 'カード');

    // 保存：次の Tab。押した後の動きはログインが要るので e2e/accounts.spec.ts
    await page.keyboard.press('Tab');
    const save = page.getByRole('button', { name: 'Studio Portfolio Landingを保存' });
    await expect(save).toBeFocused();
    await expectVisibleFocus(page, '保存');

    // 戻って Enter で作品のページへ
    await page.keyboard.press('Shift+Tab');
    await expect(card).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/p/seed-portfolio-landing');
  });

  test('サイドバーのツールチップはフォーカスでも出る', async ({ page }) => {
    await openHome(page);
    const link = page.getByRole('complementary').getByRole('link', { name: '探す' });
    await page.getByRole('complementary').getByRole('link', { name: 'ホーム' }).focus();
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    await expect(link.locator('span')).toHaveCSS('opacity', '1');
  });

  test('マウスで押したときは枠を出さない（:focus-visible だけ）', async ({ page }) => {
    await openHome(page);
    const chip = page.getByRole('link', { name: 'Web', exact: true });
    await chip.click();
    await expect(chip).toHaveCSS('outline-style', 'none');
  });
});

test.describe('キーボード：小さい画面', () => {
  test('幅390：チップは Tab で画面の中へスクロールし、枠が見える', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    const last = page.getByRole('link', { name: '実験', exact: true });
    await page.getByRole('link', { name: 'すべて', exact: true }).focus();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press('Tab');
      await expectVisibleFocus(page, `チップ ${i + 2}`);
    }
    await expect(last).toBeFocused();
    const box = (await last.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.x).toBeGreaterThanOrEqual(0);
  });

  test('幅390：検索欄を開いているあいだは、裏のものへ Tab で入らない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await page.getByRole('button', { name: '検索を開く' }).click();
    await expect(page.getByRole('searchbox')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '検索を閉じる' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'すべて', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    // ロゴは隠れていて、フォーカスが入らない
    expect(await page.evaluate(() => document.activeElement?.closest('header a') ?? null)).toBeNull();
  });

  test('幅390：カードの枠が切れず、カードの間の Tab は保存のボタンを通らない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await page.locator('article').first().locator('> a').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('article').nth(1).locator('> a')).toBeFocused();
    await expectVisibleFocus(page, 'カード');
    await page.keyboard.press('Shift+Tab');
    await expectVisibleFocus(page, 'カード');
  });

  test('幅390：下のタブにも枠が見える', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHome(page);
    await page.locator('nav.fixed').getByRole('link', { name: 'ホーム' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('nav.fixed').getByRole('link', { name: '探す' })).toBeFocused();
    await expectVisibleFocus(page, '下のタブ');
  });
});
