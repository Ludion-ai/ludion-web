// 作品の投稿と審査の API（docs/tasks/T021.md 段階 A の e2e、SEC001 A04〜A07）。手元の偽の GitHub と本物の workerd で通す。
// 1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { createServer } from 'vite';
import { POST_LIMITS, SIGNUP_LIMITS } from '../worker/quotaLimits';
import { buildOutline } from '@ludion/outline';
import { pageOverflow } from './helpers';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const REPO = join(WEB, '../..');
const WRANGLER = join(REPO, 'node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
const TOKEN = process.env.LD_TEST_ADMIN_TOKEN!;
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };

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

function r2(key: string): Buffer | null {
  const result = spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'get', `ludion-parts/${key}`, '--local', '--persist-to', PERSIST, '--pipe'], {
    cwd: WEB,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 && result.stdout.length > 0 ? result.stdout : null;
}

/** 手元で作る PNG（壊れた画像と比べるための、本物の画像）。 */
function png(width: number, height: number, pixel: (x: number, y: number) => number[] = (x, y) => [x % 256, y % 256, 90, 255]): Buffer {
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
    for (let x = 0; x < width; x += 1) for (const value of pixel(x, y)) raw[at++] = value;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const THUMB = png(900, 700);

interface Parts {
  meta?: Record<string, unknown> | string;
  html?: string;
  css?: string;
  js?: string;
  thumb?: Buffer | null;
  extra?: [string, string | Blob][];
}

const htmlOf = (id: string, inner = '<button type="button">押す</button>') => `<div data-ld-part="${id}">${inner}</div>`;
const cssOf = (id: string) => `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`;
const metaOf = (id: string | undefined, over: Record<string, unknown> = {}) => ({
  ...(id ? { id } : {}),
  title: `投稿の見本 ${id ?? ''}`,
  category: 'Components',
  subtype: 'Toggle',
  tags: ['minimal'],
  motion: false,
  made_with: 'human',
  ...over,
});

function formOf(id: string | undefined, { meta, html, css, js, thumb, extra = [] }: Parts = {}) {
  const form = new FormData();
  const metaValue = meta ?? metaOf(id);
  form.append('meta', typeof metaValue === 'string' ? metaValue : JSON.stringify(metaValue));
  form.append('part.html', html ?? htmlOf(id ?? 'x'));
  form.append('part.css', css ?? cssOf(id ?? 'x'));
  if (js !== undefined) form.append('part.js', js);
  if (thumb !== null) form.append('thumb', new Blob([new Uint8Array(thumb ?? THUMB)], { type: 'image/png' }), 'x.png');
  for (const [name, value] of extra) form.append(name, value);
  return form;
}

const postForm = (visitor: Visitor, path: string, form: FormData, origin: string | null = ownOrigin()) =>
  visitor.fetch(path, { method: 'POST', body: form, headers: origin === null ? {} : { Origin: origin } });

async function person(label = 'poster') {
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

/** 新しい作品の下書きを作る。 */
async function draft(visitor: Visitor, label = 'work', parts: Parts = {}) {
  const id = unique(`${label}-`);
  // meta を渡したときも、新しい作品の ID は入れる
  const meta = parts.meta && typeof parts.meta === 'object' ? { id, ...parts.meta } : parts.meta;
  const response = await postForm(visitor, '/api/post/works', formOf(id, { ...parts, meta }));
  expect(response.status, await response.clone().text()).toBe(201);
  const body = (await response.json()) as { work_id: string; revision: { id: string; version: string; content_hash: string; frames: { desktop: string; mobile: string }; thumb: string }; optional: unknown[] };
  return { id, ...body };
}

const CONFIRM = { own: true, mit: true, terms: true };
const submit = (visitor: Visitor, revisionId: string, body: unknown = CONFIRM) => visitor.post(`/api/post/revisions/${revisionId}/submit`, body);
const approve = (reviewer: Visitor, revision: { id: string; content_hash: string }) => reviewer.post(`/api/review/revisions/${revision.id}/approve`, { content_hash: revision.content_hash });

/** 下書きから公開まで。 */
async function published(owner: Visitor, reviewer: Visitor, label = 'public', parts: Parts = {}) {
  const made = await draft(owner, label, parts);
  expect((await submit(owner, made.revision.id)).status).toBe(200);
  expect((await approve(reviewer, made.revision)).status).toBe(200);
  return made;
}

const publicStatus = async (id: string, version: string) => {
  const anonymous = new Visitor();
  return {
    page: (await anonymous.fetch(`/p/${id}`)).status,
    // コードを文字で返す口も、承認済みの版だけ（docs/tasks/T031.md「1」）
    code: (await anonymous.fetch(`/p/${id}/code`)).status,
    frame: (await anonymous.fetch(`/frame/${id}/${version}/desktop.html`, { headers: FROM_IFRAME })).status,
    thumb: (await anonymous.fetch(`/w/${id}/${version}/thumb.webp`)).status,
    og: (await anonymous.fetch(`/w/${id}/${version}/og.png`)).status,
    listed: ((await (await anonymous.fetch('/api/works')).json()) as { works: { id: string }[] }).works.some((work) => work.id === id),
  };
};

const HIDDEN = { page: 404, code: 404, frame: 404, thumb: 404, og: 404, listed: false };
const VISIBLE = { page: 200, code: 200, frame: 200, thumb: 200, og: 200, listed: true };

// 本文を読まずに断るときは、小さい本文で確かめる。手元のサーバー（vite preview）は、本文を送っている途中で応答が来ると fetch failed で 500 を返すことがある（本番には関係がない）
test.describe('入口', () => {
  test('ログインしていなければ 401。外の Origin と枠の中（null）と Origin なしは 403', async () => {
    const anonymous = new Visitor();
    expect((await anonymous.fetch('/api/post/works')).status).toBe(401);
    expect((await postForm(anonymous, '/api/post/works', formOf('nobody-here', { thumb: null }))).status).toBe(401);

    const { visitor } = await person();
    for (const origin of ['https://evil.example', 'null', null]) {
      expect((await postForm(visitor, '/api/post/works', formOf(unique('origin-'), { thumb: null }), origin)).status, String(origin)).toBe(403);
    }
  });
});

test.describe('下書き', () => {
  test('作者ができて人に結ばれる。作者は person。R2 のキーはサーバーが作る。サムネイルは WebP 幅800 に作り直す。OG は 1200×630 の PNG', async () => {
    const { visitor, handle } = await person();
    const made = await draft(visitor);

    const [creator] = d1<{ handle: string; kind: string; user_id: string; avatar_url: string | null }>(`SELECT c.handle, c.kind, c.user_id, c.avatar_url FROM creators c JOIN works w ON w.creator_id = c.id WHERE w.id = ${quote(made.id)}`);
    expect(creator).toMatchObject({ handle, kind: 'person', avatar_url: null });
    expect(creator.user_id).toBe(d1<{ id: string }>(`SELECT id FROM users WHERE handle = ${quote(handle)}`)[0].id);

    const [row] = d1<{ status: string; version: string; r2_prefix: string; content_hash: string; thumb_w: number; thumb_h: number; tokens_ok: number; made_with: string }>(`SELECT * FROM revisions WHERE id = ${quote(made.revision.id)}`);
    expect(row).toMatchObject({ status: 'draft', version: '1', thumb_w: 800, tokens_ok: 0, made_with: 'human' });
    expect(row.thumb_h).toBe(Math.round((800 * 700) / 900));
    expect(row.r2_prefix).toBe(`revisions/${made.revision.id}/${row.content_hash.slice(0, 16)}`);

    const thumb = r2(`${row.r2_prefix}/thumb.webp`)!;
    expect(thumb.subarray(0, 4).toString()).toBe('RIFF');
    expect(thumb.subarray(8, 12).toString()).toBe('WEBP');
    expect(thumb.equals(THUMB)).toBe(false);
    const og = r2(`${row.r2_prefix}/og.png`)!;
    expect(og.subarray(1, 4).toString()).toBe('PNG');
    expect([og.readUInt32BE(16), og.readUInt32BE(20)]).toEqual([1200, 630]);
    const meta = JSON.parse(r2(`${row.r2_prefix}/meta.json`)!.toString());
    expect(meta).toMatchObject({ id: made.id, type: 'component', platform: null, category: 'Components', creator: handle, license: 'MIT', version: '1', pin_order: null });
    // 中身の地図（WS002）：版の置き場に outline.json。置いたファイルから作る
    const outline = JSON.parse(r2(`${row.r2_prefix}/outline.json`)!.toString());
    expect(outline).toEqual(buildOutline({ html: r2(`${row.r2_prefix}/part.html`)!.toString(), css: r2(`${row.r2_prefix}/part.css`)!.toString(), js: r2(`${row.r2_prefix}/part.js`)?.toString() ?? null }));
    expect(outline).toMatchObject({ version: 1, format: 'parts' });

    // 新しい作者は、まだ公開の作り手のページに出ない
    expect((await new Visitor().fetch(`/c/${handle}`)).status).toBe(404);
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM works WHERE id = ${quote(made.id)}`)[0].is_remix).toBe(0);
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM revisions WHERE id = ${quote(made.revision.id)}`)[0].is_remix).toBe(0);
  });

  test('Remixed by を下書きに覚え、保存し直すと更新し、承認すると公開の remix になる', async () => {
    const owner = await person();
    const reviewer = await operator();
    const made = await draft(owner.visitor, 'remix', { js: '/* Remixed by Claude */\nexport function mount(root){return()=>{}}' });
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM works WHERE id = ${quote(made.id)}`)[0].is_remix).toBe(1);
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM revisions WHERE id = ${quote(made.revision.id)}`)[0].is_remix).toBe(1);

    const cleared = await postForm(owner.visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { js: 'export function mount(root){return()=>{}}', thumb: null }));
    expect(cleared.status).toBe(200);
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM revisions WHERE id = ${quote(made.revision.id)}`)[0].is_remix).toBe(0);

    const again = await postForm(owner.visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { js: '/* Remix by Ada */\nexport function mount(root){return()=>{}}', thumb: null }));
    expect(again.status).toBe(200);
    const revision = (await again.json()) as { revision: { id: string; content_hash: string } };
    expect((await submit(owner.visitor, revision.revision.id)).status).toBe(200);
    expect((await approve(reviewer.visitor, revision.revision)).status).toBe(200);
    expect(d1<{ is_remix: number }>(`SELECT is_remix FROM works WHERE id = ${quote(made.id)}`)[0].is_remix).toBe(1);
    const listed = ((await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string; remix: boolean }[] }).works;
    expect(listed.find((work) => work.id === made.id)?.remix).toBe(true);
  });

  test('同じ下書きを保存し直すと、版は増えず、古いファイルは消える。任意の検査の結果が返る', async () => {
    const { visitor } = await person();
    const made = await draft(visitor);
    expect(made.optional.length).toBeGreaterThan(0);
    const [before] = d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE id = ${quote(made.revision.id)}`);

    const saved = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { html: htmlOf(made.id, '<p>直した</p>'), thumb: null }));
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { revision: { id: string; version: string } };
    expect(body.revision).toMatchObject({ id: made.revision.id, version: '1' });
    const rows = d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE work_id = ${quote(made.id)}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].r2_prefix).not.toBe(before.r2_prefix);
    expect(r2(`${before.r2_prefix}/part.html`)).toBeNull();
    expect(r2(`${rows[0].r2_prefix}/part.html`)!.toString()).toContain('直した');
    // 地図も、古い置き場から消え、新しい置き場にできる（WS002）
    expect(r2(`${before.r2_prefix}/outline.json`)).toBeNull();
    expect(JSON.parse(r2(`${rows[0].r2_prefix}/outline.json`)!.toString()).files[0]).toMatchObject({ name: 'part.html', language: 'html' });
    // 画像を出さなければ、前の画像を引き継ぐ
    expect(r2(`${rows[0].r2_prefix}/thumb.webp`)).not.toBeNull();
    expect(r2(`${rows[0].r2_prefix}/og.png`)).not.toBeNull();
  });

  test('題名は120文字まで。種類とタグは決まったものだけ。motion を選ぶと tags に入り、Dashboard は dashboard が付く', async () => {
    const { visitor } = await person();
    const send = (over: Record<string, unknown>) => {
      const id = unique('meta-');
      return postForm(visitor, '/api/post/works', formOf(id, { meta: metaOf(id, over) }));
    };
    expect((await send({ title: 'あ'.repeat(121) })).status).toBe(400);
    // 題のない下書きは保存できる（docs/tasks/T033.md A3）。審査に出すには題が要る（下の「1つの箱」）
    expect((await send({ title: '   ' })).status).toBe(201);
    expect((await send({ title: 3 })).status).toBe(400);
    expect((await send({ title: '改行\nあり' })).status).toBe(400);
    expect((await send({ category: 'Nope' })).status).toBe(400);
    expect((await send({ subtype: 'Landing Page' })).status).toBe(400);
    expect((await send({ tags: ['nope'] })).status).toBe(400);
    expect((await send({ made_with: 'robot' })).status).toBe(400);
    expect((await send({ title: 'あ'.repeat(120) })).status).toBe(201);

    const id = unique('shape-');
    const css = `${cssOf(id)} @media (prefers-reduced-motion: reduce) { [data-ld-part="${id}"] { color: red } }`;
    const dashboard = await postForm(visitor, '/api/post/works', formOf(id, { meta: metaOf(id, { category: 'Dashboard', subtype: 'Analytics', motion: true, tags: ['experimental', 'ecommerce'] }), css }));
    expect(dashboard.status).toBe(201);
    const [row] = d1<{ type: string; platform: string; tags: string }>(`SELECT type, platform, tags FROM revisions WHERE work_id = ${quote(id)}`);
    expect(row).toMatchObject({ type: 'screen', platform: 'web' });
    expect(JSON.parse(row.tags).sort()).toEqual(['dashboard', 'experimental', 'motion']);
  });

  test('ID：形が違う、運営に見える、もう使われている', async () => {
    const { visitor } = await person();
    const check = async (id: string) => ((await (await visitor.fetch(`/api/post/id-check?id=${encodeURIComponent(id)}`)).json()) as { status: string }).status;
    expect(await check('Bad_ID')).toBe('format');
    expect(await check('ab')).toBe('format');
    expect(await check(`${'a'.repeat(61)}`)).toBe('format');
    expect(await check('ludion-official')).toBe('reserved');
    const free = unique('free-');
    expect(await check(free)).toBe('ok');
    const made = await draft(visitor);
    expect(await check(made.id)).toBe('taken');
    expect((await postForm(visitor, '/api/post/works', formOf('ludion-fake'))).status).toBe(400);
    // 自分の作品の ID でもう一度「新しく」作ると 409
    expect((await postForm(visitor, '/api/post/works', formOf(made.id))).status).toBe(409);
  });
});

// ---------------------------------------------------------------- 1つの箱とリミックスの元（docs/tasks/T033.md）

test.describe('サムネイルと題のない下書き（T033 A3）', () => {
  test('下書きはサムネイルも題もなしで保存できる。審査に出すには両方が要る。審査の一覧、公開の一覧、作り手のページに出ない', async () => {
    const { visitor, handle } = await person();
    const { visitor: reviewer } = await operator();
    const id = unique('bare-');
    const response = await postForm(visitor, '/api/post/works', formOf(id, { meta: metaOf(id, { title: '' }), thumb: null }));
    expect(response.status, await response.clone().text()).toBe(201);
    const made = (await response.json()) as { revision: { id: string; thumb: string | null; thumb_w: number; content_hash: string } };
    expect(made.revision).toMatchObject({ thumb: null, thumb_w: 0 });
    const [row] = d1<{ r2_prefix: string; thumb_w: number; thumb_h: number; title: string }>(`SELECT r2_prefix, thumb_w, thumb_h, title FROM revisions WHERE id = ${quote(made.revision.id)}`);
    expect(row).toMatchObject({ thumb_w: 0, thumb_h: 0, title: '' });
    expect(r2(`${row.r2_prefix}/thumb.webp`)).toBeNull();
    expect(r2(`${row.r2_prefix}/part.html`)).not.toBeNull();
    // 画像のない下書きも、枠では動く。画像の道は 404
    expect((await visitor.fetch(`/draft-frame/${made.revision.id}/desktop.html`, { headers: FROM_IFRAME })).status).toBe(200);
    expect((await visitor.fetch(`/draft-thumb/${made.revision.id}.webp`)).status).toBe(404);
    // 自分の作品の一覧では、画像は null
    const own = ((await (await visitor.fetch('/api/post/works')).json()) as { works: { id: string; thumb: string | null; title: string }[] }).works.find((work) => work.id === id);
    expect(own).toMatchObject({ thumb: null, title: '' });

    // 題がない → 422 title_required。審査待ちにならない
    let answer = await submit(visitor, made.revision.id);
    expect(answer.status).toBe(422);
    expect(((await answer.json()) as { error: string }).error).toBe('title_required');
    // 題を入れても、画像がない → 422 thumb_required
    const titled = await postForm(visitor, `/api/post/works/${id}/revisions`, formOf(id, { meta: metaOf(undefined, { title: '題だけ入れた' }), thumb: null }));
    expect(titled.status).toBe(200);
    answer = await submit(visitor, made.revision.id);
    expect(answer.status).toBe(422);
    expect(((await answer.json()) as { error: string }).error).toBe('thumb_required');
    expect(d1<{ status: string }>(`SELECT status FROM revisions WHERE id = ${quote(made.revision.id)}`)[0].status).toBe('draft');

    // 審査の一覧と公開の一覧に、サムネイルのない版は出ない
    const queue = ((await (await reviewer.fetch('/api/review/queue')).json()) as { revisions: { id: string }[] }).revisions;
    expect(queue.some((item) => item.id === made.revision.id)).toBe(false);
    expect(d1<{ n: number }>(`SELECT COUNT(*) AS n FROM revisions WHERE status = 'submitted' AND thumb_w = 0`)[0].n).toBe(0);
    expect(await publicStatus(id, '1')).toEqual(HIDDEN);
    expect((await new Visitor().fetch(`/c/${handle}`)).status).toBe(404);

    // 画像を足すと出せる。承認すると、公開の画像がある
    const withThumb = await postForm(visitor, `/api/post/works/${id}/revisions`, formOf(id, { meta: metaOf(undefined, { title: '画像も入れた' }) }));
    expect(withThumb.status).toBe(200);
    const final = (await withThumb.json()) as { revision: { id: string; content_hash: string; thumb: string | null; thumb_w: number } };
    expect(final.revision.thumb).toBe(`/draft-thumb/${made.revision.id}.webp`);
    expect(final.revision.thumb_w).toBe(800);
    expect((await submit(visitor, made.revision.id)).status).toBe(200);
    expect((await approve(reviewer, final.revision)).status).toBe(200);
    expect(await publicStatus(id, '1')).toEqual(VISIBLE);
  });

  test('画像のない下書きを、画像を出さずに保存し直しても、画像なしのまま', async () => {
    const { visitor } = await person();
    const id = unique('bare-');
    expect((await postForm(visitor, '/api/post/works', formOf(id, { thumb: null }))).status).toBe(201);
    const again = await postForm(visitor, `/api/post/works/${id}/revisions`, formOf(id, { html: htmlOf(id, '<p>直した</p>'), thumb: null }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { revision: { thumb: string | null } }).revision.thumb).toBeNull();
  });

  test('一度も審査に出していない作品は消せる（ID を変えるため）。審査に出した作品、他人の作品は消せない', async () => {
    const { visitor } = await person();
    const other = await person('other');
    const made = await draft(visitor, 'discard');
    const [{ r2_prefix }] = d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE id = ${quote(made.revision.id)}`);
    expect((await other.visitor.post(`/api/post/works/${made.id}/discard`)).status).toBe(403);
    expect((await visitor.post(`/api/post/works/${made.id}/discard`, undefined, 'https://evil.example')).status).toBe(403);
    expect((await visitor.post(`/api/post/works/${made.id}/discard`)).status).toBe(200);
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(made.id)}`)[0].n).toBe(0);
    expect(d1(`SELECT COUNT(*) AS n FROM revisions WHERE work_id = ${quote(made.id)}`)[0].n).toBe(0);
    expect(r2(`${r2_prefix}/part.html`)).toBeNull();
    // ID はまた使える
    expect(((await (await visitor.fetch(`/api/post/id-check?id=${made.id}`)).json()) as { status: string }).status).toBe('ok');

    const sent = await draft(visitor, 'discard');
    expect((await submit(visitor, sent.revision.id)).status).toBe(200);
    expect((await visitor.post(`/api/post/works/${sent.id}/discard`)).status).toBe(409);
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(sent.id)}`)[0].n).toBe(1);
  });
});

test.describe('リミックスの元（T033 B3、B4）', () => {
  test('remix_of：承認済みの作品なら入り、is_remix が 1。コピーされるコードの2行目に元のクレジット行。/p/<id>/code も同じ中身', async () => {
    const original = await person('origin');
    const { visitor: reviewer } = await operator();
    const source = await published(original.visitor, reviewer, 'origin');
    const remixer = await person('remixer');
    const id = unique('rmx-');
    const response = await postForm(remixer.visitor, '/api/post/works', formOf(id, { meta: metaOf(id, { remix_of: source.id }) }));
    expect(response.status, await response.clone().text()).toBe(201);
    const made = (await response.json()) as { remix_of: string; revision: { id: string; content_hash: string } };
    expect(made.remix_of).toBe(source.id);
    expect(d1(`SELECT remix_of, is_remix FROM works WHERE id = ${quote(id)}`)[0]).toEqual({ remix_of: source.id, is_remix: 1 });
    expect(d1(`SELECT remix_of, is_remix FROM revisions WHERE id = ${quote(made.revision.id)}`)[0]).toEqual({ remix_of: source.id, is_remix: 1 });

    // 審査の画面に、元の作品
    expect((await submit(remixer.visitor, made.revision.id)).status).toBe(200);
    const detail = (await (await reviewer.fetch(`/api/review/revisions/${made.revision.id}`)).json()) as { remix_of: unknown };
    expect(detail.remix_of).toEqual({ id: source.id, title: `投稿の見本 ${source.id}`, handle: original.handle, public: true });
    expect((await approve(reviewer, made.revision)).status).toBe(200);

    const code = await (await new Visitor().fetch(`/p/${id}/code`)).text();
    const lines = code.split('\n');
    expect(lines[0]).toBe(`<!-- UI by @${remixer.handle} — ludion.ai/p/${id} (MIT) -->`);
    expect(lines[1]).toBe(`<!-- Remix of UI by @${original.handle} — ludion.ai/p/${source.id} (MIT) -->`);
    const style = lines.indexOf('<style>');
    expect(lines.slice(style + 1, style + 3)).toEqual([`/* UI by @${remixer.handle} — ludion.ai/p/${id} (MIT) */`, `/* Remix of UI by @${original.handle} — ludion.ai/p/${source.id} (MIT) */`]);
    // 作品のページの「コードをコピー」と1文字も違わない
    const page = await (await new Visitor().fetch(`/p/${id}`)).text();
    const json = JSON.parse(/<script[^>]*id="ld-page"[^>]*>([\s\S]*?)<\/script>/.exec(page)?.[1] ?? 'null') as { snippet?: string } | null;
    if (json?.snippet !== undefined) expect(json.snippet).toBe(code);
    expect(page).toContain(`Remix of UI by @${original.handle}`);

    // 直した版は remix_of を引き継ぐ。送っても変えられない。元が取り下げられても、リミックスと2行目は残る
    expect((await postForm(remixer.visitor, `/api/post/works/${id}/revisions`, formOf(id, { meta: metaOf(undefined, { remix_of: null }), thumb: null }))).status).toBe(400);
    const next = await postForm(remixer.visitor, `/api/post/works/${id}/revisions`, formOf(id, { meta: metaOf(undefined), thumb: null }));
    expect(next.status).toBe(201);
    const nextRevision = (await next.json()) as { revision: { id: string } };
    expect(d1(`SELECT remix_of FROM revisions WHERE id = ${quote(nextRevision.revision.id)}`)[0]).toEqual({ remix_of: source.id });
    expect((await original.visitor.post(`/api/post/works/${source.id}/revoke`)).status).toBe(200);
    expect((await new Visitor().fetch(`/p/${id}`)).status).toBe(200);
    expect((await (await new Visitor().fetch(`/p/${id}/code?after-revoke`)).text()).split('\n')[1]).toBe(`<!-- Remix of UI by @${original.handle} — ludion.ai/p/${source.id} (MIT) -->`);
  });

  test('悪い remix_of：ない作品、承認されていない作品、自分自身、形の違う値は断り、何も置かない', async () => {
    const owner = await person('rmx-bad');
    const notApproved = await draft(owner.visitor, 'pending');
    const send = (id: string, remixOf: unknown) => postForm(owner.visitor, '/api/post/works', formOf(id, { meta: metaOf(id, { remix_of: remixOf }) }));
    for (const [name, value] of [
      ['ない作品', 'no-such-work-here'],
      ['承認されていない作品', notApproved.id],
      ['形の違う値', 'Bad ID'],
      ['文字でない', 3],
    ] as const) {
      const id = unique('rmx-');
      const response = await send(id, value);
      expect(response.status, name).toBe(400);
      expect(((await response.json()) as { error: string }).error, name).toBe('bad_remix_of');
      expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(id)}`)[0].n, name).toBe(0);
    }
    // 自分自身：新しい作品の ID と同じ（まだない作品なので、承認済みでもない）。今ある作品を直す版で、自分の ID を入れる
    const self = unique('rmx-');
    expect((await send(self, self)).status).toBe(400);
    const response = await postForm(owner.visitor, `/api/post/works/${notApproved.id}/revisions`, formOf(notApproved.id, { meta: metaOf(undefined, { remix_of: notApproved.id }), thumb: null }));
    expect(response.status).toBe(400);
    expect(d1(`SELECT remix_of FROM works WHERE id = ${quote(notApproved.id)}`)[0]).toEqual({ remix_of: null });
  });

  test('元の作品を読む口：承認済みの作品だけ。種類、タグを返す', async () => {
    const original = await person('origin');
    const { visitor: reviewer } = await operator();
    const source = await published(original.visitor, reviewer, 'origin', { meta: metaOf(undefined, { tags: ['experimental'], motion: true }) });
    const { visitor } = await person();
    const answer = (await (await visitor.fetch(`/api/post/remix-source/${source.id}`)).json()) as Record<string, unknown>;
    expect(answer).toMatchObject({ id: source.id, handle: original.handle, category: 'Components', subtype: 'Toggle' });
    expect((answer.tags as string[]).sort()).toEqual(['experimental', 'motion']);
    const pending = await draft(visitor, 'pending');
    expect((await visitor.fetch(`/api/post/remix-source/${pending.id}`)).status).toBe(404);
    expect((await visitor.fetch('/api/post/remix-source/no-such-work')).status).toBe(404);
    expect((await new Visitor().fetch(`/api/post/remix-source/${source.id}`)).status).toBe(401);
  });
});

test.describe('審査', () => {
  test('審査待ちの作品は公開に出ない。承認で公開され「新着」に出る', async () => {
    const { visitor, handle } = await person();
    const { visitor: reviewer } = await operator();
    const made = await draft(visitor, 'shown', { js: 'export function mount(root) { root.dataset.on = "1"; return () => {}; }' });
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
    expect((await submit(visitor, made.revision.id)).status).toBe(200);
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
    const queue = (await (await reviewer.fetch('/api/review/queue')).json()) as { revisions: { id: string; handle: string }[] };
    expect(queue.revisions.find((one) => one.id === made.revision.id)?.handle).toBe(handle);

    expect((await approve(reviewer, made.revision)).status).toBe(200);
    expect(await publicStatus(made.id, '1')).toEqual(VISIBLE);
    // 新着の先頭に近い。一覧の HTML に入っている
    const newest = await (await new Visitor().fetch('/?sort=new')).text();
    expect(newest).toContain(`/p/${made.id}`);
    const { works } = (await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string; published_at: number }[] };
    const mine = works.find((work) => work.id === made.id)!;
    expect(mine.published_at).toBeGreaterThan(Date.now() - 60_000);
    // made_with は公開の API と HTML に出さない（CLAUDE.md 原則9）
    expect(JSON.stringify(mine)).not.toContain('made_with');
    const page = await (await new Visitor().fetch(`/p/${made.id}`)).text();
    expect(page).not.toContain('made_with');
    // コピーされるコードの1行目はクレジット行（原則4）
    expect(page).toContain(`UI by @${handle} — ludion.ai/p/${made.id} (MIT)`);
    // 作り手のページができる
    expect((await new Visitor().fetch(`/c/${handle}`)).status).toBe(200);
    expect((await approve(reviewer, made.revision)).status).toBe(409);
  });

  test('確かめの3つがなければ審査に出せない。承認は見た中身のハッシュと同じときだけ', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const made = await draft(visitor);
    expect((await submit(visitor, made.revision.id, { own: true, mit: true })).status).toBe(400);
    expect((await submit(visitor, made.revision.id, { own: true, mit: true, terms: 'yes' })).status).toBe(400);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/approve`, { content_hash: made.revision.content_hash })).status).toBe(409); // まだ下書き
    expect((await submit(visitor, made.revision.id)).status).toBe(200);
    expect((await submit(visitor, made.revision.id)).status).toBe(409);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/approve`, { content_hash: 'stale' })).status).toBe(409);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/approve`, {})).status).toBe(400);
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(made.revision.id)}`)).toEqual([{ status: 'submitted' }]);
  });

  test('差し戻しは理由が作り手に見える。理由がなければ差し戻せない。公開には出ない', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const made = await draft(visitor);
    await submit(visitor, made.revision.id);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/reject`, { reason: 'nope' })).status).toBe(400);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/reject`, { reason: 'other', note: 'あ'.repeat(501) })).status).toBe(400);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/reject`, { reason: 'rights', note: 'ロゴを消してください' })).status).toBe(200);
    const { works } = (await (await visitor.fetch('/api/post/works')).json()) as { works: { id: string; status: string; reject_code: string; reject_note: string; public: boolean }[] };
    expect(works.find((work) => work.id === made.id)).toMatchObject({ status: 'rejected', reject_code: 'rights', reject_note: 'ロゴを消してください', public: false });
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
    expect((await reviewer.post(`/api/review/revisions/${made.revision.id}/reject`, { reason: 'rights' })).status).toBe(409);

    // 直すと新しい版になる
    const again = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }));
    expect(again.status).toBe(201);
    expect(((await again.json()) as { revision: { version: string } }).revision.version).toBe('2');
  });

  test('直した版の審査中も、前の版が出続ける。公開済みの版は上書きできず、ファイルも変わらない。承認で新しい版に替わる', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const made = await published(visitor, reviewer, 'kept', { html: undefined });
    const [first] = d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE id = ${quote(made.revision.id)}`);
    const firstHtml = r2(`${first.r2_prefix}/part.html`)!;

    const fixed = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { meta: metaOf(made.id, { title: '直した題名' }), html: htmlOf(made.id, '<p>次の版</p>'), thumb: null }));
    expect(fixed.status).toBe(201);
    const next = ((await fixed.json()) as { revision: { id: string; version: string; content_hash: string } }).revision;
    expect(next.version).toBe('2');
    expect(next.id).not.toBe(made.revision.id);

    // 下書きの間も審査中も、公開は前の版のまま
    const titleNow = async () => ((await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string; title: string; version: string }[] }).works.find((work) => work.id === made.id);
    expect(await titleNow()).toMatchObject({ title: `投稿の見本 ${made.id}`, version: '1' });
    expect((await submit(visitor, next.id)).status).toBe(200);
    expect(await titleNow()).toMatchObject({ title: `投稿の見本 ${made.id}`, version: '1' });
    expect((await new Visitor().fetch(`/frame/${made.id}/2/desktop.html`, { headers: FROM_IFRAME })).status).toBe(404);
    expect(await (await new Visitor().fetch(`/frame/${made.id}/1/desktop.html`, { headers: FROM_IFRAME })).text()).toContain('押す');

    // 審査中は直せない（見ているものと承認するものがずれないように）
    expect((await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }))).status).toBe(409);

    expect((await approve(reviewer, next)).status).toBe(200);
    expect(await titleNow()).toMatchObject({ title: '直した題名', version: '2' });
    expect(await (await new Visitor().fetch(`/p/${made.id}`)).text()).toContain('次の版');
    // 前の版のファイルと行はそのまま
    expect(r2(`${first.r2_prefix}/part.html`)!.equals(firstHtml)).toBe(true);
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(made.revision.id)}`)).toEqual([{ status: 'approved' }]);

    // 前の版だけを取り下げる（SEC001 A07）。今の版は出続ける
    const revoked = await fetch(new URL(`/api/admin/revisions/${made.revision.id}/revoke`, ownOrigin()), { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(await revoked.json()).toMatchObject({ status: 'revoked', work_taken_down: false });
    expect((await new Visitor().fetch(`/frame/${made.id}/1/desktop.html`, { headers: FROM_IFRAME })).status).toBe(404);
    expect((await new Visitor().fetch(`/w/${made.id}/1/thumb.webp`)).status).toBe(404);
    expect(await publicStatus(made.id, '2')).toEqual(VISIBLE);
  });

  test('運営でない人には審査の API と下書きが見えない（404）。審査中の版を本人が承認できない', async () => {
    const { visitor } = await person();
    const made = await draft(visitor);
    await submit(visitor, made.revision.id);
    for (const actor of [visitor, new Visitor()]) {
      expect((await actor.fetch('/api/review/queue')).status).toBe(404);
      expect((await actor.fetch(`/api/review/revisions/${made.revision.id}`)).status).toBe(404);
      expect((await approve(actor, made.revision)).status).toBe(404);
      expect((await actor.post(`/api/review/revisions/${made.revision.id}/reject`, { reason: 'other' })).status).toBe(404);
    }
    expect(d1(`SELECT status FROM revisions WHERE id = ${quote(made.revision.id)}`)).toEqual([{ status: 'submitted' }]);
  });

  test('運営は1件を全部読める：コード、検査の結果、気になる書き方の印、前の版のコード。外の Origin の承認は断る', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const made = await published(visitor, reviewer, 'detail');
    const js = `export function mount(root) {
  root.dataset.href = location.href;
  postMessage('x', '*');
  return () => {};
}`;
    const fixed = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { js, html: htmlOf(made.id, '<input type="password">'), thumb: null }));
    expect(fixed.status, await fixed.clone().text()).toBe(201);
    const next = ((await fixed.json()) as { revision: { id: string; content_hash: string } }).revision;
    await submit(visitor, next.id);

    const detail = (await (await reviewer.fetch(`/api/review/revisions/${next.id}`)).json()) as {
      revision: { version: string; content_hash: string; made_with: string; frames: { desktop: string } };
      code: { html: string; js: string };
      previous: { version: string; html: string } | null;
      check: { required: unknown[]; optional: unknown[] };
      flags: { name: string; file: string; line: number }[];
    };
    expect(detail.revision).toMatchObject({ version: '2', content_hash: next.content_hash, made_with: 'human' });
    expect(detail.code.js).toBe(js);
    expect(detail.previous?.version).toBe('1');
    expect(detail.previous?.html).toContain('押す');
    expect(detail.check.required).toEqual([]);
    expect(detail.check.optional.length).toBeGreaterThan(0);
    const flags = detail.flags.map(({ name, file, line }) => `${file}:${line}:${name}`);
    for (const flag of ['part.js:2:location', 'part.js:3:postMessage', 'part.html:1:type=password']) expect(flags).toContain(flag);
    expect((await reviewer.post(`/api/review/revisions/${next.id}/approve`, { content_hash: next.content_hash }, 'https://evil.example')).status).toBe(403);
    expect((await reviewer.fetch(`/api/review/revisions/${'0'.repeat(32)}`)).status).toBe(404);
    expect((await reviewer.fetch('/api/review/revisions/not-an-id')).status).toBe(404);
  });
});

test.describe('持ち主と偽り（SEC001 A04）', () => {
  test('他人の作品と版を送っても 403。D1 と R2 が変わらない', async () => {
    const owner = await person('owner');
    const stranger = await person('stranger');
    const made = await draft(owner.visitor);
    const [before] = d1<Record<string, unknown>>(`SELECT * FROM revisions WHERE id = ${quote(made.revision.id)}`);
    const prefix = before.r2_prefix as string;
    const html = r2(`${prefix}/part.html`)!;
    const works = d1(`SELECT * FROM works WHERE id = ${quote(made.id)}`);
    const count = d1('SELECT COUNT(*) AS n FROM revisions')[0].n;

    const attack = htmlOf(made.id, '<p>乗っ取り</p>');
    expect((await postForm(stranger.visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { html: attack, thumb: null }))).status).toBe(403);
    expect((await postForm(stranger.visitor, '/api/post/works', formOf(made.id, { html: attack, thumb: null }))).status).toBe(403);
    expect((await submit(stranger.visitor, made.revision.id)).status).toBe(403);
    expect((await stranger.visitor.post(`/api/post/works/${made.id}/revoke`)).status).toBe(403);
    expect((await stranger.visitor.fetch(`/api/post/works/${made.id}`)).status).toBe(403);

    // 運営のレーベルや今ある作品（seed）にも同じ
    expect((await postForm(stranger.visitor, '/api/post/works/seed-trail-guide/revisions', formOf('seed-trail-guide', { thumb: null }))).status).toBe(403);
    expect((await stranger.visitor.post('/api/post/works/seed-trail-guide/revoke')).status).toBe(403);

    expect(d1(`SELECT * FROM revisions WHERE id = ${quote(made.revision.id)}`)).toEqual([before]);
    expect(d1(`SELECT * FROM works WHERE id = ${quote(made.id)}`)).toEqual(works);
    expect(d1('SELECT COUNT(*) AS n FROM revisions')[0].n).toBe(count);
    expect(r2(`${prefix}/part.html`)!.equals(html)).toBe(true);
    expect(d1(`SELECT status FROM works WHERE id = 'seed-trail-guide'`)).toEqual([{ status: 'approved' }]);
  });

  test('publish、label、pin、作者、状態の偽りは断る。別の人の handle を名乗れない', async () => {
    const { visitor, handle } = await person();
    const other = await person('victim');
    const count = () => d1('SELECT COUNT(*) AS n FROM revisions')[0].n;
    const before = count();

    const fields = async (extra: [string, string][]) => (await postForm(visitor, '/api/post/works', formOf(unique('fake-'), { extra }))).status;
    expect(await fields([['publish', 'true']])).toBe(400);
    expect(await fields([['pin_order', '1']])).toBe(400);
    expect(await fields([['kind', 'label']])).toBe(400);
    expect(await fields([['creator.json', '{}']])).toBe(400);

    for (const forged of [{ publish: true }, { status: 'approved' }, { pin_order: 1 }, { kind: 'label' }, { creator: other.handle }, { handle: other.handle }, { version: '9' }]) {
      const id = unique('forge-');
      const response = await postForm(visitor, '/api/post/works', formOf(id, { meta: { ...metaOf(id), ...forged } }));
      expect(response.status, JSON.stringify(forged)).toBe(400);
    }
    expect(count()).toBe(before);

    const made = await draft(visitor);
    expect(d1<{ status: string; pin_order: number | null; kind: string; handle: string }>(`SELECT w.status, w.pin_order, c.kind, c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ${quote(made.id)}`)).toEqual([{ status: 'draft', pin_order: null, kind: 'person', handle }]);
    // 今ある作品の ID は変えられない
    expect((await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { meta: metaOf('another-id') }))).status).toBe(400);
  });
});

test.describe('受け取り（SEC001 A05、A06）', () => {
  test('1ファイルの上限は 413。D1 が増えない（本文全体の上限は下の「読みながら止める」）', async () => {
    const { visitor } = await person();
    const before = d1('SELECT COUNT(*) AS n FROM revisions')[0].n;
    const id = unique('huge-');
    expect((await postForm(visitor, '/api/post/works', formOf(id, { html: htmlOf(id, 'あ'.repeat(90_000)) }))).status).toBe(413);
    expect(d1('SELECT COUNT(*) AS n FROM revisions')[0].n).toBe(before);
  });

  test('重複と知らない名前は断る。multipart でないものも、壊れた JSON も断る', async () => {
    const { visitor } = await person();
    const id = unique('dup-');
    const duplicate = formOf(id);
    duplicate.append('part.html', '<div></div>');
    expect((await postForm(visitor, '/api/post/works', duplicate)).status).toBe(400);
    for (const name of ['evil.html', '../../part.html', 'part.js.map', 'thumb.webp', 'og.png', 'meta.json']) {
      expect((await postForm(visitor, '/api/post/works', formOf(unique('name-'), { extra: [[name, 'x']] }))).status, name).toBe(400);
    }
    expect((await visitor.post('/api/post/works', { meta: {} })).status).toBe(400);
    expect((await postForm(visitor, '/api/post/works', formOf(id, { meta: '{not json' }))).status).toBe(400);
    expect((await postForm(visitor, '/api/post/works', formOf(id, { meta: '[]' }))).status).toBe(400);
    const invalidUtf8 = new FormData();
    invalidUtf8.append('meta', JSON.stringify(metaOf(id)));
    invalidUtf8.append('part.html', new Blob([new Uint8Array([0xff, 0xfe, 0x00, 0x3c])]));
    expect((await postForm(visitor, '/api/post/works', invalidUtf8)).status).toBe(400);
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(id)}`)[0].n).toBe(0);
  });

  test('壊れた画像、偽の頭、アニメーション、画素数の超過、小さすぎる画像は断り、何も置かない', async () => {
    const { visitor } = await person();
    const webp = readFileSync(join(REPO, 'fixtures/works/fx-button/thumb.webp'));
    const fakePng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.from([0, 0, 3, 32, 0, 0, 2, 88, 8, 6, 0, 0, 0, 0, 0, 0, 0])]);
    const fakeWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([22, 0, 0, 0]), Buffer.from('WEBPVP8X'), Buffer.from([10, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([31, 3, 0, 87, 2, 0])]);
    const animatedPng = (() => {
      const source = png(400, 300);
      const actl = Buffer.concat([Buffer.from([0, 0, 0, 8]), Buffer.from('acTL'), Buffer.alloc(12)]);
      return Buffer.concat([source.subarray(0, 33), actl, source.subarray(33)]);
    })();
    const animatedWebp = Buffer.from(webp);
    if (animatedWebp.subarray(12, 16).toString() === 'VP8X') animatedWebp[20] |= 0x02;

    const cases: [string, Buffer, string][] = [
      ['切れた WebP', webp.subarray(0, 400), 'thumb_broken'],
      ['頭だけの PNG', fakePng, 'thumb_broken'],
      ['頭だけの WebP', fakeWebp, 'thumb_broken'],
      ['画像でないもの', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'thumb_format'],
      ['APNG', animatedPng, 'thumb_animated'],
      ['小さすぎる', png(100, 100), 'thumb_too_small'],
      ['画素数の超過', png(2500, 2500, () => [1, 2, 3, 255]), 'thumb_too_large'],
    ];
    for (const [name, bytes, error] of cases) {
      const id = unique('img-');
      const response = await postForm(visitor, '/api/post/works', formOf(id, { thumb: bytes }));
      expect(response.status, name).toBe(422);
      expect(((await response.json()) as { error: string }).error, name).toBe(error);
      expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(id)}`)[0].n, name).toBe(0);
    }
    // 本物の PNG、WebP は通る
    expect((await postForm(visitor, '/api/post/works', formOf(unique('img-'), { thumb: webp }))).status).toBe(201);
  });

  test('イベント属性、外への通信、ページを移る JS は 422 で、どこが何で落ちたかと直し方が返る。何も置かない', async () => {
    const { visitor } = await person();
    const cases: [string, (id: string) => Parts, RegExp][] = [
      ['イベント属性', (id) => ({ html: htmlOf(id, '<input onfocus="x()">') }), /イベント属性 onfocus/],
      ['外の画像', (id) => ({ html: htmlOf(id, '<img src="https://evil.example/x.png">') }), /外へ通信/],
      ['外へのリンク', (id) => ({ html: htmlOf(id, '<a href="https://evil.example">a</a>') }), /外へ移る/],
      ['根が違う', () => ({ html: '<div data-ld-part="other">a</div>' }), /"other"/],
      ['根の外のセレクタ', () => ({ css: 'body { color: red }' }), /根の下にない/],
      ['CSS の url', (id) => ({ css: `[data-ld-part="${id}"] { background: url(https://evil.example/x.png) }` }), /外へ通信/],
      ['fetch', () => ({ js: "export function mount(root) { fetch('https://evil.example'); return () => {}; }" }), /fetch/],
      ['location', () => ({ js: "export function mount(root) { location.href = 'https://evil.example'; return () => {}; }" }), /location/],
    ];
    for (const [name, parts, pattern] of cases) {
      const id = unique('bad-');
      const response = await postForm(visitor, '/api/post/works', formOf(id, parts(id)));
      expect(response.status, name).toBe(422);
      const body = (await response.json()) as { problems: { message: string; fix: string }[] };
      expect(body.problems.map((p) => p.message).join('\n'), name).toMatch(pattern);
      expect(body.problems[0].fix, name).toBeTruthy();
      expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(id)}`)[0].n, name).toBe(0);
    }
  });

  test('1人の版の上限と保存の上限に達すると 429。上限の後は何も置かない', async () => {
    const { visitor, handle } = await person();
    const [{ id: userId }] = d1<{ id: string }>(`SELECT id FROM users WHERE handle = ${quote(handle)}`);
    const today = new Date().toISOString().slice(0, 10);
    const expires = Date.now() + 86_400_000;
    d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES (${quote(`revision:${userId}`)}, ${quote(today)}, ${POST_LIMITS.revisionsPerUserDay}, ${expires})`);
    const id = unique('limit-');
    const limited = await postForm(visitor, '/api/post/works', formOf(id));
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { limit: string }).limit).toBe('revisions');
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(id)}`)[0].n).toBe(0);

    // 保存の上限は、版を作らない上書きにも効く
    d1(`DELETE FROM quotas WHERE key = ${quote(`revision:${userId}`)}`);
    const made = await draft(visitor);
    d1(`UPDATE quotas SET n = ${POST_LIMITS.savesPerUserDay} WHERE key = ${quote(`save:${userId}`)} AND bucket = ${quote(today)}`);
    const over = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }));
    expect(over.status).toBe(429);
    expect(((await over.json()) as { limit: string }).limit).toBe('saves');
  });

  test('全体の版の上限に達すると、ほかの人も 429', async () => {
    const { visitor } = await person();
    const today = new Date().toISOString().slice(0, 10);
    d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES ('revision:*', ${quote(today)}, ${POST_LIMITS.revisionsAllDay}, ${Date.now() + 86_400_000}) ON CONFLICT (key, bucket) DO UPDATE SET n = ${POST_LIMITS.revisionsAllDay}`);
    try {
      expect((await postForm(visitor, '/api/post/works', formOf(unique('all-')))).status).toBe(429);
    } finally {
      d1(`DELETE FROM quotas WHERE key = 'revision:*'`);
    }
  });
});

test.describe('下書きの見え方', () => {
  test('持ち主と運営だけが枠とサムネイルを見られる。守りは公開の枠と同じ。キャッシュしない。ほかの人には 404', async () => {
    const { visitor } = await person();
    const stranger = await person('stranger');
    const { visitor: reviewer } = await operator();
    const made = await draft(visitor);
    const frame = made.revision.frames.desktop;

    for (const [label, actor] of [['持ち主', visitor], ['運営', reviewer]] as const) {
      const response = await actor.fetch(frame, { headers: FROM_IFRAME });
      expect(response.status, label).toBe(200);
      expect(response.headers.get('cache-control'), label).toBe('private, no-store');
      const csp = response.headers.get('content-security-policy')!;
      expect(csp, label).toContain('sandbox allow-scripts allow-forms');
      expect(csp, label).not.toContain('allow-same-origin');
      expect(csp, label).toContain("frame-ancestors 'self'");
      expect(csp, label).toContain("form-action 'none'");
      expect(await response.text(), label).toContain('押す');
      const thumb = await actor.fetch(made.revision.thumb);
      expect(thumb.status, label).toBe(200);
      expect(thumb.headers.get('cache-control'), label).toBe('private, no-store');
    }
    for (const [label, actor] of [['他人', stranger.visitor], ['ログインしていない人', new Visitor()]] as const) {
      expect((await actor.fetch(frame, { headers: FROM_IFRAME })).status, label).toBe(404);
      expect((await actor.fetch(made.revision.thumb)).status, label).toBe(404);
    }
    // 枠の外から開くと、作品を返さずに戻す
    const direct = await visitor.fetch(frame);
    expect(direct.status).toBe(302);
    expect(direct.headers.get('location')).toBe('/account/works');
    // 公開の道からは見えない
    expect(await publicStatus(made.id, made.revision.version)).toEqual(HIDDEN);
  });
});

test.describe('取り下げ', () => {
  test('持ち主はいつでも取り下げられる。公開から消え、審査待ちの版も止まる。新しい版を承認すれば戻る', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const made = await published(visitor, reviewer, 'revoke');
    expect(await publicStatus(made.id, '1')).toEqual(VISIBLE);

    const fixed = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }));
    const next = ((await fixed.json()) as { revision: { id: string; content_hash: string } }).revision;
    await submit(visitor, next.id);

    expect((await visitor.post(`/api/post/works/${made.id}/revoke`, undefined, 'https://evil.example')).status).toBe(403);
    expect((await visitor.post(`/api/post/works/${made.id}/revoke`)).status).toBe(200);
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
    expect(d1(`SELECT DISTINCT status FROM revisions WHERE work_id = ${quote(made.id)}`)).toEqual([{ status: 'revoked' }]);
    // 審査待ちの一覧からも消え、承認できない
    const queue = (await (await reviewer.fetch('/api/review/queue')).json()) as { revisions: { id: string }[] };
    expect(queue.revisions.some((one) => one.id === next.id)).toBe(false);
    expect((await approve(reviewer, next)).status).toBe(409);

    const back = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }));
    expect(back.status).toBe(201);
    const third = ((await back.json()) as { revision: { id: string; version: string; content_hash: string } }).revision;
    expect(third.version).toBe('3');
    await submit(visitor, third.id);
    expect((await approve(reviewer, third)).status).toBe(200);
    expect(await publicStatus(made.id, '3')).toEqual(VISIBLE);
  });

  test('退会すると、公開も審査待ちも止まる', async () => {
    const { visitor, handle } = await person();
    const { visitor: reviewer } = await operator();
    const made = await published(visitor, reviewer, 'leave');
    const fixed = await postForm(visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { thumb: null }));
    const next = ((await fixed.json()) as { revision: { id: string } }).revision;
    await submit(visitor, next.id);
    expect((await visitor.post('/api/account/delete')).status).toBe(204);
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
    expect(d1(`SELECT DISTINCT status FROM revisions WHERE work_id = ${quote(made.id)}`)).toEqual([{ status: 'revoked' }]);
    expect(d1(`SELECT user_id, handle FROM creators WHERE handle = ${quote(handle)}`)).toEqual([{ user_id: null, handle }]);
  });
});

test.describe('数える', () => {
  test('作り手の自分の閲覧とコピーは数えない。ほかの人とログインしていない人の分は数える', async () => {
    const { visitor } = await person();
    const { visitor: reviewer } = await operator();
    const stranger = await person('stranger');
    const made = await published(visitor, reviewer, 'count');
    const counted = () => d1<{ views: number; copies: number }>(`SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(copies), 0) AS copies FROM counters WHERE work_id = ${quote(made.id)}`)[0];
    const send = (actor: Visitor, type: string) => actor.post('/api/count', { work_id: made.id, type });

    expect((await send(visitor, 'view')).status).toBe(204);
    expect((await send(visitor, 'copy')).status).toBe(204);
    expect(counted()).toEqual({ views: 0, copies: 0 });

    expect((await send(stranger.visitor, 'view')).status).toBe(204);
    expect((await send(new Visitor(), 'copy')).status).toBe(204);
    expect(counted()).toEqual({ views: 1, copies: 1 });
  });
});

test.describe('運営の印', () => {
  test('/api/me の審査待ちの数は運営にだけ返す', async () => {
    const { visitor } = await person();
    expect(Object.keys((await visitor.me()).user).sort()).toEqual(['avatar_url', 'display_name', 'handle']);
    const { visitor: reviewer } = await operator();
    expect(typeof (await reviewer.me()).user.review_pending).toBe('number');
  });
});

test.describe('新しい人を作る回数の上限', () => {
  const tryLogin = async (ip: string, login: string) => {
    const visitor = new Visitor();
    const start = await visitor.fetch('/auth/github?next=/');
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('login_as', login);
    const back = await fetch(authorize, { redirect: 'manual' });
    return { visitor, response: await visitor.fetch(back.headers.get('location')!, { headers: { 'CF-Connecting-IP': ip } }) };
  };

  test('同じ回線（HMAC の鍵）で1日の上限を超えると作らない。今いる人のログインは止めない。生の IP を置かない', async () => {
    const ip = `198.51.100.${(Date.now() % 200) + 1}`;
    const logins: string[] = [];
    for (let i = 0; i < SIGNUP_LIMITS.perKeyDay; i += 1) {
      const login = unique('quota');
      logins.push(login);
      const { response } = await tryLogin(ip, login);
      expect(response.headers.get('location'), login).toBe('/');
    }
    const blocked = unique('quota');
    const { response, visitor } = await tryLogin(ip, blocked);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('error=signup_limited');
    expect(response.headers.get('location')).toContain('/login');
    expect((await visitor.me()).user).toBeNull();
    expect(d1(`SELECT COUNT(*) AS n FROM identities WHERE label = ${quote(blocked)}`)[0].n).toBe(0);

    // 今いる人は、同じ回線でもログインできる
    const { response: existing } = await tryLogin(ip, logins[0]);
    expect(existing.headers.get('location')).toBe('/');
    // 別の回線なら作れる
    const { response: other } = await tryLogin(`198.51.100.${((Date.now() + 77) % 200) + 1}`, unique('quota'));
    expect(other.headers.get('location')).toBe('/');

    // 置くのは HMAC だけ
    const keys = d1<{ key: string }>(`SELECT key FROM quotas WHERE key LIKE 'signup:%'`).map(({ key }) => key);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('198.51.100');
      if (key !== 'signup:*') expect(key).toMatch(/^signup:[0-9a-f]{32}$/);
    }
  });

  test('全体の1時間の上限を超えると作らない', async () => {
    const hour = new Date().toISOString().slice(0, 13);
    d1(`INSERT INTO quotas (key, bucket, n, expires_at) VALUES ('signup:*', ${quote(hour)}, ${SIGNUP_LIMITS.allHour}, ${Date.now() + 3_600_000}) ON CONFLICT (key, bucket) DO UPDATE SET n = ${SIGNUP_LIMITS.allHour}`);
    try {
      const { response } = await tryLogin(`192.0.2.${(Date.now() % 200) + 1}`, unique('quota'));
      expect(response.headers.get('location')).toContain('error=signup_limited');
    } finally {
      d1(`DELETE FROM quotas WHERE key = 'signup:*'`);
    }
  });
});

test.describe('ld upload と作者の行（docs/tasks/T021.md）', () => {
  const upload = (id: string, handle: string, name: string, version = '1') => {
    const dir = join(REPO, 'fixtures/works/fx-button');
    const replace = (text: string) => text.replaceAll('fx-button', id);
    const meta = { ...JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')), id, creator: handle, version };
    const form = new FormData();
    form.append('meta.json', new Blob([JSON.stringify(meta)]));
    form.append('part.html', new Blob([replace(readFileSync(join(dir, 'part.html'), 'utf8'))]));
    form.append('part.css', new Blob([replace(readFileSync(join(dir, 'part.css'), 'utf8'))]));
    for (const file of ['thumb.webp', 'og.png']) form.append(file, new Blob([new Uint8Array(readFileSync(join(dir, file)))]));
    form.append('creator.json', new Blob([JSON.stringify({ handle, name, kind: 'label', x_url: 'https://x.com/changed', site_url: null })]));
    form.append('avatar.webp', new Blob([new Uint8Array(readFileSync(join(REPO, 'fixtures/creators/fixture/avatar.webp')))]));
    form.append('publish', 'true');
    return fetch(new URL('/api/admin/works', ownOrigin()), { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: form });
  };

  test('人が結ばれた作者は、handle、名前、リンク、種類を上書きしない。handle を変えた後も同じ作者に入る。版の行もできる', async () => {
    const { visitor, handle } = await person('cli');
    const short = handle.slice(0, 15);
    expect((await visitor.post('/api/account/handle', { handle: short })).status).toBe(200);
    await visitor.post('/api/account/profile', { display_name: 'サイトの名前', x_url: 'https://x.com/site', site_url: '' });
    await draft(visitor); // 作者ができる
    const [before] = d1<Record<string, unknown>>(`SELECT * FROM creators WHERE handle = ${quote(short)}`);

    const id = unique('cli-');
    const sent = await upload(id, short, 'CLI の名前');
    expect(sent.status, await sent.clone().text()).toBe(201);
    expect(((await sent.json()) as { creator: { handle: string; kind: string } }).creator).toMatchObject({ handle: short, kind: 'person' });
    expect(d1(`SELECT * FROM creators WHERE handle = ${quote(short)}`)).toEqual([before]);
    expect(d1<{ status: string; r2_prefix: string }>(`SELECT status, r2_prefix FROM revisions WHERE work_id = ${quote(id)}`)).toEqual([{ status: 'approved', r2_prefix: `works/${id}/1` }]);
    expect(await publicStatus(id, '1')).toEqual(VISIBLE);

    // サイトで handle を変えても、creator.json の古い handle で同じ作者に入る
    const moved = `m${randomBytes(4).toString('hex')}`;
    expect((await visitor.post('/api/account/handle', { handle: moved })).status).toBe(200);
    const second = unique('cli-');
    expect((await upload(second, short, 'CLI の名前')).status).toBe(201);
    const [owner] = d1<{ handle: string }>(`SELECT c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ${quote(second)}`);
    expect(owner.handle).toBe(moved);
    expect(d1(`SELECT COUNT(*) AS n FROM creators WHERE handle = ${quote(short)}`)[0].n).toBe(0);
  });
});

// ---------------------------------------------------------------- 段階 B：投稿の画面

const FAKE_GITHUB = `http://localhost:${process.env.LD_TEST_GITHUB_PORT}`;

async function logInPage(page: Page, path: string, label = 'screen') {
  const login = unique(label);
  await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
  await page.goto(`/auth/github?next=${encodeURIComponent(path)}`);
  await expect(page).toHaveURL(path);
  return login;
}

async function runAxe(page: Page) {
  const results = await new AxeBuilder({ page }).exclude('iframe').analyze();
  return results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious').map((v) => `${v.id}：${v.nodes[0]?.target}`);
}

/** 1つの箱に貼るもの（コピーされるコードの形。docs/tasks/T033.md A2）。 */
function boxSnippet(id: string, { inner = '<button type="button">押す</button>', js = true, credit = true }: { inner?: string; js?: boolean; credit?: boolean } = {}) {
  return [
    ...(credit ? [`<!-- UI by @someone — ludion.ai/p/${id} (MIT) -->`] : []),
    `<div data-ld-part="${id}">${inner}</div>`,
    '<style>',
    `[data-ld-part="${id}"] { color: #123456; border-radius: 3px; }`,
    '</style>',
    ...(js
      ? [
          '<script type="module">',
          "function mount(root) {\n  const button = root.querySelector('button');\n  const onClick = () => { button.textContent = '押された'; };\n  button.addEventListener('click', onClick);\n  return () => button.removeEventListener('click', onClick);\n}",
          `mount(document.querySelector('[data-ld-part="${id}"]'));`,
          '</script>',
        ]
      : []),
  ].join('\n');
}

/** Ludion の形になっていない、ふつうの1つの HTML 文書（AI がそのまま出す形）。 */
const PLAIN_DOCUMENT = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>波紋</title>
<style>:root { --btn: #1f5f6b; } body { margin: 0; } .ripple-btn { background: var(--btn); }</style></head>
<body><button class="ripple-btn" id="btn">押してみて</button>
<script>const btn = document.getElementById('btn'); btn.addEventListener('click', () => {});</script>
</body></html>`;

/** ページのどこか（入力欄の外）で貼る。 */
async function pasteOnPage(page: Page, text: string) {
  // 箱は React が載ってから出る。載る前に貼っても受け取る手がない
  await page.locator('[data-box-status]').waitFor({ state: 'attached' });
  await page.locator('h1').evaluate((heading, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    heading.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

const LABELS = {
  ja: {
    box: 'HTML を貼る、またはファイルを落とす',
    saved: '下書きを保存しました',
    title: '題名',
    category: '種類',
    subtype: '細かい種類',
    own: /自分で作った、または権利がある/,
    mit: /MIT で公開してよい/,
    terms: /に同意します/,
    submit: '審査に出す',
    done: '審査に出しました',
    /** 置くときの「公開」（T036。初めの値は「自分だけ」） */
    public: /^公開/,
    choose: '画像を選ぶ',
    fine: 'コードを細かく直す',
  },
  en: {
    box: 'Paste HTML or drop files',
    saved: 'Draft saved',
    title: 'Title',
    category: 'Type',
    subtype: 'Subtype',
    own: /I made this UI or have the rights/,
    mit: /published under MIT/,
    terms: /I agree to the/,
    submit: 'Send for review',
    done: 'Sent for review',
    public: /^Public/,
    choose: 'Choose an image',
    fine: 'Fine-tune the code',
  },
} as const;
type Lang = keyof typeof LABELS;

/** 箱で保存された後に残る入力：題、種類、サムネイル、同意。ここで触る入力を数える（docs/tasks/T033.md「終わりの条件」）。 */
async function finishAndSubmit(page: Page, lang: Lang, title: string, { category, subtype }: { category?: string; subtype?: string } = {}) {
  const l = LABELS[lang];
  let touched = 0;
  await page.getByLabel(l.title, { exact: true }).fill(title);
  touched += 1;
  if (category) {
    await page.getByLabel(l.category, { exact: true }).selectOption(category);
    touched += 1;
  }
  if (subtype) {
    await page.getByLabel(l.subtype, { exact: true }).selectOption(subtype);
    touched += 1;
  }
  await page.locator('input[type="file"][accept^="image/"]').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: THUMB });
  touched += 1;
  for (const label of [l.own, l.mit, l.terms]) {
    await page.getByLabel(label).check();
    touched += 1;
  }
  // 新しい作品は「自分だけ」から始まる（T036）。審査に出すには「公開」を選ぶ。公開している作品の新しい版には選ぶところがない
  const publicChoice = page.getByRole('radio', { name: l.public });
  if (await publicChoice.count()) {
    await publicChoice.check();
    touched += 1;
  }
  await page.getByRole('button', { name: l.submit, exact: true }).click();
  touched += 1;
  await expect(page.getByText(l.done)).toBeVisible();
  return touched;
}

/** 投稿の保存の要求を数える。 */
function countSaves(page: Page) {
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/post\/works(\/[^/]+\/revisions)?$/.test(new URL(request.url()).pathname)) saves.push(request.url());
  });
  return saves;
}

/** 審査に出した版を承認する。 */
async function approveLatest(reviewer: Visitor, workId: string) {
  const [revision] = d1<{ id: string; content_hash: string }>(`SELECT id, content_hash FROM revisions WHERE work_id = ${quote(workId)} AND status = 'submitted'`);
  expect(revision, workId).toBeTruthy();
  expect((await approve(reviewer, revision)).status).toBe(200);
}

const listedWorks = async () => ((await (await new Visitor().fetch('/api/works')).json()) as { works: { id: string; remix: boolean; title: string }[] }).works;

test.describe('投稿の画面：1つの箱（T033 段階 A）', () => {
  test('ログインしていなければログインへ送り、終わったら戻る（?from= も残る）', async ({ page }) => {
    const anonymous = await new Visitor().fetch('/new');
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('/login?next=%2Fnew');
    const english = await new Visitor().fetch('/en/new?work=abc');
    expect(english.headers.get('location')).toBe('/en/login?next=%2Fen%2Fnew%3Fwork%3Dabc');
    const from = await new Visitor().fetch('/new?from=toggle-daylight');
    expect(from.headers.get('location')).toBe('/login?next=%2Fnew%3Ffrom%3Dtoggle-daylight');

    await logInPage(page, '/new');
    await expect(page.getByRole('heading', { level: 1, name: '作品を置く' })).toBeVisible();
    await expect(page).toHaveTitle('作品を置く · Ludion');
  });

  test('入口：サイドバーとアカウントのメニューに「作品を置く」。ホームの並びには足さない', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await logInPage(page, '/');
    await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByRole('link', { name: '作品を置く' })).toHaveAttribute('href', '/new');
    await expect(page.locator('main').getByRole('link', { name: '作品を置く' })).toHaveCount(0);
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    const item = page.getByRole('menuitem', { name: '作品を置く' });
    await expect(item).toHaveAttribute('href', '/new');
    await item.click();
    await expect(page).toHaveURL('/new');
  });

  test('箱が空のうちは、箱だけ。ほかの欄（題名、ID、コードの3つ、審査に出す、AI の指示文）は出さない', async ({ page }) => {
    await logInPage(page, '/new');
    await expect(page.getByLabel(LABELS.ja.box)).toBeVisible();
    await expect(page.getByText('ファイルを選ぶ')).toBeVisible();
    for (const label of ['題名', '作品の ID', 'HTML（part.html）', 'CSS（part.css）', 'JS（part.js）']) await expect(page.getByLabel(label, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '審査に出す' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'AI で Ludion の形に直す' })).toHaveCount(0);
  });

  for (const lang of ['ja', 'en'] as const) {
    test(`${lang}：HTML を1回貼る → 自動で下書き → 枠で動く → 題、種類、サムネイル、同意 → 審査に出す → 承認 → 一覧に出る。ID もコードの3つの欄も触らない`, async ({ page }) => {
      const { visitor: reviewer } = await operator();
      await page.setViewportSize({ width: 1280, height: 900 });
      const base = lang === 'en' ? '/en' : '';
      await logInPage(page, `${base}/new`);
      const saves = countSaves(page);
      const id = unique('paste-');
      // 入力欄の外で貼っても、箱に入る
      await pasteOnPage(page, boxSnippet(id));
      await expect(page.getByLabel(LABELS[lang].box)).toHaveValue(/data-ld-part/);
      await expect(page.locator('[data-box-status]')).toContainText(LABELS[lang].saved);
      // 直したこと：クレジットの行を外した
      await expect(page.locator('[data-box-fixed]')).toBeVisible();

      // 下書きの枠で動く。sandbox の守りはそのまま
      const frame = page.locator('iframe[data-ld-frame]');
      await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
      await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' }).click();
      await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押された' })).toBeVisible();

      // 作品の ID は貼ったコードの値。下書きにはサムネイルがない
      const [row] = d1<{ id: string; thumb_w: number; title: string; made_with: string }>(`SELECT w.id, r.thumb_w, r.title, r.made_with FROM works w JOIN revisions r ON r.work_id = w.id WHERE w.id = ${quote(id)}`);
      expect(row).toMatchObject({ id, thumb_w: 0, title: '', made_with: 'ai-assisted' });
      expect(saves).toHaveLength(1);
      // 同じ中身をもう一度貼っても、保存しない
      await pasteOnPage(page, boxSnippet(id));
      await page.waitForTimeout(1500);
      expect(saves).toHaveLength(1);

      // 「細かく直す」は閉じたまま
      await expect(page.locator('details', { hasText: LABELS[lang].fine })).not.toHaveAttribute('open');
      const touched = await finishAndSubmit(page, lang, `Pasted ${lang} ${id}`, { subtype: 'Toggle' });
      // 貼る（1）＋ 題、細かい種類、サムネイル、同意3つ、「公開」を選ぶ（T036 で足した1つ。初めの値は「自分だけ」）、審査に出す
      expect(1 + touched).toBe(9);
      expect(saves).toHaveLength(2);
      expect(d1<{ status: string }>(`SELECT status FROM revisions WHERE work_id = ${quote(id)}`)[0].status).toBe('submitted');

      await approveLatest(reviewer, id);
      const listed = (await listedWorks()).find((work) => work.id === id);
      expect(listed).toMatchObject({ title: `Pasted ${lang} ${id}`, remix: false });
    });
  }

  test('HTML、CSS、JS の3つのファイルを一度に落としても同じ：自動で下書き → 枠で動く → 審査に出す → 承認 → 一覧に出る', async ({ page }) => {
    const { visitor: reviewer } = await operator();
    await logInPage(page, '/new');
    const id = unique('files-');
    const js = "export function mount(root) {\n  const button = root.querySelector('button');\n  const onClick = () => { button.textContent = '押された'; };\n  button.addEventListener('click', onClick);\n  return () => button.removeEventListener('click', onClick);\n}\n";
    await page.locator('input[type="file"][multiple]').setInputFiles([
      { name: 'part.html', mimeType: 'text/html', buffer: Buffer.from(`<div data-ld-part="${id}"><button type="button">押す</button></div>`) },
      { name: 'part.css', mimeType: 'text/css', buffer: Buffer.from(`[data-ld-part="${id}"] { color: #123456; }`) },
      { name: 'part.js', mimeType: 'text/javascript', buffer: Buffer.from(js) },
    ]);
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' }).click();
    await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押された' })).toBeVisible();
    await finishAndSubmit(page, 'ja', `Files ${id}`, { subtype: 'Button' });
    await approveLatest(reviewer, id);
    expect((await listedWorks()).some((work) => work.id === id)).toBe(true);
    const [revision] = d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE work_id = ${quote(id)}`);
    expect(r2(`${revision.r2_prefix}/part.js`)!.toString()).toBe(js);
  });

  test('ファイルの数と種類が合わないときは、文で知らせる', async ({ page }) => {
    await logInPage(page, '/new');
    const input = page.locator('input[type="file"][multiple]');
    await input.setInputFiles([{ name: 'a.css', mimeType: 'text/css', buffer: Buffer.from('a{}') }]);
    await expect(page.locator('[data-box-status]')).toHaveText('HTML のファイルがありません');
    await input.setInputFiles([
      { name: 'a.html', mimeType: 'text/html', buffer: Buffer.from('<div></div>') },
      { name: 'b.html', mimeType: 'text/html', buffer: Buffer.from('<div></div>') },
    ]);
    await expect(page.locator('[data-box-status]')).toContainText('それぞれ1つまで');
  });

  test('形の合わない HTML を貼ると、何が足りないかを文で出し、「AI で Ludion の形に直す」を案内する。保存しない', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await logInPage(page, '/new');
    const saves = countSaves(page);
    await page.getByLabel(LABELS.ja.box).fill(PLAIN_DOCUMENT);
    const status = page.locator('[data-box-status]');
    await expect(status).toContainText('このままでは載せられません。足りないところが');
    const results = page.locator('[data-post-check]');
    await expect(results).toContainText('根の下にない');
    await expect(results).toContainText('mount を export していない');
    await expect(results).toContainText('document.getElementById');
    await expect(results).toContainText('直し方：');
    await expect(results).toContainText('「AI で Ludion の形に直す」の指示文を、自分の AI に渡してください');
    // 機械で直せたもの（包みを外す、data-ld-part を付ける）は1行で出す
    await expect(page.locator('[data-box-fixed]')).toContainText('<!doctype> と <html> の包みを外しました');
    await expect(page.locator('[data-box-fixed]')).toContainText('根の要素に data-ld-part=');
    await expect(page.getByRole('heading', { name: 'AI で Ludion の形に直す' })).toBeVisible();
    await page.getByRole('button', { name: '指示文をコピー' }).click();
    await expect(page.getByRole('button', { name: 'コピーしました' })).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    for (const word of ['1つの HTML', '<script type="module">', 'function mount(root)', "mount(document.querySelector('[data-ld-part=", 'fetch', 'location', 'prefers-reduced-motion', '--_bg']) expect(prompt).toContain(word);
    expect(prompt).not.toContain('3つのコードブロック');
    await page.waitForTimeout(1000);
    expect(saves).toHaveLength(0);
    await expect(page.locator('iframe[data-ld-frame]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '審査に出す' })).toHaveCount(0);

    // 分けられないもの：外のスクリプト
    await page.getByLabel(LABELS.ja.box).fill('<div data-ld-part="x">a</div><script src="https://evil.example/a.js"></script>');
    await expect(status).toContainText('<script src>');
    await expect(page.getByRole('heading', { name: 'AI で Ludion の形に直す' })).toBeVisible();
  });

  test('ほかの入力欄で貼ったときは、箱に奪わない', async ({ page }) => {
    await logInPage(page, '/new');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('steal-'), { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    const title = page.getByLabel('題名', { exact: true });
    await title.evaluate((input, value) => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, '<div>奪わない</div>');
    await expect(page.getByLabel(LABELS.ja.box)).not.toHaveValue(/奪わない/);
  });

  test('「細かく直す」：分けた3つが入り、直すと箱に戻って保存される。ID を変えると新しい ID で保存し直し、前の下書きは消える', async ({ page }) => {
    await logInPage(page, '/new');
    const first = unique('fine-');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(first));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await page.getByText('コードを細かく直す').click();
    await expect(page.getByLabel('HTML（part.html）')).toHaveValue(`<div data-ld-part="${first}"><button type="button">押す</button></div>`);
    await expect(page.getByLabel('JS（part.js）')).toHaveValue(/^export function mount\(root\)/);
    await page.getByLabel('CSS（part.css）').fill(`[data-ld-part="${first}"] { color: #654321; }`);
    await expect(page.getByLabel(LABELS.ja.box)).toHaveValue(/#654321/);
    await expect.poll(() => r2(`${d1<{ r2_prefix: string }>(`SELECT r2_prefix FROM revisions WHERE work_id = ${quote(first)}`)[0].r2_prefix}/part.css`)?.toString()).toContain('#654321');

    const next = unique('renamed-');
    await page.getByLabel('作品の ID').fill(next);
    await expect(page.getByText('使えます')).toBeVisible();
    await page.getByRole('button', { name: 'この ID にする' }).click();
    await expect(page.getByText('ID を変えました')).toBeVisible();
    await expect(page.getByLabel(LABELS.ja.box)).toHaveValue(new RegExp(`data-ld-part="${next}"`));
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(first)}`)[0].n).toBe(0);
    expect(d1(`SELECT COUNT(*) AS n FROM works WHERE id = ${quote(next)}`)[0].n).toBe(1);
    await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' })).toBeVisible();
  });

  test('題とサムネイルがないうちは審査に出せない。知らせる', async ({ page }) => {
    await logInPage(page, '/new');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('gate-'), { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    for (const label of [LABELS.ja.own, LABELS.ja.mit, LABELS.ja.terms]) await page.getByLabel(label).check();
    // 初めの値は「自分だけ」（T036）。審査に出すには「公開」を選ぶ
    await page.getByRole('radio', { name: LABELS.ja.public }).check();
    const send = page.getByRole('button', { name: '審査に出す' });
    await expect(send).toBeDisabled();
    await expect(page.locator('[data-submit-status]')).toHaveText('題名を入れてください');
    await page.getByLabel('題名', { exact: true }).fill('題だけ');
    await expect(page.locator('[data-submit-status]')).toHaveText('サムネイルの画像を選んでください');
    await expect(send).toBeDisabled();
    await page.locator('input[type="file"][accept^="image/"]').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: THUMB });
    await expect(send).toBeEnabled();
  });

  test('自分の作品の一覧：題とサムネイルのない下書きは、仮の題と「画像なし」で出る', async ({ page }) => {
    await logInPage(page, '/new');
    const id = unique('bare-');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(id, { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await page.goto('/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.getByRole('heading', { name: '無題の下書き' })).toBeVisible();
    await expect(row).toContainText('画像なし');
    await expect(row.locator('[data-own-work-status]')).toHaveText('下書き');
  });

  test('直す画面：開いただけでは新しい版を作らない。貼り直すと新しい版で、公開中の版は残る。差し戻しの理由が見える。取り下げは2段階', async ({ page }) => {
    const { visitor: reviewer } = await operator();
    const owner = await logInPage(page, '/new', 'editor');
    const id = unique('edit-');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(id, { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await finishAndSubmit(page, 'ja', `Edit ${id}`);
    await approveLatest(reviewer, id);

    await page.goto('/account/works');
    const row = page.locator(`[data-own-work="${id}"]`);
    await expect(row.locator('[data-own-work-status]')).toHaveText('公開');
    const saves = countSaves(page);
    await row.getByRole('link', { name: /の新しい版を置く$/ }).click();
    await expect(page).toHaveURL(`/new?work=${id}`);
    await expect(page.getByText('審査の間は、今の公開の版がそのまま出ます')).toBeVisible();
    await expect(page.getByLabel(LABELS.ja.box)).toHaveValue(new RegExp(`data-ld-part="${id}"`));
    await page.waitForTimeout(1500);
    expect(saves).toHaveLength(0);
    expect(d1(`SELECT COUNT(*) AS n FROM revisions WHERE work_id = ${quote(id)}`)[0].n).toBe(1);
    await page.getByText('コードを細かく直す').click();
    await expect(page.getByLabel('作品の ID')).toBeDisabled();

    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(id, { inner: '<p>次の版の中身</p>', js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await expect(page.frameLocator('iframe[data-ld-frame]').getByText('次の版の中身')).toBeVisible();
    const [next] = d1<{ id: string }>(`SELECT id FROM revisions WHERE work_id = ${quote(id)} AND version = '2'`);
    const ownerVisitor = new Visitor();
    await ownerVisitor.login(owner);
    // 画像は前の版から引き継いでいるので、題と同意だけで出せる
    expect((await submit(ownerVisitor, next.id)).status).toBe(200);
    expect(await publicStatus(id, '1')).toEqual(VISIBLE);
    expect((await reviewer.post(`/api/review/revisions/${next.id}/reject`, { reason: 'rights', note: 'ロゴを消してください' })).status).toBe(200);

    await page.goto('/account/works');
    await expect(row.locator('[data-own-work-status]')).toHaveText('差し戻し');
    await expect(row).toContainText('ロゴを消してください');
    await expect(row).toContainText('公開中の版（版 1）はそのまま出ています');
    await row.getByRole('link', { name: /の新しい版を置く$/ }).click();
    await expect(page.getByText('ロゴを消してください')).toBeVisible();

    // 持ち主の「取り下げ」は「自分だけにする」に置き換えた（T036）。確かめの一言の後で、すぐ公開から消える
    await page.goto('/account/works');
    await row.getByRole('button', { name: /を自分だけにする$/ }).click();
    await expect(row).toContainText('リンクを開いても見られなくなります');
    await row.getByRole('button', { name: 'やめる' }).click();
    expect(await publicStatus(id, '1')).toEqual(VISIBLE);
    await row.getByRole('button', { name: /を自分だけにする$/ }).click();
    await row.getByRole('button', { name: '自分だけにする', exact: true }).click();
    // いちばん新しい版は差し戻しのままなので、札は「差し戻し」。作品は自分だけになる
    await expect(row).toContainText('自分だけの版（版 1）はそのままです');
    expect(d1(`SELECT status FROM works WHERE id = ${quote(id)}`)).toEqual([{ status: 'private' }]);
    expect(await publicStatus(id, '1')).toEqual(HIDDEN);
  });

  test('読めない画像は、選んだところで知らせる。前に選んだ良い画像は残る', async ({ page }) => {
    await logInPage(page, '/new');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('image-'), { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    const input = page.locator('input[type="file"][accept^="image/"]');
    await input.setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: THUMB });
    await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.getByText('この画像は読めません')).toBeVisible();
    await page.getByLabel('題名', { exact: true }).fill('画像');
    for (const label of [LABELS.ja.own, LABELS.ja.mit, LABELS.ja.terms]) await page.getByLabel(label).check();
    await page.getByRole('radio', { name: LABELS.ja.public }).check();
    await page.getByRole('button', { name: '審査に出す' }).click();
    await expect(page.getByText('審査に出しました')).toBeVisible();
  });

  test('サーバーで落ちたときも、問題を画面に出す（画面の検査を飛ばしても通らない）', async ({ page }) => {
    await logInPage(page, '/new');
    await page.route('**/api/post/works', (route) =>
      route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'invalid', problems: [{ message: 'サーバーの問題', fix: 'サーバーの直し方' }] }) }),
    );
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('server-'), { js: false }));
    await expect(page.getByText('サーバーの問題')).toBeVisible();
    await expect(page.getByText('サーバーの直し方')).toBeVisible();
    await expect(page.locator('[data-box-status]')).toHaveText('直すところがあります');
  });

  test('他人の作品の直す画面は開けない', async ({ page }) => {
    const { visitor } = await person('owner');
    const made = await draft(visitor);
    await logInPage(page, `/new?work=${made.id}`);
    await expect(page.getByText('この作品は直せません')).toBeVisible();
    await expect(page.getByLabel(LABELS.ja.box)).toHaveCount(0);
  });

  for (const { width, height } of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    test(`幅${width}：空の箱と保存の後で、横スクロールが出ず、axe の critical と serious が0。押せるものは44px`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await logInPage(page, '/new');
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await runAxe(page)).toEqual([]);
      await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('layout-')));
      await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await runAxe(page)).toEqual([]);
      for (const target of [page.getByRole('button', { name: '自分だけで置く' }), page.getByText('ファイルを選ぶ'), page.getByText('コードを細かく直す'), page.getByText('画像を選ぶ')]) {
        expect((await target.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await page.goto('/account/works');
      await expect(page.locator('[data-own-work]').first()).toBeVisible();
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
      expect(await runAxe(page)).toEqual([]);
    });
  }

  test('スクリーンショット（投稿の画面）', async ({ page }) => {
    test.skip(!process.env.LD_SHOTS, 'LD_SHOTS のときだけ');
    const dir = join(REPO, 'docs/screens');
    for (const { width, height } of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize({ width, height });
      await page.context().clearCookies();
      await logInPage(page, '/new');
      await page.screenshot({ path: join(dir, `t033-new-empty-${width}.png`), fullPage: true });
      await page.getByLabel(LABELS.ja.box).fill(PLAIN_DOCUMENT);
      await expect(page.locator('[data-box-status]')).toContainText('このままでは載せられません');
      await page.screenshot({ path: join(dir, `t033-new-problems-${width}.png`), fullPage: true });
      await page.getByLabel(LABELS.ja.box).fill(boxSnippet(unique('shot-')));
      await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
      await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' })).toBeVisible();
      await page.screenshot({ path: join(dir, `t033-new-saved-${width}.png`), fullPage: true });
    }
  });

  test('英語のページ：文言と検査の文が英語で出る', async ({ page }) => {
    await logInPage(page, '/en/new');
    await expect(page.getByRole('heading', { level: 1, name: 'Post a work' })).toBeVisible();
    await page.getByLabel(LABELS.en.box).fill('<div onclick="x()">a</div><div>b</div>');
    const results = page.locator('[data-post-check]');
    await expect(page.locator('[data-box-status]')).toContainText('It can’t be posted as is.');
    await expect(results).toContainText('event attribute onclick');
    await expect(results).toContainText('How to fix:');
    await expect(page.getByRole('heading', { name: 'Use AI to fit the Ludion format' })).toBeVisible();
  });
});

test.describe('リミックスを元の作品とつなぐ（T033 段階 B）', () => {
  test('作品のページ → リミックスのシート → /new?from= → 貼る → 出す → 承認 → 帯つきで出る。remix_of が入り、コピーされるコードの2行目に元のクレジット行', async ({ page }) => {
    const original = await person('origin');
    const { visitor: reviewer } = await operator();
    const source = await published(original.visitor, reviewer, 'origin', {
      meta: metaOf(undefined, { category: 'Components', subtype: 'Slider', tags: ['experimental'], motion: true }),
    });
    await logInPage(page, '/');
    await page.goto(`/p/${source.id}`);
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
    await page.getByRole('button', { name: 'リミックス', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'リミックス' });
    const link = sheet.getByRole('link', { name: 'Ludion に載せる' });
    await expect(link).toHaveAttribute('href', `/new?from=${source.id}`);
    await link.click();
    await expect(page).toHaveURL(`/new?from=${source.id}`);
    await expect(page.locator(`[data-remix-of="${source.id}"]`)).toContainText(`「投稿の見本」（@${original.handle}）のリミックスを載せる`);
    await expect(page.locator(`[data-remix-of="${source.id}"]`).getByRole('link', { name: '元の作品を見る' })).toHaveAttribute('href', `/p/${source.id}`);

    // AI は元の data-ld-part のまま返す（指示文が「属性を残す」と言うため）。箱が新しい ID に合わせる
    await pasteOnPage(page, [`<!-- UI by @${original.handle} — ludion.ai/p/${source.id} (MIT) -->`, '<!-- Remixed by Claude -->', boxSnippet(source.id, { credit: false })].join('\n'));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    await expect(page.locator('[data-box-fixed]')).toContainText(`data-ld-part を "${source.id}" から`);
    const [work] = d1<{ id: string; remix_of: string; is_remix: number; category: string; subtype: string; tags: string; made_with: string }>(
      `SELECT id, remix_of, is_remix, category, subtype, tags, made_with FROM works WHERE remix_of = ${quote(source.id)}`,
    );
    expect(work).toMatchObject({ remix_of: source.id, is_remix: 1, category: 'Components', subtype: 'Slider', made_with: 'ai-assisted' });
    expect(JSON.parse(work.tags).sort()).toEqual(['experimental', 'motion']);
    expect(work.id).toMatch(new RegExp(`^${source.id}-[0-9a-f]{4}$`));

    await finishAndSubmit(page, 'ja', 'Snow cabin remix');
    await approveLatest(reviewer, work.id);
    expect((await listedWorks()).find((listed) => listed.id === work.id)?.remix).toBe(true);
    await page.goto('/');
    await expect(page.locator(`a[href="/p/${work.id}"]`).first().locator('.remix-ribbon')).toHaveText('Remix');
    const code = (await (await new Visitor().fetch(`/p/${work.id}/code`)).text()).split('\n');
    expect(code[1]).toBe(`<!-- Remix of UI by @${original.handle} — ludion.ai/p/${source.id} (MIT) -->`);
  });

  test('悪い from：ない作品、承認されていない作品、自分自身のときは、from を捨ててふつうの /new と同じ。保存しても remix_of は入らない', async ({ page }) => {
    const owner = await person('pending-owner');
    const pending = await draft(owner.visitor, 'pending');
    await logInPage(page, '/new');
    for (const from of ['no-such-work-here', pending.id, '../etc']) {
      await page.goto(`/new?from=${encodeURIComponent(from)}`);
      await expect(page.getByLabel(LABELS.ja.box)).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page.locator('[data-remix-of]')).toHaveCount(0);
    }
    const id = unique('nofrom-');
    await page.getByLabel(LABELS.ja.box).fill(boxSnippet(id, { js: false }));
    await expect(page.locator('[data-box-status]')).toContainText(LABELS.ja.saved);
    expect(d1(`SELECT remix_of, is_remix FROM works WHERE id = ${quote(id)}`)[0]).toEqual({ remix_of: null, is_remix: 0 });

    // 自分自身：直す画面に自分の ID を from で渡しても、つながない
    await page.goto(`/new?work=${id}&from=${id}`);
    await expect(page.getByLabel(LABELS.ja.box)).toHaveValue(new RegExp(`data-ld-part="${id}"`));
    await page.waitForTimeout(500);
    await expect(page.locator('[data-remix-of]')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------- 全員に開くまで（POSTING_OPEN）

test.describe('投稿を開くまでは運営だけ（docs/PHASE0.md の条件）', () => {
  // テストのサーバーは開いた形で動くので、閉じた形は Worker を直に呼ぶ
  async function loadApp() {
    const server = await createServer({
      root: WEB,
      configFile: false,
      logLevel: 'silent',
      appType: 'custom',
      server: { middlewareMode: true, hmr: false, watch: null },
      plugins: [
        {
          name: 'stub-virtual',
          enforce: 'pre',
          resolveId: (id: string) => (id.startsWith('virtual:ludion/') ? `\0${id}` : undefined),
          load: (id: string) => (id.startsWith('\0virtual:ludion/') ? 'export default ""; export const renderApp = async () => new ReadableStream({ start(controller) { controller.close(); } });' : undefined),
        },
      ],
    });
    const { app } = (await server.ssrLoadModule('/worker/app.ts')) as { app: { request: (path: string, init: RequestInit, env: unknown) => Promise<Response> } };
    return { app, close: () => server.close() };
  }

  /** セッションの行だけを返す D1。 */
  const envFor = (isOperator: number, open: string) => {
    const row = { id: 'u1', handle: 'someone', display_name: null, avatar_url: null, is_operator: isOperator, auth_at: Date.now(), last_used_at: Date.now() + 86_400_000, n: 0 };
    const statement = { bind: () => statement, first: async () => row, all: async () => ({ results: [] }), run: async () => ({ meta: { changes: 0 } }) };
    return {
      POSTING_OPEN: open,
      DB: { prepare: () => statement, batch: async () => [{ results: [] }, { results: [] }] },
      ASSETS: { fetch: async () => new Response('<html lang="ja"><title>x</title><div id="root"></div></html>') },
    };
  };
  const anonymousEnv = (open: string) => ({ ...envFor(0, open), DB: { prepare: () => { throw new Error('読まない'); } } });
  const session = { Cookie: `ld_session=${'a'.repeat(64)}` };
  const origin = 'http://localhost';
  const write = { ...session, Origin: origin };

  test('閉じているとき：運営でない人には /new、保存、審査に出す、ID の確かめが 404。入口も出さない。自分の作品の一覧と取り下げは使える。運営は使える', async () => {
    const { app, close } = await loadApp();
    try {
      const closed = envFor(0, '0');
      expect((await app.request('/new', {}, anonymousEnv('0'))).status).toBe(404);
      // 404 のときは、HTML のデータでも 404 と伝える（画面が投稿の形を描かない）
      expect(await (await app.request('/new', {}, anonymousEnv('0'))).text()).toContain('"kind":"not-found"');
      expect((await app.request('/en/new', {}, anonymousEnv('0'))).status).toBe(404);
      expect((await app.request('/new', { headers: session }, closed)).status).toBe(404);
      expect((await app.request('/api/post/id-check?id=abc', { headers: session }, closed)).status).toBe(404);
      const body = () => formOf('closed-work');
      expect((await app.request(`${origin}/api/post/works`, { method: 'POST', headers: write, body: body() }, closed)).status).toBe(404);
      expect((await app.request(`${origin}/api/post/works/some-work/revisions`, { method: 'POST', headers: write, body: body() }, closed)).status).toBe(404);
      expect((await app.request(`${origin}/api/post/revisions/${'0'.repeat(32)}/submit`, { method: 'POST', headers: write, body: '{}' }, closed)).status).toBe(404);
      const me = (await (await app.request('/api/me', { headers: session }, closed)).json()) as { can_post: boolean };
      expect(me.can_post).toBe(false);
      // 自分の作品の一覧は誰でも読める（空なら空）。開く前からある「自分の作品」のリンクを壊さない
      expect((await app.request('/api/post/works', { headers: session }, closed)).status).toBe(200);

      const operatorEnv = envFor(1, '0');
      expect((await app.request('/new', { headers: session }, operatorEnv)).status).toBe(200);
      expect((await app.request('/api/post/id-check?id=abc', { headers: session }, operatorEnv)).status).toBe(200);
      const operatorMe = (await (await app.request('/api/me', { headers: session }, operatorEnv)).json()) as { can_post: boolean };
      expect(operatorMe.can_post).toBe(true);
    } finally {
      await close();
    }
  });

  test('開いているとき：ログインしていなければログインへ。ログインしていれば誰でも', async () => {
    const { app, close } = await loadApp();
    try {
      const anonymous = await app.request('/new', {}, anonymousEnv('1'));
      expect(anonymous.status).toBe(302);
      expect(anonymous.headers.get('location')).toBe('/login?next=%2Fnew');
      expect((await app.request('/new', { headers: session }, envFor(0, '1'))).status).toBe(200);
      const me = (await (await app.request('/api/me', { headers: session }, envFor(0, '1'))).json()) as { can_post: boolean };
      expect(me.can_post).toBe(true);
    } finally {
      await close();
    }
  });

  test('大きすぎる本文は読みながら止める：Content-Length があってもなくても 413。上限を超えたところで読むのをやめる。D1 に書かない', async () => {
    const { app, close } = await loadApp();
    try {
      const open = envFor(0, '1');
      const run = () => {
        throw new Error('D1 に書いた');
      };
      const env = { ...open, DB: { ...open.DB, prepare: (sql: string) => (/^\s*(INSERT|UPDATE|DELETE)/.test(sql) && !/sessions|quotas/.test(sql) ? run() : open.DB.prepare()) } };
      const headers = { ...write, 'Content-Type': 'multipart/form-data; boundary=x' };
      const declared = await app.request(`${origin}/api/post/works`, { method: 'POST', headers: { ...headers, 'Content-Length': String(4 * 1024 * 1024 + 1) }, body: new Uint8Array(16) }, env);
      expect(declared.status).toBe(413);

      // Content-Length なし（流しながら送る）。上限の少し先までしか読まない
      let sent = 0;
      const chunk = 256 * 1024;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          sent += chunk;
          if (sent > 64 * 1024 * 1024) controller.close();
          else controller.enqueue(new Uint8Array(chunk));
        },
      });
      const streamed = await app.request(`${origin}/api/post/works`, { method: 'POST', headers, body: stream, duplex: 'half' } as RequestInit, env);
      expect(streamed.status).toBe(413);
      expect(sent).toBeLessThan(6 * 1024 * 1024);
    } finally {
      await close();
    }
  });

  test('本番の設定は開いている（11/10 の CEO の決定。docs/reports/T032.md）', () => {
    expect(readFileSync(join(WEB, 'wrangler.jsonc'), 'utf8')).toContain('"POSTING_OPEN": "1"');
  });
});

// ---------------------------------------------------------------- 段階 C：審査の画面

test.describe('審査の画面（段階 C）', () => {
  /** 前のテストの審査待ちを片付ける（画面は古い順に出すので、見る版を決めるため）。 */
  const clearQueue = () => d1(`UPDATE revisions SET status = 'revoked' WHERE status = 'submitted'`);

  async function logInOperatorPage(page: Page, path = '/admin/review') {
    const login = unique('operator');
    await page.context().addCookies([{ name: 'fake_user', value: login, url: FAKE_GITHUB }]);
    await page.goto('/auth/github?next=/');
    d1(`UPDATE users SET is_operator = 1 WHERE id = (SELECT user_id FROM identities WHERE provider = 'github' AND label = ${quote(login)})`);
    await page.goto(path);
    return login;
  }

  test('運営でない人とログインしていない人には 404', async ({ page }) => {
    for (const path of ['/admin/review', '/en/admin/review']) expect((await new Visitor().fetch(path)).status, path).toBe(404);
    const { visitor } = await person();
    const response = await visitor.fetch('/admin/review');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    await logInPage(page, '/');
    const opened = await page.goto('/admin/review');
    expect(opened?.status()).toBe(404);
    await expect(page.getByText('このページはありません')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: '審査' })).toHaveCount(0);
    // メニューにも出ない
    await page.goto('/');
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    await expect(page.getByRole('menuitem', { name: /審査/ })).toHaveCount(0);
  });

  test('スマホの幅で：動き → 気になる書き方の印 → 承認と差し戻しの順。最初の画面にボタンが見える。承認で公開され、次の版へ進む', async ({ page }) => {
    clearQueue();
    await page.setViewportSize({ width: 390, height: 844 });
    const owner = await person('creator');
    const first = await draft(owner.visitor, 'first', { js: "export function mount(root) { root.dataset.href = location.href; return () => {}; }" });
    await submit(owner.visitor, first.revision.id);
    const second = await draft(owner.visitor, 'second');
    await submit(owner.visitor, second.revision.id);

    await logInOperatorPage(page);
    await expect(page.getByRole('heading', { level: 1, name: '審査' })).toBeVisible();
    await expect(page.getByText('審査待ち 2 件')).toBeVisible();
    const item = page.locator(`[data-review-item="${first.revision.id}"]`);
    await expect(item).toBeVisible();

    // 枠はスマホの幅で動く。守りは同じ
    const frame = page.locator('iframe[data-ld-frame]');
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
    await expect(frame).toHaveAttribute('src', /\/mobile\.html/);
    await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' })).toBeVisible();
    await expect(page.locator('[data-review-flags]')).toContainText('location');

    // 並びの順
    const approve = page.getByRole('button', { name: '承認', exact: true });
    const [frameBox, flagsBox] = await Promise.all([frame.boundingBox(), page.locator('[data-review-flags]').boundingBox()]);
    expect(frameBox!.y).toBeLessThan(flagsBox!.y);
    await expect(approve).toBeInViewport();
    await expect(page.getByRole('button', { name: '差し戻し', exact: true })).toBeInViewport();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    expect(await runAxe(page)).toEqual([]);

    await approve.click();
    // 次の版へ
    await expect(page.locator(`[data-review-item="${second.revision.id}"]`)).toBeVisible();
    await expect(page.getByText('審査待ち 1 件')).toBeVisible();
    expect(await publicStatus(first.id, '1')).toEqual(VISIBLE);
    expect(await (await new Visitor().fetch('/?sort=new')).text()).toContain(`/p/${first.id}`);
    expect(d1(`SELECT reviewed_by IS NOT NULL AS has FROM revisions WHERE id = ${quote(first.revision.id)}`)).toEqual([{ has: 1 }]);

    // 差し戻し：理由を選ぶまで押せない。理由は作り手に見える
    await page.getByRole('button', { name: '差し戻し', exact: true }).click();
    const send = page.getByRole('button', { name: '差し戻す' });
    await expect(send).toBeDisabled();
    await page.getByLabel('差し戻しの理由').selectOption('quality');
    await page.getByLabel('ひとこと').fill('動きをもう少し');
    await send.click();
    await expect(page.getByText('審査待ちはありません')).toBeVisible();
    const { works } = (await (await owner.visitor.fetch('/api/post/works')).json()) as { works: { id: string; status: string; reject_code: string; reject_note: string }[] };
    expect(works.find((work) => work.id === second.id)).toMatchObject({ status: 'rejected', reject_code: 'quality', reject_note: '動きをもう少し' });
  });

  test('コードの全文、前の版との差分、サムネイルが読める。一覧から別の版を選べる。審査待ちの数がメニューに出る', async ({ page }) => {
    clearQueue();
    await page.setViewportSize({ width: 1440, height: 900 });
    const owner = await person('creator');
    const reviewer = await operator();
    const made = await published(owner.visitor, reviewer.visitor, 'diff');
    const fixed = await postForm(owner.visitor, `/api/post/works/${made.id}/revisions`, formOf(made.id, { html: htmlOf(made.id, '<p>新しい中身</p>'), thumb: null }));
    const next = ((await fixed.json()) as { revision: { id: string } }).revision;
    await submit(owner.visitor, next.id);
    const other = await draft(owner.visitor, 'other');
    await submit(owner.visitor, other.revision.id);

    await logInOperatorPage(page, '/');
    await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
    const menu = page.getByRole('menuitem', { name: '審査（2）' });
    await expect(menu).toHaveAttribute('href', '/admin/review');
    await menu.click();
    await expect(page).toHaveURL('/admin/review');

    const item = page.locator(`[data-review-item="${next.id}"]`);
    await expect(item).toBeVisible();
    await item.getByText('コードの全文').click();
    await expect(item).toContainText('新しい中身');
    await expect(item).toContainText(`[data-ld-part="${made.id}"]`);
    await item.getByText('公開中の版（版 1）との差分').click();
    await expect(item.locator('pre span', { hasText: '新しい中身' })).toHaveText(/^\+ /);
    await expect(item.locator('pre span', { hasText: '押す' })).toHaveText(/^- /);
    await item.getByText('サムネイル', { exact: true }).click();
    await expect(item.locator('img')).toBeVisible();

    // 一覧から選ぶ
    await page.locator('[data-review-queue]').getByRole('button', { name: /投稿の見本 other-/ }).click();
    await expect(page.locator(`[data-review-item="${other.revision.id}"]`)).toBeVisible();
    expect(await runAxe(page)).toEqual([]);
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('見ている間に取り下げられた版は承認できず、知らせる。公開に出ない', async ({ page }) => {
    clearQueue();
    const owner = await person('creator');
    const made = await draft(owner.visitor, 'gone');
    await submit(owner.visitor, made.revision.id);
    await logInOperatorPage(page);
    await expect(page.locator(`[data-review-item="${made.revision.id}"]`)).toBeVisible();
    await owner.visitor.post(`/api/post/works/${made.id}/revoke`);
    await page.getByRole('button', { name: '承認', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('この版はもう審査できません');
    expect(await publicStatus(made.id, '1')).toEqual(HIDDEN);
  });

  test('悪意のある作品でも、審査の画面の親には届かない（cookie、DOM、top）。枠は外へ出られない', async ({ page }) => {
    clearQueue();
    const owner = await person('creator');
    // 検査をすり抜ける別名の書き方。審査で見る相手の形
    const js = `export function mount(root) {
  const w = root.ownerDocument.defaultView;
  const l = w.location;
  const p = w['par' + 'ent'];
  try { root.dataset.cookie = root.ownerDocument.cookie; } catch (error) { root.dataset.cookie = 'blocked'; }
  try { p.document.title = 'hacked'; } catch (error) { root.dataset.parent = 'blocked'; }
  setTimeout(() => { l.href = 'https://evil.example/collect'; }, 300);
  return () => {};
}`;
    const response = await postForm(owner.visitor, '/api/post/works', formOf(unique('mal-'), { js }));
    expect(response.status, await response.clone().text()).toBe(201);
    const { revision } = (await response.json()) as { revision: { id: string } };
    await submit(owner.visitor, revision.id);

    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await logInOperatorPage(page);
    await expect(page.locator(`[data-review-item="${revision.id}"]`)).toBeVisible();
    await expect(page.locator('[data-review-flags]')).toContainText('location');
    await page.waitForTimeout(1500);
    expect(await page.title()).toBe('審査 · Ludion');
    expect(requests.filter((url) => url.includes('evil.example'))).toEqual([]);
    await expect(page).toHaveURL('/admin/review');
  });

  test('スクリーンショット', async ({ page }) => {
    test.skip(!process.env.LD_SHOTS, 'LD_SHOTS のときだけ');
    const dir = join(REPO, 'docs/screens');
    clearQueue();
    const owner = await person('creator');
    const js = "export function mount(root) { root.dataset.href = location.href; return () => {}; }";
    const made = await draft(owner.visitor, 'shot', { js });
    await submit(owner.visitor, made.revision.id);
    for (const { width, height } of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize({ width, height });
      await page.context().clearCookies();
      await logInOperatorPage(page);
      await expect(page.frameLocator('iframe[data-ld-frame]').getByRole('button', { name: '押す' })).toBeVisible();
      await page.screenshot({ path: join(dir, `t021-review-${width}.png`) });
      await page.goto('/new');
      const id = unique('shot-');
      await page.getByLabel(LABELS.ja.box).fill(`<div data-ld-part="${id}" onclick="x()">…</div>
<style>${cssOf(id)}</style>`);
      await expect(page.locator('[data-post-check]')).toContainText('イベント属性');
      await page.screenshot({ path: join(dir, `t021-new-${width}.png`), fullPage: true });
      await page.goto('/account/works');
      await page.screenshot({ path: join(dir, `t021-works-${width}.png`) });
    }
  });
});
