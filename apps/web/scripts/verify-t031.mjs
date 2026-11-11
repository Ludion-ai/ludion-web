// 本番の URL で、T031 の確かめをする（docs/tasks/T031.md「3」）。npm test には入れない（本番に要求を送るため）。
// node scripts/verify-t031.mjs [--shots] [--prompt-out=<ファイル>]
// 手元のサーバーで試すとき：--base=http://127.0.0.1:4473 --work=fx-toggle
//
// - コピー数と閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。
// - GA4 に混ぜない（SPEC.md「15」）：Chromium は名前の解決で、WebKit は route で止める。
//   gtag.js を読まないので、イベントは window.dataLayer に積まれたまま Google へは行かない。積まれた中身を見て確かめる。
// - --prompt-out：「雪の夜の山小屋に」と書いて「URL で渡す」でコピーした指示文を、そのままファイルに置く（本物の確かめに使う）。
import { chromium, webkit } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');
const argument = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = argument('base') ?? 'https://ludion.ai';
const WORK = argument('work') ?? 'toggle-daylight';
const TAKE_SHOTS = process.argv.includes('--shots');
const PROMPT_OUT = argument('prompt-out');
const NO_ANALYTICS = '--host-resolver-rules=MAP *.googletagmanager.com 127.0.0.1:9, MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9';
const BRIEF = '雪の夜の山小屋に';
const PAGE_CACHE = 'public, max-age=0, s-maxage=60';
const FENCE = '`'.repeat(3);
/** 指示文の URL は、どこで開いても本番のもの */
const codeUrl = (id) => `https://ludion.ai/p/${id}/code`;

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

// ---------------------------------------------------------------- コードを返す口（ブラウザを使わない。GET だけなので数は増えない）

const get = (path, init) => fetch(`${BASE}${path}`, { redirect: 'manual', ...init });
/** 作品のページの HTML の中の JSON から、「コードをコピー」の文字列を取る。 */
async function snippetOfPage(id) {
  const html = await (await get(`/p/${id}`)).text();
  const json = /<script[^>]*id="ld-page"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  return json ? JSON.parse(json).snippet : null;
}

const works = (await (await get('/api/works')).json()).works;
console.log(`作品 ${works.length}件`);
const sizes = [];
for (const { id } of works) {
  const response = await get(`/p/${id}/code`);
  const body = await response.text();
  const snippet = await snippetOfPage(id);
  sizes.push(`${id} ${Math.round(Buffer.byteLength(body) / 1024)}KB`);
  check(
    `/p/${id}/code：200、「コードをコピー」と同じ中身、text/plain、nosniff、作品のページと同じキャッシュ`,
    response.status === 200 &&
      snippet !== null &&
      body === snippet &&
      body.startsWith('<!-- UI by @') &&
      response.headers.get('content-type') === 'text/plain; charset=utf-8' &&
      response.headers.get('x-content-type-options') === 'nosniff' &&
      response.headers.get('cache-control') === PAGE_CACHE &&
      !response.headers.has('set-cookie'),
    `${response.status}、${body.length}文字、${response.headers.get('content-type')}、${response.headers.get('cache-control')}`,
  );
}
console.log(`コードの大きさ：${sizes.join('、')}`);

const missing = await get('/p/nothing-here/code');
check('ない作品は 404。文字で返し、キャッシュしない', missing.status === 404 && missing.headers.get('content-type') === 'text/plain; charset=utf-8' && missing.headers.get('cache-control') === 'private, no-store', `${missing.status}、${missing.headers.get('cache-control')}`);
const english = await get(`/en/p/${WORK}/code`);
check('/en の下には作らない（404）', english.status === 404, String(english.status));
const robots = await (await get('/robots.txt')).text();
check('robots.txt で止めている', robots.split('\n').includes('Disallow: /p/*/code'));

// ---------------------------------------------------------------- シート

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

/** WebKit にはクリップボードの権限を渡せないので、書かれた文字を受け取って見る。 */
function catchClipboard() {
  const write = navigator.clipboard.writeText.bind(navigator.clipboard);
  navigator.clipboard.writeText = async (value) => {
    window.__clipboard = value;
    try {
      await write(value);
    } catch {
      // 受け取れていれば、このスクリプトの確かめには足りる
    }
  };
}

const counts = { tried: 0, delivered: 0 };

async function open(browser, label, path, width, height) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/count') counts.tried += 1;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/count') counts.delivered += 1;
  });
  await page.addInitScript(fillOffscreenCanvas);
  await page.addInitScript(catchClipboard);
  if (label === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/count'] });
  } else {
    await context.route('**/api/count', (route) => route.abort());
    await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
  }
  const response = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  if (response.status() !== 200) throw new Error(`${path}：${response.status()}`);
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
  return page;
}

const openSheet = async (page) => {
  await page.locator('button[aria-haspopup="dialog"]:visible').click();
  await page.locator('dialog[open]').waitFor();
  await page.waitForTimeout(300);
};
const option = (page, mode) => page.locator(`dialog label:has(input[type="radio"][value="${mode}"])`);
const checked = (page) => page.locator('dialog input[type="radio"]:checked').getAttribute('value');
/** 「指示文をコピー」は、シートの中でただ1つの、塗りのボタン */
const copyPrompt = async (page) => {
  await page.evaluate(() => {
    window.__clipboard = undefined;
  });
  await page.locator('dialog button.bg-site-primary').click();
  await page.waitForFunction(() => typeof window.__clipboard === 'string');
  return page.evaluate(() => window.__clipboard);
};
const remixEvents = (page) =>
  page.evaluate(() =>
    (window.dataLayer ?? [])
      .map((entry) => Array.from(entry))
      .filter((args) => args[0] === 'event' && args[1] === 'remix_prompt_copy')
      .map((args) => args[2]),
  );

const browsers = { chromium: await chromium.launch({ args: [NO_ANALYTICS] }), webkit: await webkit.launch() };
const snippet = await snippetOfPage(WORK);

for (const [label, browser] of Object.entries(browsers)) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const name = `${label} ${WORK} ${width}×${height}`;
    const page = await open(browser, label, `/p/${WORK}`, width, height);
    await page.evaluate(() => window.localStorage.removeItem('ld-remix-mode'));
    await openSheet(page);
    check(`${name}：既定は「URL で渡す」`, (await checked(page)) === 'url');
    check(`${name}：選ぶところに、コードの大きさが出ている`, (await option(page, 'full').innerText()).includes(`${Math.max(1, Math.round(Buffer.byteLength(snippet) / 1024))} KB`), (await option(page, 'full').innerText()).replace(/\s+/g, ' '));

    await page.locator('dialog textarea').first().fill(BRIEF);
    const byUrl = await copyPrompt(page);
    check(
      `${name}：「URL で渡す」の指示文は、元のコードの代わりに URL。コードの全文は入らない`,
      byUrl.endsWith(`元のコード：次の URL から取得してください。\n${codeUrl(WORK)}`) && byUrl.includes(`変えたいこと：${BRIEF}`) && byUrl.includes(snippet.split('\n')[0]) && byUrl.includes('Remixed by') && !byUrl.includes(FENCE) && !byUrl.includes('data-ld-part'),
      `${byUrl.length}文字`,
    );
    if (PROMPT_OUT && label === 'chromium' && width === 1440) writeFileSync(PROMPT_OUT, byUrl);
    if (TAKE_SHOTS && label === 'chromium') {
      await page.waitForTimeout(1700); // 「コピーしました」が戻ってから
      await page.screenshot({ path: join(shots, `t031-${width}.png`) });
    }
    if (width === 1440) {
      const [button, sheet] = await page.evaluate(() => [document.querySelector('button[aria-haspopup="dialog"]:not(.lg\\:hidden)').getBoundingClientRect().bottom, document.querySelector('dialog').getBoundingClientRect().top]);
      check(`${name}：シートはボタンのすぐ下（8px）`, sheet === button + 8, `ボタンの下 ${button}、シートの上 ${sheet}`);
    }

    await option(page, 'full').click();
    check(`${name}：「コードを全部入れる」を選べて、その端末に覚える`, (await checked(page)) === 'full' && (await page.evaluate(() => window.localStorage.getItem('ld-remix-mode'))) === 'full');
    const full = await copyPrompt(page);
    check(`${name}：「コードを全部入れる」の指示文は今までの形`, full.endsWith(`元のコード：\n${FENCE}html\n${snippet.trimEnd()}\n${FENCE}`) && !full.includes(codeUrl(WORK)), `${full.length}文字`);
    console.log(`（測るだけ）${name}：指示文の文字数 前（全部入れる）${full.length} → 後（URL で渡す）${byUrl.length}`);

    // イベントは、クリップボードへの書き込みが終わってから積まれる。2つ積まれるのを待つ（来なければ、下の確かめが未達になる）
    await page.waitForFunction(() => (window.dataLayer ?? []).filter((entry) => entry[0] === 'event' && entry[1] === 'remix_prompt_copy').length >= 2, undefined, { timeout: 10_000 }).catch(() => {});
    const events = await remixEvents(page);
    check(`${name}：GA4 の remix_prompt_copy に mode が入る（url、full の順）。入力の中身は入らない`, JSON.stringify(events.map((event) => event.mode)) === '["url","full"]' && !JSON.stringify(events).includes(BRIEF), JSON.stringify(events));

    // 読み込み直しても覚えている。終わりに既定へ戻す
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
    await openSheet(page);
    check(`${name}：読み込み直しても「コードを全部入れる」のまま`, (await checked(page)) === 'full');
    await option(page, 'url').click();
    check(`${name}：「URL で渡す」に戻せる`, (await checked(page)) === 'url' && (await page.evaluate(() => window.localStorage.getItem('ld-remix-mode'))) === 'url');
    await page.context().close();
  }
}

// 英語のページ
{
  const page = await open(browsers.chromium, 'chromium', `/en/p/${WORK}`, 1440, 900);
  await openSheet(page);
  const byUrl = await copyPrompt(page);
  check('英語のページ：URL の形の指示文も英語', byUrl.endsWith(`Original code: Fetch it from this URL.\n${codeUrl(WORK)}`) && !/[぀-ヿ一-鿿]/.test(byUrl), `${byUrl.length}文字`);
  await page.context().close();
}

await Promise.all(Object.values(browsers).map((browser) => browser.close()));
check('/api/count は1回も届いていない（本番の数を増やしていない）', counts.delivered === 0, `送ろうとした ${counts.tried}回、届いた ${counts.delivered}回`);
console.log(failed === 0 ? '全部満たした' : `未達 ${failed}件`);
process.exit(failed === 0 ? 0 : 1);
