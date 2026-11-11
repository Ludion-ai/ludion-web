// DOC001：文書の作品（AI が書いた1つの HTML 文書を、そのまま置いて動かす）の枠が、今の作品の枠と同じ守りであること（SEC001 の形）。
// 外へ通信できない、上のページを動かせない、親に触れない、新しい窓を開けない、フォームを送れない、枠が外へ移れない。
// playwright.config.ts の document-* で、Chromium、WebKit、Firefox の全部で流す。サーバーは pages と同じ（悪意のある見本 mal-doc が入っている）。
// 形：作品のページの枠（/frame/…/desktop.html）、自分だけの作品の枠（/draft-frame/…）、全画面の住所（/frame/…/wall.html）。
import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { PRIVATE_OWNER, privateFixtureId, privateRevisionId } from '../scripts/private-fixture.mjs';

const ID = 'mal-doc';
const SYNTHETIC_INPUT = 'ld-synthetic-input';
/** 親の見張りが「読み込めた」の知らせを待つ時間（src/frameGuard.ts の CONFIRM_WAIT_MS）より長く */
const AFTER_GUARD_MS = 2500;

const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;

const FORMS = [
  { name: 'desktop', pagePath: `/p/${ID}`, framePath: `/frame/${ID}/1/desktop.html` },
  { name: 'private', pagePath: `/p/${privateFixtureId(ID)}`, framePath: `/draft-frame/${privateRevisionId(ID)}/desktop.html` },
  { name: 'wall', pagePath: `/p/${ID}/wall`, framePath: `/frame/${ID}/1/wall.html` },
] as const;
type Form = (typeof FORMS)[number];

/**
 * 自分のサイトのほかへ「届いた」要求を、すべて記録する。新しい窓も記録する。
 * 届いたとは：経路の差し替え（route）まで来た、応答まで終わった、または CSP のほかの理由で失敗した（外へ出てから失敗した）もの。
 * 文書の <img>、<link>、<script src> のように HTML のパーサーが見つけたものは、CSP で止まっても request の知らせが出て、
 * すぐ CSP の理由で失敗する（外へは出ない）。それは数えない。
 */
async function watchOutside(context: BrowserContext): Promise<{ requests: string[]; pages: string[] }> {
  const seen = { requests: [] as string[], pages: [] as string[] };
  const own = ownOrigin();
  const outside = (url: URL) => /^(https?|wss?):$/.test(url.protocol) && url.origin !== own;
  const isOutside = (url: string) => outside(new URL(url));
  context.on('requestfinished', (request) => {
    if (isOutside(request.url())) seen.requests.push(request.url());
  });
  context.on('requestfailed', (request) => {
    if (isOutside(request.url()) && !/csp|content.security|blocked/i.test(request.failure()?.errorText ?? '')) seen.requests.push(`${request.url()} (${request.failure()?.errorText})`);
  });
  context.on('page', (page) => seen.pages.push(page.url()));
  await context.route(outside, (route) => {
    seen.requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>outside</title><script>parent.postMessage('ld-frame-loaded','*')</script>` });
  });
  return seen;
}

async function openWork(page: Page, form: Form) {
  if (form.name === 'private') await page.context().addCookies([{ name: 'ld_session', value: PRIVATE_OWNER.session, url: ownOrigin() }]);
  await page.goto(form.pagePath);
  if (form.name !== 'wall') {
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
  }
  await page.locator('iframe[data-ld-frame]').waitFor({ state: 'attached' });
  await expect(docRoot(page)).toHaveAttribute('data-ready', '1');
}

const workFrame = (page: Page): Frame => page.frames().find((frame) => frame !== page.mainFrame())!;
/** 文書の根の要素。結果は見本が根の data-* に書く。frameLocator の中の html は、経路を差し替えたページで親の html に当たることがあるので、枠の Frame から探す */
const docRoot = (page: Page) => workFrame(page).locator('html');
const frameUrlPath = (page: Page) => new URL(workFrame(page).url(), ownOrigin()).pathname;

for (const form of FORMS) {
  test.describe(`文書の作品の枠の守り（${form.name}）`, () => {
    test('外へ通信できない（fetch、画像、sendBeacon、WebSocket、<script src>、<link>）。本物の cookie は読めない。サイトの API にも届かない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      const site: string[] = [];
      // 親のページ（React）も /api/me を読むので、枠から出たものだけを数える
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/me' && request.frame() !== page.mainFrame()) site.push(request.url());
      });
      await openWork(page, form);
      const html = docRoot(page);
      await page.frameLocator('iframe[data-ld-frame]').locator('#fetch').click();
      await expect(html).toHaveAttribute('data-fetch-done', '1');
      await expect(html).toHaveAttribute('data-fetch', 'blocked');
      await expect(html).toHaveAttribute('data-site-api', 'blocked');
      // 作品が読む document.cookie はメモリだけの代わり（FRAME001）で、空
      await expect(html).toHaveAttribute('data-cookie', '');
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen.requests).toEqual([]);
      expect(site).toEqual([]);
    });

    test('上のページを動かせない。親の DOM に触れない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, form);
      const frame = page.frameLocator('iframe[data-ld-frame]');
      await frame.locator('#top').click();
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(new URL(page.url()).pathname).toBe(form.pagePath);
      await frame.locator('#parent').click();
      await expect(docRoot(page)).toHaveAttribute('data-parent', 'SecurityError');
      expect(await page.locator('body').innerText()).not.toBe('owned');
      expect(seen.requests).toEqual([]);
    });

    test('新しい窓を開けない', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, form);
      const frame = page.frameLocator('iframe[data-ld-frame]');
      await frame.locator('#open').click();
      // allow-popups がないので開かない。Chromium と WebKit は null を返し、Firefox は InvalidAccessError を投げる
      await expect(docRoot(page)).toHaveAttribute('data-open', /^(null|InvalidAccessError)$/);
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen.pages).toEqual([]);
      expect(context.pages()).toHaveLength(1);
      expect(seen.requests).toEqual([]);
    });

    test('フォームを送れない（form-action）。外へのリンクと、自分で移るのは、外へ届かず元の枠に戻る', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await openWork(page, form);
      const frame = page.frameLocator('iframe[data-ld-frame]');
      await frame.locator('#submit').click();
      await page.waitForTimeout(AFTER_GUARD_MS);
      expect(seen.requests).toEqual([]);
      expect(frameUrlPath(page)).toBe(form.framePath);

      for (const target of ['#link', '#nav']) {
        await frame.locator(target).click();
        await page.waitForTimeout(AFTER_GUARD_MS);
        expect(seen.requests, target).toEqual([]);
        expect(new URL(page.url()).pathname).toBe(form.pagePath);
        await expect(frame.locator('#title')).toBeAttached();
        expect(frameUrlPath(page)).toBe(form.framePath);
      }
      expect(seen.requests.filter((url) => url.includes(SYNTHETIC_INPUT))).toEqual([]);
    });

    test('対照：枠の応答の CSP を外すと、外へ届く（見本と見張りが本当に働いている）', async ({ context, page }) => {
      const seen = await watchOutside(context);
      await page.route(`**${form.framePath}`, async (route) => {
        // 取り直しの要求には、ブラウザの Sec-Fetch-Dest が付かない（付けないと作品のページへ戻される）
        const response = await route.fetch({ headers: { ...route.request().headers(), 'sec-fetch-dest': 'iframe' }, maxRedirects: 0 });
        const headers = { ...response.headers() };
        delete headers['content-security-policy'];
        const body = (await response.text()).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
        await route.fulfill({ response, headers, body });
      });
      await openWork(page, form);
      await page.frameLocator('iframe[data-ld-frame]').locator('#fetch').click();
      await expect.poll(() => seen.requests.filter((url) => url.startsWith('https://evil.example/'))).not.toEqual([]);
    });
  });
}

test.describe('文書の作品は、そのまま動く', () => {
  test('文書は書いたとおりに返り、頭にサイトのスクリプトだけが入る。応答の頭は今の作品の枠と同じ。枠は1回だけ読まれ、ふつうの書き方（document、localStorage）で動く', async ({ page, request }) => {
    const frames: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/frame/')) frames.push(new URL(r.url()).pathname);
    });
    await openWork(page, FORMS[0]);
    const frame = page.frameLocator('iframe[data-ld-frame]');
    await frame.locator('#inc').click();
    await frame.locator('#inc').click();
    await expect(frame.locator('#count')).toHaveText('2');
    await expect(docRoot(page)).not.toHaveAttribute('data-storage-error', /.*/);
    await expect(docRoot(page)).toHaveAttribute('lang', 'en');
    expect(await workFrame(page).evaluate(() => document.compatMode)).toBe('CSS1Compat');
    await page.waitForTimeout(AFTER_GUARD_MS);
    expect(frames).toEqual([FORMS[0].framePath]);

    const doc = await request.get(FORMS[0].framePath, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    const part = await request.get('/frame/mal-nav/1/desktop.html', { headers: { 'Sec-Fetch-Dest': 'iframe' } });
    expect(doc.status()).toBe(200);
    for (const name of ['content-security-policy', 'content-type', 'vary', 'cache-control']) expect(doc.headers()[name], name).toBe(part.headers()[name]);
    const body = await doc.text();
    expect(body.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
    // 差し込んだものの後ろは、置いた文書の doctype の後ろと1文字も違わない
    const source = (await (await request.get(`/p/${ID}/code`)).text()).replace(/^<!doctype html>\n<!-- UI by @fixture — ludion\.ai\/p\/mal-doc \(MIT\) -->/, '<!doctype html>');
    expect(body.endsWith(source.slice('<!doctype html>'.length))).toBe(true);
    expect(body).not.toContain('ld-host');
  });

  test('枠の外から開くと、作品を返さずに作品のページへ戻す。持ち主のほかには、自分だけの作品の枠は 404', async ({ request }) => {
    const direct = await request.get(FORMS[0].framePath, { maxRedirects: 0 });
    expect(direct.status()).toBe(302);
    expect(direct.headers().location).toBe(`/p/${ID}`);
    expect((await request.get(FORMS[1].framePath, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).status()).toBe(404);
  });

  test('コピーされるコードは、その文書。クレジット行は doctype の直後', async ({ request }) => {
    const code = await (await request.get(`/p/${ID}/code`)).text();
    expect(code.split('\n').slice(0, 3)).toEqual(['<!doctype html>', '<!-- UI by @fixture — ludion.ai/p/mal-doc (MIT) -->', '<html lang="en">']);
  });
});
