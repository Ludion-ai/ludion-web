import { expect, test, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';
import { formatCount, formatCountEn } from '../src/lib/format';

/** 言語の切り替えは、ヘッダーのメニューの中（T035「1」）。React が載ってから開く */
async function openMenu(page: Page, name: string) {
  await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  await page.getByRole('button', { name }).click();
}

/** 言語（SPEC.md 9）。日本語は今の URL、英語は /en。切り替えで選んだ言語 → ブラウザの言語の順で決まる。 */

const JAPANESE = /[぀-ヿ一-鿿]/;

test.describe('英語のブラウザ', () => {
  test.use({ locale: 'en-US' });

  test('日本語の URL を開くと、最初の描画の前に /en へ移る。URL の値は残る', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
    });
    await page.goto('/?c=web');
    await expect(page).toHaveURL(/\/en\?c=web$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: copyEn.filters.mobile, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: copyEn.header.login })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('移った後のリンクは英語のページのまま', async ({ page }) => {
    await page.goto('/en');
    await page.getByRole('link', { name: copyEn.filters.mobile, exact: true }).click();
    await expect(page).toHaveURL(/\/en\?c=mobile$/);
    await expect(page.getByRole('link', { name: copyEn.header.login })).toHaveAttribute('href', /next=%2Fen%3Fc%3Dmobile/);
    await page.goto('/en/privacy');
    await expect(page.getByRole('heading', { name: copyEn.privacy.heading, level: 1 })).toBeVisible();
    await expect(page.getByText(copyEn.privacy.translationNote!)).toBeVisible();
    await expect(page.getByRole('heading', { name: copyEn.privacy.windowsApp.heading })).toBeVisible();
  });

  test('ブラウザの言語のどこかに日本語があれば、日本語のまま', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'ja'] }));
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });

  test('切り替えで日本語を選ぶと、次からブラウザの言語より優先する。/en を開いても日本語へ戻る', async ({ page }) => {
    await page.goto('/en/about');
    await openMenu(page, copyEn.header.menu);
    await page.getByRole('menuitem', { name: copyEn.language.switchLabel }).click();
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/en');
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('日本語のブラウザ', () => {
  test('日本語の URL はそのまま。切り替えを押すと同じページの英語へ移り、覚える', async ({ page }) => {
    await page.goto('/about');
    await expect(page).toHaveURL(/\/about$/);
    await openMenu(page, copy.header.menu);
    await page.getByRole('menuitem', { name: copy.language.switchLabel }).click();
    await expect(page).toHaveURL(/\/en\/about$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.goto('/about');
    await expect(page).toHaveURL(/\/en\/about$/);
    const cookie = (await page.context().cookies()).find(({ name }) => name === 'ld_lang');
    expect(cookie?.value).toBe('en');
  });

  test('/en を直接開いた人は、選んでいなければ英語のまま', async ({ page }) => {
    await page.goto('/en');
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test.describe('ボット', () => {
  test.use({ locale: 'en-US', userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });

  test('検索エンジンは移さない', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
});

test.describe('Worker の HTML', () => {
  test('言語ごとに lang、title、canonical、hreflang が付き、キャッシュできる', async ({ request }) => {
    const ja = await request.get('/');
    const en = await request.get('/en');
    const jaHtml = await ja.text();
    const enHtml = await en.text();
    expect(jaHtml).toContain('<html lang="ja">');
    expect(enHtml).toContain('<html lang="en">');
    expect(enHtml).toContain(`<title>${copyEn.home.pageTitle}</title>`);
    expect(jaHtml).toMatch(/<link rel="canonical" href="https:\/\/ludion\.ai\/">/);
    expect(enHtml).toMatch(/<link rel="canonical" href="https:\/\/ludion\.ai\/en">/);
    for (const html of [jaHtml, enHtml]) {
      expect(html).toContain('<link rel="alternate" hreflang="ja" href="https://ludion.ai/">');
      expect(html).toContain('<link rel="alternate" hreflang="en" href="https://ludion.ai/en">');
      expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://ludion.ai/en">');
    }
    expect(en.headers()['cache-control']).toContain('s-maxage=60');
    expect(en.headers()['set-cookie']).toBeUndefined();
  });

  test('JS がなくても英語で描かれ、サイトの枠に日本語が出ない（切り替えのリンクを除く）', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: 'en-US', viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto('/en/about');
    const text = (await page.locator('body').innerText()).replace(copyEn.language.switchTo, '');
    expect(text).not.toMatch(JAPANESE);
    await context.close();
  });

  test('/en/ は /en へ。/en の下の知らない道は、英語の 404', async ({ request }) => {
    const slash = await request.get('/en/?c=web', { maxRedirects: 0 });
    expect(slash.status()).toBe(301);
    expect(slash.headers().location).toBe('/en?c=web');
    const missing = await request.get('/en/nothing-here');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('<html lang="en">');
  });

  test('サイトマップは両方の言語を載せ、対応を書く', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('<loc>https://ludion.ai/en</loc>');
    expect(xml).toContain('<loc>https://ludion.ai/en/about</loc>');
    expect(xml).toContain('hreflang="en" href="https://ludion.ai/en/about"');
  });
});

test.describe('数の書き方', () => {
  test('日本語は万、英語は k', () => {
    expect(formatCount(12_400)).toBe('1.2万');
    expect(formatCountEn(12_400)).toBe('12.4k');
    expect(formatCountEn(952)).toBe('952');
    expect(formatCountEn(1_200_000)).toBe('1.2M');
  });
});
