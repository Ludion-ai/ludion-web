// 本番の URL で、T010 の終わりの条件を確かめる（docs/tasks/T010.md）。npm test には入れない（本番に要求を送るため）。
// node scripts/verify-prod.mjs [--count]
//
// - 閲覧数を水増ししない（CLAUDE.md 原則10）：ブラウザの確かめでは POST /api/count を途中で止める。
//   --count を付けたときだけ、1つの作品を1回だけ本当に開き、本番の D1 の閲覧数が1増えることを確かめる。
// - 秘密の値は出力しない。client_id は prod.vars.json と比べた結果（一致か）だけを出す。
import { chromium, webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(webDir, '../..');
const shots = join(root, 'docs/screens');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const PROD = 'https://ludion.ai';
const WORKERS_DEV = 'https://ludion-web.ludion.workers.dev';
const COUNT_WORK = 'button-ticket';
const CALLBACK = `${PROD}/auth/github/callback`;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

function d1(sql) {
  const out = execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'ludion-app', '--remote', '--json', '--command', sql], {
    cwd: webDir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out)[0].results;
}

const totalViews = (where = '1 = 1') => d1(`SELECT COALESCE(SUM(views), 0) AS n FROM counters WHERE ${where}`)[0].n;

/** サムネイルが全部読めるまで待つ。読めなかった枚数を返す。 */
async function brokenImages(page) {
  await page.waitForLoadState('networkidle');
  return page.evaluate(async () => {
    const images = [...document.querySelectorAll('article img')];
    await Promise.all(images.map((img) => (img.complete ? null : new Promise((done) => { img.onload = img.onerror = done; }))));
    return images.filter((img) => !img.naturalWidth).length;
  });
}

async function checkHome(browser, ids) {
  for (const base of [PROD, WORKERS_DEV]) {
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ locale: 'ja-JP', viewport: { width, height } });
      const response = await page.goto(`${base}/`, { waitUntil: 'load' });
      const broken = await brokenImages(page);
      const shown = await page.$$eval('article a[href^="/p/"]', (links) => [...new Set(links.map((a) => a.getAttribute('href').slice(3)))]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const missing = ids.filter((id) => !shown.includes(id));
      check(`${base}/ 幅${width}`, response.status() === 200 && missing.length === 0 && shown.length === ids.length && broken === 0 && overflow <= 0,
        `${response.status()}、作品 ${shown.length}/${ids.length}、読めない画像 ${broken}、横のはみ出し ${overflow}px`);
      if (base === PROD) await page.screenshot({ path: join(shots, `prod-home-${width}.png`) });
      await page.close();
    }
  }
}

/**
 * Playwright の Windows 版 WebKit には OffscreenCanvas がない（about:blank でも undefined。本物の Safari は 16.4 から持つ）。
 * その API だけを補い、作品の残りの JS が WebKit で動くかを見る。
 */
function fillOffscreenCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return;
  globalThis.OffscreenCanvas = function OffscreenCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
}

/**
 * POST /api/count を止める。Chromium は CDP で止める：page.route の割り込みを使うと、
 * 枠の要求の Sec-Fetch-Dest が allHeaders() に見えなくなる（送られてはいる）。
 */
async function blockCount(label, context, page) {
  if (label !== 'chromium') {
    // GA4 も止める。gtag.js を読ませなければ、移る直前の要求も出ない（Chromium は launch の --host-resolver-rules で止める）
    await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
    return page.route('**/api/count', (route) => route.abort());
  }
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setBlockedURLs', { urls: ['*/api/count*'] });
}

/** このブラウザから POST /api/count を試みた回数と、届いた回数（本物の訪問者がいるので、D1 の合計では確かめられない）。 */
const countRequests = { tried: 0, delivered: 0 };

/** 作品のページを開き、枠の要求と応答を確かめる。POST /api/count は止める。 */
async function checkFrame(browser, label, id, act) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/count') countRequests.tried += 1; });
  page.on('response', (response) => { if (new URL(response.url()).pathname === '/api/count') countRequests.delivered += 1; });
  await page.addInitScript(fillOffscreenCanvas);
  await blockCount(label, context, page);
  const frameResponse = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith(`/frame/${id}/`));
  await page.goto(`${PROD}/p/${id}`, { waitUntil: 'load' });
  const response = await frameResponse;
  const dest = (await response.request().allHeaders())['sec-fetch-dest'];
  const frame = page.frameLocator('iframe');
  const part = frame.locator(`[data-ld-part="${id}"]`);
  await part.waitFor({ state: 'attached', timeout: 15_000 });
  const sandbox = await page.locator('iframe').getAttribute('sandbox');
  const box = await part.boundingBox();
  let acted = 'なし';
  if (act) acted = await act(frame);
  check(`${label} /p/${id}`, response.status() === 200 && dest === 'iframe' && sandbox === 'allow-scripts allow-forms' && !!box && box.width > 0 && box.height > 0 && acted !== '動かない' && errors.length === 0,
    `枠 ${response.status()}、Sec-Fetch-Dest=${dest}、sandbox="${sandbox}"、大きさ ${box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'なし'}、操作 ${acted}、ページのエラー ${errors.length}${errors.length ? `（${errors[0]}）` : ''}`);
  await context.close();
}

/** 押すと aria の値が変わる（part.js が動いている）ことを確かめる。 */
function pressAndWatch(selector, attribute) {
  return async (frame) => {
    const target = frame.locator(selector).first();
    const before = await target.getAttribute(attribute);
    await target.click({ timeout: 10_000 });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const after = await target.getAttribute(attribute);
      if (after !== before) return `${attribute} ${before}→${after}`;
      await new Promise((done) => setTimeout(done, 100));
    }
    return '動かない';
  };
}

async function checkAuth() {
  const response = await fetch(`${PROD}/auth/github?next=/saved`, { redirect: 'manual' });
  const location = new URL(response.headers.get('location') ?? 'https://invalid.invalid/');
  const expected = JSON.parse(readFileSync(join(homedir(), '.ludion/prod.vars.json'), 'utf8')).GITHUB_CLIENT_ID;
  check('GET /auth/github が GitHub の画面へ送る', response.status === 302 && location.origin === 'https://github.com' && location.pathname === '/login/oauth/authorize',
    `${response.status}、${location.origin}${location.pathname}`);
  check('client_id が本番の値', location.searchParams.get('client_id') === expected, `一致：${location.searchParams.get('client_id') === expected}`);
  check('戻り先が本番の callback', location.searchParams.get('redirect_uri') === CALLBACK, location.searchParams.get('redirect_uri') ?? '');
  check('state が128ビット以上で、scope がない', (location.searchParams.get('state') ?? '').length >= 32 && !location.searchParams.has('scope'), `state の長さ ${(location.searchParams.get('state') ?? '').length}、scope ${location.searchParams.has('scope')}`);
  const flow = response.headers.getSetCookie().find((c) => c.startsWith('ld_github_flow_')) ?? '';
  check('ld_github_flow の属性', /; HttpOnly/.test(flow) && /; Secure/.test(flow) && /; SameSite=Lax/.test(flow) && /; Max-Age=600/.test(flow), flow.replace(/^[^;]*;\s*/, ''));

  const github = await fetch(location.href);
  check('送り先の GitHub が開く', github.ok && new URL(github.url).hostname === 'github.com', `${github.status}、${new URL(github.url).origin}${new URL(github.url).pathname}`);

  const badState = await fetch(`${CALLBACK}?code=x&state=y`, { redirect: 'manual' });
  check('途中の状態がないときの callback は、ログインの画面へ戻す', badState.status === 302 && badState.headers.get('location') === '/login?error=login_retry', `${badState.status}、${badState.headers.get('location')}`);

  // セッションの cookie は、本物のログインでしか発行されない。消すときの応答で、同じ属性の組（SESSION_COOKIE_OPTIONS）を見る
  const logout = await fetch(`${PROD}/auth/logout`, { method: 'POST', headers: { Origin: PROD } });
  const session = logout.headers.getSetCookie().find((c) => c.startsWith('ld_session=')) ?? '';
  check('ld_session の属性（ログアウトの応答）', logout.status === 204 && /; HttpOnly/.test(session) && /; Secure/.test(session) && /; SameSite=Lax/.test(session), `${logout.status}、${session}`);
  const foreign = await fetch(`${PROD}/auth/logout`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  check('外の Origin のログアウトは 403', foreign.status === 403, String(foreign.status));
}

async function checkFrameDirect(id, version) {
  const url = `${PROD}/frame/${id}/${version}/desktop.html`;
  const plain = await fetch(url, { redirect: 'manual' });
  check('枠の URL を直接開くと /p/<id> へ 302', plain.status === 302 && plain.headers.get('location')?.endsWith(`/p/${id}`), `${plain.status}、${plain.headers.get('location')}`);
  const inFrame = await fetch(url, { redirect: 'manual', headers: { 'Sec-Fetch-Dest': 'iframe' } });
  const csp = inFrame.headers.get('content-security-policy') ?? '';
  check('枠の応答の CSP', inFrame.status === 200 && csp.includes("sandbox allow-scripts allow-forms") && csp.includes("form-action 'none'") && csp.includes("frame-ancestors 'self'"), `${inFrame.status}`);
}

async function checkHeaders() {
  // キャッシュを許す道の確かめは scripts/verify-cache.mjs
  // /api/works はキャッシュを許す道（LIMIT001）
  for (const path of ['/api/me']) {
    const response = await fetch(`${PROD}${path}`);
    check(`${path} は Cache-Control: private, no-store`, response.headers.get('cache-control') === 'private, no-store', response.headers.get('cache-control') ?? '');
  }
  const noToken = await fetch(`${PROD}/api/admin/works`, { method: 'POST' });
  check('管理 API はトークンなしで 401', noToken.status === 401, String(noToken.status));
  const vars = await fetch(`${PROD}/.prod.vars`);
  check('/.prod.vars から値が読めない', !(await vars.text()).includes('ADMIN_TOKEN'), String(vars.status));
}

function checkData() {
  const works = d1('SELECT id, status, version FROM works ORDER BY id');
  const creators = d1('SELECT handle, kind FROM creators ORDER BY handle');
  const seedIds = (JSON.parse(readFileSync(join(root, 'seed/works.json'), 'utf8')).works ?? JSON.parse(readFileSync(join(root, 'seed/works.json'), 'utf8'))).map((w) => w.id);
  const fixtureIds = ['works', 'malicious'].flatMap((dir) => readdirSync(join(root, 'fixtures', dir)));
  const banned = new Set([...seedIds, ...fixtureIds]);
  const leaked = works.filter((w) => banned.has(w.id) || /^(seed|fx|mal)-/.test(w.id));
  const leakedCreators = creators.filter((c) => /^(seed_|fixture)/i.test(c.handle));
  check('本番の D1 に seed と見本の行がない', leaked.length === 0 && leakedCreators.length === 0,
    `作品 ${works.length} 行のうち該当 ${leaked.length}（比べた id ${banned.size}）、作者 ${creators.map((c) => `@${c.handle}(${c.kind})`).join(',')}のうち該当 ${leakedCreators.length}`);
  console.log(`         本番の作品：${works.map((w) => `${w.id}@${w.version}:${w.status}`).join(', ')}`);
  return works;
}

// GA4 に確かめの閲覧を混ぜない（docs/tasks/T016.md「2.5」）。Chromium は名前の解決で止める：page.route だと枠の Sec-Fetch-Dest が見えなくなり、移る直前の要求も見落とす
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const browsers = { chromium: await chromium.launch({ args: [NO_ANALYTICS] }), webkit: await webkit.launch() };
try {
  const works = checkData();
  const ids = works.map((w) => w.id);
  const viewsBefore = totalViews();
  await checkHome(browsers.chromium, ids);
  for (const [label, browser] of Object.entries(browsers)) {
    for (const id of ids) {
      const act = id === 'button-ticket' ? pressAndWatch('button.num', 'aria-pressed') : id === 'toggle-daylight' ? pressAndWatch('[role="switch"]', 'aria-checked') : null;
      await checkFrame(browser, label, id, act);
    }
  }
  check('確かめのブラウザは閲覧数を増やさない（POST /api/count を試みて、止められた）', countRequests.tried > 0 && countRequests.delivered === 0, `試み ${countRequests.tried} 回、届いた ${countRequests.delivered} 回`);
  console.log(`         全作品の閲覧数の合計（本物の訪問者を含むので判定に使わない）：${viewsBefore} → ${totalViews()}`);
  const work = works.find((w) => w.id === COUNT_WORK);
  await checkFrameDirect(work.id, work.version);
  await checkAuth();
  await checkHeaders();

  if (process.argv.includes('--count')) {
    const where = `work_id = '${COUNT_WORK}'`;
    const before = totalViews(where);
    const page = await browsers.chromium.newPage();
    const counted = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/count' && r.request().method() === 'POST');
    await page.goto(`${PROD}/p/${COUNT_WORK}`, { waitUntil: 'load' });
    const response = await counted;
    await page.close();
    const after = totalViews(where);
    check(`/p/${COUNT_WORK} を開くと本番の D1 の閲覧数が1増える`, response.ok() && after === before + 1, `POST /api/count ${response.status()}、${before} → ${after}`);
  }
} finally {
  await Promise.all(Object.values(browsers).map((browser) => browser.close()));
}

console.log(failed === 0 ? '\n全部満たした' : `\n未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
