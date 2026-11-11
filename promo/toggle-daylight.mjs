// toggle-daylight（住人のいるスイッチ）の動画を作る。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/toggle-daylight.mjs           → promo/out/toggle-daylight.mp4（2880×2160、H.264、60fps）
//   node promo/toggle-daylight.mjs --draft   → 下見用（1440×1080。promo/out/toggle-daylight-draft.mp4）
//
// 切れ目のない1カット。音も文字もなし。カーソルがスイッチを動かすだけで、時刻が流れる。
// 時間を止めて1コマずつ撮る（1枚の撮影が 1/60 秒より長いので、そのままの録画ではかくつくため）。
//
// 作品の外の演出が2つある。どちらも works/ は変えない。
// - カーソルの絵：OS のカーソルは写らないので、同じ座標に矢印を重ねる
// - ページの地：作品が公開している --night（世界の暗さ）を読み、画面全体の地を昼から夜へ変える
//   作品そのものは枠の外を変えない。Ludion の作品ページでは地は変わらない

import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { buildFrameHtml } from '@ludion/render';
import { findWork, readWork, toRenderable } from '../packages/ld/src/workspace.ts';

const ffmpegPath = ffmpegInstaller.path;
const DRAFT = process.argv.includes('--draft');
const WORK_ID = 'toggle-daylight';
const VIEW = { width: 1440, height: 1080 };
const SCALE = DRAFT ? 1 : 2; // 2880×2160
const STAGE_WIDTH = 1300; // 作品の幅（CSS px）。地の変化が見える余白を残す
const FPS = 60;
const FRAME_URL = 'http://ld-frame.localhost/';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), DRAFT ? 'out/toggle-daylight-draft.mp4' : 'out/toggle-daylight.mp4');

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, from, to) => clamp((t - from) / (to - from));
const glide = (t) => 1 - Math.pow(1 - Math.pow(clamp(t), 1.6), 3); // ゆっくり動き出し、なめらかに止まる
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)); // 手で引くような、ゆるい加減速
const quick = (t) => 1 - Math.pow(1 - clamp(t), 2.4);

// ---- ページの中：時間の差し替え
function installVirtualTime() {
  const v = { now: 0, raf: new Map(), rafId: 1, timers: new Map(), timerId: 1 };
  const realRaf = window.requestAnimationFrame.bind(window);
  const base = Date.UTC(2026, 10, 8);
  window.requestAnimationFrame = (cb) => {
    const id = v.rafId++;
    v.raf.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => v.raf.delete(id);
  performance.now = () => v.now;
  Date.now = () => base + v.now;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = v.timerId++;
    v.timers.set(id, { at: v.now + ms, fn, args });
    return id;
  };
  window.clearTimeout = (id) => v.timers.delete(id);
  let seed = 20261108;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  window.__vt = {
    step(ms) {
      v.now += ms;
      for (const [id, timer] of [...v.timers].sort((x, y) => x[1].at - y[1].at)) {
        if (timer.at > v.now) continue;
        v.timers.delete(id);
        timer.fn(...timer.args);
      }
      const batch = [...v.raf.values()];
      v.raf.clear();
      for (const cb of batch) cb(v.now);
    },
    painted: () => new Promise((done) => realRaf(() => realRaf(done))),
  };
}

// ---- ページの中：カーソルの絵と、地の色
function installStage(stageWidth) {
  const host = document.getElementById('ld-host');
  const root = host.shadowRoot.querySelector('[data-ld-part]');
  // 作品の大きさを、動画の構図に合わせる
  root.style.width = `${stageWidth}px`;
  const style = getComputedStyle(root);
  const day = style.getPropertyValue('--_bg').trim();
  const ink = style.getPropertyValue('--_fg').trim();

  const NS = 'http://www.w3.org/2000/svg';
  const cursor = document.createElementNS(NS, 'svg');
  cursor.setAttribute('viewBox', '0 0 24 36');
  cursor.setAttribute('width', '24');
  cursor.setAttribute('height', '36');
  Object.assign(cursor.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    zIndex: '1000',
    pointerEvents: 'none',
    transformOrigin: '0 0',
    overflow: 'visible',
    filter: 'drop-shadow(0 2px 4px rgb(0 0 0 / .3))',
  });
  const arrow = document.createElementNS(NS, 'path');
  arrow.setAttribute('d', 'M1 1 L1 28 L7.6 22 L12 33 L16.6 31 L12.2 20.4 L21 20.4 Z');
  arrow.setAttribute('fill', '#ffffff');
  arrow.setAttribute('stroke', 'rgb(20 20 28 / .7)');
  arrow.setAttribute('stroke-width', '1.2');
  arrow.setAttribute('stroke-linejoin', 'round');
  cursor.append(arrow);
  document.body.append(cursor);

  window.__stage = {
    draw(x, y, squeeze) {
      cursor.style.transform = `translate(${x}px, ${y}px) scale(${1 - 0.14 * squeeze})`;
      // 地：作品の --night に合わせて、昼の色から夜の色へ
      const night = parseFloat(root.style.getPropertyValue('--night')) || 0;
      const pct = (night * 100).toFixed(1);
      document.documentElement.style.backgroundColor = `color-mix(in oklab, ${day}, color-mix(in oklab, ${ink} 62%, black) ${pct}%)`;
    },
  };
}

// ---- 本体
const location = findWork(WORK_ID);
if (!location) throw new Error(`${WORK_ID} が見つからない`);
const work = toRenderable(readWork(location));
if (!work) throw new Error(`${WORK_ID} を描画できない`);
const html = buildFrameHtml(work, { palette: 'author', width: VIEW.width });

mkdirSync(dirname(OUT), { recursive: true });
const ffmpeg = spawn(
  ffmpegPath,
  [
    '-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', DRAFT ? 'veryfast' : 'slow', '-crf', DRAFT ? '22' : '15', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart',
    OUT,
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const ffmpegDone = new Promise((done, fail) => {
  ffmpeg.on('error', fail);
  ffmpeg.on('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg が ${code} で止まった`))));
});
const writeFrame = (buffer) => new Promise((done, fail) => ffmpeg.stdin.write(buffer, (error) => (error ? fail(error) : done())));

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
const page = await context.newPage();
page.on('pageerror', (error) => console.error('作品のエラー:', error.message));
await page.route('**/*', (route) => {
  if (route.request().url() === FRAME_URL) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  return route.abort();
});
await page.addInitScript(installVirtualTime);
await page.goto(FRAME_URL, { waitUntil: 'load' });
await page.evaluate(installStage, STAGE_WIDTH);
await page.evaluate(() => window.__vt.painted());
// 大きさの変更を、作品に受け取らせる
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__vt.step(1000 / 60);
});
await page.evaluate(() => window.__vt.painted());
await page.evaluate(() => {
  for (let i = 0; i < 4; i++) window.__vt.step(1000 / 60);
});

// ---- スイッチの形（作品と同じ割合）
const box = await page.locator('.hit').boundingBox();
const pillH = box.height;
const bezel = pillH * 0.046;
const winW = box.width - bezel * 2;
const winH = pillH - bezel * 2;
const gap = pillH * 0.032;
const r0 = winH / 2 - gap;
const travel = winW - (r0 + gap) * 2;
const CX = box.x + box.width / 2;
const CY = box.y + box.height / 2;
const lensAt = (x) => CX + (x - 0.5) * travel;
const GRAB = [14, 30]; // つまみの中心から、カーソルの先がどこにあるか
const hand = (x, dy = 0) => [lensAt(x) + GRAB[0], CY + GRAB[1] + dy];
const rest = [CX + box.width * 0.34, box.y + box.height + 56]; // 見せる場面で、絵を隠さない休み場所
const outside = [VIEW.width + 60, VIEW.height * 0.82];

// ---- 筋書き（秒）。カーソルの道のりと、押す・離す
const path = [];
const events = [];
const move = (t0, t1, from, to, ease = glide) => path.push({ t0, t1, from, to, ease, curve: Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.08 });
const down = (t) => events.push({ t, run: () => page.mouse.down(), press: true });
const up = (t) => events.push({ t, run: () => page.mouse.up() });

// 1. つかみ：入ってきて、素早く弾く。住人が驚いて空を見上げる
move(0.25, 1.05, outside, hand(0));
down(1.12);
move(1.16, 1.32, hand(0), hand(0.86), quick);
up(1.34);
// 夜になる。住人は慌てて家へ
move(1.4, 2.2, hand(0.86), rest);
// 2. 押して昼へ戻す
move(3.05, 3.5, rest, [CX + box.width * 0.2, CY + 40]);
down(3.56);
up(3.62);
move(3.7, 4.5, [CX + box.width * 0.2, CY + 40], rest);
// 3. 本題：ゆっくり引くと、昼から夕方、夜へ
move(6.0, 6.75, rest, hand(0));
down(6.82);
move(6.86, 9.86, hand(0), hand(0.62, -6), sine);
move(10.4, 11.3, hand(0.62, -6), hand(0.8, -2), sine);
up(11.34);
move(11.5, 12.4, hand(0.8, -2), rest);
// 4. 見せ場：夜の灯り（じっと見せる）
// 5. 戻す：夜中を抜けて、夜明け、朝。窓を開けて伸びをする
move(15.0, 15.8, rest, hand(1));
down(15.86);
move(15.9, 17.9, hand(1), hand(0.28, 6), sine);
up(19.3);
move(19.45, 20.3, hand(0.28, 6), [outside[0], outside[1] - 60]);
// 住人が木の下へ戻るのを待って、最初の絵につなぐ
const DURATION = 22.6;
events.sort((a, b) => a.t - b.t);

const mouseAt = (t) => {
  let pos = outside;
  for (const p of path) {
    if (t < p.t0) break;
    const u = p.ease(seg(t, p.t0, p.t1));
    // ゆるく弧を描く
    const bow = Math.sin(Math.PI * u) * p.curve;
    const dx = p.to[0] - p.from[0];
    const dy = p.to[1] - p.from[1];
    const len = Math.hypot(dx, dy) || 1;
    pos = [p.from[0] + dx * u + (-dy / len) * bow * 0.5, p.from[1] + dy * u + (dx / len) * bow * 0.5];
  }
  return pos;
};

const totalFrames = Math.round(DURATION * FPS);
const started = Date.now();
let shotMs = 0;
let nextEvent = 0;
let lastMouse = null;
const presses = events.filter((e) => e.press).map((e) => e.t);

for (let frame = 0; frame < totalFrames; frame++) {
  const t = frame / FPS;
  const pos = mouseAt(t);
  if (!lastMouse || pos[0] !== lastMouse[0] || pos[1] !== lastMouse[1]) {
    await page.mouse.move(pos[0], pos[1]);
    lastMouse = pos;
  }
  while (nextEvent < events.length && events[nextEvent].t <= t) {
    await events[nextEvent].run();
    nextEvent += 1;
  }
  await page.evaluate((ms) => window.__vt.step(ms), 1000 / FPS);

  const since = presses.map((p) => t - p).filter((d) => d >= 0).pop() ?? 9;
  const squeeze = since < 0.07 ? since / 0.07 : since < 0.22 ? 1 - (since - 0.07) / 0.15 : 0;
  await page.evaluate(([x, y, s]) => window.__stage.draw(x, y, s), [pos[0], pos[1], squeeze]);
  await page.evaluate(() => window.__vt.painted());

  const shotStart = Date.now();
  const png = await page.screenshot({ type: 'png', caret: 'initial' });
  shotMs += Date.now() - shotStart;
  await writeFrame(png);

  if (frame % 120 === 0) console.log(`${t.toFixed(1)}秒 / ${DURATION}秒（${Math.round((Date.now() - started) / 1000)}秒経過）`);
}

ffmpeg.stdin.end();
await ffmpegDone;
await browser.close();

console.log(`1枚の撮影: 平均 ${(shotMs / totalFrames).toFixed(0)}ms（60fps の余裕は 16.7ms）`);
console.log(`かかった時間: ${((Date.now() - started) / 1000).toFixed(0)}秒`);
console.log(`出力: ${OUT}（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
