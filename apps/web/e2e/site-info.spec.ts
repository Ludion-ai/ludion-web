// T016、T027：サイトの情報ページ、そこへの導線、検索に出るための head と sitemap。
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { copy } from '../src/copy';
import type { Work } from '../src/data/works';
import { pageOverflow } from './helpers';

const metaOf = (html: string, attribute: 'property' | 'name', key: string) =>
  new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html)?.[1];
const canonicalOf = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1];
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

/** React が載るまで待つ。載る前に押すと、メニューは開かない。 */
const hydrated = (page: Page) =>
  page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

const works = async (request: APIRequestContext) => ((await (await request.get('/api/works')).json()) as { works: Work[] }).works;

const INFO_LINKS = [
  ['利用規約', '/terms'],
  ['プライバシー', '/privacy'],
  ['運営者', '/about'],
] as const;

test.describe('/terms、/privacy、/about', () => {
  for (const [path, heading, title] of [
    ['/terms', '利用規約', '利用規約 · Ludion'],
    ['/privacy', 'プライバシー', 'プライバシー · Ludion'],
    ['/about', '運営者', '運営者 · Ludion'],
  ]) {
    test(`${path}：Worker が描く。cookie がなくても同じ HTML で、キャッシュできる`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
      expect(response.headers()['cache-tag']).toBeUndefined();
      expect(response.headers()['set-cookie']).toBeUndefined();
      const html = await response.text();
      expect(titleOf(html)).toBe(title);
      expect(html).toContain(`<h1 class="text-title font-bold">${heading}</h1>`);
      expect(canonicalOf(html)).toBe(`https://ludion.ai${path}`);
      const withCookie = await request.get(path, { headers: { Cookie: `ld_session=${'a'.repeat(64)}` } });
      expect(await withCookie.text()).toBe(html);
    });

    for (const { width, height } of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 320, height: 568 },
    ]) {
      test(`${path}、幅${width}：横スクロールがなく、axe の critical と serious が0`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(path);
        await page.getByRole('heading', { level: 1, name: heading }).waitFor();
        expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
        const { violations } = await new AxeBuilder({ page }).analyze();
        expect(violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
      });
    }
  }

  test('/privacy：材料がすべて載っている（文は copy.ts）', async ({ page }) => {
    await page.goto('/privacy');
    for (const text of [
      '保存するもの',
      '保存しないもの',
      'ld_session',
      '30日で切れます',
      '回数の制限のために、その場で使うだけです',
      '送信先',
      'Google LLC',
      '検索語は除く',
      '_ga',
      'Google シグナルと広告のパーソナライズは切っています',
      'Cloudflare',
      '法令に基づく場合を除きます',
      '最終更新：',
    ]) {
      await expect(page.getByRole('main').getByText(text, { exact: false }).first(), text).toBeVisible();
    }
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Google アナリティクス オプトアウト アドオン' })).toHaveAttribute('href', 'https://tools.google.com/dlpage/gaoptout');
    await expect(main.getByRole('link', { name: 'X の @Lattice_Node' })).toHaveAttribute('href', 'https://x.com/Lattice_Node');
    await expect(main.getByRole('link', { name: 'Google のサービスを使うサイトでのデータの扱い' })).toHaveAttribute('href', /policies\.google\.com\/technologies\/partner-sites/);
  });

  test('/about：運営は個人。MIT とクレジット行。問い合わせ先。プライバシーへのリンク', async ({ page }) => {
    await page.goto('/about');
    const main = page.getByRole('main');
    await expect(main).toContainText('個人（Lattice）');
    await expect(main).toContainText('MIT');
    await expect(main).toContainText('クレジット行');
    await expect(main.getByRole('link', { name: 'X の @Lattice_Node' })).toHaveAttribute('href', 'https://x.com/Lattice_Node');
    await main.getByRole('link', { name: copy.about.privacy }).click();
    await expect(page).toHaveURL('/privacy');
    await expect(page).toHaveTitle('プライバシー · Ludion');
  });

  test('robots.txt で止めていない。Sitemap を指している', async ({ request }) => {
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).not.toMatch(/Disallow:\s*\/(terms|privacy|about)/);
    expect(robots).toContain('Sitemap: https://ludion.ai/sitemap.xml');
  });
});

test.describe('どのページからも2回の操作以内で行ける', () => {
  const pagesToTry = async (request: APIRequestContext) => {
    const [work] = await works(request);
    return ['/', `/p/${work.id}`, `/c/${work.creator.handle}`, '/terms', '/privacy', '/about', '/nothing-here'];
  };

  test('幅1440：サイドバーの下にサイトの情報のリンクはない（T035「1」。ヘッダーのメニューにある）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await hydrated(page);
    await expect(page.getByRole('navigation', { name: copy.siteInfo.label })).toHaveCount(0);
    await expect(page.getByRole('complementary').getByRole('link', { name: '利用規約' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: copy.header.menu })).toBeVisible();
  });

  for (const width of [390, 1023, 1440]) {
    test(`幅${width}：ログインしていなくても、メニューを開いて押す（2回）`, async ({ page, request }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/');
      await expect(page.getByRole('navigation', { name: copy.siteInfo.label })).toHaveCount(0);
      for (const path of await pagesToTry(request)) {
        for (const [name, url] of INFO_LINKS) {
          await page.goto(path);
          await hydrated(page);
          await page.getByRole('button', { name: copy.header.menu }).click();
          await page.getByRole('menuitem', { name }).click();
          await expect(page, `${path} → ${name}`).toHaveURL(url);
        }
      }
    });
  }

  test('幅390：メニューはキーボードで開いて動かせて、Esc で閉じる', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/about');
    await hydrated(page);
    const button = page.getByRole('button', { name: copy.header.menu });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('menuitem', { name: '利用規約' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'プライバシー' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(button).toBeFocused();
  });

  test('幅390：メニューのボタンがあっても、ヘッダーは1行で収まり、ログインの右端は変わらない', async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      const login = (await page.getByRole('link', { name: 'ログイン', exact: true }).boundingBox())!;
      expect(login.x + login.width, String(width)).toBe(width - 16);
      expect(await pageOverflow(page), String(width)).toBeLessThanOrEqual(0);
    }
  });
});

/** PNG の幅と高さ（IHDR）。 */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test.describe('検索に出るための head（T016「2.6」）', () => {
  async function ldJson(html: string) {
    const text = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(text).toBeTruthy();
    return JSON.parse(text!) as Record<string, unknown>[];
  }

  test('ホーム：title、説明、OG、twitter:card、canonical。head の中にある', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(titleOf(head)).toBe(copy.home.pageTitle);
    expect(metaOf(head, 'name', 'description')).toBe(copy.home.description);
    expect(metaOf(head, 'property', 'og:title')).toBe(copy.home.pageTitle);
    expect(metaOf(head, 'property', 'og:description')).toBe(copy.home.description);
    expect(metaOf(head, 'name', 'twitter:card')).toBe('summary_large_image');
    expect(canonicalOf(head)).toBe('https://ludion.ai/');
    expect(metaOf(head, 'property', 'og:image')).toMatch(/\/og-home\.png$/);
  });

  test('ホーム：絞り込み付きの URL も、canonical はホーム', async ({ request }) => {
    expect(canonicalOf(await (await request.get('/?c=web&q=a')).text())).toBe('https://ludion.ai/');
  });

  test('ホームの JSON-LD：WebSite と Organization', async ({ request }) => {
    const data = await ldJson(await (await request.get('/')).text());
    const webSite = data.find((item) => item['@type'] === 'WebSite')!;
    const organization = data.find((item) => item['@type'] === 'Organization')!;
    expect(webSite).toMatchObject({ '@context': 'https://schema.org', name: 'Ludion', url: 'https://ludion.ai/' });
    expect(organization).toMatchObject({ '@context': 'https://schema.org', name: 'Ludion', url: 'https://ludion.ai/', logo: 'https://ludion.ai/logo.png', sameAs: ['https://x.com/Lattice_Node'] });
  });

  test('サイトの画像：OG は 1200×630、ロゴは 512×512 の PNG。ファイルが配信される', async ({ request }) => {
    for (const [path, size] of [['/og-home.png', { width: 1200, height: 630 }], ['/logo.png', { width: 512, height: 512 }]] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toContain('image/png');
      expect(pngSize(await response.body()), path).toEqual(size);
    }
    const onDisk = readFileSync(new URL('../public/og-home.png', import.meta.url));
    expect(onDisk.length).toBeLessThan(600_000);
  });

  // 手元のサーバーの名前（127.0.0.1）で開いても ludion.ai を指す。workers.dev は本番で確かめる（scripts/verify-t016.mjs）
  test('作品のページと作り手のページ：canonical は開いた名前によらず ludion.ai', async ({ request }) => {
    const [work] = await works(request);
    const handle = work.creator.handle;
    expect(canonicalOf(await (await request.get(`/p/${work.id}`)).text())).toBe(`https://ludion.ai/p/${work.id}`);
    expect(canonicalOf(await (await request.get(`/c/${handle}`)).text())).toBe(`https://ludion.ai/c/${handle}`);
    // handle の大文字と小文字が違っても、1つの URL を指す
    expect(canonicalOf(await (await request.get(`/c/${handle.toUpperCase()}`)).text())).toBe(`https://ludion.ai/c/${handle}`);
  });

  test('知らない道には canonical を付けない', async ({ request }) => {
    expect(canonicalOf(await (await request.get('/nothing-here')).text())).toBeUndefined();
  });
});

test.describe('/sitemap.xml', () => {
  async function parse(page: Page, xml: string) {
    await page.goto('about:blank');
    return page.evaluate((text) => {
      const doc = new DOMParser().parseFromString(text, 'application/xml');
      return {
        error: doc.querySelector('parsererror')?.textContent ?? null,
        root: doc.documentElement.localName,
        ns: doc.documentElement.namespaceURI,
        locs: [...doc.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'loc')].map((loc) => loc.textContent!),
      };
    }, xml);
  }

  test('正しい形の XML で、ホーム、全作品、作り手、サイトの情報があり、全部 ludion.ai', async ({ page, request }) => {
    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/xml');
    expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=60');
    expect(response.headers()['cache-tag']).toBe('catalog');
    const parsed = await parse(page, await response.text());
    expect(parsed.error).toBeNull();
    expect(parsed.root).toBe('urlset');
    expect(parsed.ns).toBe('http://www.sitemaps.org/schemas/sitemap/0.9');

    const list = await works(request);
    const handles = [...new Set(list.map((work) => work.creator.handle))];
    const expected = [
      '/',
      '/about',
      '/privacy',
      '/terms',
      ...list.map((work) => `/p/${work.id}`),
      ...handles.map((handle) => `/c/${handle}`),
    ].flatMap((path) => [`https://ludion.ai${path}`, `https://ludion.ai/en${path === '/' ? '' : path}`]);
    expect(parsed.locs.toSorted()).toEqual(expected.toSorted());
    expect(new Set(parsed.locs).size).toBe(parsed.locs.length);
  });
});
