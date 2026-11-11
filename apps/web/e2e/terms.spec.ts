// T027：利用規約、問い合わせのメール、作品の問題を報告する窓口。
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';
import { SUPPORT_EMAIL } from '../src/lib/support';
import { pageOverflow } from './helpers';

/** React が載るまで待つ。載る前に押すと、報告の中身は開かない。 */
const hydrated = (page: Page) =>
  page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

test.describe('利用規約', () => {
  test('日本語：指定された材料をすべて載せる', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveTitle(copy.terms.pageTitle);
    await expect(page.getByRole('heading', { level: 1, name: copy.terms.heading })).toBeVisible();
    for (const text of [
      ...copy.terms.posting.items,
      ...copy.terms.review.items,
      ...copy.terms.prohibited.items,
      copy.terms.use.detail,
      copy.terms.leaving.detail,
      copy.terms.contact.detail,
    ]) {
      await expect(page.getByText(text, { exact: true }), text).toBeVisible();
    }
    await expect(page.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  test('英語：日本語と同じ項目と、日本語が優先する注記を載せる', async ({ page }) => {
    await page.goto('/en/terms');
    await expect(page).toHaveTitle(copyEn.terms.pageTitle);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText(copyEn.terms.translationNote!)).toBeVisible();
    for (const text of [
      ...copyEn.terms.posting.items,
      ...copyEn.terms.review.items,
      ...copyEn.terms.prohibited.items,
      copyEn.terms.use.detail,
      copyEn.terms.leaving.detail,
      copyEn.terms.contact.detail,
    ]) {
      await expect(page.getByText(text, { exact: true }), text).toBeVisible();
    }
  });

  test('幅1440の英語：ヘッダーのメニューに Terms of Use があり、押すと /en/terms（T035「1」）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/en/about');
    await hydrated(page);
    await page.getByRole('button', { name: copyEn.header.menu }).click();
    await page.getByRole('menuitem', { name: copyEn.siteInfo.terms, exact: true }).click();
    await expect(page).toHaveURL(/\/en\/terms$/);
  });

  for (const width of [320, 390, 1440]) {
    test(`幅${width}：横スクロールがなく、重大なアクセシビリティ違反が0`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 700 });
      await page.goto('/terms');
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
    });
  }
});

test.describe('問い合わせと問題の報告', () => {
  test('/privacy に問い合わせ先のメールを載せる', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('link', { name: SUPPORT_EMAIL })).toHaveAttribute('href', `mailto:${SUPPORT_EMAIL}`);
  });

  test('作品のページ：メール、コピー、作品URL、理由を出す', async ({ page, context, request }) => {
    const list = ((await (await request.get('/api/works')).json()) as { works: { id: string }[] }).works;
    const workId = list[0]?.id;
    expect(workId).toBeTruthy();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${workId}`);
    await hydrated(page);

    const open = page.getByRole('button', { name: copy.work.report.open });
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText(SUPPORT_EMAIL, { exact: true })).toBeVisible();
    await expect(page.getByText(`https://ludion.ai/p/${workId}`, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.work.report.reason, { exact: true })).toBeVisible();
    await expect(page.locator(`a[href="mailto:${SUPPORT_EMAIL}"]`)).toHaveCount(0);

    await page.getByRole('button', { name: copy.work.report.copy }).click();
    await expect(page.getByRole('button', { name: copy.work.report.copied })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SUPPORT_EMAIL);

    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')).toEqual([]);
  });
});
