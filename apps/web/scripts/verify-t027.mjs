// T027 の確かめ（本番）：/terms、/privacy の問い合わせ先、作品の「問題を報告」、導線。
// node scripts/verify-t027.mjs
// BASE_URL=http://127.0.0.1:4710 node scripts/verify-t027.mjs --local
//
// 閲覧数を増やさない（CLAUDE.md 原則10）：POST /api/count を止める。
// GA4 に確かめの閲覧を混ぜない：gtag.js を読ませない。
import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
  configFile: false,
  root: webDir,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
});
let copy;
let copyEn;
let SUPPORT_EMAIL;
try {
  ({ copy } = await vite.ssrLoadModule('/src/copy.ts'));
  ({ copyEn } = await vite.ssrLoadModule('/src/copy.en.ts'));
  ({ SUPPORT_EMAIL } = await vite.ssrLoadModule('/src/lib/support.ts'));
} finally {
  await vite.close();
}

const local = process.argv.includes('--local');
const PROD = 'https://ludion.ai';
const BASE = process.env.BASE_URL ?? PROD;
const PAGE_CACHE = 'public, max-age=0, s-maxage=60';
const USER_AGENT = 'ludion-verify-t027';
const shots = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screens');

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed += 1;
  console.log(`${ok ? '満たした' : '未達　　'} ${name}${detail ? `：${detail}` : ''}`);
}

const get = (url, init = {}) => fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...init.headers } });

const textsOf = (pageCopy) => [
  pageCopy.terms.heading,
  pageCopy.terms.intro,
  ...pageCopy.terms.posting.items,
  ...pageCopy.terms.review.items,
  ...pageCopy.terms.prohibited.items,
  pageCopy.terms.use.detail,
  pageCopy.terms.leaving.detail,
  pageCopy.terms.contact.detail,
  SUPPORT_EMAIL,
];

async function checkResponses() {
  for (const [path, pageCopy] of [['/terms', copy], ['/en/terms', copyEn], ['/privacy', copy], ['/en/privacy', copyEn]]) {
    const response = await get(`${BASE}${path}`);
    const html = await response.text();
    check(`${path} が 200`, response.status === 200, String(response.status));
    check(`${path} のキャッシュが許可どおり`, response.headers.get('cache-control') === PAGE_CACHE && !response.headers.get('cache-tag') && !response.headers.get('set-cookie'),
      `${response.headers.get('cache-control')}、札 ${response.headers.get('cache-tag')}`);
    const canonical = path.startsWith('/en') ? `${PROD}${path}` : `${PROD}${path}`;
    check(`${path} の canonical`, html.includes(`<link rel="canonical" href="${canonical}">`));
    if (path.endsWith('/terms')) {
      for (const text of textsOf(pageCopy)) check(`${path} に「${text.slice(0, 24)}」`, html.includes(text));
      check(`${path} の mailto`, html.includes(`href="mailto:${SUPPORT_EMAIL}"`));
    } else {
      check(`${path} に問い合わせのメール`, html.includes(SUPPORT_EMAIL) && html.includes(`href="mailto:${SUPPORT_EMAIL}"`));
    }
  }
  const en = await (await get(`${BASE}/en/terms`)).text();
  check('英語の利用規約に、日本語が優先する注記', en.includes(copyEn.terms.translationNote));
  const ja = await (await get(`${BASE}/terms`)).text();
  check('日本語の利用規約に翻訳の注記はない', !ja.includes(copyEn.terms.translationNote));

  const robots = await (await get(`${BASE}/robots.txt`)).text();
  check('robots.txt で /terms を止めていない', !/Disallow:\s*\/terms/.test(robots));

  const sitemap = await (await get(`${BASE}/sitemap.xml`)).text();
  check('sitemap に /terms と /en/terms', sitemap.includes(`${PROD}/terms`) && sitemap.includes(`${PROD}/en/terms`));
}

const hydrated = (page) => page.waitForFunction(() => Object.keys(document.getElementById('root')).some((key) => key.startsWith('__reactContainer')));

async function newContext(browser, width, height) {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height }, deviceScaleFactor: 1 });
  await context.route('**/api/count', (route) => route.abort());
  await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
  return context;
}

async function checkPages(browser) {
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await newContext(browser, width, height);
    const page = await context.newPage();
    const response = await page.goto(`${BASE}/terms`, { waitUntil: 'load' });
    await hydrated(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`/terms 幅${width}：横スクロールなし`, response.status() === 200 && overflow <= 0, `はみ出し ${overflow}px`);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const blocking = violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
    check(`/terms 幅${width}：axe の critical と serious が0`, blocking.length === 0, blocking.map((violation) => violation.id).join(' '));
    if (!local) await page.screenshot({ path: join(shots, `t027-terms-${width}.png`), fullPage: true });
    await context.close();
  }

  if (!local) {
    const en = await newContext(browser, 1440, 900);
    const enPage = await en.newPage();
    await enPage.goto(`${BASE}/en/terms`, { waitUntil: 'load' });
    await enPage.screenshot({ path: join(shots, 't027-terms-en-1440.png'), fullPage: true });
    const link = enPage.getByRole('navigation', { name: copyEn.siteInfo.label }).getByRole('link', { name: copyEn.siteInfo.terms, exact: true });
    const box = await link.boundingBox();
    check('英語の Terms of Use が中身にかからない', box !== null && box.x >= 0 && box.x + box.width <= 92, box ? `右端 ${Math.round(box.x + box.width)}` : '見えない');
    await en.close();
  }

  const { works } = await (await get(`${BASE}/api/works`)).json();
  const work = works[0];
  const narrow = await newContext(browser, 390, 844);
  const page = await narrow.newPage();
  await narrow.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${BASE}/p/${work.id}`, { waitUntil: 'load' });
  await hydrated(page);
  const open = page.getByRole('button', { name: copy.work.report.open });
  await open.click();
  const email = page.getByText(SUPPORT_EMAIL, { exact: true });
  const url = `https://ludion.ai/p/${work.id}`;
  check('作品のページでメールと作品URLと理由を出す', (await email.isVisible()) && (await page.getByText(url, { exact: true }).isVisible()) && (await page.getByText(copy.work.report.reason, { exact: true }).isVisible()));
  check('作品のページに mailto はない', (await page.locator(`a[href="mailto:${SUPPORT_EMAIL}"]`).count()) === 0);
  await page.getByRole('button', { name: copy.work.report.copy }).click();
  check('メールアドレスをコピーできる', (await page.evaluate(() => navigator.clipboard.readText())) === SUPPORT_EMAIL);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('報告を開いても横スクロールなし', overflow <= 0, `はみ出し ${overflow}px`);
  if (!local) await page.screenshot({ path: join(shots, 't027-report-390.png'), fullPage: true });
  await narrow.close();

  const wide = await newContext(browser, 1440, 900);
  const home = await wide.newPage();
  await home.goto(`${BASE}/`, { waitUntil: 'load' });
  await home.getByRole('navigation', { name: copy.siteInfo.label }).getByRole('link', { name: '利用規約', exact: true }).click();
  await home.waitForURL(`${BASE}/terms`);
  check('幅1440：ホームから利用規約へ1回', new URL(home.url()).pathname === '/terms');
  await wide.close();

  const menu = await newContext(browser, 390, 844);
  const menuPage = await menu.newPage();
  await menuPage.goto(`${BASE}/`, { waitUntil: 'load' });
  await hydrated(menuPage);
  await menuPage.getByRole('button', { name: 'メニュー' }).click();
  if (!local) await menuPage.screenshot({ path: join(shots, 't027-menu-390.png') });
  await menuPage.getByRole('menuitem', { name: '利用規約' }).click();
  await menuPage.waitForURL(`${BASE}/terms`);
  check('幅390：メニューから利用規約へ2回', new URL(menuPage.url()).pathname === '/terms');
  await menu.close();
}

const browser = await chromium.launch();
try {
  await checkResponses();
  await checkPages(browser);
} finally {
  await browser.close();
}

console.log(failed === 0 ? '\n全部満たした' : `\n未達 ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
