// AI の鍵と、AI の口 /api/v1（docs/tasks/T037.md）。手元の偽の GitHub と本物の workerd で通す。
// 1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_LIMITS } from '../worker/quotaLimits';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
/** 開発のデータの、承認済みの作品（リミックスの元に使う）。 */
const PUBLIC_WORK = 'seed-trail-guide';
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const CONFIRM = { own: true, mit: true, terms: true };

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

/** 手元の D1 か R2 のファイルを全部つないだもの（生の値が残っていないかを探す）。 */
function dump(kind: 'd1' | 'r2'): string {
  const dir = join(PERSIST, 'v3', kind);
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  return Buffer.concat(files.map((entry) => readFileSync(join(entry.parentPath, entry.name)))).toString('latin1');
}

async function person(label = 'aikey') {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  const [{ user_id: id }] = d1<{ user_id: string }>(`SELECT user_id FROM identities WHERE provider = 'github' AND label = ${quote(login)}`);
  return { visitor, login, handle, id };
}

async function makeKey(visitor: Visitor, name = 'Claude Code') {
  const response = await visitor.post('/api/account/ai-keys', { name, ...CONFIRM });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { key: { id: string; name: string; created_at: number; last_used_at: number | null }; secret: string };
}

/** AI の口を呼ぶ。cookie は付けない。言語は、渡さなければ日本語（url が言語のない道になる）。 */
function api(key: string | null, path: string, { method = 'GET', body, headers = {} }: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return fetch(new URL(path, ownOrigin()), {
    method,
    redirect: 'manual',
    headers: {
      'Accept-Language': 'ja',
      ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** AI が作る形の1つの HTML（文書で包み、<title> を付ける）。 */
const workHtml = (part: string, { title = '波紋のボタン', label = '押す' }: { title?: string | null; label?: string } = {}) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
${title === null ? '' : `<title>${title}</title>`}
</head>
<body>
<div data-ld-part="${part}"><button type="button">${label}</button></div>
<style>
[data-ld-part="${part}"] { --_accent: var(--ld-accent, #ff6a3d); --_radius: var(--ld-radius, 10px); }
[data-ld-part="${part}"] button { background: var(--_accent); border-radius: var(--_radius); }
</style>
<script type="module">
function mount(root) {
  const button = root.querySelector('button');
  const onClick = () => root.toggleAttribute('data-on');
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}
mount(document.querySelector('[data-ld-part="${part}"]'));
</script>
</body>
</html>
`;

type Put = { id: string; version: string; url: string; code_url: string; visibility: string };

async function put(key: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Put> {
  const response = await api(key, '/api/v1/works', { method: 'POST', body, headers });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as Put;
}

const latestRevision = (workId: string) => d1<{ id: string; status: string; version: string; title: string; made_with: string; thumb_w: number }>(`SELECT id, status, version, title, made_with, thumb_w FROM revisions WHERE work_id = ${quote(workId)} ORDER BY created_at DESC, rowid DESC LIMIT 1`)[0];

test.describe('AI の鍵（アカウント）', () => {
  test('作る、一覧、消す。生の値は作ったときだけ。持つのはハッシュと決まった項目だけ', async () => {
    const { visitor, id } = await person();
    const made = await makeKey(visitor, '仕事のパソコン');
    expect(made.secret).toMatch(/^ld_[A-Za-z0-9]{40}$/);
    expect(made.key).toMatchObject({ name: '仕事のパソコン', last_used_at: null });

    const account = await visitor.account();
    expect(account.ai_keys).toEqual([made.key]);
    expect(JSON.stringify(account)).not.toContain(made.secret);

    const [row] = d1<Record<string, unknown>>(`SELECT * FROM ai_keys WHERE id = ${quote(made.key.id)}`);
    expect(Object.keys(row).sort()).toEqual(['created_at', 'deleted_at', 'id', 'key_hash', 'last_used_at', 'name', 'user_id']);
    expect(row).toMatchObject({ user_id: id, name: '仕事のパソコン', deleted_at: null });
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.key_hash).not.toContain(made.secret.slice(3));

    expect((await visitor.post(`/api/account/ai-keys/${made.key.id}/delete`)).status).toBe(204);
    expect((await visitor.account()).ai_keys).toEqual([]);
    expect(d1<{ deleted_at: number | null }>(`SELECT deleted_at FROM ai_keys WHERE id = ${quote(made.key.id)}`)[0].deleted_at).toBeGreaterThan(0);
    // もう一度消す、ほかの人の鍵を消す：404
    expect((await visitor.post(`/api/account/ai-keys/${made.key.id}/delete`)).status).toBe(404);
    const other = await person('aikey-other');
    const theirs = await makeKey(other.visitor);
    expect((await visitor.post(`/api/account/ai-keys/${theirs.key.id}/delete`)).status).toBe(404);
    expect(await api(theirs.secret, '/api/v1/works').then((r) => r.status)).toBe(200);
  });

  test('同意の3つと名前が要る。1人5本まで（消した鍵は数えない）。外の Origin とログインなしは断る', async () => {
    const { visitor } = await person();
    for (const body of [{ name: 'x' }, { name: 'x', own: true, mit: true }, { name: 'x', ...CONFIRM, terms: 'yes' }]) {
      const response = await visitor.post('/api/account/ai-keys', body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('confirm_required');
    }
    for (const name of ['', '   ', 'a'.repeat(41), 'a\nb', 7]) {
      const response = await visitor.post('/api/account/ai-keys', { name, ...CONFIRM });
      expect(response.status, String(name)).toBe(400);
      expect((await response.json()).error).toBe('bad_name');
    }
    expect((await visitor.post('/api/account/ai-keys', { name: 'x', ...CONFIRM }, 'https://evil.example')).status).toBe(403);
    expect((await new Visitor().post('/api/account/ai-keys', { name: 'x', ...CONFIRM })).status).toBe(401);

    const keys = [];
    for (let i = 0; i < 5; i += 1) keys.push(await makeKey(visitor, `鍵${i}`));
    const sixth = await visitor.post('/api/account/ai-keys', { name: '6本目', ...CONFIRM });
    expect(sixth.status).toBe(409);
    expect((await sixth.json()).error).toBe('too_many');
    expect((await visitor.post(`/api/account/ai-keys/${keys[0].key.id}/delete`)).status).toBe(204);
    await makeKey(visitor, '空いたので作る');
    expect((await visitor.account()).ai_keys).toHaveLength(5);
  });

  test('退会すると、鍵の行も消え、鍵は 401', async () => {
    const { visitor, id } = await person();
    const made = await makeKey(visitor);
    expect((await api(made.secret, '/api/v1/works')).status).toBe(200);
    expect((await visitor.post('/api/account/delete')).status).toBe(204);
    expect(d1(`SELECT id FROM ai_keys WHERE user_id = ${quote(id)}`)).toEqual([]);
    expect(d1(`SELECT key FROM quotas WHERE key LIKE ${quote(`api-%:${id}`)}`)).toEqual([]);
    expect((await api(made.secret, '/api/v1/works')).status).toBe(401);
  });

  test('画面：鍵を作ると1回だけ見え、一覧に名前が出る。消すと一覧から消える', async ({ page }) => {
    const login = unique('aikeyui');
    await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
    await page.goto(`/auth/github?next=${encodeURIComponent('/account')}`);
    await expect(page).toHaveURL('/account');
    const section = page.locator('section', { has: page.getByRole('heading', { name: 'AI の鍵' }) }).last();
    const create = section.getByRole('button', { name: '鍵を作る' });
    await section.getByLabel('鍵の名前').fill('ノートの Claude Code');
    await expect(create).toBeDisabled();
    for (const box of await section.getByRole('checkbox').all()) await box.check();
    await create.click();
    const secret = (await section.locator('[data-ai-key]').textContent())!;
    expect(secret).toMatch(/^ld_[A-Za-z0-9]{40}$/);
    await expect(section.getByText('ノートの Claude Code')).toBeVisible();
    // 読み直すと、もう見えない
    await page.reload();
    await expect(section.getByText('ノートの Claude Code')).toBeVisible();
    await expect(section.locator('[data-ai-key]')).toHaveCount(0);
    expect(await page.content()).not.toContain(secret);
    await section.getByRole('button', { name: 'ノートの Claude Code を消す' }).click();
    await expect(section.getByText('ノートの Claude Code')).toHaveCount(0);
    expect((await api(secret, '/api/v1/works')).status).toBe(401);
  });
});

test.describe('AI の口 /api/v1', () => {
  test('鍵を作る → 置く → 本人には作品のページが見え、ほかの人には 404 → 新しい版 → 一覧と取得 → 鍵を消すと 401', async ({ page }) => {
    const owner = await person('aiowner');
    const { secret, key } = await makeKey(owner.visitor);
    const part = unique('ripple-');

    // 置く。題は <title> から。自分だけ（本人だけ、審査なし。MCP001）。サムネイルなし。url の言語は Accept-Language（ja なら言語のない道）
    const first = await put(secret, { html: workHtml(part) }, { 'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.5' });
    expect(first).toEqual({ id: part, version: '1', url: `${ownOrigin()}/p/${part}`, code_url: `${ownOrigin()}/p/${part}/code`, visibility: 'private' });
    const revision = latestRevision(part);
    expect(revision).toMatchObject({ status: 'private', version: '1', title: '波紋のボタン', made_with: 'ai-assisted', thumb_w: 0 });
    expect(d1<{ status: string; remix_of: string | null }>(`SELECT status, remix_of FROM works WHERE id = ${quote(part)}`)[0]).toEqual({ status: 'private', remix_of: null });
    // どの AI から置いたか：鍵で X-Ludion-Client がなければ API
    expect(d1<{ via: string | null }>(`SELECT via FROM revisions WHERE id = ${quote(revision.id)}`)[0].via).toBe('API');
    // 最後に使った日が入る（日の単位）
    const [used] = d1<{ last_used_at: number }>(`SELECT last_used_at FROM ai_keys WHERE id = ${quote(key.id)}`);
    expect(used.last_used_at % (24 * 60 * 60 * 1000)).toBe(0);

    // 本人：自分だけの作品のページが見える。残さない。枠で動く
    const own = await owner.visitor.fetch(first.url);
    expect(own.status).toBe(200);
    expect(own.headers.get('cache-control')).toBe('private, no-store');
    expect(await own.text()).toContain(`/draft-frame/${revision.id}/desktop.html`);
    expect((await owner.visitor.fetch(`/draft-frame/${revision.id}/desktop.html`, { headers: FROM_IFRAME })).status).toBe(200);
    await page.context().addCookies([{ name: 'fake_user', value: owner.login, url: FAKE_GITHUB }]);
    await page.goto(`/auth/github?next=${encodeURIComponent(`/p/${part}`)}`);
    await expect(page).toHaveURL(`/p/${part}`);
    await expect(page.frameLocator('iframe[data-ld-frame]').first().getByRole('button', { name: '押す' })).toBeVisible();

    // ほかの人：ない作品と同じ 404
    const stranger = await person('aistranger');
    const strangerKey = (await makeKey(stranger.visitor)).secret;
    for (const visitor of [new Visitor(), stranger.visitor]) {
      expect((await visitor.fetch(`/p/${part}`)).status).toBe(404);
      expect((await visitor.fetch(`/p/${part}/code`)).status).toBe(404);
      expect((await visitor.fetch(`/draft-frame/${revision.id}/desktop.html`, { headers: FROM_IFRAME })).status).toBe(404);
    }
    const strangerGet = await api(strangerKey, `/api/v1/works/${part}`);
    expect(strangerGet.status).toBe(404);
    expect(await strangerGet.json()).toMatchObject({ error: 'not_found' });
    expect(((await (await api(strangerKey, '/api/v1/works')).json()) as { works: unknown[] }).works).toEqual([]);
    expect(((await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string }[] }).works.some((work) => work.id === part)).toBe(false);

    // 新しい版。自分だけの作品は、審査なしですぐ今の版（版の番号が上がる）。題を渡せばその題。X-Ludion-Client が印になる
    const second = await api(secret, `/api/v1/works/${part}/versions`, { method: 'POST', body: { html: workHtml(part, { label: '押して' }), title: '直した波紋' }, headers: { 'X-Ludion-Client': 'Claude Code' } });
    expect(second.status, await second.clone().text()).toBe(201);
    expect(await second.json()).toEqual({ ...first, version: '2' });
    expect(latestRevision(part)).toMatchObject({ title: '直した波紋', version: '2', status: 'private' });
    expect(d1<{ version: string; status: string }>(`SELECT version, status FROM works WHERE id = ${quote(part)}`)[0]).toEqual({ version: '2', status: 'private' });
    expect(d1<{ via: string | null }>(`SELECT via FROM revisions WHERE id = ${quote(latestRevision(part).id)}`)[0].via).toBe('Claude Code');
    // 自分の置き場に、どの AI から来たかの印（いちばん新しく AI から置いた版）
    const mine = (await (await owner.visitor.fetch('/api/post/works')).json()) as { works: { id: string; via: string | null; private: boolean }[] };
    expect(mine.works.find((work) => work.id === part)).toMatchObject({ via: 'Claude Code', private: true });

    // 一覧と取得
    const list = (await (await api(secret, '/api/v1/works')).json()) as { works: Record<string, unknown>[] };
    expect(list.works).toEqual([{ id: part, title: '直した波紋', visibility: 'private', status: 'private', version: '2', updated_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), url: first.url }]);
    const got = (await (await api(secret, `/api/v1/works/${part}`)).json()) as Record<string, string | null>;
    expect(got).toMatchObject({ id: part, title: '直した波紋', visibility: 'private', status: 'private', version: '2', from: null, url: first.url });
    const code = got.code!.split('\n');
    expect(code[0]).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${part} (MIT) -->`);
    expect(got.code).toContain('押して');
    expect(got.code).toContain(`mount(document.querySelector('[data-ld-part="${part}"]'));`);
    // 取ったコードをそのまま置き直せる（クレジット行は外して作り直す）
    expect((await api(secret, `/api/v1/works/${part}/versions`, { method: 'POST', body: { html: got.code } })).status).toBe(201);

    // 本人がサイトで公開する（審査に出して承認）。その後に置くと、その作品の下書きの版。公開の版は変わらない
    const reviewer = await person('aireviewer');
    d1(`UPDATE users SET is_operator = 1 WHERE id = ${quote(reviewer.id)}`);
    const current = d1<{ id: string; content_hash: string }>(`SELECT id, content_hash FROM revisions WHERE work_id = ${quote(part)} AND version = '3'`)[0];
    // 公開するにはサムネイルが要る。ここでは D1 で入れて、公開の流れだけを確かめる（サムネイルの扱いは post.spec.ts）
    d1(`UPDATE revisions SET thumb_w = 800, thumb_h = 600 WHERE id = ${quote(current.id)}`);
    expect((await owner.visitor.post(`/api/post/works/${part}/publish`, CONFIRM)).status).toBe(200);
    // 審査中は新しい版を置けない
    const inReview = await api(secret, `/api/v1/works/${part}/versions`, { method: 'POST', body: { html: workHtml(part) } });
    expect(inReview.status).toBe(409);
    expect((await inReview.json()).error).toBe('in_review');
    expect((await reviewer.visitor.post(`/api/review/revisions/${current.id}/approve`, { content_hash: current.content_hash })).status).toBe(200);
    const third = await api(secret, `/api/v1/works/${part}/versions`, { method: 'POST', body: { html: workHtml(part, { label: '次の版' }) } });
    expect(third.status).toBe(201);
    expect(await third.json()).toMatchObject({ id: part, version: '4', visibility: 'public' });
    expect(latestRevision(part)).toMatchObject({ status: 'draft', version: '4' });
    expect(d1<{ version: string; status: string }>(`SELECT version, status FROM works WHERE id = ${quote(part)}`)[0]).toEqual({ version: '3', status: 'approved' });
    expect(await (await new Visitor().fetch(`/p/${part}/code?public`)).text()).not.toContain('次の版');

    // 鍵を消すと 401
    expect((await owner.visitor.post(`/api/account/ai-keys/${key.id}/delete`)).status).toBe(204);
    for (const [path, method] of [['/api/v1/works', 'GET'], [`/api/v1/works/${part}`, 'GET'], ['/api/v1/works', 'POST']] as const) {
      const response = await api(secret, path, { method, ...(method === 'POST' ? { body: { html: workHtml(part) } } : {}) });
      expect(response.status, `${method} ${path}`).toBe(401);
      expect(await response.json()).toMatchObject({ error: 'unauthorized', message: expect.any(String) });
    }
  });

  test('鍵がない、違う、cookie だけ：401。CORS の頭は付けない', async () => {
    const { visitor } = await person();
    const { secret } = await makeKey(visitor);
    const wrong = `ld_${'A'.repeat(40)}`;
    for (const key of [null, wrong, secret.slice(0, -1), `${secret}x`, 'ld_', 'Basic abc']) {
      const response = await api(key, '/api/v1/works');
      expect(response.status, String(key)).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('Bearer');
      expect(await response.json()).toMatchObject({ error: 'unauthorized', message: expect.any(String) });
    }
    // cookie のログインでは動かない
    const cookieOnly = await visitor.fetch('/api/v1/works', { headers: { Origin: ownOrigin() } });
    expect(cookieOnly.status).toBe(401);
    const ok = await api(secret, '/api/v1/works', { headers: { Origin: 'https://evil.example' } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    const preflight = await api(null, '/api/v1/works', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
    expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('ほかの人の作品に版を置く、取る：404。形の合わない HTML：422 と直し方（日本語と英語）', async () => {
    const owner = await person();
    const ownerKey = (await makeKey(owner.visitor)).secret;
    const part = unique('mine-');
    await put(ownerKey, { html: workHtml(part) });
    const other = await person('aiother');
    const otherKey = (await makeKey(other.visitor)).secret;
    for (const path of [`/api/v1/works/${part}/versions`, '/api/v1/works/no-such-work/versions', '/api/v1/works/BAD!/versions']) {
      const response = await api(otherKey, path, { method: 'POST', body: { html: workHtml(part, { label: '乗っ取り' }) } });
      expect(response.status, path).toBe(404);
      expect(await response.json()).toMatchObject({ error: 'not_found', message: expect.any(String) });
    }
    expect(latestRevision(part).title).toBe('波紋のボタン');

    // 根の外を指す CSS と外のスクリプト：必須の問題
    const bad = `<div data-ld-part="bad-x"><p>x</p></div>\n<style>body { color: red; }</style>`;
    const ja = await api(ownerKey, '/api/v1/works', { method: 'POST', body: { html: bad }, headers: { 'Accept-Language': 'ja,en;q=0.5' } });
    expect(ja.status).toBe(422);
    const jaBody = (await ja.json()) as { error: string; message: string; problems: { message: string; fix: string }[] };
    expect(jaBody.error).toBe('invalid_work');
    expect(jaBody.problems.length).toBeGreaterThan(0);
    for (const problem of jaBody.problems) expect(Object.keys(problem).sort()).toEqual(['fix', 'message']);
    expect(jaBody.problems.map((p) => p.message).join('\n')).toContain('根');
    const en = await api(ownerKey, '/api/v1/works', { method: 'POST', body: { html: bad }, headers: { 'Accept-Language': 'en-US,ja;q=0.3' } });
    const enBody = (await en.json()) as typeof jaBody;
    expect(enBody.problems.map((p) => p.message).join('\n')).toContain('not under the root');
    expect(enBody.message).toMatch(/^The work/);

    const external = await api(ownerKey, '/api/v1/works', { method: 'POST', body: { html: `<div data-ld-part="ext-x">x</div><script src="https://cdn.example/x.js"></script>` }, headers: { 'Accept-Language': 'en' } });
    expect(external.status).toBe(422);
    expect(((await external.json()) as typeof jaBody).problems).toEqual([{ message: 'It has a <script src> that loads an outside file', fix: expect.any(String) }]);

    // 形の合わない本文
    const cases: [unknown, number, string][] = [
      ['not json', 400, 'bad_request'],
      [[], 400, 'bad_request'],
      [{}, 400, 'bad_html'],
      [{ html: 1 }, 400, 'bad_html'],
      [{ html: 'x', title: 'a'.repeat(121) }, 400, 'bad_title'],
      [{ html: 'x', publish: true }, 400, 'unknown_field'],
      [{ html: '' }, 422, 'invalid_work'],
      [{ html: 'x'.repeat(256 * 1024 + 1) }, 413, 'too_large'],
    ];
    for (const [body, status, error] of cases) {
      const response = await api(ownerKey, '/api/v1/works', { method: 'POST', body });
      expect(response.status, JSON.stringify(body).slice(0, 40)).toBe(status);
      expect(await response.json()).toMatchObject({ error, message: expect.any(String) });
    }
    const noType = await api(ownerKey, '/api/v1/works', { method: 'POST', body: { html: workHtml(part) }, headers: { 'Content-Type': 'text/plain' } });
    expect(noType.status).toBe(400);
    // 版の口は from を受けない
    const fromOnVersion = await api(ownerKey, `/api/v1/works/${part}/versions`, { method: 'POST', body: { html: workHtml(part), from: PUBLIC_WORK } });
    expect(fromOnVersion.status).toBe(400);
    expect((await fromOnVersion.json()).error).toBe('unknown_field');
  });

  test('題：渡したもの、なければ <title>、なければ「無題」（英語は Untitled）。from：公開の作品だけ', async () => {
    const owner = await person();
    const key = (await makeKey(owner.visitor)).secret;
    const named = await put(key, { html: workHtml(unique('named-'), { title: '&lt;光る&gt; ボタン' }) });
    expect(latestRevision(named.id).title).toBe('<光る> ボタン');
    const given = await put(key, { html: workHtml(unique('given-')), title: '  渡した題  ' });
    expect(latestRevision(given.id).title).toBe('渡した題');
    const untitled = await put(key, { html: workHtml(unique('untitled-'), { title: null }) }, { 'Accept-Language': 'ja' });
    expect(latestRevision(untitled.id).title).toBe('無題');
    const english = await put(key, { html: workHtml(unique('english-'), { title: null }) }, { 'Accept-Language': 'en' });
    expect(latestRevision(english.id).title).toBe('Untitled');
    expect(english.url).toBe(`${ownOrigin()}/en/p/${english.id}`);

    // ID：貼った data-ld-part を使い、取られていれば後ろに乱数
    const again = await put(key, { html: workHtml(named.id) });
    expect(again.id).toMatch(new RegExp(`^${named.id}-[0-9a-f]{4}$`));

    // リミックス：公開の作品から。種類は元の作品から入る
    const [source] = d1<{ category: string; subtype: string }>(`SELECT category, subtype FROM works WHERE id = ${quote(PUBLIC_WORK)} AND status = 'approved'`);
    expect(source).toBeTruthy();
    const remix = await put(key, { html: workHtml(unique('remix-')), from: PUBLIC_WORK });
    expect(d1<{ remix_of: string; category: string; subtype: string }>(`SELECT remix_of, category, subtype FROM works WHERE id = ${quote(remix.id)}`)[0]).toEqual({ remix_of: PUBLIC_WORK, ...source });
    expect((await (await api(key, `/api/v1/works/${remix.id}`)).json()).from).toBe(PUBLIC_WORK);
    for (const from of ['no-such-work-here', named.id, 'BAD!', 7]) {
      const response = await api(key, '/api/v1/works', { method: 'POST', body: { html: workHtml(unique('badfrom-')), from } });
      expect(response.status, String(from)).toBe(422);
      expect(await response.json()).toMatchObject({ error: 'bad_from', message: expect.any(String) });
    }
  });

  test('上限：置くのは1時間30回、読むのは300回。超えたら 429 と次に使える時刻', async () => {
    const { visitor, id } = await person();
    const key = (await makeKey(visitor)).secret;
    const now = Date.now();
    const hours = [now, now + 60 * 60 * 1000].map((time) => new Date(time).toISOString().slice(0, 13));
    for (const hour of hours) {
      d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES (${quote(`api-put:${id}`)}, ${quote(hour)}, ${API_LIMITS.putsPerUserHour}, ${now + 3 * 60 * 60 * 1000})`);
    }
    const limited = await api(key, '/api/v1/works', { method: 'POST', body: { html: workHtml(unique('over-')) } });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string; message: string; retry_at: string };
    expect(body).toMatchObject({ error: 'rate_limited', message: expect.stringContaining('30') });
    const retryAt = Date.parse(body.retry_at);
    expect(retryAt).toBeGreaterThan(now);
    expect(retryAt % (60 * 60 * 1000)).toBe(0);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // 置けなくても、読むのは別に数える
    expect((await api(key, '/api/v1/works')).status).toBe(200);
    for (const hour of hours) {
      d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES (${quote(`api-read:${id}`)}, ${quote(hour)}, ${API_LIMITS.readsPerUserHour}, ${now + 3 * 60 * 60 * 1000}) ON CONFLICT (key, bucket) DO UPDATE SET n = ${API_LIMITS.readsPerUserHour}`);
    }
    const readLimited = await api(key, '/api/v1/works');
    expect(readLimited.status).toBe(429);
    expect(await readLimited.json()).toMatchObject({ error: 'rate_limited', retry_at: expect.any(String) });
  });

  test('鍵の生の値は、D1 と R2 に残らない（ハッシュは D1 にある）', async () => {
    const { visitor } = await person();
    const made = await makeKey(visitor);
    await put(made.secret, { html: workHtml(unique('leak-')) });
    const [{ key_hash: hash }] = d1<{ key_hash: string }>(`SELECT key_hash FROM ai_keys WHERE id = ${quote(made.key.id)}`);
    const database = dump('d1');
    // 探し方が正しいことの対照：ハッシュは見つかる
    expect(database).toContain(hash);
    expect(database).not.toContain(made.secret);
    expect(database).not.toContain(made.secret.slice(3));
    expect(dump('r2')).not.toContain(made.secret.slice(3));
  });

  test('説明：GET /api/v1 は Markdown（鍵なしで読める）。/llms.txt がある', async () => {
    const en = await api(null, '/api/v1', { headers: { 'Accept-Language': 'en' } });
    expect(en.status).toBe(200);
    expect(en.headers.get('content-type')).toMatch(/^text\/markdown/);
    const text = await en.text();
    for (const line of ['POST /api/v1/works', 'POST /api/v1/works/:id/versions', 'GET /api/v1/works', 'GET /api/v1/works/:id', 'Authorization: Bearer ld_', 'invalid_work', 'retry_at', '/p/<id>/code']) expect(text, line).toContain(line);
    const ja = await (await api(null, '/api/v1', { headers: { 'Accept-Language': 'ja' } })).text();
    expect(ja).toContain('| 口 | 受けるもの | 返すもの |');
    const unknown = await api(null, '/api/v1/nothing');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: 'not_found', message: expect.any(String) });

    const llms = await api(null, '/llms.txt');
    expect(llms.status).toBe(200);
    const body = await llms.text();
    expect(body).toContain('/api/v1');
    expect(body).toContain('/p/<id>/code');
  });
});
