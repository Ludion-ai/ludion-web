// パスキーと回復のコード（docs/tasks/T020.md「7」）。
// Playwright の Chromium の仮想の認証器（CDP の WebAuthn.addVirtualAuthenticator）で通す。
// 署名の決まりを確かめるものは、仮想の認証器の秘密鍵で手元で署名し直す（origin や数だけを変えて、ほかは正しいままにするため）。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePasskeyLabel } from '../worker/profile';
import { generateRecoveryCode, hashRecoveryCode, normalizeRecoveryCode } from '../worker/recoveryCode';
import { pageOverflow } from './helpers';
import { ownOrigin, Visitor } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_PASSKEY_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const RP_ID = 'localhost';
const TEN_MINUTES = 10 * 60 * 1000;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const newHandle = (label: string) => `${label}${randomBytes(4).toString('hex')}`;
const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest();

async function d1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const userIdOf = async (handle: string) => (await d1<{ id: string }>(`SELECT id FROM users WHERE handle = ${quote(handle)}`))[0]?.id;
const ageSessions = (id: string) => d1(`UPDATE sessions SET auth_at = auth_at - ${TEN_MINUTES + 1000} WHERE user_id = ${quote(id)}`);

interface Authenticator {
  cdp: CDPSession;
  authenticatorId: string;
}

async function addAuthenticator(page: Page): Promise<Authenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return { cdp, authenticatorId };
}

/** 認証器の中のパスキー（秘密鍵を含む）。 */
async function credentialsOf({ cdp, authenticatorId }: Authenticator) {
  return (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
}

/** ログイン中でなければ、ブラウザで新しい人を作る。回復のコードを返す。 */
async function createAccount(page: Page, handle: string) {
  await page.goto('/signup');
  await page.getByLabel('ユーザー名').fill(handle);
  await expect(page.getByText('使えます', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'パスキーを作る' }).click();
  const code = (await page.locator('[data-recovery-code]').textContent())!;
  await page.getByRole('link', { name: '保存したので続ける' }).click();
  await expect(page.getByRole('button', { name: 'アカウントのメニュー' })).toBeVisible();
  return code;
}

/** 新しい人とパスキーを作り、秘密鍵と一緒に返す。 */
async function setUpPerson(page: Page, handle = newHandle('person')) {
  const authenticator = await addAuthenticator(page);
  const code = await createAccount(page, handle);
  const [credential] = await credentialsOf(authenticator);
  return { authenticator, credential, code, handle, id: (await userIdOf(handle))! };
}

/** 署名し直したログインの応答。何も渡さなければ、正しい応答になる。 */
function assertion(credential: { credentialId: string; privateKey: string }, challenge: string, { origin = ownOrigin(), rpId = RP_ID, counter = 0, flags = 0x05, type = 'webauthn.get' } = {}) {
  const clientData = Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const counterBytes = Buffer.alloc(4);
  counterBytes.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([sha256(rpId), Buffer.from([flags]), counterBytes]);
  const key = createPrivateKey({ key: Buffer.from(credential.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  // Ed25519 は要約の名前を取らない。仮想の認証器は、サーバーが先に挙げた Ed25519 を選ぶ
  const signature = sign(key.asymmetricKeyType === 'ed25519' ? null : 'sha256', Buffer.concat([authenticatorData, sha256(clientData)]), key);
  const id = Buffer.from(credential.credentialId, 'base64').toString('base64url');
  return {
    id,
    rawId: id,
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: base64url(clientData), authenticatorData: base64url(authenticatorData), signature: base64url(signature) },
  };
}

/** ログインの challenge を取る。 */
async function startLogin(visitor: Visitor, body: object = {}) {
  const response = await visitor.post('/auth/passkey/login/options', body);
  expect(response.status).toBe(200);
  return (await response.json()) as { challenge: string; rpId: string; userVerification: string; allowCredentials?: unknown[] };
}

async function signSession(page: Page, login: string, path = '/account') {
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
}

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}：${v.nodes[0]?.target}`);
}

test.describe('作る', () => {
  test('ログインの画面 → handle を選ぶ → パスキーを作る → 回復のコードを1回見せる → ログインした状態', async ({ page }) => {
    await addAuthenticator(page);
    const handle = newHandle('create');
    await page.goto('/?c=mobile');
    await page.getByRole('link', { name: 'ログイン', exact: true }).click();
    await page.getByRole('link', { name: 'パスキーでアカウントを作る' }).click();
    await expect(page).toHaveURL(`/signup?next=${encodeURIComponent('/?c=mobile')}`);

    // なくしたときのことを、作る前に書く
    await expect(page.getByText('パスキーを全部なくし、回復のコードもないときは、アカウントに入れません', { exact: false })).toBeVisible();
    await expect(page.getByText('2つ目のパスキーを別の端末で作るか、Google か GitHub を足すと安全です', { exact: false })).toBeVisible();

    // handle の決まり
    const input = page.getByLabel('ユーザー名');
    const button = page.getByRole('button', { name: 'パスキーを作る' });
    await expect(button).toBeDisabled();
    await input.fill('admin');
    await expect(page.getByText('このユーザー名は使えません')).toBeVisible();
    await expect(button).toBeDisabled();
    await input.fill(handle);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await button.click();

    // 回復のコード
    await expect(page.getByRole('heading', { name: 'アカウントを作りました' })).toBeVisible();
    const code = (await page.locator('[data-recovery-code]').textContent())!;
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]$/);
    await expect(page.getByText('今しか見せません', { exact: false })).toBeVisible();
    await page.getByRole('link', { name: '保存したので続ける' }).click();

    await expect(page).toHaveURL('/?c=mobile');
    // アバターがないので、頭文字の円
    const avatar = page.getByRole('button', { name: 'アカウントのメニュー' });
    await expect(avatar).toContainText(handle[0].toUpperCase());
    await expect(avatar.locator('img')).toHaveCount(0);

    // 持つのは公開鍵とその情報。回復のコードはハッシュだけ
    const id = (await userIdOf(handle))!;
    const [row] = await d1<Record<string, unknown>>(`SELECT * FROM passkeys WHERE user_id = ${quote(id)}`);
    expect(Object.keys(row).sort()).toEqual(['created_at', 'credential_id', 'label', 'last_used_at', 'public_key', 'sign_count', 'transports', 'user_id']);
    expect(row.label).toBeNull();
    expect(row.last_used_at).toBeNull();
    expect(await d1(`SELECT code_hash FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ code_hash: await hashRecoveryCode(code) }]);
    const [user] = await d1<{ display_name: string | null; avatar_url: string | null }>(`SELECT display_name, avatar_url FROM users WHERE id = ${quote(id)}`);
    expect(user).toEqual({ display_name: null, avatar_url: null });

    // D1 のファイルに、コードそのものがない
    const dir = join(PERSIST, 'v3/d1');
    const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    const dump = Buffer.concat(files.map((entry) => readFileSync(join(entry.parentPath, entry.name)))).toString('latin1');
    expect(dump).toContain(await hashRecoveryCode(code));
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(normalizeRecoveryCode(code));
  });

  test('作り方の選択肢：discoverable、ユーザー確認が必須、attestation を求めない。challenge は毎回違う', async () => {
    const first = await (await new Visitor().post('/auth/passkey/register/options', { handle: newHandle('opts') })).json();
    const second = await (await new Visitor().post('/auth/passkey/register/options', { handle: newHandle('opts') })).json();
    expect(first.rp).toEqual({ name: 'Ludion', id: RP_ID });
    expect(first.authenticatorSelection.residentKey).toBe('required');
    expect(first.authenticatorSelection.userVerification).toBe('required');
    expect(first.attestation).toBe('none');
    expect(first.challenge).not.toBe(second.challenge);
    expect(Buffer.from(first.challenge, 'base64url').length).toBeGreaterThanOrEqual(32);
  });

  test('途中の状態：cookie は5分の HttpOnly。D1 にはそのハッシュと challenge', async () => {
    const visitor = new Visitor();
    const options = await (await visitor.post('/auth/passkey/register/options', { handle: newHandle('flow') })).json();
    const line = visitor.lastSetCookie.find((item) => item.startsWith('ld_passkey_flow='))!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Secure/i);
    expect(line).toMatch(/SameSite=Lax/i);
    expect(line).toMatch(/Path=\/auth\/passkey/i);
    expect(line).toMatch(/Max-Age=300/i);
    const hash = createHash('sha256').update(visitor.cookies.get('ld_passkey_flow')!).digest('hex');
    const [row] = await d1<{ kind: string; data: string; expires_at: number }>(`SELECT kind, data, expires_at FROM auth_flows WHERE token_hash = ${quote(hash)}`);
    expect(row.kind).toBe('passkey');
    expect(JSON.parse(row.data).challenge).toBe(options.challenge);
    expect(row.expires_at - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  test('handle の決まりを、作り始める前に確かめる', async () => {
    const other = newHandle('taken');
    await d1(`INSERT INTO users (id, handle, created_at) VALUES (${quote(`test-${other}`)}, ${quote(other)}, 1)`);
    for (const [handle, status] of [
      ['ab', 'format'],
      ['admin', 'reserved'],
      ['seed_a', 'reserved'],
      [other, 'taken'],
      [other.toUpperCase(), 'taken'],
    ]) {
      const response = await new Visitor().post('/auth/passkey/register/options', { handle });
      expect(response.status, handle).toBe(400);
      expect(await response.json(), handle).toEqual({ error: 'handle_rejected', status });
    }
    expect((await new Visitor().post('/auth/passkey/register/options', {})).status).toBe(400);
  });

  test('作っている間に handle を取られたら断り、人を作らない', async ({ page }) => {
    await addAuthenticator(page);
    const handle = newHandle('racing');
    await page.goto('/signup');
    await page.getByLabel('ユーザー名').fill(handle);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    // ボタンを押す前に、ほかの人が取る。確かめの答えは「使える」のまま
    await page.route('**/auth/passkey/register/verify', async (route) => {
      await d1(`INSERT INTO users (id, handle, created_at) VALUES (${quote(`test-${handle}`)}, ${quote(handle)}, 1)`);
      await route.continue();
    });
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    await expect(page.getByText('ほかの人が使っています')).toBeVisible();
    expect(await d1(`SELECT id FROM users WHERE handle = ${quote(handle)}`)).toEqual([{ id: `test-${handle}` }]);
  });

  test('別の origin で作ったものを断る。人を作らない', async ({ page }) => {
    await addAuthenticator(page);
    const handle = newHandle('evilorigin');
    await page.route('**/auth/passkey/register/verify', async (route) => {
      const body = route.request().postDataJSON();
      const clientData = JSON.parse(Buffer.from(body.response.response.clientDataJSON, 'base64url').toString());
      body.response.response.clientDataJSON = base64url(JSON.stringify({ ...clientData, origin: 'https://evil.example' }));
      await route.continue({ postData: JSON.stringify(body) });
    });
    await page.goto('/signup');
    await page.getByLabel('ユーザー名').fill(handle);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    const verify = page.waitForResponse('**/auth/passkey/register/verify');
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    const response = await verify;
    expect(response.status()).toBe(400);
    expect(await response.json()).toEqual({ error: 'verification_failed' });
    await expect(page.getByText('アカウントを作れませんでした')).toBeVisible();
    expect(await userIdOf(handle)).toBeUndefined();
  });

  test('challenge が違うものを断る。作り始めていなければ断る', async ({ page }) => {
    await addAuthenticator(page);
    const handle = newHandle('badchallenge');
    await page.route('**/auth/passkey/register/verify', async (route) => {
      const body = route.request().postDataJSON();
      const clientData = JSON.parse(Buffer.from(body.response.response.clientDataJSON, 'base64url').toString());
      body.response.response.clientDataJSON = base64url(JSON.stringify({ ...clientData, challenge: base64url(randomBytes(32)) }));
      await route.continue({ postData: JSON.stringify(body) });
    });
    await page.goto('/signup');
    await page.getByLabel('ユーザー名').fill(handle);
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    const verify = page.waitForResponse('**/auth/passkey/register/verify');
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    expect((await verify).status()).toBe(400);
    expect(await userIdOf(handle)).toBeUndefined();

    const response = await new Visitor().post('/auth/passkey/register/verify', { response: {} });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_challenge' });
  });
});

test.describe('ログイン', () => {
  test('名前を打たずに選べる。同じ人に入る。使った日と数が入る', async ({ page, context }) => {
    const { handle, id } = await setUpPerson(page);
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    expect((await context.cookies()).filter((cookie) => cookie.name === 'ld_session')).toEqual([]);

    await page.goto(`/login?next=${encodeURIComponent('/p/seed-trail-guide')}`);
    await page.getByRole('button', { name: 'パスキーでログイン' }).click();
    await expect(page).toHaveURL('/p/seed-trail-guide');
    await expect(page.getByRole('button', { name: 'アカウントのメニュー' })).toBeVisible();
    expect((await (await page.request.get('/api/me')).json()).user.handle).toBe(handle);

    const [row] = await d1<{ last_used_at: number; sign_count: number }>(`SELECT last_used_at, sign_count FROM passkeys WHERE user_id = ${quote(id)}`);
    expect(Date.now() - row.last_used_at).toBeLessThan(60_000);
    expect(row.sign_count).toBeGreaterThan(0);
  });

  // サーバーが bad_challenge を返すことは、下の API のテストで確かめている。ここでは画面の答えを確かめる（docs/tasks/FIX-login.md「2」）
  test('途中の状態が合わないと、ログインの画面に文を出す。やり直すと入れる', async ({ page }) => {
    await setUpPerson(page);
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await page.getByRole('menuitem', { name: 'ログアウト' }).click();
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();

    await page.goto('/login');
    await page.route('**/auth/passkey/login/verify', (route) => route.fulfill({ status: 400, json: { error: 'bad_challenge' } }), { times: 1 });
    await page.getByRole('button', { name: 'パスキーでログイン' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ログインをやり直してください' })).toBeVisible();
    await page.getByRole('button', { name: 'パスキーでログイン' }).click();
    await expect(page.getByRole('button', { name: 'アカウントのメニュー' })).toBeVisible();
  });

  test('新しい人を作る途中で状態が合わないと、ログインの画面へ戻して文を出す', async ({ page }) => {
    await addAuthenticator(page);
    await page.goto(`/signup?next=${encodeURIComponent('/about')}`);
    await page.getByLabel('ユーザー名').fill(newHandle('retry'));
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await page.route('**/auth/passkey/register/verify', (route) => route.fulfill({ status: 400, json: { error: 'bad_challenge' } }));
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent('/about')}&error=login_retry`);
    await expect(page.getByRole('status').filter({ hasText: 'ログインをやり直してください' })).toBeVisible();
  });

  test('アプリの中のブラウザでパスキーが断られたら、Google と同じ知らせを出す。ふつうのブラウザの取り消しには出さない', async ({ browser, baseURL }) => {
    const refuse = () => {
      Object.defineProperty(navigator.credentials, 'get', { value: () => Promise.reject(new DOMException('refused', 'NotAllowedError')) });
    };
    const message = 'アプリの中のブラウザでは Google でログインできないことがあります';
    const inApp = await browser.newContext({ baseURL, locale: 'ja-JP', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/11.0' });
    await inApp.addInitScript(refuse);
    const inAppPage = await inApp.newPage();
    await inAppPage.goto('/login');
    await inAppPage.getByRole('button', { name: 'パスキーでログイン' }).click();
    await expect(inAppPage.getByRole('status').filter({ hasText: message })).toBeVisible();
    await inApp.close();

    const plain = await browser.newContext({ baseURL, locale: 'ja-JP' });
    await plain.addInitScript(refuse);
    const plainPage = await plain.newPage();
    await plainPage.goto('/login');
    const answered = plainPage.waitForResponse('**/auth/passkey/login/options');
    await plainPage.getByRole('button', { name: 'パスキーでログイン' }).click();
    await answered;
    await expect(plainPage.getByRole('button', { name: 'パスキーでログイン' })).toBeVisible();
    await expect(plainPage.getByText(message)).toHaveCount(0);
    await plain.close();
  });

  test('ログインの選択肢：名前を送らない形。ユーザー確認が必須。RP ID を決めた値にする', async () => {
    const options = await startLogin(new Visitor());
    expect(options.rpId).toBe(RP_ID);
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials ?? []).toEqual([]);
  });

  test('正しい署名は通る（下の断るテストの対照）', async ({ page }) => {
    const { credential, handle } = await setUpPerson(page);
    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    const response = await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 1 }) });
    expect(response.status).toBe(200);
    expect((await visitor.me()).user.handle).toBe(handle);
    // 新しいセッションは直近のログイン
    expect((await visitor.account()).recent_auth).toBe(true);
  });

  test('challenge の使い回しを断る', async ({ page }) => {
    const { credential } = await setUpPerson(page);
    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    const cookie = visitor.cookies.get('ld_passkey_flow')!;
    const signed = assertion(credential, challenge, { counter: credential.signCount + 1 });
    expect((await visitor.post('/auth/passkey/login/verify', { response: signed })).status).toBe(200);

    // 同じ cookie と同じ応答をもう一度
    const again = new Visitor();
    again.cookies.set('ld_passkey_flow', cookie);
    const response = await again.post('/auth/passkey/login/verify', { response: signed });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_challenge' });
    expect(again.cookies.has('ld_session')).toBe(false);

    // 新しい challenge に、古い応答
    const third = new Visitor();
    await startLogin(third);
    const stale = await third.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 2 }) });
    expect(stale.status).toBe(400);
    expect(third.cookies.has('ld_session')).toBe(false);
  });

  test('5分を過ぎた challenge を断る', async ({ page }) => {
    const { credential } = await setUpPerson(page);
    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    const hash = createHash('sha256').update(visitor.cookies.get('ld_passkey_flow')!).digest('hex');
    await d1(`UPDATE auth_flows SET expires_at = ${Date.now() - 1000} WHERE token_hash = ${quote(hash)}`);
    const response = await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 1 }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'bad_challenge' });
  });

  test('別の origin を断る。署名は正しくても通らない', async ({ page }) => {
    const { credential } = await setUpPerson(page);
    for (const origin of ['https://evil.example', 'https://ludion.ai', 'http://127.0.0.1:4180', 'http://localhost']) {
      const visitor = new Visitor();
      const { challenge } = await startLogin(visitor);
      const response = await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { origin, counter: credential.signCount + 1 }) });
      expect(response.status, origin).toBe(400);
      expect(await response.json(), origin).toEqual({ error: 'verification_failed' });
      expect(visitor.cookies.has('ld_session'), origin).toBe(false);
    }
  });

  test('別の RP ID、ユーザー確認なし、種類の違いを断る', async ({ page }) => {
    const { credential } = await setUpPerson(page);
    for (const [label, options] of [
      ['RP ID', { rpId: 'evil.example' }],
      ['ユーザー確認なし', { flags: 0x01 }],
      ['ユーザーの操作なし', { flags: 0x04 }],
      ['種類', { type: 'webauthn.create' }],
    ] as const) {
      const visitor = new Visitor();
      const { challenge } = await startLogin(visitor);
      const response = await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { ...options, counter: credential.signCount + 1 }) });
      expect(response.status, label).toBe(400);
      expect(visitor.cookies.has('ld_session'), label).toBe(false);
    }
  });

  test('知らないパスキー、形の違う応答を断る', async ({ page }) => {
    const { credential } = await setUpPerson(page);
    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    const unknown = assertion({ ...credential, credentialId: randomBytes(32).toString('base64') }, challenge);
    expect((await visitor.post('/auth/passkey/login/verify', { response: unknown })).status).toBe(400);

    const second = new Visitor();
    await startLogin(second);
    expect((await second.post('/auth/passkey/login/verify', { response: 'nope' })).status).toBe(400);
    const third = new Visitor();
    expect((await third.post('/auth/passkey/login/verify', {})).status).toBe(400);
  });

  test('sign_count：0 でない鍵で数が戻ったら断る。同じ数も断る', async ({ page }) => {
    const { credential, id } = await setUpPerson(page);
    const visitor = new Visitor();
    let { challenge } = await startLogin(visitor);
    expect((await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: 50 }) })).status).toBe(200);
    expect(await d1(`SELECT sign_count FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ sign_count: 50 }]);

    for (const counter of [49, 50, 0]) {
      const again = new Visitor();
      ({ challenge } = await startLogin(again));
      const response = await again.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter }) });
      expect(response.status, String(counter)).toBe(400);
      expect(again.cookies.has('ld_session'), String(counter)).toBe(false);
    }
    expect(await d1(`SELECT sign_count FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ sign_count: 50 }]);

    const forward = new Visitor();
    ({ challenge } = await startLogin(forward));
    expect((await forward.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: 51 }) })).status).toBe(200);
  });

  test('sign_count：0 のままの鍵（同期されるパスキー）は、何度でも受け入れる', async ({ page }) => {
    const { credential, id } = await setUpPerson(page);
    await d1(`UPDATE passkeys SET sign_count = 0 WHERE user_id = ${quote(id)}`);
    for (let round = 0; round < 3; round += 1) {
      const visitor = new Visitor();
      const { challenge } = await startLogin(visitor);
      expect((await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: 0 }) })).status, String(round)).toBe(200);
    }
    expect(await d1(`SELECT sign_count FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ sign_count: 0 }]);
  });

  test('外の Origin からは始められない', async () => {
    for (const path of ['/auth/passkey/login/options', '/auth/passkey/login/verify', '/auth/passkey/register/options', '/auth/passkey/register/verify', '/auth/passkey/recovery']) {
      for (const origin of ['https://evil.example', null, 'null']) {
        expect((await new Visitor().post(path, {}, origin)).status, `${path} ${origin}`).toBe(403);
      }
    }
  });
});

test.describe('足す、外す', () => {
  test('GitHub の人が足す：名前を付けられる。一覧に出る。ほかの端末は消える。パスキーで同じ人に入れる。回復のコードは作らない', async ({ page }) => {
    const login = newHandle('adder');
    const authenticator = await addAuthenticator(page);
    await signSession(page, login);
    const other = new Visitor();
    await other.login(login);
    const id = (await userIdOf(login))!;

    await expect(page.getByText('まだありません')).toBeVisible();
    await page.getByLabel('パスキーの名前（任意）').fill('iPhone');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    await expect(page.getByText('iPhone', { exact: true })).toBeVisible();
    await expect(page.getByText('まだログインに使っていません')).toBeVisible();
    await expect(page.getByLabel('パスキーの名前（任意）')).toHaveValue('');

    expect(await d1(`SELECT label FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ label: 'iPhone' }]);
    expect((await other.fetch('/api/account')).status).toBe(401);
    expect(await d1(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    await expect(page.getByText('ありません。パスキーをなくすと入れなくなるので、作ってください')).toBeVisible();

    const [credential] = await credentialsOf(authenticator);
    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    expect((await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 1 }) })).status).toBe(200);
    expect((await visitor.me()).user.handle).toBe(login);
  });

  test('2つ目のパスキーを別の端末で足せる', async ({ page, context }) => {
    const { id, authenticator } = await setUpPerson(page);
    await page.goto('/account');
    // 別の端末（別の認証器）で足す
    await authenticator.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: authenticator.authenticatorId });
    await addAuthenticator(page);
    await page.getByLabel('パスキーの名前（任意）').fill('Mac');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    await expect(page.getByText('Mac', { exact: true })).toBeVisible();
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 2 }]);
    expect((await context.cookies()).some((cookie) => cookie.name === 'ld_session')).toBe(true);
  });

  test('足したり外したりしても、直近のログインの時刻は延びない', async ({ page }) => {
    const login = newHandle('noextend');
    await addAuthenticator(page);
    await signSession(page, login);
    const id = (await userIdOf(login))!;
    const stamp = Date.now() - 5 * 60 * 1000;
    await d1(`UPDATE sessions SET auth_at = ${stamp} WHERE user_id = ${quote(id)}`);
    await page.getByLabel('パスキーの名前（任意）').fill('Short');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    await expect(page.getByText('Short', { exact: true })).toBeVisible();
    expect(await d1(`SELECT auth_at FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ auth_at: stamp }]);
    await page.getByRole('button', { name: 'Short を外す' }).click();
    await expect(page.getByText('まだありません')).toBeVisible();
    expect(await d1(`SELECT auth_at FROM sessions WHERE user_id = ${quote(id)}`)).toEqual([{ auth_at: stamp }]);
  });

  test('足すのは、直近10分以内のログインが要る', async ({ page }) => {
    const login = newHandle('stale');
    await addAuthenticator(page);
    await signSession(page, login);
    const id = (await userIdOf(login))!;
    await ageSessions(id);
    const response = await page.request.post('/auth/passkey/register/options', { headers: { Origin: ownOrigin() }, data: {} });
    expect(response.status()).toBe(403);
    expect(await response.json()).toEqual({ error: 'reauth_required' });

    await page.reload();
    await expect(page.getByRole('button', { name: 'パスキーを足す' })).toHaveCount(0);
    await page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).click();
    await expect(page.getByRole('button', { name: 'パスキーを足す' })).toBeVisible();
  });

  test('作り始めた後に10分を過ぎたら、置かない', async ({ page }) => {
    const login = newHandle('slowadd');
    await addAuthenticator(page);
    await signSession(page, login);
    const id = (await userIdOf(login))!;
    await page.route('**/auth/passkey/register/verify', async (route) => {
      await ageSessions(id);
      await route.continue();
    });
    const verify = page.waitForResponse('**/auth/passkey/register/verify');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    expect((await verify).status()).toBe(403);
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
  });

  test('外す：直近のログインが要る。外すとほかの端末が消える。回復のコードも消える。外したパスキーでは入れない', async ({ page }) => {
    const login = newHandle('remover');
    const authenticator = await addAuthenticator(page);
    await signSession(page, login);
    await page.getByLabel('パスキーの名前（任意）').fill('Key');
    await page.getByRole('button', { name: 'パスキーを足す' }).click();
    await expect(page.getByText('Key', { exact: true })).toBeVisible();
    const id = (await userIdOf(login))!;
    await page.getByRole('button', { name: '回復のコードを作り直す' }).click();
    await expect(page.locator('[data-recovery-code]')).toBeVisible();
    expect(await d1(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);
    const [credential] = await credentialsOf(authenticator);
    const credentialId = Buffer.from(credential.credentialId, 'base64').toString('base64url');

    const other = new Visitor();
    await other.login(login);
    await ageSessions(id);
    expect((await page.request.post(`/api/account/passkeys/${credentialId}/remove`, { headers: { Origin: ownOrigin() } })).status()).toBe(403);

    await page.reload();
    await page.getByRole('link', { name: 'GitHub でもう一度ログインする' }).click();
    await page.getByRole('button', { name: 'Key を外す' }).click();
    await expect(page.getByText('まだありません')).toBeVisible();
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect(await d1(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect((await other.fetch('/api/account')).status).toBe(401);

    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    expect((await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 1 }) })).status).toBe(400);
  });

  test('最後の1つは外せない。パスキーがあれば GitHub は外せる', async ({ page }) => {
    const { authenticator, id } = await setUpPerson(page);
    const [credential] = await credentialsOf(authenticator);
    const credentialId = Buffer.from(credential.credentialId, 'base64').toString('base64url');
    const headers = { Origin: ownOrigin() };
    const last = await page.request.post(`/api/account/passkeys/${credentialId}/remove`, { headers });
    expect(last.status()).toBe(409);
    expect(await last.json()).toEqual({ error: 'last_method' });
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);

    await page.goto('/account');
    await expect(page.getByText('ほかに手段がないので、外せません')).toBeVisible();
    await expect(page.getByRole('button', { name: '名前のないパスキー を外す' })).toHaveCount(0);

    // GitHub を足すと、どちらも外せる。GitHub を外しても、パスキーが残る
    await page.context().addCookies([{ name: 'fake_user', value: newHandle('ghfor'), url: FAKE_GITHUB }]);
    await page.getByRole('link', { name: 'GitHub を足す' }).click();
    await expect(page.getByRole('button', { name: 'GitHub を外す' })).toBeVisible();
    await expect(page.getByRole('button', { name: '名前のないパスキー を外す' })).toBeVisible();
    await page.getByRole('button', { name: 'GitHub を外す' }).click();
    await expect(page.getByRole('link', { name: 'GitHub を足す' })).toBeVisible();
    expect(await d1(`SELECT COUNT(*) AS n FROM identities WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);
  });

  test('他人のパスキーは外せない', async ({ page }) => {
    const { authenticator, id } = await setUpPerson(page);
    const [credential] = await credentialsOf(authenticator);
    const credentialId = Buffer.from(credential.credentialId, 'base64').toString('base64url');
    const stranger = new Visitor();
    await stranger.login(newHandle('stranger'));
    expect((await stranger.post(`/api/account/passkeys/${credentialId}/remove`)).status).toBe(404);
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 1 }]);
  });

  test('パスキーの名前：40文字まで。向きを変える文字は断る', () => {
    expect(parsePasskeyLabel('  iPhone ')).toBe('iPhone');
    expect(parsePasskeyLabel('')).toBeNull();
    expect(parsePasskeyLabel(undefined)).toBeNull();
    expect(parsePasskeyLabel('x'.repeat(40))).toBe('x'.repeat(40));
    expect(parsePasskeyLabel('x'.repeat(41))).toBeUndefined();
    expect(parsePasskeyLabel(`a${String.fromCodePoint(0x202e)}b`)).toBeUndefined();
    expect(parsePasskeyLabel(1)).toBeUndefined();
  });
});

test.describe('もう一度のログイン（パスキー）', () => {
  test('パスキーだけの人は、パスキーで確かめ直して退会できる', async ({ page, context }) => {
    const { id } = await setUpPerson(page);
    await ageSessions(id);
    await page.goto('/account/delete');
    await expect(page.getByRole('button', { name: '退会する' })).toHaveCount(0);
    await page.getByRole('button', { name: 'パスキーでもう一度ログインする' }).click();
    await page.getByRole('button', { name: '退会する' }).click();
    await expect(page).toHaveURL('/');
    expect(await d1(`SELECT COUNT(*) AS n FROM users WHERE id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect(await d1(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect(await d1(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    expect((await context.cookies()).filter((cookie) => cookie.name === 'ld_session')).toEqual([]);
  });

  test('ほかの人のパスキーでは確かめ直せない。セッションは変わらない', async ({ page, browser }) => {
    const { credential } = await setUpPerson(page);
    const otherContext = await browser.newContext({ baseURL: ownOrigin(), locale: 'ja-JP' });
    const otherPage = await otherContext.newPage();
    const other = await setUpPerson(otherPage);
    await otherContext.close();

    const visitor = new Visitor();
    const { challenge } = await startLogin(visitor);
    expect((await visitor.post('/auth/passkey/login/verify', { response: assertion(credential, challenge, { counter: credential.signCount + 1 }) })).status).toBe(200);
    const session = visitor.cookies.get('ld_session');

    const reauth = await startLogin(visitor, { intent: 'reauth' });
    const response = await visitor.post('/auth/passkey/login/verify', { response: assertion(other.credential, reauth.challenge, { counter: other.credential.signCount + 1 }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'reauth_mismatch' });
    expect(visitor.cookies.get('ld_session')).toBe(session);
  });

  test('ログインしていなければ、確かめ直しは始められない', async () => {
    expect((await new Visitor().post('/auth/passkey/login/options', { intent: 'reauth' })).status).toBe(401);
  });
});

test.describe('回復のコード', () => {
  test('コードの形：130ビット、読みやすい区切り。毎回違う。ハッシュは揃えた形から作る', async () => {
    const codes = Array.from({ length: 50 }, generateRecoveryCode);
    expect(new Set(codes).size).toBe(50);
    for (const code of codes) {
      expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]$/);
      expect(normalizeRecoveryCode(code)).toHaveLength(26);
    }
    expect(26 * 5).toBeGreaterThanOrEqual(128);
    const code = codes[0];
    const hash = await hashRecoveryCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashRecoveryCode(code.toLowerCase())).toBe(hash);
    expect(await hashRecoveryCode(code.replace(/-/g, ' '))).toBe(hash);
    expect(normalizeRecoveryCode('oOiIlL-1')).toBe('001111' + '1');
  });

  test('回復のコードで入る。1回だけ。ほかの端末は消える。案内が出る', async ({ page }) => {
    const { code, id, handle } = await setUpPerson(page);

    // 別のブラウザから入る。今のブラウザのセッションは、回復で消える
    const fresh = await page.context().browser()!.newContext({ baseURL: ownOrigin(), locale: 'ja-JP' });
    const freshPage = await fresh.newPage();
    await freshPage.goto('/login');
    await freshPage.getByRole('button', { name: '回復のコードで入る' }).click();
    await freshPage.getByLabel('回復のコード').fill(code.toLowerCase());
    await freshPage.getByRole('button', { name: '入る', exact: true }).click();
    await expect(freshPage).toHaveURL('/account?recovered=1');
    await expect(freshPage.getByRole('alert')).toContainText('回復のコードで入りました');
    await expect(freshPage.getByText(`@${handle}`).first()).toBeVisible();
    await expect(freshPage.getByText('ありません。パスキーをなくすと入れなくなるので、作ってください')).toBeVisible();
    expect(await d1(`SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ n: 0 }]);
    await fresh.close();

    expect((await (await page.request.get('/api/me')).json()).user).toBeNull();

    // 使ったコードはもう使えない
    const visitor = new Visitor();
    const response = await visitor.post('/auth/passkey/recovery', { code });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_code' });
    expect(visitor.cookies.has('ld_session')).toBe(false);
  });

  test('画面：違うコードは断りを出す。人の情報を教えない', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: '回復のコードで入る' }).click();
    await page.getByLabel('回復のコード').fill('NOT-A-REAL-CODE');
    await page.getByRole('button', { name: '入る', exact: true }).click();
    await expect(page.getByText('回復のコードが違うか、もう使われています')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('同時に同じコードを送っても、入れるのは1回', async ({ page }) => {
    const { code } = await setUpPerson(page);
    const answers = await Promise.all(Array.from({ length: 5 }, () => new Visitor().post('/auth/passkey/recovery', { code })));
    expect(answers.filter((response) => response.status === 200)).toHaveLength(1);
    expect(answers.filter((response) => response.status === 400)).toHaveLength(4);
  });

  test('試す回数を制限する', async () => {
    const headers = { 'CF-Connecting-IP': `198.51.100.${(Date.now() % 200) + 1}`, Origin: ownOrigin(), 'Content-Type': 'application/json' };
    const answers = await Promise.all(
      Array.from({ length: 12 }, () => new Visitor().fetch('/auth/passkey/recovery', { method: 'POST', headers, body: JSON.stringify({ code: 'WRONG' }) })),
    );
    const limited = answers.filter((response) => response.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0].headers.get('retry-after')).toBe('60');
  });

  test('作り直すと前のものは無効。直近のログインが要る。コードは1回だけ見せる', async ({ page }) => {
    const { code, id } = await setUpPerson(page);
    await page.goto('/account');
    await expect(page.getByText('作ってあります。もう見せられません')).toBeVisible();
    await page.getByRole('button', { name: '回復のコードを作り直す' }).click();
    const next = (await page.locator('[data-recovery-code]').textContent())!;
    expect(next).not.toBe(code);
    expect(await d1(`SELECT code_hash FROM recovery_codes WHERE user_id = ${quote(id)}`)).toEqual([{ code_hash: await hashRecoveryCode(next) }]);

    expect((await new Visitor().post('/auth/passkey/recovery', { code })).status).toBe(400);

    // 読み直すと、もう見えない
    await page.reload();
    await expect(page.getByText('作ってあります。もう見せられません')).toBeVisible();
    await expect(page.locator('[data-recovery-code]')).toHaveCount(0);
    const account = await (await page.request.get('/api/account')).json();
    expect(JSON.stringify(account)).not.toContain(next);
    expect(account.has_recovery_code).toBe(true);

    await ageSessions(id);
    const stale = await page.request.post('/api/account/recovery-code', { headers: { Origin: ownOrigin() } });
    expect(stale.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole('button', { name: '回復のコードを作り直す' })).toHaveCount(0);
  });

  test('パスキーのない人は作れない', async () => {
    const visitor = new Visitor();
    await visitor.login(newHandle('nokey'));
    const response = await visitor.post('/api/account/recovery-code');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'no_passkey' });
  });

  test('コードはコピーできる', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await addAuthenticator(page);
    await page.goto('/signup');
    await page.getByLabel('ユーザー名').fill(newHandle('copier'));
    await expect(page.getByText('使えます', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'パスキーを作る' }).click();
    const code = (await page.locator('[data-recovery-code]').textContent())!;
    await page.getByRole('button', { name: 'コードをコピーする' }).click();
    await expect(page.getByRole('button', { name: 'コピーしました' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  });
});

test.describe('見た目', () => {
  for (const width of [390, 1440]) {
    test(`幅${width}：axe の critical と serious が0。横にはみ出さない`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await addAuthenticator(page);
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'パスキーでログイン' })).toBeVisible();
      await page.getByRole('button', { name: '回復のコードで入る' }).click();
      await expect(page.getByLabel('回復のコード')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);

      await page.goto('/signup');
      await page.getByLabel('ユーザー名').fill(newHandle(`axe${width}`));
      await expect(page.getByText('使えます', { exact: true })).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);

      await page.getByRole('button', { name: 'パスキーを作る' }).click();
      await expect(page.locator('[data-recovery-code]')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);

      await page.goto('/account');
      await expect(page.getByRole('button', { name: 'パスキーを足す' })).toBeVisible();
      await page.getByRole('button', { name: '回復のコードを作り直す' }).click();
      await expect(page.locator('[data-recovery-code]')).toBeVisible();
      expect(await runAxe(page)).toEqual([]);
      expect(await pageOverflow(page)).toBe(0);
    });
  }
});
