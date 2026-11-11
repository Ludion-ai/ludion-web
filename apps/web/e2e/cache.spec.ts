// T012：キャッシュの許可リストと、回数の制限（docs/tasks/T012.md「1」「2」）。
// 手元のサーバーは Workers Cache を動かさない（cf-cache-status が付かない）。ここで確かめるのは Worker が付ける指示まで。
// 実際に当たること、消せること、相手の情報が返らないことは、本番で scripts/verify-cache.mjs が確かめる。
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';
import { createHmac, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import type { Work } from '../src/data/works';
import {
  applyCachePolicy,
  CACHE_RULES,
  CATALOG_TAG,
  DEFAULT_CACHE_CONTROL,
  LONG_CACHE_CONTROL,
  THUMB_CACHE_CONTROL,
  PAGE_CACHE_CONTROL,
  shareOrigin,
  workTag,
} from '../worker/cachePolicy';
import { PURGE_RETRY_DELAYS_MS, purgeWithRetry } from '../worker/purge';
import { limitKey, limitSubject } from '../worker/limitKey';

const webDir = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const AVATAR_ROUTE = '/files/creators/:creator/:file{avatar-[0-9a-f]{12}\\.webp}';

/** 許したルート（docs/tasks/T012.md「1」）。これを増やすときは、人によって変わらないことを確かめる。 */
const ALLOWED_ROUTES = [
  'GET /en',
  'GET /en/about',
  'GET /en/c/:handle',
  'GET /en/p/:id',
  'GET /en/privacy',
  'GET /en/terms',
  'GET /',
  'GET /about',
  'GET /c/:handle',
  'GET /p/:id',
  'GET /p/:id/code',
  'GET /privacy',
  'GET /terms',
  'GET /sitemap.xml',
  'GET /w/:id/:version/thumb.webp',
  `GET ${AVATAR_ROUTE}`,
  'ALL /*',
].toSorted();

interface Route {
  method: string;
  path: string;
}

/** Worker の Hono のルートを全部取る。Worker だけが読む virtual モジュール（React の描画）は空にする。 */
async function loadRoutes(): Promise<Route[]> {
  const server = await createServer({
    root: webDir,
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
  try {
    const { app } = (await server.ssrLoadModule('/worker/app.ts')) as { app: { routes: Route[] } };
    return app.routes.map(({ method, path }) => ({ method, path }));
  } finally {
    await server.close();
  }
}

/** ルートの形から、実際の道の例を作る。 */
function sampleUrls(path: string): string[] {
  if (path === '/*') return ['/assets/index-abc.js', '/favicon.ico', '/anything'];
  const url = path
    .replace(/:(\w+)\{.*?\}(?=\/|$)/g, (_, name: string, offset: number, whole: string) => {
      if (name === 'version') return '1';
      return whole.slice(offset).includes('avatar-') ? 'avatar-0123456789ab.webp' : 'desktop.html';
    })
    .replace(/:\w+/g, 'x')
    .replace(/\/\*$/, '/x');
  return [url];
}

const CONTENT_TYPE = (url: string) => (url.endsWith('.js') ? 'text/javascript' : 'text/html');

const cacheControlOf = (method: string, url: string, init: ResponseInit = {}) =>
  applyCachePolicy(new Response('x', { status: 200, headers: { 'Content-Type': CONTENT_TYPE(url) }, ...init }), method, url);

test.describe('キャッシュを許したルートが、一覧とちょうど一致する', () => {
  let routes: Route[];

  test.beforeAll(async () => {
    routes = await loadRoutes();
  });

  test('すべてのルートを取り、許したものを数える', () => {
    const allowed = new Set<string>();
    for (const { method, path } of routes) {
      const methods = method === 'ALL' ? ['GET', 'POST'] : [method];
      for (const sent of methods) {
        for (const url of sampleUrls(path)) {
          const control = cacheControlOf(sent, url).headers.get('Cache-Control');
          if (control !== DEFAULT_CACHE_CONTROL && sent !== 'POST') allowed.add(`${method} ${path}`);
          // 状態を変える要求は、どの道でもキャッシュしない
          if (sent === 'POST') expect(control, `POST ${url}`).toBe(DEFAULT_CACHE_CONTROL);
        }
      }
    }
    expect([...allowed].toSorted()).toEqual([...ALLOWED_ROUTES].toSorted());
  });

  test('ルートが取れている（数えもれがない）。許さないものの代表が一覧にある', () => {
    const paths = routes.map(({ path }) => path);
    expect(routes.length).toBeGreaterThan(15);
    for (const path of ['/saved', '/login', '/signup', '/auth/google', '/auth/google/callback', '/auth/signup/pending', '/auth/signup/complete', '/account', '/account/saved', '/api/account', '/api/me', '/api/me/bookmarks', '/api/works', '/api/count', '/auth/github', '/auth/github/callback', '/auth/logout', '/w/:id/:version/og.png']) {
      expect(paths, path).toContain(path);
    }
    expect(paths.some((path) => path.startsWith('/frame/'))).toBe(true);
    expect(paths.some((path) => path.startsWith('/api/admin'))).toBe(true);
  });

  test('CACHE_RULES の route は、どれも実在のルート', () => {
    const paths = new Set(routes.map(({ path }) => path));
    for (const rule of CACHE_RULES) expect(paths.has(rule.route), rule.route).toBe(true);
  });
});

test.describe('applyCachePolicy', () => {
  test('ホーム、作品のページ、作り手のページ：s-maxage=60 と札 catalog', () => {
    for (const path of ['/', '/p/abc', '/p/abc/code', '/c/abc']) {
      const { headers } = cacheControlOf('GET', path);
      expect(headers.get('Cache-Control'), path).toBe(PAGE_CACHE_CONTROL);
      expect(headers.get('Cache-Control'), path).toContain('s-maxage=60');
      expect(headers.get('Cache-Tag'), path).toBe(CATALOG_TAG);
    }
  });

  test('/terms、/privacy、/about：s-maxage=60。札は付けない。/sitemap.xml は札 catalog', () => {
    for (const path of ['/terms', '/en/terms', '/privacy', '/about']) {
      const { headers } = cacheControlOf('GET', path);
      expect(headers.get('Cache-Control'), path).toBe(PAGE_CACHE_CONTROL);
      expect(headers.get('Cache-Tag'), path).toBeNull();
    }
    const sitemap = cacheControlOf('GET', '/sitemap.xml').headers;
    expect(sitemap.get('Cache-Control')).toBe(PAGE_CACHE_CONTROL);
    expect(sitemap.get('Cache-Tag')).toBe(CATALOG_TAG);
    for (const path of ['/terms/more', '/privacy/more', '/about/more', '/sitemap.xml/more']) {
      expect(cacheControlOf('GET', path).headers.get('Cache-Control'), path).toBe(DEFAULT_CACHE_CONTROL);
    }
  });

  test('サムネイルは作品の札、アバターとアセットは札なし。どれも長く', () => {
    const thumb = cacheControlOf('GET', '/w/abc/2/thumb.webp').headers;
    expect(thumb.get('Cache-Control')).toBe(THUMB_CACHE_CONTROL);
    expect(thumb.get('Cache-Tag')).toBe(workTag('abc'));
    for (const path of ['/files/creators/x/avatar-0123456789ab.webp', '/assets/index-abc.js']) {
      const { headers } = cacheControlOf('GET', path);
      expect(headers.get('Cache-Control'), path).toBe(LONG_CACHE_CONTROL);
      expect(headers.get('Cache-Tag'), path).toBeNull();
    }
  });

  test('Set-Cookie を含む応答は、どの道でも private, no-store。札も付けない', () => {
    for (const path of ['/', '/p/abc', '/c/abc', '/privacy', '/about', '/sitemap.xml', '/w/abc/2/thumb.webp', '/files/creators/x/avatar-0123456789ab.webp', '/assets/index-abc.js']) {
      const { headers } = cacheControlOf('GET', path, { headers: { 'Set-Cookie': 'a=b', 'Content-Type': CONTENT_TYPE(path) } });
      expect(headers.get('Cache-Control'), path).toBe(DEFAULT_CACHE_CONTROL);
      expect(headers.get('Cache-Tag'), path).toBeNull();
      expect(headers.get('Set-Cookie'), path).toBe('a=b');
    }
  });

  test('200 のほかはキャッシュしない。ルートが付けた指示と札も消す', () => {
    for (const status of [301, 302, 400, 404, 429, 500, 503]) {
      const { headers } = cacheControlOf('GET', '/', { status, headers: { 'Cache-Control': 'public, max-age=60', 'Cache-Tag': 'x' } });
      expect(headers.get('Cache-Control'), String(status)).toBe(DEFAULT_CACHE_CONTROL);
      expect(headers.get('Cache-Tag'), String(status)).toBeNull();
    }
  });

  test('GET と HEAD のほかはキャッシュしない', () => {
    expect(cacheControlOf('HEAD', '/').headers.get('Cache-Control')).toBe(PAGE_CACHE_CONTROL);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect(cacheControlOf(method, '/').headers.get('Cache-Control'), method).toBe(DEFAULT_CACHE_CONTROL);
    }
  });

  test('一覧のほかの道：枠、OG 画像、API、ログイン、保存、知らない道、深い道', () => {
    for (const path of [
      '/frame/abc/1/desktop.html',
      '/frame/abc/1/mobile.html',
      '/w/abc/1/og.png',
      '/w/abc/1/part.js',
      '/saved',
      '/login',
      '/signup',
      '/auth/google',
      '/account',
      '/account/saved',
      '/api/account',
      '/api/me',
      '/api/me/bookmarks',
      '/api/works',
      '/auth/github',
      '/auth/github/callback',
      '/nothing',
      '/p/abc/more',
      '/c/abc/more',
      '/files/creators/x/creator.json',
      '/files/works/abc/1/part.js',
      '/assets/deep/index.js',
    ]) {
      expect(cacheControlOf('GET', path).headers.get('Cache-Control'), path).toBe(DEFAULT_CACHE_CONTROL);
    }
  });

  test('/assets/ の知らない道は SPA の index.html（200）になるので、キャッシュしない', () => {
    const { headers } = cacheControlOf('GET', '/assets/nothing.js', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    expect(headers.get('Cache-Control')).toBe(DEFAULT_CACHE_CONTROL);
  });
});

test('キャッシュのキーにホストが入らないので、workers.dev で先に開かれても OG の URL は ludion.ai にする', () => {
  expect(shareOrigin('https://ludion-web.ludion.workers.dev/p/abc')).toBe('https://ludion.ai');
  expect(shareOrigin('https://ludion.ai/p/abc')).toBe('https://ludion.ai');
  expect(shareOrigin('http://127.0.0.1:4175/p/abc')).toBe('http://127.0.0.1:4175');
});

test.describe('手元のサーバーの実際の応答', () => {
  const seedWorks = async (request: APIRequestContext) => ((await (await request.get('/api/works')).json()) as { works: Work[] }).works;

  test('許した道：HTML、サムネイル、アバター、JS、CSS', async ({ request }) => {
    const [work] = await seedWorks(request);
    const html = await (await request.get('/')).text();
    const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)![1];
    const style = /href="(\/assets\/index-[^"]+\.css)"/.exec(html)![1];
    const font = /href="(\/assets\/inter-latin-wght-normal-[^"]+\.woff2)"/.exec(html)![1];

    for (const path of ['/', '/?c=web', '/?sort=new&q=a&type=component', `/p/${work.id}`, `/p/${work.id}/code`, `/c/${work.creator.handle}`]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['cache-control'], path).toBe(PAGE_CACHE_CONTROL);
      expect(response.headers()['cache-tag'], path).toBe(CATALOG_TAG);
      expect(response.headers()['set-cookie'], path).toBeUndefined();
    }
    const thumb = await request.get(`/w/${work.id}/${work.version}/thumb.webp`);
    expect(thumb.status()).toBe(200);
    expect(thumb.headers()['cache-control']).toBe(THUMB_CACHE_CONTROL);
    expect(thumb.headers()['cache-tag']).toBe(workTag(work.id));
    for (const path of [script, style, font]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['cache-control'], path).toBe(LONG_CACHE_CONTROL);
    }
  });

  test('許さない道：private, no-store で、札がない', async ({ request }) => {
    const [work] = await seedWorks(request);
    const checks: [string, Promise<APIResponse>, number][] = [
      ['/api/works', request.get('/api/works'), 200],
      ['/api/me', request.get('/api/me'), 200],
      ['/saved', request.get('/saved', { maxRedirects: 0 }), 301],
      ['/account', request.get('/account', { maxRedirects: 0 }), 302],
      ['/login', request.get('/login'), 200],
      ['/signup', request.get('/signup'), 200],
      ['/api/account', request.get('/api/account'), 401],
      ['/auth/github', request.get('/auth/github', { maxRedirects: 0 }), 302],
      ['枠', request.get(`/frame/${work.id}/${work.version}/desktop.html`, { headers: { 'Sec-Fetch-Dest': 'iframe' } }), 200],
      ['枠（枠の外から）', request.get(`/frame/${work.id}/${work.version}/desktop.html`, { maxRedirects: 0 }), 302],
      ['ない作品', request.get('/p/nothing-here'), 404],
      ['ない作品のコード', request.get('/p/nothing-here/code'), 404],
      ['ない作者', request.get('/c/nothing-here'), 404],
      ['知らない道', request.get('/nothing-here'), 404],
      ['/assets/ の知らない道', request.get('/assets/nothing-here.js'), 404],
      ['robots.txt', request.get('/robots.txt'), 200],
      ['ないサムネイル', request.get('/w/nothing-here/1/thumb.webp'), 404],
    ];
    for (const [label, pending, status] of checks) {
      const response = await pending;
      expect(response.status(), label).toBe(status);
      expect(response.headers()['cache-control'], label).toBe(DEFAULT_CACHE_CONTROL);
      expect(response.headers()['cache-tag'], label).toBeUndefined();
    }
  });
});

test.describe('消す（purge）の結果を確かめ、1秒、2秒、4秒でやり直す', () => {
  type Result = { success: boolean; errors: { code: number; message: string }[] };
  const OK: Result = { success: true, errors: [] };
  const NO: Result = { success: false, errors: [{ code: 1, message: 'rate limited' }] };

  function fake(results: (Result | Error)[]) {
    const calls: unknown[] = [];
    const slept: number[] = [];
    const cache = {
      purge: async (options: unknown) => {
        calls.push(options);
        const next = results.shift()!;
        if (next instanceof Error) throw next;
        return next;
      },
    };
    return { cache, calls, slept, sleep: async (ms: number) => void slept.push(ms) };
  }

  test('1回で消せたら待たない', async () => {
    const { cache, calls, slept, sleep } = fake([OK]);
    expect(await purgeWithRetry(cache, [CATALOG_TAG], sleep)).toBe(true);
    expect(calls).toEqual([{ tags: ['catalog'] }]);
    expect(slept).toEqual([]);
  });

  test('失敗が続いても、3回目のやり直しで消せれば true', async () => {
    const { cache, calls, slept, sleep } = fake([NO, new Error('network'), NO, OK]);
    expect(await purgeWithRetry(cache, [CATALOG_TAG], sleep)).toBe(true);
    expect(calls).toHaveLength(4);
    expect(slept).toEqual([1000, 2000, 4000]);
  });

  test('3回とも失敗したら false。それ以上やり直さない', async () => {
    const { cache, calls, slept, sleep } = fake([NO, NO, NO, NO, OK]);
    expect(await purgeWithRetry(cache, [CATALOG_TAG], sleep)).toBe(false);
    expect(calls).toHaveLength(4);
    expect(slept).toEqual(PURGE_RETRY_DELAYS_MS);
  });

  test('手元のサーバーには ctx.cache がなく、消すものもないので、失敗にしない', async () => {
    expect(await purgeWithRetry(undefined, [CATALOG_TAG], async () => {})).toBe(true);
  });
});

test.describe('回数の制限（数の守り）', () => {
  const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const limitOf = (name: string) => Number(new RegExp(`"name": "${name}"[^\\n]*"limit": (\\d+)`).exec(config)![1]);

  /** ほかのテストと鍵が重ならない、使い捨ての IP。 */
  const uniqueIp = () => `${randomInt(1, 224)}.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

  /** 窓の変わり目をまたいでも見つかるよう、上限の2倍と少しまで送り、最初に 429 が返った番目を返す。 */
  async function firstLimited(limit: number, send: (index: number) => Promise<APIResponse>) {
    for (let index = 0; index < limit * 2 + 2; index += 1) {
      const response = await send(index);
      if (response.status() === 429) return { index, response };
    }
    throw new Error(`${limit * 2 + 2} 回送っても 429 が返らなかった`);
  }

  test('wrangler.jsonc：版ごとの URL を作らない。Workers Cache を入れる', () => {
    expect(config).toMatch(/"preview_urls": false/);
    expect(config).toMatch(/"cache": \{ "enabled": true \}/);
  });

  test('POST /api/count：上限を超えると 429。ほかの IP は通る。ほかの API は止まらない', async ({ request, baseURL }) => {
    const limit = limitOf('LIMIT_COUNT');
    const origin = new URL(baseURL!).origin;
    const ip = uniqueIp();
    // 中身が正しくない要求で数える（D1 の数を増やさない）
    const post = (from: string) => request.post('/api/count', { headers: { 'CF-Connecting-IP': from, Origin: origin }, data: {} });
    const { index, response } = await firstLimited(limit, () => post(ip));
    expect(index).toBeGreaterThanOrEqual(limit);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(response.headers()['retry-after']).toBe('60');
    expect(response.headers()['cache-control']).toBe(DEFAULT_CACHE_CONTROL);

    expect((await post(uniqueIp())).status()).toBe(400);
    expect((await request.get('/api/works', { headers: { 'CF-Connecting-IP': ip } })).status()).toBe(200);
  });

  test('GET /p/:id/code：上限を超えると 429（束縛は LIMIT_COUNT。docs/tasks/T031.md「1」）。ほかの IP は通る', async ({ request }) => {
    const limit = limitOf('LIMIT_COUNT');
    const ip = uniqueIp();
    // ない作品で数える（R2 を読まない）
    const get = (from: string) => request.get('/p/nothing-here/code', { headers: { 'CF-Connecting-IP': from } });
    const { index, response } = await firstLimited(limit, () => get(ip));
    expect(index).toBeGreaterThanOrEqual(limit);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(response.headers()['retry-after']).toBe('60');
    expect(response.headers()['cache-control']).toBe(DEFAULT_CACHE_CONTROL);
    expect((await get(uniqueIp())).status()).toBe(404);
  });

  test('POST /api/works/*/like と bookmark：上限を合わせて数え、超えると 429', async ({ request, baseURL }) => {
    const limit = limitOf('LIMIT_TOGGLE');
    const origin = new URL(baseURL!).origin;
    const ip = uniqueIp();
    const { index } = await firstLimited(limit, (i) =>
      request.post(`/api/works/nothing/${i % 2 === 0 ? 'like' : 'bookmark'}`, { headers: { 'CF-Connecting-IP': ip, Origin: origin } }),
    );
    expect(index).toBeGreaterThanOrEqual(limit);
    expect((await request.post('/api/works/nothing/like', { headers: { 'CF-Connecting-IP': ip, Origin: origin } })).status()).toBe(429);
    expect((await request.post('/api/works/nothing/bookmark', { headers: { 'CF-Connecting-IP': ip, Origin: origin } })).status()).toBe(429);
  });

  test('/auth/*：上限を超えると、fetch で呼ぶ道は 429、人が開く道はログインの画面へ', async ({ request, baseURL }) => {
    const limit = limitOf('LIMIT_AUTH');
    const origin = new URL(baseURL!).origin;
    const ip = uniqueIp();
    const logout = () => request.post('/auth/logout', { headers: { 'CF-Connecting-IP': ip, Origin: origin } });
    const { index } = await firstLimited(limit, (i) => (i % 2 === 0 ? logout() : request.get('/auth/github/callback', { headers: { 'CF-Connecting-IP': ip }, maxRedirects: 0 })));
    expect(index).toBeGreaterThanOrEqual(limit);
    expect((await logout()).status()).toBe(429);
    for (const [path, location] of [
      ['/auth/github/callback?state=x&code=y', '/login?error=login_limited'],
      ['/auth/google/callback?state=x&code=y', '/login?error=login_limited'],
      ['/auth/github?next=/p/x', `/login?next=${encodeURIComponent('/p/x')}&error=login_limited`],
      ['/auth/google?next=/en/p/x', `/en/login?next=${encodeURIComponent('/en/p/x')}&error=login_limited`],
    ]) {
      const response = await request.get(path, { headers: { 'CF-Connecting-IP': ip }, maxRedirects: 0 });
      expect(response.status(), path).toBe(302);
      expect(response.headers().location, path).toBe(location);
    }
  });

  test('IPv6 は /64 までを1人と見なす', async ({ request, baseURL }) => {
    const limit = limitOf('LIMIT_AUTH');
    const origin = new URL(baseURL!).origin;
    const prefix = `2001:db8:${randomInt(0x10000).toString(16)}:${randomInt(0x10000).toString(16)}`;
    const { index } = await firstLimited(limit, (i) =>
      request.post('/auth/logout', { headers: { 'CF-Connecting-IP': `${prefix}::${(i + 1).toString(16)}`, Origin: origin } }),
    );
    expect(index).toBeGreaterThanOrEqual(limit);
  });

  test('limitSubject：IPv4 はそのまま。IPv6 は上の4組に揃える', () => {
    expect(limitSubject('203.0.113.7')).toBe('203.0.113.7');
    expect(limitSubject('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(limitSubject('2001:DB8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(limitSubject('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(limitSubject('::1')).toBe('0:0:0:0::/64');
  });

  test.describe('limitKey：秘密の値と UTC の日で作った HMAC（T024「2」）', () => {
    const SECRET = 'test-secret';
    const IP = '203.0.113.7';
    const NOON = new Date('2026-11-09T12:00:00Z');

    test('形：HMAC-SHA-256 の16進。公開された値から計算し直して同じ。IP を含まない', async () => {
      const key = await limitKey(IP, SECRET, NOON);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      // 実装の外（Node の crypto）で同じ値を作る
      expect(key).toBe(createHmac('sha256', SECRET).update(`2026-11-09|${IP}`).digest('hex'));
    });

    test('同じ人は、同じ日のうちは同じ鍵', async () => {
      const key = await limitKey(IP, SECRET, NOON);
      expect(await limitKey(IP, SECRET, new Date('2026-11-09T00:00:00Z'))).toBe(key);
      expect(await limitKey(IP, SECRET, new Date('2026-11-09T23:59:59.999Z'))).toBe(key);
      // 日本の日付は変わるが、UTC の日は同じ
      expect(await limitKey(IP, SECRET, new Date('2026-11-09T15:00:00Z'))).toBe(key);
    });

    test('UTC の日が変わると鍵が変わる', async () => {
      const before = await limitKey(IP, SECRET, new Date('2026-11-09T23:59:59.999Z'));
      const after = await limitKey(IP, SECRET, new Date('2026-11-10T00:00:00Z'));
      expect(after).not.toBe(before);
    });

    test('ほかの人、ほかの秘密の値では鍵が変わる', async () => {
      const key = await limitKey(IP, SECRET, NOON);
      expect(await limitKey('203.0.113.8', SECRET, NOON)).not.toBe(key);
      expect(await limitKey(IP, 'other-secret', NOON)).not.toBe(key);
    });

    test('IPv6 は今までと同じ：同じ /64 は同じ鍵。ほかの /64 は別の鍵', async () => {
      const key = await limitKey('2001:db8:1:2:3:4:5:6', SECRET, NOON);
      expect(await limitKey('2001:DB8:1:2::9', SECRET, NOON)).toBe(key);
      expect(await limitKey('2001:db8:1:3::9', SECRET, NOON)).not.toBe(key);
    });
  });

  test('手元のサーバーが付ける自分の IP は数えない（開発とテストを止めない）', async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const limit = limitOf('LIMIT_COUNT');
    for (let index = 0; index < limit + 5; index += 1) {
      const response = await request.post('/api/count', { headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: origin }, data: {} });
      expect(response.status()).toBe(400);
    }
  });
});
