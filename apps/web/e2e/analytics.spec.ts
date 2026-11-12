// T016「2.5」：GA4 を動かすのは、本番へのデプロイのビルドだけ。手元のビルドを ludion.ai の名前で開いても送らない。
// 11/9 に、T018 の確かめが手元の見本を ludion.ai の名前で開き、Google に届いた（docs/reports/T016.md）。ここはその形をそのまま再現する。
import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rollup } from 'vite';

const webDir = fileURLToPath(new URL('..', import.meta.url));
const GOOGLE = /googletagmanager\.com|google-analytics\.com|analytics\.google\.com/;
const MARKS = /googletagmanager|G-91CJFHRK88/;

/** Google への要求を、どれも外へ出さずに記録する。 */
async function watchGoogle(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.context().route(GOOGLE, (route) => {
    seen.push(route.request().url());
    return route.abort();
  });
  return seen;
}

/** 手元のサーバーを ludion.ai の名前で開く。POST は通さない。 */
async function serveAsProduction(page: Page, origin: string) {
  await page.context().route('https://ludion.ai/**', async (route) => {
    if (route.request().method() !== 'GET') return route.abort();
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}`, maxRedirects: 0 });
    return route.fulfill({ response });
  });
}

/** 読み込みの後に gtag.js を読むので、load の後に少し待ってから確かめる。 */
const settle = (page: Page) => page.waitForLoadState('load').then(() => page.waitForTimeout(500));

test('手元のビルドを ludion.ai の名前で開いても、gtag.js を読まず、送らない', async ({ page, baseURL, request }) => {
  const { works } = (await (await request.get('/api/works')).json()) as { works: { id: string }[] };
  const seen = await watchGoogle(page);
  await serveAsProduction(page, new URL(baseURL!).origin);

  for (const path of ['/', `/p/${works[0].id}`, '/privacy']) {
    await page.goto(`https://ludion.ai${path}`);
    await settle(page);
    expect(new URL(page.url()).hostname, path).toBe('ludion.ai');
    expect(await page.evaluate(() => typeof window.gtag), path).toBe('undefined');
    expect(await page.evaluate(() => typeof window.dataLayer), path).toBe('undefined');
  }
  expect(seen).toEqual([]);
});

test('テストのビルド（npm run build）に、計測のコードが入っていない', () => {
  const files = (readdirSync(join(webDir, 'dist'), { recursive: true }) as string[]).filter((name) => name.endsWith('.js'));
  expect(files.length).toBeGreaterThan(0);
  const found = files.filter((name) => MARKS.test(readFileSync(join(webDir, 'dist', name), 'utf8')));
  expect(found).toEqual([]);
});

test('印を付けてビルドするのは npm run deploy だけ', () => {
  const { scripts } = JSON.parse(readFileSync(join(webDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  expect(scripts.deploy).toContain('npm run build:deploy');
  expect(scripts['build:deploy']).toContain('vite build --mode deploy');
  const marked = Object.entries(scripts).filter(([, command]) => command.includes('--mode deploy') || command.includes('build:deploy'));
  expect(marked.map(([name]) => name).toSorted()).toEqual(['build:deploy', 'deploy']);
  // 手元の速さの測定もテストも、印のないビルドを使う
  expect(readFileSync(join(webDir, 'playwright.config.ts'), 'utf8')).toContain("command: 'npm run build && ");
  expect(readFileSync(join(webDir, 'scripts/lcp.mjs'), 'utf8')).not.toContain('deploy');
});

test.describe('analytics.ts をビルドの印ごとに作って、動かす', () => {
  /** startAnalytics だけを window.ldAnalytics に出す。 */
  async function buildAnalytics(mode: string): Promise<string> {
    const result = await build({
      root: webDir,
      mode,
      configFile: false,
      logLevel: 'silent',
      build: { write: false, minify: true, lib: { entry: join(webDir, 'src/lib/analytics.ts'), formats: ['iife'], name: 'ldAnalytics' } },
    });
    return (Array.isArray(result) ? result[0] : (result as Rollup.RollupOutput)).output[0].code;
  }

  /** 空のページを host の名前で開いて startAnalytics を呼び、Google への要求を返す。 */
  async function run(page: Page, host: string, code: string) {
    const seen = await watchGoogle(page);
    await page.context().route(`https://${host}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>empty</title>' }));
    await page.goto(`https://${host}/`);
    await page.addScriptTag({ content: code });
    await page.evaluate(() => (window as unknown as { ldAnalytics: { startAnalytics(): void } }).ldAnalytics.startAnalytics());
    await settle(page);
    return { seen, gtag: await page.evaluate(() => typeof window.gtag) };
  }

  test('デプロイの印あり、ludion.ai：gtag.js を読む（測定の ID つき）', async ({ page }) => {
    const code = await buildAnalytics('deploy');
    expect(code).toMatch(MARKS);
    const { seen, gtag } = await run(page, 'ludion.ai', code);
    expect(gtag).toBe('function');
    expect(seen.length).toBe(1);
    expect(seen[0]).toContain('googletagmanager.com/gtag/js?id=G-91CJFHRK88');
  });

  test('デプロイの印あり、workers.dev：名前の確かめで動かない', async ({ page }) => {
    const { seen, gtag } = await run(page, 'ludion-web.ludion.workers.dev', await buildAnalytics('deploy'));
    expect(gtag).toBe('undefined');
    expect(seen).toEqual([]);
  });

  // production は npm run build（テストと npm run lcp）、development は npm run dev の印
  for (const mode of ['production', 'development']) {
    test(`印なし（${mode}）、ludion.ai：計測のコードが入らず、動かない`, async ({ page }) => {
      const code = await buildAnalytics(mode);
      expect(code).not.toMatch(MARKS);
      const { seen, gtag } = await run(page, 'ludion.ai', code);
      expect(gtag).toBe('undefined');
      expect(seen).toEqual([]);
    });
  }
});

// リンクで見せるページ（SHARE001「5」）：/s/ では GA4 を読まない（main.tsx）。2枚目の守りで、送る URL からも合言葉を除く
test('送る URL から、リンクで見せるページの合言葉を除く（/s/ だけを残す）', async () => {
  const { isSharePath, withoutSearchTerm } = await import('../src/lib/analytics');
  const token = 'AbCdEfGhIjKlMnOpQrStUv';
  expect(isSharePath(`/s/${token}`)).toBe(true);
  expect(isSharePath(`/en/s/${token}/code/part.css`)).toBe(true);
  expect(isSharePath('/p/ui-abc123')).toBe(false);
  expect(isSharePath('/search')).toBe(false);
  expect(withoutSearchTerm(`https://ludion.ai/s/${token}`)).toBe('https://ludion.ai/s/');
  expect(withoutSearchTerm(`https://ludion.ai/s/${token}/code/part.css#L4`)).toBe('https://ludion.ai/s/');
  expect(withoutSearchTerm(`https://ludion.ai/en/s/${token}?utm_source=x`)).toBe('https://ludion.ai/en/s/?utm_source=x');
  expect(withoutSearchTerm('https://ludion.ai/p/ui-abc123?q=toggle')).toBe('https://ludion.ai/p/ui-abc123');
});
