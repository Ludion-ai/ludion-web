// T016 の確かめ（本番）：/privacy と /about、導線、キャッシュ、head、sitemap、GA4 の読み込み、Cloudflare のビーコン。
// node scripts/verify-t016.mjs            本番を確かめ、スクリーンショットを docs/screens/t016-*.png に撮る
// BASE_URL=http://localhost:4173 node scripts/verify-t016.mjs --local  手元（本番だけのものを飛ばす。撮らない）
//
// - 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。
// - GA4 に確かめの閲覧を混ぜない（docs/tasks/T016.md「2.5」）：gtag.js を読ませない。読もうとしたことだけを記録する。
//   gtag.js がなければ collect は出ないので、ページを移る直前の要求も出ない。
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const local = process.argv.includes('--local');
const PROD = 'https://ludion.ai';
const WORKERS_DEV = 'https://ludion-web.ludion.workers.dev';
const BASE = process.env.BASE_URL ?? PROD;
const PAGE_CACHE = 'public, max-age=0, s-maxage=60';
const USER_AGENT = 'ludion-verify-t016';
const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

const get = (url, init = {}) => fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });

async function checkResponses() {
  for (const path of ['/privacy', '/about']) {
    const response = await get(`${BASE}${path}`);
    const html = await response.text();
    check(`${path} が 200`, response.status === 200, String(response.status));
    check(`${path} のキャッシュが許可どおり`, response.headers.get('cache-control') === PAGE_CACHE && !response.headers.get('cache-tag') && !response.headers.get('set-cookie'),
      `${response.headers.get('cache-control')}、札 ${response.headers.get('cache-tag')}、cf-cache-status=${response.headers.get('cf-cache-status')}`);
    check(`${path} の canonical`, html.includes(`<link rel="canonical" href="${PROD}${path}">`));
  }
  if (!local) {
    // 1回目は MISS。温めてから当たること
    let status = '';
    for (let index = 0; index < 6 && status !== 'HIT'; index += 1) {
      const response = await get(`${BASE}/privacy`);
      await response.text();
      status = response.headers.get('cf-cache-status') ?? '';
      if (status !== 'HIT') await new Promise((done) => setTimeout(done, 500));
    }
    check('/privacy がキャッシュに当たる', status === 'HIT', status);
  }
}

async function checkRobotsAndSitemap() {
  const robots = await (await get(`${BASE}/robots.txt`)).text();
  check('robots.txt で /privacy と /about を止めていない', !/Disallow:\s*\/(privacy|about)/.test(robots));
  check('robots.txt が sitemap を指す', robots.includes(`Sitemap: ${PROD}/sitemap.xml`));

  const response = await get(`${BASE}/sitemap.xml`);
  const xml = await response.text();
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
  const { works } = await (await get(`${BASE}/api/works`)).json();
  const handles = [...new Set(works.map((work) => work.creator.handle))];
  const expected = ['/', '/about', '/privacy', ...works.map((work) => `/p/${work.id}`), ...handles.map((handle) => `/c/${handle}`)].map((path) => `${PROD}${path}`).toSorted();
  check('/sitemap.xml が 200 で XML', response.status === 200 && response.headers.get('content-type')?.includes('application/xml'), `${response.status} ${response.headers.get('content-type')}`);
  // Cache-Tag は本番では客に見えない（T012）。手元では札の値を、本番では指示とキャッシュに当たることを見る
  if (local) check('/sitemap.xml の札が catalog', response.headers.get('cache-tag') === 'catalog' && response.headers.get('cache-control') === PAGE_CACHE, `${response.headers.get('cache-control')}、札 ${response.headers.get('cache-tag')}`);
  else {
    let status = '';
    for (let index = 0; index < 6 && status !== 'HIT'; index += 1) {
      const again = await get(`${BASE}/sitemap.xml`);
      await again.text();
      status = again.headers.get('cf-cache-status') ?? '';
      if (status !== 'HIT') await new Promise((done) => setTimeout(done, 500));
    }
    check('/sitemap.xml がキャッシュに当たる', response.headers.get('cache-control') === PAGE_CACHE && status === 'HIT', `${response.headers.get('cache-control')}、${status}`);
  }
  check('/sitemap.xml の URL が、承認済みの作品と作り手とちょうど一致する', JSON.stringify(locs.toSorted()) === JSON.stringify(expected), `${locs.length} 件（作品 ${works.length}、作り手 ${handles.length}）`);
  return works;
}

async function checkHead(works) {
  const html = await (await get(`${BASE}/`)).text();
  const head = html.slice(0, html.indexOf('</head>'));
  for (const [label, pattern] of [
    ['<title>', /<title>[^<]{5,}<\/title>/],
    ['description', /<meta name="description" content="[^"]{20,}"/],
    ['og:title', /<meta property="og:title" content="[^"]+"/],
    ['og:description', /<meta property="og:description" content="[^"]+"/],
    ['og:image', /<meta property="og:image" content="[^"]*\/og-home\.png"/],
    ['twitter:card', /<meta name="twitter:card" content="summary_large_image"/],
    ['canonical', new RegExp(`<link rel="canonical" href="${PROD}/">`)],
  ]) check(`ホームの ${label}`, pattern.test(head));
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(head)?.[1] ?? '[]');
  check('ホームの JSON-LD', data.some((item) => item['@type'] === 'WebSite') && data.some((item) => item['@type'] === 'Organization' && item.sameAs?.includes('https://x.com/Lattice_Node')), data.map((item) => item['@type']).join('、'));

  const image = await get(new URL('/og-home.png', BASE));
  const bytes = Buffer.from(await image.arrayBuffer());
  check('/og-home.png が 1200×630 の PNG', image.status === 200 && bytes.readUInt32BE(16) === 1200 && bytes.readUInt32BE(20) === 630, `${image.status}、${Math.round(bytes.length / 1024)}KB`);
  check('/logo.png が 200', (await get(new URL('/logo.png', BASE))).status === 200);

  const [work] = works;
  const handle = work.creator.handle;
  const origins = local ? [BASE] : [PROD, WORKERS_DEV];
  for (const origin of origins) {
    const workHtml = await (await get(`${origin}/p/${work.id}`)).text();
    check(`${origin} の作品のページの canonical は ludion.ai`, workHtml.includes(`<link rel="canonical" href="${PROD}/p/${work.id}">`));
    const creatorHtml = await (await get(`${origin}/c/${handle}`)).text();
    check(`${origin} の作り手のページの canonical は ludion.ai`, creatorHtml.includes(`<link rel="canonical" href="${PROD}/c/${handle}">`));
  }
}

async function newContext(browser, width, height, seen) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/api/count', (route) => route.abort());
  await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => {
    seen.google.push(route.request().url());
    return route.abort();
  });
  await context.route(/static\.cloudflareinsights\.com/, (route) => {
    seen.beacon.push(route.request().url());
    return route.abort();
  });
  return context;
}

const hydrated = (page) => page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));

async function checkPages(browser, works) {
  const seen = { google: [], beacon: [] };
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await newContext(browser, width, height, seen);
    const page = await context.newPage();
    for (const [path, name] of [['/privacy', 'privacy'], ['/about', 'about']]) {
      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await hydrated(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${path} 幅${width}：横スクロールなし`, response.status() === 200 && overflow <= 0, `${response.status()}、はみ出し ${overflow}px`);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      check(`${path} 幅${width}：axe の critical と serious が0`, blocking.length === 0, `違反 ${violations.length}、critical+serious ${blocking.length}${blocking.map((v) => ` ${v.id}`).join('')}`);
      if (!local) await page.screenshot({ path: join(shots, `t016-${name}-${width}.png`), fullPage: true });
    }
    await context.close();
  }

  const [work] = works;
  const from = ['/', `/p/${work.id}`, `/c/${work.creator.handle}`, '/nothing-here', '/privacy', '/about'];
  const links = [['プライバシー', '/privacy'], ['運営者', '/about']];

  const wide = await newContext(browser, 1440, 900, seen);
  const widePage = await wide.newPage();
  for (const path of from) {
    for (const [name, url] of links) {
      await widePage.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await widePage.getByRole('navigation', { name: 'サイトの情報' }).getByRole('link', { name, exact: true }).click();
      await widePage.waitForURL(`${BASE}${url}`);
      check(`幅1440 ${path} → ${name}（1回）`, new URL(widePage.url()).pathname === url);
    }
  }
  if (!local) {
    await widePage.goto(`${BASE}/`, { waitUntil: 'load' });
    await widePage.screenshot({ path: join(shots, 't016-home-1440.png') });
  }
  await wide.close();

  const narrow = await newContext(browser, 390, 844, seen);
  const narrowPage = await narrow.newPage();
  for (const path of from) {
    for (const [name, url] of links) {
      await narrowPage.goto(`${BASE}${path}`, { waitUntil: 'load' });
      await hydrated(narrowPage);
      await narrowPage.getByRole('button', { name: 'メニュー' }).click();
      await narrowPage.getByRole('menuitem', { name }).click();
      await narrowPage.waitForURL(`${BASE}${url}`);
      check(`幅390 ${path} → ${name}（2回。ログインなし）`, new URL(narrowPage.url()).pathname === url);
    }
  }
  if (!local) {
    await narrowPage.goto(`${BASE}/`, { waitUntil: 'load' });
    await hydrated(narrowPage);
    await narrowPage.getByRole('button', { name: 'メニュー' }).click();
    await narrowPage.getByRole('menu').waitFor();
    await narrowPage.screenshot({ path: join(shots, 't016-home-390-menu.png') });
  }
  await narrow.close();

  // gtag.js は load の後に読むので、少し待つ
  const final = await newContext(browser, 1280, 800, seen);
  const finalPage = await final.newPage();
  const beforeGoogle = seen.google.length;
  const beforeBeacon = seen.beacon.length;
  await finalPage.goto(`${BASE}/`, { waitUntil: 'load' });
  await finalPage.waitForTimeout(2000);
  const inHtml = await finalPage.evaluate(() => document.documentElement.outerHTML.includes('cloudflareinsights'));
  const google = seen.google.slice(beforeGoogle);
  if (local) check('手元のビルドでは gtag.js を読まない', seen.google.length === 0, `${seen.google.length} 回`);
  else check('本番の / は gtag.js を読む（デプロイの印が効いている。ここでは止めて、送らない）', google.some((url) => url.includes('googletagmanager.com/gtag/js')), google.join('、'));
  const beacon = seen.beacon.slice(beforeBeacon);
  console.log(`${beacon.length === 0 && !inHtml ? '読まれていない' : '読まれている　'} Cloudflare のビーコン static.cloudflareinsights.com/beacon.min.js：要求 ${beacon.length} 回、HTML に ${inHtml ? 'ある' : 'ない'}（全部のページで ${seen.beacon.length} 回）`);
  await final.close();
}

const browser = await chromium.launch();
try {
  await checkResponses();
  const works = await checkRobotsAndSitemap();
  await checkHead(works);
  await checkPages(browser, works);
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\n全部満たした' : `\n未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
