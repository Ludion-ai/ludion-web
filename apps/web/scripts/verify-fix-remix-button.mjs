// 本番の URL で、FIX-remix-button の確かめをする（docs/tasks/FIX-remix-button.md）。npm test には入れない（本番に要求を送るため）。
// node scripts/verify-fix-remix-button.mjs [--shots]
// 手元のサーバーで試すとき：--base=http://127.0.0.1:4178 --ids=fx-toggle,fx-motion
//
// - 閲覧数とコピー数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。
// - GA4 に混ぜない（SPEC.md「15」）：Chromium は名前の解決で、WebKit は route で止める。
// - 押さない。本番のデータを変えない。座標を読むだけ。
import { chromium, webkit } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');
const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = argument('base') ?? 'https://ludion.ai';
const TAKE_SHOTS = process.argv.includes('--shots');
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const SCROLLS = [0, 40, 80, 120, 160, 200, 240, 320, 400, 480, 640, 800, 1000];
/** 幅390の2つが「最初の画面に入るか」を測る大きさ。390×600 は、ブラウザの枠がもっと大きい端末（測るだけで、合否に入れない） */
const PHONES = [
  [390, 844],
  [390, 664],
  [390, 600],
];

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

const counts = { tried: 0, delivered: 0 };

async function open(browser, label, id, width, height, options = {}) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1, ...options });
  const page = await context.newPage();
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/count') counts.tried += 1;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/count') counts.delivered += 1;
  });
  await page.addInitScript(fillOffscreenCanvas);
  if (label === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/count'] });
  } else {
    await context.route('**/api/count', (route) => route.abort());
    await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
  }
  const response = await page.goto(`${BASE}/p/${id}`, { waitUntil: 'load' });
  if (response.status() !== 200) throw new Error(`/p/${id}：${response.status()}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
  return page;
}

const boxes = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    const remix = [...document.querySelectorAll('button[aria-haspopup="dialog"]')].find((el) => el.getBoundingClientRect().height > 0);
    const frame = document.querySelector('iframe[data-ld-frame]').parentElement;
    const replay = frame.querySelector('button');
    const tabs = [...document.querySelectorAll('nav')]
      .filter((nav) => getComputedStyle(nav).position === 'fixed')
      .flatMap((nav) => [...nav.querySelectorAll('a')])
      .filter((link) => link.getBoundingClientRect().height > 0);
    return {
      remix: box(remix),
      position: getComputedStyle(remix).position,
      frame: box(frame),
      replay: replay ? box(replay) : null,
      tabs: tabs.map(box),
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    };
  });

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const scrollTo = (page, y) =>
  page.evaluate(async (top) => {
    window.scrollTo({ top, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, y);

/**
 * 送りながら重なりを数える。
 * passes：下のタブの後ろを「通るだけ」か。ページの中の位置が変わらず（留まらない）、重なるのは続いた1つの区間だけで、最後の位置では重なっていない。
 */
async function walk(page) {
  const first = await boxes(page);
  const documentTop = first.remix.top + first.scrollY;
  const seen = { frame: [], replay: [], tabs: [], moved: [], stayed: [] };
  const behindTabs = [];
  for (const y of [...SCROLLS, first.maxScroll]) {
    await scrollTo(page, y);
    const now = await boxes(page);
    const behind = now.tabs.some((tab) => overlaps(now.remix, tab));
    if (overlaps(now.remix, now.frame)) seen.frame.push(now.scrollY);
    if (now.replay && overlaps(now.remix, now.replay)) seen.replay.push(now.scrollY);
    if (behind) seen.tabs.push(now.scrollY);
    if (now.remix.top - now.frame.bottom !== 12) seen.moved.push(now.scrollY);
    if (Math.abs(now.remix.top + now.scrollY - documentTop) >= 0.5) seen.stayed.push(now.scrollY);
    behindTabs.push(behind);
  }
  await scrollTo(page, 0);
  const runs = behindTabs.filter((on, i) => on && !behindTabs[i - 1]).length;
  const passes = first.position === 'static' && seen.stayed.length === 0 && runs <= 1 && behindTabs.at(-1) === false;
  return { first, ...seen, passes };
}

const list = (values) => (values.length ? `y=${values.join(',')}` : 'なし');

const ids = argument('ids')?.split(',') ?? (await (await fetch(`${BASE}/api/works`)).json()).works.map((work) => work.id);
console.log(`作品 ${ids.length}件：${ids.join(', ')}`);

const browsers = { chromium: await chromium.launch({ args: [NO_ANALYTICS] }), webkit: await webkit.launch() };
const measured = [];
for (const [label, browser] of Object.entries(browsers)) {
  for (const id of ids) {
    for (const [width, height] of PHONES) {
      const page = await open(browser, label, id, width, height);
      const { first, frame, replay, tabs, moved, stayed, passes } = await walk(page);
      const tabsTop = height - 64;
      const fits = first.remix.bottom <= tabsTop;
      // 枠が画面より長い作品：最初の画面で、枠の下の端が下のタブの上端より下にある
      const longFrame = first.frame.bottom > tabsTop;
      measured.push({ label, id, size: `${width}×${height}`, top: first.remix.top, bottom: first.remix.bottom, tabsTop, fits });
      const name = `${label} ${id} ${width}×${height}`;
      check(`${name}：枠に重ならない`, frame.length === 0, list(frame));
      check(`${name}：「もう一度」に重ならない`, replay.length === 0, first.replay ? list(replay) : 'ボタンなし');
      check(`${name}：枠のすぐ下（12px）で、送っても離れない`, moved.length === 0 && first.position === 'static', `position: ${first.position}${moved.length ? `、離れた ${list(moved)}` : ''}`);
      if (height < 664) console.log(`（測るだけ）${name}：下のタブとの重なり ${list(tabs)}`);
      // 枠が画面より長い作品は、送る途中で下のタブの後ろを通る。留まらなければよい（11/10 の CTO の決定）
      else if (longFrame) check(`${name}：枠が画面より長い。下のタブの後ろは通るだけで、留まらない`, passes, `通った ${list(tabs)}${stayed.length ? `、留まった ${list(stayed)}` : ''}`);
      else check(`${name}：下のタブに重ならない`, tabs.length === 0, list(tabs));
      await page.context().close();
    }
  }
}

// 幅768と1440は、住人のいるスイッチだけ（どの作品でも形は同じ）
for (const [label, browser] of Object.entries(browsers)) {
  for (const [width, height] of [
    [768, 1024],
    [1440, 900],
  ]) {
    const id = ids.includes('toggle-daylight') ? 'toggle-daylight' : ids[0];
    const page = await open(browser, label, id, width, height);
    const { first, frame, replay, tabs } = await walk(page);
    check(`${label} ${id} ${width}×${height}：枠にも「もう一度」にも下のタブにも重ならない`, frame.length + replay.length + tabs.length === 0, `枠 ${list(frame)}、もう一度 ${list(replay)}、タブ ${list(tabs)}（ボタン y=${first.remix.top}〜${first.remix.bottom}）`);
    if (TAKE_SHOTS && label === 'chromium') await page.screenshot({ path: join(shots, `fix-remix-button-${width}.png`) });
    await page.context().close();
  }
}

// 最初の画面に入るか（docs/tasks/FIX-remix-button.md「直し方」）
console.log('\n最初の画面（ボタンの下端と、下のタブの上端）');
for (const row of measured) console.log(`${row.fits ? '入る　' : '入らない'} ${row.label} ${row.id} ${row.size}：ボタン y=${row.top}〜${row.bottom}、タブの上端 ${row.tabsTop}`);

// 「動きを減らす」の端末は、枠の上に知らせが出るぶん下がる
for (const [label, browser] of Object.entries(browsers)) {
  for (const [width, height] of PHONES.slice(0, 2)) {
    const id = ids.includes('toggle-daylight') ? 'toggle-daylight' : ids[0];
    const page = await open(browser, label, id, width, height, { reducedMotion: 'reduce' });
    const { remix } = await boxes(page);
    console.log(`（測るだけ）動きを減らす ${label} ${id} ${width}×${height}：ボタン y=${remix.top}〜${remix.bottom}、タブの上端 ${height - 64}`);
    await page.context().close();
  }
}

if (TAKE_SHOTS) {
  const id = ids.includes('toggle-daylight') ? 'toggle-daylight' : ids[0];
  for (const [width, height] of PHONES.slice(0, 2)) {
    const page = await open(browsers.chromium, 'chromium', id, width, height);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(shots, `fix-remix-button-${width}x${height}.png`) });
    await scrollTo(page, 240);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(shots, `fix-remix-button-${width}x${height}-scrolled.png`) });
    await page.context().close();
  }
}

await Promise.all(Object.values(browsers).map((browser) => browser.close()));
check('/api/count は1回も届いていない（本番の数を増やしていない）', counts.delivered === 0, `送ろうとした ${counts.tried}回、届いた ${counts.delivered}回`);
console.log(failed === 0 ? '全部満たした' : `未達 ${failed}件`);
process.exit(failed === 0 ? 0 : 1);
