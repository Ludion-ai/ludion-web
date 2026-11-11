// slider-resident（住人のいる音量）の動画を作る。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/slider-resident.mjs              → promo/out/slider-resident.mp4（2880×2160、H.264、60fps、AAC 48kHz ステレオ）
//   node promo/slider-resident.mjs --draft      → 下見用（1440×1080。promo/out/slider-resident-draft.mp4）
//   node promo/slider-resident.mjs --audio-only → 絵は撮り直さず、残した表から音だけ作り直す（--draft と併用できる）
//
// 切れ目のない1カット。カーソルがつまみを動かし、音量と音楽が合わせて変わる。
// 時間を止めて1コマずつ撮る（1枚の撮影が 1/60 秒より長いので、そのままの録画ではかくつくため）。
// 絵を撮りながら「コマごとの音量」と「ノックが起きたコマ」を表に書き、音はその表だけから作る。
// 曲のテンポは、作品の拍（BPM 108）にそろえる。住人の踊りとスピーカーの波が、音楽の拍に合う。
//
// 作品の外の演出と、作品へ渡す前に変えるもの。どちらも works/ のファイルは変えない。
// - カーソルの絵：OS のカーソルは写らないので、同じ座標に矢印を重ねる
// - 黒から明ける幕：作品の手前に黒い板を重ねる
// - はじめの音量：作品の既定は 72 なので、描画へ渡す HTML の value だけ 0 にする
// - ノックの目印：描画へ渡す JS の knockHit の先頭で、回数と拍を window に書く（1行。作品の動きは変わらない）

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { buildFrameHtml } from '@ludion/render';
import { findWork, readWork, toRenderable } from '../packages/ld/src/workspace.ts';

const ffmpegPath = ffmpegInstaller.path;
const DRAFT = process.argv.includes('--draft');
const AUDIO_ONLY = process.argv.includes('--audio-only');
const WORK_ID = 'slider-resident';
const VIEW = { width: 1440, height: 1080 };
const SCALE = DRAFT ? 1 : 2; // 2880×2160
const FPS = 60;
const SR = 48000;
const FRAME_URL = 'http://ld-frame.localhost/';
const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = DRAFT ? '-draft' : '';
const OUT = resolve(HERE, `out/slider-resident${TAG}.mp4`);
const SILENT = resolve(HERE, `out/slider-resident${TAG}-silent.mp4`);
const TABLE = resolve(HERE, `out/slider-resident${TAG}-table.json`);
const WAV = resolve(HERE, `out/slider-resident${TAG}-mix.wav`);
const SHEET = resolve(HERE, `out/slider-resident${TAG}-sheet.png`);

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, from, to) => clamp((t - from) / (to - from));
const glide = (t) => 1 - Math.pow(1 - Math.pow(clamp(t), 1.6), 3); // ゆっくり動き出し、なめらかに止まる
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)); // 手で引くような、ゆるい加減速
const quick = (t) => 1 - Math.pow(1 - clamp(t), 2.4); // 最後の戻し：いきなり速い
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---- 筋書き（秒）
const DURATION = 15.0; // 戻してから住人が額を直し、ソファへ歩いて座り終わるのが約 14.7 秒
const FADE = [0.05, 1.2];
const GRAB = 2.25;
const DRAGS = [
  // [始め, 終わり, 音量, 動かし方, 弧の強さ]
  [2.32, 3.85, 0.25, glide, 0.03],
  [4.2, 6.6, 0.55, glide, 0.03],
  [7.0, 9.3, 0.8, glide, 0.03],
  [10.0, 10.6, 1.0, glide, 0.02], // 98 を越えるのが約 10.4 秒。作品のコードでは、そこから 1.1 秒後にノックが始まる
  [12.5, 12.95, 0.15, quick, 0.02], // 慌てて戻す
];
const RELEASE = 13.2;
const WARM_FRAMES = 8; // 撮り始める前に進めるコマ数

// ---- 音の設計
const SEED = 20261109;
const KNOCK_PAN = 'right'; // 作品では隣の部屋は右にある。絵と音の向きをそろえる（CEO の決定。V001 の報告）
const SONG_BEATS = 21; // 音楽の始めから、最後の1拍までの拍数
const SONG_AFTER_GRAB = 0.05; // つかんでから、この時間のあとの最初の拍で曲を始める
const LOUDNESS = { I: -14, TP: -1.5, LRA: 20 }; // AAC にすると真のピークが少し上がるので、-1 より余裕を見る
const DRIVE = 1.0; // リミッターへ入れる前の大きさ
const CEILING = 1.3; // リミッターの天井（WAV は浮動小数なので 1 を越えてよい。このあと loudnorm で全体が下がる）

// ---- ページの中：時間の差し替え（toggle-daylight と同じ）
function installVirtualTime() {
  const v = { now: 0, raf: new Map(), rafId: 1, timers: new Map(), timerId: 1 };
  const realRaf = window.requestAnimationFrame.bind(window);
  const base = Date.UTC(2026, 10, 9);
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
  let seed = 20261109;
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

// ---- ページの中：カーソルの絵と、黒から明ける幕
function installStage() {
  const host = document.getElementById('ld-host');
  const root = host.shadowRoot.querySelector('[data-ld-part]');
  const input = root.querySelector('.range');

  const curtain = document.createElement('div');
  Object.assign(curtain.style, { position: 'fixed', inset: '0', zIndex: '999', background: '#000', pointerEvents: 'none' });
  document.body.append(curtain);

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
    thumb: () => parseFloat(root.style.getPropertyValue('--thumb')),
    frame(ms, x, y, squeeze, dark) {
      window.__vt.step(ms);
      cursor.style.transform = `translate(${x}px, ${y}px) scale(${1 - 0.14 * squeeze})`;
      curtain.style.opacity = String(dark);
      curtain.style.display = dark > 0 ? 'block' : 'none';
      return { value: Number(input.value), knocks: window.__ldKnock ?? 0, beat: window.__ldKnockBeat ?? null };
    },
  };
}

// ---- 絵を撮る。コマごとの音量と、ノックのコマを表にして返す
async function capture() {
  const location = findWork(WORK_ID);
  if (!location) throw new Error(`${WORK_ID} が見つからない`);
  const work = toRenderable(readWork(location));
  if (!work) throw new Error(`${WORK_ID} を描画できない`);

  // 作品のコードから読む値。作品が変わったら、ここで気づくようにする
  const source = work.js;
  const bpm = Number(/const BPM = (\d+);/.exec(source)?.[1]);
  if (!bpm) throw new Error('作品のコードから BPM を読めない');

  const KNOCK_ANCHOR = 'const knockHit = () => {';
  if (!source.includes(KNOCK_ANCHOR)) throw new Error('作品のコードに knockHit がない');
  if (!work.html.includes('value="72"')) throw new Error('作品の HTML の既定の音量が 72 ではない');
  const stagedWork = {
    ...work,
    html: work.html.replace('value="72"', 'value="0"'),
    js: source.replace(KNOCK_ANCHOR, `${KNOCK_ANCHOR} window.__ldKnock = (window.__ldKnock || 0) + 1; window.__ldKnockBeat = beat;`),
  };
  const html = buildFrameHtml(stagedWork, { palette: 'author', width: VIEW.width });

  mkdirSync(dirname(SILENT), { recursive: true });
  const ffmpeg = spawn(
    ffmpegPath,
    [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', DRAFT ? 'veryfast' : 'slow', '-crf', DRAFT ? '22' : '15', '-r', String(FPS),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      SILENT,
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
  await page.evaluate(installStage);
  await page.evaluate(() => window.__vt.painted());
  // 大きさの測りを、作品に受け取らせる
  await page.evaluate((n) => {
    for (let i = 0; i < n / 2; i++) window.__vt.step(1000 / 60);
  }, WARM_FRAMES);
  await page.evaluate(() => window.__vt.painted());
  await page.evaluate((n) => {
    for (let i = 0; i < n / 2; i++) window.__vt.step(1000 / 60);
  }, WARM_FRAMES);

  // ---- つまみの形：本物のスライダーは、つまみの中心がカーソルに合う
  const box = await page.locator('.range').boundingBox();
  const thumb = await page.evaluate(() => window.__stage.thumb());
  const CY = box.y + box.height / 2;
  const knobX = (v) => box.x + thumb / 2 + v * (box.width - thumb);
  const hand = (v) => [knobX(v), CY + box.height * 0.3]; // 住人を隠さないよう、つまみの下の方をつかむ
  const rest = [box.x + box.width * 0.46, box.y + box.height + 120];
  const outside = [-60, VIEW.height * 0.82];

  // ---- カーソルの道のり
  const path = [];
  const move = (t0, t1, from, to, ease = glide, bow = 0.08) => path.push({ t0, t1, from, to, ease, curve: Math.hypot(to[0] - from[0], to[1] - from[1]) * bow });
  move(1.45, 2.18, outside, hand(0));
  let at = 0;
  for (const [t0, t1, v, ease, bow] of DRAGS) {
    move(t0, t1, hand(at), hand(v), ease, bow);
    at = v;
  }
  move(13.35, 14.2, hand(at), rest, sine);

  const mouseAt = (t) => {
    let pos = outside;
    for (const p of path) {
      if (t < p.t0) break;
      const u = p.ease(seg(t, p.t0, p.t1));
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
  let lastMouse = null;
  let pressed = false;
  let released = false;
  let knocksSeen = 0;
  const values = [];
  const knockFrames = [];
  const knockBeats = [];
  let grabFrame = -1;

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / FPS;
    const pos = mouseAt(t);
    if (!lastMouse || pos[0] !== lastMouse[0] || pos[1] !== lastMouse[1]) {
      await page.mouse.move(pos[0], pos[1]);
      lastMouse = pos;
    }
    if (!pressed && t >= GRAB) {
      await page.mouse.down();
      pressed = true;
      grabFrame = frame;
    }
    if (!released && t >= RELEASE) {
      await page.mouse.up();
      released = true;
    }
    const since = pressed ? t - GRAB : 9;
    const squeeze = since < 0.07 ? since / 0.07 : since < 0.22 ? 1 - (since - 0.07) / 0.15 : 0;
    const dark = 1 - sine(seg(t, FADE[0], FADE[1]));
    const state = await page.evaluate(([ms, x, y, s, d]) => window.__stage.frame(ms, x, y, s, d), [1000 / FPS, pos[0], pos[1], squeeze, dark]);
    values.push(state.value);
    if (state.knocks > knocksSeen) {
      knocksSeen = state.knocks;
      knockFrames.push(frame);
      knockBeats.push(state.beat);
    }
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
  console.log(`1枚の撮影: 平均 ${(shotMs / totalFrames).toFixed(0)}ms。かかった時間: ${((Date.now() - started) / 1000).toFixed(0)}秒`);

  const table = {
    fps: FPS,
    totalFrames,
    grabFrame,
    knockFrames,
    knockBeats,
    values,
    bpm,
    wall: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
  writeFileSync(TABLE, JSON.stringify(table));
  return table;
}

// ---- 音を作る
function lfsrNoise(seed) {
  // 8ビットのゲーム機のノイズと同じ作りの、15ビットのシフトレジスタ
  let reg = (seed & 0x7fff) || 1;
  return () => {
    const bit = (reg ^ (reg >> 1)) & 1;
    reg = (reg >> 1) | (bit << 14);
    return reg & 1 ? 1 : -1;
  };
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const blep = (p, dt) => {
  if (p < dt) {
    const x = p / dt;
    return x + x - x * x - 1;
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};
const envelope = (t, dur, { a, d, s, r }) => {
  if (t < a) return t / a;
  const held = t < a + d ? 1 - ((t - a) / d) * (1 - s) : s;
  if (t < dur) return held;
  return Math.max(0, held * (1 - (t - dur) / r));
};
// 矩形波（幅を変えられる。ふちの折り返しを抑える）
function addPulse(buf, t0, dur, midi, duty, vel, env, vibrato = 0) {
  const start = Math.round(t0 * SR);
  const n = Math.round((dur + env.r) * SR);
  const f = mtof(midi);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / SR;
    const wob = vibrato && t > 0.16 ? 1 + vibrato * Math.sin(2 * Math.PI * 5.5 * (t - 0.16)) : 1;
    const dt = (f * wob) / SR;
    phase += dt;
    if (phase >= 1) phase -= 1;
    let w = phase < duty ? 1 : -1;
    w += blep(phase, dt);
    w -= blep((phase - duty + 1) % 1, dt);
    buf[start + i] += w * vel * envelope(t, dur, env);
  }
}
// 三角波（16段に刻む。8ビットのベースの手ざわり）
function addTriangle(buf, t0, dur, midi, vel, env) {
  const start = Math.round(t0 * SR);
  const n = Math.round((dur + env.r) * SR);
  const f = mtof(midi);
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / SR;
    const p = (t * f) % 1;
    const tri = 1 - 4 * Math.abs(p - 0.5);
    const stepped = Math.round(tri * 7.5) / 7.5;
    buf[start + i] += stepped * vel * envelope(t, dur, env);
  }
}
// 音程の下がるキック（正弦波）
function addKick(buf, t0, vel) {
  const start = Math.round(t0 * SR);
  const n = Math.round(0.26 * SR);
  let phase = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / SR;
    phase += (58 + 130 * Math.exp(-t / 0.028)) / SR;
    buf[start + i] += Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.085) * vel;
  }
}
// ノイズのスネア（少しだけ胴の音）
function addSnare(buf, t0, vel, noise) {
  const start = Math.round(t0 * SR);
  const n = Math.round(0.22 * SR);
  let held = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / SR;
    if (i % 3 === 0) held = noise();
    const body = Math.sin(2 * Math.PI * (178 + 40 * Math.exp(-t / 0.02)) * t) * Math.exp(-t / 0.045) * 0.5;
    buf[start + i] += (held * Math.exp(-t / 0.075) + body) * vel;
  }
}
function addHat(buf, t0, vel, decay, noise) {
  const start = Math.round(t0 * SR);
  const n = Math.round(decay * 6 * SR);
  let prev = 0;
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const w = noise();
    buf[start + i] += (w - prev) * 0.5 * Math.exp(-i / SR / decay) * vel;
    prev = w;
  }
}

// ノックの音「ドン」：壁を拳で叩く、低く重い音（正弦波とノイズ）。作品の文字も「ドン」。大きさは1くらいの片チャンネル分
function knockVoice(index) {
  const pick = mulberry(SEED + 500 + index);
  const pitch = 1 + (pick() - 0.5) * 0.06;
  const noise = lfsrNoise(SEED + 600 + index);
  const n = Math.round(0.3 * SR);
  const out = new Float32Array(n);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    phase += ((66 + 52 * Math.exp(-t / 0.028)) * pitch) / SR;
    const thump = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.1); // 音程の少し下がる、低い胴
    const body = Math.sin(2 * Math.PI * 172 * pitch * t) * Math.exp(-t / 0.05) * 0.7; // 壁の鳴り
    // スマホのスピーカーは 300Hz より下がほとんど出ないので、その上の鳴りも持たせる
    const box = Math.sin(2 * Math.PI * 305 * pitch * t) * Math.exp(-t / 0.035) * 0.75;
    const panel = Math.sin(2 * Math.PI * 470 * pitch * t) * Math.exp(-t / 0.028) * 0.6;
    lp += (noise() - lp) * 0.16;
    // 波の頭を丸める。ピークのわりに大きく聞こえる
    out[i] = Math.tanh(2.6 * (thump + body + box + panel + lp * Math.exp(-t / 0.01))) / Math.tanh(2.6);
  }
  return out;
}

// ---- 曲：4小節（新しく書いた旋律。G、Bm、C、D）
const NOTE = { A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, Fs5: 78, G5: 79, A5: 81 };
const MELODY = [
  [[0, NOTE.D5, 2], [2, NOTE.G5, 2], [4, NOTE.A5, 2], [6, NOTE.G5, 1], [7, NOTE.D5, 3], [10, NOTE.B4, 2], [12, NOTE.D5, 2], [14, NOTE.E5, 2]],
  [[0, NOTE.Fs5, 3], [3, NOTE.D5, 3], [6, NOTE.A4, 2], [8, NOTE.B4, 2], [10, NOTE.D5, 2], [12, NOTE.Fs5, 2], [14, NOTE.A5, 2]],
  [[0, NOTE.G5, 2], [2, NOTE.E5, 2], [4, NOTE.C5, 3], [7, NOTE.E5, 1], [8, NOTE.G5, 2], [10, NOTE.A5, 2], [12, NOTE.G5, 2], [14, NOTE.E5, 2]],
  [[0, NOTE.Fs5, 4], [4, NOTE.D5, 2], [6, NOTE.E5, 1], [7, NOTE.Fs5, 1], [8, NOTE.A5, 3], [11, NOTE.Fs5, 3], [14, NOTE.D5, 2]],
];
const BASS_ROOT = [43, 47, 48, 50]; // G2、B2、C3、D3
const ARP = [
  [79, 83, 86], // G、B、D
  [78, 83, 86], // F#、B、D
  [79, 84, 88], // G、C、E
  [78, 81, 86], // F#、A、D
];
const STEPS_PER_LOOP = 64;

function beatGrid(table) {
  // 音楽の拍を、作品の拍（住人の動きとスピーカーの波）に合わせる。基準は、最初のノックのコマで作品の中から読んだ拍
  const perSec = table.bpm / 60;
  const refTime = table.knockFrames[0] / table.fps;
  const refBeat = table.knockBeats[0];
  const timeOfBeat = (n) => refTime + (n - refBeat) / perSec;
  const startAfter = table.grabFrame / table.fps + SONG_AFTER_GRAB;
  const n = Math.ceil(refBeat + (startAfter - refTime) * perSec);
  return { beatSec: 1 / perSec, stepSec: 1 / perSec / 4, songStart: timeOfBeat(n), startBeat: n, timeOfBeat };
}

function synthesize(table) {
  const N = Math.round((table.totalFrames / table.fps) * SR);
  const grid = beatGrid(table);
  const finalAt = grid.songStart + SONG_BEATS * grid.beatSec;
  if (finalAt > table.totalFrames / table.fps - 0.25) throw new Error('最後の1拍が動画の終わりに近すぎる');

  // 楽器ごとの音（まだ大きさを決めない）
  const stem = () => new Float32Array(N);
  const lead = stem();
  const sparkle = stem();
  const arpL = stem();
  const arpR = stem();
  const bass = stem();
  const kick = stem();
  const snare = stem();
  const hat = stem();
  const snareNoise = lfsrNoise(SEED + 1);
  const hatNoise = lfsrNoise(SEED + 2);

  const totalSteps = SONG_BEATS * 4;
  // 最後の1拍が曲の頭（G）に来るよう、途中の小節から入る。始めは小さくこもっているので、弱起に聞こえる
  const offset = (((-totalSteps) % STEPS_PER_LOOP) + STEPS_PER_LOOP) % STEPS_PER_LOOP;
  const LEAD_ENV = { a: 0.003, d: 0.1, s: 0.62, r: 0.03 };
  const ARP_ENV = { a: 0.002, d: 0.07, s: 0.18, r: 0.02 };
  const BASS_ENV = { a: 0.002, d: 0.16, s: 0.72, r: 0.02 };
  for (let s = 0; s < totalSteps; s++) {
    const pos = (s + offset) % STEPS_PER_LOOP;
    const bar = pos >> 4;
    const step = pos & 15;
    const t = grid.songStart + s * grid.stepSec;
    for (const [at, midi, len] of MELODY[bar]) {
      if (at !== step) continue;
      // 最後の1拍へ入る前で切る
      const dur = Math.min(len * grid.stepSec * 0.92, finalAt - t - 0.01);
      if (dur <= 0.01) continue;
      addPulse(lead, t, dur, midi, 0.25, 1, LEAD_ENV, 0.004);
      addPulse(sparkle, t, dur, midi + 12, 0.125, 1, LEAD_ENV, 0.004);
    }
    const chord = ARP[bar];
    addPulse(s % 2 === 0 ? arpL : arpR, t, grid.stepSec * 0.7, chord[[0, 1, 2, 1][s & 3]], 0.125, 1, ARP_ENV);
    if ((step & 1) === 0) {
      const r = BASS_ROOT[bar];
      const offs = [0, 0, 12, 0, 7, 0, 12, 7];
      addTriangle(bass, t, grid.stepSec * 1.7, r + offs[step >> 1], 1, BASS_ENV);
    }
    if (step === 0 || step === 8 || step === 10) addKick(kick, t, 1);
    if (step === 4 || step === 12 || (bar === 3 && (step === 13 || step === 15))) addSnare(snare, t, step % 4 === 0 ? 1 : 0.55, snareNoise);
    if ((step & 1) === 0) addHat(hat, t, step === 14 ? 0.8 : 1, step === 14 ? 0.07 : 0.016, hatNoise);
  }
  // 最後の1拍：主音の和音を短く
  const lastDur = grid.stepSec * 2.4;
  addPulse(lead, finalAt, lastDur, NOTE.G5, 0.25, 1, LEAD_ENV);
  addPulse(sparkle, finalAt, lastDur, NOTE.G5 + 12, 0.125, 1, LEAD_ENV);
  addPulse(arpL, finalAt, lastDur, 83, 0.125, 1.1, { a: 0.002, d: 0.14, s: 0.3, r: 0.03 });
  addPulse(arpR, finalAt, lastDur, 86, 0.125, 1.1, { a: 0.002, d: 0.14, s: 0.3, r: 0.03 });
  addTriangle(bass, finalAt, lastDur, BASS_ROOT[0], 1, BASS_ENV);
  addKick(kick, finalAt, 1);

  // コマごとの音量を、サンプルごとにする（線でつなぎ、ごく短くならす）
  const volume = new Float32Array(N);
  let sm = 0;
  const smA = 1 - Math.exp(-1 / (0.012 * SR));
  for (let i = 0; i < N; i++) {
    const fPos = (i / SR) * table.fps;
    const f0 = Math.min(table.values.length - 1, Math.floor(fPos));
    const f1 = Math.min(table.values.length - 1, f0 + 1);
    const raw = (table.values[f0] + (table.values[f1] - table.values[f0]) * (fPos - f0)) / 100;
    sm += (raw - sm) * smA;
    volume[i] = sm;
  }
  // 住人が眠っている間だけ、寝息を出す（音量0のコマから決める）
  const asleep = new Float32Array(N);
  let as = 1;
  const asA = 1 - Math.exp(-1 / (0.12 * SR));
  for (let i = 0; i < N; i++) {
    const f = Math.min(table.values.length - 1, Math.floor((i / SR) * table.fps));
    as += ((table.values[f] === 0 && i / SR < GRAB + 0.05 ? 1 : 0) - as) * asA;
    asleep[i] = as;
  }

  const knocks = table.knockFrames.map((f) => (f / table.fps) * SR);
  const duck = new Float32Array(N).fill(1);
  for (const at of knocks) {
    for (let i = Math.round(at - 0.002 * SR); i < Math.min(N, at + 0.7 * SR); i++) {
      if (i < 0) continue;
      const t = (i - at) / SR;
      const d = t < 0 ? 1 - 0.93 * (1 + t / 0.002) : 1 - 0.93 * Math.exp(-t / 0.13);
      duck[i] = Math.min(duck[i], d);
    }
  }

  // 響き（小さな部屋）。短い櫛形の遅延を左右で少しずらす
  const combs = [
    { len: Math.round(0.0231 * SR), side: 0 },
    { len: Math.round(0.0373 * SR), side: 0 },
    { len: Math.round(0.0291 * SR), side: 1 },
    { len: Math.round(0.0417 * SR), side: 1 },
  ].map((c) => ({ ...c, buf: new Float32Array(c.len), at: 0 }));

  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const onePole = (fc) => 1 - Math.exp((-2 * Math.PI * fc) / SR);
  // ヘッドホンの音漏れの帯域
  const leakHpA = onePole(1000);
  const leakLpA = onePole(2600);
  let hp1 = 0;
  let hp2 = 0;
  let leakLp1 = 0;
  let leakLp2 = 0;
  // スピーカーの明るさ
  let brightL1 = 0;
  let brightL2 = 0;
  let brightR1 = 0;
  let brightR2 = 0;

  for (let i = 0; i < N; i++) {
    const v = volume[i];
    const open = smooth(0.3, 0.52, v); // ヘッドホン → スピーカー
    const bright = smooth(0.62, 0.86, v); // 大きく、明るく
    const peak = smooth(0.9, 1, v); // いちばん大きいところ
    const fadeIn = smooth(0, 0.04, v);
    const db = -24 + 24 * Math.pow(v, 0.85);
    const master = fadeIn * Math.pow(10, db / 20) * duck[i];

    // こもった音：主旋律とアルペジオとシンバルの音だけが、片耳のように細く漏れる
    const leakIn = lead[i] + (arpL[i] + arpR[i]) * 0.6 + hat[i] * 0.5;
    hp1 += (leakIn - hp1) * leakHpA;
    hp2 += (leakIn - hp1 - hp2) * leakHpA;
    const hpOut = leakIn - hp1 - hp2;
    leakLp1 += (hpOut - leakLp1) * leakLpA;
    leakLp2 += (leakLp1 - leakLp2) * leakLpA;
    const leak = leakLp2 * 1.3 * (1 - open);

    // 広がった音：左右に分かれ、低音と太鼓が入る
    const arpGain = 0.24 + 0.14 * bright;
    const dryL = lead[i] * 0.48 + arpL[i] * arpGain + arpR[i] * arpGain * (1 - open * 0.85) + sparkle[i] * 0.24 * bright * 0.55 + hat[i] * (0.13 + 0.16 * bright) * 0.8;
    const dryR = lead[i] * 0.48 + arpR[i] * arpGain + arpL[i] * arpGain * (1 - open * 0.85) + sparkle[i] * 0.24 * bright + hat[i] * (0.13 + 0.16 * bright);
    // 音量が上がるほど、こもりがとれる
    const fc = 2400 * Math.pow(16000 / 2400, Math.max(open * 0.45, bright));
    const a = onePole(fc);
    brightL1 += (dryL - brightL1) * a;
    brightL2 += (brightL1 - brightL2) * a;
    brightR1 += (dryR - brightR1) * a;
    brightR2 += (brightR1 - brightR2) * a;
    const low = bass[i] * 0.22 + kick[i] * (0.32 + 0.05 * peak) + snare[i] * 0.36;

    let spL = (brightL2 + low) * open;
    let spR = (brightR2 + low) * open;
    // 響きへ送る
    let wetL = 0;
    let wetR = 0;
    for (const c of combs) {
      const out = c.buf[c.at];
      c.buf[c.at] = (c.side === 0 ? spL : spR) * 0.5 + out * 0.42;
      c.at = (c.at + 1) % c.len;
      if (c.side === 0) wetL += out;
      else wetR += out;
    }
    const wet = 0.14 + 0.08 * bright;
    spL += wetL * wet;
    spR += wetR * wet;

    L[i] = (leak + spL) * master * DRIVE;
    R[i] = (leak + spR) * master * DRIVE;
  }

  // ---- 音楽の外の音（音量のつまみに関係しない）
  const roomPick = mulberry(SEED + 10);
  const breathNoise = lfsrNoise(SEED + 11);
  let roomL1 = 0;
  let roomL2 = 0;
  let roomR1 = 0;
  let roomR2 = 0;
  const roomA = onePole(170);
  let breathHeld = 0;
  let bLp = 0;
  let bHp = 0;
  const bLpA = onePole(1500);
  const bHpA = onePole(380);
  const roomGain = Math.pow(10, -46 / 20);
  const breathGain = Math.pow(10, -33 / 20);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    // 部屋の気配：とても低いノイズが、ゆっくり揺れる
    roomL1 += (roomPick() * 2 - 1 - roomL1) * roomA;
    roomL2 += (roomL1 - roomL2) * roomA;
    roomR1 += (roomPick() * 2 - 1 - roomR1) * roomA;
    roomR2 += (roomR1 - roomR2) * roomA;
    const sway = 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.17 * t + 1);
    const roomOn = smooth(0, 0.5, t);
    L[i] += roomL2 * 6 * roomGain * sway * roomOn;
    R[i] += roomR2 * 6 * roomGain * sway * roomOn;
    // 寝息：吸って吐く。大きさも音も粗い段で動く（8ビットの手ざわり）
    if (asleep[i] > 0.0005) {
      const cycle = (t + 0.55) / 2.4;
      const ph = cycle - Math.floor(cycle);
      const inhale = ph < 0.36;
      const shape = inhale ? 0.55 * Math.pow(Math.sin((Math.PI * ph) / 0.36), 2) : ph < 0.95 ? Math.pow(Math.sin((Math.PI * (ph - 0.36)) / 0.59), 2) : 0;
      const stepped = Math.round(shape * 15) / 15; // 16段
      const clock = inhale ? 2800 : 2100;
      if (Math.floor(((i - 1) / SR) * clock) !== Math.floor(t * clock)) breathHeld = breathNoise();
      bLp += (breathHeld - bLp) * bLpA;
      bHp += (bLp - bHp) * bHpA;
      const b = (bLp - bHp) * stepped * breathGain * asleep[i] * smooth(0.05, 0.5, t);
      L[i] += b;
      R[i] += b;
    }
  }

  // つまみをつかむ小さな音（正弦波とノイズ。つまみのある左寄り）
  {
    const start = Math.round((table.grabFrame / table.fps) * SR);
    const noise = lfsrNoise(SEED + 20);
    for (let i = 0; i < 0.05 * SR && start + i < N; i++) {
      const t = i / SR;
      const s = (Math.sin(2 * Math.PI * 1650 * t) * Math.exp(-t / 0.006) * 0.6 + Math.sin(2 * Math.PI * 520 * t) * Math.exp(-t / 0.012) + noise() * Math.exp(-t / 0.002) * 0.4) * 0.07;
      L[start + i] += s * 1;
      R[start + i] += s * 0.62;
    }
  }

  // ノック（隣の部屋のある側を大きく、反対側は小さく少し遅れて）
  const nearSide = KNOCK_PAN === 'left' ? L : R;
  const farSide = KNOCK_PAN === 'left' ? R : L;
  const farDelay = Math.round(0.00045 * SR);
  knocks.forEach((at, index) => {
    const voice = knockVoice(index);
    const start = Math.round(at);
    for (let i = 0; i < voice.length; i++) {
      if (start + i < N) nearSide[start + i] += voice[i] * 1.2;
      if (start + i + farDelay < N) farSide[start + i + farDelay] += voice[i] * 0.34;
    }
  });

  // リミッター：先読みして、天井を越えないよう下げる（割れないように）
  const need = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const m = Math.max(Math.abs(L[i]), Math.abs(R[i]));
    need[i] = m > CEILING ? CEILING / m : 1;
  }
  const attackStep = 1 / (0.003 * SR);
  const releaseStep = 1 / (0.14 * SR);
  for (let i = N - 2; i >= 0; i--) need[i] = Math.min(need[i], need[i + 1] + attackStep);
  let limited = 0;
  for (let i = 1; i < N; i++) {
    need[i] = Math.min(need[i], need[i - 1] + releaseStep);
    if (need[i] < 0.999) limited += 1;
  }
  for (let i = 0; i < N; i++) {
    L[i] *= need[i];
    R[i] *= need[i];
  }
  // 終わりで音が切れないよう、最後の 80ms を閉じる
  for (let i = 0; i < 0.08 * SR; i++) {
    const g = i / (0.08 * SR);
    L[N - 1 - i] *= g;
    R[N - 1 - i] *= g;
  }
  console.log(`リミッターが効いた割合: ${((limited / N) * 100).toFixed(1)}%`);
  return { L, R, N, grid, finalAt };
}

function writeWav(path, L, R) {
  const frames = L.length;
  const dataBytes = frames * 2 * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); // 32ビット浮動小数
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 8, 28);
  buf.writeUInt16LE(8, 32);
  buf.writeUInt16LE(32, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    buf.writeFloatLE(L[i], 44 + i * 8);
    buf.writeFloatLE(R[i], 48 + i * 8);
  }
  writeFileSync(path, buf);
  return createHash('sha256').update(buf).digest('hex');
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`);
  return r;
}
const lastJson = (text) => JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1));

// ---- 大きさを整えて、絵と合わせる。つまみで作った大小を潰さないよう、loudnorm は2回かけて「全体を同じだけ上げ下げする」形だけを使う
function mux(table) {
  const af = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
  const first = run(ffmpegPath, ['-hide_banner', '-i', WAV, '-af', `${af}:print_format=json`, '-f', 'null', '-']);
  const m = lastJson(first.stderr);
  console.log('loudnorm 1回目:', JSON.stringify(m));
  const second = `${af}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:print_format=json`;
  const seconds = table.totalFrames / table.fps;
  const done = run(ffmpegPath, [
    '-y', '-hide_banner',
    '-i', SILENT, '-i', WAV,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-af', second,
    '-ar', String(SR), '-ac', '2', '-c:a', 'aac', '-b:a', '256k',
    '-t', String(seconds),
    '-movflags', '+faststart',
    OUT,
  ]);
  const applied = lastJson(done.stderr);
  console.log('loudnorm 2回目:', JSON.stringify(applied));
  if (applied.normalization_type !== 'linear') throw new Error(`loudnorm が ${applied.normalization_type} になった。音量の大小が潰れるので止める`);
}

function makeSheet(table) {
  const cols = 5;
  const rows = Math.ceil(table.totalFrames / table.fps / cols);
  run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT, '-vf', `select='not(mod(n\\,${table.fps}))',scale=720:-1,tile=${cols}x${rows}:padding=6:margin=6`, '-vsync', '0', '-frames:v', '1', SHEET]);
}

// ---- 完成した mp4 を測る
function decodePcm(file) {
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a', '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const view = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  const n = view.length >> 1;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = view[i * 2];
    R[i] = view[i * 2 + 1];
  }
  return { L, R, n };
}

// ノックの音の形を、完成した音の中から探す（AAC の遅れがあれば、ここに出る）
function findKnocks(table, pcm) {
  const near = KNOCK_PAN === 'left' ? pcm.L : pcm.R;
  return table.knockFrames.map((frame, index) => {
    const voice = knockVoice(index);
    const len = Math.round(0.1 * SR);
    const expected = Math.round((frame / table.fps) * SR);
    const span = Math.round(0.1 * SR);
    let bestAt = 0;
    let best = -Infinity;
    for (let shift = -span; shift <= span; shift++) {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += (near[expected + shift + i] ?? 0) * voice[i];
      if (sum > best) {
        best = sum;
        bestAt = shift;
      }
    }
    // 窓の RMS（dB）。far は高い音だけを見る（ノックの音は遠い側では小さく、低い）
    const rms = (ch, a, b) => {
      let e = 0;
      for (let i = a; i < b; i++) e += ch[i] * ch[i];
      return 10 * Math.log10(e / (b - a) + 1e-12);
    };
    const hi = new Float32Array(pcm.n);
    const far = KNOCK_PAN === 'left' ? pcm.R : pcm.L;
    const a = 1 - Math.exp((-2 * Math.PI * 2000) / SR);
    let lp = 0;
    for (let i = Math.max(0, expected - SR); i < Math.min(pcm.n, expected + SR); i++) {
      lp += (far[i] - lp) * a;
      hi[i] = far[i] - lp;
    }
    const ms = (x) => expected + Math.round((x / 1000) * SR);
    return {
      frame,
      expectedMs: (expected / SR) * 1000,
      audioMs: ((expected + bestAt) / SR) * 1000,
      offsetMs: (bestAt / SR) * 1000,
      // 音楽の高い音が、ノックの直後にどれだけ下がったか
      musicDuckDb: Number((rms(hi, ms(10), ms(50)) - rms(hi, ms(-45), ms(-5))).toFixed(1)),
      // ノックの側の音が、直前の音楽よりどれだけ大きいか
      knockOverMusicDb: Number((rms(near, ms(0), ms(40)) - rms(near, ms(-45), ms(-5))).toFixed(1)),
      // ノックの直後、ノックの側が反対側よりどれだけ大きいか
      nearOverFarDb: Number((rms(near, ms(0), ms(40)) - rms(far, ms(0), ms(40))).toFixed(1)),
    };
  });
}

// ノックの絵を、完成した動画の中から探す。ノックのコマで、壁のそばに白い文字が1つ増える。
// 部屋の揺れでは白い画素の数はほとんど変わらないので、白い画素が前のコマより増えたところを見る
function findKnockPictures(table, video) {
  if (!table.knockFrames.length) return [];
  const from = table.knockFrames[0] - 30;
  const to = table.knockFrames.at(-1) + 30;
  // 音量100のレンズのあたりだけを切り抜く（CSS px → 1440 幅に縮めた絵の座標）
  const cx = Math.round(table.wall.x + table.wall.width - 260);
  const cy = Math.round(table.wall.y);
  const cw = 260;
  const ch = Math.round(table.wall.height);
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `select='between(n\\,${from}\\,${to})',scale=1440:1080,crop=${cw}:${ch}:${cx}:${cy},format=gray`, '-vsync', '0', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const size = cw * ch;
  const count = Math.floor(r.stdout.length / size);
  const white = [];
  for (let f = 0; f < count; f++) {
    let sum = 0;
    for (let i = 0; i < size; i++) if (r.stdout[f * size + i] >= 225) sum += 1;
    white.push(sum);
  }
  return table.knockFrames.map((frame) => {
    let pictureFrame = frame;
    let best = -Infinity;
    for (let f = frame - 5; f <= frame + 5; f++) {
      const i = f - from;
      if (i < 1 || i >= count) continue;
      const gain = white[i] - white[i - 1];
      if (gain > best) {
        best = gain;
        pictureFrame = f;
      }
    }
    return { frame, pictureFrame, whitePixelsAdded: best, whiteBefore: white[pictureFrame - from - 1], whiteAfter: white[pictureFrame - from] };
  });
}

// 場面ごとの音の様子：大きさ、低音、高音、左右の広がり
function sections(pcm) {
  const rows = [
    ['0〜1.5 眠り', 0, 1.5],
    ['1.5〜4 ヘッドホン', 1.5, 4],
    ['4〜7 スピーカーへ', 4, 7],
    ['5.8〜7 約55%', 5.8, 7],
    ['7〜10 約80%へ', 7, 10],
    ['10.5〜11.45 100%', 10.5, 11.45],
    ['11.5〜12.5 ノック', 11.5, 12.5],
    ['13〜14 約15%', 13, 14],
  ];
  const lowA = 1 - Math.exp((-2 * Math.PI * 150) / SR);
  const highA = 1 - Math.exp((-2 * Math.PI * 4000) / SR);
  const db = (x) => (x > 1e-12 ? (10 * Math.log10(x)).toFixed(1) : '-inf');
  return rows.map(([name, a, b]) => {
    let lp = 0;
    let lpH = 0;
    let all = 0;
    let low = 0;
    let high = 0;
    let mid = 0;
    let side = 0;
    let peak = 0;
    const from = Math.round(a * SR);
    const to = Math.min(pcm.n, Math.round(b * SR));
    for (let i = from; i < to; i++) {
      const m = (pcm.L[i] + pcm.R[i]) / 2;
      const s = (pcm.L[i] - pcm.R[i]) / 2;
      lp += (m - lp) * lowA;
      lpH += (m - lpH) * highA;
      all += m * m + s * s;
      low += lp * lp;
      high += (m - lpH) * (m - lpH);
      mid += m * m;
      side += s * s;
      peak = Math.max(peak, Math.abs(pcm.L[i]), Math.abs(pcm.R[i]));
    }
    const n = Math.max(1, to - from);
    return { name, rmsDb: db(all / n), lowDb: db(low / n), highDb: db(high / n), sideMinusMidDb: mid > 0 && side > 0 ? (10 * Math.log10(side / mid)).toFixed(1) : '-inf', peakDb: db(peak * peak) };
  });
}

function verify(table, synth, wavHash) {
  const pcm = decodePcm(OUT);
  const audio = findKnocks(table, pcm);
  const picture = findKnockPictures(table, OUT);
  const report = {
    wavSha256: wavHash,
    decodedAudioSha256: createHash('sha256').update(Buffer.from(pcm.L.buffer)).update(Buffer.from(pcm.R.buffer)).digest('hex'),
    workBpm: table.bpm,
    songStart: Number(synth.grid.songStart.toFixed(3)),
    finalBeatAt: Number(synth.finalAt.toFixed(3)),
    grabFrame: table.grabFrame,
    value98Frame: table.values.findIndex((v) => v >= 98),
    knockFrames: table.knockFrames,
    knockBeats: table.knockBeats,
    knockAudio: audio,
    knockPicture: picture,
    sections: sections(pcm),
    fileMb: Number((statSync(OUT).size / 1024 / 1024).toFixed(1)),
    valuesAt: Object.fromEntries([0, 1.5, 2.25, 3, 4, 6.6, 7, 9.3, 10, 10.4, 10.6, 11.5, 12.5, 12.95, 13.2, 14, 14.5].map((t) => [t, table.values[Math.round(t * table.fps)]])),
  };
  writeFileSync(resolve(HERE, `out/slider-resident${TAG}-report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

// ---- 本体
let table;
if (AUDIO_ONLY) {
  if (!existsSync(TABLE) || !existsSync(SILENT)) throw new Error('--audio-only の前に、絵を撮っておく必要がある');
  table = JSON.parse(readFileSync(TABLE, 'utf8'));
} else {
  table = await capture();
}
const synth = synthesize(table);
const wavHash = writeWav(WAV, synth.L, synth.R);
mux(table);
makeSheet(table);
verify(table, synth, wavHash);
console.log(`出力: ${OUT}（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
