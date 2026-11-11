// 本番の URL で、FIX-motion の確かめをする（docs/tasks/FIX-motion.md「4」）。npm test には入れない（本番に要求を送るため）。
// node scripts/verify-fix-motion.mjs [--shots]
// 手元のサーバーで試すとき：--base=http://127.0.0.1:4178 --ids=fx-motion,fx-toggle
//
// - 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。
// - GA4 に確かめの閲覧を混ぜない（docs/tasks/T016.md「2.5」）：Chromium は名前の解決で、WebKit は route で止める。
// - 枠を時間をあけて2回撮って比べる。作品を変えない。本番のデータも変えない。
import { chromium, webkit } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');
const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const BASE = argument('base') ?? 'https://ludion.ai';
const TAKE_SHOTS = process.argv.includes('--shots');
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const NO_GPU = ['--disable-gpu', '--disable-software-rasterizer'];
const GAP_MS = 1200;
const FRAME = 'iframe[data-ld-frame]';
const SHOW = '動きを見る';
const STOP = '動きを止める';
/** 11/9 に CTO が本番で測った、ふつうの端末で勝手に動く作品（docs/tasks/FIX-motion.md） */
const MOVING = ['toggle-daylight', 'slider-resident', 'like-pond', 'login-lumen', 'progress-ferro', 'tabs-prism'];
const USES_WEBGL = ['like-pond', 'login-lumen', 'tabs-prism'];

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

/** Playwright の Windows 版 WebKit には OffscreenCanvas がない（verify-prod.mjs と同じ補い）。 */
function fillOffscreenCanvas() {
  if (typeof OffscreenCanvas !== 'undefined') return;
  globalThis.OffscreenCanvas = function OffscreenCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
}

const counted = { tried: 0, delivered: 0 };

async function newPage(browser, label, options = {}) {
  // 言語を決めておく。決めないと、ブラウザの言語が英語の環境では /en へ移り、日本語の文字を探せない
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/count') counted.tried += 1;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/count') counted.delivered += 1;
  });
  await page.addInitScript(fillOffscreenCanvas);
  if (label === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/count*'] });
  } else {
    await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
    await page.route('**/api/count', (route) => route.abort());
  }
  return page;
}

async function openWork(page, id) {
  await page.goto(`${BASE}/p/${id}`, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
}

/** 枠の中の作品が置かれるのを待ち、最初の動きが落ち着くのを少し待ってから、2回撮って比べる。 */
async function frameMoves(page, id) {
  await page.frameLocator(FRAME).locator(`[data-ld-part="${id}"]`).waitFor({ state: 'attached', timeout: 20_000 });
  await page.waitForTimeout(800);
  const frame = page.locator(FRAME);
  const first = await frame.screenshot();
  await page.waitForTimeout(GAP_MS);
  const second = await frame.screenshot();
  return !first.equals(second);
}

const notice = (page) => page.locator('[data-motion-notice]');
const button = (page, name) => notice(page).getByRole('button', { name });
const stored = (page) => page.evaluate(() => localStorage.getItem('ld-show-motion'));

async function listWorks() {
  const response = await fetch(`${BASE}/api/works`);
  const { works } = await response.json();
  return works.map((w) => ({ id: w.id, version: w.version }));
}

/** ふつうの端末：知らせなし、枠の URL に値なし、全作品の枠が動くか。 */
async function checkNormal(browser, label, works) {
  const moved = [];
  for (const { id } of works) {
    const page = await newPage(browser, label);
    await openWork(page, id);
    const hidden = await notice(page).isHidden();
    const webglNotice = await page.locator('[data-webgl-notice]').count();
    const src = await page.locator(FRAME).getAttribute('src');
    const moves = await frameMoves(page, id);
    if (moves) moved.push(id);
    check(`${label} ふつう /p/${id}`, hidden && webglNotice === 0 && !src.includes('?') && page.errors.length === 0, `知らせ ${hidden ? 'なし' : 'あり'}、WebGL の知らせ ${webglNotice}、動く ${moves}、エラー ${page.errors.length}${page.errors.length ? `（${page.errors[0]}）` : ''}`);
    await page.context().close();
  }
  const missing = MOVING.filter((id) => !moved.includes(id));
  check(`${label} ふつう：今までどおり動く`, missing.length === 0, `動いた ${moved.length}（${moved.join(', ')}）${missing.length ? ` 足りない：${missing.join(', ')}` : ''}`);
  return moved;
}

/** 「減らす」の端末：全作品で、知らせ → 動きを見る → 再読み込み → 動きを止める。 */
async function checkReduced(browser, label, works) {
  const stopped = [];
  const moved = [];
  for (const { id, version } of works) {
    const page = await newPage(browser, label, { reducedMotion: 'reduce' });
    await openWork(page, id);
    const shownFirst = await notice(page).isVisible();
    const stillAtFirst = await frameMoves(page, id);
    if (stillAtFirst) stopped.push(id);

    await button(page, SHOW).click();
    await page.locator(`${FRAME}[src$="?motion=1"]`).waitFor({ state: 'attached' });
    const motion = await frameMoves(page, id);
    if (motion) moved.push(id);
    const remembered = await stored(page);

    await page.reload({ waitUntil: 'load' });
    await button(page, STOP).waitFor();
    await page.locator(`${FRAME}[src$="?motion=1"]`).waitFor({ state: 'attached' });
    const motionAgain = await frameMoves(page, id);

    await button(page, STOP).click();
    await page.locator(`${FRAME}[src="/frame/${id}/${version}/desktop.html"], ${FRAME}[src="/frame/${id}/${version}/mobile.html"]`).waitFor({ state: 'attached' });
    const stillAfter = await frameMoves(page, id);
    const cleared = await stored(page);
    const wanted = MOVING.includes(id);
    const ok = shownFirst && remembered === '1' && cleared === null && page.errors.length === 0 && (!wanted || (motion && motionAgain)) && (stillAfter === stillAtFirst);
    check(`${label} 減らす /p/${id}`, ok, `知らせ ${shownFirst}、最初に動く ${stillAtFirst}、見る ${motion}、再読み込み ${motionAgain}、止める ${stillAfter}、覚え ${remembered}→${cleared}、エラー ${page.errors.length}${page.errors.length ? `（${page.errors[0]}）` : ''}`);
    await page.context().close();
  }
  const missing = MOVING.filter((id) => !moved.includes(id));
  check(`${label} 減らす：「動きを見る」で、ふつうの端末で動く作品が全部動く`, missing.length === 0, `最初から動く ${stopped.length}（${stopped.join(', ')}）、見ると動く ${moved.length}（${moved.join(', ')}）${missing.length ? ` 足りない：${missing.join(', ')}` : ''}`);
}

/** WebGL の知らせ。Chromium は本当に WebGL なしで、WebKit は getContext を切って確かめる。 */
async function checkNoWebgl(browser, label, id, how) {
  const page = await newPage(browser, label);
  if (label !== 'chromium') {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...rest);
      };
    });
  }
  await openWork(page, id);
  const real = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'));
  await page.locator('[data-webgl-notice]').waitFor({ timeout: 10_000 });
  const text = await page.locator('[data-webgl-notice]').textContent();
  check(`${label} WebGL なし（${how}） /p/${id}`, !real && text.includes('WebGL') && text.includes('ハードウェア アクセラレーション'), `getContext ${real}、「${text}」`);
  if (TAKE_SHOTS && label === 'chromium') await page.screenshot({ path: join(shots, 'fix-motion-prod-webgl-1440.png') });
  await page.context().close();
}

/** 英語のページ（/en）：知らせとボタンが英語で、動きを見ると枠が動く。 */
async function checkEnglish(browser, label, id) {
  const page = await newPage(browser, label, { locale: 'en-US', reducedMotion: 'reduce' });
  await page.goto(`${BASE}/en/p/${id}`, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
  const shown = await notice(page).textContent();
  await button(page, 'Show motion').click();
  await page.locator(`${FRAME}[src$="?motion=1"]`).waitFor({ state: 'attached' });
  const moves = await frameMoves(page, id);
  const after = await notice(page).textContent();
  await button(page, 'Stop motion').click();
  check(`${label} 英語 /en/p/${id}`, shown.includes('reduce motion') && !/[ぁ-ん]/.test(shown) && !/[ぁ-ん]/.test(after) && moves && page.errors.length === 0, `「${shown}」、動く ${moves}、エラー ${page.errors.length}`);
  await page.context().close();
}

/** 枠の HTML から、作品の CSS（Shadow DOM の中の style）だけを取り出す。 */
const workCss = (html) => /<template shadowrootmode="open"><style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

async function checkFrameRoute({ id, version }) {
  const url = `${BASE}/frame/${id}/${version}/desktop.html`;
  const fromFrame = { 'Sec-Fetch-Dest': 'iframe' };
  const plain = await fetch(url, { headers: fromFrame, redirect: 'manual' });
  const motion = await fetch(`${url}?motion=1`, { headers: fromFrame, redirect: 'manual' });
  const body = await motion.text();
  const same = ['cache-control', 'content-security-policy', 'content-type', 'vary', 'x-content-type-options'].every((name) => plain.headers.get(name) === motion.headers.get(name));
  check('?motion=1 の枠の見出しが同じ', motion.status === 200 && same && motion.headers.get('cache-control') === 'private, no-store' && (motion.headers.get('content-security-policy') ?? '').startsWith('sandbox allow-scripts allow-forms;'), `${motion.status}、${motion.headers.get('cache-control')}`);
  check('?motion=1 の枠は書き換わっている', body.includes('window.matchMedia=') && !/@media[^{]*prefers-reduced-motion/i.test(workCss(body)), `${body.length} 文字`);
  const direct = await fetch(`${url}?motion=1`, { redirect: 'manual' });
  check('?motion=1 でも、枠の外から開くと /p/<id> へ 302', direct.status === 302 && direct.headers.get('location')?.endsWith(`/p/${id}`), `${direct.status}、${direct.headers.get('location')}`);
}

/** 書き方の数と、扱えない書き方が本番の作品にないこと。 */
async function countForms(works) {
  let inCss = 0;
  let inJs = 0;
  const leftovers = [];
  for (const { id, version } of works) {
    const off = await (await fetch(`${BASE}/frame/${id}/${version}/desktop.html`, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).text();
    const on = await (await fetch(`${BASE}/frame/${id}/${version}/desktop.html?motion=1`, { headers: { 'Sec-Fetch-Dest': 'iframe' } })).text();
    inCss += (workCss(off).match(/@media[^{]*prefers-reduced-motion/gi) ?? []).length;
    inJs += (off.match(/matchMedia\([^)]*prefers-reduced-motion/g) ?? []).length;
    if (/prefers-reduced-motion/i.test(workCss(on).replace(/\/\*[\s\S]*?\*\//g, ''))) leftovers.push(id);
  }
  check('本番の作品の CSS に、書き換えた後の残りがない', leftovers.length === 0, `CSS の @media ${inCss} か所、JS の matchMedia ${inJs} か所${leftovers.length ? `、残り：${leftovers.join(', ')}` : ''}`);
}

async function takeShots(browser, label) {
  const page = await newPage(browser, label, { reducedMotion: 'reduce' });
  await openWork(page, 'like-pond');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, 'fix-motion-prod-stopped-1440.png') });
  await button(page, SHOW).click();
  await page.locator(`${FRAME}[src$="?motion=1"]`).waitFor({ state: 'attached' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'fix-motion-prod-shown-1440.png') });
  await page.context().close();
  const phone = await newPage(browser, label, { reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  await openWork(phone, 'like-pond');
  await phone.waitForTimeout(800);
  await phone.screenshot({ path: join(shots, 'fix-motion-prod-stopped-390.png') });
  await phone.context().close();
}

const ONLY = argument('ids')?.split(',');
const works = (await listWorks()).filter((w) => !ONLY || ONLY.includes(w.id));
if (ONLY) MOVING.length = 0; // 手元の見本で試すとき。本番の作品の一覧とは比べない
else check('本番の作品が10', works.length === 10, works.map((w) => `${w.id}@${w.version}`).join(', '));
const browsers = { chromium: await chromium.launch({ args: [NO_ANALYTICS] }), webkit: await webkit.launch() };
try {
  await checkFrameRoute(works[0]);
  await countForms(works);
  for (const [label, browser] of Object.entries(browsers)) {
    await checkNormal(browser, label, works);
    await checkReduced(browser, label, works);
    await checkEnglish(browser, label, ONLY?.[0] ?? MOVING[0]);
  }
  const webglWork = ONLY?.[0] ?? USES_WEBGL[0];
  await checkNoWebgl(browsers.webkit, 'webkit', webglWork, 'getContext を切った');

  const noGpu = await chromium.launch({ args: [NO_ANALYTICS, ...NO_GPU] });
  try {
    await checkNoWebgl(noGpu, 'chromium', webglWork, 'GPU なし');
  } finally {
    await noGpu.close();
  }
  if (TAKE_SHOTS) await takeShots(browsers.chromium, 'chromium');
  check('確かめのブラウザは閲覧数を増やさない', counted.tried > 0 && counted.delivered === 0, `POST /api/count を試み ${counted.tried} 回、届いた ${counted.delivered} 回`);
} finally {
  await Promise.all(Object.values(browsers).map((browser) => browser.close()));
}

console.log(failed === 0 ? '\n全部満たした' : `\n未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
