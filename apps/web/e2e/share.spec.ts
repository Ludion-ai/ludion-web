// リンクで見せる（SHARE001）。自分だけの作品を、/s/<合言葉> を知っている人だけが見られる形。手元の偽の GitHub と本物の workerd で通す。
// 1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。
// 枠から外へ出られない試験（3つのブラウザ）は e2e/frame-escape.spec.ts の FORMS の shared で流す。回数の制限は e2e/cache.spec.ts。

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '../..');
const WRANGLER = join(REPO, 'node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const NO_STORE = 'private, no-store';
/** 住所の合言葉。住所のオリジンは開いたサイト（本番は https://ludion.ai。workers.dev で開いても ludion.ai）。手元は手元のオリジン */
const TOKEN = /\/s\/([A-Za-z0-9_-]{22})$/;
const shareUrl = (token: string) => `${ownOrigin()}/s/${token}`;

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;
const unique = (label: string) => `${label}${randomBytes(4).toString('hex')}`;

function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

const htmlOf = (id: string) => `<div data-ld-part="${id}"><button type="button">見せる見本</button></div>`;
const cssOf = (id: string) => `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`;

function formOf(id: string, title: string, isNew = true) {
  const form = new FormData();
  form.append('meta', JSON.stringify({ ...(isNew ? { id } : {}), title, category: 'Components', subtype: 'Toggle', tags: ['minimal'], motion: false, made_with: 'human' }));
  form.append('part.html', htmlOf(id));
  form.append('part.css', cssOf(id));
  return form;
}

const CONFIRM = { own: true, mit: true, terms: true };

async function person(label = 'share') {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  return { visitor, login, handle };
}

async function operator() {
  const one = await person('reviewer');
  d1(`UPDATE users SET is_operator = 1 WHERE handle = ${quote(one.handle)}`);
  return one;
}

/** 自分だけで置いた作品。 */
async function privateWork(visitor: Visitor, label = 'shr') {
  const id = unique(`${label}-`);
  const made = await visitor.fetch('/api/post/works', { method: 'POST', body: formOf(id, `見せる見本 ${id}`), headers: { Origin: ownOrigin() } });
  expect(made.status, await made.clone().text()).toBe(201);
  const { revision } = (await made.json()) as { revision: { id: string } };
  const placed = await visitor.post(`/api/post/revisions/${revision.id}/place`, CONFIRM);
  expect(placed.status, await placed.clone().text()).toBe(200);
  return id;
}

const share = (visitor: Visitor, id: string, on: boolean, origin?: string | null) => visitor.post(`/api/post/works/${id}/share`, { on }, origin);

async function turnOn(visitor: Visitor, id: string) {
  const response = await share(visitor, id, true);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { state: string; url: string };
  expect(body.state).toBe('on');
  const token = TOKEN.exec(body.url)?.[1];
  expect(token, body.url).toBeTruthy();
  return token!;
}

/** ない住所と同じ 404 か（キャッシュしない、検索に出さない、参照元を残さない）。 */
async function missing(path: string, visitor = new Visitor()) {
  const response = await visitor.fetch(path);
  expect(response.status, path).toBe(404);
  expect(response.headers.get('cache-control'), path).toBe(NO_STORE);
  expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
  await response.arrayBuffer();
}

test.beforeAll(() => {
  // 前のファイルの試験で、全体の回数の上限に近づいていても落ちないように（1日と1時間の全体の数だけ）
  d1(`DELETE FROM quotas WHERE key IN ('revision:*', 'save:*', 'signup:*')`);
});

test.describe('リンクで見せる（API と Worker の HTML）', () => {
  test('初めはオフで /s/ はない。オンにするとログインなしとほかの人に 200。/p/<id> はほかの人に 404 のまま', async () => {
    const { visitor, handle } = await person();
    const stranger = await person('stranger');
    const id = await privateWork(visitor);

    const first = await visitor.fetch(`/api/post/works/${id}/share`);
    expect(await first.json()).toEqual({ state: 'off', url: null });
    expect(d1(`SELECT share_token, shared_at, share_blocked_at FROM works WHERE id = ${quote(id)}`)).toEqual([{ share_token: null, shared_at: null, share_blocked_at: null }]);
    await missing(`/s/${'A'.repeat(22)}`);

    const token = await turnOn(visitor, id);
    // 押し直しても住所は変わらない
    expect(((await (await share(visitor, id, true)).json()) as { url: string }).url).toBe(shareUrl(token));
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    for (const [label, who] of [['ログインなし', new Visitor()], ['ほかの人', stranger.visitor]] as const) {
      const page = await who.fetch(`/s/${token}`);
      expect(page.status, label).toBe(200);
      expect(page.headers.get('cache-control'), label).toBe('public, max-age=0, s-maxage=60');
      expect(page.headers.get('cache-tag'), label).toBe(`share-${token}`);
      expect(page.headers.get('x-robots-tag'), label).toBe('noindex, nofollow');
      expect(page.headers.get('referrer-policy'), label).toBe('no-referrer');
      expect(page.headers.get('set-cookie'), label).toBeNull();
      const html = await page.text();
      expect(html, label).toContain(`見せる見本 ${id}`);
      expect(html, label).toContain(`@${handle}`);
      expect(html, label).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html, label).toContain('リンクで見せている作品です（審査はしていません）');
      expect(html, label).toContain('Ludion につなぐと、作った物が残る');
      // 絵はサイトの決まった絵。canonical と言語の対応は付けない
      expect(html, label).toContain(`<meta property="og:image" content="${ownOrigin()}/og-home.png">`);
      expect(html, label).not.toContain('rel="canonical"');
      expect(html, label).not.toContain('hreflang');
      // 枠は合言葉の枠。下書きの枠（版の id）は出さない
      expect(html, label).toContain(`/share-frame/${token}/desktop.html`);
      expect(html, label).not.toContain('/draft-frame/');
      // コピーされるコードの1行目はクレジット行（原則4）
      expect(html, label).toContain(`UI by @${handle} — ludion.ai/p/${id} (MIT)`);
      // いいね、保存、リミックス、数は出さない
      expect(html, label).not.toContain('data-work-actions');
      expect(html, label).not.toContain('data-testid="copy-count"');
      expect(html, label).not.toContain('role="tablist"');

      const frame = await who.fetch(`/share-frame/${token}/desktop.html`, { headers: FROM_IFRAME });
      expect(frame.status, label).toBe(200);
      expect(frame.headers.get('cache-control'), label).toBe(NO_STORE);
      expect(frame.headers.get('referrer-policy'), label).toBe('no-referrer');
      expect(frame.headers.get('content-security-policy'), label).toContain("frame-ancestors 'self'");
      expect(frame.headers.get('content-security-policy'), label).toContain('sandbox allow-scripts allow-forms');
      expect(await frame.text(), label).toContain('見せる見本');

      // 本文の読み口と、行の住所
      const file = await who.fetch(`/s/${token}/file/1/part.css`);
      expect(file.status, label).toBe(200);
      expect(await file.text(), label).toBe(cssOf(id));
      await missing(`/s/${token}/file/9/part.css`, who);
      const code = await who.fetch(`/s/${token}/code/part.css`);
      expect(code.status, label).toBe(200);
      await code.arrayBuffer();
      await missing(`/s/${token}/code/index.html`, who);

      // /p/<id> は持ち主のほかには今までどおり 404
      const own = await who.fetch(`/p/${id}`);
      expect(own.status, label).toBe(404);
      await own.arrayBuffer();
    }
    // 英語の道
    const en = await new Visitor().fetch(`/en/s/${token}`);
    expect(en.status).toBe(200);
    expect(await en.text()).toContain('This work is shared by link (it has not been reviewed).');
    // 枠の外から開くと /s/ へ戻す
    const direct = await new Visitor().fetch(`/share-frame/${token}/desktop.html`);
    expect(direct.status).toBe(302);
    expect(direct.headers.get('location')).toBe(`/s/${token}`);
  });

  test('オフにすると古い住所は 404。もう一度オンにすると新しい住所', async () => {
    const { visitor } = await person();
    const id = await privateWork(visitor);
    const first = await turnOn(visitor, id);
    const off = await share(visitor, id, false);
    expect(await off.json()).toEqual({ state: 'off', url: null });
    await missing(`/s/${first}`);
    await missing(`/s/${first}/file/1/part.css`);
    const frame = await new Visitor().fetch(`/share-frame/${first}/desktop.html`, { headers: FROM_IFRAME });
    expect(frame.status).toBe(404);
    await frame.arrayBuffer();
    const second = await turnOn(visitor, id);
    expect(second).not.toBe(first);
    expect((await new Visitor().fetch(`/s/${second}`)).status).toBe(200);
    await missing(`/s/${first}`);
  });

  test('持ち主のほかは変えられない。Origin が違えば断る。公開の作品と下書きはオンにできない', async () => {
    const { visitor } = await person();
    const stranger = await person('stranger');
    const id = await privateWork(visitor);
    const theirs = await share(stranger.visitor, id, true);
    expect(theirs.status).toBe(404);
    await theirs.arrayBuffer();
    const read = await stranger.visitor.fetch(`/api/post/works/${id}/share`);
    expect(read.status).toBe(404);
    await read.arrayBuffer();
    const evil = await share(visitor, id, true, 'https://evil.example');
    expect(evil.status).toBe(403);
    await evil.arrayBuffer();
    const anonymous = await share(new Visitor(), id, true);
    expect(anonymous.status).toBe(401);
    await anonymous.arrayBuffer();
    expect(d1(`SELECT share_token FROM works WHERE id = ${quote(id)}`)).toEqual([{ share_token: null }]);
  });

  test('一覧、sitemap、/api/works、作り手のページ、公開の作品を読む AI の道具に出ない', async () => {
    const { visitor, handle } = await person();
    const id = await privateWork(visitor);
    const token = await turnOn(visitor, id);
    const anyone = new Visitor();
    const works = (await (await anyone.fetch('/api/works')).json()) as { works: { id: string }[] };
    expect(works.works.some((work) => work.id === id)).toBe(false);
    const sitemap = await (await anyone.fetch('/sitemap.xml')).text();
    expect(sitemap).not.toContain(id);
    expect(sitemap).not.toContain(token);
    const home = await (await anyone.fetch('/')).text();
    expect(home).not.toContain(id);
    const creator = await anyone.fetch(`/c/${handle}`);
    expect(creator.status).toBe(404);
    await creator.arrayBuffer();
    const llms = await (await anyone.fetch('/llms.txt')).text();
    expect(llms).not.toContain(token);
    // 公開の作品を読む口（get_public_work が使う）：ほかの人には、ない作品と同じ
    const stranger = await person('stranger');
    const key = await stranger.visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
    const { secret } = (await key.json()) as { secret: string };
    const publicRead = await fetch(new URL(`/api/v1/works/${id}/outline`, ownOrigin()), { headers: { Authorization: `Bearer ${secret}` } });
    expect(publicRead.status).toBe(404);
    expect(JSON.stringify(await publicRead.json())).not.toContain(token);
  });

  test('AI の口からはオンにできない。持ち主の AI には今の状態と住所だけを返す', async () => {
    const { visitor } = await person();
    const id = await privateWork(visitor);
    const key = await visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
    const { secret } = (await key.json()) as { secret: string };
    const bearer = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Origin: ownOrigin() };
    // サイトの口に鍵で来ても、セッションがないので通らない
    const viaSite = await fetch(new URL(`/api/post/works/${id}/share`, ownOrigin()), { method: 'POST', headers: bearer, body: JSON.stringify({ on: true }) });
    expect(viaSite.status).toBe(401);
    await viaSite.arrayBuffer();
    // AI の口には、変える道がない
    for (const path of [`/api/v1/works/${id}/share`, `/api/v1/works/${id}/link`]) {
      const response = await fetch(new URL(path, ownOrigin()), { method: 'POST', headers: bearer, body: JSON.stringify({ on: true }) });
      expect(response.status, path).toBe(404);
      await response.arrayBuffer();
    }
    expect(d1(`SELECT share_token FROM works WHERE id = ${quote(id)}`)).toEqual([{ share_token: null }]);

    const before = (await (await fetch(new URL(`/api/v1/works/${id}/outline`, ownOrigin()), { headers: bearer })).json()) as { share?: unknown };
    expect(before.share).toEqual({ state: 'off', url: null });
    const token = await turnOn(visitor, id);
    const after = (await (await fetch(new URL(`/api/v1/works/${id}/outline`, ownOrigin()), { headers: bearer })).json()) as { share?: unknown };
    expect(after.share).toEqual({ state: 'on', url: shareUrl(token) });
  });

  test('運営が止めると 404 になり、持ち主はオンにできない。戻すと、新しい住所でオンにできる', async () => {
    const { visitor, handle } = await person();
    const { visitor: reviewer } = await operator();
    const id = await privateWork(visitor);
    const token = await turnOn(visitor, id);
    // 運営のほかは止められない（道があることも見せない）
    const notOperator = await visitor.post('/api/review/shares/block', { address: shareUrl(token) });
    expect(notOperator.status).toBe(404);
    await notOperator.arrayBuffer();

    const blocked = await reviewer.post('/api/review/shares/block', { address: shareUrl(token) });
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toEqual({ work_id: id, handle, blocked: true, cache_purged: true });
    await missing(`/s/${token}`);
    const refused = await share(visitor, id, true);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'share_blocked', state: 'blocked', url: null });
    expect(await (await visitor.fetch(`/api/post/works/${id}/share`)).json()).toEqual({ state: 'blocked', url: null });

    const unblocked = await reviewer.post('/api/review/shares/unblock', { address: id });
    expect(await unblocked.json()).toEqual({ work_id: id, handle, blocked: false });
    const next = await turnOn(visitor, id);
    expect(next).not.toBe(token);
    await missing(`/s/${token}`);
    const unknown = await reviewer.post('/api/review/shares/block', { address: 'https://ludion.ai/s/nothing' });
    expect(unknown.status).toBe(404);
    await unknown.arrayBuffer();
  });

  test('取り下げると /s/ は 404 で、合言葉も捨てる', async () => {
    const { visitor } = await person();
    const id = await privateWork(visitor);
    const token = await turnOn(visitor, id);
    const revoked = await visitor.post(`/api/post/works/${id}/revoke`);
    expect(revoked.status).toBe(200);
    await revoked.arrayBuffer();
    await missing(`/s/${token}`);
    expect(d1(`SELECT share_token FROM works WHERE id = ${quote(id)}`)).toEqual([{ share_token: null }]);
  });
});

async function logInPage(page: Page, path: string, login: string) {
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
}

const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

test.describe('リンクで見せる（画面）', () => {
  test('設定のタブのスイッチ：初めはオフ。押すとオンになり住所が出る。/s/ で持ち主に知らせと「オフにする」。押すと作品のページへ戻り、古い住所は 404', async ({ page, browser }) => {
    const { visitor, login } = await person('screen');
    const id = await privateWork(visitor);
    await logInPage(page, `/p/${id}`, login);
    await hydrated(page);
    await page.getByRole('tab', { name: '設定' }).click();
    const toggle = page.getByRole('switch', { name: 'リンクで見せる' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    await expect(page.locator('[data-share-address]')).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const address = page.getByLabel('見せる住所');
    await expect(address).toHaveValue(TOKEN);
    const token = TOKEN.exec(await address.inputValue())![1];

    // ほかの人（ログインなし）の画面：作品が動き、札がある。持ち主の知らせはない
    const anon = await browser.newPage();
    await anon.goto(`/s/${token}`);
    await hydrated(anon);
    await expect(anon.getByRole('heading', { level: 1 })).toHaveText(`見せる見本 ${id}`);
    await expect(anon.locator('[data-share-notice]')).toHaveText('リンクで見せている作品です（審査はしていません）');
    await expect(anon.frameLocator('iframe[data-ld-frame]').locator('#ld-host')).toBeAttached();
    await expect(anon.locator('[data-share-owner]')).toHaveCount(0);
    await expect(anon.getByRole('button', { name: '全部をコピー' })).toBeVisible();
    await anon.close();

    // 持ち主が /s/ を開く
    await page.goto(`/s/${token}`);
    await hydrated(page);
    const owner = page.locator('[data-share-owner]');
    await expect(owner).toContainText('リンクで見せています');
    await owner.getByRole('button', { name: 'オフにする' }).click();
    await expect(page).toHaveURL(`/p/${id}`);
    await missing(`/s/${token}`);
  });
});
