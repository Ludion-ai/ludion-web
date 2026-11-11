// Google のログイン（docs/tasks/T020.md「6」）。手元の偽の Google（scripts/fake-google.mjs）で通す。
// 1つのテストごとに別の人でログインするので、互いの行に触らない。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isGoogleAvailable, isPasskeyAvailable } from '../worker/methods';
import { pageOverflow } from './helpers';
import { flowCookies, ownOrigin, Visitor } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GOOGLE = `http://localhost:${process.env.LD_TEST_GOOGLE_PORT}`;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const TEN_MINUTES = 10 * 60 * 1000;
const RETRY = '/login?error=login_retry';
const FAILED = `/login?next=${encodeURIComponent('/')}&error=login_failed`;
/** いちばん新しいログインの途中の cookie。 */
const flowCookie = (visitor: Visitor) => flowCookies(visitor.cookies, 'ld_google_flow').at(-1)!;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const newLogin = (label: string) => `${label}${randomBytes(4).toString('hex')}`;
/** 偽の Google の番号（scripts/fake-google.mjs と同じ決め方）。 */
const subjectOf = (login: string) => `google-${createHash('sha256').update(login).digest('hex').slice(0, 21)}`;

async function d1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const googleUser = async (login: string) => (await d1<{ user_id: string }>(`SELECT user_id FROM identities WHERE provider = 'google' AND subject = ${quote(subjectOf(login))}`))[0]?.user_id;
const githubUser = async (login: string) => (await d1<{ user_id: string }>(`SELECT user_id FROM identities WHERE provider = 'github' AND label = ${quote(login)}`))[0]?.user_id;
const ageSessions = (id: string) => d1(`UPDATE sessions SET auth_at = auth_at - ${TEN_MINUTES + 1000} WHERE user_id = ${quote(id)}`);
const countSessions = async (id: string) => (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM sessions WHERE user_id = ${quote(id)}`))[0].n;

/** Google で新しい人を作って、ログインした訪問者を返す。 */
async function signedUp(login = newLogin('gperson'), handle = login) {
  const visitor = new Visitor();
  const response = await visitor.googleLogin(login);
  expect(response.headers.get('location')).toBe('/signup');
  const done = await visitor.post('/auth/signup/complete', { handle });
  expect(done.status).toBe(200);
  return { visitor, login, handle };
}

async function githubLoggedIn(login = newLogin('ghperson')) {
  const visitor = new Visitor();
  expect((await visitor.login(login)).status).toBe(302);
  return visitor;
}

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}：${v.nodes[0]?.target}`);
}

test.describe('GET /auth/google', () => {
  test('Google の画面へ送る。スコープは openid と profile だけ。PKCE、state、nonce がある', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle('?next=/p/abc');
    expect(authorize.origin + authorize.pathname).toBe(`${FAKE_GOOGLE}/o/oauth2/v2/auth`);
    const query = authorize.searchParams;
    expect(query.get('client_id')).toBe('fake-google-client-id');
    expect(query.get('redirect_uri')).toBe(`${ownOrigin()}/auth/google/callback`);
    expect(query.get('response_type')).toBe('code');
    expect(query.get('scope')).toBe('openid profile');
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(query.get('state')).toMatch(/^[0-9a-f]{64}$/);
    expect(query.get('nonce')).toMatch(/^[0-9a-f]{64}$/);
    expect(query.get('state')).not.toBe(query.get('nonce'));
    // 秘密の値と verifier は URL に出ない
    expect(authorize.href).not.toContain('fake-google-client-secret');
    expect(query.has('code_verifier')).toBe(false);
  });

  test('途中の状態：cookie は乱数だけで、短い寿命の HttpOnly。D1 にはそのハッシュ', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle('?next=/saved-next');
    const line = visitor.lastSetCookie.find((item) => item.startsWith('ld_google_flow_'))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\/auth\/google/i);
    expect(line).toMatch(/Max-Age=600/i);
    const [, token] = flowCookie(visitor);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(line).not.toContain(authorize.searchParams.get('state')!);
    const hash = createHash('sha256').update(token).digest('hex');
    const rows = await d1<{ kind: string; data: string; expires_at: number }>(`SELECT kind, data, expires_at FROM auth_flows WHERE token_hash = ${quote(hash)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('google');
    expect(JSON.parse(rows[0].data).state).toBe(authorize.searchParams.get('state'));
    expect(rows[0].expires_at - Date.now()).toBeLessThanOrEqual(TEN_MINUTES);
    expect(await d1(`SELECT COUNT(*) AS n FROM auth_flows WHERE token_hash = ${quote(token)}`)).toEqual([{ n: 0 }]);
  });

  test('外への next は使わない', async () => {
    const login = newLogin('gnext');
    const visitor = new Visitor();
    await visitor.googleLogin(login, { query: `?next=${encodeURIComponent('https://evil.example')}` });
    const done = await visitor.post('/auth/signup/complete', { handle: login });
    expect(await done.json()).toEqual({ next: '/' });
  });

  test('使えるかの判定：値がない、workers.dev では使わない', () => {
    const both = { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' };
    expect(isGoogleAvailable(both, 'https://ludion.ai/login')).toBe(true);
    expect(isGoogleAvailable(both, 'http://localhost:5173/login')).toBe(true);
    expect(isGoogleAvailable(both, 'https://ludion-web.ludion.workers.dev/login')).toBe(false);
    expect(isGoogleAvailable({ GOOGLE_CLIENT_ID: 'id' }, 'https://ludion.ai/login')).toBe(false);
    expect(isGoogleAvailable({}, 'https://ludion.ai/login')).toBe(false);
  });
});

test.describe('パスキーを使えない origin', () => {
  test('判定：決めた origin だけ。workers.dev では使わない', () => {
    const env = { PASSKEY_ORIGIN: 'https://ludion.ai' };
    expect(isPasskeyAvailable(env, 'https://ludion.ai/login')).toBe(true);
    expect(isPasskeyAvailable(env, 'https://ludion-web.ludion.workers.dev/login')).toBe(false);
    expect(isPasskeyAvailable(env, 'http://ludion.ai/login')).toBe(false);
    expect(isPasskeyAvailable(env, 'https://evil.ludion.ai/login')).toBe(false);
    expect(isPasskeyAvailable({}, 'https://ludion.ai/login')).toBe(false);
  });

  test('ボタンを出さず、API も断る（このサーバーは 127.0.0.1 で、決めた origin と違う）', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'GitHub でログイン' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'パスキーでログイン' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'パスキーでアカウントを作る' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '回復のコードで入る' })).toHaveCount(0);
    for (const path of ['/auth/passkey/login/options', '/auth/passkey/register/options', '/auth/passkey/recovery']) {
      expect((await new Visitor().post(path, {})).status, path).toBe(404);
    }
    const visitor = await githubLoggedIn();
    expect((await visitor.account()).available.passkey).toBe(false);
  });
});

test.describe('GET /auth/google/callback', () => {
  test('cookie がないと、ログインの画面へ戻す', async () => {
    const visitor = new Visitor();
    const response = await visitor.fetch('/auth/google/callback?state=abc&code=abc');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(RETRY);
    expect(visitor.cookies.has('ld_session')).toBe(false);
  });

  test('state が違うと、ログインの画面へ戻す。ログインにならない。使っていない状態は残り、合う state では通る', async () => {
    const login = newLogin('gwrong');
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle('?next=/p/abc');
    const response = await visitor.fetch('/auth/google/callback?state=wrong&code=abc');
    expect(response.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/p/abc')}&error=login_retry`);
    expect(visitor.cookies.has('ld_session')).toBe(false);
    expect(flowCookies(visitor.cookies, 'ld_google_flow')).toHaveLength(1);

    authorize.searchParams.set('login_as', login);
    const back = await fetch(authorize, { redirect: 'manual' });
    expect((await visitor.fetch(back.headers.get('location')!)).headers.get('location')).toBe('/signup');
  });

  test('同じ callback は2回使えない', async () => {
    const login = newLogin('gtwice');
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle();
    authorize.searchParams.set('login_as', login);
    const [name, cookie] = flowCookie(visitor);
    const back = (await fetch(authorize, { redirect: 'manual' })).headers.get('location')!;
    expect((await visitor.fetch(back)).headers.get('location')).toBe('/signup');
    expect(visitor.cookies.has(name)).toBe(false);
    visitor.cookies.set(name, cookie);
    expect((await visitor.fetch(back)).headers.get('location')).toBe(RETRY);
  });

  test('切れた途中の状態は使えない', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle();
    const hash = createHash('sha256').update(flowCookie(visitor)[1]).digest('hex');
    await d1(`UPDATE auth_flows SET expires_at = ${Date.now() - 1000} WHERE token_hash = ${quote(hash)}`);
    expect((await visitor.fetch(`/auth/google/callback?state=${authorize.searchParams.get('state')}&code=abc`)).headers.get('location')).toBe(RETRY);
    // 切れた cookie も片付く
    expect(flowCookies(visitor.cookies, 'ld_google_flow')).toHaveLength(0);
  });

  test('code がないとき、Google が code を断ったときは、ログインの画面へ戻す。セッションはできない', async () => {
    const first = new Visitor();
    const authorize = await first.startGoogle();
    expect((await first.fetch(`/auth/google/callback?state=${authorize.searchParams.get('state')}`)).headers.get('location')).toBe(FAILED);

    const second = new Visitor();
    const again = await second.startGoogle();
    const response = await second.fetch(`/auth/google/callback?state=${again.searchParams.get('state')}&code=wrong`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(FAILED);
    expect(second.cookies.has('ld_session')).toBe(false);
  });

  test('Google の画面で断ると、ログインせずにホームへ戻る', async () => {
    const visitor = new Visitor();
    const authorize = await visitor.startGoogle('?next=/p/abc');
    authorize.searchParams.set('deny', '1');
    const back = await fetch(authorize, { redirect: 'manual' });
    const response = await visitor.fetch(back.headers.get('location')!);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');
    expect(visitor.cookies.has('ld_session')).toBe(false);
  });

  for (const tamper of ['wrong_aud', 'wrong_iss', 'expired', 'wrong_nonce', 'bad_sig', 'alg_none', 'no_sub', 'wrong_azp']) {
    test(`ID トークンを断る：${tamper}`, async () => {
      const login = newLogin(tamper.replace('_', ''));
      const visitor = new Visitor();
      const response = await visitor.googleLogin(login, { tamper });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(FAILED);
      expect(visitor.cookies.has('ld_session')).toBe(false);
      expect(visitor.cookies.has('ld_signup')).toBe(false);
      expect(await googleUser(login)).toBeUndefined();
    });
  }

  test('応答はキャッシュさせない', async () => {
    const visitor = new Visitor();
    const response = await visitor.googleLogin(newLogin('gcache'));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

test.describe('新しい人', () => {
  test('handle を選ぶまで人を作らない。戻り先の言語の画面へ', async () => {
    const login = newLogin('gnew');
    const visitor = new Visitor();
    const response = await visitor.googleLogin(login);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signup');
    expect(visitor.cookies.has('ld_session')).toBe(false);
    expect(await googleUser(login)).toBeUndefined();

    const english = new Visitor();
    const moved = await english.googleLogin(newLogin('genglish'), { query: `?next=${encodeURIComponent('/en/p/abc')}` });
    expect(moved.headers.get('location')).toBe('/en/signup');
  });

  test('候補は Google の名前から作る。日本語の名前には乱数の候補を出す', async () => {
    const visitor = new Visitor();
    const unique = `Taro Yamada ${randomBytes(2).toString('hex')}`;
    await visitor.googleLogin(newLogin('gsuggest'), { name: unique });
    const body = await (await visitor.fetch('/auth/signup/pending')).json();
    expect(body.provider).toBe('google');
    expect(body.name).toBe(unique);
    expect(body.suggestions[0]).toBe(unique.toLowerCase().replace(/ /g, '_'));
    expect(body.suggestions.length).toBeGreaterThan(1);
    for (const suggestion of body.suggestions) expect(suggestion).toMatch(/^[a-z0-9_]{3,20}$/);

    const japanese = new Visitor();
    await japanese.googleLogin(newLogin('gjapanese'), { name: '山田 太郎' });
    const named = await (await japanese.fetch('/auth/signup/pending')).json();
    expect(named.name).toBe('山田 太郎');
    expect(named.suggestions).toHaveLength(1);
    expect(named.suggestions[0]).toMatch(/^user_[0-9a-f]{6}$/);
  });

  test('候補には、取れないものを出さない', async () => {
    const taken = newLogin('gtaken');
    await githubLoggedIn(taken);
    const visitor = new Visitor();
    await visitor.googleLogin(newLogin('gfree'), { name: taken });
    const { suggestions } = await (await visitor.fetch('/auth/signup/pending')).json();
    expect(suggestions).not.toContain(taken);
    const reserved = new Visitor();
    await reserved.googleLogin(newLogin('gadmin'), { name: 'admin' });
    expect((await (await reserved.fetch('/auth/signup/pending')).json()).suggestions).not.toContain('admin');
  });

  test('handle の決まり：形、取れない言葉、他人の、作者の。だめなときは途中の状態が残って、やり直せる', async () => {
    const other = newLogin('gother');
    await githubLoggedIn(other);
    const login = newLogin('grules');
    const visitor = new Visitor();
    await visitor.googleLogin(login);
    for (const [handle, status] of [
      ['ab', 'format'],
      ['has-hyphen', 'format'],
      ['admin', 'reserved'],
      ['the_ludion', 'reserved'],
      ['seed_a', 'reserved'],
      ['SEED_A', 'reserved'],
      [other, 'taken'],
      [other.toUpperCase(), 'taken'],
    ]) {
      const response = await visitor.post('/auth/signup/complete', { handle });
      expect(response.status, handle).toBe(400);
      expect(await response.json(), handle).toEqual({ error: 'handle_rejected', status });
    }
    expect(visitor.cookies.has('ld_session')).toBe(false);
    expect((await visitor.post('/auth/signup/complete', { handle: login.toUpperCase() })).status).toBe(200);
    expect((await visitor.me()).user.handle).toBe(login);
  });

  test('作ると、持つのは sub、名前、アバターの URL だけ。メールは持たない', async () => {
    const login = newLogin('gstore');
    const visitor = new Visitor();
    await visitor.googleLogin(login, { query: `?next=${encodeURIComponent('/p/seed-trail-guide')}` });
    const done = await visitor.post('/auth/signup/complete', { handle: login });
    expect(await done.json()).toEqual({ next: '/p/seed-trail-guide' });
    expect(visitor.cookies.has('ld_session')).toBe(true);
    expect(visitor.cookies.has('ld_signup')).toBe(false);

    const me = await visitor.me();
    expect(me.user).toEqual({ handle: login, display_name: `Name of ${login}`, avatar_url: `${FAKE_GOOGLE}/avatars/${login}.svg` });
    const id = await googleUser(login);
    expect(await d1(`SELECT provider, subject, label, avatar_url FROM identities WHERE user_id = ${quote(id)}`)).toEqual([
      { provider: 'google', subject: subjectOf(login), label: `Name of ${login}`, avatar_url: `${FAKE_GOOGLE}/avatars/${login}.svg` },
    ]);

    // D1 のファイルのどこにも、メールとトークンがない
    const dir = join(PERSIST, 'v3/d1');
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    const dump = Buffer.concat(files.map((entry) => readFileSync(join(entry.parentPath, entry.name)))).toString('latin1');
    expect(dump).toContain(subjectOf(login));
    expect(dump).not.toContain(`${login}@private.example`);
    expect(dump).not.toContain('ya29.fake_');
  });

  test('途中の状態は1回だけ。2回目は 404。作った後の pending も 404', async () => {
    const login = newLogin('gonce');
    const visitor = new Visitor();
    await visitor.googleLogin(login);
    const cookie = visitor.cookies.get('ld_signup')!;
    expect((await visitor.post('/auth/signup/complete', { handle: login })).status).toBe(200);
    visitor.cookies.set('ld_signup', cookie);
    expect((await visitor.post('/auth/signup/complete', { handle: `${login}x` })).status).toBe(404);
    expect((await visitor.fetch('/auth/signup/pending')).status).toBe(404);
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE subject = ${quote(subjectOf(login))}`)).toEqual([{ n: 1 }]);
  });

  test('同じ Google で同時に作っても、人は1人', async () => {
    const login = newLogin('grace');
    const first = new Visitor();
    await first.googleLogin(login);
    const second = new Visitor();
    await second.googleLogin(login);
    const [a, b] = await Promise.all([first.post('/auth/signup/complete', { handle: `${login}a` }), second.post('/auth/signup/complete', { handle: `${login}b` })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE subject = ${quote(subjectOf(login))}`)).toEqual([{ n: 1 }]);
    const handles = await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE handle IN (${quote(`${login}a`)}, ${quote(`${login}b`)})`);
    expect(handles).toEqual([{ n: 1 }]);
    expect((await first.me()).user.handle).toBe((await second.me()).user.handle);
  });

  test('外の Origin からは作れない。途中の状態がなければ 404。切れていても 404', async () => {
    const login = newLogin('gorigin');
    const visitor = new Visitor();
    await visitor.googleLogin(login);
    for (const origin of ['https://evil.example', null, 'null']) {
      expect((await visitor.post('/auth/signup/complete', { handle: login }, origin)).status, String(origin)).toBe(403);
    }
    expect(await googleUser(login)).toBeUndefined();
    expect((await new Visitor().post('/auth/signup/complete', { handle: login })).status).toBe(404);
    const hash = createHash('sha256').update(visitor.cookies.get('ld_signup')!).digest('hex');
    await d1(`UPDATE auth_flows SET expires_at = ${Date.now() - 1000} WHERE token_hash = ${quote(hash)}`);
    expect((await visitor.post('/auth/signup/complete', { handle: login })).status).toBe(404);
    expect((await visitor.fetch('/auth/signup/pending')).status).toBe(404);
  });

  test('ログインしていない人の handle の確かめ', async () => {
    const other = newLogin('gcheck');
    await githubLoggedIn(other);
    const status = async (handle: string) => (await (await new Visitor().fetch(`/api/signup/handle-check?handle=${handle}`)).json()).status;
    expect(await status('ab')).toBe('format');
    expect(await status('admin')).toBe('reserved');
    expect(await status(other)).toBe('taken');
    expect(await status(newLogin('gfresh'))).toBe('ok');
  });

  test('切れた行は、作るときに少しずつ消える', async () => {
    const values = Array.from({ length: 60 }, (_, index) => `('expired-${randomBytes(4).toString('hex')}-${index}', 'google', '{}', 1)`).join(', ');
    await d1(`INSERT INTO auth_flows (token_hash, kind, data, expires_at) VALUES ${values}`);
    const before = (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM auth_flows WHERE expires_at <= 1`))[0].n;
    await new Visitor().startGoogle();
    const after = (await d1<{ n: number }>(`SELECT COUNT(*) AS n FROM auth_flows WHERE expires_at <= 1`))[0].n;
    expect(before - after).toBe(50);
    await d1(`DELETE FROM auth_flows WHERE expires_at <= 1`);
  });
});

test.describe('知っている人', () => {
  test('2回目はそのままログインする。手段の情報だけを新しくし、表示の名前は上書きしない', async () => {
    const { visitor, login } = await signedUp();
    const id = await googleUser(login);
    expect((await visitor.post('/api/account/profile', { display_name: '自分で付けた名前' })).status).toBe(200);

    const second = new Visitor();
    const response = await second.googleLogin(login, { query: `?next=${encodeURIComponent('/p/abc')}`, name: 'Changed Google Name' });
    expect(response.headers.get('location')).toBe('/p/abc');
    expect((await second.me()).user.display_name).toBe('自分で付けた名前');
    expect(await googleUser(login)).toBe(id);
    expect(await d1(`SELECT label FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ label: 'Changed Google Name' }]);
    // 別の端末のセッションは残る
    expect(await countSessions(id)).toBe(2);
  });

  test('名前や login が同じでも、GitHub と Google を同じ人にしない', async () => {
    const login = newLogin('gsame');
    const github = await githubLoggedIn(login);
    const google = new Visitor();
    const response = await google.googleLogin(login, { name: `Name of ${login}` });
    // 同じ名前でも、知らない Google の人として handle を選ぶ画面へ
    expect(response.headers.get('location')).toBe('/signup');
    const { suggestions } = await (await google.fetch('/auth/signup/pending')).json();
    expect(suggestions).not.toContain(login);
    expect((await google.post('/auth/signup/complete', { handle: `${login}g` })).status).toBe(200);
    expect(await googleUser(login)).not.toBe(await githubUser(login));
    expect((await github.me()).user.handle).toBe(login);
  });
});

test.describe('手段を足す', () => {
  test('直近10分以内のログインがなければ、Google の画面へ行かずに断る', async () => {
    const login = newLogin('glinkstale');
    const visitor = await githubLoggedIn(login);
    await ageSessions(await githubUser(login));
    const response = await visitor.fetch('/auth/google?intent=link&next=/account');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/account?error=reauth_required');
    const github = await visitor.fetch('/auth/github?intent=link&next=/account');
    expect(github.headers.get('location')).toBe('/account?error=reauth_required');
  });

  test('ログインしていなければ断る', async () => {
    const response = await new Visitor().fetch('/auth/google?intent=link&next=/account');
    expect(response.headers.get('location')).toBe('/account?error=reauth_required');
  });

  test('Google を足す：同じ人に結ばれ、ほかの端末のセッションが消え、今のセッションは作り直す', async () => {
    const login = newLogin('glink');
    const visitor = await githubLoggedIn(login);
    const other = await githubLoggedIn(login);
    const id = await githubUser(login);
    const session = visitor.cookies.get('ld_session');

    const response = await visitor.googleLogin(login, { query: '?intent=link&next=/account' });
    expect(response.headers.get('location')).toBe('/account');
    expect(await googleUser(login)).toBe(id);
    expect(visitor.cookies.get('ld_session')).not.toBe(session);
    expect((await visitor.fetch('/api/account')).status).toBe(200);
    expect((await other.fetch('/api/account')).status).toBe(401);
    expect(await countSessions(id)).toBe(1);

    // アバターは前の手段のまま
    expect((await visitor.account()).profile.avatar_url).toBe(`${FAKE_GITHUB}/avatars/${login}.svg`);
    expect((await visitor.account()).identities.map((identity: { provider: string }) => identity.provider).sort()).toEqual(['github', 'google']);

    // どちらの手段でも、同じ人として入れる
    const viaGoogle = new Visitor();
    await viaGoogle.googleLogin(login);
    expect((await viaGoogle.me()).user.handle).toBe((await visitor.me()).user.handle);
  });

  test('その Google がほかの人に結ばれていれば断る。自動で合わせない。セッションは変わらない', async () => {
    const taken = newLogin('gtakenlink');
    await signedUp(taken);
    const takenId = await googleUser(taken);
    const login = newLogin('gwants');
    const visitor = await githubLoggedIn(login);
    const id = await githubUser(login);
    const session = visitor.cookies.get('ld_session');

    const response = await visitor.googleLogin(taken, { query: '?intent=link&next=/account' });
    expect(response.headers.get('location')).toBe('/account?error=identity_taken');
    expect(await googleUser(taken)).toBe(takenId);
    expect(await d1(`SELECT provider FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ provider: 'github' }]);
    expect(visitor.cookies.get('ld_session')).toBe(session);
    expect((await visitor.fetch('/api/account')).status).toBe(200);
  });

  test('もう Google がある人が、別の Google を足すのは断る', async () => {
    const { visitor, login } = await signedUp();
    const response = await visitor.googleLogin(newLogin('gsecond'), { query: '?intent=link&next=/account' });
    expect(response.headers.get('location')).toBe('/account?error=already_linked');
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE user_id = ${quote(await googleUser(login))}`)).toEqual([{ n: 1 }]);
  });

  test('Google の画面にいる間に10分を過ぎたら、戻ったときに断る', async () => {
    const login = newLogin('gslow');
    const visitor = await githubLoggedIn(login);
    const id = await githubUser(login);
    const authorize = await visitor.startGoogle('?intent=link&next=/account');
    authorize.searchParams.set('login_as', login);
    await ageSessions(id);
    const back = await fetch(authorize, { redirect: 'manual' });
    const response = await visitor.fetch(back.headers.get('location')!);
    expect(response.headers.get('location')).toBe('/account?error=reauth_required');
    expect(await googleUser(login)).toBeUndefined();
  });

  test('Google で作った人が GitHub を足す。その GitHub がほかの人のものなら断る', async () => {
    const { visitor, login } = await signedUp();
    const id = await googleUser(login);
    const stranger = newLogin('ghstranger');
    await githubLoggedIn(stranger);

    const refused = await visitor.login(stranger, '&intent=link');
    expect(refused.headers.get('location')).toBe('/?error=identity_taken');

    const github = newLogin('ghmine');
    const added = await visitor.login(github, '&intent=link');
    expect(added.headers.get('location')).toBe('/');
    expect(await githubUser(github)).toBe(id);
    const viaGitHub = new Visitor();
    await viaGitHub.login(github);
    expect((await viaGitHub.me()).user.handle).toBe(login);
  });

  test('手段を足し引きしても、直近のログインの時刻は延びない', async () => {
    const login = newLogin('gnoextend');
    const visitor = await githubLoggedIn(login);
    const id = await githubUser(login);
    const stamp = Date.now() - 5 * 60 * 1000;
    await d1(`UPDATE sessions SET auth_at = ${stamp} WHERE user_id = ${quote(id)}`);

    await visitor.googleLogin(login, { query: '?intent=link&next=/account' });
    expect(await d1(`SELECT auth_at FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ auth_at: stamp }]);

    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(204);
    expect(await d1(`SELECT auth_at FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ auth_at: stamp }]);
  });

  test('手段が2つあれば片方を外せる。外した手段では同じ人に入れない。最後の1つは外せない', async () => {
    const login = newLogin('gremove');
    const visitor = await githubLoggedIn(login);
    const id = await githubUser(login);
    await visitor.googleLogin(login, { query: '?intent=link&next=/account' });

    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(204);
    expect(await d1(`SELECT provider FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ provider: 'github' }]);

    const last = await visitor.post('/api/account/identities/github/remove');
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: 'last_method' });

    const again = new Visitor();
    expect((await again.googleLogin(login)).headers.get('location')).toBe('/signup');
    expect(again.cookies.has('ld_session')).toBe(false);
  });

  test('Google のアバターの人が Google を外すと、残る手段のアバターになる。手段がアバターを持たなければ頭文字', async () => {
    const { visitor, login } = await signedUp();
    const github = newLogin('ghavatar');
    await visitor.login(github, '&intent=link');
    expect((await visitor.account()).profile.avatar_url).toBe(`${FAKE_GOOGLE}/avatars/${login}.svg`);
    expect((await visitor.post('/api/account/identities/google/remove')).status).toBe(204);
    expect((await visitor.account()).profile.avatar_url).toBe(`${FAKE_GITHUB}/avatars/${github}.svg`);
  });
});

test.describe('もう一度のログイン（Google）', () => {
  test('今の本人の Google なら、直近のログインになる', async () => {
    const { visitor, login } = await signedUp();
    await ageSessions(await googleUser(login));
    expect((await visitor.account()).recent_auth).toBe(false);
    const response = await visitor.googleLogin(login, { query: '?intent=reauth&next=/account/delete' });
    expect(response.headers.get('location')).toBe('/account/delete');
    expect((await visitor.account()).recent_auth).toBe(true);
  });

  test('別の Google の人だと断る。新しい人も作らない', async () => {
    const { visitor, login } = await signedUp();
    const stranger = newLogin('gstrange');
    const response = await visitor.googleLogin(stranger, { query: '?intent=reauth&next=/account/delete' });
    expect(response.headers.get('location')).toBe('/account/delete?error=reauth_mismatch');
    expect(visitor.cookies.has('ld_signup')).toBe(false);
    expect((await visitor.me()).user.handle).toBe(login);
    expect(await googleUser(stranger)).toBeUndefined();
  });

  test('Google の画面で断ると、元の画面へ戻る', async () => {
    const { visitor } = await signedUp();
    const authorize = await visitor.startGoogle('?intent=reauth&next=/account/delete');
    authorize.searchParams.set('deny', '1');
    const back = await fetch(authorize, { redirect: 'manual' });
    expect((await visitor.fetch(back.headers.get('location')!)).headers.get('location')).toBe('/account/delete?error=provider_denied');
  });

  test('退会：Google の人も、消すと Google の行が消える。同じ Google で入ると新しい人', async () => {
    const { visitor, login } = await signedUp();
    const id = await googleUser(login);
    expect((await visitor.post('/api/account/delete')).status).toBe(204);
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    const again = new Visitor();
    expect((await again.googleLogin(login)).headers.get('location')).toBe('/signup');
  });
});

test.describe('ログインの画面', () => {
  test('ヘッダーのログインから開いて、Google と GitHub を選べる。戻り先を保つ', async ({ page }) => {
    await page.goto('/?c=mobile');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent('/?c=mobile')}`);
    await expect(page).toHaveTitle('ログイン · Ludion');
    await expect(page.getByRole('heading', { name: 'ログイン', level: 1 })).toBeVisible();

    const google = page.getByRole('link', { name: 'Google でログイン' });
    await expect(google).toHaveAttribute('href', `/auth/google?next=${encodeURIComponent('/?c=mobile')}`);
    await expect(page.getByRole('link', { name: 'GitHub でログイン' })).toHaveAttribute('href', `/auth/github?next=${encodeURIComponent('/?c=mobile')}`);
    // Google の決まりのロゴ
    const logo = google.locator('img');
    await expect(logo).toHaveAttribute('src', '/google-g.svg');
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    expect(readFileSync(join(WEB, 'public/google-g.svg'), 'utf8')).toEqual(expect.stringMatching(/#EA4335[\s\S]*#4285F4[\s\S]*#FBBC05[\s\S]*#34A853/));

    // ログインの画面のログインのリンクは、同じ戻り先のまま
    await expect(page.getByRole('banner').getByRole('link', { name: 'ログイン', exact: true })).toHaveAttribute('href', `/login?next=${encodeURIComponent('/?c=mobile')}`);
  });

  test('戻り先がなければ、その言語のホームへ', async ({ page }) => {
    await page.goto('/en/login');
    await expect(page.getByRole('heading', { name: 'Log in', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute('href', `/auth/google?next=${encodeURIComponent('/en')}`);
  });

  test('ログイン済みなら、戻り先へ送る。外へは送らない', async () => {
    const visitor = await githubLoggedIn();
    expect((await visitor.fetch('/login?next=/p/abc')).headers.get('location')).toBe('/p/abc');
    expect((await visitor.fetch('/en/login')).headers.get('location')).toBe('/en');
    expect((await visitor.fetch(`/login?next=${encodeURIComponent('https://evil.example')}`)).headers.get('location')).toBe('/');
    expect((await visitor.fetch('/signup')).headers.get('location')).toBe('/');
  });

  test('next がでたらめでも、画面は落ちない', async ({ page }) => {
    for (const next of ['http://', 'http%3A%2F%2F', '%2F%2Fevil.example', '%', 'javascript%3Aalert(1)']) {
      const response = await page.goto(`/login?next=${next}`);
      expect(response!.status(), next).toBe(200);
      await expect(page.getByRole('link', { name: 'GitHub でログイン' }), next).toBeVisible();
    }
  });

  test('キャッシュしない', async () => {
    const response = await new Visitor().fetch('/login');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
});

test.describe('通し（ブラウザ）', () => {
  test('Google で新しく始める：ログインの画面 → Google → ユーザー名 → 元のページ', async ({ page, context }) => {
    const login = newLogin('gflow');
    await context.addCookies([{ name: 'fake_google', value: login, url: FAKE_GOOGLE }]);
    await page.goto('/?c=mobile');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await page.getByRole('link', { name: 'Google でログイン' }).click();

    await expect(page).toHaveURL('/signup');
    await expect(page).toHaveTitle('ユーザー名を決める · Ludion');
    const input = page.getByLabel('ユーザー名');
    await expect(input).not.toHaveValue('');
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();

    await input.fill('admin');
    await expect(page.getByText('このユーザー名は使えません')).toBeVisible();
    await expect(page.getByRole('button', { name: 'はじめる' })).toBeDisabled();
    await input.fill(login);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'はじめる' }).click();

    await expect(page).toHaveURL('/?c=mobile');
    const avatar = page.getByRole('button', { name: 'アカウントのメニュー' }).locator('img');
    await expect(avatar).toHaveAttribute('src', `${FAKE_GOOGLE}/avatars/${login}.svg`);
    await expect.poll(() => avatar.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    await page.goto('/account');
    await expect(page.getByText(`（Name of ${login}）`)).toBeVisible();
    await expect(page.getByText('ほかに手段がないので、外せません')).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub を足す' })).toBeVisible();

    // 2回目はユーザー名を聞かない
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page).toHaveURL('/');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await page.getByRole('link', { name: 'Google でログイン' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: 'アカウントのメニュー' })).toBeVisible();
  });

  test('途中の状態がないと、ログインへ戻す案内を出す', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.getByText('時間がたちました。もう一度ログインしてください')).toBeVisible();
    await page.getByRole('link', { name: 'ログインの画面へ' }).click();
    await expect(page).toHaveURL('/login');
  });

  test('アカウントのページ：Google を足す、外す。結ばれていれば断りを出す', async ({ page, context }) => {
    const login = newLogin('gscreen');
    const taken = newLogin('gscreentaken');
    await signedUp(taken);
    await context.addCookies([
      { name: 'fake_user', value: login, url: FAKE_GITHUB },
      { name: 'fake_google', value: taken, url: FAKE_GOOGLE },
    ]);
    await page.goto(`/auth/github?next=${encodeURIComponent('/account')}`);
    await page.getByRole('link', { name: 'Google を足す' }).click();
    await expect(page).toHaveURL('/account?error=identity_taken');
    await expect(page.getByRole('alert')).toContainText('ほかのアカウントに結ばれています');

    await context.addCookies([{ name: 'fake_google', value: login, url: FAKE_GOOGLE }]);
    await page.getByRole('link', { name: 'Google を足す' }).click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByText(`（Name of ${login}）`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Google を足す' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Google を外す' }).click();
    await expect(page.getByRole('link', { name: 'Google を足す' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'GitHub を外す' })).toHaveCount(0);
    await expect(page.getByText('ほかに手段がないので、外せません')).toBeVisible();
  });

  test('アカウントのページ：直近のログインがなければ、足す、外すの前にログインを求める', async ({ page, context }) => {
    const login = newLogin('gnotrecent');
    await context.addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
    await page.goto(`/auth/github?next=${encodeURIComponent('/account')}`);
    await expect(page.getByRole('link', { name: 'Google を足す' })).toBeVisible();
    await ageSessions(await githubUser(login));
    await page.reload();
    await expect(page.getByRole('link', { name: 'Google を足す' })).toHaveCount(0);
    await page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).click();
    await expect(page).toHaveURL('/account');
    await expect(page.getByRole('link', { name: 'Google を足す' })).toBeVisible();
  });
});

test.describe('見た目', () => {
  for (const width of [390, 1440]) {
    test(`幅${width}：ログインとユーザー名の画面。axe の critical と serious が0。横にはみ出さない`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/login');
      await expect(page.getByRole('link', { name: 'Google でログイン' })).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);
      for (const name of ['Google でログイン', 'GitHub でログイン']) {
        expect((await page.getByRole('link', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }

      await context.addCookies([{ name: 'fake_google', value: newLogin(`gaxe${width}`), url: FAKE_GOOGLE }]);
      await page.getByRole('link', { name: 'Google でログイン' }).click();
      await expect(page.getByRole('button', { name: 'はじめる' })).toBeVisible();
      await expect(page.getByText('使えます', { exact: true })).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);
    });
  }

  test('React の描画が Worker の HTML とずれない', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(`/login?next=${encodeURIComponent('/?q=abc')}`);
    await expect(page.getByRole('link', { name: 'Google でログイン' })).toBeVisible();
    await page.goto('/signup');
    await expect(page.getByRole('link', { name: 'ログインの画面へ' })).toBeVisible();
    expect(errors).toEqual([]);
  });
});
