// 場面2の下調べ（V006）：作品を置いたとき、開いているページの左のナビ「自分の作品」が、いつ増えるかを見る。お金はかからない（AI を使わない）。絵は撮らない（字だけを読む）。
//   node promo/workspace/check-nav.mjs --persist <置き場>
// 手順：動画に出す人でホームを開く → ナビの作品の名前を読む → 記録の HTML をプラグインのフックで置く → 6秒待って読む → 「自分の作品」のページへ移って読む → 開き直して読む。
// 手元の開発のサーバーにだけつなぐ。ブラウザは Playwright の1つだけで、名前解決を手元だけに絞る。

import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { startDev } from './dev-server.mjs';
import { PERSON, ensurePerson, putRecord } from './person.mjs';
import { waitForQuiet } from './quiet.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const persist = valueOf('--persist');
if (!persist) throw new Error('使い方: node promo/workspace/check-nav.mjs --persist <置き場>');
{
  const host = new URL(BASE).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${BASE}`);
}
const say = (step, value) => console.log(JSON.stringify({ step, ...value }));

await waitForQuiet(Number(valueOf('--wait-max') || 8));
ensurePerson(resolve(persist));
const dev = await startDev({ persist, base: BASE });
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
try {
  const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: 1440, height: 900 } });
  await context.addCookies([{ name: 'ld_session', value: PERSON.session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  const page = await context.newPage();
  const nav = page.locator('[data-own-nav="sidebar"]');
  /** ナビに見えている字（作品の名前が入る）。ナビがなければ null */
  const read = async () => ((await nav.count()) ? (await nav.innerText()).split('\n').map((l) => l.trim()).filter(Boolean) : null);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await nav.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const before = await read();
  say('before', { lines: before });
  const line = await putRecord('scene1');
  say('put', { line });
  await page.waitForTimeout(6000);
  const after = await read();
  say('after-6s', { lines: after, changed: JSON.stringify(after) !== JSON.stringify(before) });
  // タブを離れて戻る（見ている人が、ターミナルからブラウザへ戻る動き）
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForTimeout(2500);
  const focused = await read();
  say('after-focus', { lines: focused, changed: JSON.stringify(focused) !== JSON.stringify(before) });
  await page.getByRole('link', { name: before?.[0] ?? '自分の作品' }).first().click();
  await page.waitForTimeout(3000);
  const moved = await read();
  say('after-my-works-page', { path: new URL(page.url()).pathname, lines: moved, changed: JSON.stringify(moved) !== JSON.stringify(before) });
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await nav.waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  const reloaded = await read();
  say('after-reload', { lines: reloaded, changed: JSON.stringify(reloaded) !== JSON.stringify(before) });
} finally {
  await browser.close();
  await dev.stop();
}
