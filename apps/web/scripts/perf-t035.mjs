// 実行：node scripts/perf-t035.mjs https://ludion.ai before（または after）
// T035「重さ」：本番と同じ測り方で、前と後を比べる。
// 1) LCP：Lighthouse mobile（scripts/lcp.mjs と同じ lighthouse@12.8.2）を3回、中央値。
// 2) スマホの幅（390×844、CPU 4倍遅く）で、load の後にスクロールしているあいだの長いタスク（50ms 超）の数。5回、中央値。
// 閲覧数（/api/count）と GA4 への要求は止める（数を増やさない。GA4 を読まない）。
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [base, label] = process.argv.slice(2);
const PATHS = ['/', '/p/toggle-daylight'];
const BLOCK = ['*googletagmanager.com*', '*google-analytics.com*', '*/api/count*'];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const result = { label, base, at: new Date().toISOString(), lcp: {}, longTasks: {} };
const dir = mkdtempSync(join(tmpdir(), 'ld-t035-perf-'));
for (const path of PATHS) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const out = join(dir, `lh-${i}.json`);
    const command = [`npx -y lighthouse@12.8.2 ${base + path}`, '--quiet --form-factor=mobile --only-categories=performance', `--output=json --output-path="${out}"`, '--chrome-flags="--headless=new --no-sandbox"', ...BLOCK.map((b) => `--blocked-url-patterns="${b}"`)].join(' ');
    execFileSync(command, { stdio: 'ignore', shell: true, timeout: 240000, env: { ...process.env, CHROME_PATH: chromium.executablePath() } });
    const lh = JSON.parse(readFileSync(out, 'utf8'));
    runs.push({ lcp: Math.round(lh.audits['largest-contentful-paint'].numericValue), cls: lh.audits['cumulative-layout-shift'].numericValue, tbt: Math.round(lh.audits['total-blocking-time'].numericValue) });
  }
  result.lcp[path] = { runs, medianLcp: median(runs.map((r) => r.lcp)), medianTbt: median(runs.map((r) => r.tbt)) };
  console.log(label, path, JSON.stringify(result.lcp[path]));
}
const browser = await chromium.launch();
for (const path of PATHS) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP' });
    await context.route((url) => /googletagmanager\.com|google-analytics\.com|\/api\/count/.test(url.href), (route) => route.abort());
    await context.addInitScript(() => {
      if (window !== window.top) return;
      window.__long = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__long.push({ start: e.startTime, duration: e.duration }); }).observe({ type: 'longtask', buffered: true });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(6000); // 手が空いたときに読むスイッチの枠も入る
    const sw = await page.evaluate(() => document.querySelector('iframe[data-ld-switch-frame]')?.getAttribute('src') ?? null);
    const start = await page.evaluate(() => performance.now());
    for (let s = 0; s < 30; s++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(100); }
    for (let s = 0; s < 30; s++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(100); }
    const long = await page.evaluate((t) => window.__long.filter((e) => e.start >= t && e.duration > 50), start);
    runs.push({ count: long.length, max: Math.round(Math.max(0, ...long.map((e) => e.duration))), switch: sw });
    await context.close();
  }
  result.longTasks[path] = { runs, median: median(runs.map((r) => r.count)) };
  console.log(label, path, 'longtasks', JSON.stringify(result.longTasks[path]));
}
await browser.close();
console.log('RESULT ' + JSON.stringify(result));
