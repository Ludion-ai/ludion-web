// T035 の本番の確かめ（docs/tasks/T035.md「終わりの条件」）。
// node scripts/verify-t035.mjs [https://ludion.ai]
// Chromium と WebKit、幅1440と390で：スイッチが出る、押すと切り替わる、読み込み直しで残る。9作品を1つずつ固定して、どれも出る。
// 数を増やさない：作品のページは開かない（/about で確かめる）。閲覧数とコピー数の要求と、GA4 への要求は止める。
import { chromium, webkit } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'https://ludion.ai').replace(/\/+$/, '');
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../../docs/screens');
// 並びの正本は src/lib/themeSwitches.ts の THEME_SWITCH_IDS
const listSource = /THEME_SWITCH_IDS = \[([\s\S]*?)\]/.exec(readFileSync(join(here, '../src/lib/themeSwitches.ts'), 'utf8'))[1];
const THEME_SWITCH_IDS = [...listSource.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
mkdirSync(outDir, { recursive: true });
const BLOCKED = /googletagmanager\.com|google-analytics\.com|\/api\/count/;

const rows = [];
let failed = false;

async function open(context, forced) {
  const page = await context.newPage();
  if (forced) await page.addInitScript((id) => { if (window === window.top) window.__ldThemeSwitch = id; }, forced);
  await page.goto(`${base}/about`);
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[data-ld-switch-frame]');
    return !!frame && !frame.inert;
  }, null, { timeout: 30000 });
  return page;
}
const theme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const src = (page) => page.evaluate(() => document.querySelector('iframe[data-ld-switch-frame]').getAttribute('src'));

for (const type of [chromium, webkit]) {
  const browser = await type.launch();
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, locale: 'ja-JP', colorScheme: 'light' });
    await context.route((url) => BLOCKED.test(url.href), (route) => route.abort());
    const row = { browser: type.name(), width, shown: false, toggles: false, persists: false, works: [] };
    try {
      // ランダムに選ばれた1つで、出る、押すと切り替わる、読み込み直しで残る
      const page = await open(context, null);
      row.shown = (await theme(page)) === 'light';
      row.random = await src(page);
      // 読み込み直すと作品を選び直すので、読み込み直しの後も同じ作品にする（作品の違いを混ぜない）
      const picked = /^\/frame\/([a-z0-9-]+)\//.exec(row.random)[1];
      await page.addInitScript((id) => { if (window === window.top) window.__ldThemeSwitch = id; }, picked);
      const box = page.frameLocator('iframe[data-ld-switch-frame]').locator('[role="switch"]').first();
      await page.waitForTimeout(1500);
      await box.click();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 10000 });
      row.toggles = (await page.evaluate(() => localStorage.getItem('ld-theme'))) === 'dark';
      await page.reload();
      await page.waitForFunction(() => {
        const frame = document.querySelector('iframe[data-ld-switch-frame]');
        return !!frame && !frame.inert;
      }, null, { timeout: 30000 });
      await page.waitForTimeout(2500);
      row.afterReload = { theme: await theme(page), aria: await box.getAttribute('aria-checked') };
      row.persists = row.afterReload.theme === 'dark' && row.afterReload.aria === 'true';
      await page.screenshot({ path: join(outDir, `t035-prod-${type.name()}-${width}.png`) });
      // 元に戻す
      await box.click();
      await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'light', null, { timeout: 10000 });
      await page.close();

      // 9作品を1つずつ固定する。出る（選ばれうる）ことに加えて、押すとサイトが変わるか、作品も夜の側へ動くか、作品の mount が通ったかを記録する
      row.perWork = [];
      for (const id of THEME_SWITCH_IDS) {
        const one = await open(context, id);
        const path = await src(one);
        row.works.push(path.startsWith(`/frame/${id}/`) ? id : `✗${id}`);
        const oneBox = one.frameLocator('iframe[data-ld-switch-frame]').locator('[role="switch"]').first();
        const mount = await one.frameLocator('iframe[data-ld-switch-frame]').locator('#ld-host').getAttribute('data-ld-mount');
        await one.waitForTimeout(1500);
        await oneBox.click();
        const flipped = await one.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark', null, { timeout: 3000 }).then(() => true, () => false);
        await one.waitForTimeout(2500);
        row.perWork.push({ id, mount, siteFlipped: flipped, workNight: (await oneBox.getAttribute('aria-checked')) === 'true' });
        await one.evaluate(() => { try { localStorage.removeItem('ld-theme'); } catch {} });
        await one.close();
      }
    } catch (error) {
      row.error = String(error).split('\n')[0];
    }
    // 9作品とも：mount が通り、押すとサイトが変わり、作品も夜の側へ動く（REUP001）
    const allWorks = (row.perWork ?? []).length === THEME_SWITCH_IDS.length && row.perWork.every((w) => w.mount === 'ok' && w.siteFlipped && w.workNight);
    const ok = row.shown && row.toggles && row.persists && row.works.length === THEME_SWITCH_IDS.length && row.works.every((w) => !w.startsWith('✗')) && allWorks;
    if (!ok) failed = true;
    rows.push({ ...row, ok });
    console.log(JSON.stringify({ ...row, ok }));
    await context.close();
  }
  await browser.close();
}
console.log(failed ? '✗ 確かめに落ちたものがある' : '✓ 全部確かめた');
process.exit(failed ? 1 : 0);
