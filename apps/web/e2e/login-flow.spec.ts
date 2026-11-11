// ログインの途中で state が合わないとき（docs/tasks/FIX-login.md）。本物のブラウザと、手元の偽の GitHub と偽の Google で通す。
// 偽の相手は cookie fake_hold で「押すまで待つ画面」を出すので、戻る、2回押す、2つのタブが本物と同じ形で試せる。
// どの道でも、黒い画面に JSON を出さない。2回押しと2つのタブでは、どちらから戻ってもログインできる。CSRF の守りは今までどおり。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { copy } from '../src/copy';
import { copyEn } from '../src/copy.en';
import { inAppBrowser } from '../src/lib/inAppBrowser';
import { pageOverflow } from './helpers';
import { flowCookies, Visitor } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const RETRY_TEXT = copy.login.retry;
const NEXT = '/about';
/** タスクの決まり（直近の state を3つまで）。worker/authFlow.ts の値を読まずに、ここにも書く。 */
const MAX_STATE_FLOWS = 3;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const newLogin = (label: string) => `${label}${randomBytes(4).toString('hex')}`;
const encoded = (path: string) => encodeURIComponent(path);

async function d1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const PROVIDERS = [
  {
    name: 'google',
    prefix: 'ld_google_flow',
    host: `http://localhost:${process.env.LD_TEST_GOOGLE_PORT}`,
    link: 'Google でログイン',
    userCookie: 'fake_google',
    async makePerson(login: string) {
      const visitor = new Visitor();
      await visitor.googleLogin(login);
      expect((await visitor.post('/auth/signup/complete', { handle: login })).status).toBe(200);
    },
  },
  {
    name: 'github',
    prefix: 'ld_github_flow',
    host: `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`,
    link: 'GitHub でログイン',
    userCookie: 'fake_user',
    async makePerson(login: string) {
      expect((await new Visitor().login(login)).status).toBe(302);
    },
  },
] as const;
type Provider = (typeof PROVIDERS)[number];

/** Visitor の側で、その手段のログインを始める。相手の画面へ送られる URL を返す。 */
async function startWith(visitor: Visitor, provider: Provider, query = `?next=${NEXT}`) {
  const response = await visitor.fetch(`/auth/${provider.name}${query}`);
  expect(response.status).toBe(302);
  return new URL(response.headers.get('location')!);
}

/** 相手の画面を通って、戻り先の URL（state と code が付いたもの）をもらう。 */
async function callbackOf(authorize: URL, login: string) {
  const url = new URL(authorize);
  url.searchParams.set('login_as', login);
  return (await fetch(url, { redirect: 'manual' })).headers.get('location')!;
}

/** ログイン済みの人（handle が決まっている）。ブラウザで入ると、そのまま戻り先へ行く。 */
async function holdContext(browser: Browser, provider: Provider, baseURL: string | undefined, login: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL, locale: 'ja-JP' });
  await context.addCookies([
    { name: provider.userCookie, value: login, url: provider.host },
    { name: 'fake_hold', value: '1', url: provider.host },
  ]);
  return context;
}

async function startAt(page: Page, provider: Provider) {
  await page.goto(`/login?next=${encoded(NEXT)}`);
  await page.getByRole('link', { name: provider.link }).click();
  await expect(page.locator('#go')).toBeVisible();
}

const handleIn = (page: Page) => page.evaluate(async () => ((await (await fetch('/api/me')).json()) as { user: { handle: string } | null }).user?.handle ?? null);

async function expectLoggedInAtNext(page: Page, login: string) {
  await expect(page).toHaveURL(NEXT);
  expect(await handleIn(page)).toBe(login);
}

/** 黒い画面の JSON ではなく、ログインの画面に文が出ている。 */
async function expectRetryScreen(page: Page) {
  await expect(page).toHaveURL(/\/login\?(.*&)?error=login_retry/);
  await expect(page.getByRole('heading', { name: copy.login.heading, level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: RETRY_TEXT })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('bad_state');
  expect(await handleIn(page)).toBeNull();
}

/** 別のブラウザで戻ってきた人への画面。アプリの中のブラウザの知らせと同じ文で、ログインにはならない。 */
async function expectOpenBrowserScreen(page: Page) {
  await expect(page).toHaveURL(/\/login\?(.*&)?error=login_open_browser/);
  await expect(page.locator('[data-in-app-notice]')).toContainText(copy.login.inApp.message);
  await expect(page.locator('body')).not.toContainText('bad_state');
  expect(await handleIn(page)).toBeNull();
}

const flowRow = async (token: string) => (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM auth_flows WHERE token_hash = ${quote(createHash('sha256').update(token).digest('hex'))}`))[0].n;

for (const provider of PROVIDERS) {
  test.describe(`${provider.name}：ブラウザの道`, () => {
    let login: string;
    let context: BrowserContext;
    test.beforeEach(async ({ browser, baseURL }) => {
      login = newLogin(provider.name.slice(0, 2));
      await provider.makePerson(login);
      context = await holdContext(browser, provider, baseURL, login);
    });
    test.afterEach(async () => {
      await context.close();
    });

    test('ふつう：相手の画面から戻るとログインできる', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
      expect((await context.cookies()).filter((cookie) => cookie.name.startsWith(provider.prefix))).toEqual([]);
    });

    test('2回押し：ログインのボタンをダブルクリックしてもログインできる', async () => {
      const page = await context.newPage();
      await page.goto(`/login?next=${encoded(NEXT)}`);
      await page.getByRole('link', { name: provider.link }).dblclick();
      await expect(page.locator('#go')).toBeVisible();
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
    });

    test('2回押し：前の要求の答えを受け取っていても、後の画面からログインできる', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      await page.goBack();
      await page.getByRole('link', { name: provider.link }).click();
      await expect(page.locator('#go')).toBeVisible();
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
    });

    test('2つのタブ：前のタブから戻っても、後のタブから戻っても、ログインできる', async () => {
      const [first, second] = [await context.newPage(), await context.newPage()];
      await startAt(first, provider);
      await startAt(second, provider);
      await first.locator('#go').click();
      await expectLoggedInAtNext(first, login);
      await second.locator('#go').click();
      await expectLoggedInAtNext(second, login);
    });

    test('2つのタブ：後のタブから先に戻っても、ログインできる', async () => {
      const [first, second] = [await context.newPage(), await context.newPage()];
      await startAt(first, provider);
      await startAt(second, provider);
      await second.locator('#go').click();
      await expectLoggedInAtNext(second, login);
      await first.locator('#go').click();
      await expectLoggedInAtNext(first, login);
    });

    test('2つのタブ：同時に始めても、互いの状態を消さない', async () => {
      const [first, second] = [await context.newPage(), await context.newPage()];
      await Promise.all([first.goto(`/auth/${provider.name}?next=${encoded(NEXT)}`), second.goto(`/auth/${provider.name}?next=${encoded(NEXT)}`)]);
      await first.locator('#go').click();
      await expectLoggedInAtNext(first, login);
      await second.locator('#go').click();
      await expectLoggedInAtNext(second, login);
    });

    test(`持てるのは直近の${MAX_STATE_FLOWS}つまで：4つ目を始めると、いちばん古いものだけが使えなくなる`, async () => {
      const pages = [await context.newPage(), await context.newPage(), await context.newPage(), await context.newPage()];
      for (const page of pages) await startAt(page, provider);
      expect((await context.cookies()).filter((cookie) => cookie.name.startsWith(`${provider.prefix}_`))).toHaveLength(MAX_STATE_FLOWS);
      await pages[0].locator('#go').click();
      await expectRetryScreen(pages[0]);
      for (const page of pages.slice(1)) {
        await page.locator('#go').click();
        await expectLoggedInAtNext(page, login);
      }
    });

    test('戻る：戻ってきた後に相手の画面へ戻り、もう一度進んでも、JSON にならない', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
      await page.goBack();
      await page.locator('#go').click();
      // 同じ state はもう使えない。ログイン済みなので、ログインの画面が戻り先へ送る
      await expect(page).toHaveURL('/');
      await expect(page.locator('body')).not.toContainText('bad_state');
    });

    test('読み直し：callback の URL を読み直しても、JSON にならない', async () => {
      const page = await context.newPage();
      let callback = '';
      page.on('request', (request) => {
        if (request.url().includes('/callback?')) callback = request.url();
      });
      await startAt(page, provider);
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
      await page.goto(callback);
      await expect(page).toHaveURL('/');
      await expect(page.locator('body')).not.toContainText('bad_state');
    });

    test('外のブラウザで戻る（アプリの中で始めた。cookie がない）：ログインにせず、開き直しの文を出す。行は残る。そのブラウザでやり直すとログインできる', async ({ browser, baseURL }) => {
      const page = await context.newPage();
      await startAt(page, provider);
      const [cookie] = (await context.cookies()).filter((item) => item.name.startsWith(`${provider.prefix}_`));
      const href = await page.locator('#go').getAttribute('href');
      const outside = await holdContext(browser, provider, baseURL, login);
      const other = await outside.newPage();
      await other.goto(href!);
      await expectOpenBrowserScreen(other);
      await expect(other).toHaveURL(`/login?next=${encoded(NEXT)}&error=login_open_browser`);
      // cookie なしで state だけを見てログインさせない。始めたブラウザの状態も消さない
      expect((await outside.cookies()).some((item) => item.name === 'ld_session')).toBe(false);
      expect(await flowRow(cookie.value)).toBe(1);

      await other.getByRole('link', { name: provider.link }).click();
      await other.locator('#go').click();
      await expectLoggedInAtNext(other, login);
      await outside.close();

      // 始めたブラウザからも、まだ戻れる
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
    });

    test('10分を超えた（cookie も行も切れた）：ログインの画面へ戻り、やり直すとログインできる', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      for (const cookie of await context.cookies()) {
        if (cookie.name.startsWith(`${provider.prefix}_`)) {
          await d1(`UPDATE auth_flows SET expires_at = ${Date.now() - 1000} WHERE token_hash = ${quote(createHash('sha256').update(cookie.value).digest('hex'))}`);
          await context.clearCookies({ name: cookie.name });
        }
      }
      await page.locator('#go').click();
      await expectRetryScreen(page);
      await page.getByRole('link', { name: provider.link }).click();
      await page.locator('#go').click();
      await expect(page).toHaveURL('/');
      expect(await handleIn(page)).toBe(login);
    });

    test('10分を超えた（行が切れて cookie は残る）：ログインの画面へ戻り、切れた cookie は片付く', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      const [cookie] = (await context.cookies()).filter((item) => item.name.startsWith(`${provider.prefix}_`));
      const hash = createHash('sha256').update(cookie.value).digest('hex');
      await d1(`UPDATE auth_flows SET expires_at = ${Date.now() - 1000} WHERE token_hash = ${quote(hash)}`);
      await page.locator('#go').click();
      await expectRetryScreen(page);
      expect((await context.cookies()).filter((item) => item.name === cookie.name)).toEqual([]);
    });

    test('相手の画面で2回押す（1回目の答えが届かない）：ログインの画面へ戻り、やり直すとログインできる', async () => {
      const page = await context.newPage();
      await startAt(page, provider);
      // 1回目の callback はサーバーに届いて状態を消すが、2回目に押したのでブラウザは答えを受け取らない
      const visitor = new Visitor();
      for (const cookie of await context.cookies()) {
        if (cookie.name.startsWith(`${provider.prefix}_`)) visitor.cookies.set(cookie.name, cookie.value);
      }
      const href = await page.locator('#go').getAttribute('href');
      expect((await visitor.fetch((await fetch(href!, { redirect: 'manual' })).headers.get('location')!)).status).toBe(302);
      await page.locator('#go').click();
      await expectRetryScreen(page);
      await page.getByRole('link', { name: provider.link }).click();
      await page.locator('#go').click();
      await expect(page).toHaveURL('/');
      expect(await handleIn(page)).toBe(login);
    });
  });

  test.describe(`${provider.name}：CSRF の守りと1回だけの決まり`, () => {
    test('他人の state では通らない。自分の状態は残る', async () => {
      const [me, attacker] = [new Visitor(), new Visitor()];
      const login = newLogin('me');
      const attackerLogin = newLogin('at');
      const mine = await startWith(me, provider);
      // 相手が自分のログインで得た state と code を、自分のブラウザで開かせる
      const planted = await callbackOf(await startWith(attacker, provider), attackerLogin);
      const response = await me.fetch(planted);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(`/login?next=${encoded(NEXT)}&error=login_open_browser`);
      expect(me.cookies.has('ld_session')).toBe(false);
      expect(me.cookies.has('ld_signup')).toBe(false);
      expect(flowCookies(me.cookies, provider.prefix)).toHaveLength(1);

      const done = await me.fetch(await callbackOf(mine, login));
      expect(done.status).toBe(302);
      expect(done.headers.get('location')).not.toContain('error=');
    });

    test('state がなくても、空でも、通らない', async () => {
      for (const query of ['?code=abc', '?state=&code=abc']) {
        const visitor = new Visitor();
        await startWith(visitor, provider);
        const response = await visitor.fetch(`/auth/${provider.name}/callback${query}`);
        expect(response.headers.get('location'), query).toBe(`/login?next=${encoded(NEXT)}&error=login_retry`);
        expect(visitor.cookies.has('ld_session'), query).toBe(false);
      }
    });

    test('同じ state は1回だけ。使ったものだけが消え、ほかの状態は残る', async () => {
      const visitor = new Visitor();
      const login = newLogin('on');
      const [first, second] = [await startWith(visitor, provider), await startWith(visitor, provider)];
      expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
      expect(flowCookies(visitor.cookies, provider.prefix)).toHaveLength(2);

      const back = await callbackOf(first, login);
      expect((await visitor.fetch(back)).headers.get('location')).not.toContain('error=');
      const left = flowCookies(visitor.cookies, provider.prefix);
      expect(left).toHaveLength(1);

      // 同じ戻り先をもう一度。state はもう使えない
      const replay = new Visitor();
      replay.cookies = new Map(left);
      expect((await replay.fetch(back)).headers.get('location')).toBe(`/login?next=${encoded(NEXT)}&error=login_retry`);
      expect(replay.cookies.has('ld_session')).toBe(false);
      expect(await flowRow(left[0][1])).toBe(1);
    });

    test('state は256ビット。cookie には乱数だけで、state は入らない', async () => {
      const visitor = new Visitor();
      const authorize = await startWith(visitor, provider);
      const state = authorize.searchParams.get('state')!;
      expect(state).toMatch(/^[0-9a-f]{64}$/);
      const line = visitor.lastSetCookie.find((item) => item.startsWith(`${provider.prefix}_`))!;
      expect(line).toMatch(/;\s*Max-Age=600(;|$)/i);
      expect(line).toMatch(/;\s*HttpOnly(;|$)/i);
      expect(line).toMatch(/;\s*Secure(;|$)/i);
      expect(line).toMatch(/;\s*SameSite=Lax(;|$)/i);
      expect(line).toMatch(new RegExp(`;\\s*Path=/auth/${provider.name}(;|$)`, 'i'));
      expect(line).not.toContain(state);
    });

    test('形の違う cookie は数えない', async () => {
      const visitor = new Visitor();
      visitor.cookies.set(`${provider.prefix}_x`, 'not-a-token');
      const response = await visitor.fetch(`/auth/${provider.name}/callback?state=abc&code=abc`);
      expect(response.headers.get('location')).toBe('/login?error=login_retry');
    });

    test('外の URL の next は使わない', async () => {
      const visitor = new Visitor();
      await startWith(visitor, provider, `?next=${encoded('https://evil.example')}`);
      const response = await visitor.fetch(`/auth/${provider.name}/callback?state=wrong&code=abc`);
      expect(response.headers.get('location')).toBe(`/login?next=${encoded('/')}&error=login_retry`);
    });

    test('戻り先の言語のログインの画面へ戻す', async () => {
      const visitor = new Visitor();
      await startWith(visitor, provider, `?next=${encoded('/en/about')}`);
      const response = await visitor.fetch(`/auth/${provider.name}/callback?state=wrong&code=abc`);
      expect(response.headers.get('location')).toBe(`/en/login?next=${encoded('/en/about')}&error=login_retry`);
    });

    test('D1 の行が壊れていても、JSON ではなくログインの画面へ', async () => {
      const token = randomBytes(32).toString('hex');
      const hash = createHash('sha256').update(token).digest('hex');
      await d1(`INSERT INTO auth_flows (token_hash, kind, data, expires_at) VALUES (${quote(hash)}, ${quote(provider.name)}, 'not-json', ${Date.now() + 60_000})`);
      const visitor = new Visitor();
      visitor.cookies.set(`${provider.prefix}_x`, token);
      const response = await visitor.fetch(`/auth/${provider.name}/callback?state=abc&code=abc`);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('/login?error=login_failed');
      await d1(`DELETE FROM auth_flows WHERE token_hash = ${quote(hash)}`);
    });
  });
}

const X_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/11.0';

test.describe('アプリの中のブラウザ', () => {
  const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
  const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36';
  for (const [name, userAgent, expected] of [
    ['X（iPhone、名前あり）', X_IPHONE, 'iphone'],
    ['X（iPhone、名前なしの WebView）', `${IOS} Mobile/15E148`, 'iphone'],
    ['X（Android）', `${ANDROID_WV} TwitterAndroid`, 'other'],
    ['Instagram（iPhone）', `${IOS} Mobile/15E148 Instagram 350.0.0 (iPhone16,1; iOS 18_5)`, 'iphone'],
    ['Facebook（iPhone）', `${IOS} Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]`, 'iphone'],
    ['Facebook（Android）', `${ANDROID_WV} [FB_IAB/FB4A;FBAV/480.0]`, 'other'],
    ['LINE（iPhone）', `${IOS} Mobile/15E148 Safari Line/14.0.0`, 'iphone'],
    ['TikTok（iPhone）', `${IOS} Mobile/15E148 musical_ly_36.0 BytedanceWebview/d8a21c6`, 'iphone'],
    ['TikTok（Android）', `${ANDROID_WV} trill_360`, 'other'],
    ['ほかの Android の WebView', ANDROID_WV, 'other'],
    ['iPad の WebView', 'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'other'],
    ['Safari（iPhone）', `${IOS} Version/18.5 Mobile/15E148 Safari/604.1`, null],
    ['Chrome（iPhone）', `${IOS} CriOS/130.0.0.0 Mobile/15E148 Safari/604.1`, null],
    ['Chrome（Android）', `${ANDROID} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36`, null],
    ['Safari（Mac）', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', null],
    ['Chrome（Windows）', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', null],
    ['Twitterbot', 'Twitterbot/1.0', null],
    ['オンライン（Line/ の字を含まない）', 'Mozilla/5.0 Mainline Browser/1.0', null],
  ] as const) {
    test(`見分ける：${name}`, () => {
      expect(inAppBrowser(userAgent)).toBe(expected);
    });
  }

  test('iPhone の X：Google のボタンの上に知らせと「右上の …」の一言。React の描画がずれない。リンクをコピーできる。戻り先が残る', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'ja-JP', userAgent: X_IPHONE, viewport: { width: 390, height: 664 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`/login?next=${encoded(NEXT)}&error=login_retry`);
    const notice = page.locator('[data-in-app-notice]');
    await expect(notice).toContainText(copy.login.inApp.message);
    await expect(notice).toContainText(copy.login.inApp.iPhone);
    const google = page.getByRole('link', { name: 'Google でログイン' });
    expect((await notice.boundingBox())!.y + (await notice.boundingBox())!.height).toBeLessThanOrEqual((await google.boundingBox())!.y);
    expect((await notice.getByRole('button', { name: copy.login.inApp.copyLink }).boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await notice.getByRole('button', { name: copy.login.inApp.copyLink }).click();
    await expect(notice.getByRole('button', { name: copy.login.inApp.copied })).toBeVisible();
    // エラーの名前は残さない
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(baseURL!).origin}/login?next=${encoded(NEXT)}`);
    expect(errors).toEqual([]);
    expect(await pageOverflow(page)).toBe(0);
    const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
    expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious').map((item) => item.id)).toEqual([]);
    await context.close();
  });

  test('コピーを断られたら、リンクを見せる', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'ja-JP', userAgent: X_IPHONE });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
    });
    const page = await context.newPage();
    await page.goto(`/login?next=${encoded(NEXT)}`);
    const notice = page.locator('[data-in-app-notice]');
    await notice.getByRole('button', { name: copy.login.inApp.copyLink }).click();
    await expect(notice.getByRole('status')).toContainText(copy.login.inApp.copyFailed);
    await expect(notice.locator('code')).toHaveText(`${new URL(baseURL!).origin}/login?next=${encoded(NEXT)}`);
    await context.close();
  });

  test('Android の WebView：知らせは出すが、「右上の …」の一言は出さない。英語のページは英語で', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, locale: 'en-US', userAgent: ANDROID_WV });
    const page = await context.newPage();
    await page.goto(`/en/login?next=${encoded('/en/about')}`);
    const notice = page.locator('[data-in-app-notice]');
    await expect(notice).toContainText(copyEn.login.inApp.message);
    await expect(notice).not.toContainText(copyEn.login.inApp.iPhone);
    await expect(notice.getByRole('button', { name: copyEn.login.inApp.copyLink })).toBeVisible();
    await context.close();
  });

  test('ふつうのブラウザには知らせを出さない。別のブラウザで戻ったときだけ同じ文を出す', async ({ page }) => {
    await page.goto(`/login?next=${encoded(NEXT)}`);
    await expect(page.getByRole('link', { name: 'Google でログイン' })).toBeVisible();
    await expect(page.locator('[data-in-app-notice]')).toHaveCount(0);
    await page.goto(`/login?next=${encoded(NEXT)}&error=login_open_browser`);
    const notice = page.locator('[data-in-app-notice]');
    await expect(notice).toContainText(copy.login.inApp.message);
    await expect(notice).not.toContainText(copy.login.inApp.iPhone);
    await expect(page.getByRole('status').filter({ hasText: copy.login.inApp.message })).toHaveCount(0);
  });

  test('X の UA でも、同じブラウザの中なら GitHub と Google は通る。HTML は UA で変わらない', async ({ browser, baseURL }) => {
    for (const provider of PROVIDERS) {
      const login = newLogin(provider.name.slice(0, 2));
      await provider.makePerson(login);
      const context = await browser.newContext({ baseURL, locale: 'ja-JP', userAgent: X_IPHONE });
      await context.addCookies([
        { name: provider.userCookie, value: login, url: provider.host },
        { name: 'fake_hold', value: '1', url: provider.host },
      ]);
      const page = await context.newPage();
      await startAt(page, provider);
      await page.locator('#go').click();
      await expectLoggedInAtNext(page, login);
      await context.close();
    }
    const plain = await (await new Visitor().fetch('/login')).text();
    const fromX = await (await new Visitor().fetch('/login', { headers: { 'User-Agent': X_IPHONE } })).text();
    expect(fromX).toBe(plain);
  });
});

test.describe('ログインの画面の文', () => {
  for (const [error, ja, en] of [
    ['login_retry', copy.login.retry, copyEn.login.retry],
    ['login_failed', copy.login.failed, copyEn.login.failed],
    ['login_limited', copy.login.limited, copyEn.login.limited],
    ['signup_limited', copy.login.signupLimited, copyEn.login.signupLimited],
  ]) {
    test(`${error}：日本語と英語で文が出る。React の描画がずれない`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
      });
      await page.goto(`/login?next=${encoded(NEXT)}&error=${error}`);
      await expect(page.getByRole('status').filter({ hasText: ja })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Google でログイン' })).toHaveAttribute('href', `/auth/google?next=${encoded(NEXT)}`);

      await page.goto(`/en/login?next=${encoded('/en/about')}&error=${error}`);
      await expect(page.getByRole('status').filter({ hasText: en })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test('知らない名前には何も出さない', async ({ page }) => {
    await page.goto(`/login?error=${encoded('<img src=x onerror=alert(1)>')}`);
    await expect(page.getByRole('heading', { name: copy.login.heading, level: 1 })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('');
    await page.goto('/login?error=constructor');
    await expect(page.getByRole('status')).toHaveText('');
  });

  for (const width of [390, 1440]) {
    test(`幅${width}：axe の critical と serious が0。横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/login?next=${encoded(NEXT)}&error=login_retry`);
      await expect(page.getByRole('status').filter({ hasText: RETRY_TEXT })).toBeVisible();
      const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
      expect(results.violations.filter((item) => item.impact === 'critical' || item.impact === 'serious').map((item) => item.id)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('確かめ直しの途中で失敗したら、元の画面に文が出る', async ({ browser, baseURL }) => {
    const login = newLogin('re');
    await new Visitor().login(login);
    const context = await holdContext(browser, PROVIDERS[1], baseURL, login);
    const page = await context.newPage();
    await page.goto(`/auth/github?next=${encoded('/account')}`);
    await page.locator('#go').click();
    await expect(page).toHaveURL('/account');
    await page.goto(`/account?error=login_failed`);
    await expect(page.getByRole('alert').filter({ hasText: copy.account.methods.errors.login_failed })).toBeVisible();
    await context.close();
  });
});
