// T032 の本番の確かめ（docs/tasks/DEPLOY-T032.md）：ログインしていない人に、/new と投稿の入口が SPEC.md「19」のとおりに見えるか。
// node scripts/verify-t032-entry.mjs
// 読むだけ。作品のページは開かない（閲覧数は POST /api/count でだけ増えるが、念のため。CLAUDE.md 原則10）。GA4 には繋がない。
// 画面を docs/screens/t032-prod-*.png に撮る。

import { chromium, webkit } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoDir = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const SCREENS = join(repoDir, 'docs/screens');
const PROD = 'https://ludion.ai';
const UA = { 'User-Agent': 'ludion-verify-t032' };
let failed = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? '通った' : '落ちた'}：${label}${detail ? `（${detail}）` : ''}`);
};

for (const [path, to] of [['/new', '/login?next=%2Fnew'], ['/en/new', '/en/login?next=%2Fen%2Fnew']]) {
  const res = await fetch(`${PROD}${path}`, { redirect: 'manual', headers: UA });
  check(`ログインせずに ${path} はログインへ送る`, res.status === 302 && res.headers.get('location') === to, `${res.status} ${res.headers.get('location')}`);
}
const me = await (await fetch(`${PROD}/api/me`, { headers: UA })).json();
check('ログインしていない /api/me は user が null で、can_post を出さない', me.user === null && !('can_post' in me), JSON.stringify(me));

for (const [label, launch] of [['chromium', () => chromium.launch()], ['webkit', () => webkit.launch()]]) {
  const browser = await launch();
  try {
    for (const { width, height } of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
      const context = await browser.newContext({ locale: 'ja-JP', viewport: { width, height } });
      await context.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const meResponse = page.waitForResponse((res) => res.url().endsWith('/api/me'));
      await page.goto(`${PROD}/`);
      await meResponse;
      await page.waitForTimeout(1000);
      const links = await page.locator('a[href="/new"], a[href$="/new"], a[href*="/new?"]').count();
      check(`${label} 幅${width}：ホームに投稿の入口がない`, links === 0, `${links}件`);
      check(`${label} 幅${width}：ページのエラーがない`, errors.length === 0, errors.join(' / '));
      if (label === 'chromium') await page.screenshot({ path: join(SCREENS, `t032-prod-home-anon-${width}.png`) });
      await page.goto(`${PROD}/new`);
      const url = new URL(page.url());
      check(`${label} 幅${width}：/new を開くとログインの画面`, url.pathname === '/login' && url.searchParams.get('next') === '/new', page.url());
      if (label === 'chromium') await page.screenshot({ path: join(SCREENS, `t032-prod-new-anon-${width}.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
console.log(failed === 0 ? '全部通った' : `落ちたもの ${failed} 件`);
process.exit(failed === 0 ? 0 : 1);
