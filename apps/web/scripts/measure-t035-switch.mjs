// T035「1. スイッチの遅れを直す」の測り（docs/tasks/T035.md「11/11 9:10 の CTO の答え」）。
// node scripts/measure-t035-switch.mjs [https://ludion.ai] [回数=3] [作品の id,…]
// Chromium と WebKit、幅1440と390で：
// (a) 押してから、サイトの色が変わるまで。押した時：枠の中のスイッチの pointerdown。
//     変わった時：親の <html data-theme> が変わった時（attr）と、その後の最初の requestAnimationFrame（paint）。
//     枠と親は別の窓なので、どちらも performance.timeOrigin + performance.now() で比べる。
// (b) ページを開いてから、スイッチが押せるようになるまで（枠の inert が外れた時。ナビゲーションの始まりから）。
//     ページの load と、枠の文書の要求の始まりも出す。
// 数を増やさない：作品のページは開かない（/about で測る）。閲覧数とコピー数の要求と、GA4 への要求は止める。
import { chromium, webkit } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = (process.argv[2] ?? 'https://ludion.ai').replace(/\/+$/, '');
const runs = Number(process.argv[3] ?? 3);
const here = dirname(fileURLToPath(import.meta.url));
const listSource = /THEME_SWITCH_IDS = \[([\s\S]*?)\]/.exec(readFileSync(join(here, '../src/lib/themeSwitches.ts'), 'utf8'))[1];
const ids = process.argv[4] ? process.argv[4].split(',') : [...listSource.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
const BLOCKED = /googletagmanager\.com|google-analytics\.com|\/api\/count/;
const SWITCH_FRAME = 'iframe[data-ld-switch-frame]';
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

async function measureOne(context, id) {
  const page = await context.newPage();
  await page.addInitScript((forced) => {
    if (window !== window.top) return;
    window.__ldThemeSwitch = forced;
    const t = { themeAt: [], paintAt: [], readyAt: null };
    Object.defineProperty(window, '__ldT', { value: t });
    new MutationObserver(() => {
      if (t.readyAt === null) {
        const frame = document.querySelector('iframe[data-ld-switch-frame]');
        if (frame && !frame.inert) t.readyAt = performance.now();
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['inert'] });
    // 初めの文書では documentElement がまだないことがあるので、document の下を見る
    new MutationObserver((records) => {
      if (!records.some((r) => r.target === document.documentElement)) return;
      t.themeAt.push(performance.timeOrigin + performance.now());
      requestAnimationFrame(() => t.paintAt.push(performance.timeOrigin + performance.now()));
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
  }, id);
  await page.goto(`${base}/about`);
  await page.waitForFunction((sel) => {
    const frame = document.querySelector(sel);
    return !!frame && !frame.inert;
  }, SWITCH_FRAME, { timeout: 30000 });
  const b = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const frameEntry = performance.getEntriesByType('resource').find((e) => e.name.endsWith('/inline.html'));
    return { ready: Math.round(window.__ldT.readyAt), load: Math.round(nav.loadEventStart), frameRequest: frameEntry ? Math.round(frameEntry.startTime) : null };
  });
  // 最初の合わせが終わるのを待つ
  await page.waitForTimeout(2500);
  const src = await page.evaluate((sel) => document.querySelector(sel).getAttribute('src'), SWITCH_FRAME);
  const frame = page.frames().find((f) => f.url().endsWith('/inline.html'));
  await frame.evaluate(() => {
    const host = document.getElementById('ld-host');
    const s = host.shadowRoot.querySelector('[role="switch"]');
    window.__ldPress = [];
    window.__ldAria = [];
    s.addEventListener('pointerdown', (e) => window.__ldPress.push(performance.timeOrigin + e.timeStamp), true);
    new MutationObserver(() => window.__ldAria.push(performance.timeOrigin + performance.now())).observe(s, { attributes: true, attributeFilter: ['aria-checked'] });
  });
  const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const themeCount = await page.evaluate(() => window.__ldT.themeAt.length);
  await page.frameLocator(SWITCH_FRAME).locator('[role="switch"]').first().click();
  await page.waitForFunction((was) => document.documentElement.getAttribute('data-theme') !== was, before, { timeout: 10000 });
  await page.waitForTimeout(2500);
  const [pressAt] = await frame.evaluate(() => window.__ldPress);
  const [ariaAt] = await frame.evaluate(() => window.__ldAria);
  const t = await page.evaluate(() => window.__ldT);
  const themeAt = t.themeAt[themeCount];
  const paintAt = t.paintAt[themeCount];
  const after = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const aria = await page.frameLocator(SWITCH_FRAME).locator('[role="switch"]').first().getAttribute('aria-checked');
  // 元に戻す（覚えたモードを消す）
  await page.evaluate(() => { try { localStorage.removeItem('ld-theme'); } catch {} });
  await page.close();
  return {
    id,
    src,
    a: { attr: Math.round(themeAt - pressAt), paint: Math.round(paintAt - pressAt), aria: ariaAt ? Math.round(ariaAt - pressAt) : null, flips: t.themeAt.length - themeCount, before, after, ariaState: aria },
    b,
  };
}

const rows = [];
for (const type of [chromium, webkit]) {
  const browser = await type.launch();
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const all = [];
    for (let i = 0; i < runs; i++) {
      for (const id of ids) {
        const context = await browser.newContext({ viewport: { width, height }, locale: 'ja-JP', colorScheme: 'light' });
        await context.route((url) => BLOCKED.test(url.href), (route) => route.abort());
        try {
          const r = await measureOne(context, id);
          all.push(r);
          console.log(JSON.stringify({ browser: type.name(), width, ...r }));
        } catch (error) {
          console.log(JSON.stringify({ browser: type.name(), width, id, error: String(error).split('\n')[0] }));
        }
        await context.close();
      }
    }
    const row = {
      browser: type.name(),
      width,
      n: all.length,
      aPaintMedian: median(all.map((r) => r.a.paint)),
      aPaintMax: Math.max(...all.map((r) => r.a.paint)),
      aAttrMedian: median(all.map((r) => r.a.attr)),
      ariaMedian: median(all.map((r) => r.a.aria)),
      bReadyMedian: median(all.map((r) => r.b.ready)),
      bReadyMax: Math.max(...all.map((r) => r.b.ready)),
      loadMedian: median(all.map((r) => r.b.load)),
      frameRequestMedian: median(all.map((r) => r.b.frameRequest)),
      oneFlipEach: all.every((r) => r.a.flips === 1),
    };
    rows.push(row);
    console.log('ROW ' + JSON.stringify(row));
  }
  await browser.close();
}
console.log('RESULT ' + JSON.stringify({ base, at: new Date().toISOString(), runs, ids, rows }));
