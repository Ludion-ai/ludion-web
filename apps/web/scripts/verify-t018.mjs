// T018 の確かめ（本番）：作品のページ（幅390）の並び、たたみ、共有、コピー、GA4 のイベントを、本物の gtag.js で確かめる。
// node scripts/verify-t018.mjs [作品の id]
//
// - 数を水増ししない（CLAUDE.md 原則10）：POST /api/count を止める。GA4 の collect も、送ろうとしたところを見て、Google には届けない。
//   だから閲覧数にも、GA4 の「アクティブ ユーザーあたりの表示回数」（T018 の合否）にも混ざらない。
// - 本番の D1 に何も書かない。しおりはログインしていないので、GitHub のログインへ移るだけ。
// - Chromium の collect は NetLog で見る：Playwright の割り込み（route）や request のイベントは、ページを移る直前に送られた要求を見落とす。
//   Google の名前は届かない宛先に向ける。割り込みを使わないので、/api/count は CDP で止める。
// - WebKit には NetLog がないので、route で受ける。ただし移る直前の要求は route に見えないので、
//   select_work と save_click は fetch と sendBeacon の呼び出しを localStorage に残して、Google へは送らない。ludion.ai で読む（robots.txt なら閲覧数は増えない）。
// - Playwright の Windows 版 WebKit には OffscreenCanvas がない（本物の Safari は 16.4 から持つ）。verify-prod.mjs と同じく補う。
import { chromium, webkit } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROD = 'https://ludion.ai';
const WORK = process.argv[2] ?? 'toggle-daylight';
const VIEWPORT = { width: 390, height: 844 };
/** gtag.js が届き、最初の page_view を送るまでの待ち（人が読んでから押すのと同じ）。 */
const READ_MS = 3000;
/** gtag.js はイベントをまとめて送るので、送り終わるまでの待ち。 */
const FLUSH_MS = 6000;
const GOOGLE_COLLECT = /google-analytics\.com|analytics\.google\.com/;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'NG  '} ${name}${detail ? `  （${detail}）` : ''}`);
}

const { works } = await (await fetch(`${PROD}/api/works`)).json();
const self = works.find((work) => work.id === WORK);
if (!self) throw new Error(`作品がない：${WORK}`);
const rest = works.filter((work) => work.id !== WORK);
const same = rest.filter((work) => work.creator.handle === self.creator.handle).map((work) => `/p/${work.id}`);
const other = rest.filter((work) => work.creator.handle !== self.creator.handle).map((work) => `/p/${work.id}`);
console.log(`承認済み ${works.length}作品（同じ作者のほか ${same.length}、ほかの作者 ${other.length}）`);

/** collect の URL と本文の行から、イベントを読む。 */
function eventsOf(url, body = '') {
  const shared = Object.fromEntries(new URL(url).searchParams);
  const lines = body.split('\n').filter(Boolean);
  const hits = lines.length > 0 ? lines.map((line) => ({ ...shared, ...Object.fromEntries(new URLSearchParams(line)) })) : [shared];
  return hits.filter((hit) => hit.en);
}

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
 * ページが離れる直前の collect を localStorage に残し、Google へは送らない（WebKit の select_work と save_click のため）。
 * 移る直前の要求は route に見えず、止められずに届くことがある（docs/reports/T016.md。名前の解決で止める手は WebKit にない）。
 */
function logCollectToStorage() {
  if (location.hostname !== 'ludion.ai' || window.top !== window) return;
  const log = (url, body) => {
    const list = JSON.parse(localStorage.getItem('__t018') ?? '[]');
    list.push(`${url}\n${typeof body === 'string' ? body : ''}`);
    localStorage.setItem('__t018', JSON.stringify(list));
  };
  const isCollect = (url) => /google-analytics\.com|analytics\.google\.com/.test(url);
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(input?.url ?? input);
    if (!isCollect(url)) return originalFetch(input, init);
    log(url, init?.body);
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  const originalBeacon = navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon = (url, data) => {
    if (!isCollect(String(url))) return originalBeacon(url, data);
    log(String(url), data);
    return true;
  };
}

/** logCollectToStorage が残したものを読んで、消す。 */
async function readLoggedCollect(page, seen) {
  const logged = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('__t018') ?? '[]');
    localStorage.removeItem('__t018');
    return list;
  });
  for (const entry of logged) {
    const [url, ...body] = entry.split('\n');
    seen.hits.push(...eventsOf(url, body.join('\n')));
  }
}

async function launch(browserName) {
  if (browserName === 'webkit') return { browser: await webkit.launch(), netlog: null };
  const dir = mkdtempSync(join(tmpdir(), 'ld-t018-'));
  const netlog = join(dir, 'netlog.json');
  const browser = await chromium.launch({
    args: [`--log-net-log=${netlog}`, '--net-log-capture-mode=Everything', '--host-resolver-rules=MAP *.google-analytics.com 127.0.0.1:9, MAP *.analytics.google.com 127.0.0.1:9, MAP analytics.google.com 127.0.0.1:9'],
  });
  return { browser, netlog, dir };
}

async function newPage(browser, browserName, seen) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: VIEWPORT, deviceScaleFactor: 1, ...(browserName === 'chromium' ? { permissions: ['clipboard-read', 'clipboard-write'] } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/count') seen.countTried += 1;
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/count') seen.countDelivered += 1;
  });
  if (browserName === 'webkit') await page.addInitScript(fillOffscreenCanvas);
  if (browserName === 'chromium') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', { urls: ['*/api/count*'] });
  } else {
    await context.route('**/api/count', (route) => route.abort());
    await context.route(GOOGLE_COLLECT, (route) => {
      seen.hits.push(...eventsOf(route.request().url(), route.request().postData() ?? ''));
      return route.fulfill({ status: 204 });
    });
  }
  return { context, page, errors };
}

async function open(page) {
  const response = await page.goto(`${PROD}/p/${WORK}`, { waitUntil: 'load' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));
  return response;
}

for (const browserName of ['chromium', 'webkit']) {
  console.log(`\n--- ${browserName}（幅${VIEWPORT.width}）`);
  const { browser, netlog, dir } = await launch(browserName);
  const seen = { hits: [], countTried: 0, countDelivered: 0 };

  // 並び、たたみ、コピー
  {
    const { context, page, errors } = await newPage(browser, browserName, seen);
    const response = await open(page);
    check('作品のページが 200', response.status() === 200, String(response.status()));

    await page.locator('[data-masonry][data-placed]').first().waitFor({ state: 'attached' });
    const lists = await page.locator('[data-masonry]').evaluateAll((grids) => grids.map((grid) => [...grid.querySelectorAll(':scope > article > a')].map((a) => a.getAttribute('href'))));
    check('ほかの作品が全部、同じ作者が先で Popular の順に並ぶ', JSON.stringify(lists.flat()) === JSON.stringify([...same, ...other]), `${lists.flat().length}枚`);
    const headings = await page.locator('section > h2').allTextContents();
    const expected = [...(same.length ? [`@${self.creator.handle} のほかの作品`] : []), ...(other.length ? ['ほかの作品'] : [])];
    check('見出し', JSON.stringify(headings) === JSON.stringify(expected), headings.join('、'));

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastLoaded = await page
      .waitForFunction(() => {
        const images = [...document.querySelectorAll('[data-masonry] > article > a > img')];
        return images.at(-1)?.complete && images.at(-1).naturalWidth > 0;
      }, null, { timeout: 15000 })
      .then(() => true, () => false);
    check('最後のカードの画像が読める', lastLoaded);
    const bottoms = await page.evaluate(() => ({
      card: Math.max(...[...document.querySelectorAll('article')].map((card) => card.getBoundingClientRect().bottom)),
      tabs: Math.min(...[...document.querySelectorAll('nav[aria-label="メイン"] a')].map((tab) => tab.getBoundingClientRect()).filter((box) => box.height > 0).map((box) => box.top)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    check('下のタブが最後のカードを隠さない', bottoms.card <= bottoms.tabs, `カードの下 ${Math.round(bottoms.card)}、タブの上 ${Math.round(bottoms.tabs)}`);
    check('横のはみ出しなし', bottoms.overflow <= 0, `${bottoms.overflow}px`);

    const code = page.locator('pre');
    const toggle = page.getByRole('button', { name: /^コードを(全部見る|たたむ)$/ });
    const collapsed = (await code.boundingBox()).height;
    check('コードの箱：たたんで3行（74px）', collapsed === 74, `${collapsed}px`);
    check('コードの箱：aria-expanded=false', (await toggle.getAttribute('aria-expanded')) === 'false');
    await toggle.click();
    const opened = (await code.boundingBox()).height;
    check('コードの箱：開く', (await toggle.getAttribute('aria-expanded')) === 'true' && opened > 74 && opened <= 320, `${opened}px`);
    await toggle.click();
    check('コードの箱：たたむ', (await code.boundingBox()).height === 74 && (await toggle.getAttribute('aria-expanded')) === 'false');

    const copied = page.getByRole('button', { name: /^(コピーしました|コピーできませんでした)$/ });
    await page.getByRole('button', { name: 'コードをコピー' }).click();
    await copied.waitFor();
    const label = await copied.textContent();
    check('コードをコピー：コピーできた', label === 'コピーしました', label);
    if (browserName === 'chromium') {
      const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
      const embedded = JSON.parse(await page.locator('#ld-page').textContent()).snippet;
      check('たたんだままで全部をコピーした。1行目はクレジット行', clipboard === embedded && clipboard.startsWith(`<!-- UI by @${self.creator.handle} — ludion.ai/p/${WORK} (MIT)`), `${clipboard.length}文字`);
    } else {
      console.log('     （WebKit ではクリップボードを読めないので、中身は Chromium だけで見る）');
    }
    check('ページのエラーなし', errors.length === 0, errors.join(' / '));
    await page.waitForTimeout(FLUSH_MS);
    await context.close();
  }

  // 共有：navigator.share
  {
    const { context, page } = await newPage(browser, browserName, seen);
    await page.addInitScript(() => {
      window.__shared = [];
      navigator.share = async (data) => {
        window.__shared.push(data);
      };
    });
    await open(page);
    await page.getByRole('button', { name: '共有', exact: true }).click();
    const shared = await page.evaluate(() => window.__shared);
    check('共有：navigator.share に題名と URL', shared.length === 1 && shared[0].url === `${PROD}/p/${WORK}` && shared[0].title === self.title, JSON.stringify(shared[0]));
    await page.waitForTimeout(FLUSH_MS);
    await context.close();
  }

  // 共有：使えないブラウザ
  {
    const { context, page } = await newPage(browser, browserName, seen);
    await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }));
    await open(page);
    await page.getByRole('button', { name: '共有', exact: true }).click();
    const label = page.getByRole('button', { name: /^(リンクをコピーしました|コピーできませんでした)$/ });
    await label.waitFor();
    const text = await label.textContent();
    check('共有：クリップボードに入れ「リンクをコピーしました」', text === 'リンクをコピーしました', text);
    if (browserName === 'chromium') check('共有：クリップボードの中身', (await page.evaluate(() => navigator.clipboard.readText())) === `${PROD}/p/${WORK}`);
    const back = await page.getByRole('button', { name: '共有', exact: true }).waitFor({ timeout: 3000 }).then(() => true, () => false);
    check('共有：文字が元に戻る', back);
    await page.waitForTimeout(FLUSH_MS);
    await context.close();
  }

  // select_work：読み込み直して移る直前のイベント
  let selected;
  {
    const { context, page } = await newPage(browser, browserName, seen);
    if (browserName === 'webkit') await page.addInitScript(logCollectToStorage);
    await open(page);
    await page.waitForTimeout(READ_MS);
    const card = page.locator('[data-masonry][data-placed] > article > a').first();
    selected = (await card.getAttribute('href')).replace('/p/', '');
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await page.waitForURL(`${PROD}/p/${selected}`);
    await page.waitForTimeout(FLUSH_MS);
    if (browserName === 'webkit') await readLoggedCollect(page, seen);
    await context.close();
  }

  // save_click：ログインしていない人が押すと、GitHub のログインへ移る
  {
    const { context, page } = await newPage(browser, browserName, seen);
    if (browserName === 'webkit') await page.addInitScript(logCollectToStorage);
    await open(page);
    await page.waitForTimeout(READ_MS);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForURL(/github\.com\/login/, { timeout: 15000 });
    check('ログインしていない人のしおりは GitHub のログインへ', true);
    await page.waitForTimeout(FLUSH_MS);
    if (browserName === 'webkit') {
      await page.goto(`${PROD}/robots.txt`);
      await readLoggedCollect(page, seen);
    }
    await context.close();
  }

  await browser.close();

  if (netlog) {
    const text = readFileSync(netlog, 'utf8');
    const urls = new Set([...text.matchAll(/"url":"(https:\/\/[^"]*(?:google-analytics\.com|analytics\.google\.com)[^"]*collect[^"]*)"/g)].map((match) => match[1]));
    for (const url of urls) seen.hits.push(...eventsOf(url));
    rmSync(dir, { recursive: true, force: true });
  }

  const hit = (name, match = () => true) => seen.hits.find((event) => event.en === name && match(event));
  const names = [...new Set(seen.hits.map((event) => event.en))].join(',');
  const show = (event) => (event ? Object.entries(event).filter(([key]) => key.startsWith('ep.')).map(([key, value]) => `${key.slice(3)}=${value}`).join(' ') : `見えたもの：${names}`);

  const copyHit = hit('copy_code', (event) => event['ep.work_id'] === WORK);
  check('collect に copy_code', Boolean(copyHit), show(copyHit));
  const nativeHit = hit('share', (event) => event['ep.work_id'] === WORK && event['ep.method'] === 'native');
  check('collect に share（native）', Boolean(nativeHit), show(nativeHit));
  const clipboardHit = hit('share', (event) => event['ep.work_id'] === WORK && event['ep.method'] === 'clipboard');
  check('collect に share（clipboard）', Boolean(clipboardHit), show(clipboardHit));
  const selectHit = hit('select_work', (event) => event['ep.from_work_id'] === WORK && event['ep.to_work_id'] === selected);
  check('collect に select_work（移る直前）', Boolean(selectHit), show(selectHit));
  const saveHit = hit('save_click', (event) => event['ep.work_id'] === WORK);
  check('collect に save_click（ログインへ移る直前）', Boolean(saveHit), show(saveHit));

  const ours = seen.hits.filter((event) => ['share', 'copy_code', 'save_click', 'select_work'].includes(event.en));
  const leaked = [...new Set(ours.flatMap((event) => Object.keys(event).filter((key) => /^(ep|epn|up|upn)\./.test(key) && !/\.(work_id|method|from_work_id|to_work_id)$/.test(key))))];
  check('送る値は決めたものだけ（原則6）', leaked.length === 0, leaked.join(','));
  check('本番の閲覧数を増やさない（POST /api/count を試みて、届いていない）', seen.countTried > 0 && seen.countDelivered === 0, `試み ${seen.countTried} 回、届いた ${seen.countDelivered} 回`);
}

console.log(failures === 0 ? '\n全部通った' : `\n未達 ${failures}件`);
process.exit(failures === 0 ? 0 : 1);
