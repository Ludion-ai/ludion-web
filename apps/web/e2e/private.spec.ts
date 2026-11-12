// 自分だけの作品と、自分の置き場（docs/tasks/T036.md の終わりの条件）。手元の偽の GitHub と本物の workerd で通す。
// 1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。
// 枠から外へ出られない試験（3つのブラウザ）は e2e/frame-escape.spec.ts の FORMS の private で流す。

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '../..');
const WRANGLER = join(REPO, 'node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;
const NO_STORE = 'private, no-store';

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

/** 手元で作る PNG。 */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const name = Buffer.from(type);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
    return Buffer.concat([length, name, data, crc]);
  };
  const raw = Buffer.alloc((width * 4 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y += 1) {
    raw[at++] = 0;
    for (let x = 0; x < width; x += 1) for (const value of [x % 256, y % 256, 90, 255]) raw[at++] = value;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const THUMB = png(900, 700);

const htmlOf = (id: string, inner = '<button type="button">押す</button>') => `<div data-ld-part="${id}">${inner}</div>`;
const cssOf = (id: string) => `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`;

interface DraftOptions {
  title?: string;
  thumb?: boolean;
  inner?: string;
  remixOf?: string;
}

function formOf(id: string, { title = `自分だけの見本 ${id}`, thumb = true, inner, remixOf }: DraftOptions = {}, isNew = true) {
  const form = new FormData();
  form.append(
    'meta',
    JSON.stringify({
      ...(isNew ? { id } : {}),
      title,
      category: 'Components',
      subtype: 'Toggle',
      tags: ['minimal'],
      motion: false,
      made_with: 'human',
      ...(remixOf ? { remix_of: remixOf } : {}),
    }),
  );
  form.append('part.html', htmlOf(id, inner));
  form.append('part.css', cssOf(id));
  if (thumb) form.append('thumb', new Blob([new Uint8Array(THUMB)], { type: 'image/png' }), 'x.png');
  return form;
}

const postForm = (visitor: Visitor, path: string, form: FormData) => visitor.fetch(path, { method: 'POST', body: form, headers: { Origin: ownOrigin() } });

async function person(label = 'private') {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  const [{ id: userId }] = d1<{ id: string }>(`SELECT id FROM users WHERE handle = ${quote(handle)}`);
  return { visitor, login, handle, userId };
}

async function operator() {
  const one = await person('reviewer');
  d1(`UPDATE users SET is_operator = 1 WHERE handle = ${quote(one.handle)}`);
  return one;
}

type Revision = { id: string; version: string; content_hash: string; frames: { desktop: string; mobile: string }; thumb: string | null };

async function draft(visitor: Visitor, label = 'own', options: DraftOptions = {}) {
  const id = unique(`${label}-`);
  const response = await postForm(visitor, '/api/post/works', formOf(id, options));
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { revision: Revision };
  return { id, revision: body.revision };
}

async function newVersion(visitor: Visitor, id: string, options: DraftOptions = {}) {
  const response = await postForm(visitor, `/api/post/works/${id}/revisions`, formOf(id, options, false));
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { revision: Revision }).revision;
}

const CONFIRM = { own: true, mit: true, terms: true };
const place = (visitor: Visitor, revisionId: string, body: unknown = CONFIRM) => visitor.post(`/api/post/revisions/${revisionId}/place`, body);
const submit = (visitor: Visitor, revisionId: string) => visitor.post(`/api/post/revisions/${revisionId}/submit`, CONFIRM);
const approve = (reviewer: Visitor, revision: { id: string; content_hash: string }) => reviewer.post(`/api/review/revisions/${revision.id}/approve`, { content_hash: revision.content_hash });
const publish = (visitor: Visitor, id: string) => visitor.post(`/api/post/works/${id}/publish`, CONFIRM);
const makePrivate = (visitor: Visitor, id: string) => visitor.post(`/api/post/works/${id}/make-private`);

/** 自分だけで置いた作品。 */
async function privateWork(visitor: Visitor, label = 'own', options: DraftOptions = {}) {
  const made = await draft(visitor, label, options);
  const response = await place(visitor, made.revision.id);
  expect(response.status, await response.clone().text()).toBe(200);
  return made;
}

/** 下書きから公開まで。 */
async function publicWork(visitor: Visitor, reviewer: Visitor, label = 'pub', options: DraftOptions = {}) {
  const made = await draft(visitor, label, options);
  expect((await submit(visitor, made.revision.id)).status).toBe(200);
  expect((await approve(reviewer, made.revision)).status).toBe(200);
  return made;
}

const submittedRevision = (id: string) => d1<{ id: string; content_hash: string }>(`SELECT id, content_hash FROM revisions WHERE work_id = ${quote(id)} AND status = 'submitted'`)[0];
const listed = async (id: string) => ((await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string }[] }).works.some((work) => work.id === id);
const counted = (id: string) => d1<{ views: number; copies: number }>(`SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(copies), 0) AS copies FROM counters WHERE work_id = ${quote(id)}`)[0];

/** ない作品と同じ 404 か。本文は、道に入る ID を伏せて比べる（言語の切り替えのリンクに今の道が入るため）。 */
async function sameAsMissing(actor: Visitor, path: (id: string) => string, id: string, label: string, init: RequestInit = {}) {
  const missing = unique('missing-');
  const [got, none] = await Promise.all([actor.fetch(path(id), init), actor.fetch(path(missing), init)]);
  expect(got.status, `${label} ${path(id)}`).toBe(none.status);
  expect(got.status, `${label} ${path(id)}`).toBeGreaterThanOrEqual(400);
  expect(got.headers.get('cache-control'), `${label} ${path(id)}`).toBe(NO_STORE);
  const [a, b] = await Promise.all([got.text(), none.text()]);
  expect(a.replaceAll(id, 'X'), `${label} ${path(id)} の本文`).toBe(b.replaceAll(missing, 'X'));
}

async function logInPage(page: Page, path: string, login = unique('screen')) {
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
  return login;
}

const hydrated = (page: Page) => page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));

/** 1つの箱に貼るもの。 */
function boxSnippet(id: string, inner = '<button type="button">押す</button>') {
  return [
    `<div data-ld-part="${id}">${inner}</div>`,
    '<style>',
    `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`,
    '</style>',
    '<script type="module">',
    "function mount(root) {\n  const button = root.querySelector('button');\n  const onClick = () => { button.textContent = '押された'; };\n  button.addEventListener('click', onClick);\n  return () => button.removeEventListener('click', onClick);\n}",
    `mount(document.querySelector('[data-ld-part="${id}"]'));`,
    '</script>',
  ].join('\n');
}

const UI = {
  ja: {
    box: 'HTML を貼る、またはファイルを落とす',
    saved: '下書きを保存しました',
    title: '題名',
    own: /自分で作った、または権利がある/,
    mit: /MIT で公開してよい/,
    terms: /に同意します/,
    onlyMe: /^自分だけ/,
    public: /^公開/,
    place: '自分だけで置く',
    notice: '自分だけの作品です。あなたにしか見えません',
  },
  en: {
    box: 'Paste HTML or drop files',
    saved: 'Draft saved',
    title: 'Title',
    own: /I made this UI or have the rights/,
    mit: /published under MIT/,
    terms: /I agree to the/,
    onlyMe: /^Only me/,
    public: /^Public/,
    place: 'Save for only me',
    notice: 'This work is “Only me”. Only you can see it.',
  },
} as const;

test.beforeAll(() => {
  // 前のファイルの試験で、全体の回数の上限に近づいていても落ちないように（1日と1時間の全体の数だけ）
  d1(`DELETE FROM quotas WHERE key IN ('revision:*', 'save:*', 'signup:*')`);
});

test.describe('自分だけで置く（API）', () => {
  test('審査に出さず、すぐ置ける。題と同意の3つが要る。サムネイルは無くてよい。他人の版と置いた版は置けない', async () => {
    const { visitor } = await person();
    const stranger = await person('stranger');
    const made = await draft(visitor, 'place', { thumb: false });

    expect((await place(visitor, made.revision.id, { own: true, mit: true })).status).toBe(400);
    expect((await place(stranger.visitor, made.revision.id)).status).toBe(403);
    expect((await visitor.post(`/api/post/revisions/${made.revision.id}/place`, CONFIRM, 'https://evil.example')).status).toBe(403);
    const placed = await place(visitor, made.revision.id);
    expect(placed.status).toBe(200);
    expect(await placed.json()).toEqual({ id: made.revision.id, status: 'private', work_id: made.id, version: '1' });
    expect(d1(`SELECT status, thumb_w, thumb_key FROM works WHERE id = ${quote(made.id)}`)).toEqual([{ status: 'private', thumb_w: 0, thumb_key: '' }]);
    expect(d1(`SELECT status, submitted_at FROM revisions WHERE work_id = ${quote(made.id)}`)).toEqual([{ status: 'private', submitted_at: null }]);
    // 審査の一覧に出ない
    expect(d1(`SELECT COUNT(*) AS n FROM revisions WHERE work_id = ${quote(made.id)} AND status = 'submitted'`)[0].n).toBe(0);
    expect((await place(visitor, made.revision.id)).status).toBe(409);

    const untitled = await draft(visitor, 'untitled', { title: '' });
    expect((await place(visitor, untitled.revision.id)).status).toBe(422);
  });

  test('自分だけの作品の新しい版は、審査なしで今の版になる。公開の作品の新しい版は置けず、審査に回る', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const own = await privateWork(visitor, 'next');
    const next = await newVersion(visitor, own.id, { inner: '<button type="button">次の版</button>' });
    expect((await place(visitor, next.id)).status).toBe(200);
    expect(d1(`SELECT status, version FROM works WHERE id = ${quote(own.id)}`)).toEqual([{ status: 'private', version: '2' }]);
    const page = await (await visitor.fetch(`/p/${own.id}`)).text();
    expect(page).toContain(`/draft-frame/${next.id}/desktop.html`);
    expect(await (await visitor.fetch(next.frames.desktop, { headers: FROM_IFRAME })).text()).toContain('次の版');

    const pub = await publicWork(visitor, reviewer, 'pubnext');
    const pubNext = await newVersion(visitor, pub.id, { thumb: false });
    const refused = await place(visitor, pubNext.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'public' });
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(pubNext.id)}`)).toEqual([{ status: 'draft' }]);
    expect((await submit(visitor, pubNext.id)).status).toBe(200);
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(pubNext.id)}`)).toEqual([{ status: 'submitted' }]);
  });

  test('101作品目は置けず、理由が返る。今の自分だけの作品の新しい版は置ける', async () => {
    const { visitor, handle } = await person('limit');
    const own = await privateWork(visitor, 'limit');
    const [{ creator_id: creatorId }] = d1<{ creator_id: string }>(`SELECT creator_id FROM works WHERE id = ${quote(own.id)}`);
    // 99作品を D1 に直に足して、100作品にする（API では1日の版の上限に先に当たる）
    const rows = Array.from({ length: 99 }, (_, i) => `(${quote(`${handle}-fill-${i}`)}, ${quote(creatorId)}, 'x', 'component', 'Components', 'Toggle', 'human', '1', 'private', '', 0, 0, 0)`);
    d1(`INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at) VALUES ${rows.join(', ')}`);
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE creator_id = ${quote(creatorId)} AND status = 'private'`)[0].n).toBe(100);

    const extra = await draft(visitor, 'extra');
    const refused = await place(visitor, extra.revision.id);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'private_limit', limit: 100 });
    expect(d1(`SELECT status FROM works WHERE id = ${quote(extra.id)}`)).toEqual([{ status: 'draft' }]);
    // 今の作品の新しい版は数を増やさないので置ける
    const next = await newVersion(visitor, own.id);
    expect((await place(visitor, next.id)).status).toBe(200);
  });
});

test.describe('自分だけの作品は、本人にしか見えない', () => {
  test('ログインしていない人、ほかの人、運営には、2 に書いた全部が、ない作品と同じ 404。本人には見え、残さない', async () => {
    const owner = await person('owner');
    const stranger = await person('stranger');
    const { visitor: reviewer } = await operator();
    const own = await privateWork(owner.visitor, 'hidden');
    const { id, revision } = own;

    // 本人には見え、どの層にも残さない
    for (const path of [`/p/${id}`, `/en/p/${id}`]) {
      const response = await owner.visitor.fetch(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control'), path).toBe(NO_STORE);
      expect(response.headers.get('cache-tag'), path).toBeNull();
      expect(response.headers.get('referrer-policy'), path).toBe('no-referrer');
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex');
      const html = await response.text();
      expect(html, path).toContain(revision.frames.desktop);
      // 共有の画像と canonical を付けない
      expect(html, path).not.toContain('og:image');
      expect(html, path).not.toContain('rel="canonical"');
    }
    const code = await owner.visitor.fetch(`/p/${id}/code`);
    expect(code.status).toBe(200);
    expect(code.headers.get('cache-control')).toBe(NO_STORE);
    expect((await code.text()).split('\n')[0]).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->`);
    for (const path of [revision.frames.desktop, revision.frames.mobile]) {
      const frame = await owner.visitor.fetch(path, { headers: FROM_IFRAME });
      expect(frame.status, path).toBe(200);
      expect(frame.headers.get('cache-control'), path).toBe(NO_STORE);
      const csp = frame.headers.get('content-security-policy')!;
      expect(csp).toContain('sandbox allow-scripts allow-forms');
      expect(csp).not.toContain('allow-same-origin');
      expect(csp).toContain("frame-ancestors 'self'");
      expect(csp).toContain("form-action 'none'");
    }
    const thumb = await owner.visitor.fetch(revision.thumb!);
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('cache-control')).toBe(NO_STORE);

    for (const [label, actor] of [['ログインしていない人', new Visitor()], ['ほかの人', stranger.visitor], ['運営', reviewer]] as const) {
      await sameAsMissing(actor, (x) => `/p/${x}`, id, label);
      await sameAsMissing(actor, (x) => `/en/p/${x}`, id, label);
      await sameAsMissing(actor, (x) => `/p/${x}/code`, id, label);
      await sameAsMissing(actor, (x) => `/frame/${x}/1/desktop.html`, id, label, { headers: FROM_IFRAME });
      await sameAsMissing(actor, (x) => `/w/${x}/1/thumb.webp`, id, label);
      await sameAsMissing(actor, (x) => `/w/${x}/1/og.png`, id, label);
      await sameAsMissing(actor, (x) => `/api/post/remix-source/${x}`, id, label);
      expect((await actor.fetch(revision.frames.desktop, { headers: FROM_IFRAME })).status, label).toBe(404);
      expect((await actor.fetch(revision.thumb!)).status, label).toBe(404);
      expect((await actor.post('/api/count', { work_id: id, type: 'view' })).status, label).toBe(400);
    }
    // 運営の審査の API からも見えない（審査に出されていない）
    expect((await reviewer.fetch(`/api/review/revisions/${revision.id}`)).status).toBe(404);
    const queue = (await (await reviewer.fetch('/api/review/queue')).json()) as { revisions: { work_id: string }[] };
    expect(queue.revisions.some((one) => one.work_id === id)).toBe(false);
    // いいねとしおりは、ない作品と同じ答え
    for (const kind of ['like', 'bookmark']) {
      const [a, b] = await Promise.all([stranger.visitor.post(`/api/works/${id}/${kind}`), stranger.visitor.post(`/api/works/${unique('missing-')}/${kind}`)]);
      expect(a.status).toBe(b.status);
      expect(await a.json()).toEqual(await b.json());
    }

    // 一覧、sitemap、作り手のページ、数に出ない
    expect(await listed(id)).toBe(false);
    for (const path of ['/', '/en', '/sitemap.xml']) expect(await (await new Visitor().fetch(path)).text(), path).not.toContain(id);
    expect((await new Visitor().fetch(`/c/${owner.handle}`)).status).toBe(404);
    expect(((await (await owner.visitor.fetch('/api/account')).json()) as { works_count: number }).works_count).toBe(0);
    expect(((await (await owner.visitor.fetch('/api/account/works')).json()) as { works: unknown[] }).works).toEqual([]);
  });

  test('作り手のページの数と並びに、自分だけの作品を数えない', async () => {
    const owner = await person('mixed');
    const { visitor: reviewer } = await operator();
    const pub = await publicWork(owner.visitor, reviewer, 'shown');
    const own = await privateWork(owner.visitor, 'kept');
    const page = await (await new Visitor().fetch(`/c/${owner.handle}`)).text();
    expect(page).toContain(pub.id);
    expect(page).not.toContain(own.id);
    // ほかの作品の並び（公開の作品のページ）にも出ない
    expect(await (await new Visitor().fetch(`/p/${pub.id}`)).text()).not.toContain(own.id);
    const sitemap = await (await new Visitor().fetch('/sitemap.xml')).text();
    expect(sitemap).toContain(`/p/${pub.id}`);
    expect(sitemap).not.toContain(own.id);
  });

  test('自分だけの作品のページでは、閲覧数とコピー数が増えない', async ({ page }) => {
    const login = unique('counter');
    const owner = new Visitor();
    await owner.login(login);
    const own = await privateWork(owner, 'count');
    const counts: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/count') counts.push(request.url());
    });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await logInPage(page, `/p/${own.id}`, login);
    await hydrated(page);
    await expect(page.locator('[data-private-notice]')).toContainText(UI.ja.notice);
    await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' })).toBeVisible();
    await page.getByRole('button', { name: '全部をコピー' }).click();
    await page.waitForTimeout(1000);
    expect(counts).toEqual([]);
    expect(counted(own.id)).toEqual({ views: 0, copies: 0 });
    // いいね、しおり、共有、リミックスは出さない
    await expect(page.getByRole('button', { name: 'リミックス', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '共有' })).toHaveCount(0);
  });
});

test.describe('置く画面で「自分だけ」を選ぶ（/new）', () => {
  for (const lang of ['ja', 'en'] as const) {
    test(`貼る → 「自分だけ」（初めの値）で置く → 審査なしで作品のページが本人に見え、枠で動く（${lang}）`, async ({ page }) => {
      const t = UI[lang];
      const prefix = lang === 'ja' ? '' : '/en';
      await logInPage(page, `${prefix}/new`);
      const id = unique(`new-${lang}-`);
      await page.getByLabel(t.box).fill(boxSnippet(id));
      await expect(page.locator('[data-box-status]')).toContainText(t.saved);
      // 初めの値は「自分だけ」
      await expect(page.getByRole('radio', { name: t.onlyMe })).toBeChecked();
      await expect(page.getByRole('radio', { name: t.public })).not.toBeChecked();
      await page.getByLabel(t.title, { exact: true }).fill(`Only me ${lang}`);
      for (const label of [t.own, t.mit, t.terms]) await page.getByLabel(label).check();
      // サムネイルなしで置ける
      await page.getByRole('button', { name: t.place, exact: true }).click();
      await expect(page).toHaveURL(`${prefix}/p/${id}`);
      await expect(page.locator('[data-private-notice]')).toContainText(t.notice);
      const frame = page.frameLocator('iframe[data-ld-frame]');
      await expect(page.locator('iframe[data-ld-frame]')).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
      await frame.getByRole('button', { name: '押す' }).click();
      await expect(frame.getByRole('button', { name: '押された' })).toBeVisible();
      expect(d1(`SELECT w.status AS work, r.status AS revision FROM works w JOIN revisions r ON r.work_id = w.id WHERE w.id = ${quote(id)}`)).toEqual([{ work: 'private', revision: 'private' }]);
      expect((await new Visitor().fetch(`/p/${id}`)).status).toBe(404);
    });
  }

  test('101作品目は置けず、理由が画面に出る', async ({ page }) => {
    const login = await logInPage(page, '/new', unique('limitui'));
    const visitor = new Visitor();
    await visitor.login(login);
    const own = await privateWork(visitor, 'limitui');
    const [{ creator_id: creatorId }] = d1<{ creator_id: string }>(`SELECT creator_id FROM works WHERE id = ${quote(own.id)}`);
    const rows = Array.from({ length: 99 }, (_, i) => `(${quote(`${own.id}-fill-${i}`)}, ${quote(creatorId)}, 'x', 'component', 'Components', 'Toggle', 'human', '1', 'private', '', 0, 0, 0)`);
    d1(`INSERT INTO works (id, creator_id, title, type, category, subtype, made_with, version, status, thumb_key, thumb_w, thumb_h, created_at) VALUES ${rows.join(', ')}`);

    const id = unique('over-');
    await page.getByLabel(UI.ja.box).fill(boxSnippet(id));
    await expect(page.locator('[data-box-status]')).toContainText(UI.ja.saved);
    await page.getByLabel(UI.ja.title, { exact: true }).fill('101 作品目');
    for (const label of [UI.ja.own, UI.ja.mit, UI.ja.terms]) await page.getByLabel(label).check();
    await page.getByRole('button', { name: UI.ja.place, exact: true }).click();
    await expect(page.locator('[data-submit-status]')).toHaveText('自分だけの作品は、1人100作品までです。これ以上は置けません');
    await expect(page).toHaveURL('/new');
    expect(d1(`SELECT status FROM works WHERE id = ${quote(id)}`)).toEqual([{ status: 'draft' }]);
  });
});

test.describe('自分の置き場（/account/works）', () => {
  for (const lang of ['ja', 'en'] as const) {
    test(`5つの状態の作品が正しい札で並ぶ。新しく変えた順。絞り込みが効く（${lang}）`, async ({ page }) => {
      const login = unique(`shelf${lang}`);
      const owner = new Visitor();
      await owner.login(login);
      const { visitor: reviewer } = await operator();
      const pub = await publicWork(owner, reviewer, 'pub');
      const rejected = await draft(owner, 'rej');
      expect((await submit(owner, rejected.revision.id)).status).toBe(200);
      expect((await reviewer.post(`/api/review/revisions/${rejected.revision.id}/reject`, { reason: 'rights', note: '直してください' })).status).toBe(200);
      const pending = await draft(owner, 'wait');
      expect((await submit(owner, pending.revision.id)).status).toBe(200);
      const drafted = await draft(owner, 'draft', { thumb: false });
      const own = await privateWork(owner, 'mine', { thumb: false });

      const labels =
        lang === 'ja'
          ? { private: '自分だけ', submitted: '審査待ち', public: '公開', rejected: '差し戻し', draft: '下書き', all: 'すべて' }
          : { private: 'Only me', submitted: 'In review', public: 'Public', rejected: 'Sent back', draft: 'Draft', all: 'All' };
      await logInPage(page, lang === 'ja' ? '/account/works' : '/en/account/works', login);
      const rows = page.locator('[data-own-work]');
      await expect(rows).toHaveCount(5);
      // 新しく変えた順
      expect(await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-own-work')))).toEqual([own.id, drafted.id, pending.id, rejected.id, pub.id]);
      const expected = [
        [own.id, 'private'],
        [drafted.id, 'draft'],
        [pending.id, 'submitted'],
        [rejected.id, 'rejected'],
        [pub.id, 'public'],
      ] as const;
      for (const [id, state] of expected) {
        const row = page.locator(`[data-own-work="${id}"]`);
        await expect(row, id).toHaveAttribute('data-own-work-state', state);
        await expect(row.locator('[data-own-work-status]'), id).toHaveText(labels[state]);
        // 最後に変えた日と版の数
        await expect(row, id).toContainText(lang === 'ja' ? '版の数 1' : '1 version');
      }
      // サムネイルのない作品は、題の頭の1文字
      await expect(page.locator(`[data-own-work="${own.id}"] [data-no-thumb]`)).toHaveText(lang === 'ja' ? '自' : '自');

      const filter = page.getByRole('group', { name: lang === 'ja' ? '絞り込み' : 'Filter' });
      await filter.getByRole('button', { name: labels.private, exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-own-work', own.id);
      await filter.getByRole('button', { name: labels.public, exact: true }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveAttribute('data-own-work', pub.id);
      await filter.getByRole('button', { name: labels.all, exact: true }).click();
      await expect(rows).toHaveCount(5);
    });
  }

  test('自分だけ → 公開する → 審査待ちの間も、ほかの人には 404 → 承認 → 公開される', async ({ page }) => {
    const login = unique('publish');
    const owner = new Visitor();
    await owner.login(login);
    const { visitor: reviewer } = await operator();
    const own = await privateWork(owner, 'topub');
    await logInPage(page, '/account/works', login);
    const row = page.locator(`[data-own-work="${own.id}"]`);
    await row.getByRole('button', { name: /を公開する$/ }).click();
    await expect(row).toContainText('承認されるまで、ほかの人には見えないままです');
    await row.getByRole('button', { name: '審査に出す', exact: true }).click();
    await expect(row).toHaveAttribute('data-own-work-state', 'submitted');

    // 審査待ちの間も、ほかの人には 404。本人には見える
    expect((await new Visitor().fetch(`/p/${own.id}`)).status).toBe(404);
    expect((await owner.fetch(`/p/${own.id}`)).status).toBe(200);
    expect(await listed(own.id)).toBe(false);
    const revision = submittedRevision(own.id);
    expect(revision.id).toBe(own.revision.id);
    // 運営は、審査に出された版だけを見られる
    expect((await reviewer.fetch(`/api/review/revisions/${revision.id}`)).status).toBe(200);
    expect((await approve(reviewer, revision)).status).toBe(200);
    expect((await new Visitor().fetch(`/p/${own.id}`)).status).toBe(200);
    expect(await listed(own.id)).toBe(true);
    await page.reload();
    await expect(row).toHaveAttribute('data-own-work-state', 'public');
  });

  test('自分だけ → 公開する → 差し戻されたら自分だけのまま。サムネイルがなければ公開できない', async () => {
    const { visitor } = await person('back');
    const { visitor: reviewer } = await operator();
    const own = await privateWork(visitor, 'back');
    expect((await publish(visitor, own.id)).status).toBe(200);
    const revision = submittedRevision(own.id);
    expect((await reviewer.post(`/api/review/revisions/${revision.id}/reject`, { reason: 'quality', note: '' })).status).toBe(200);
    expect(d1(`SELECT status FROM works WHERE id = ${quote(own.id)}`)).toEqual([{ status: 'private' }]);
    expect((await visitor.fetch(`/p/${own.id}`)).status).toBe(200);
    expect((await new Visitor().fetch(`/p/${own.id}`)).status).toBe(404);
    const works = ((await (await visitor.fetch('/api/post/works')).json()) as { works: { id: string; status: string; private: boolean; reject_code: string }[] }).works;
    expect(works.find((work) => work.id === own.id)).toMatchObject({ status: 'rejected', private: true, reject_code: 'quality' });

    const bare = await privateWork(visitor, 'bare', { thumb: false });
    const refused = await publish(visitor, bare.id);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: 'thumb_required' });
  });

  test('公開 → 自分だけにする → すぐ 404。ホームから消える。リミックスは残り、帯は「元の作品は見られません」でリンクなし', async ({ page }) => {
    const login = unique('unpub');
    const owner = new Visitor();
    await owner.login(login);
    const { visitor: reviewer } = await operator();
    const remixer = await person('remixer');
    const source = await publicWork(owner, reviewer, 'src');
    const child = await publicWork(remixer.visitor, reviewer, 'child', { remixOf: source.id });
    // 公開のうちは、帯に元の題と作者と元へのリンク
    const before = await (await new Visitor().fetch(`/p/${child.id}`)).text();
    expect(before).toContain(`href="/p/${source.id}"`);
    expect(before).toContain(`@${(await owner.me()).user.handle}`);

    await logInPage(page, '/account/works', login);
    const row = page.locator(`[data-own-work="${source.id}"]`);
    await row.getByRole('button', { name: /を自分だけにする$/ }).click();
    await expect(row.locator('[data-own-work-confirm]')).toHaveText(/ホームと検索から消え、リンクを開いても見られなくなります。リミックスした人の作品は残ります/);
    await row.getByRole('button', { name: '自分だけにする', exact: true }).click();
    await expect(row).toHaveAttribute('data-own-work-state', 'private');

    expect((await new Visitor().fetch(`/p/${source.id}`)).status).toBe(404);
    expect((await new Visitor().fetch(`/frame/${source.id}/1/desktop.html`, { headers: FROM_IFRAME })).status).toBe(404);
    expect((await new Visitor().fetch(`/w/${source.id}/1/thumb.webp`)).status).toBe(404);
    expect(await listed(source.id)).toBe(false);
    expect(await (await new Visitor().fetch('/')).text()).not.toContain(`/p/${source.id}"`);
    // 閲覧数とコピー数の行は消さない。持ち主にはページが見える
    expect((await owner.fetch(`/p/${source.id}`)).status).toBe(200);

    // リミックスは残る。帯は「元の作品は見られません」でリンクなし。題と作者も出さない
    const after = await new Visitor().fetch(`/p/${child.id}`);
    expect(after.status).toBe(200);
    await page.goto(`/p/${child.id}`);
    const band = page.locator('[data-remix-source]');
    await expect(band).toHaveText('元の作品は見られません');
    await expect(band.locator('a')).toHaveCount(0);
    const embedded = JSON.parse((await page.locator('#ld-page').textContent())!) as { source: unknown };
    expect(embedded.source).toEqual({ hidden: true });
    // コピーされるコードの2行目の元の住所は、そのまま
    const code = (await (await new Visitor().fetch(`/p/${child.id}/code`)).text()).split('\n');
    expect(code[1]).toContain(`ludion.ai/p/${source.id}`);
    await page.goto(`/en/p/${child.id}`);
    await expect(page.locator('[data-remix-source]')).toHaveText('The original work isn’t available.');
  });

  test('自分だけにすると、審査待ちの新しい版は下書きに戻り、承認できない。もう一度公開するときも審査する', async () => {
    const { visitor } = await person('again');
    const { visitor: reviewer } = await operator();
    const pub = await publicWork(visitor, reviewer, 'again');
    const next = await newVersion(visitor, pub.id, { thumb: false });
    expect((await submit(visitor, next.id)).status).toBe(200);
    expect((await visitor.post(`/api/post/works/${pub.id}/make-private`, undefined, 'https://evil.example')).status).toBe(403);
    const made = await makePrivate(visitor, pub.id);
    expect(made.status).toBe(200);
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(next.id)}`)).toEqual([{ status: 'draft' }]);
    expect((await approve(reviewer, next)).status).toBe(409);
    expect((await new Visitor().fetch(`/p/${pub.id}`)).status).toBe(404);
    expect((await makePrivate(visitor, pub.id)).status).toBe(409);

    // 直している途中の下書きがあると、今の版は公開に出せない
    expect(await (await publish(visitor, pub.id)).json()).toEqual({ error: 'has_draft' });
    // 下書きを自分だけで置くと今の版になり、公開に出せる。前に公開した版でも、もう一度審査する
    expect((await place(visitor, next.id)).status).toBe(200);
    expect((await publish(visitor, pub.id)).status).toBe(200);
    expect((await new Visitor().fetch(`/p/${pub.id}`)).status).toBe(404);
    expect((await approve(reviewer, submittedRevision(pub.id))).status).toBe(200);
    expect((await new Visitor().fetch(`/p/${pub.id}`)).status).toBe(200);
  });

  test('退会すると、自分だけの作品も消える（だれにも見えない）', async () => {
    const { visitor, handle } = await person('leave');
    const own = await privateWork(visitor, 'leave');
    // 退会は直近のログインを求める。今ログインしたばかり
    expect((await visitor.post('/api/account/delete')).status).toBe(204);
    expect(d1(`SELECT status, reject_reason FROM works WHERE id = ${quote(own.id)}`)).toEqual([{ status: 'rejected', reject_reason: 'account_deleted' }]);
    expect(d1(`SELECT DISTINCT status FROM revisions WHERE work_id = ${quote(own.id)}`)).toEqual([{ status: 'revoked' }]);
    expect(d1(`SELECT user_id FROM creators WHERE handle = ${quote(handle)}`)).toEqual([{ user_id: null }]);
    expect((await new Visitor().fetch(`/p/${own.id}`)).status).toBe(404);
  });
});
