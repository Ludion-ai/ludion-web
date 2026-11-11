// ld upload --private と ld login（LD002）を、プラグインのテストと同じ偽のサーバー（plugins/test/fake-server.mjs）で確かめる。
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { splitSnippet } from '@ludion/rules';
import { OTHER_KEY, TEST_KEY, startFakeServer } from '../../../plugins/test/fake-server.mjs';
import { LD_BIN, REPO, makeTempRoot } from './helpers.ts';

type FakeServer = Awaited<ReturnType<typeof startFakeServer>>;
interface Call {
  method: string;
  path: string;
  auth: string | null;
  client: string | null;
  body: string;
}

/** 偽のサーバーが答えるので、spawnSync ではなく非同期で動かす。stderr も分けて返す。 */
function runLd(args: string[], env: Record<string, string>, onStderr?: (text: string) => void) {
  return new Promise<{ code: number | null; out: string; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [LD_BIN, ...args], { env: { ...process.env, LUDION_KEY: '', LUDION_URL: '', LUDION_CLIENT: '', LUDION_NO_OPEN: '1', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => {
      stderr += d;
      onStderr?.(stderr);
    });
    child.on('close', (code) => resolve({ code, out: `${stdout}${stderr}`, stdout, stderr }));
  });
}

const token = (prefix: string, c: string) => `${prefix}_${c.repeat(40)}`;

/** auth.json を ludion.mjs の形で書く（つないだときのもの）。 */
function writeAuth(home: string, base: string, entry: Record<string, unknown>) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'auth.json'), `${JSON.stringify({ servers: { [base]: entry } }, null, 2)}\n`);
}

test.describe('ld upload --private', () => {
  test.describe.configure({ mode: 'serial' });
  let server: FakeServer;
  const calls = () => server.calls as Call[];
  const posts = () => calls().filter((c) => c.path.startsWith('/api/v1/'));

  test.beforeAll(async () => {
    server = await startFakeServer({ putLimit: 1000 });
  });
  test.afterAll(async () => {
    await server.close();
  });

  const setup = (works = ['fx-toggle']) => {
    const temp = makeTempRoot(works);
    const home = mkdtempSync(join(tmpdir(), 'ld-home-'));
    return { ...temp, home, env: { LD_ROOT: temp.root, LD_DEV_URL: server.url, LUDION_HOME: home } };
  };

  test('--publish と一緒には使えない（何も送らない）', async () => {
    const { env, cleanup } = setup();
    try {
      const n = calls().length;
      const r = await runLd(['upload', 'fx-toggle', '--private', '--publish'], { ...env, LUDION_KEY: TEST_KEY });
      expect(r.code).toBe(1);
      expect(r.out).toContain('--private と --publish は一緒に使えない');
      expect(calls().length).toBe(n);
    } finally {
      cleanup();
    }
  });

  test('鍵がないとき：ld login を案内して止める（何も送らない、.ludion.json も作らない）', async () => {
    const { env, root, cleanup } = setup();
    try {
      const n = calls().length;
      const r = await runLd(['upload', 'fx-toggle', '--private'], env);
      expect(r.code).toBe(1);
      expect(r.out).toContain('npx ld login --env dev');
      expect(r.out).toContain('LUDION_KEY');
      expect(calls().length).toBe(n);
      expect(existsSync(join(root, '.ludion.json'))).toBe(false);
      // prod の案内は --env を付けない（CEO が打つのは npx ld login）
      const prod = await runLd(['upload', 'fx-toggle', '--private', '--env', 'prod'], { ...env, LUDION_HOME: mkdtempSync(join(tmpdir(), 'ld-home-')) });
      expect(prod.code).toBe(1);
      expect(prod.out).toMatch(/npx ld login を1回打ち/);
    } finally {
      cleanup();
    }
  });

  test('LUDION_KEY で置く。同じ id をもう一度送ると、同じ作品の新しい版になる。同じ中身なら送らない', async () => {
    const { env, root, cleanup } = setup();
    try {
      const first = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LUDION_KEY: TEST_KEY });
      expect(first.code, first.out).toBe(0);
      const call = posts().at(-1)!;
      expect(call.method).toBe('POST');
      expect(call.path).toBe('/api/v1/works');
      expect(call.auth).toBe(`Bearer ${TEST_KEY}`);
      expect(call.client).toBe('ld');
      const body = JSON.parse(call.body) as { html: string; title: string };
      expect(Object.keys(body).sort()).toEqual(['html', 'title']);
      expect(body.title).toBe('Quiet Switches');
      // サーバー（/new の箱と同じ splitSnippet）で分けると、作品の3つのファイルに戻る
      const split = splitSnippet(body.html);
      expect(split.ok).toBe(true);
      if (!split.ok) return;
      const dir = join(REPO, 'fixtures/works/fx-toggle');
      expect(split.parts.html.trim()).toBe(readFileSync(join(dir, 'part.html'), 'utf8').trim());
      expect(split.parts.css.trim()).toBe(readFileSync(join(dir, 'part.css'), 'utf8').trim());
      expect(split.parts.js?.trim()).toBe(readFileSync(join(dir, 'part.js'), 'utf8').trim());
      expect(body.html).not.toContain('UI by @');

      const created = [...server.works.values()].find((w) => w.owner === 'u1' && w.title === 'Quiet Switches')!;
      expect(first.out).toContain('自分だけの作品として置いた');
      expect(first.out).toContain(`住所：${server.url}/p/${created.id}`);
      expect(first.out).not.toContain(TEST_KEY);

      // .ludion.json はプラグインと同じ形（works の中に id、version、hash）。鍵は書かない
      const statePath = join(root, '.ludion.json');
      const stateText = readFileSync(statePath, 'utf8');
      const state = JSON.parse(stateText) as { works: Record<string, { id: string; version: number; hash: string }> };
      const key = `works/fx-toggle/@${server.url}`;
      expect(state.works[key].id).toBe(created.id);
      expect(state.works[key].version).toBe(1);
      expect(state.works[key].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(stateText).not.toContain(TEST_KEY);

      // 同じ中身：送らない
      const n = posts().length;
      const same = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LUDION_KEY: TEST_KEY });
      expect(same.code, same.out).toBe(0);
      expect(same.out).toContain('変わっていない');
      expect(posts().length).toBe(n);

      // 変えて送る：同じ作品の版 2
      appendFileSync(join(root, 'works/fx-toggle/part.css'), '\n[data-ld-part="fx-toggle"] .ld002 { opacity: 1; }\n');
      const second = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LUDION_KEY: TEST_KEY });
      expect(second.code, second.out).toBe(0);
      expect(posts().at(-1)!.path).toBe(`/api/v1/works/${created.id}/versions`);
      expect(posts().at(-1)!.client).toBe('ld');
      expect(server.works.get(created.id)!.versions.length).toBe(2);
      expect(second.out).toContain('同じ自分だけの作品に新しい版を置いた');
      expect(second.out).toContain(`${created.id} 版 2`);
      const after = JSON.parse(readFileSync(statePath, 'utf8')) as typeof state;
      expect(after.works[key].version).toBe(2);
      expect(after.works[key].id).toBe(created.id);
    } finally {
      cleanup();
    }
  });

  test('worktree の中で送っても、元の clone の根の .ludion.json に works/<id>/ の名前で残り、別の worktree から送ると同じ作品の新しい版', async () => {
    const { env, root, cleanup } = setup();
    try {
      const git = (args: string[], cwd = root) => {
        const r = spawnSync('git', ['-c', 'user.name=ld-test', '-c', 'user.email=ld-test@example.invalid', ...args], { cwd, encoding: 'utf8' });
        expect(r.status, r.stderr).toBe(0);
      };
      git(['commit', '-q', '--allow-empty', '-m', 'base']);
      // セッションの worktree と同じ形：元の clone の中の .claude/worktrees/<名前>。作品はコミットしていないので写す
      const worktree = (name: string) => {
        const dir = join(root, '.claude', 'worktrees', name);
        git(['worktree', 'add', '-q', '--detach', dir]);
        for (const part of ['works', 'creators', 'ld.config.json']) cpSync(join(root, part), join(dir, part), { recursive: true });
        return dir;
      };
      const a = worktree('a');
      const b = worktree('b');
      const key = `works/fx-toggle/@${server.url}`;
      const statePath = join(root, '.ludion.json');

      const first = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LD_ROOT: a, LUDION_KEY: TEST_KEY });
      expect(first.code, first.out).toBe(0);
      expect(existsSync(join(a, '.ludion.json'))).toBe(false);
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as { works: Record<string, { id: string; version: number }> };
      expect(Object.keys(state.works)).toEqual([key]);
      expect(state.works[key].version).toBe(1);
      const id = state.works[key].id;

      appendFileSync(join(b, 'works/fx-toggle/part.css'), '\n[data-ld-part="fx-toggle"] .ld002-b { opacity: 1; }\n');
      const second = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LD_ROOT: b, LUDION_KEY: TEST_KEY });
      expect(second.code, second.out).toBe(0);
      expect(posts().at(-1)!.path).toBe(`/api/v1/works/${id}/versions`);
      expect(second.out).toContain(`${id} 版 2`);
      expect(existsSync(join(b, '.ludion.json'))).toBe(false);
      const after = JSON.parse(readFileSync(statePath, 'utf8')) as typeof state;
      expect(Object.keys(after.works)).toEqual([key]);
      expect(after.works[key]).toMatchObject({ id, version: 2 });
      // 一時ファイルは残らない
      expect(readdirSync(root).filter((f) => f.startsWith('.ludion.json'))).toEqual(['.ludion.json']);
    } finally {
      cleanup();
    }
  });

  test('鍵の読む順：LUDION_KEY が先、なければ ~/.ludion/auth.json', async () => {
    const { env, home, cleanup } = setup();
    try {
      const access = token('ldo', 'K');
      server.users.set(access, { id: 'u1', handle: 'me' });
      writeAuth(home, server.url, { client_id: 'c-ld002', access_token: access, access_expires_at: Date.now() + 3600_000, refresh_token: token('ldr', 'K'), connected_at: new Date().toISOString() });

      const withKey = await runLd(['upload', 'fx-toggle', '--private'], { ...env, LUDION_KEY: OTHER_KEY });
      expect(withKey.code, withKey.out).toBe(0);
      expect(posts().at(-1)!.auth).toBe(`Bearer ${OTHER_KEY}`);

      appendFileSync(join(env.LD_ROOT, 'works/fx-toggle/part.css'), '\n/* changed */\n');
      // OTHER_KEY の作品を覚えているので、auth.json の人（u1）が送ると 404 になる。対応を消して新しく置く
      writeFileSync(join(env.LD_ROOT, '.ludion.json'), '{ "works": {} }\n');
      const withAuth = await runLd(['upload', 'fx-toggle', '--private'], env);
      expect(withAuth.code, withAuth.out).toBe(0);
      expect(posts().at(-1)!.auth).toBe(`Bearer ${access}`);
      expect(withAuth.out).not.toContain(access);
    } finally {
      cleanup();
    }
  });

  test('auth.json のトークンが切れていれば、プラグインと同じやり方で取り直す', async () => {
    const { env, home, cleanup } = setup();
    try {
      const oldAccess = token('ldo', 'E');
      const refresh = token('ldr', 'E');
      server.users.set(oldAccess, { id: 'u1', handle: 'me' });
      server.oauth.refresh.set(refresh, oldAccess);
      writeAuth(home, server.url, { client_id: 'c-ld002', access_token: oldAccess, access_expires_at: Date.now() - 1000, refresh_token: refresh, connected_at: new Date().toISOString() });

      const r = await runLd(['upload', 'fx-toggle', '--private'], env);
      expect(r.code, r.out).toBe(0);
      const tokenCall = calls().filter((c) => c.path === '/oauth/token').at(-1)!;
      const form = new URLSearchParams(tokenCall.body);
      expect(form.get('grant_type')).toBe('refresh_token');
      expect(form.get('refresh_token')).toBe(refresh);
      expect(form.get('client_id')).toBe('c-ld002');

      const saved = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).servers[server.url];
      expect(saved.refresh_token).not.toBe(refresh);
      expect(saved.access_token).not.toBe(oldAccess);
      expect(saved.access_expires_at).toBeGreaterThan(Date.now());
      expect(posts().at(-1)!.auth).toBe(`Bearer ${saved.access_token}`);
      expect(r.out).not.toContain(saved.access_token);
      expect(r.out).not.toContain(saved.refresh_token);
    } finally {
      cleanup();
    }
  });

  test('取り直せない（つながりを切られた）ときは auth.json の対応を消し、ld login を案内する', async () => {
    const { env, home, cleanup } = setup();
    try {
      writeAuth(home, server.url, { client_id: 'c-ld002', access_token: token('ldo', 'X'), access_expires_at: Date.now() - 1000, refresh_token: token('ldr', 'X'), connected_at: new Date().toISOString() });
      const n = posts().length;
      const r = await runLd(['upload', 'fx-toggle', '--private'], env);
      expect(r.code).toBe(1);
      expect(r.out).toContain('npx ld login --env dev');
      expect(posts().length).toBe(n);
      expect(JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).servers[server.url]).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test('ld login：プラグインと同じ流れ（PKCE、ブラウザで許可）で ~/.ludion/auth.json に入り、そのまま --private で置ける', async () => {
    const { env, home, cleanup } = setup();
    try {
      let resolveUrl: (url: string) => void = () => {};
      const authorizeUrl = new Promise<string>((resolve) => (resolveUrl = resolve));
      const login = runLd(['login', '--env', 'dev'], env, (err) => {
        const m = /(http:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?\S+)/.exec(err);
        if (m) resolveUrl(m[1]);
      });
      // 「ブラウザ」：住所を開く（偽のサーバーはすぐに許可する）→ ld に戻る
      const url = new URL(await authorizeUrl);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('resource')).toBe(`${server.url}/mcp`);
      expect(server.oauth.clients.get(url.searchParams.get('client_id')!)!.name).toBe('Claude Code');
      const back = await fetch(url, { redirect: 'manual' });
      expect(back.status).toBe(302);
      expect((await fetch(back.headers.get('location')!)).status).toBe(200);
      const r = await login;
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain('つながった');
      const saved = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).servers[server.url];
      expect(saved.refresh_token).toMatch(/^ldr_/);
      expect(r.out).not.toContain(saved.refresh_token);

      const put = await runLd(['upload', 'fx-toggle', '--private'], env);
      expect(put.code, put.out).toBe(0);
      expect(posts().at(-1)!.auth).toBe(`Bearer ${saved.access_token}`);
    } finally {
      cleanup();
    }
  });
});
