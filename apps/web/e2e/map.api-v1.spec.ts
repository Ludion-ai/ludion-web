// まず地図、次に要る部分（WS006）。AI の口 /api/v1、MCP の道具、サイトの口（/p/<id>.json、/p/<id>/raw/<file>）。
// 手元の偽の GitHub と本物の workerd で通す。1つのテストごとに別の人でログインし、別の作品を作るので、互いの行に触らない。
// ファイルの名前に api-v1 を入れているのは、accounts のサーバー（playwright.config.ts の accounts）で流すため。

import { MAX_PART_READ_BYTES, buildOutline, numberLines } from '@ludion/outline';
import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { PAGE_CACHE_CONTROL } from '../worker/cachePolicy';
import { Visitor, ownOrigin } from './visitor';

const WEB = join(import.meta.dirname, '..');
const WRANGLER = join(WEB, '../../node_modules/wrangler/bin/wrangler.js');
const PERSIST = process.env.LD_TEST_ACCOUNTS_PERSIST_DIR!;
/** 開発のデータの、承認済みの作品。 */
const PUBLIC_WORK = 'seed-trail-guide';
const CONFIRM = { own: true, mit: true, terms: true };
const NO_STORE = 'private, no-store';
const REDIRECT = 'https://claude.example/api/mcp/auth_callback';

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

function r2(key: string): string | null {
  const result = spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'get', `ludion-parts/${key}`, '--local', '--persist-to', PERSIST, '--pipe'], { cwd: WEB, stdio: ['ignore', 'pipe', 'ignore'] });
  return result.status === 0 && result.stdout.length > 0 ? result.stdout.toString() : null;
}

async function person(label = 'map') {
  const visitor = new Visitor();
  const login = unique(label);
  expect((await visitor.login(login)).status).toBe(302);
  const { handle } = (await visitor.me()).user as { handle: string };
  const [{ user_id: id }] = d1<{ user_id: string }>(`SELECT user_id FROM identities WHERE provider = 'github' AND label = ${quote(login)}`);
  const made = await visitor.post('/api/account/ai-keys', { name: 'Claude Code', ...CONFIRM });
  expect(made.status, await made.clone().text()).toBe(201);
  const { secret: key } = (await made.json()) as { secret: string };
  return { visitor, login, handle, id, key };
}

/** AI につないだトークン（ldo_…）。AI の設定でつなぐのと同じ流れ：登録 → 許可 → トークン。 */
async function connect(visitor: Visitor): Promise<string> {
  const post = (path: string, body: string, type: string, headers: Record<string, string> = {}) => fetch(new URL(path, ownOrigin()), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': type, ...headers }, body });
  const registered = await post('/oauth/register', JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }), 'application/json');
  expect(registered.status).toBe(201);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const params = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st4te', scope: 'works', resource: `${ownOrigin()}/mcp` });
  const allowed = await visitor.fetch('/oauth/authorize', { method: 'POST', headers: { Origin: ownOrigin(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: `${params.toString()}&decision=allow` });
  expect(allowed.status).toBe(302);
  const code = new URL(allowed.headers.get('location')!).searchParams.get('code')!;
  const token = await post('/oauth/token', new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: `${ownOrigin()}/mcp` }).toString(), 'application/x-www-form-urlencoded');
  expect(token.status).toBe(200);
  return ((await token.json()) as { access_token: string }).access_token;
}

/** AI の口かサイトの口を呼ぶ。cookie は付けない。 */
function get(key: string | null, path: string, headers: Record<string, string> = {}) {
  return fetch(new URL(path, ownOrigin()), { redirect: 'manual', headers: { 'Accept-Language': 'en', ...(key === null ? {} : { Authorization: `Bearer ${key}` }), ...headers } });
}

/** 状態だけを見るときも、本文を最後まで読む（大きい本文を読まずに次の要求を出すと、手元の Node の fetch が閉じた接続で落ちる）。 */
async function statusOf(response: Response | Promise<Response>): Promise<number> {
  const got = await response;
  await got.arrayBuffer();
  return got.status;
}

async function put(key: string, html: string, workId?: string): Promise<{ id: string; version: string }> {
  const response = await fetch(new URL(workId ? `/api/v1/works/${workId}/versions` : '/api/v1/works', ownOrigin()), {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return (await response.json()) as { id: string; version: string };
}

type ToolResult = { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
let rpcId = 0;
async function call(token: string, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const response = await fetch(new URL('/mcp', ownOrigin()), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { result: ToolResult }).result;
}

const FILLER_LINES = 1200;
/**
 * 大きい文書の作品（約 51 KB）：シェーダー2本、同じ名前の関数2つ、上限（32 KB）を超える関数 big、WebGL2。
 * 1つの答えにコードを入れる大きさ（16 KB）も、1回に読める大きさ（32 KB）も超える。
 */
const bigDoc = (title: string, note = 'first') => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
body { margin: 0; background: #101418; }
canvas { display: block; width: 100vw; height: 100vh; }
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
// ---- shaders ----
const WINDOW_VERT = \`#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }\`;
const WINDOW_FRAG = \`#version 300 es
precision highp float;
out vec4 color; // ${note}
void main() { color = vec4(0.1, 0.2, 0.3, 1.0); }\`;

// ---- drawing ----
function step(t) {
  return t + 1;
}
function makeScene() {
  function step(t) {
    return t * 2;
  }
  return { step };
}
function big() {
  const rows = [];
${Array.from({ length: FILLER_LINES }, (_, i) => `  rows.push('row ${String(i).padStart(4, '0')} of the long table');`).join('\n')}
  return rows;
}
const gl = document.getElementById('c').getContext('webgl2');
requestAnimationFrame(function frame() {
  step(0);
});
</script>
</body>
</html>
`;

/** 小さい部品の形の作品（3つのファイルに分かれる）。 */
const smallPart = (part: string) => `<div data-ld-part="${part}"><button type="button">Tap</button></div>
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
`;

const latest = (workId: string) => d1<{ id: string; r2_prefix: string; version: string; content_hash: string }>(`SELECT id, r2_prefix, version, content_hash FROM revisions WHERE work_id = ${quote(workId)} ORDER BY created_at DESC, rowid DESC LIMIT 1`)[0];
const reads = (userId: string) => d1<{ n: number }>(`SELECT COALESCE(SUM(n), 0) AS n FROM quotas WHERE key = ${quote(`api-read:${userId}`)}`)[0].n;
const views = (workId: string) => d1<{ n: number }>(`SELECT COALESCE(SUM(views), 0) AS n FROM counters WHERE work_id = ${quote(workId)}`)[0].n;
const linesOf = (text: string, start: number, end: number) => text.split('\n').slice(start - 1, end).join('\n');

type Section = { kind: string; name: string; file: string; start: number; end: number };
type MapBody = { id: string; title: string; creator: string; own: boolean; visibility: string; status: string; version: string; url: string; bytes: number; max_read_bytes: number; outline: { files: { name: string; lines: number }[]; sections: Section[]; tech: { id: string }[] }; code?: string };
type PartBody = { id: string; version: string; file: string; section: string | null; start: number; end: number; total_lines: number; bytes: number; credit: string[]; code: string };

test.describe('AI の口：まず地図、次に要る部分', () => {
  test('地図が返る。行の範囲でも、分け目の名前でも、その部分だけが読める。上限を超えると断る', async () => {
    const owner = await person();
    const { id } = await put(owner.key, bigDoc('Big Window'));
    const stored = r2(`${latest(id).r2_prefix}/index.html`)!;
    const before = reads(owner.id);

    // 地図：置いた文書から作った地図と同じ。コードは入らない
    const mapResponse = await get(owner.key, `/api/v1/works/${id}/outline`);
    expect(mapResponse.status, await mapResponse.clone().text()).toBe(200);
    const map = (await mapResponse.json()) as MapBody;
    expect(map).toMatchObject({ id, title: 'Big Window', creator: owner.handle, own: true, visibility: 'private', status: 'private', version: '1', url: `${ownOrigin()}/en/p/${id}`, max_read_bytes: MAX_PART_READ_BYTES });
    expect(map.outline).toEqual(JSON.parse(JSON.stringify(buildOutline({ html: '', css: '', js: null, document: stored }))));
    expect(map.bytes).toBe(Buffer.byteLength(stored));
    expect(map.code).toBeUndefined();
    expect(map.outline.tech.map((tech) => tech.id)).toContain('webgl2');
    const shader = map.outline.sections.find((section) => section.kind === 'shader' && section.name === 'WINDOW_FRAG')!;
    const big = map.outline.sections.find((section) => section.kind === 'function' && section.name === 'big')!;
    expect(shader).toMatchObject({ file: 'index.html' });
    // 数え方：1回の読み取りで1だけ増える
    expect(reads(owner.id)).toBe(before + 1);

    // code=auto：大きい作品には入れない。code=1：今までの GET /works/:id と同じ文字
    expect(((await (await get(owner.key, `/api/v1/works/${id}/outline?code=auto`)).json()) as MapBody).code).toBeUndefined();
    const whole = ((await (await get(owner.key, `/api/v1/works/${id}`)).json()) as { code: string }).code;
    expect(whole.startsWith(`<!doctype html>\n<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->\n`)).toBe(true);
    expect(((await (await get(owner.key, `/api/v1/works/${id}/outline?code=1`)).json()) as MapBody).code).toBe(whole);

    // 分け目の名前：そのシェーダーの行だけ。行の番号は地図と同じ
    const bySection = await get(owner.key, `/api/v1/works/${id}/code?section=${encodeURIComponent('shader:WINDOW_FRAG')}`);
    expect(bySection.status, await bySection.clone().text()).toBe(200);
    const part = (await bySection.json()) as PartBody;
    expect(part).toMatchObject({ id, version: '1', file: 'index.html', section: 'shader:WINDOW_FRAG', start: shader.start, end: shader.end, total_lines: map.outline.files[0].lines, credit: [`UI by @${owner.handle} — ludion.ai/p/${id} (MIT)`] });
    expect(part.code).toBe(linesOf(stored, shader.start, shader.end));
    expect(part.code).toContain('WINDOW_FRAG');
    expect(part.code).not.toContain('WINDOW_VERT');
    expect(part.bytes).toBe(Buffer.byteLength(part.code));

    // 行の範囲
    const byLines = (await (await get(owner.key, `/api/v1/works/${id}/code?file=index.html&lines=14-21`)).json()) as PartBody;
    expect(byLines).toMatchObject({ file: 'index.html', section: null, start: 14, end: 21 });
    expect(byLines.code).toBe(linesOf(stored, 14, 21));
    // ファイルが1つなら file は省ける。終わりはファイルの終わりで止める
    const tail = (await (await get(owner.key, `/api/v1/works/${id}/code?lines=${map.outline.files[0].lines - 1}-999999`)).json()) as PartBody;
    expect(tail).toMatchObject({ start: map.outline.files[0].lines - 1, end: map.outline.files[0].lines });
    expect(tail.code).toBe('</body>\n</html>');

    // 上限を超えると断る（切って返さない）。中の分け目を返す
    for (const query of [`section=function:big`, `lines=1-${map.outline.files[0].lines}`, 'file=index.html']) {
      const refused = await get(owner.key, `/api/v1/works/${id}/code?${query}`);
      expect(refused.status, query).toBe(413);
      const body = (await refused.json()) as { error: string; message: string; bytes: number; limit: number; file: string; start: number; end: number; inside: { section: string; start: number; end: number }[]; code?: string };
      expect(body, query).toMatchObject({ error: 'part_too_large', limit: MAX_PART_READ_BYTES, file: 'index.html', message: expect.stringContaining('32KB') });
      expect(body.bytes).toBeGreaterThan(MAX_PART_READ_BYTES);
      expect(body.code).toBeUndefined();
      if (query.startsWith('section')) expect(body).toMatchObject({ start: big.start, end: big.end, inside: [] });
      else expect(body.inside.map((ref) => ref.section)).toEqual(['style:<style>', 'script:<script>']);
    }
    // 上限ちょうどまでは読める行の範囲（big の中の行だけ）
    const within = (await (await get(owner.key, `/api/v1/works/${id}/code?lines=${big.start + 2}-${big.start + 500}`)).json()) as PartBody;
    expect(within.bytes).toBeLessThanOrEqual(MAX_PART_READ_BYTES);
    expect(within.code.split('\n')).toHaveLength(499);

    // 同じ名前の分け目：選ばずに候補を返す。始まりの行を付ければ決まる
    const vague = await get(owner.key, `/api/v1/works/${id}/code?section=function:step`);
    expect(vague.status).toBe(400);
    const candidates = ((await vague.json()) as { error: string; candidates: { section: string; start: number; end: number }[] }).candidates;
    expect(candidates.map((ref) => ref.section)).toEqual(['function:step@24', 'function:step@28']);
    const pinned = (await (await get(owner.key, `/api/v1/works/${id}/code?section=${encodeURIComponent('function:step@28')}`)).json()) as PartBody;
    expect(pinned).toMatchObject({ section: 'function:step@28', start: 28, end: 30 });
    expect(pinned.code).toContain('return t * 2;');

    // だめな頼み方
    for (const [query, status, error] of [
      ['', 400, 'bad_part'],
      ['lines=abc', 400, 'bad_part'],
      ['lines=9-3', 400, 'bad_part'],
      ['section=shader:WINDOW_FRAG&lines=1-5', 400, 'bad_part'],
      ['lines=99999-100000', 400, 'out_of_range'],
      ['file=part.js&lines=1-5', 404, 'file_not_found'],
      ['file=meta.json', 404, 'file_not_found'],
      ['file=..%2Fmeta.json', 404, 'file_not_found'],
      ['section=shader:NO_SUCH', 404, 'section_not_found'],
    ] as const) {
      const response = await get(owner.key, `/api/v1/works/${id}/code?${query}`);
      expect(response.status, query).toBe(status);
      expect(await response.json(), query).toMatchObject({ error, message: expect.any(String) });
    }
    // 日本語の文
    expect(((await (await get(owner.key, `/api/v1/works/${id}/code?lines=abc`, { 'Accept-Language': 'ja' })).json()) as { message: string }).message).toContain('行の範囲');

    // 新しい版を置くと、地図も読む部分も新しい版。version を付けると、変わったことが分かる
    await put(owner.key, bigDoc('Big Window', 'second'), id);
    const next = (await (await get(owner.key, `/api/v1/works/${id}/code?section=shader:WINDOW_FRAG`)).json()) as PartBody;
    expect(next.version).toBe('2');
    expect(next.code).toContain('// second');
    const changed = await get(owner.key, `/api/v1/works/${id}/code?section=shader:WINDOW_FRAG&version=1`);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ error: 'version_changed', current_version: '2' });
    expect(await statusOf(get(owner.key, `/api/v1/works/${id}/code?section=shader:WINDOW_FRAG&version=2`))).toBe(200);
  });

  test('部品の形の作品：3つのファイル。今までの GET /works/:id は変わらない。地図のない版は、初めて読むときに作って置く', async () => {
    const owner = await person();
    const part = unique('tap-');
    const { id } = await put(owner.key, smallPart(part));
    const prefix = latest(id).r2_prefix;
    const css = r2(`${prefix}/part.css`)!;
    const js = r2(`${prefix}/part.js`)!;

    // 今までの呼び方：コピーされるコードの全部
    const whole = (await (await get(owner.key, `/api/v1/works/${id}`)).json()) as Record<string, unknown>;
    expect(Object.keys(whole).sort()).toEqual(['code', 'from', 'id', 'status', 'title', 'url', 'version', 'visibility']);
    expect(String(whole.code).split('\n')[0]).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->`);

    // 地図のない版（WS002 より前に置いた版と同じ）：読むときに作って置く
    const stored = r2(`${prefix}/outline.json`)!;
    const removed = spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'delete', `ludion-parts/${prefix}/outline.json`, '--local', '--persist-to', PERSIST], { cwd: WEB, stdio: 'ignore' });
    expect(removed.status).toBe(0);
    expect(r2(`${prefix}/outline.json`)).toBeNull();
    const map = (await (await get(owner.key, `/api/v1/works/${id}/outline?code=auto`)).json()) as MapBody;
    expect(map.outline).toEqual(JSON.parse(stored));
    expect(JSON.parse(r2(`${prefix}/outline.json`)!)).toEqual(JSON.parse(stored));
    expect(map.outline.files.map((file) => file.name)).toEqual(['part.html', 'part.css', 'part.js']);
    // 小さい作品は、code=auto でコードも入る
    expect(map.code).toBe(whole.code);

    // ファイルが2つ以上あるときは、行の範囲に file が要る
    const noFile = await get(owner.key, `/api/v1/works/${id}/code?lines=1-3`);
    expect(noFile.status).toBe(400);
    expect(await noFile.json()).toMatchObject({ error: 'file_required', files: ['part.html', 'part.css', 'part.js'] });
    // 置いてあるファイルの行そのまま（コピーされるコードとちがい、export を外さず、trim もしない）
    const mount = (await (await get(owner.key, `/api/v1/works/${id}/code?section=function:mount`)).json()) as PartBody;
    expect(mount.file).toBe('part.js');
    expect(mount.code).toBe(linesOf(js, mount.start, mount.end));
    const wholeCss = (await (await get(owner.key, `/api/v1/works/${id}/code?file=part.css`)).json()) as PartBody;
    expect(wholeCss.code).toBe(css.replace(/\n$/, ''));
    expect(wholeCss).toMatchObject({ start: 1, end: wholeCss.total_lines });
  });

  test('一覧：?with=tech で技術の印、?tech= で絞る。付けなければ今までと同じ形', async () => {
    // 手元の R2 を wrangler で何度も読み書きするので、長めに待つ
    test.setTimeout(120_000);
    const owner = await person();
    const webgl = await put(owner.key, bigDoc('Uses WebGL'));
    const plain = await put(owner.key, smallPart(unique('plain-')));
    type Listed = { works: ({ id: string; tech?: string[] | null } & Record<string, unknown>)[]; tech_unknown?: number };
    const list = async (query: string) => (await (await get(owner.key, `/api/v1/works${query}`)).json()) as Listed;

    const bare = await list('');
    expect(bare.works.map((work) => work.id).sort()).toEqual([plain.id, webgl.id].sort());
    for (const work of bare.works) expect(Object.keys(work).sort()).toEqual(['id', 'status', 'title', 'updated_at', 'url', 'version', 'visibility']);

    const marked = await list('?with=tech');
    expect(marked.works.find((work) => work.id === webgl.id)!.tech).toEqual(['webgl2', 'raf']);
    expect(marked.works.find((work) => work.id === plain.id)!.tech).toEqual(expect.arrayContaining(['dom-css', 'pointer']));
    expect(marked.tech_unknown).toBeUndefined();

    for (const query of ['webgl2', 'WebGL2', 'webgl', 'webgl2,raf']) expect((await list(`?tech=${encodeURIComponent(query)}`)).works.map((work) => work.id), query).toEqual([webgl.id]);
    expect((await list('?tech=pointer')).works.map((work) => work.id)).toEqual([plain.id]);
    expect((await list('?tech=webgl2,pointer')).works).toEqual([]);
    expect((await list('?tech=audio')).works).toEqual([]);
    const bad = await get(owner.key, '/api/v1/works?tech=flash');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: 'bad_tech', allowed: expect.arrayContaining(['webgl2', 'webaudio', 'canvas2d']) });

    // 地図のない版（WS002 より前に置いた版と同じ）が並んでいても、1回の一覧で全部に作って置く
    const old: { id: string }[] = [];
    for (let i = 0; i < 6; i++) old.push(await put(owner.key, i % 2 === 0 ? bigDoc(`Old ${i}`) : smallPart(unique('old-'))));
    const prefixes = new Map(d1<{ work_id: string; r2_prefix: string }>(`SELECT work_id, r2_prefix FROM revisions WHERE work_id IN (${[...old, plain].map((work) => quote(work.id)).join(', ')})`).map((row) => [row.work_id, row.r2_prefix]));
    const remove = (key: string) => expect(spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'delete', `ludion-parts/${key}`, '--local', '--persist-to', PERSIST], { cwd: WEB, stdio: 'ignore' }).status, key).toBe(0);
    for (const work of old) remove(`${prefixes.get(work.id)}/outline.json`);
    expect(r2(`${prefixes.get(old[0].id)}/outline.json`)).toBeNull();
    const rebuilt = await list('?with=tech');
    expect(rebuilt.works).toHaveLength(8);
    expect(rebuilt.tech_unknown).toBeUndefined();
    for (const [i, work] of old.entries()) expect(rebuilt.works.find((item) => item.id === work.id)!.tech, `Old ${i}`).toEqual(i % 2 === 0 ? ['webgl2', 'raf'] : expect.arrayContaining(['dom-css', 'pointer']));
    for (const work of [old[0], old[5]]) expect(r2(`${prefixes.get(work.id)}/outline.json`), work.id).not.toBeNull();
    expect((await list('?tech=webgl2')).works).toHaveLength(4);

    // ファイルが読めない版（壊れた置き場）：技術は分からない（null）。絞るときは結果に入れず、数を返す
    const broken = prefixes.get(plain.id)!;
    remove(`${broken}/outline.json`);
    remove(`${broken}/part.css`);
    const partial = await list('?with=tech');
    expect(partial.works).toHaveLength(8);
    expect(partial.works.find((work) => work.id === plain.id)!.tech).toBeNull();
    expect(partial.tech_unknown).toBe(1);
    const narrowed = await list('?tech=pointer');
    expect(narrowed.works.map((work) => work.id)).not.toContain(plain.id);
    expect(narrowed.works).toHaveLength(3);
    expect(narrowed.tech_unknown).toBe(1);
    // MCP の一覧も、分からなかった数を言う
    const viaTool = await call(owner.key, 'list_my_works', { tech: 'pointer' });
    expect(viaTool.content[0].text).toContain('3 work(s) that use pointer, newest first:');
    expect(viaTool.content[0].text).toContain('(1 work(s) could not be checked for tech and are left out.)');
    expect(viaTool.structuredContent).toMatchObject({ tech_unknown: 1 });
  });

  test('説明：GET /api/v1 と /llms.txt に「まず地図、次に要る部分」の読み方がある', async () => {
    const en = await (await get(null, '/api/v1')).text();
    for (const line of ['## Reading: the map first, then the part you need', 'GET /api/v1/works/:id/outline', 'GET /api/v1/works/:id/code', 'section=shader:WINDOW_FRAG', 'file=part.js&lines=200-760', '32KB', 'part_too_large', 'For a public work they need no key', '?tech=webgl2', '/p/<id>.json', '/p/<id>/raw/<file>']) expect(en, line).toContain(line);
    const ja = await (await get(null, '/api/v1', { 'Accept-Language': 'ja' })).text();
    for (const line of ['## 読み方：まず地図、次に要る部分', 'GET /api/v1/works/:id/outline', 'section=shader:WINDOW_FRAG', '32KB', '公開の作品は、鍵なしで読めます', '/p/<id>.json']) expect(ja, line).toContain(line);
    const llms = await (await get(null, '/llms.txt')).text();
    for (const line of ['read_work_code', '/p/<id>.json', '/p/<id>/raw/<file>', '/api/v1/works/<id>/code?section=shader:<name>']) expect(llms, line).toContain(line);
    const robots = await (await get(null, '/robots.txt')).text();
    expect(robots).toContain('Disallow: /p/*/raw/');
    expect(robots).toContain('Disallow: /p/*.json$');
  });
});

test.describe('だれが読めるか', () => {
  test('自分だけの作品：本人の鍵（AI の鍵、つないだトークン、セッション）でだけ読める。ほかの人には、ない作品と同じ 404', async () => {
    const owner = await person('mapowner');
    const stranger = await person('mapstranger');
    const reviewer = await person('mapreviewer');
    d1(`UPDATE users SET is_operator = 1 WHERE id = ${quote(reviewer.id)}`);
    const { id } = await put(owner.key, bigDoc('Only Mine'));
    const ownerToken = await connect(owner.visitor);
    const strangerToken = await connect(stranger.visitor);
    const paths = [
      (x: string) => `/api/v1/works/${x}/outline`,
      (x: string) => `/api/v1/works/${x}/outline?code=1`,
      (x: string) => `/api/v1/works/${x}/code?section=shader:WINDOW_FRAG`,
      (x: string) => `/api/v1/works/${x}/code?file=index.html&lines=1-5`,
      (x: string) => `/p/${x}.json`,
      (x: string) => `/p/${x}/raw/index.html`,
    ];

    // 本人：AI の鍵、つないだトークン
    for (const key of [owner.key, ownerToken]) {
      for (const path of paths) expect(await statusOf(get(key, path(id))), path(id)).toBe(200);
    }
    // 本人：セッションの cookie は、サイトの口だけ（AI の口は cookie を読まない）
    const mapByCookie = await owner.visitor.fetch(`/p/${id}.json`);
    expect(mapByCookie.status).toBe(200);
    expect(mapByCookie.headers.get('cache-control')).toBe(NO_STORE);
    expect(mapByCookie.headers.get('x-robots-tag')).toBe('noindex');
    expect(mapByCookie.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mapByCookie.headers.get('cache-tag')).toBeNull();
    expect(await mapByCookie.json()).toMatchObject({ id, title: 'Only Mine', creator: owner.handle, version: '1', raw: { 'index.html': expect.stringContaining(`/p/${id}/raw/index.html`) } });
    const rawByCookie = await owner.visitor.fetch(`/p/${id}/raw/index.html`);
    expect(rawByCookie.status).toBe(200);
    expect(rawByCookie.headers.get('cache-control')).toBe(NO_STORE);
    expect(rawByCookie.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(rawByCookie.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await rawByCookie.text()).split('\n')[1]).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->`);
    for (const path of paths.slice(0, 4)) expect(await statusOf(owner.visitor.fetch(path(id))), `cookie ${path(id)}`).toBe(404);

    // ほかの人：鍵なし、ほかの人の cookie・鍵・トークン、運営。ない作品と、状態も本文も同じ
    const actors: [string, (path: string) => Promise<Response>][] = [
      ['鍵なし', (path) => get(null, path)],
      ['ほかの人の cookie', (path) => stranger.visitor.fetch(path)],
      ['ほかの人の AI の鍵', (path) => get(stranger.key, path)],
      ['ほかの人のトークン', (path) => get(strangerToken, path)],
      ['運営の cookie', (path) => reviewer.visitor.fetch(path)],
      ['運営の AI の鍵', (path) => get(reviewer.key, path)],
    ];
    for (const [label, fetchAs] of actors) {
      for (const path of paths) {
        const missing = unique('missing-');
        const [got, none] = await Promise.all([fetchAs(path(id)), fetchAs(path(missing))]);
        expect(got.status, `${label} ${path(id)}`).toBe(404);
        expect(none.status, `${label} ${path(missing)}`).toBe(404);
        expect(got.headers.get('cache-control'), `${label} ${path(id)}`).toBe(NO_STORE);
        expect((await got.text()).replaceAll(id, 'X'), `${label} ${path(id)} の本文`).toBe((await none.text()).replaceAll(missing, 'X'));
      }
    }
    // 違う鍵：AI の口は今までどおり 401。サイトの口は、ない作品と同じ 404
    for (const path of paths) expect(await statusOf(get('ld_wrong', path(id))), path(id)).toBe(path(id).startsWith('/api/') ? 401 : 404);
    // 鍵なしで読めるのは、地図と要る部分の GET だけ。ほかの道は今までどおり 401
    for (const [path, method] of [['/api/v1/works', 'GET'], [`/api/v1/works/${id}`, 'GET'], [`/api/v1/works/${PUBLIC_WORK}`, 'GET'], [`/api/v1/works/${PUBLIC_WORK}/outline`, 'POST'], [`/api/v1/works/${PUBLIC_WORK}/versions`, 'POST']] as const) {
      expect(await statusOf(fetch(new URL(path, ownOrigin()), { method })), `${method} ${path}`).toBe(401);
    }
    // サイトの口を鍵で読むと、AI の口の読み取りとして数える
    const before = reads(owner.id);
    expect(await statusOf(get(owner.key, `/p/${id}.json`))).toBe(200);
    expect(reads(owner.id)).toBe(before + 1);
  });

  test('公開の作品：だれでも、鍵なしで読める。人によって変えず、閲覧数は増えない。生の文字の頭はクレジット行', async () => {
    const [work] = d1<{ version: string; handle: string; thumb_key: string }>(`SELECT w.version, c.handle, w.thumb_key FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ${quote(PUBLIC_WORK)}`);
    const prefix = work.thumb_key.replace(/\/thumb\.webp$/, '');
    const css = r2(`${prefix}/part.css`)!;
    const html = r2(`${prefix}/part.html`)!;
    const seen = views(PUBLIC_WORK);
    const someone = await person('mapreader');

    // AI の口：鍵なしでも、ほかの人の鍵でも、公開の版
    for (const key of [null, someone.key]) {
      const response = await get(key, `/api/v1/works/${PUBLIC_WORK}/outline`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe(NO_STORE);
      const map = (await response.json()) as MapBody;
      expect(map).toMatchObject({ id: PUBLIC_WORK, creator: work.handle, own: false, visibility: 'public', status: 'approved', version: work.version });
      expect(map.outline.files.map((file) => file.name)).toContain('part.css');
      const part = (await (await get(key, `/api/v1/works/${PUBLIC_WORK}/code?file=part.css&lines=1-3`)).json()) as PartBody;
      expect(part.code).toBe(linesOf(css, 1, 3));
      expect(part.credit).toEqual([`UI by @${work.handle} — ludion.ai/p/${PUBLIC_WORK} (MIT)`]);
    }

    // サイトの口：地図。キャッシュは作品のページと同じ
    const mapResponse = await get(null, `/p/${PUBLIC_WORK}.json`);
    expect(mapResponse.status).toBe(200);
    expect(mapResponse.headers.get('content-type')).toContain('application/json');
    expect(mapResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(mapResponse.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(mapResponse.headers.get('cache-tag')).toBe('catalog');
    const site = (await mapResponse.json()) as { outline: MapBody['outline']; raw: Record<string, string> } & Record<string, unknown>;
    expect(site).toMatchObject({ id: PUBLIC_WORK, creator: work.handle, version: work.version, license: 'MIT', credit: [`UI by @${work.handle} — ludion.ai/p/${PUBLIC_WORK} (MIT)`], url: `${ownOrigin()}/p/${PUBLIC_WORK}`, code_url: `${ownOrigin()}/p/${PUBLIC_WORK}/code` });
    expect(site.outline).toEqual(((await (await get(null, `/api/v1/works/${PUBLIC_WORK}/outline`)).json()) as MapBody).outline);
    expect(Object.keys(site.raw)).toEqual(site.outline.files.map((file) => file.name));
    // 作り方（made_with）は出さない（原則9）
    expect(JSON.stringify(site)).not.toContain('made_with');
    // 本人の cookie や鍵を付けても、同じ中身
    const withKey = await get(someone.key, `/p/${PUBLIC_WORK}.json`);
    expect(withKey.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(await withKey.json()).toEqual(site);

    // サイトの口：生の文字。頭にクレジット行、その後はファイルそのまま
    const rawCss = await get(null, `/p/${PUBLIC_WORK}/raw/part.css`);
    expect(rawCss.status).toBe(200);
    expect(rawCss.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(rawCss.headers.get('x-content-type-options')).toBe('nosniff');
    expect(rawCss.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
    expect(rawCss.headers.get('cache-tag')).toBe('catalog');
    expect(await rawCss.text()).toBe(`/* UI by @${work.handle} — ludion.ai/p/${PUBLIC_WORK} (MIT) */\n${css}`);
    expect(await (await get(null, `/p/${PUBLIC_WORK}/raw/part.html`)).text()).toBe(`<!-- UI by @${work.handle} — ludion.ai/p/${PUBLIC_WORK} (MIT) -->\n${html}`);
    // 版のファイルの名前だけ。ほかの名前は 404（文字で返す）
    for (const file of ['meta.json', 'outline.json', 'thumb.webp', 'index.html', '..%2Fmeta.json', 'part.css%2F..%2Fmeta.json']) {
      const response = await get(null, `/p/${PUBLIC_WORK}/raw/${file}`);
      expect(response.headers.get('content-type'), file).toBe('text/plain; charset=utf-8');
      expect(response.headers.get('cache-control'), file).toBe(NO_STORE);
      expect(await statusOf(response), file).toBe(404);
    }
    // ない作品の地図は JSON の 404。作品のページ（HTML）にはならない
    const none = await get(null, `/p/${unique('missing-')}.json`);
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: 'not_found' });
    // 作品のページは今までどおり
    const page = await get(null, `/p/${PUBLIC_WORK}`);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await statusOf(page)).toBe(200);

    // どれを読んでも、閲覧数は増えない
    expect(views(PUBLIC_WORK)).toBe(seen);
  });

  test('公開している自分の作品に新しい下書きの版：本人の鍵にはいちばん新しい版、ほかの人と鍵なしには公開の版', async () => {
    const owner = await person('mappub');
    const reviewer = await person('mapapprove');
    d1(`UPDATE users SET is_operator = 1 WHERE id = ${quote(reviewer.id)}`);
    const { id } = await put(owner.key, bigDoc('Public Window', 'public'));
    const first = latest(id);
    // 公開するにはサムネイルが要る。ここでは D1 で入れて、公開の流れだけを通す（api-v1.spec.ts と同じ）
    d1(`UPDATE revisions SET thumb_w = 800, thumb_h = 600 WHERE id = ${quote(first.id)}`);
    expect(await statusOf(owner.visitor.post(`/api/post/works/${id}/publish`, CONFIRM))).toBe(200);
    expect(await statusOf(reviewer.visitor.post(`/api/review/revisions/${first.id}/approve`, { content_hash: first.content_hash }))).toBe(200);
    await put(owner.key, bigDoc('Public Window', 'draft'), id);

    const shader = (key: string | null, query = '') => get(key, `/api/v1/works/${id}/code?section=shader:WINDOW_FRAG${query}`);
    const mine = (await (await shader(owner.key)).json()) as PartBody;
    expect(mine.version).toBe('2');
    expect(mine.code).toContain('// draft');
    for (const key of [null, reviewer.key]) {
      const theirs = (await (await shader(key)).json()) as PartBody;
      expect(theirs.version).toBe('1');
      expect(theirs.code).toContain('// public');
      // 下書きの版は、番号を言っても読めない
      expect(await statusOf(shader(key, '&version=2'))).toBe(409);
    }
    // 本人は、公開の版の番号を言えば、公開の版も読める（get_public_work の地図の続き）
    const pinned = (await (await shader(owner.key, '&version=1')).json()) as PartBody;
    expect(pinned.code).toContain('// public');
    // サイトの口は、本人にも公開の版（人によって変えない）
    for (const read of [() => owner.visitor.fetch(`/p/${id}/raw/index.html`), () => get(owner.key, `/p/${id}/raw/index.html`), () => get(null, `/p/${id}/raw/index.html`)]) {
      const response = await read();
      expect(response.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL);
      const text = await response.text();
      expect(text).toContain('// public');
      expect(text.split('\n').slice(0, 2)).toEqual(['<!doctype html>', `<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->`]);
    }
    expect(((await (await get(owner.key, `/p/${id}.json`)).json()) as { version: string }).version).toBe('1');
  });
});

test.describe('MCP の道具', () => {
  test('get_work は地図を返す（大きい作品はコードなし、code: true で全部）。read_work_code で行の範囲と分け目の名前の両方が読める。上限を超えると断る', async () => {
    const owner = await person('mcpmap');
    const stranger = await person('mcpmapother');
    const { id } = await put(owner.key, bigDoc('Rain Sketch'));
    const stored = r2(`${latest(id).r2_prefix}/index.html`)!;
    const small = await put(owner.key, smallPart(unique('mini-')));

    // 道具の一覧と説明：まず地図、次に要る部分
    const listed = await fetch(new URL('/mcp', ownOrigin()), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.key}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const tools = ((await listed.json()) as { result: { tools: { name: string; description: string; inputSchema: { properties: Record<string, unknown>; required?: string[] } }[] } }).result.tools;
    expect(tools.map((tool) => tool.name)).toEqual(['save_work', 'list_my_works', 'get_work', 'get_public_work', 'read_work_code']);
    const tool = (name: string) => tools.find((item) => item.name === name)!;
    for (const name of ['get_work', 'get_public_work']) {
      expect(tool(name).description, name).toContain('Read the map first, then only the part you need');
      expect(tool(name).inputSchema.required, name).toEqual(['work_id']);
      expect(Object.keys(tool(name).inputSchema.properties), name).toEqual(['work_id', 'code', 'language']);
    }
    expect(tool('read_work_code').description).toContain('shader:WINDOW_FRAG');
    expect(tool('read_work_code').description).toContain('Up to 32 KB per call');
    expect(tool('read_work_code').inputSchema.required).toEqual(['work_id']);
    expect(Object.keys(tool('list_my_works').inputSchema.properties)).toEqual(['tech', 'language']);

    // 大きい作品：地図だけ。コードは入らない
    const map = await call(owner.key, 'get_work', { work_id: id });
    expect(map.isError).toBeUndefined();
    expect(map.content).toHaveLength(1);
    const text = map.content[0].text;
    expect(text).toContain(`Rain Sketch — work_id: ${id}, version 1, Only me, ${ownOrigin()}/en/p/${id}`);
    expect(text).toContain('not its code');
    expect(text).toContain(`read_work_code with work_id "${id}", version "1" and either section`);
    expect(text).toContain('- index.html — 1243 lines');
    expect(text).toContain('Tech (first line found): WebGL2 (index.html:1237)');
    expect(text).toContain('shader:WINDOW_FRAG — 18-21 — ');
    expect(text).toContain('function:step@24 — 24-26');
    expect(text).toContain('function:big — 33-1236 — ');
    expect(text).not.toContain('row 0001 of the long table');
    expect(map.structuredContent).toMatchObject({ id, title: 'Rain Sketch', own: true, visibility: 'private', version: '1', tech: ['webgl2', 'raf'], files: [{ name: 'index.html', lines: 1243 }] });
    expect(map.structuredContent!.map).toBe(text.slice(text.indexOf('Files:')));
    expect(map.structuredContent!.code).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(map))).toBeLessThan(6 * 1024);

    // code: true：今までと同じ場所に、コードの全部
    const whole = await call(owner.key, 'get_work', { work_id: id, code: true });
    expect(whole.content).toHaveLength(2);
    expect(whole.content[1].text.startsWith(`<!doctype html>\n<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->\n`)).toBe(true);
    expect(whole.content[1].text).toContain('row 1199 of the long table');
    expect(whole.structuredContent!.code).toBe(whole.content[1].text);
    expect((await call(owner.key, 'get_work', { work_id: id, code: 'yes' })).isError).toBe(true);

    // 小さい作品：地図と一緒に、今までどおりコードも返る。code: false なら地図だけ
    const mini = await call(owner.key, 'get_work', { work_id: small.id });
    expect(mini.content).toHaveLength(2);
    expect(mini.content[0].text).toContain('Below: the map of the work, then its whole code.');
    expect(mini.content[0].text).toContain('function:mount — ');
    expect(mini.content[1].text.split('\n')[0]).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${small.id} (MIT) -->`);
    expect(mini.structuredContent!.code).toBe(mini.content[1].text);
    const miniMap = await call(owner.key, 'get_work', { work_id: small.id, code: false });
    expect(miniMap.content).toHaveLength(1);
    expect(miniMap.structuredContent!.code).toBeUndefined();

    // 分け目の名前で読む：1行目はクレジット行、その後は行の番号つき
    const shader = await call(owner.key, 'read_work_code', { work_id: id, section: 'shader:WINDOW_FRAG' });
    expect(shader.isError).toBeUndefined();
    expect(shader.content[0].text).toContain(`index.html lines 18-21 of 1243`);
    expect(shader.content[0].text).toContain(`section shader:WINDOW_FRAG — work_id: ${id}, version 1`);
    expect(shader.content[1].text).toBe(`<!-- UI by @${owner.handle} — ludion.ai/p/${id} (MIT) -->\n${numberLines(linesOf(stored, 18, 21), 18)}`);
    expect(shader.content[1].text.split('\n')[1]).toBe('18\tconst WINDOW_FRAG = `#version 300 es');
    expect(shader.structuredContent).toMatchObject({ work_id: id, version: '1', file: 'index.html', section: 'shader:WINDOW_FRAG', start: 18, end: 21, total_lines: 1243, code: shader.content[1].text });
    // 行の範囲で読む
    const range = await call(owner.key, 'read_work_code', { work_id: id, file: 'index.html', lines: '23-32' });
    expect(range.content[1].text.split('\n').slice(1)).toEqual(numberLines(linesOf(stored, 23, 32), 23).split('\n'));
    expect(range.structuredContent).toMatchObject({ start: 23, end: 32, section: null });

    // 上限を超えると断る。狭め方を返す
    const tooBig = await call(owner.key, 'read_work_code', { work_id: id, section: 'function:big' });
    expect(tooBig.isError).toBe(true);
    expect(tooBig.content).toHaveLength(1);
    expect(tooBig.content[0].text).toContain('413 part_too_large');
    expect(tooBig.content[0].text).toContain('lines 33-1236 of index.html');
    expect(tooBig.content[0].text).not.toContain('row 0001 of the long table');
    expect(tooBig.structuredContent).toMatchObject({ error: 'part_too_large', status: 413, limit: MAX_PART_READ_BYTES, start: 33, end: 1236 });
    const wholeFile = await call(owner.key, 'read_work_code', { work_id: id, file: 'index.html' });
    expect(wholeFile.isError).toBe(true);
    expect(wholeFile.content[0].text).toContain('- script:<script> — index.html 13-1241');
    // 同じ名前：候補を返す
    const vague = await call(owner.key, 'read_work_code', { work_id: id, section: 'function:step' });
    expect(vague.isError).toBe(true);
    expect(vague.content[0].text).toContain('- function:step@24 — index.html 24-26');
    expect(vague.content[0].text).toContain('- function:step@28 — index.html 28-30');
    // 何を読むかがない、形が違う
    for (const args of [{ work_id: id }, { work_id: id, lines: 5 }, { section: 'shader:WINDOW_FRAG' }, { work_id: id, section: 'shader:WINDOW_FRAG', lines: '1-2' }]) expect((await call(owner.key, 'read_work_code', args)).isError, JSON.stringify(args)).toBe(true);
    // 版が変わった後に、前の版の番号で読むと断る
    expect((await call(owner.key, 'read_work_code', { work_id: id, section: 'shader:WINDOW_FRAG', version: '1' })).isError).toBeUndefined();
    const stale = await call(owner.key, 'read_work_code', { work_id: id, section: 'shader:WINDOW_FRAG', version: '7' });
    expect(stale.isError).toBe(true);
    expect(stale.content[0].text).toContain('The version now is 1.');

    // ほかの人：自分だけの作品は、どの道具でも、ない作品と同じ
    for (const [name, args] of [['get_work', { work_id: id }], ['get_work', { work_id: id, code: true }], ['get_public_work', { work_id: id }], ['read_work_code', { work_id: id, section: 'shader:WINDOW_FRAG' }], ['read_work_code', { work_id: id, file: 'index.html', lines: '1-5' }]] as const) {
      const theirs = await call(stranger.key, name, args);
      expect(theirs.isError, name).toBe(true);
      expect(JSON.stringify(theirs), name).not.toContain('WINDOW_FRAG = ');
      expect(JSON.stringify(theirs), name).not.toContain('Rain Sketch');
      expect(theirs.structuredContent, name).toMatchObject({ error: 'not_found' });
    }
    // 本人でも、公開していない作品は get_public_work では読めない
    expect((await call(owner.key, 'get_public_work', { work_id: id })).isError).toBe(true);
  });

  test('公開の作品：get_public_work は地図（小さければコードも）。read_work_code で一部。get_work では読めない。list_my_works は技術の印と絞り', async () => {
    const owner = await person('mcppub');
    const [work] = d1<{ handle: string; version: string; thumb_key: string }>(`SELECT c.handle, w.version, w.thumb_key FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ${quote(PUBLIC_WORK)}`);
    const css = r2(`${work.thumb_key.replace(/\/thumb\.webp$/, '')}/part.css`)!;
    const seen = views(PUBLIC_WORK);

    const pub = await call(owner.key, 'get_public_work', { work_id: PUBLIC_WORK });
    expect(pub.isError).toBeUndefined();
    expect(pub.content[0].text).toContain(`by @${work.handle} — work_id: ${PUBLIC_WORK}, version ${work.version}, ${ownOrigin()}/en/p/${PUBLIC_WORK} (MIT)`);
    expect(pub.content[0].text).toContain('- part.css — ');
    expect(pub.content[0].text).toContain(`call save_work with from "${PUBLIC_WORK}"`);
    expect(pub.content[1].text).toMatch(/^<!-- UI by @/);
    expect(pub.structuredContent).toMatchObject({ work_id: PUBLIC_WORK, creator: work.handle, url: `${ownOrigin()}/en/p/${PUBLIC_WORK}`, version: work.version, code: pub.content[1].text });
    const mapOnly = await call(owner.key, 'get_public_work', { work_id: PUBLIC_WORK, code: false, language: 'ja' });
    expect(mapOnly.content).toHaveLength(1);
    expect(mapOnly.content[0].text).toContain(`${ownOrigin()}/p/${PUBLIC_WORK} (MIT)`);

    const part = await call(owner.key, 'read_work_code', { work_id: PUBLIC_WORK, file: 'part.css', lines: '1-4' });
    expect(part.isError).toBeUndefined();
    expect(part.content[1].text).toBe(`/* UI by @${work.handle} — ludion.ai/p/${PUBLIC_WORK} (MIT) */\n${numberLines(linesOf(css, 1, 4), 1)}`);
    // get_work は自分の作品だけ（今までどおり）
    const notMine = await call(owner.key, 'get_work', { work_id: PUBLIC_WORK });
    expect(notMine.isError).toBe(true);
    expect(notMine.structuredContent).toMatchObject({ error: 'not_found', status: 404 });
    expect(notMine.content[0].text).toContain('get_public_work');
    expect(views(PUBLIC_WORK)).toBe(seen);

    // 一覧：技術の印。技術で絞る
    const webgl = await put(owner.key, bigDoc('Glass Demo'));
    const plain = await put(owner.key, smallPart(unique('plainmcp-')));
    const all = await call(owner.key, 'list_my_works', {});
    expect(all.content[0].text).toContain('2 work(s), newest first:');
    expect(all.content[0].text).toMatch(new RegExp(`- Glass Demo — work_id: ${webgl.id}, Only me, version 1, updated \\d{4}-\\d{2}-\\d{2}, \\S+, tech: WebGL2\\n`));
    expect(all.content[0].text).toMatch(new RegExp(`work_id: ${plain.id}, Only me, version 1, .*, tech: DOM \\+ CSS\\n`));
    expect((all.structuredContent!.works as { id: string; tech: string[] }[]).find((item) => item.id === webgl.id)!.tech).toEqual(['webgl2', 'raf']);
    const filtered = await call(owner.key, 'list_my_works', { tech: 'WebGL' });
    expect(filtered.content[0].text).toContain('1 work(s) that use WebGL, newest first:');
    expect((filtered.structuredContent!.works as { id: string }[]).map((item) => item.id)).toEqual([webgl.id]);
    const none = await call(owner.key, 'list_my_works', { tech: 'audio' });
    expect(none.isError).toBeUndefined();
    expect(none.content[0].text).toContain("None of the person's works use audio.");
    const bad = await call(owner.key, 'list_my_works', { tech: 'flash' });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('Tech names: webgl2, webgl,');
  });
});
