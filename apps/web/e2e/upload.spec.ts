// T004・T005：Worker、D1・R2、管理API と ld upload、送った作品がホームに出ること（docs/tasks/T004.md、T005.md の終わりの条件）。
// このテストのサーバーは、毎回空の D1 と R2（LD_TEST_PERSIST_DIR）で動く（scripts/test-server.mjs）。
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { copy } from '../src/copy';
import type { Work } from '../src/data/works';
import { comparePopular } from '../src/lib/popular';

const REPO = join(import.meta.dirname, '../../..');
const WEB = join(REPO, 'apps/web');
const LD_BIN = join(REPO, 'packages/ld/bin/ld.mjs');
const TOKEN = process.env.LD_TEST_ADMIN_TOKEN!;
const PERSIST = process.env.LD_TEST_PERSIST_DIR!;
const GOOD = ['fx-toggle', 'fx-button', 'fx-landing', 'fx-habits'];
/** 枠の中から読むときの見出し。ブラウザの iframe はこれを付ける。 */
const FROM_IFRAME = { 'Sec-Fetch-Dest': 'iframe' };
/** wrangler は node で直に動かす（Windows で shell を通すと、空白を含む引数が割れるため）。 */
const WRANGLER = join(REPO, 'node_modules/wrangler/bin/wrangler.js');

test.describe.configure({ mode: 'serial' });

/** テストの D1 に SQL を投げる（wrangler の手元の D1。サーバーと同じ場所）。 */
function d1<T = Record<string, unknown>>(sql: string): T[] {
  const out = execFileSync(process.execPath, [WRANGLER, 'd1', 'execute', 'ludion-app', '--local', '--persist-to', PERSIST, '--json', '--command', sql], {
    cwd: WEB,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return (JSON.parse(out) as { results: T[] }[])[0].results;
}

/** テストの R2 から1つ読む。なければ null。 */
function r2(key: string): Buffer | null {
  const result = spawnSync(process.execPath, [WRANGLER, 'r2', 'object', 'get', `ludion-parts/${key}`, '--local', '--persist-to', PERSIST, '--pipe'], {
    cwd: WEB,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 && result.stdout.length > 0 ? result.stdout : null;
}

function ld(args: string[], root?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, LD_DEV_URL: test.info().project.use.baseURL!, LD_DEV_TOKEN: TOKEN };
  if (root) env.LD_ROOT = root;
  else delete env.LD_ROOT;
  const result = spawnSync(process.execPath, [LD_BIN, ...args], { env, encoding: 'utf8', timeout: 180_000 });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

/** 使い捨ての ld の置き場。見本の作者 @fixture と、指定した見本を写す。 */
function tempRoot(works: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'ld-upload-'));
  cpSync(join(REPO, 'fixtures/creators/fixture'), join(root, 'creators/fixture'), { recursive: true });
  for (const id of works) cpSync(join(REPO, 'fixtures/works', id), join(root, 'works', id), { recursive: true });
  writeFileSync(join(root, 'ld.config.json'), JSON.stringify({ creator: 'fixture', made_with: 'ai-assisted' }));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function editJson(path: string, change: (value: Record<string, unknown>) => Record<string, unknown>) {
  writeFileSync(path, JSON.stringify(change(JSON.parse(readFileSync(path, 'utf8'))), null, 2));
}

/** 見本の作品を、ld を通さずに multipart で直に送る（Worker の検査を確かめるため）。 */
async function postWork(request: APIRequestContext, dir: string, creatorDir: string, extra: Record<string, string> = {}) {
  const multipart: Record<string, { name: string; mimeType: string; buffer: Buffer } | string> = { ...extra };
  for (const name of readdirSync(dir)) multipart[name] = { name, mimeType: 'application/octet-stream', buffer: readFileSync(join(dir, name)) };
  for (const name of ['creator.json', 'avatar.webp']) multipart[name] = { name, mimeType: 'application/octet-stream', buffer: readFileSync(join(creatorDir, name)) };
  return request.post('/api/admin/works', { headers: { Authorization: `Bearer ${TOKEN}` }, multipart });
}

test('キャッシュを許した一覧（e2e/cache.spec.ts）のほかの応答に Cache-Control: private, no-store が付く（API、エラー、知らない道）', async ({ request }) => {
  const checks: [string, Promise<{ status(): number; headers(): Record<string, string> }>, number][] = [
    ['GET /api/works', request.get('/api/works'), 200],
    ['GET ないサムネイル', request.get('/w/nothing-here/1/thumb.webp'), 404],
    ['GET ないアバター', request.get('/files/creators/nothing/avatar-000000000000.webp'), 404],
    ['GET /files のほかの形', request.get('/files/works/nothing/1/part.js'), 404],
    ['GET /p/abc（ない作品）', request.get('/p/abc'), 404],
    ['GET /c/abc（ない作者）', request.get('/c/abc'), 404],
    ['GET /frame（ない作品）', request.get('/frame/abc/1/desktop.html', { headers: FROM_IFRAME }), 404],
    ['GET /frame（枠の外から）', request.get('/frame/abc/1/desktop.html', { maxRedirects: 0 }), 302],
    ['GET ない OG 画像', request.get('/w/abc/1/og.png'), 404],
    ['POST /api/count（Origin なし）', request.post('/api/count', { data: { work_id: 'abc', type: 'view' } }), 403],
    ['GET /api/nope', request.get('/api/nope'), 404],
    ['POST /api/admin/works（トークンなし）', request.post('/api/admin/works'), 401],
    ['POST unpublish（ない作品）', request.post('/api/admin/works/nothing-here/unpublish', { headers: { Authorization: `Bearer ${TOKEN}` } }), 404],
  ];
  for (const [label, pending, status] of checks) {
    const response = await pending;
    expect(response.status(), label).toBe(status);
    expect(response.headers()['cache-control'], label).toBe('private, no-store');
  }
});

test('管理トークンがない、または違えば 401。外の Origin は 403', async ({ request }) => {
  const none = await request.post('/api/admin/works', { multipart: { publish: 'true' } });
  expect(none.status()).toBe(401);
  expect((await none.json()).error).toBe('unauthorized');
  expect((await request.post('/api/admin/works', { headers: { Authorization: 'Bearer wrong' }, multipart: { publish: 'true' } })).status()).toBe(401);
  expect((await request.post('/api/admin/works/fx-toggle/unpublish')).status()).toBe(401);
  const foreign = await request.post('/api/admin/works', { headers: { Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' } });
  expect(foreign.status()).toBe(403);
  expect(d1('SELECT COUNT(*) AS n FROM works')[0].n).toBe(0);
});

test('良い見本4つを ld upload --publish --env dev で送ると、D1 と R2 に入る', () => {
  const sent = ld(['upload', ...GOOD, '--publish', '--env', 'dev']);
  expect(sent.code, sent.out).toBe(0);
  expect(sent.out).toContain('4/4 を送った');

  const rows = d1<{ id: string; version: string; status: string; thumb_key: string; thumb_w: number; thumb_h: number; made_with: string; handle: string; kind: string; published_at: number }>(
    'SELECT w.id, w.version, w.status, w.thumb_key, w.thumb_w, w.thumb_h, w.made_with, w.published_at, c.handle, c.kind FROM works w JOIN creators c ON c.id = w.creator_id ORDER BY w.id',
  );
  expect(rows.map((r) => r.id)).toEqual([...GOOD].sort());
  for (const row of rows) {
    const meta = JSON.parse(readFileSync(join(REPO, 'fixtures/works', row.id, 'meta.json'), 'utf8'));
    expect(row).toMatchObject({ version: '1', status: 'approved', thumb_w: 800, made_with: meta.made_with, handle: 'fixture', kind: 'person' });
    expect(row.thumb_key).toBe(`works/${row.id}/1/thumb.webp`);
    expect(row.published_at).toBe(Date.parse('2026-11-08T00:00:00Z'));
  }
  expect(rows.find((r) => r.id === 'fx-habits')!.thumb_h).toBe(1000);

  for (const id of GOOD) {
    for (const name of ['meta.json', 'part.html', 'part.css', 'thumb.webp', 'og.png']) {
      expect(r2(`works/${id}/1/${name}`)?.equals(readFileSync(join(REPO, 'fixtures/works', id, name))), `${id}/${name}`).toBe(true);
    }
  }
  expect(r2('works/fx-toggle/1/part.js')?.equals(readFileSync(join(REPO, 'fixtures/works/fx-toggle/part.js')))).toBe(true);
  expect(d1('SELECT COUNT(*) AS n FROM creators')[0].n).toBe(1);
  expect(d1<{ is_remix: number }>('SELECT is_remix FROM works').every((row) => row.is_remix === 0)).toBe(true);
});

test('コードに Remixed by があれば is_remix が 1 で、一覧の remix が true。帯の印が HTML に出る', async ({ request }) => {
  const { root, cleanup } = tempRoot(['fx-habits']);
  try {
    const htmlPath = join(root, 'works/fx-habits/part.html');
    writeFileSync(htmlPath, `<!-- Remixed by Claude -->\n${readFileSync(htmlPath, 'utf8')}`);
    editJson(join(root, 'works/fx-habits/meta.json'), (meta) => ({ ...meta, version: '2' }));
    const response = await postWork(request, join(root, 'works/fx-habits'), join(root, 'creators/fixture'), { publish: 'true' });
    expect(response.status(), await response.text()).toBe(201);
  } finally {
    cleanup();
  }
  expect(d1<{ is_remix: number }>("SELECT is_remix FROM works WHERE id = 'fx-habits'")[0].is_remix).toBe(1);
  expect(d1<{ is_remix: number }>("SELECT is_remix FROM revisions WHERE work_id = 'fx-habits' AND version = '2'")[0].is_remix).toBe(1);
  const { works } = (await (await request.get('/api/works')).json()) as { works: Work[] };
  expect(works.find((work) => work.id === 'fx-habits')!.remix).toBe(true);
  expect(works.find((work) => work.id === 'fx-toggle')!.remix).toBe(false);
  const html = await (await request.get('/?sort=new')).text();
  expect(html.match(/class="remix-ribbon"/g)?.length).toBe(2);
});

test('同じ版をもう一度送ると 409。version を上げて送ると、新しい版に差し替わる', () => {
  const again = ld(['upload', 'fx-button', '--publish', '--env', 'dev']);
  expect(again.code).toBe(1);
  expect(again.out).toContain('✗ fx-button：409。fx-button の版 1 はもうある');

  const { root, cleanup } = tempRoot(['fx-button']);
  try {
    editJson(join(root, 'works/fx-button/meta.json'), (meta) => ({ ...meta, version: '2', title: 'Ember Buttons v2' }));
    const bumped = ld(['upload', 'fx-button', '--publish', '--env', 'dev'], root);
    expect(bumped.code, bumped.out).toBe(0);
    expect(bumped.out).toContain('送った：fx-button 版 2（approved、版 1 を差し替えた）');
  } finally {
    cleanup();
  }
  const [row] = d1<{ version: string; title: string; status: string; thumb_key: string }>("SELECT version, title, status, thumb_key FROM works WHERE id = 'fx-button'");
  expect(row).toEqual({ version: '2', title: 'Ember Buttons v2', status: 'approved', thumb_key: 'works/fx-button/2/thumb.webp' });
  expect(JSON.parse(r2('works/fx-button/2/meta.json')!.toString()).title).toBe('Ember Buttons v2');
  expect(r2('works/fx-button/1/meta.json')).not.toBeNull(); // 前の版のファイルは残す
  expect(d1('SELECT COUNT(*) AS n FROM works')[0].n).toBe(4);

  // 今の版より古い版も置かない
  const older = ld(['upload', 'fx-button', '--env', 'dev']);
  expect(older.out).toContain('409。fx-button の今の版は 2。それより古い版 1 は置かない');
});

test('ld creator add --label の作者の作品を送ると、D1 の creators の kind が label になる（--publish なしは draft）', () => {
  const { root, cleanup } = tempRoot(['fx-nav']);
  try {
    const label = ld(['creator', 'add', 'studio_kiln', '--name', 'Studio Kiln', '--label'], root);
    expect(label.code, label.out).toBe(0);
    editJson(join(root, 'works/fx-nav/meta.json'), (meta) => ({ ...meta, creator: 'studio_kiln' }));
    const sent = ld(['upload', 'fx-nav', '--env', 'dev'], root);
    expect(sent.code, sent.out).toBe(0);
    expect(sent.out).toContain('送った：fx-nav 版 1（draft）。作者 @studio_kiln（label）');
  } finally {
    cleanup();
  }
  const [row] = d1<{ status: string; handle: string; name: string; kind: string; avatar_url: string; published_at: number | null }>(
    "SELECT w.status, w.published_at, c.handle, c.name, c.kind, c.avatar_url FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = 'fx-nav'",
  );
  expect(row).toMatchObject({ status: 'draft', published_at: null, handle: 'studio_kiln', name: 'Studio Kiln', kind: 'label' });
  expect(r2(row.avatar_url)).not.toBeNull();
  expect(d1("SELECT kind FROM creators WHERE handle = 'fixture'")).toEqual([{ kind: 'person' }]);
});

test('トークンの純度で落ちる見本 fx-bad-color は 422 で、落ちた項目と理由が返る。作者の kind がなくても 422', async ({ request }) => {
  const work = mkdtempSync(join(tmpdir(), 'ld-bad-'));
  const creator = mkdtempSync(join(tmpdir(), 'ld-creator-'));
  try {
    cpSync(join(REPO, 'fixtures/works/fx-bad-color'), work, { recursive: true });
    // 画像は描画が要るので ld が作る。ここでは良い見本の画像を借りる（Worker は形だけを見る）
    for (const name of ['thumb.webp', 'og.png']) cpSync(join(REPO, 'fixtures/works/fx-button', name), join(work, name));
    cpSync(join(REPO, 'fixtures/creators/fixture'), creator, { recursive: true });

    const bad = await postWork(request, work, creator, { publish: 'true' });
    expect(bad.status()).toBe(422);
    const body = await bad.json();
    expect(body.failed.map((f: { label: string }) => f.label)).toEqual(['トークンの純度']);
    expect(body.failed[0].problems[0].message).toMatch(/^part\.css \d+行目 border の色 #e11d48$/);
    expect(body.failed[0].problems[0].fix).toContain('var(--_accent)');

    // 良い見本 fx-button を、kind のない作者で送る（純度は通り、形だけで落ちる）
    editJson(join(creator, 'creator.json'), ({ kind: _, ...rest }) => rest);
    const noKind = await postWork(request, join(REPO, 'fixtures/works/fx-button'), creator);
    expect(noKind.status()).toBe(422);
    const noKindBody = await noKind.json();
    expect(noKindBody.failed.map((f: { label: string }) => f.label)).toEqual(['形']);
    expect(noKindBody.failed[0].problems.map((p: { message: string }) => p.message)).toEqual(['creator.json に "kind" がない']);
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(creator, { recursive: true, force: true });
  }
  expect(d1("SELECT COUNT(*) AS n FROM works WHERE id = 'fx-bad-color'")[0].n).toBe(0);
});

test('取り下げると rejected になる', async ({ request }) => {
  const response = await request.post('/api/admin/works/fx-landing/unpublish', {
    headers: { Authorization: `Bearer ${TOKEN}` },
    data: { reason: 'テストで取り下げる' },
  });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ id: 'fx-landing', status: 'rejected', reject_reason: 'テストで取り下げる', catalog_purged: true });
  expect(d1("SELECT status, reject_reason FROM works WHERE id = 'fx-landing'")).toEqual([{ status: 'rejected', reject_reason: 'テストで取り下げる' }]);
  expect(d1("SELECT id FROM works WHERE status = 'approved' ORDER BY id").map((r) => r.id)).toEqual(['fx-button', 'fx-habits', 'fx-toggle']);
});

// ---------------------------------------------------------------- T005：送った作品がホームに出る

const LONG_CACHE = 'public, max-age=31536000, immutable';
const THUMB_CACHE = 'public, max-age=3600, s-maxage=31536000';

test('送った作品がホームに出て、サムネイルとアバターは R2 から長期キャッシュで返る（部品のサムネイルがカードの中で見える。アバターは作り手のページ）', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
  // fx-landing は取り下げた。fx-nav は draft。fx-button は版 2 に上がっている
  await expect(page.locator('article h2')).toHaveText([/.+/, /.+/, /.+/]);
  const hrefs = await page.locator('article > a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs.toSorted()).toEqual(['/p/fx-button', '/p/fx-habits', '/p/fx-toggle']);

  const button = page.locator('article', { has: page.locator('a[href="/p/fx-button"]') });
  const thumb = button.locator('> a > img');
  await expect(thumb).toHaveAttribute('src', '/w/fx-button/2/thumb.webp');
  await expect.poll(() => thumb.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(800);
  // カードの中で見えている：サムネイルが地の色だけではない（部品の色がある）
  const distinct = await thumb.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) colors.add((data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4));
    return colors.size;
  });
  expect(distinct).toBeGreaterThan(3);

  const thumbResponse = await request.get('/w/fx-button/2/thumb.webp');
  expect(thumbResponse.status()).toBe(200);
  expect(thumbResponse.headers()['cache-control']).toBe(THUMB_CACHE);
  expect(thumbResponse.headers()['content-type']).toBe('image/webp');
  expect((await thumbResponse.body()).equals(r2('works/fx-button/2/thumb.webp')!)).toBe(true);
  // 前の版の URL も、承認済みの間は返す（古い HTML から読まれるため）
  expect((await request.get('/w/fx-button/1/thumb.webp')).status()).toBe(200);

  await page.goto('/c/fixture');
  const avatar = await page.locator('img[width="64"]').getAttribute('src');
  const [{ avatar_url: key }] = d1<{ avatar_url: string }>("SELECT avatar_url FROM creators WHERE handle = 'fixture'");
  expect(key).toMatch(/^creators\/[^/]+\/avatar-[0-9a-f]{12}\.webp$/); // D1 にはキーのまま
  expect(avatar).toBe(`/files/${key}`);
  const avatarResponse = await request.get(avatar!);
  expect(avatarResponse.status()).toBe(200);
  expect(avatarResponse.headers()['cache-control']).toBe(LONG_CACHE);
  expect((await avatarResponse.body()).equals(r2(key)!)).toBe(true);
});

test('下書きと取り下げた作品のサムネイルは返さない。R2 の作品のファイルも返さない', async ({ request }) => {
  for (const path of ['/w/fx-landing/1/thumb.webp', '/w/fx-nav/1/thumb.webp']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['cache-control'], path).toBe('private, no-store');
  }
  for (const path of ['/files/works/fx-button/2/part.css', '/files/works/fx-button/2/thumb.webp', '/w/fx-button/2/part.css']) {
    const body = await (await request.get(path)).text();
    expect(body, path).not.toContain('data-ld-part');
  }
});

test('コピー数は直近30日だけを数え、閲覧数は全部を足す。いいねは行の数。D1 の並びは comparePopular と同じ', async ({ request }) => {
  const recent = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const old = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  d1(`INSERT INTO counters (work_id, day, views, copies) VALUES ('fx-habits', '${recent}', 10, 2), ('fx-habits', '${old}', 5, 100), ('fx-toggle', '${old}', 1, 900)`);
  d1("INSERT INTO likes (user_id, work_id, created_at) VALUES ('u1', 'fx-toggle', 1), ('u2', 'fx-toggle', 1)");
  const { works } = (await (await request.get('/api/works')).json()) as { works: Work[] };
  const byId = Object.fromEntries(works.map((work) => [work.id, work]));
  expect(byId['fx-habits']).toMatchObject({ views: 15, copies_30d: 2, likes: 0 });
  expect(byId['fx-toggle']).toMatchObject({ views: 1, copies_30d: 0, likes: 2 });
  expect(works.map((work) => work.id)).toEqual(works.toSorted(comparePopular).map((work) => work.id));
  expect(works.map((work) => work.id)).toEqual(['fx-habits', 'fx-toggle', 'fx-button']);
});

test('題名に </script> や <img> があっても、HTML を抜けない（JSON の埋め込みとカード）', async ({ page, request }) => {
  const { root, cleanup } = tempRoot(['fx-button']);
  const title = '</script><img src=x onerror="window.__xss=1">&';
  try {
    editJson(join(root, 'works/fx-button/meta.json'), (meta) => ({ ...meta, version: '3', title }));
    const sent = ld(['upload', 'fx-button', '--publish', '--env', 'dev'], root);
    expect(sent.code, sent.out).toBe(0);
  } finally {
    cleanup();
  }
  const html = await (await request.get('/')).text();
  expect(html).not.toContain('</script><img');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
  await expect(page.locator('article h2', { hasText: '</script>' })).toHaveText(title);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('幅いっぱいの見本 fx-nav：サムネイルは 800×480。版を上げて --publish なしで送っても、approved のまま差し替わる', async ({ request }) => {
  const { root, cleanup } = tempRoot(['fx-nav']);
  const meta = join(root, 'works/fx-nav/meta.json');
  const send = (version: string, ...flags: string[]) => {
    editJson(meta, (value) => ({ ...value, version }));
    return ld(['upload', 'fx-nav', '--env', 'dev', ...flags], root);
  };
  try {
    // ここまでは draft。--publish なしで版を上げても draft のまま（今の状態を保つ）
    const draft = send('2');
    expect(draft.code, draft.out).toBe(0);
    expect(draft.out).toContain('送った：fx-nav 版 2（draft、版 1 を差し替えた）');
    expect((await request.get('/w/fx-nav/2/thumb.webp')).status()).toBe(404);

    const published = send('3', '--publish');
    expect(published.out).toContain('送った：fx-nav 版 3（approved、版 2 を差し替えた）');

    const kept = send('4');
    expect(kept.code, kept.out).toBe(0);
    expect(kept.out).toContain('送った：fx-nav 版 4（approved、版 3 を差し替えた）');
  } finally {
    cleanup();
  }
  const [row] = d1<{ version: string; status: string; thumb_key: string; thumb_w: number; thumb_h: number; published_at: number | null }>(
    "SELECT version, status, thumb_key, thumb_w, thumb_h, published_at FROM works WHERE id = 'fx-nav'",
  );
  expect(row).toMatchObject({ version: '4', status: 'approved', thumb_key: 'works/fx-nav/4/thumb.webp', thumb_w: 800, thumb_h: 480 });
  expect(row.published_at).toBe(Date.parse('2026-11-08T00:00:00Z'));
  expect((await request.get('/w/fx-nav/4/thumb.webp')).headers()['cache-control']).toBe(THUMB_CACHE);
  const html = await (await request.get('/')).text();
  expect(html).toContain('/w/fx-nav/4/thumb.webp');
  expect(html).not.toContain('/w/fx-nav/3/thumb.webp');
});

test('取り下げた作品は、--publish なしで版を上げても表に戻らない（理由も残る）', async ({ request }) => {
  const { root, cleanup } = tempRoot(['fx-landing']);
  try {
    editJson(join(root, 'works/fx-landing/meta.json'), (value) => ({ ...value, version: '2' }));
    const sent = ld(['upload', 'fx-landing', '--env', 'dev'], root);
    expect(sent.out).toContain('送った：fx-landing 版 2（rejected、版 1 を差し替えた）');
  } finally {
    cleanup();
  }
  expect(d1("SELECT status, reject_reason FROM works WHERE id = 'fx-landing'")).toEqual([{ status: 'rejected', reject_reason: 'テストで取り下げる' }]);
  expect((await request.get('/w/fx-landing/2/thumb.webp')).status()).toBe(404);
});

// ---------------------------------------------------------------- T006：動く作品

test('Motion のチップ：?c=motion で motion の作品だけになる。JS を止めても、リンクで移れて絞られる', async ({ browser, page }) => {
  const sent = ld(['upload', 'fx-motion', '--publish', '--env', 'dev']);
  expect(sent.code, sent.out).toBe(0);

  await page.goto('/');
  await page.locator('[data-masonry][data-placed]').waitFor({ state: 'attached' });
  expect(await page.locator('article').count()).toBeGreaterThan(1); // ほかの作品もある
  await page.getByRole('link', { name: 'モーション', exact: true }).click();
  await expect(page).toHaveURL('/?c=motion');
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article > a')).toHaveAttribute('href', '/p/fx-motion');

  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: test.info().project.use.baseURL });
  const noJs = await context.newPage();
  try {
    await noJs.goto('/');
    const chip = noJs.getByRole('link', { name: 'モーション', exact: true });
    await expect(chip).toHaveAttribute('href', '/?c=motion');
    await chip.click();
    await expect(noJs).toHaveURL('/?c=motion');
    await expect(noJs.getByRole('link', { name: 'モーション', exact: true })).toHaveAttribute('aria-current', 'true');
    await expect(noJs.locator('noscript ul > li')).toHaveCount(1);
    await expect(noJs.locator('noscript ul > li a')).toHaveAttribute('href', '/p/fx-motion');
    await expect(noJs.locator('[data-masonry]')).toBeHidden();
  } finally {
    await context.close();
  }
});

// ---------------------------------------------------------------- T007：作品のページ、作り手のページ、閲覧数とコピー数

test('下書きと取り下げた作品は、作品のページも枠も OG 画像もカウンタも出さない（CLAUDE.md 原則5）', async ({ request }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  // fx-landing は取り下げた。下書きは新しく置く
  const { root, cleanup } = tempRoot(['fx-form']);
  try {
    const sent = ld(['upload', 'fx-form', '--env', 'dev'], root);
    expect(sent.out).toContain('送った：fx-form 版 1（draft）');
  } finally {
    cleanup();
  }
  for (const [id, version] of [['fx-landing', '1'], ['fx-landing', '2'], ['fx-form', '1']]) {
    const page = await request.get(`/p/${id}`);
    expect(page.status(), id).toBe(404);
    const body = await page.text();
    expect(body, id).not.toContain('data-ld-part');
    expect((await request.get(`/frame/${id}/${version}/desktop.html`, { headers: FROM_IFRAME })).status(), id).toBe(404);
    expect((await request.get(`/w/${id}/${version}/og.png`)).status(), id).toBe(404);
    const count = await request.post('/api/count', { headers: { Origin: origin }, data: { work_id: id, type: 'view' } });
    expect(count.status(), id).toBe(400);
  }
  expect(d1("SELECT COUNT(*) AS n FROM counters WHERE work_id IN ('fx-landing', 'fx-form')")[0].n).toBe(0);

  // sitemap にも載らない（T016「2.6」）。承認済みは載る。承認済みの作品がない作者も載らない
  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).not.toContain('/p/fx-landing');
  expect(sitemap).not.toContain('/p/fx-form');
  expect(sitemap).toContain('<loc>https://ludion.ai/p/fx-button</loc>');
  expect(sitemap).toContain('<loc>https://ludion.ai/c/fixture</loc>');
  expect(d1("SELECT COUNT(*) AS n FROM creators WHERE handle = 'studio_kiln'")[0].n).toBe(1);
  expect(sitemap).not.toContain('/c/studio_kiln');
});

test('版を上げると、作品のページとコピー用の文字列と枠が新しい版になる。前の版の枠も、承認済みの間は返す', async ({ request }) => {
  const html = await (await request.get('/p/fx-button')).text();
  expect(html).toContain('src="/frame/fx-button/3/desktop.html"');
  expect((await request.get('/frame/fx-button/3/desktop.html', { headers: FROM_IFRAME })).status()).toBe(200);
  expect((await request.get('/frame/fx-button/1/desktop.html', { headers: FROM_IFRAME })).status()).toBe(200);
  expect((await request.get('/frame/fx-button/99/desktop.html', { headers: FROM_IFRAME })).status()).toBe(404);
});

test('題名に </script> や <img> があっても、作品のページと枠の HTML を抜けない。OG の属性も逃がす', async ({ page, request }) => {
  const title = '</script><img src=x onerror="window.__xss=1">&';
  const html = await (await request.get('/p/fx-button')).text();
  expect(html).not.toContain('</script><img');
  expect(html).not.toContain('<img src=x');
  expect(/<meta property="og:title" content="([^"]*)"/.exec(html)![1]).toBe(`&lt;/script&gt;&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;&amp;（@fixture）· Ludion`);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/p/fx-button');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(errors).toEqual([]);
});

test('作品が1つだけの作者：「@handle のほかの作品」を出さない。レーベルの表示は両方のページに出る。作品が承認済みでない作者のページは 404', async ({ page, request }) => {
  const { root, cleanup } = tempRoot(['fx-form']);
  try {
    expect(ld(['creator', 'add', 'studio_kiln', '--name', 'Studio Kiln', '--label'], root).code).toBe(0);
    editJson(join(root, 'works/fx-form/meta.json'), (meta) => ({ ...meta, version: '2', creator: 'studio_kiln' }));
    // 承認の前は、作者のページも出さない
    const draft = ld(['upload', 'fx-form', '--env', 'dev'], root);
    expect(draft.out, draft.out).toContain('送った：fx-form 版 2（draft');
    expect((await request.get('/c/studio_kiln')).status()).toBe(404);
    editJson(join(root, 'works/fx-form/meta.json'), (meta) => ({ ...meta, version: '3' }));
    const sent = ld(['upload', 'fx-form', '--publish', '--env', 'dev'], root);
    expect(sent.code, sent.out).toBe(0);
  } finally {
    cleanup();
  }
  await page.goto('/p/fx-form');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Plain Signup');
  await expect(page.getByText('· Ludion Studio のレーベル', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /のほかの作品$/ })).toHaveCount(0);
  // ほかの作者の作品は、作者を問わず並ぶ（T018）。自分の作品は入らない
  const hrefs = await page.locator('article > a').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
  expect(hrefs).not.toContain('/p/fx-form');
  await page.goto('/c/studio_kiln');
  await expect(page.getByText('Ludion Studio のレーベル（運営が制作）')).toBeVisible();
  await expect(page.getByText('1作品', { exact: true })).toBeVisible();
});

test('creator.json の x_url が http(s) でなければ、リンクにしない', async ({ page }) => {
  d1("UPDATE creators SET x_url = 'javascript:window.__xss=1', site_url = 'data:text/html,x' WHERE handle = 'studio_kiln'");
  await page.goto('/c/studio_kiln');
  await expect(page.getByRole('link', { name: 'X を新しいタブで開く', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Site', exact: true })).toHaveCount(0);
  await page.goto('/p/fx-form');
  await expect(page.getByRole('link', { name: 'X を新しいタブで開く', exact: true })).toHaveCount(0);
});

test('Worker も part.js のページの移動を確かめる：fx-bad-nav は「形」で 422', async ({ request }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ld-post-'));
  try {
    cpSync(join(REPO, 'fixtures/works/fx-bad-nav'), dir, { recursive: true });
    for (const name of ['thumb.webp', 'og.png']) cpSync(join(REPO, 'fixtures/works/fx-button', name), join(dir, name));
    const response = await postWork(request, dir, join(REPO, 'fixtures/creators/fixture'));
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.failed.map((f: { label: string }) => f.label)).toEqual(['形']);
    expect(body.failed[0].problems[0].message).toBe('part.js 6行目 が location.href に代入している');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Worker も part.html の外へのリンクを確かめる：fx-bad-link は「形」で 422', async ({ request }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ld-post-'));
  try {
    cpSync(join(REPO, 'fixtures/works/fx-bad-link'), dir, { recursive: true });
    for (const name of ['thumb.webp', 'og.png']) cpSync(join(REPO, 'fixtures/works/fx-button', name), join(dir, name));
    const response = await postWork(request, dir, join(REPO, 'fixtures/creators/fixture'));
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.failed.map((f: { label: string }) => f.label)).toEqual(['形']);
    expect(body.failed[0].problems[0].message).toBe('part.html の <a href="https://example.com/pricing"> が外へ移る');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Worker も part.js の色と reduced motion を確かめる：fx-bad-motion は「形」で 422、色入りの部品は「トークンの純度」で 422', async ({ request }) => {
  const creator = join(REPO, 'fixtures/creators/fixture');
  const motion = mkdtempSync(join(tmpdir(), 'ld-post-'));
  const color = mkdtempSync(join(tmpdir(), 'ld-post-'));
  try {
    cpSync(join(REPO, 'fixtures/works/fx-bad-motion'), motion, { recursive: true });
    for (const name of ['thumb.webp', 'og.png']) cpSync(join(REPO, 'fixtures/works/fx-button', name), join(motion, name));
    const badMotion = await postWork(request, motion, creator);
    expect(badMotion.status()).toBe(422);
    const motionBody = await badMotion.json();
    expect(motionBody.failed.map((f: { label: string }) => f.label)).toEqual(['形']);
    expect(motionBody.failed[0].problems[0].message).toContain('prefers-reduced-motion: reduce');

    cpSync(join(REPO, 'fixtures/works/fx-toggle'), color, { recursive: true });
    writeFileSync(join(color, 'part.js'), `${readFileSync(join(color, 'part.js'), 'utf8')}\nconst ACCENT = '#ff0000';\n`);
    const badColor = await postWork(request, color, creator);
    expect(badColor.status()).toBe(422);
    const colorBody = await badColor.json();
    expect(colorBody.failed.map((f: { label: string }) => f.label)).toEqual(['トークンの純度']);
    expect(colorBody.failed[0].problems[0].message).toBe('part.js 14行目 の色 #ff0000');
  } finally {
    rmSync(motion, { recursive: true, force: true });
    rmSync(color, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 壁紙の静止画（WALL002）

/** PNG の幅と高さ（IHDR）。PNG でなければ null。 */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const STILLS = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
];
const stillName = (size: { width: number; height: number }) => `wall-${size.width}x${size.height}.png`;
const wallText = copy.work.wallpaper;

test('壁紙の作品は ld upload で静止画を3つの大きさで作り、R2 に置く。ほかの作品には作らない', () => {
  const sent = ld(['upload', 'fx-wallpaper', '--publish', '--env', 'dev']);
  expect(sent.code, sent.out).toBe(0);
  expect(sent.out).toContain('静止画：3840×2160');
  for (const size of STILLS) {
    const still = r2(`works/fx-wallpaper/1/${stillName(size)}`);
    expect(still, stillName(size)).not.toBeNull();
    expect(pngSize(still!)).toEqual(size);
  }
  // 壁紙でない作品（先に送った見本）には作らない
  expect(r2(`works/fx-button/1/${stillName(STILLS[2])}`)).toBeNull();
});

test('静止画の道：公開の版だけ、PNG を <id>-<幅>x<高さ>.png として返す。ない大きさ、ない版、壁紙でない作品は 404', async ({ request }) => {
  for (const size of STILLS) {
    const response = await request.get(`/w/fx-wallpaper/1/${stillName(size)}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/png');
    expect(response.headers()['content-disposition']).toBe(`attachment; filename="fx-wallpaper-${size.width}x${size.height}.png"`);
    expect(response.headers()['cache-control']).toBe('private, no-store');
    expect(pngSize(await response.body())).toEqual(size);
  }
  expect((await request.get('/w/fx-wallpaper/1/wall-1280x720.png')).status()).toBe(404);
  expect((await request.get('/w/fx-wallpaper/9/wall-1920x1080.png')).status()).toBe(404);
  expect((await request.get('/w/fx-button/1/wall-1920x1080.png')).status()).toBe(404);
  expect((await request.get('/w/nothing-here/1/wall-1920x1080.png')).status()).toBe(404);
});

test('壁紙の作品のページ：枠の上に静止画を最初から重ね、PC は 1 秒、スマホは 2.5 秒たったら 0.4 秒で消す。もう一度でも同じ。ほかの作品には重ねない', async ({ browser, baseURL, request }) => {
  const COVER = 'img[data-wall-cover]';
  // Worker の HTML に最初から入る。壁紙でない作品には入らない
  expect(await (await request.get('/p/fx-wallpaper')).text()).toMatch(/<img[^>]*data-wall-cover/);
  expect(await (await request.get('/p/fx-button')).text()).not.toContain('data-wall-cover');

  const devices = [
    { label: 'PC', options: { viewport: { width: 1440, height: 900 } }, coarse: false, wait: 1000 },
    { label: 'スマホ', options: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true }, coarse: true, wait: 2500 },
  ];
  type CoverLog = { covered: boolean; fadeAfter: number | null };
  for (const device of devices) {
    const context = await browser.newContext({ baseURL, ...device.options });
    // ページの最初の描画から、毎フレーム静止画の濃さを見る。濃い（1）のを見た後に薄くなり始めた時を、枠を読み始めた時から数えて残す
    await context.addInitScript((selector) => {
      if (window !== window.top) return;
      const log: CoverLog = { covered: false, fadeAfter: null };
      Object.defineProperty(window, '__cover', { value: log, configurable: true, writable: true });
      const tick = () => {
        const current = (window as unknown as { __cover: CoverLog }).__cover;
        const img = document.querySelector(selector);
        const frame = document.querySelector('iframe[data-ld-frame]') as (HTMLIFrameElement & { ldStartedAt?: number }) | null;
        if (img && frame?.ldStartedAt !== undefined && current.fadeAfter === null) {
          if (Number(getComputedStyle(img).opacity) === 1) current.covered = true;
          else if (current.covered) current.fadeAfter = performance.now() - frame.ldStartedAt;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, COVER);
    const page = await context.newPage();
    await page.goto('/p/fx-wallpaper');
    const cover = page.locator(COVER);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), device.label).toBe(device.coarse);
    expect(await cover.getAttribute('srcset')).toBe(STILLS.map((size) => `/w/fx-wallpaper/1/${stillName(size)} ${size.width}w`).join(', '));
    await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), device.label).toBe(true);
    // 枠と同じ場所と大きさ
    const [a, b] = [(await cover.boundingBox())!, (await page.locator('iframe[data-ld-frame]').boundingBox())!];
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(a[key] - b[key]), `${device.label} ${key}`).toBeLessThan(1);

    /** 枠を読み始めてから、静止画が薄くなり始めるまで（ms） */
    const coveredFor = async () => {
      await page.waitForFunction(() => (window as unknown as { __cover: CoverLog }).__cover.fadeAfter !== null, null, { timeout: 15_000 });
      return page.evaluate(() => (window as unknown as { __cover: CoverLog }).__cover.fadeAfter!);
    };

    const first = await coveredFor();
    // 決めた時間より前には消さない。後ろは、React が載るのを待つ分（CI の機械）だけ遅れてよい
    expect(first, device.label).toBeGreaterThanOrEqual(device.wait - 50);
    expect(first, device.label).toBeLessThan(device.wait + 3000);
    await expect(cover).toHaveCSS('transition-duration', '0.4s');
    await expect(cover).toHaveCSS('opacity', '0');
    // 消えた後は、枠を触れる（静止画はクリックを通す）
    await expect(cover).toHaveCSS('pointer-events', 'none');

    // もう一度：すぐにまた重ね、同じ時間で消す
    await page.evaluate(() => {
      (window as unknown as { __cover: CoverLog }).__cover = { covered: false, fadeAfter: null };
    });
    await page.getByRole('button', { name: copy.work.replay }).click();
    await expect(cover).toHaveCSS('opacity', '1');
    const again = await coveredFor();
    expect(again, `${device.label} もう一度`).toBeGreaterThanOrEqual(device.wait - 50);
    expect(again, `${device.label} もう一度`).toBeLessThan(device.wait + 1000);
    await expect(cover).toHaveCSS('opacity', '0');
    await context.close();
  }
});

test('管理 API：静止画は壁紙の作品だけで、3つ全部。大きさが違えば「形」で 422', async ({ request }) => {
  const creator = join(REPO, 'fixtures/creators/fixture');
  const asFile = (name: string, buffer: Buffer) => ({ name, mimeType: 'image/png', buffer });
  const stills = Object.fromEntries(STILLS.map((size) => [stillName(size), asFile(stillName(size), r2(`works/fx-wallpaper/1/${stillName(size)}`)!)]));
  const dir = mkdtempSync(join(tmpdir(), 'ld-post-'));
  const send = (extra: Record<string, { name: string; mimeType: string; buffer: Buffer }>) => {
    const body: Record<string, { name: string; mimeType: string; buffer: Buffer }> = { ...extra };
    for (const name of readdirSync(dir)) body[name] = { name, mimeType: 'application/octet-stream', buffer: readFileSync(join(dir, name)) };
    for (const name of ['creator.json', 'avatar.webp']) body[name] = { name, mimeType: 'application/octet-stream', buffer: readFileSync(join(creator, name)) };
    return request.post('/api/admin/works', { headers: { Authorization: `Bearer ${TOKEN}` }, multipart: body });
  };
  try {
    // 壁紙でない作品
    cpSync(join(REPO, 'fixtures/works/fx-button'), dir, { recursive: true });
    editJson(join(dir, 'meta.json'), (meta) => ({ ...meta, version: '9' }));
    const notWallpaper = await send(stills);
    expect(notWallpaper.status()).toBe(422);
    expect(JSON.stringify((await notWallpaper.json()).failed)).toContain('壁紙の作品だけ');

    // 壁紙の作品でも、1枚足りない、または大きさが違えば 422
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(REPO, 'fixtures/works/fx-wallpaper'), dir, { recursive: true });
    editJson(join(dir, 'meta.json'), (meta) => ({ ...meta, version: '2' }));
    const missing = await send({ [stillName(STILLS[0])]: stills[stillName(STILLS[0])], [stillName(STILLS[1])]: stills[stillName(STILLS[1])] });
    expect(missing.status()).toBe(422);
    expect(JSON.stringify((await missing.json()).failed)).toContain('静止画が 2 枚しかない');
    const swapped = await send({ ...stills, [stillName(STILLS[0])]: asFile(stillName(STILLS[0]), stills[stillName(STILLS[2])].buffer) });
    expect(swapped.status()).toBe(422);
    expect(JSON.stringify((await swapped.json()).failed)).toContain('wall-3840x2160.png が 1920×1080');
    // どれも置かれていない
    expect(d1<{ version: string }>("SELECT version FROM works WHERE id = 'fx-wallpaper'")).toEqual([{ version: '1' }]);
    expect(d1("SELECT id FROM revisions WHERE work_id = 'fx-button' AND version = '9'")).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.describe('作品のページの「静止画で使う（アプリ不要）」', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  async function openSheet(page: Page) {
    await page.goto('/p/fx-wallpaper');
    await page.getByRole('heading', { level: 1 }).waitFor();
    await page.waitForFunction(() => Object.keys(document.getElementById('root')!).some((key) => key.startsWith('__reactContainer')));
    await page.getByRole('button', { name: wallText.open, exact: true }).locator('visible=true').click();
    return page.getByRole('dialog', { name: wallText.heading });
  }

  test('シートの一番上にあり、3つの大きさの PNG が落ちる（大きさが合う）。押した数は wallpaper_open の still', async ({ page }) => {
    const sent: [string, unknown][] = [];
    await page.exposeFunction('__sent', (name: string, params: unknown) => sent.push([name, params]));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      const record = (window as unknown as { __sent: (name: string, params: unknown) => void }).__sent;
      window.gtag = (command: unknown, name: unknown, params: unknown) => {
        if (command === 'event' && name !== 'page_view') record(name as string, params);
      };
    });
    const dialog = await openSheet(page);
    // 一番上が静止画。その下に「動く壁紙にする」の見出しと、今までの節（Windows の端末なので Windows が先）
    expect(await dialog.locator('section').evaluateAll((list) => list.map((s) => s.getAttribute('data-wallpaper')))).toEqual(['still', 'windows', 'mac', 'other']);
    expect(await dialog.getByRole('heading', { level: 3 }).allTextContents()).toEqual([wallText.still, wallText.live]);
    const still = dialog.locator('section[data-wallpaper="still"]');
    // Windows の端末では Windows の1行だけ
    await expect(still.getByText(wallText.stillWindows, { exact: true })).toBeVisible();
    await expect(still.getByText(wallText.stillMac, { exact: true })).toHaveCount(0);
    // 初めの大きさは、画面（1440px、密度1）に一番近い 1920×1080
    await expect(still.getByRole('radio', { name: wallText.stillSizeName(1920, 1080) })).toBeChecked();

    for (const size of STILLS) {
      const label = wallText.stillSizeName(size.width, size.height);
      await still.getByText(label, { exact: true }).click();
      await expect(still.getByRole('radio', { name: label })).toBeChecked();
      sent.length = 0;
      const [download] = await Promise.all([page.waitForEvent('download'), still.getByRole('link', { name: wallText.stillDownload }).click()]);
      expect(download.suggestedFilename()).toBe(`fx-wallpaper-${size.width}x${size.height}.png`);
      expect(pngSize(readFileSync((await download.path())!))).toEqual(size);
      await expect.poll(() => sent).toEqual([['wallpaper_open', { work_id: 'fx-wallpaper', method: 'still' }]]);
    }
  });

  test('画素の密度が2の画面（1440px → 2880px）では 2560×1440 が初め。Mac の端末では Mac の1行', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
    const dialog = await openSheet(page);
    const still = dialog.locator('section[data-wallpaper="still"]');
    await expect(still.getByRole('radio', { name: wallText.stillSizeName(2560, 1440) })).toBeChecked();
    await expect(still.getByText(wallText.stillMac, { exact: true })).toBeVisible();
    await expect(still.getByText(wallText.stillWindows, { exact: true })).toHaveCount(0);
    await context.close();
  });
});
