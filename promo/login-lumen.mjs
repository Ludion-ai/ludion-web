// login-lumen の宣伝動画を作る。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/login-lumen.mjs
// 出力：promo/out/login-lumen-768.mp4（1080×1440、H.264、30fps、18秒）
//
// 時間を止めて1コマずつ撮る。1枚の撮影が 1/30 秒より長いので、そのままの録画ではかくつくため。
// - requestAnimationFrame、performance.now、Date.now、setTimeout を仮想の時間に差し替える
// - CSS の transition と animation は、Web Animations で止め、仮想の時間に合わせて進める
// - 作品は「1フレームが 20ms を超えると遅い機械」と判断して解像度を下げる。
//   1コマ（1/30秒）を 1/60 秒ずつ2回に分けて進め、作品から見て 60fps で動いているようにする
// カーソル、光の輪、キャレット、フェード、最後の1枚は、作品の外の重ね絵として描く。works/ は変えない。

import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { buildFrameHtml } from '@ludion/render';
import { findWork, readWork, toRenderable } from '../packages/ld/src/workspace.ts';

const ffmpegPath = ffmpegInstaller.path;
const WORK_ID = 'login-lumen';
const VIEW = { width: 768, height: 1024 };
const SCALE = 1.40625; // 768 → 1080、1024 → 1440
const FPS = 30;
const DURATION = 18;
const FRAME_URL = 'http://ld-frame.localhost/';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), 'out/login-lumen-768.mp4');

// ---- 筋書き（秒）
const TIME = {
  fadeIn: [0, 1],
  cursorIn: [3, 6],
  toEmail: [6, 6.7],
  clickEmail: 6.75,
  typeEmail: [6.95, 9.85],
  toPassword: [9.9, 10.4],
  clickPassword: 10.45,
  typePassword: [10.65, 11.65],
  toButton: [11.7, 12.2],
  clickButton: 12.25,
  endCard: [15, 15.5],
  endText: [15.35, 16.05],
};
const EMAIL = 'hello@ludion.ai';
const PASSWORD = 'lumen-city';

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, [from, to]) => clamp((t - from) / (to - from));
// ゆっくり動き出し、なめらかに減速して止まる
const glide = (t) => 1 - Math.pow(1 - Math.pow(clamp(t), 1.6), 3);
const smooth = (t) => t * t * (3 - 2 * t);
const bezier = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
};

/** 人が打つ間合い。文字ごとに少し揺らし、全体を [from, to] に収める（毎回同じ結果）。 */
function typingTimes(text, [from, to], seed) {
  let a = seed;
  const rand = () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
  const gaps = [...text].map((ch) => (ch === '@' || ch === '.' ? 1.5 : 1) * (0.72 + rand() * 0.56));
  const total = gaps.reduce((s, g) => s + g, 0);
  let t = from;
  return gaps.map((gap) => {
    const at = t;
    t += (gap / total) * (to - from);
    return at;
  });
}

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
  // 光の脈のリブの選び方を毎回同じにする
  let seed = 20261108;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const started = new WeakMap();
  const syncAnimations = () => {
    const host = document.getElementById('ld-host');
    const list = new Set([...document.getAnimations(), ...(host?.shadowRoot?.getAnimations() ?? [])]);
    for (const a of list) {
      if (!started.has(a)) started.set(a, v.now);
      a.pause();
      const elapsed = v.now - started.get(a);
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      if (elapsed >= end) a.finish();
      else a.currentTime = elapsed;
    }
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
      syncAnimations();
    },
    painted: () => new Promise((done) => realRaf(() => realRaf(done))),
  };
}

// ---- ページの中：重ね絵
function installOverlay() {
  const host = document.getElementById('ld-host');
  const root = host.shadowRoot.querySelector('[data-ld-part]');
  const accent = getComputedStyle(root).getPropertyValue('--_accent').trim();
  const font = '"Hiragino Sans", "Yu Gothic UI", "Noto Sans JP", system-ui, sans-serif';

  // 本物のキャレットは撮影のたびに点滅の位相がずれるので消し、重ね絵で描く
  const hide = document.createElement('style');
  hide.textContent = '.input{caret-color:transparent!important}';
  host.shadowRoot.append(hide);

  const layer = (z) => {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: String(z) });
    document.body.append(el);
    return el;
  };
  const marks = layer(100);

  const caret = document.createElement('div');
  Object.assign(caret.style, { position: 'absolute', width: '2px', height: '22px', background: accent, display: 'none' });
  marks.append(caret);

  const ring = document.createElement('div');
  Object.assign(ring.style, { position: 'absolute', borderRadius: '50%', border: `2px solid ${accent}`, boxShadow: `0 0 18px ${accent}`, display: 'none' });
  marks.append(ring);

  // 矢印：ふつうの約2倍。白に薄い影。先端が (0, 0)
  const NS = 'http://www.w3.org/2000/svg';
  const cursor = document.createElementNS(NS, 'svg');
  cursor.setAttribute('viewBox', '0 0 24 36');
  cursor.setAttribute('width', '24');
  cursor.setAttribute('height', '36');
  Object.assign(cursor.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    transformOrigin: '0 0',
    overflow: 'visible',
    filter: 'drop-shadow(0 3px 5px rgb(15 36 41 / .32))',
    display: 'none',
  });
  const arrow = document.createElementNS(NS, 'path');
  arrow.setAttribute('d', 'M1 1 L1 28 L7.6 22 L12 33 L16.6 31 L12.2 20.4 L21 20.4 Z');
  arrow.setAttribute('fill', '#ffffff');
  arrow.setAttribute('stroke', 'rgb(15 36 41 / .55)');
  arrow.setAttribute('stroke-width', '1.1');
  arrow.setAttribute('stroke-linejoin', 'round');
  cursor.append(arrow);
  marks.append(cursor);

  const black = layer(300);
  black.style.background = '#000000';

  const card = layer(200);
  Object.assign(card.style, {
    background: '#ffffff',
    display: 'grid',
    placeContent: 'center',
    justifyItems: 'center',
    gap: '22px',
    opacity: '0',
    fontFamily: font,
    color: '#111114',
    textAlign: 'center',
  });
  const words = document.createElement('div');
  words.textContent = '辞書を渡して、作った。';
  Object.assign(words.style, { fontSize: '40px', lineHeight: '1.4', fontWeight: '300', fontFeatureSettings: '"palt"' });
  const sign = document.createElement('div');
  sign.textContent = 'Ludion — @Lattice_Node';
  Object.assign(sign.style, { fontSize: '15px', lineHeight: '1.6', fontWeight: '400', color: '#6b6b76', letterSpacing: '.02em' });
  const text = document.createElement('div');
  Object.assign(text.style, { display: 'grid', justifyItems: 'center', gap: '22px', opacity: '0' });
  text.append(words, sign);
  card.append(text);

  const measure = new OffscreenCanvas(1, 1).getContext('2d');

  window.__overlay = {
    draw(s) {
      black.style.opacity = String(s.black);
      card.style.opacity = String(s.card);
      text.style.opacity = String(s.text);

      if (s.cursor) {
        cursor.style.display = 'block';
        cursor.style.transform = `translate(${s.cursor.x}px, ${s.cursor.y}px) scale(${s.cursor.scale})`;
      } else {
        cursor.style.display = 'none';
      }

      if (s.ring) {
        const size = s.ring.size;
        Object.assign(ring.style, {
          display: 'block',
          width: `${size}px`,
          height: `${size}px`,
          transform: `translate(${s.ring.x - size / 2}px, ${s.ring.y - size / 2}px)`,
          opacity: String(s.ring.opacity),
        });
      } else {
        ring.style.display = 'none';
      }

      const input = host.shadowRoot.activeElement;
      if (s.caretOn && input && input.matches('.input')) {
        const box = input.getBoundingClientRect();
        const style = getComputedStyle(input);
        measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const shown = input.type === 'password' ? '•'.repeat(input.value.length) : input.value;
        const x = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) + measure.measureText(shown).width;
        caret.style.display = 'block';
        caret.style.transform = `translate(${x}px, ${box.top + box.height / 2 - 11}px)`;
      } else {
        caret.style.display = 'none';
      }
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
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-r', String(FPS),
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
const writeFrame = (buffer) =>
  new Promise((done, fail) => ffmpeg.stdin.write(buffer, (error) => (error ? fail(error) : done())));

// WebGL は実際の GPU を使う（使えなければ Chromium がソフトウェア描画に落とす。時間を止めるので絵は同じ）
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
await page.evaluate(() => document.fonts.ready);
await page.evaluate(installOverlay);
await page.evaluate(() => window.__vt.painted());

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return 'WebGL2 なし';
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

const centerOf = async (selector, dx = 0) => {
  const box = await page.locator(selector).boundingBox();
  return [box.x + box.width / 2 + dx, box.y + box.height / 2];
};

// 打つ文字を時刻つきの出来事にする
const events = [];
const at = (time, run) => events.push({ time, run });
const press = async () => {
  await page.mouse.down();
  await page.mouse.up();
};
const clicks = [];
const click = (time) => {
  at(time, press);
  clicks.push(time);
};
click(TIME.clickEmail);
click(TIME.clickPassword);
click(TIME.clickButton);
let lastKey = -10;
const type = (text, times) => [...text].forEach((ch, i) => at(times[i], async () => {
  await page.keyboard.type(ch);
  lastKey = times[i];
}));
type(EMAIL, typingTimes(EMAIL, TIME.typeEmail, 11));
type(PASSWORD, typingTimes(PASSWORD, TIME.typePassword, 29));
events.sort((a, b) => a.time - b.time);

// カーソルの通り道は、フォームが出そろってから測る
let path = null;
const buildPath = async () => {
  const email = await centerOf('#ll-email', -70);
  const password = await centerOf('#ll-password', -40);
  const button = await centerOf('.submit', 30);
  const rest = [232, 610]; // ガラスを右から左へ横切り終えるところ（カードは x 184〜584、y 298〜725）
  path = [
    { span: TIME.cursorIn, from: [812, 400], c1: [640, 420], c2: [430, 540], to: rest, ease: (t) => 1 - Math.pow(1 - t, 1.9) },
    { span: TIME.toEmail, from: rest, c1: [rest[0] + 20, rest[1] + 20], c2: [email[0] - 20, email[1] - 20], to: email, ease: glide },
    { span: TIME.toPassword, from: email, c1: [email[0] + 30, email[1] + 20], c2: [password[0] - 10, password[1] - 24], to: password, ease: glide },
    { span: TIME.toButton, from: password, c1: [password[0] + 40, password[1] + 20], c2: [button[0] - 20, button[1] - 26], to: button, ease: glide },
  ];
};
const cursorAt = (t) => {
  if (!path || t < TIME.cursorIn[0]) return null;
  let last = path[0].from;
  for (const p of path) {
    if (t < p.span[0]) return last;
    if (t <= p.span[1]) return bezier(p.from, p.c1, p.c2, p.to, p.ease(seg(t, p.span)));
    last = p.to;
  }
  return last;
};

const totalFrames = FPS * DURATION;
const started = Date.now();
let shotMs = 0;
let nextEvent = 0;
let lastMouse = null;

for (let frame = 0; frame < totalFrames; frame++) {
  const t = frame / FPS;

  if (!path && t >= TIME.cursorIn[0]) await buildPath();

  const pos = cursorAt(t);
  if (pos && (!lastMouse || pos[0] !== lastMouse[0] || pos[1] !== lastMouse[1])) {
    await page.mouse.move(pos[0], pos[1]);
    lastMouse = pos;
  }
  while (nextEvent < events.length && events[nextEvent].time <= t) {
    await events[nextEvent].run();
    nextEvent += 1;
  }

  // 1コマを 1/60 秒ずつ2回に分けて進める
  await page.evaluate((ms) => {
    window.__vt.step(ms);
    window.__vt.step(ms);
  }, 1000 / (FPS * 2));

  // 押した瞬間：カーソルが少し縮み、光の輪が広がる
  const since = clicks.map((c) => t - c).filter((d) => d >= 0).pop() ?? Infinity;
  const squeeze = since < 0.08 ? smooth(since / 0.08) : since < 0.26 ? 1 - smooth((since - 0.08) / 0.18) : 0;
  const ringT = since / 0.55;
  const fadeCursor = 1 - seg(t, TIME.endCard);

  await page.evaluate((state) => window.__overlay.draw(state), {
    black: 1 - smooth(seg(t, TIME.fadeIn)),
    card: smooth(seg(t, TIME.endCard)),
    text: smooth(seg(t, TIME.endText)),
    cursor: pos && fadeCursor > 0 ? { x: pos[0], y: pos[1], scale: 1 - 0.18 * squeeze } : null,
    ring: pos && ringT < 1 ? { x: pos[0], y: pos[1], size: 10 + 62 * (1 - Math.pow(1 - ringT, 3)), opacity: (1 - ringT) * 0.9 } : null,
    caretOn: t < TIME.clickButton && (t - lastKey < 0.5 || Math.floor((t - lastKey) / 0.53) % 2 === 1),
  });
  await page.evaluate(() => window.__vt.painted());

  const shotStart = Date.now();
  const png = await page.screenshot({ type: 'png', caret: 'initial' });
  shotMs += Date.now() - shotStart;
  await writeFrame(png);

  if (frame % 60 === 0) console.log(`${t.toFixed(1)}秒 / ${DURATION}秒`);
}

ffmpeg.stdin.end();
await ffmpegDone;
await browser.close();

console.log(`描画: ${renderer}`);
console.log(`1枚の撮影: 平均 ${(shotMs / totalFrames).toFixed(0)}ms（30fps の余裕は 33ms）`);
console.log(`かかった時間: ${((Date.now() - started) / 1000).toFixed(0)}秒`);
console.log(`出力: ${OUT}（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
