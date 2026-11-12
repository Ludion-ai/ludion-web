// 場面2と3のサイトの画面を撮る（V006）。オーナーの裏方の道具（CLAUDE.md 原則1）。お金はかからない（AI を使わない）。
//   node promo/workspace/site.mjs --persist <置き場> [--base <きれいな置き場>] [--as site] [--work wallpaper-rain-window] [--width 1440 --height 900 --scale 3]
// --base を付けると、撮る前に、その置き場をまるごと --persist に写し直す（作品を置く前の形から、何度でも同じに撮れる）。
// きれいな置き場の作り方：LD_PERSIST_DIR=<置き場> npm run seed:dev -w @ludion/web → node promo/workspace/local-work.mjs --persist <置き場> <作品の id>…
// 手順（どれも本物のサイトの動き。画面は手で描かない）：
//   A. 動画に出す人で、作品のページを開く（左のナビに「自分の作品」）
//   B. 記録の HTML（場面1の波紋ボタン）を、プラグインのフックで置く（person.mjs の putRecord。Claude Code がするのと同じ形）。
//      読み直しの間（15秒）が過ぎてから、画面に戻った合図を送る → ナビに作品が増える
//   C. 「この作品について」の「シェーダー」の印を押す → 本文のその行へ飛ぶ
//   D. ファイルの木の「シェーダー」を押す → その範囲（場面4で Claude が読んだ範囲と同じ）が選ばれ、シェーダーの名前が並ぶ
//   E. 木のシェーダー（--shader、既定 WINDOW_FRAG）を押す → その範囲が選ばれる
// 撮ったもの（promo/out/v006-record/<名前>-shots/）はコミットしない。字の四角と、要の物の四角も残す（動画の見出しの重なりの確かめと、カメラの寄り先）。
// 手元の開発のサーバーにだけつなぐ。ブラウザは Playwright の1つだけで、名前解決を手元だけに絞る。作品の枠は実の GPU で描かせる。

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startDev } from './dev-server.mjs';
import { OUT_ROOT, useLocalTemp } from './out.mjs';
import { PERSON, ensurePerson, putRecord } from './person.mjs';
import { waitForQuiet } from './quiet.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const persist = valueOf('--persist');
const NAME = valueOf('--as') || 'site';
const WORK = valueOf('--work') || 'wallpaper-rain-window';
const SHADER = valueOf('--shader') || 'WINDOW_FRAG';
const SHOT = { width: Number(valueOf('--width') || 1440), height: Number(valueOf('--height') || 900), scale: Number(valueOf('--scale') || 3) };
/** 画面に戻ったときの読み直しは、前に読んでから 15秒たってから（apps/web/src/hooks/useOwnWorks.tsx の BACK_GAP）。少し足して待つ */
const BACK_WAIT_MS = 16500;
if (!persist) throw new Error('使い方: node promo/workspace/site.mjs --persist <置き場> [--as <名前>]');
{
  const host = new URL(BASE).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${BASE}`);
}
const OUT = resolve(OUT_ROOT, 'v006-record', `${NAME}-shots`);
const say = (step, value) => console.log(JSON.stringify({ step, ...value }));

await waitForQuiet(Number(valueOf('--wait-max') || 8));
useLocalTemp();
const base = valueOf('--base');
if (base) {
  if (!existsSync(resolve(base))) throw new Error(`きれいな置き場がない: ${base}`);
  if (resolve(base) === resolve(persist)) throw new Error('--base と --persist が同じ');
  rmSync(resolve(persist), { recursive: true, force: true });
  cpSync(resolve(base), resolve(persist), { recursive: true });
  say('copied', { from: 'base', to: 'persist' });
}
say('person', ensurePerson(resolve(persist)));
const dev = await startDev({ persist, base: BASE });
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const blocked = [];
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--disable-lcd-text', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext({ locale: 'ja-JP', colorScheme: 'light', viewport: { width: SHOT.width, height: SHOT.height }, deviceScaleFactor: SHOT.scale });
  await context.addCookies([{ name: 'ld_session', value: PERSON.session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const nav = page.locator('[data-own-nav="sidebar"]');
  const rows = nav.locator('[data-own-nav-work]');
  // マウスは、何もない所に置く（押した後も。ほかの物に hover の色を付けない）
  const rest = () => page.mouse.move(SHOT.width - 4, 6);

  /** 画面の字の四角（1行ごと。見えている所だけ）と、要の物の四角。CSS の画素 */
  const measure = () =>
    page.evaluate((shader) => {
      const round = (v) => Math.round(v * 100) / 100;
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) };
      };
      const H = window.innerHeight;
      const W = window.innerWidth;
      const textRects = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const el = node.parentElement;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none' || el.closest('.sr-only, [hidden]')) continue;
        // 送れる箱（overflow が visible でない祖先）の外にはみ出して、隠れている所は数えない
        let clipTop = 0;
        let clipBottom = H;
        let clipLeft = 0;
        let clipRight = W;
        for (let up = el; up && up !== document.body; up = up.parentElement) {
          const o = getComputedStyle(up);
          if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
          const b = up.getBoundingClientRect();
          clipTop = Math.max(clipTop, b.top);
          clipBottom = Math.min(clipBottom, b.bottom);
          clipLeft = Math.max(clipLeft, b.left);
          clipRight = Math.min(clipRight, b.right);
        }
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width > 1 && r.height > 1 && r.bottom > clipTop && r.top < clipBottom && r.right > clipLeft && r.left < clipRight) textRects.push({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), fontPx: parseFloat(style.fontSize), tag: el.tagName.toLowerCase(), text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) });
        }
      }
      const navRows = [...document.querySelectorAll('[data-own-nav="sidebar"] [data-own-nav-work]')].map((li) => ({ id: li.getAttribute('data-own-nav-work'), text: li.innerText.replace(/\s+/g, ' ').trim(), rect: rect(li) }));
      const about = [...document.querySelectorAll('[data-about-item]')].map((a) => ({ key: a.getAttribute('data-about-item'), text: a.innerText.trim(), href: a.getAttribute('href')?.replace(/^\/p\/[^/]+/, '/p/<作品>') ?? null, rect: rect(a) }));
      const tree = [...document.querySelectorAll('[data-tree-key]')].map((a) => ({ key: a.getAttribute('data-tree-key'), kind: a.getAttribute('data-tree-kind'), text: a.innerText.replace(/\s+/g, ' ').trim(), current: a.getAttribute('aria-current') === 'true', rect: rect(a) }));
      const selected = [...document.querySelectorAll('[data-line][data-selected]')];
      const lines = [...document.querySelectorAll('[data-line]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < H;
      });
      return {
        scrollY: Math.round(window.scrollY),
        path: location.pathname.replace(/^\/p\/[^/]+/, '/p/<作品>') + location.hash,
        textRects,
        boxes: {
          nav: rect(document.querySelector('[data-own-nav="sidebar"]')),
          navList: rect(document.querySelector('[data-own-nav="sidebar"] [data-own-nav-list]')),
          navRows,
          head: rect(document.querySelector('[data-work-head]')),
          stage: rect(document.querySelector('[data-work-stage]')),
          about: rect(document.querySelector('[data-work-about]')),
          aboutItems: about,
          files: rect(document.querySelector('[data-work-files]')),
          tree: rect(document.querySelector('[data-file-tree]')),
          treeItems: tree.filter((t) => t.rect.y + t.rect.height > 0 && t.rect.y < H),
          shaderItem: tree.find((t) => t.kind === 'shader' && t.text.includes(shader)) ?? null,
          trail: rect(document.querySelector('[data-code-trail]')),
          codeBar: rect(document.querySelector('[data-code-bar]')),
          codePanel: rect(document.querySelector('[data-code-panel]')),
          selectedFirst: selected.length ? { line: Number(selected[0].getAttribute('data-line')), rect: rect(selected[0]) } : null,
          selectedLast: selected.length ? { line: Number(selected.at(-1).getAttribute('data-line')), rect: rect(selected.at(-1)) } : null,
          linesShown: lines.length ? [Number(lines[0].getAttribute('data-line')), Number(lines.at(-1).getAttribute('data-line'))] : null,
          lineRects: lines.map((el) => ({ line: Number(el.getAttribute('data-line')), rect: rect(el), text: el.innerText.replace(/^\s*\d+/, '').slice(0, 80) })),
        },
      };
    }, SHADER);
  const states = [];
  const shoot = async (id, note) => {
    await rest();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const file = `${id}.png`;
    await page.screenshot({ path: join(OUT, file) });
    const m = await measure();
    states.push({ id, file, note, ...m });
    say('shot', { id, note, path: m.path, scrollY: m.scrollY, nav: m.boxes.navRows.map((r) => r.text), texts: m.textRects.length });
  };

  // A. 作品のページを開く
  await page.goto(`${BASE}/p/${encodeURIComponent(WORK)}`, { waitUntil: 'load' });
  await rows.first().waitFor({ timeout: 20000 });
  const navReadyAt = Date.now();
  // 作品の枠が描き終わるまで待つ（実の GPU で動く作品。数秒）
  await page.locator('[data-work-stage] iframe').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(5000);
  const before = await rows.count();
  await shoot('A', '作品のページを開いた。左のナビに自分の作品');

  // B. 記録の HTML をプラグインのフックで置く → 画面に戻った合図 → ナビに増える
  const line = await putRecord('scene1');
  say('put', { line: line.replace(/https?:\/\/[^\s]+/, '<手元の住所>') });
  const wait = BACK_WAIT_MS - (Date.now() - navReadyAt);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.waitForFunction((n) => document.querySelectorAll('[data-own-nav="sidebar"] [data-own-nav-work]').length > n, before, { timeout: 15000 });
  await page.waitForTimeout(800);
  await shoot('B', '画面に戻った合図の後。ナビに、いま置いた作品が増えた');

  // C. 「この作品について」のシェーダーの印を押す
  const mark = page.locator('[data-about-item="shaders"]');
  const markBox = await mark.boundingBox();
  await mark.click();
  await page.waitForURL(/\/code\//, { timeout: 15000 });
  await page.locator('[data-line][data-selected]').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500); // 色付けは手の空いた時に付く
  await shoot('C', 'シェーダーの印を押した後。本文のその行');
  states.at(-1).clicked = { what: 'about:shaders', box: markBox, inState: 'B' };

  // D. ファイルの木の「シェーダー」（中がシェーダーだけの見出し、または木が作ったまとまり）を押す → その範囲が選ばれ、シェーダーの名前が並ぶ
  const group = page.locator('[data-file-tree] a[data-tree-kind="group"], [data-file-tree] a[data-tree-kind="heading"]:has-text("シェーダー")').first();
  const groupBox = await group.boundingBox();
  await group.click();
  await page.waitForFunction(() => document.querySelector('[data-file-tree] a[aria-current="true"]') !== null, null, { timeout: 15000 });
  await page.locator('[data-tree-kind="shader"]').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await shoot('D', 'ファイルの木の「シェーダー」を押した後。その範囲が選ばれ、シェーダーの名前が並ぶ');
  states.at(-1).clicked = { what: 'tree:shaders', box: groupBox, inState: 'C' };

  // E. 木のシェーダーを押す
  const item = page.locator('[data-tree-kind="shader"]', { hasText: SHADER }).first();
  await item.waitFor({ timeout: 10000 });
  const itemBox = await item.boundingBox();
  await item.click();
  await page.waitForFunction((name) => decodeURIComponent(location.hash).length > 0 && [...document.querySelectorAll('[data-tree-kind="shader"][aria-current="true"]')].some((a) => a.textContent.includes(name)), SHADER, { timeout: 15000 });
  await page.waitForTimeout(2500);
  await shoot('E', `木の ${SHADER} を押した後。その範囲が選ばれる`);
  states.at(-1).clicked = { what: `tree:${SHADER}`, box: itemBox, inState: 'D' };

  const manifest = { work: WORK, shader: SHADER, viewport: SHOT, states, blockedRequests: blocked, putLine: line.replace(/https?:\/\/[^\s]+/, '<手元の住所>') };
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  say('done', { out: OUT, states: states.map((s) => s.id), blocked: blocked.length });
} finally {
  await browser.close();
  await dev.stop();
}
