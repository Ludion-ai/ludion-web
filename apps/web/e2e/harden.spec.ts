// T022「2」「3」：応答のヘッダーの表（SEC001 の A11）と、ログに残るもの（A12、CLAUDE.md 原則6）。
// 値はここに直に書く。実装の定数を読むと、実装を間違えてもテストが一緒に変わるため。
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { createServer } from 'vite';
import type { Work } from '../src/data/works';
import { purgeWithRetry } from '../worker/purge';

const HSTS = 'max-age=604800';
const REFERRER = 'strict-origin-when-cross-origin';
const PARENT_CSP = "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const FRAME_CSP =
  "sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'";
const DENIED_FEATURES = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'bluetooth', 'hid', 'display-capture'];

type Kind = 'html' | 'frame' | 'other';

function expectHeaders(label: string, response: APIResponse, kind: Kind) {
  const headers = response.headers();
  expect(headers['x-content-type-options'], `${label} nosniff`).toBe('nosniff');
  expect(headers['strict-transport-security'], `${label} HSTS`).toBe(HSTS);
  if (kind === 'other') {
    expect(headers['content-security-policy'], `${label} CSP なし`).toBeUndefined();
    expect(headers['referrer-policy'], `${label} Referrer なし`).toBeUndefined();
    expect(headers['permissions-policy'], `${label} Permissions なし`).toBeUndefined();
    return;
  }
  expect(headers['content-security-policy'], `${label} CSP`).toBe(kind === 'frame' ? FRAME_CSP : PARENT_CSP);
  expect(headers['referrer-policy'], `${label} Referrer`).toBe(REFERRER);
  const denied = (headers['permissions-policy'] ?? '').split(/,\s*/);
  for (const feature of DENIED_FEATURES) expect(denied, `${label} ${feature}`).toContain(`${feature}=()`);
  // コードのコピーで使う。止めない
  expect(denied.join(), label).not.toContain('clipboard-write');
}

async function firstWork(request: APIRequestContext) {
  return ((await (await request.get('/api/works')).json()) as { works: Work[] }).works[0];
}

test.describe('応答のヘッダーの表', () => {
  test('HTML：どのページにも親の CSP と Referrer-Policy と Permissions-Policy', async ({ request }) => {
    const work = await firstWork(request);
    const pages: [string, number][] = [
      ['/', 200],
      ['/?q=a&sort=new', 200],
      [`/p/${work.id}`, 200],
      [`/c/${work.creator.handle}`, 200],
      ['/privacy', 200],
      ['/about', 200],
      ['/nothing-here', 404],
      ['/p/nothing-here', 404],
      ['/c/nothing-here', 404],
      ['/assets/nothing-here.js', 404],
    ];
    for (const [path, status] of pages) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(status);
      expect(response.headers()['content-type'], path).toContain('text/html');
      expectHeaders(path, response, 'html');
    }
  });

  test('HEAD：GET と同じ', async ({ request }) => {
    const work = await firstWork(request);
    for (const path of ['/', `/p/${work.id}`, '/about', '/nothing-here']) expectHeaders(`HEAD ${path}`, await request.head(path), 'html');
    expectHeaders('HEAD /api/works', await request.head('/api/works'), 'other');
    expectHeaders('HEAD /robots.txt', await request.head('/robots.txt'), 'other');
  });

  test('API：nosniff と HSTS だけ', async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const cases: [string, Promise<APIResponse>, number][] = [
      ['/api/works', request.get('/api/works'), 200],
      ['/api/me', request.get('/api/me'), 200],
      ['/api/nothing', request.get('/api/nothing'), 404],
      ['POST /api/count（中身が違う）', request.post('/api/count', { headers: { Origin: origin }, data: {} }), 400],
      ['POST /api/count（外の Origin）', request.post('/api/count', { headers: { Origin: 'https://evil.example' }, data: {} }), 403],
      ['POST /api/admin（トークンなし）', request.post('/api/admin/works'), 401],
    ];
    for (const [label, pending, status] of cases) {
      const response = await pending;
      expect(response.status(), label).toBe(status);
      expectHeaders(label, response, 'other');
    }
  });

  test('転送：nosniff と HSTS だけ', async ({ request }) => {
    const work = await firstWork(request);
    const cases: [string, Promise<APIResponse>][] = [
      ['/saved', request.get('/saved', { maxRedirects: 0 })],
      ['/account', request.get('/account', { maxRedirects: 0 })],
      ['/auth/github', request.get('/auth/github', { maxRedirects: 0 })],
      ['枠の外から', request.get(`/frame/${work.id}/${work.version}/desktop.html`, { maxRedirects: 0 })],
    ];
    for (const [label, pending] of cases) {
      const response = await pending;
      // /saved は /account/saved へ移ったので 301
      expect(response.status(), label).toBe(label === '/saved' ? 301 : 302);
      expectHeaders(label, response, 'other');
    }
  });

  test('アセットと画像と XML：nosniff と HSTS だけ', async ({ request }) => {
    const work = await firstWork(request);
    const html = await (await request.get('/')).text();
    const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)![1];
    const style = /href="(\/assets\/index-[^"]+\.css)"/.exec(html)![1];
    for (const path of [script, style, '/robots.txt', '/sitemap.xml', `/w/${work.id}/${work.version}/thumb.webp`]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expectHeaders(path, response, 'other');
    }
  });

  test('枠：CSP は今のまま。ほかは HTML と同じ', async ({ request }) => {
    const work = await firstWork(request);
    for (const file of ['desktop', 'mobile']) {
      const response = await request.get(`/frame/${work.id}/${work.version}/${file}.html`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
      expect(response.status(), file).toBe(200);
      expectHeaders(`枠 ${file}`, response, 'frame');
    }
  });

  test('キャッシュに入る親の CSP にホストを入れない（キャッシュのキーにホストが入らない。SPEC「10」）', () => {
    expect(PARENT_CSP).not.toMatch(/https?:|\.[a-z]/);
  });
});

test.describe('検索の重さ（SEC001 の A09）', () => {
  test('長い q はエラーにせず、切って描く', async ({ request, page }) => {
    const long = 'a'.repeat(5000);
    const response = await request.get(`/?q=${long}`);
    expect(response.status()).toBe(200);
    await page.goto(`/?q=${long}`);
    const typed = await page.getByRole('searchbox').first().inputValue();
    expect(typed.length).toBe(200);
  });

  test('語の多い q は8語までで検索する（9語目で当たらなくならない）', async ({ page, request }) => {
    const work = await firstWork(request);
    const words = `${work.title.split(/\s+/)[0]} `.repeat(8) + 'zzzz-not-a-word';
    await page.goto(`/?q=${encodeURIComponent(words)}`);
    await expect(page.locator('article').first()).toBeVisible();
  });
});

// ---------------------------------------------------------------- ログ

/** Worker の Hono を読む。Worker だけが読む virtual モジュール（React の描画）は空にする。 */
async function loadWorkerApp() {
  const server = await createServer({
    root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    plugins: [
      {
        name: 'stub-virtual',
        enforce: 'pre',
        resolveId: (id) => (id.startsWith('virtual:ludion/') ? `\0${id}` : undefined),
        load: (id) => (id.startsWith('\0virtual:ludion/') ? 'export default ""; export const renderApp = () => null;' : undefined),
      },
    ],
  });
  const { app } = (await server.ssrLoadModule('/worker/app.ts')) as { app: { request: (path: string, init: RequestInit, env: unknown) => Promise<Response> } };
  return { app, close: () => server.close() };
}

/** ログに出たら困る合成の値。例外の中身、URL、見出し、バインドした値に入れて流す。 */
const LEAKS = {
  ip: '203.0.113.99',
  ua: 'ld-synthetic-ua',
  bearer: 'ld-synthetic-bearer',
  session: 'ld-synthetic-session',
  query: 'ld-synthetic-query',
  code: 'ld-synthetic-code',
  bound: 'ld-synthetic-bound-value',
};
const LEAK_HEADERS = { 'CF-Connecting-IP': LEAKS.ip, 'User-Agent': LEAKS.ua, Authorization: `Bearer ${LEAKS.bearer}`, Cookie: `ld_session=${LEAKS.session}; ld_oauth_state=s` };
const leakyError = () => new Error(`SELECT ${LEAKS.bound} FROM x; ip=${LEAKS.ip} url=/?q=${LEAKS.query}`);

/** 決まった短いエラーの名前と、道の種類などの決まった値だけ。 */
const LOG_LINE = /^[a-z_]+( [a-z_]+=[A-Za-z_]+)*$/;

const METHODS = ['debug', 'error', 'info', 'log', 'warn'] as const;

/** fn の間に console に出たものを、全部文字にして集める。 */
async function captureConsole(fn: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const saved = METHODS.map((method) => [method, console[method]] as const);
  for (const method of METHODS) console[method] = (...args: unknown[]) => void lines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg))).join(' '));
  try {
    await fn();
  } finally {
    for (const [method, original] of saved) console[method] = original;
  }
  return lines;
}

function expectClean(lines: string[], expected: string) {
  const text = lines.join('\n');
  for (const [name, value] of Object.entries(LEAKS)) expect(text, `${name} がログに出ない`).not.toContain(value);
  expect(lines, 'ログの中身').toEqual([expected]);
  for (const line of lines) expect(line).toMatch(LOG_LINE);
}

test.describe('ログに要求と例外の中身を出さない（原則6）', () => {
  let worker: Awaited<ReturnType<typeof loadWorkerApp>>;
  test.beforeAll(async () => {
    worker = await loadWorkerApp();
  });
  test.afterAll(async () => {
    await worker.close();
  });

  const passLimit = { limit: async () => ({ success: true }) };
  const baseEnv = {
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    GITHUB_WEB_URL: 'https://github.invalid',
    GITHUB_API_URL: 'https://api.github.invalid',
    LIMIT_COUNT: passLimit,
    LIMIT_TOGGLE: passLimit,
    LIMIT_AUTH: passLimit,
    LIMIT_ACCOUNT: passLimit,
    LIMIT_RECOVERY: passLimit,
    RATE_KEY_SECRET: LEAKS.bound,
    DB: {
      prepare: () => {
        throw leakyError();
      },
    },
  };

  test('捕まえていない例外：名前と道の種類だけ', async () => {
    let response: Response;
    const lines = await captureConsole(async () => {
      response = await worker.app.request(`/api/works?q=${LEAKS.query}`, { headers: LEAK_HEADERS }, baseEnv);
    });
    expect(response!.status).toBe(500);
    expect(await response!.json()).toEqual({ error: 'internal_error' });
    expectClean(lines, 'internal_error route=api type=Error');
  });

  test('AI の口の例外：AI の鍵の生の値を出さない。名前と道の種類だけ（docs/tasks/T037.md）', async () => {
    const key = `ld_${'Q'.repeat(20)}${'7'.repeat(20)}`;
    for (const [path, method] of [['/api/v1/works', 'GET'], ['/api/v1/works', 'POST'], [`/api/v1/works/${LEAKS.query}`, 'GET']] as const) {
      let response: Response;
      const lines = await captureConsole(async () => {
        response = await worker.app.request(path, { method, headers: { ...LEAK_HEADERS, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{"html":"x"}' } : {}) }, baseEnv);
      });
      expect(response!.status).toBe(500);
      expect(await response!.json()).toMatchObject({ error: 'internal_error' });
      expect(lines.join('\n')).not.toContain(key);
      expect(lines.join('\n')).not.toContain(key.slice(3));
      expectClean(lines, 'internal_error route=api type=Error');
    }
  });

  test('作品のページの例外は、作品の id を出さず、道の種類だけ', async () => {
    const lines = await captureConsole(() => worker.app.request(`/p/${LEAKS.query}`, { headers: LEAK_HEADERS }, baseEnv));
    expectClean(lines, 'internal_error route=p type=Error');
  });

  test('GitHub のログインの失敗：コードとトークンを出さない', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw leakyError();
    };
    // 途中の状態が合って、GitHub に聞くところまで進む
    const token = 'a'.repeat(64);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const data = JSON.stringify({ state: 's', next: '/', intent: 'login' });
    const DB = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ token_hash: tokenHash, data }] }), first: async () => ({ data }) }) }) };
    const headers = { ...LEAK_HEADERS, Cookie: `${LEAK_HEADERS.Cookie}; ld_github_flow_x=${token}` };
    try {
      let response: Response;
      const lines = await captureConsole(async () => {
        response = await worker.app.request(`/auth/github/callback?code=${LEAKS.code}&state=s`, { headers }, { ...baseEnv, DB });
      });
      expect(response!.status).toBe(302);
      expect(response!.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/')}&error=login_failed`);
      expectClean(lines, 'github_failed route=auth');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('ログインの道の例外は、JSON ではなくログインの画面へ。ログには名前と道の種類だけ', async () => {
    const token = 'a'.repeat(64);
    const headers = { ...LEAK_HEADERS, Cookie: `${LEAK_HEADERS.Cookie}; ld_github_flow_x=${token}` };
    let response: Response;
    const lines = await captureConsole(async () => {
      response = await worker.app.request(`/auth/github/callback?code=${LEAKS.code}&state=s`, { headers }, baseEnv);
    });
    expect(response!.status).toBe(302);
    expect(response!.headers.get('location')).toBe('/login?error=login_failed');
    expectClean(lines, 'internal_error route=auth type=Error');
  });

  test('手段の設定がないときも、JSON ではなくログインの画面へ', async () => {
    const empty = { ...baseEnv, GITHUB_CLIENT_ID: '', GOOGLE_CLIENT_ID: '' };
    for (const path of ['/auth/github?next=/p/x', '/auth/google?next=/p/x']) {
      const response = await worker.app.request(path, {}, empty);
      expect(response.status, path).toBe(302);
      expect(response.headers.get('location'), path).toBe(`/login?next=${encodeURIComponent('/p/x')}&error=login_failed`);
    }
  });

  test('回数の制限の束縛の失敗：鍵（IP）を出さない。通す', async () => {
    const broken = {
      limit: async ({ key }: { key: string }) => {
        throw new Error(`limit failed for ${key} ${LEAKS.bound}`);
      },
    };
    let response: Response;
    const lines = await captureConsole(async () => {
      response = await worker.app.request('/api/count', { method: 'POST', headers: { ...LEAK_HEADERS, Origin: 'https://evil.example' } }, { ...baseEnv, LIMIT_COUNT: broken });
    });
    expect(response!.status).toBe(403);
    expectClean(lines, 'rate_limit_failed binding=LIMIT_COUNT route=api');
  });

  // T024「2」：束縛に渡るのは HMAC だけ
  test('回数の制限の束縛に生の IP を渡さない。同じ人は同じ鍵、ほかの人は別の鍵', async () => {
    const keys: string[] = [];
    const recording = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: true };
      },
    };
    const post = (ip: string) => worker.app.request('/api/count', { method: 'POST', headers: { 'CF-Connecting-IP': ip, Origin: 'https://evil.example' } }, { ...baseEnv, LIMIT_COUNT: recording });
    await post(LEAKS.ip);
    await post(LEAKS.ip);
    await post('203.0.113.100');
    expect(keys).toHaveLength(3);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  test('束縛が false を返したら 429', async () => {
    const closed = { limit: async () => ({ success: false }) };
    const response = await worker.app.request('/api/count', { method: 'POST', headers: { 'CF-Connecting-IP': LEAKS.ip } }, { ...baseEnv, LIMIT_COUNT: closed });
    expect(response.status).toBe(429);
  });

  test('秘密の値の設定もれ：束縛を呼ばない（生の IP で数えない）。通す。決まった名前だけ', async () => {
    let called = 0;
    const counting = {
      limit: async () => {
        called += 1;
        return { success: false };
      },
    };
    let response: Response;
    const lines = await captureConsole(async () => {
      response = await worker.app.request(
        '/api/count',
        { method: 'POST', headers: { ...LEAK_HEADERS, Origin: 'https://evil.example' } },
        { ...baseEnv, LIMIT_COUNT: counting, RATE_KEY_SECRET: undefined },
      );
    });
    expect(called).toBe(0);
    expect(response!.status).toBe(403);
    expectClean(lines, 'rate_key_missing binding=LIMIT_COUNT route=api');
  });

  test('管理トークンの設定もれ：決まった名前だけ', async () => {
    const lines = await captureConsole(() => worker.app.request('/api/admin/works', { method: 'POST', headers: LEAK_HEADERS }, baseEnv));
    expectClean(lines, 'admin_token_missing');
  });

  test('キャッシュを消せなかったとき：Cloudflare の返した中身を出さない', async () => {
    const results: ({ success: boolean; errors: unknown[] } | Error)[] = [{ success: false, errors: [{ message: LEAKS.bound }] }, leakyError(), { success: true, errors: [] }];
    const cache = {
      purge: async () => {
        const next = results.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    };
    const lines = await captureConsole(() => purgeWithRetry(cache, ['catalog'], async () => {}));
    const text = lines.join('\n');
    for (const value of Object.values(LEAKS)) expect(text).not.toContain(value);
    expect(lines).toEqual(['cache_purge_failed', 'cache_purge_failed']);
  });

  test('Worker の中で console を直に使うのは worker/log.ts だけ', () => {
    const dir = new URL('../worker/', import.meta.url);
    const users = readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && /\bconsole\./.test(readFileSync(new URL(name, dir), 'utf8')))
      .toSorted();
    expect(users).toEqual(['log.ts']);
    // React の描画も Worker の中で動く
    expect(readFileSync(new URL('../src/entry-server.tsx', import.meta.url), 'utf8')).not.toMatch(/\bconsole\./);
  });
});

test.describe('Cloudflare の可観測性の設定（docs/tasks/T022.md「3」）', () => {
  /** 行の頭の // だけを落とす（値の中の // は残す）。 */
  const readJsonc = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));

  test('ludion-web：要求ごとの自動の記録を切り、console のログは残す。トレースも切る。URL の値は落とす', () => {
    const { observability } = readJsonc('../wrangler.jsonc');
    expect(observability).toEqual({
      enabled: true,
      redact_query_string: true,
      logs: { enabled: true, invocation_logs: false },
      traces: { enabled: false },
    });
  });

  test('www の転送：何も残さない', () => {
    expect(readJsonc('../www-redirect/wrangler.jsonc').observability).toEqual({ enabled: false });
  });
});
