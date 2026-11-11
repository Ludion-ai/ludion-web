// T035 のスクリーンショット：13ページ × ライトとダーク × 1440 と 390。docs/screens/t035-<page>-<theme>-<width>.png
// 手元の vite preview（4290。toggle-* を ld upload で入れた D1）、偽の GitHub（4291）、偽の Google（4292）で撮る。docs/reports/T035.md を見る
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const WEB = join(import.meta.dirname, '..');
const OUT = join(import.meta.dirname, '../../../docs/screens');
const BASE = 'http://localhost:4290';
const SWITCHES = ['toggle-daylight','toggle-deep-sea','toggle-lighthouse','toggle-oasis','toggle-rainy-cafe','toggle-sakura-shrine','toggle-station','toggle-tokyo-alley','toggle-volcano-island'];
const d1 = (sql) => execFileSync(process.execPath, [join(WEB, '../../node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'ludion-app', '--local', '--persist-to', join(WEB, '.wrangler/t035-look'), '--json', '--command', sql], { cwd: WEB, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const browser = await chromium.launch();
let n = 0;
async function ready(page) {
  await page.waitForLoadState('load');
  await page.waitForFunction(() => { const f = document.querySelector('iframe[data-ld-switch-frame]'); return f && !f.inert; }, null, { timeout: 20000 }).catch(() => console.log('  (スイッチの枠が読めない)', page.url()));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
}
async function shot(page, name, theme, width, full = true) {
  await ready(page);
  const file = `t035-${name}-${theme}-${width}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: full });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log(file, new URL(page.url()).pathname, `はみ出し ${overflow}px`, await page.evaluate(() => document.documentElement.dataset.theme));
}
const stamp = Date.now().toString(36);
for (const [width, height] of [[1440, 900], [390, 844]]) for (const theme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'ja-JP', colorScheme: theme, deviceScaleFactor: 1 });
  await context.addInitScript((list) => { if (window === window.top) window.__ldThemeSwitch = list[Number(sessionStorage.getItem('ld-shot') ?? 0) % list.length]; }, SWITCHES);
  const page = await context.newPage();
  const go = async (path) => { await page.evaluate((i) => sessionStorage.setItem('ld-shot', String(i)), n++).catch(() => {}); await page.goto(BASE + path); };
  await page.goto(BASE + '/about');
  for (const [name, path] of [['home', '/'], ['work', '/p/toggle-oasis'], ['creator', '/c/Lattice_Node'], ['login', '/login'], ['terms', '/terms'], ['privacy', '/privacy'], ['about', '/about'], ['404', '/no-such-page']]) {
    await go(path); await shot(page, name, theme, width);
  }
  // 「…」のメニュー（ログインしていない人）
  await go('/');
  await ready(page);
  await page.getByRole('button', { name: 'メニュー' }).click();
  await page.getByRole('menu').waitFor();
  await page.screenshot({ path: join(OUT, `t035-guest-menu-${theme}-${width}.png`) });
  // サインアップ（Google の新しい人）
  const login = `t035${theme}${width}${stamp}`;
  await context.addCookies([{ name: 'fake_google', value: login, url: 'http://localhost:4292' }]);
  await page.goto(BASE + '/login');
  await page.getByRole('link', { name: 'Google でログイン' }).click();
  await page.getByText('使えます', { exact: true }).waitFor();
  await shot(page, 'signup', theme, width);
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('button', { name: 'アカウントのメニュー' }).waitFor();
  const { handle } = await (await page.request.get(BASE + '/api/me')).json().then((j) => j.user);
  d1(`UPDATE users SET is_operator = 1 WHERE handle = '${handle}'`);
  for (const id of ['toggle-oasis', 'toggle-daylight', 'fx-landing', 'seed-trail-guide']) await page.request.post(`${BASE}/api/works/${id}/bookmark`, { headers: { Origin: BASE } });
  for (const [name, path] of [['account', '/account'], ['saved', '/account/saved'], ['new', '/new'], ['review', '/admin/review']]) {
    await go(path); await shot(page, name, theme, width);
  }
  await go('/');
  await ready(page);
  await page.getByRole('button', { name: 'アカウントのメニュー' }).click();
  await page.getByRole('menu').waitFor();
  await page.screenshot({ path: join(OUT, `t035-account-menu-${theme}-${width}.png`) });
  await context.close();
}
await browser.close();
