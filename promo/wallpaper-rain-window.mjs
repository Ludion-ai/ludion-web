// wallpaper-rain-window（雨の窓ぎわ）の宣伝の動画を作る。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/wallpaper-rain-window.mjs --draft        → 下見（1920×1080。promo/out/wallpaper-rain-window-draft.mp4）
//   node promo/wallpaper-rain-window.mjs                → 本番（3840×2160。promo/out/wallpaper-rain-window.mp4）
//   node promo/wallpaper-rain-window.mjs --audio-only   → 絵は撮り直さず、残した音から、音楽と大きさだけ作り直す（--draft と併用できる）
//   node promo/wallpaper-rain-window.mjs --draft --stills=6.9,7.1,10.5 [--until=12]
//                                                       → 動画は作らず、その秒の絵だけを promo/out/wallpaper-rain-window-stills/ に撮る
//   --seed=<数> で、乱数の種を変える（街の並び、ひびの形、落ちる破片が変わる）
//   --audio-probe は、絵を撮らずに、作品が出した音の指紋だけを出す（同じ入力から同じ音になるかの確かめ）
//   --capture-only は、絵と作品の音を撮った所で止まる。続き（本番の書き出し、音、並べた1枚、確かめ）は --audio-only で流す。
//                  4K を、メモリーの少ないときに2回に分けて流すため
//   --no-music は、音楽を足さない（作品の音だけ）
//   --glass は、聞き比べ用に、ガラスの音を足した版（…-glass.mp4）も作る。ふだんは作らない（11/11 に CEO が、作品の音のままの版に決めた）
//   --center-logo は、終わりに、真ん中にもロゴと「Ludion」を浮かび上がらせる（画面を少し暗くする）
//   --full-res  は、本番でだけ使う。下の「作品へ渡す前に変えるもの」の4つめ
//
// 16:9、60fps、H.264、AAC 48kHz ステレオ。約20秒の、切れ目のない1カット。
// 時間を止めて1コマずつ撮る（1枚の撮影が 1/60 秒より長いので、そのままの録画ではかくつくため）。
//
// 雨、ガラス、店内の音は、作品が出す音をそのまま使う。作らない。
//   作品は AudioContext で音を合成する。撮影のページでは、それを OfflineAudioContext に差し替え、
//   絵を1コマ進めるたびに、音も 1/60 秒だけ計算させる。作品が「今から 10ms 後に鳴らす」と決めた音は、
//   そのコマの時刻から数えて、標本の単位で正しい場所に入る。絵と音は、同じ1つの時計で進む。
// そこへ、喫茶店に合うジャズ風の音楽を、小さく足す（synthesizeMusic。この動画のために書いた。コードで計算する）。
// 最後に、全体の大きさを合わせ（下の LOUDNESS）、山だけをリミッターで抑える。
// 筋書き：19回、だんだん速く叩いて割る → カメラが引く → 新しいガラスが張られる → 最後に1回だけ叩いて、ひびが入った所で終わる。
//
// 作品の外の演出。どれも works/ は変えない。
// - カーソルの絵：OS のカーソルは写らないので、同じ座標に矢印を重ねる
// - 始まり：少し寄った所から画面が広がり、最初の一瞬だけ、少し暗い所から明ける。カーソルは最初のコマから動いている
// - カメラの引き：作品の入れ物（#ld-host）を、外から縮める。まわりに、白い画面の縁と、白い地を足す（白くて平らな、すっきりした見た目。
//   実在の製品の形は写さない：印、切り欠き、あご、脚は付けない）
// - デスクトップ：アプリのアイコン（上に20個、下の帯に12個）を、作品の上に重ねる。形も色もこの動画のために描いたもので、
//   実在の製品の印や色には合わせない。文字はない。色は作品のトークンから
// - 終わり：右下に、Ludion のロゴのマーク「」と「Ludion」（サイトの頭と同じ形、同じ書体）、その横に ludion.ai
//
// 作品へ渡す前に変えるもの（描画へ渡す写しだけ。works/ のファイルは変えない）
// 1. 張り替えまでの待ち時間：作品では、触らないまま 90 秒で新しいガラスが張られる。20秒の動画に入れるため、
//    TUNE.heal.after の値だけを、筋書きの秒数に書き換える。張られ方（速さ、向き、光）は、作品のまま。
// 2. 音の始まり：作品の音は、最初のクリックで始まる。動画では最初のコマから雨の音を入れたいので、
//    撮り始める前に、作品の「音を消す」ボタンを2回押す（消して、戻す）。作品のコードは変えない。
// 3. 砕けた時刻の目印：破片がテーブルで砕ける所（land）の頭で、大きさと左右を window に書く（1行。作品の動きも音も変わらない）。
//    聞き比べ用の「ガラスの音を足した版」が、かけらの音を置く時刻を知るためだけに使う。
// 4. --full-res のときだけ：作品は、描く画素の数を 340万までに抑える（TUNE.perf.maxPixels）。4K では、その上限で
//    描いた絵を引き伸ばすことになる。この旗を付けると、上限だけを外して、4K の画素で描かせる。
//    マス目の数は下見と同じ（640×360）になり、下見とまったく同じ絵の、2倍の細かさになる。

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { buildFrameHtml } from '@ludion/render';
import { findWork, readWork, toRenderable } from '../packages/ld/src/workspace.ts';

const ffmpegPath = ffmpegInstaller.path;
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const DRAFT = flag('draft');
const AUDIO_ONLY = flag('audio-only');
const FULL_RES = flag('full-res');
const NO_MUSIC = flag('no-music'); // 音楽を足さない（作品の音だけ）
const CAPTURE_ONLY = flag('capture-only'); // 絵と、作品の音だけを撮って止まる。続きは --audio-only で（本番を2回に分けて流すとき）
const WITH_GLASS = flag('glass'); // 聞き比べ用に、ガラスの音を足した版（…-glass.mp4）も作る
const CENTER_LOGO = flag('center-logo'); // 終わりに、画面を少し暗くして、真ん中にもロゴと「Ludion」を浮かび上がらせる
const AUDIO_PROBE = flag('audio-probe'); // 絵は撮らず、作品が出した音の指紋（SHA-256）だけを出す。同じ入力から同じ音になるかを確かめる
const STILLS = option('stills')?.split(',').map(Number) ?? (AUDIO_PROBE ? [] : null);
const UNTIL = option('until') ? Number(option('until')) : null;
const SEED = option('seed') ? Number(option('seed')) : 5; // 6通りを撮って見比べ、大きな破片が店の明かりの前を落ちるものを選んだ

const WORK_ID = 'wallpaper-rain-window';
const VIEW = { width: 1920, height: 1080 };
const SCALE = DRAFT ? 1 : 2; // 本番は 3840×2160
const FPS = 60;
const SR = 48000;
const FRAME_URL = 'http://ld-frame.localhost/';
const HERE = dirname(fileURLToPath(import.meta.url));
const TAG = DRAFT ? '-draft' : '';
const out = (name) => resolve(HERE, 'out', name);
const OUT = out(`${WORK_ID}${TAG}.mp4`);
const SILENT = out(`${WORK_ID}${TAG}-silent.mp4`);
const LOSSLESS = out(`${WORK_ID}${TAG}-lossless.mkv`); // 本番だけ：撮りながら書く、劣化のない仮の絵（書き出したら消す）
const TABLE = out(`${WORK_ID}${TAG}-table.json`);
const RAW_WAV = out(`${WORK_ID}${TAG}-raw.wav`); // 作品が出した音。何も足していない
const MIX_WAV = out(`${WORK_ID}${TAG}-mix.wav`); // 動画の長さに切り、音楽を足して、大きさを整えた音
const MUSIC_WAV = out(`${WORK_ID}${TAG}-music.wav`); // 足した音楽だけ（聞き比べ用）
// 聞き比べ用のもう1本：ガラスの音（かけらが散る高い音）を、作品の音の上に足した版
const OUT_GLASS = out(`${WORK_ID}${TAG}-glass.mp4`);
const MIX_GLASS_WAV = out(`${WORK_ID}${TAG}-glass-mix.wav`);
const SHEET = out(`${WORK_ID}${TAG}-sheet.png`);
const REPORT = out(`${WORK_ID}${TAG}-report.json`);
const STILL_DIR = out(`${WORK_ID}-stills`);

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const seg = (t, from, to) => clamp((t - from) / (to - from));
const glide = (t) => 1 - Math.pow(1 - Math.pow(clamp(t), 1.6), 3); // ゆっくり動き出し、なめらかに止まる
const sine = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t)); // 手で拭くような、ゆるい加減速
const quintic = (t) => {
  const x = clamp(t);
  return x * x * x * (10 - 15 * x + 6 * x * x); // 始めと終わりで、速さも加速も 0
};
const dbToGain = (db) => Math.pow(10, db / 20);
const gainToDb = (g) => (g > 0 ? 20 * Math.log10(g) : -Infinity);

// ---- 筋書き（秒）
const DURATION = 20.0;
const WARM_SECONDS = 1.5; // 音を始めてから、最初のコマまでに進める時間（雨の音が落ち着く）
// 叩く時刻（19回）。最初は小さく、だんだん速く、大胆に：間隔が 1.5 → 0.75 → 0.375 → 0.25 秒と詰まる。どれも音楽の拍の上（下の MUSIC）
const SMASH_CLICKS = [1.75, 3.25, 4.75, 6.25, 7.0, 7.75, 8.5, 9.25, 9.625, 10.0, 10.375, 10.75, 11.125, 11.5, 11.75, 12.0, 12.25, 12.5, 12.75];
const LAST_SMASH = SMASH_CLICKS.at(-1);
// 最後の1回：新しいガラスが入って、きれいになった所を、1回だけ叩いて終わる（11/11 の CEO の指示）。最後の和音と同じ拍
const FINAL_CLICK = 19.0;
const CLICKS = [...SMASH_CLICKS, FINAL_CLICK];
// 叩く場所（ガラスの中の割合。左上が 0,0）。同じあたりを3回叩くと、大きな破片が外れる。
// 真ん中で3回 → 左で3回 → 右で3回 → 上を右から左へ4回 → 下の左で3回、下の右で3回
const HITS = [
  [0.5, 0.6], [0.553, 0.672], [0.482, 0.71],
  [0.3, 0.48], [0.22, 0.52], [0.19, 0.66],
  [0.76, 0.55], [0.81, 0.64], [0.7, 0.75],
  [0.84, 0.42], [0.7, 0.33], [0.58, 0.27], [0.46, 0.33],
  [0.36, 0.8], [0.3, 0.87], [0.43, 0.88],
  [0.6, 0.86], [0.67, 0.79], [0.57, 0.91],
  [0.5, 0.52], // 最後の1回：新しいガラスの真ん中
];
const CLICK_HOLD = 0.1; // 押してから離すまで
const HEAL_AT = CENTER_LOGO ? 16.5 : 17.0; // 新しいガラスが張られ始める時刻（約 1.3 秒で張り終わる）
const CAMERA = { from: 13.0, to: 17.0, end: 0.8 }; // カメラの引き（1.0 → 0.8 倍）
const DESK = { from: 13.5 }; // アイコンと帯が現れ始める時刻（1個ずつ、少し遅れて現れる）
// 始まり：少し寄った所から、画面が広がる。最初の一瞬だけ、少し暗い所から明ける。カーソルは、最初のコマからもう動いている
const OPENING = { zoom: 1.1, until: 2.2, veil: 0.45, veilUntil: 0.8 };
// 足すガラスの音（聞き比べ用の版だけ）。underPeakDb：作品の音のいちばん大きい山より、どれだけ小さくするか
const GLASS = { underPeakDb: -9, seed: 20261112 };
const MUSIC = { bpm: 80, firstBar: 1.0, swing: 0.66, overOpenRainDb: -6, seed: 20261111 }; // overOpenRainDb：穴だらけになった後の雨の音に対する、音楽の大きさ（dB）
const CREDIT = { from: 17.2, rise: 0.8 }; // 右下の、ロゴと「Ludion」と ludion.ai。18.0 秒に出そろい、終わりまで 2 秒見せる
const BRAND = { from: 17.5, rise: 0.8 }; // --center-logo のときだけ：真ん中のロゴと「Ludion」
const SHUTTER = 0.5; // カーソルのぶれ：1コマのうち、シャッターが開いている割合
const BLUR_SAMPLES = DRAFT ? 6 : 12;
// 作品が音を予約してから、出口に出るまでの遅れ（秒）。10ms は作品が決めている先読み（ctx.currentTime + 0.01）、
// 残りは作品の出口のコンプレッサーの遅れ。この分だけ音を前へ送ると、割れる絵のコマの頭で、音が始まる
const AUDIO_LEAD = 0.016;
const LOUDNESS = { I: -11, TP: -2.5, LIMIT_TP: -1 };
const CLIP_KNEE_DB = 5; // 山の頭を丸め始める高さ（天井より何 dB 下か） // TP：書き出す前の音の、真のピークの狙い（AAC にすると少し上がるので、基準の -1 より余裕を見る）

// 窓のガラスの場所（CSS px）。作品の layout()（横長）と同じ割合で出す。カーソルの道を決めるためだけに使う
function paneBox(canvasW, canvasH) {
  const cell = Math.max(2, Math.round(Math.max(canvasH, canvasW * 0.5) / 380));
  const cw = Math.ceil(canvasW / cell);
  const ch = Math.ceil(canvasH / cell);
  const counter = Math.round(ch * 0.165);
  const side = Math.max(3, Math.round(cw * 0.039));
  const sill = Math.max(3, Math.round(ch * 0.052));
  const head = Math.max(3, Math.round(ch * 0.05));
  const gx0 = Math.round(cw * 0.024) + side;
  const gx1 = Math.round(cw * 0.8) - side;
  const gy0 = counter + sill;
  const gy1 = ch - Math.round(ch * 0.02) - head;
  const kx = (cell / canvasW) * VIEW.width;
  const ky = (cell / canvasH) * VIEW.height;
  return { left: gx0 * kx, right: gx1 * kx, top: VIEW.height - gy1 * ky, bottom: VIEW.height - gy0 * ky };
}

// ---- ページの中：時間、乱数、時刻、音の差し替え
function installVirtualTime(opts) {
  const v = { now: 0, raf: new Map(), rafId: 1, timers: new Map(), timerId: 1 };
  const realRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    const id = v.rafId++;
    v.raf.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => v.raf.delete(id);
  performance.now = () => v.now;
  const addTimer = (fn, ms, args, every) => {
    const id = v.timerId++;
    v.timers.set(id, { at: v.now + Math.max(0, Number(ms) || 0), fn, args, every });
    return id;
  };
  window.setTimeout = (fn, ms = 0, ...args) => addTimer(fn, ms, args, 0);
  window.clearTimeout = (id) => v.timers.delete(id);
  window.setInterval = (fn, ms = 0, ...args) => addTimer(fn, ms, args, Math.max(1, Number(ms) || 0));
  window.clearInterval = (id) => v.timers.delete(id);

  // 端末の時計：決めた夜の時刻から、動画の時間と一緒に進む（作品は、空の暗さと置き時計の針に使う）
  const RealDate = Date;
  const base = new RealDate(...opts.clock).getTime();
  class StagedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(base + v.now);
      else super(...args);
    }
    static now() {
      return base + v.now;
    }
  }
  window.Date = StagedDate;

  let seed = opts.seed >>> 0;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 音：作品の AudioContext を、決めた長さの OfflineAudioContext にする。作品からは「動いている」ように見せ、
  // 止める・再開するは受け流す。本当の進みは、下の advance が、絵のコマと一緒に決める
  const Offline = window.OfflineAudioContext;
  const audio = { ctx: null, bornAt: 0, frame: 0, started: false, rendered: null, buffer: null };
  class StagedAudioContext extends Offline {
    constructor() {
      super({ numberOfChannels: 2, length: Math.ceil(opts.audioSeconds * opts.sampleRate), sampleRate: opts.sampleRate });
      if (audio.ctx) throw new Error('AudioContext が2つ作られた');
      audio.ctx = this;
      audio.bornAt = v.now;
    }
    get state() {
      return 'running';
    }
    resume() {
      return Promise.resolve();
    }
    suspend() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  window.AudioContext = StagedAudioContext;
  window.webkitAudioContext = undefined;

  window.__vt = {
    now: () => v.now,
    step(ms) {
      v.now += ms;
      for (const [id, timer] of [...v.timers].sort((x, y) => x[1].at - y[1].at)) {
        if (timer.at > v.now || !v.timers.has(id)) continue;
        if (timer.every) timer.at += timer.every;
        else v.timers.delete(id);
        timer.fn(...timer.args);
      }
      const batch = [...v.raf.values()];
      v.raf.clear();
      for (const cb of batch) cb(v.now);
    },
    painted: () => new Promise((done) => realRaf(() => realRaf(done))),
  };
  window.__vtAudio = {
    bornAt: () => (audio.ctx ? audio.bornAt : null),
    // 音を、今の絵の時刻まで計算させる。128標本の区切りに切り上げる（ずれは 2.7ms まで。積もらない）
    async advance() {
      const ctx = audio.ctx;
      if (!ctx) return null;
      const rate = ctx.sampleRate;
      const want = Math.ceil((((v.now - audio.bornAt) / 1000) * rate) / 128 - 1e-6) * 128;
      if (want > audio.frame) {
        const reached = Offline.prototype.suspend.call(ctx, want / rate);
        if (audio.started) Offline.prototype.resume.call(ctx);
        else {
          audio.started = true;
          audio.rendered = Offline.prototype.startRendering.call(ctx);
        }
        await reached;
        audio.frame = want;
      }
      return audio.frame / rate;
    },
    async finish() {
      const ctx = audio.ctx;
      if (!ctx) return null;
      if (audio.started) Offline.prototype.resume.call(ctx);
      else audio.rendered = Offline.prototype.startRendering.call(ctx);
      audio.buffer = await audio.rendered;
      return { length: audio.buffer.length, sampleRate: audio.buffer.sampleRate, channels: audio.buffer.numberOfChannels };
    },
    read(channel, from, count) {
      const data = audio.buffer.getChannelData(channel).subarray(from, from + count);
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      let text = '';
      for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(text);
    },
  };
}

// ---- ページの中：カーソル、カメラの引き、デスクトップ、ludion.ai
async function installStage(cfg) {
  const host = document.getElementById('ld-host');
  const root = host.shadowRoot.querySelector('[data-ld-part]');
  const statusEl = root.querySelector('[data-status]');
  const soundEl = root.querySelector('.sound');
  const style = getComputedStyle(root);
  const token = (name) => style.getPropertyValue(`--_${name}`).trim();
  const bg = token('bg');
  const fg = token('fg');
  const muted = token('muted');
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, css, parent) => {
    const node = document.createElement(tag);
    Object.assign(node.style, css);
    (parent ?? document.body).append(node);
    return node;
  };
  const line = `color-mix(in oklab, ${bg} 30%, white)`; // 線の色：作品の明かりの色みを、白に寄せる

  if (cfg.font) {
    const bytes = Uint8Array.from(atob(cfg.font), (c) => c.charCodeAt(0));
    const face = new FontFace('Stage Inter', bytes.buffer, { weight: '100 900' });
    await face.load();
    document.fonts.add(face);
  }

  // 地：カメラが引くと、画面のまわりに見える。白（サイトの site-bg）から、ごく薄い灰色（site-line）へ
  document.documentElement.style.background = 'radial-gradient(120% 100% at 50% 40%, #FFFFFF 0%, #F8F8FA 55%, #ECECF0 100%)';
  document.documentElement.style.height = '100%';
  document.body.style.overflow = 'hidden';

  // 画面の入れ物（作品の下に敷く）、作品、その上の重ね。3つを同じだけ縮める。
  // 入れ物は、実物の機器らしく作る：磨いた金属の縁 → 白い前面 → 画面のまわりの黒い細い縁。上の真ん中に、小さなカメラ。
  // 実在の製品の形は写さない（印、切り欠き、ボタン、あご、脚は付けない）
  const RIM = 6; // 金属の縁
  const FACE = 20; // 白い前面
  const WELL = 3; // 画面のまわりの黒い縁
  const BEZEL = RIM + FACE;
  const RADIUS = 22;
  const under = el('div', {
    position: 'fixed',
    left: `${-BEZEL}px`,
    top: `${-BEZEL}px`,
    width: `${W + BEZEL * 2}px`,
    height: `${H + BEZEL * 2}px`,
    zIndex: '0',
    borderRadius: `${RADIUS + BEZEL}px`,
    // 磨いた金属：まわりをぐるりと、明るい所と暗い所が交互に映る
    background: 'conic-gradient(from 200deg at 50% 50%, #f6f6f8, #c3c4cc 9%, #fbfbfc 20%, #b4b5be 33%, #f1f1f4 47%, #bdbec7 61%, #fcfcfd 74%, #c6c7cf 88%, #f6f6f8)',
    // 影は4枚重ねる：すぐ下の濃い影から、遠くの淡い影まで
    boxShadow: '0 0 0 1px rgb(17 17 20 / .2), 0 1px 2px rgb(17 17 20 / .14), 0 14px 28px -8px rgb(17 17 20 / .16), 0 44px 70px -28px rgb(17 17 20 / .28), 0 96px 120px -56px rgb(17 17 20 / .22)',
    transformOrigin: '50% 50%',
    display: 'none',
    pointerEvents: 'none',
  });
  const inset = (px) => ({ position: 'absolute', left: `${px}px`, top: `${px}px`, right: `${px}px`, bottom: `${px}px` });
  // 白い前面：縁の内側に、細い光の線と、薄い影（面取り）
  el('div', { ...inset(RIM), borderRadius: `${RADIUS + FACE}px`, background: 'linear-gradient(180deg, #FFFFFF 0%, #F7F7F9 60%, #F1F1F4 100%)', boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / .95), inset 0 2px 3px rgb(17 17 20 / .12), inset 0 -2px 3px rgb(255 255 255 / .9), 0 0 0 1px rgb(17 17 20 / .16)' }, under);
  // 画面のまわりの黒い縁（画面は、ガラスの下に少し沈んでいる）。下の辺に、白い光の線
  el('div', { ...inset(BEZEL - WELL), borderRadius: `${RADIUS + WELL}px`, background: '#08080b', boxShadow: '0 0 0 1px rgb(17 17 20 / .3), 0 1.5px 0 1px rgb(255 255 255 / .95)' }, under);
  // 小さなカメラ
  el('div', { position: 'absolute', left: '50%', top: `${RIM + (FACE - WELL) / 2 - 3.5}px`, width: '7px', height: '7px', marginLeft: '-3.5px', borderRadius: '50%', background: 'radial-gradient(circle at 36% 34%, #46526e 0%, #14151c 48%, #060609 100%)', boxShadow: '0 0 0 1.5px #1d1e26, 0 0 0 2.5px rgb(17 17 20 / .1)' }, under);
  Object.assign(host.style, { position: 'relative', zIndex: '1', transformOrigin: '50% 50%', overflow: 'hidden' });
  const over = el('div', { position: 'fixed', left: '0', top: '0', width: `${W}px`, height: `${H}px`, zIndex: '2', transformOrigin: '50% 50%', overflow: 'hidden', pointerEvents: 'none' });
  // ガラスの映り込み：画面の上を、斜めに薄い光が渡る。縁の近くは、ガラスの下で少し暗い
  const sheen = el('div', {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '100%',
    height: '100%',
    opacity: '0',
    background: 'linear-gradient(117deg, rgb(255 255 255 / .11) 0%, rgb(255 255 255 / .05) 16%, rgb(255 255 255 / 0) 31%, rgb(255 255 255 / 0) 72%, rgb(255 255 255 / .035) 100%)',
    boxShadow: 'inset 0 0 0 1px rgb(0 0 0 / .55), inset 0 0 18px rgb(0 0 0 / .22)',
  }, over);

  // ---- デスクトップ：アプリのアイコンを並べる。形も色も、この動画のために描いたもの。
  // 色は作品のトークンから作り、実在の製品の印や色には合わせない。文字はない（名前の場所には、短い線を1本）
  const surface = token('surface');
  const accent = token('accent');
  const mixc = (a, b, pct) => `color-mix(in oklab, ${a} ${pct}%, ${b})`;
  const COLORS = { w: mixc(bg, 'white', 12), k: mixc(fg, muted, 84), o: bg, td: mixc(surface, fg, 62), c: mixc(bg, 'white', 42), t: surface, p: accent, i: muted };
  const TILES = {
    orange: [mixc(bg, 'white', 90), mixc(bg, accent, 62)],
    teal: [mixc(surface, 'white', 88), mixc(surface, muted, 58)],
    indigo: [mixc(muted, 'white', 70), mixc(muted, fg, 80)],
    pink: [mixc(accent, 'white', 86), mixc(accent, muted, 66)],
    plum: [mixc(accent, muted, 55), mixc(mixc(accent, muted, 42), fg, 72)],
    cream: [mixc(bg, 'white', 10), mixc(bg, 'white', 34)],
    ink: [mixc(fg, muted, 60), mixc(fg, muted, 90)],
    leaf: [mixc(surface, bg, 55), mixc(mixc(surface, bg, 62), muted, 62)],
  };
  const dot = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  const rr = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
  const star = (cx, cy, outer, inner) => {
    let d = '';
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const q = k % 2 ? inner : outer;
      d += `${k ? 'L' : 'M'}${(cx + Math.cos(a) * q).toFixed(2)} ${(cy + Math.sin(a) * q).toFixed(2)}`;
    }
    return `${d}z`;
  };
  const teeth = (cx, cy, r0, r1) => {
    let d = '';
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      d += `M${(cx + Math.cos(a) * r0).toFixed(2)} ${(cy + Math.sin(a) * r0).toFixed(2)}L${(cx + Math.cos(a) * r1).toFixed(2)} ${(cy + Math.sin(a) * r1).toFixed(2)}`;
    }
    return d;
  };
  const grid = (xs, ys, r) => ys.flatMap((y) => xs.map((x) => dot(x, y, r))).join('');
  // アプリ：[タイルの色, 形の並び]。形は [道, 塗りの色, 線の色, 線の太さ]（48×48 のマスに描く）
  const APPS = {
    mail: ['pink', [[rr(9, 14, 30, 20, 3.5), 'w'], ['M10 16.5L24 27L38 16.5', '', 'p', 2.8]]],
    calendar: ['cream', [[rr(10, 10, 28, 29, 4), 'w'], ['M10 19v-5a4 4 0 0 1 4 -4h20a4 4 0 0 1 4 4v5z', 'p'], [grid([16.5, 24, 31.5], [25, 30.5, 36], 2), 'k']]],
    photos: ['indigo', [[dot(17, 17, 4.4), 'o'], ['M9 36L19 23L25.5 30.5L30 26L39 36z', 'w', 'w', 1.6]]],
    music: ['teal', [[dot(16.5, 33.5, 4.6) + dot(32.5, 30, 4.6), 'w'], ['M19.6 33.5V15L35.6 11.5V30', '', 'w', 3], ['M19.6 15L35.6 11.5v4.6L19.6 19.6z', 'w']]],
    chat: ['orange', [[rr(9, 11, 30, 21, 9), 'w'], ['M16 30L14 39L25 31z', 'w', 'w', 1.2], [grid([18, 24, 30], [21.5], 2.1), 'o']]],
    map: ['leaf', [['M24 39.5C24 39.5 13.5 28.5 13.5 20.5a10.5 10.5 0 1 1 21 0C34.5 28.5 24 39.5 24 39.5z', 'w'], [dot(24, 20.5, 4), 'k']]],
    clock: ['ink', [[dot(24, 24, 13.5), '', 'w', 3], ['M24 15.5V24L30 28', '', 'o', 3]]],
    notes: ['teal', [[grid([14], [17, 24.5, 32], 2.1), 'w'], ['M20 17H35M20 24.5H35M20 32H30', '', 'w', 3]]],
    rain: ['indigo', [['M9.5 25a14.5 14.5 0 0 1 29 0z', 'w'], ['M24 25V34.5a3.2 3.2 0 0 0 6.4 0', '', 'w', 2.8], ['M14 30.5v3.5M19 30.5v3.5', '', 't', 2.6]]],
    calc: ['plum', [[rr(13, 10, 22, 8, 2.5), 'w'], [grid([16.5, 24, 31.5], [24.5, 30.5, 36.5], 2.3), 'w']]],
    terminal: ['ink', [['M13 17L21 24L13 31', '', 't', 3.4], ['M24 32H35', '', 't', 3.4]]],
    settings: ['plum', [[dot(24, 24, 8.2), '', 'w', 5], [teeth(24, 24, 11, 14.6), '', 'w', 5]]],
    globe: ['teal', [[dot(24, 24, 13.5), '', 'w', 2.8], ['M10.5 24H37.5M24 10.5C16.5 16 16.5 32 24 37.5C31.5 32 31.5 16 24 10.5', '', 'w', 2.4]]],
    camera: ['ink', [[rr(9, 16, 30, 21, 4.5), 'w'], [rr(18, 11, 12, 8, 2.5), 'w'], [dot(24, 26.5, 7), 'k'], [dot(24, 26.5, 3.4), 't'], [dot(34, 20.5, 1.5), 'o']]],
    video: ['pink', [[rr(10, 20, 28, 18, 3), 'w'], ['M10 13.6L36.6 9.6L37.6 15.2L11 19.2z', 'w', 'w', 1.2], ['M17 12.7l2.4 4.9M24.4 11.6l2.4 4.9M31.8 10.5l2.4 4.9', '', 'p', 2.4]]],
    game: ['orange', [[rr(8, 16, 32, 17, 8.5), 'w'], ['M15 24.5h7M18.5 21v7', '', 'k', 2.6], [dot(29.5, 22.5, 1.9) + dot(33.5, 26.5, 1.9), 'k']]],
    book: ['leaf', [['M23 15C19.5 12.2 14 12 9.5 13.5V34.5C14 33 19.5 33.2 23 36z', 'w'], ['M25 15C28.5 12.2 34 12 38.5 13.5V34.5C34 33 28.5 33.2 25 36z', 'w']]],
    draw: ['plum', [['M16.5 31.5L31 11.5L36 15.2L21.5 35.2z', 'w'], ['M15.6 32.8L20.6 36.5L13 38.2z', 'o']]],
    bag: ['orange', [['M13 19H35L37.5 38H10.5z', 'w', 'w', 1.6], ['M18.5 19V16a5.5 5.5 0 0 1 11 0V19', '', 'w', 2.8]]],
    files: ['indigo', [['M10 17a2.5 2.5 0 0 1 2.5 -2.5h7.5l3 3.5h12.5a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1 -2.5 2.5h-23a2.5 2.5 0 0 1 -2.5 -2.5z', 'w']]],
    code: ['ink', [['M18.5 16.5L11 24L18.5 31.5M29.5 16.5L37 24L29.5 31.5', '', 'p', 3.2], ['M26.5 13.5L21.5 34.5', '', 'w', 2.8]]],
    heart: ['pink', [['M24 37.5C11 29 10.5 15.5 18 15C21 14.8 23 16.8 24 19C25 16.8 27 14.8 30 15C37.5 15.5 37 29 24 37.5z', 'w']]],
    audio: ['teal', [['M14 30V18M20.7 34V14M27.3 30V18M34 26.5V21.5', '', 'w', 3.6]]],
    star: ['orange', [[star(24, 24.5, 14, 6.2), 'w', 'w', 1.4]]],
  };
  // タイルに入れない物：フォルダーと、書類
  const FILES = {
    folder: [['M8 16a3 3 0 0 1 3 -3h9l4 4.5h13a3 3 0 0 1 3 3v3h-32z', 'td'], [rr(8, 19, 32, 20, 3), 't']],
    doc: [['M14 8h14l8 8v22a2.5 2.5 0 0 1 -2.5 2.5h-19.5a2.5 2.5 0 0 1 -2.5 -2.5v-27.5a2.5 2.5 0 0 1 2.5 -2.5z', 'w'], ['M28 8v8h8z', 'c'], ['M17 23.5h14M17 28.5h14M17 33.5h9', '', 'i', 2.2]],
    image: [['M14 8h14l8 8v22a2.5 2.5 0 0 1 -2.5 2.5h-19.5a2.5 2.5 0 0 1 -2.5 -2.5v-27.5a2.5 2.5 0 0 1 2.5 -2.5z', 'w'], ['M28 8v8h8z', 'c'], [dot(19, 23, 2.6), 'o'], ['M14 36L20.5 28L24.5 32L28 29L34 36z', 't']],
  };
  const art = (size, shapes) => {
    const node = document.createElementNS(NS, 'svg');
    node.setAttribute('viewBox', '0 0 48 48');
    node.setAttribute('width', String(size));
    node.setAttribute('height', String(size));
    Object.assign(node.style, { display: 'block', position: 'absolute', left: '0', top: '0', overflow: 'visible' });
    for (const [d, fill, stroke, width] of shapes) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.style.fill = fill ? COLORS[fill] : 'none';
      if (stroke) Object.assign(path.style, { stroke: COLORS[stroke], strokeWidth: String(width ?? 3), strokeLinecap: 'round', strokeLinejoin: 'round' });
      node.append(path);
    }
    return node;
  };
  const tile = (name, size, parent, css = {}) => {
    const [tone, shapes] = APPS[name];
    const node = el('div', {
      position: 'relative',
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: `${(size * 0.235).toFixed(1)}px`,
      background: `linear-gradient(155deg, ${TILES[tone][0]}, ${TILES[tone][1]})`,
      boxShadow: 'inset 0 1.5px 0 rgb(255 255 255 / .3), inset 0 -2px 0 rgb(0 0 0 / .16), 0 3px 9px rgb(0 0 0 / .45)',
      ...css,
    }, parent);
    node.append(art(size, shapes));
    return node;
  };

  const pops = []; // ふわっと現れる物：{ node, delay（秒）, rise（px） }
  // 上の2段：アプリ、フォルダー、書類が、10個ずつ
  const DESK_ROWS = [
    ['folder', 'folder', 'mail', 'calendar', 'photos', 'music', 'chat', 'map', 'clock', 'heart'],
    ['doc', 'image', 'notes', 'rain', 'calc', 'game', 'book', 'draw', 'bag', 'folder'],
  ];
  const LABELS = [34, 46, 28, 42, 36, 30, 26, 40, 32, 44, 38, 30, 44, 34, 28, 40, 30, 36, 26, 42];
  DESK_ROWS.forEach((row, r) =>
    row.forEach((name, c) => {
      const wrap = el('div', { position: 'absolute', left: `${44 + c * 112}px`, top: `${38 + r * 110}px`, width: '60px', opacity: '0' }, over);
      if (FILES[name]) el('div', { position: 'relative', width: '60px', height: '60px', filter: 'drop-shadow(0 3px 5px rgb(0 0 0 / .5))' }, wrap).append(art(60, FILES[name]));
      else tile(name, 60, wrap);
      el('div', { width: `${LABELS[r * 10 + c]}px`, height: '5px', margin: '10px auto 0', borderRadius: '3px', background: COLORS.w, opacity: '.82', boxShadow: '0 1px 3px rgb(0 0 0 / .6)' }, wrap);
      pops.push({ node: wrap, delay: c * 0.05 + r * 0.14, rise: 12 });
    }),
  );

  // 下の帯：左の端に「アプリの一覧」の印（点が3×3）、続けてアプリが12個。右の端は、電波、電池、時刻の場所（文字にはしない）
  const BAR_H = 58;
  const bar = el('div', {
    position: 'absolute',
    left: '0',
    bottom: '0',
    width: '100%',
    height: `${BAR_H}px`,
    opacity: '0',
    background: `color-mix(in oklab, color-mix(in oklab, ${fg} 82%, ${muted}) 74%, transparent)`,
    backdropFilter: 'blur(18px)',
    boxShadow: `inset 0 1px 0 color-mix(in oklab, ${line} 26%, transparent)`,
  }, over);
  const small = (css, size, shapes) => el('div', { position: 'absolute', width: `${size}px`, height: `${size}px`, ...css }, bar).append(art(size, shapes));
  small({ left: '20px', top: '8px' }, 42, [[grid([15, 24, 33], [15, 24, 33], 2.4), 'w']]);
  const DOCK = ['files', 'globe', 'mail', 'chat', 'music', 'photos', 'code', 'terminal', 'settings', 'video', 'camera', 'audio'];
  DOCK.forEach((name, i) => {
    const left = 84 + i * 54;
    pops.push({ node: tile(name, 42, bar, { position: 'absolute', left: `${left}px`, top: '7px', opacity: '0' }), delay: 0.3 + i * 0.04, rise: 8 });
    if ([0, 2, 4, 7].includes(i)) el('div', { position: 'absolute', left: `${left + 16}px`, bottom: '2px', width: '10px', height: '3px', borderRadius: '2px', background: COLORS.w, opacity: '.9' }, bar);
  });
  small({ right: '152px', top: '15px' }, 28, [['M12 36v-7M24 36v-15M36 36v-23', '', 'w', 4.6]]);
  small({ right: '108px', top: '15px' }, 28, [[rr(5, 15, 33, 18, 4), '', 'w', 3.4], [rr(9.5, 19.5, 18, 9, 1.5), 'w'], ['M42.5 21v6', '', 'w', 3.4]]);
  el('div', { position: 'absolute', right: '30px', top: '19px', width: '56px', height: '5px', borderRadius: '3px', background: COLORS.w, opacity: '.85' }, bar);
  el('div', { position: 'absolute', right: '30px', top: '33px', width: '38px', height: '5px', borderRadius: '3px', background: COLORS.w, opacity: '.5' }, bar);

  // 始まりの幕：最初の一瞬だけ、少し暗い所から明ける
  const veil = el('div', { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', zIndex: '4', background: 'black', opacity: '0', display: 'none', pointerEvents: 'none' });

  // ---- カーソル：矢印の絵。速く動くコマでは、シャッターが開いている間の場所を重ねて、ぶれにする
  const CUR = 1.3;
  const PAD = 12;
  const sprite = document.createElement('canvas');
  sprite.width = Math.ceil((24 * CUR + PAD * 2) * dpr);
  sprite.height = Math.ceil((36 * CUR + PAD * 2) * dpr);
  {
    const c = sprite.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(PAD, PAD);
    c.scale(CUR, CUR);
    const arrow = new Path2D('M1 1 L1 28 L7.6 22 L12 33 L16.6 31 L12.2 20.4 L21 20.4 Z');
    c.shadowColor = 'rgb(0 0 0 / .4)';
    c.shadowBlur = 5 * dpr;
    c.shadowOffsetY = 2 * dpr;
    c.fillStyle = '#ffffff';
    c.fill(arrow);
    c.shadowColor = 'transparent';
    c.lineJoin = 'round';
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgb(20 20 28 / .75)';
    c.stroke(arrow);
  }
  const cursor = document.createElement('canvas');
  cursor.width = Math.round(W * dpr);
  cursor.height = Math.round(H * dpr);
  Object.assign(cursor.style, { position: 'absolute', left: '0', top: '0', width: `${W}px`, height: `${H}px` });
  over.append(cursor);
  const pen = cursor.getContext('2d');
  let dirty = null;
  const drawCursor = (points, squeeze) => {
    if (dirty) pen.clearRect(dirty[0], dirty[1], dirty[2], dirty[3]);
    const k = 1 - 0.14 * squeeze;
    const moving = points.some((p) => Math.hypot(p[0] - points[0][0], p[1] - points[0][1]) > 0.05);
    const list = moving ? points : [points[0]];
    pen.globalCompositeOperation = moving ? 'lighter' : 'source-over';
    pen.globalAlpha = 1 / list.length;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of list) {
      const dx = (x - PAD * k) * dpr;
      const dy = (y - PAD * k) * dpr;
      const dw = sprite.width * k;
      const dh = sprite.height * k;
      pen.drawImage(sprite, dx, dy, dw, dh);
      x0 = Math.min(x0, dx);
      y0 = Math.min(y0, dy);
      x1 = Math.max(x1, dx + dw);
      y1 = Math.max(y1, dy + dh);
    }
    pen.globalAlpha = 1;
    pen.globalCompositeOperation = 'source-over';
    dirty = [Math.floor(x0) - 2, Math.floor(y0) - 2, Math.ceil(x1 - x0) + 4, Math.ceil(y1 - y0) + 4];
  };

  // ---- 右下（カメラの外。縮まない）：Ludion のロゴのマーク「」と、文字「Ludion」、その横に ludion.ai。
  // マークの形、文字の太さ（Inter 800）、字間（-0.02em）、マークと文字の間隔は、サイトの頭（apps/web/src/components/Header.tsx、SPEC.md）と同じ割合。
  // 白い地の上なので、色もサイトと同じ：左の括弧と文字は site-fg、右の括弧は site-logo、ludion.ai は site-fg-2
  const lockup = (size, color) => {
    const node = document.createElement('div');
    Object.assign(node.style, { display: 'flex', alignItems: 'center', gap: `${size * 0.4}px`, color, font: `800 ${size}px/1 'Stage Inter', system-ui, sans-serif`, letterSpacing: '-0.02em' });
    const mark = document.createElementNS(NS, 'svg');
    mark.setAttribute('viewBox', '8 8 80 80');
    mark.setAttribute('width', String(size));
    mark.setAttribute('height', String(size));
    mark.style.flex = 'none';
    for (const [d, fill] of [['M8 8H56V24H24V72H8Z', 'currentColor'], ['M88 88H40V72H72V24H88Z', '#E5412A']]) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', fill);
      mark.append(path);
    }
    const word = document.createElement('span');
    word.textContent = 'Ludion';
    node.append(mark, word);
    return node;
  };
  const credit = el('div', {
    position: 'fixed',
    right: `${(W * (1 - cfg.cameraEnd)) / 2 - BEZEL * cfg.cameraEnd}px`,
    bottom: '20px',
    height: '44px',
    zIndex: '5',
    display: 'flex',
    alignItems: 'center',
    gap: '22px',
    opacity: '0',
    pointerEvents: 'none',
  });
  credit.append(lockup(38, '#111114'));
  {
    const url = document.createElement('span');
    url.textContent = 'ludion.ai';
    Object.assign(url.style, { color: '#6B6B76', font: `500 24px/1 'Stage Inter', system-ui, sans-serif`, letterSpacing: '0' });
    credit.append(url);
  }

  // ---- --center-logo のときだけ：画面を少し暗くして、真ん中にも同じロゴと「Ludion」を浮かび上がらせる。
  // 濃い地の上なので、左の括弧と文字は白（site-bg）、右の括弧は site-logo の赤
  const scrim = el('div', { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', zIndex: '3', background: `color-mix(in oklab, ${fg} 92%, black)`, opacity: '0', display: 'none', pointerEvents: 'none' });
  const brand = el('div', { position: 'fixed', left: '0', top: '0', width: '100%', height: '100%', zIndex: '5', display: 'none', alignItems: 'center', justifyContent: 'center', opacity: '0', pointerEvents: 'none' });
  brand.append(lockup(92, '#FFFFFF'));

  const shown = (node, a, rise) => {
    node.style.opacity = String(a);
    node.style.transform = a < 1 ? `translateY(${((1 - a) * rise).toFixed(2)}px)` : '';
  };
  // 下から少し浮いて、少し大きくなりながら現れる
  const pop = (node, a, rise) => {
    node.style.opacity = String(a);
    node.style.transform = a < 1 ? `translateY(${((1 - a) * rise).toFixed(2)}px) scale(${(0.86 + 0.14 * a).toFixed(4)})` : '';
  };
  const ease = (x) => {
    const u = Math.min(1, Math.max(0, x));
    return u * u * (3 - 2 * u);
  };

  window.__stage = {
    soundButton() {
      const b = soundEl.getBoundingClientRect();
      return [b.left + b.width / 2, b.top + b.height / 2];
    },
    soundOn: () => soundEl.getAttribute('aria-pressed') !== 'true',
    canvasSize() {
      const c = root.querySelector('canvas.view');
      return [c.width, c.height, root.getAttribute('data-gl')];
    },
    // 1コマ進める：作品の時間 → 外の演出 → 音。返すのは、作品が自分で出している値
    async frame(a) {
      window.__vt.step(a.ms);
      const s = a.camera;
      const t = s !== 1 ? `scale(${s})` : '';
      const r = s < 1 ? RADIUS * Math.min(1, (1 - s) / 0.02) : 0;
      host.style.transform = t;
      over.style.transform = t;
      under.style.transform = t;
      under.style.display = s < 1 ? 'block' : 'none';
      host.style.borderRadius = `${r}px`;
      over.style.borderRadius = `${r}px`;
      sheen.style.borderRadius = `${r}px`;
      sheen.style.opacity = String(s < 1 ? Math.min(1, (1 - s) / 0.05) : 0);
      for (const p of pops) pop(p.node, ease((a.desk - p.delay) / 0.7), p.rise);
      shown(bar, ease(a.desk / 0.8), 14);
      veil.style.opacity = String(a.veil);
      veil.style.display = a.veil > 0 ? 'block' : 'none';
      scrim.style.opacity = String(0.66 * a.brand);
      scrim.style.display = a.brand > 0 ? 'block' : 'none';
      brand.style.opacity = String(a.brand);
      brand.style.display = a.brand > 0 ? 'flex' : 'none';
      brand.style.transform = a.brand < 1 ? `translateY(${((1 - a.brand) * 18).toFixed(2)}px) scale(${(0.965 + 0.035 * a.brand).toFixed(4)})` : '';
      shown(credit, a.credit, 8);
      drawCursor(a.cursor, a.squeeze);
      const audioAt = await window.__vtAudio.advance();
      return { status: statusEl.textContent, audioAt, smashes: window.__ldSmash ? window.__ldSmash.splice(0) : [] };
    },
  };
}

// ---- 絵を撮る。作品が出した音と、コマごとの記録を残す
async function capture() {
  const location = findWork(WORK_ID);
  if (!location) throw new Error(`${WORK_ID} が見つからない`);
  const work = toRenderable(readWork(location));
  if (!work) throw new Error(`${WORK_ID} を描画できない`);

  // 作品へ渡す前に変えるもの（頭の説明の 1、3、4）。目印がなければ、作品が変わったので止める
  const healAfter = Number((HEAL_AT - LAST_SMASH).toFixed(3));
  const HEAL_ANCHOR = 'after: 90, // 触らないまま';
  if (!work.js.includes(HEAL_ANCHOR)) throw new Error('作品のコードに heal.after の行がない');
  let js = work.js.replace(HEAL_ANCHOR, `after: ${healAfter}, // 触らないまま`);
  if (FULL_RES) {
    const CAP_ANCHOR = 'maxPixels: 3400000,';
    if (!js.includes(CAP_ANCHOR)) throw new Error('作品のコードに perf.maxPixels の行がない');
    js = js.replace(CAP_ANCHOR, `maxPixels: ${VIEW.width * VIEW.height * SCALE * SCALE},`);
  }
  const LAND_ANCHOR = 'const land = (x, y, size, pan) => {';
  if (!js.includes(LAND_ANCHOR)) throw new Error('作品のコードに land がない');
  js = js.replace(LAND_ANCHOR, `${LAND_ANCHOR} (window.__ldSmash = window.__ldSmash || []).push([size, pan]);`);
  const html = buildFrameHtml({ ...work, js }, { palette: 'author', width: VIEW.width });

  const require = createRequire(import.meta.url);
  const font = readFileSync(require.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');

  const netLog = [];
  const browser = await chromium.launch({
    args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ld-frame.localhost'],
  });
  const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  // 撮影は、ブラウザに直に頼む（Playwright の screenshot より速い。PNG なので、絵は同じ）
  const cdp = await context.newCDPSession(page);
  const shoot = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: SCALE } })).data, 'base64');
  const pageErrors = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
    console.error('作品のエラー:', error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') console.error(`ページの ${message.type()}:`, message.text().slice(0, 300));
  });
  await page.route('**/*', (route) => {
    const url = route.request().url();
    netLog.push({ url, allowed: url === FRAME_URL });
    if (url === FRAME_URL) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    return route.abort();
  });
  const totalFrames = Math.round(DURATION * FPS);
  await page.addInitScript(installVirtualTime, {
    seed: SEED,
    clock: [2026, 10, 11, 22, 9, 40], // 端末の時計：夜の 22:09:40 から始める（置き時計の針が、10時10分のあたりを指す）
    sampleRate: SR,
    audioSeconds: WARM_SECONDS + DURATION + 1.5,
  });
  await page.goto(FRAME_URL, { waitUntil: 'load' });
  await page.evaluate(installStage, { font, cameraEnd: CAMERA.end });
  await page.evaluate(() => window.__vt.painted());
  const idle = { ms: 1000 / FPS, camera: 1, desk: -1, veil: 0, credit: 0, brand: 0, cursor: [[-200, -200]], squeeze: 0 };
  const warm = async (frames) => {
    for (let i = 0; i < frames; i++) await page.evaluate((a) => window.__stage.frame(a), idle);
    await page.evaluate(() => window.__vt.painted());
  };
  // 大きさの測りを、作品に受け取らせる
  await warm(12);
  await warm(12);
  const [canvasW, canvasH, glState] = await page.evaluate(() => window.__stage.canvasSize());
  if (glState === 'off') throw new Error('作品が WebGL を使えていない（止まった絵になっている）');
  console.log(`作品が描いている絵の大きさ: ${canvasW}×${canvasH}（動画は ${VIEW.width * SCALE}×${VIEW.height * SCALE}）`);

  // 音を始める：作品の「音を消す」ボタンを2回押す（消して、戻す）。ガラスには触らない
  const soundAt = await page.evaluate(() => window.__stage.soundButton());
  const outside = [VIEW.width + 70, VIEW.height * 0.965];
  await page.mouse.click(soundAt[0], soundAt[1]);
  await warm(6);
  await page.mouse.click(soundAt[0], soundAt[1]);
  await warm(2);
  if (!(await page.evaluate(() => window.__stage.soundOn()))) throw new Error('音のボタンが「消す」のままになっている');
  if ((await page.evaluate(() => window.__vtAudio.bornAt())) === null) throw new Error('作品が音を始めていない');
  await page.mouse.move(outside[0], outside[1]);
  await page.waitForTimeout(600); // ボタンの上から離れたあとの、色の変化（本当の時間で動く）が終わるのを待つ
  await warm(Math.round(WARM_SECONDS * FPS));

  // ---- カーソルの道のり（CSS px）
  const pane = paneBox(canvasW, canvasH);
  const pw = pane.right - pane.left;
  const ph = pane.bottom - pane.top;
  const at = (u, v) => [pane.left + pw * u, pane.top + ph * v]; // ガラスの中の割合（左上が 0,0）
  const hits = HITS.map(([u, v]) => at(u, v));
  const rest = [pane.left + pw * 0.77, pane.bottom + 28]; // 窓の下の枠の上。絵を隠さない休み場所
  const path = [];
  // bow：道のりの長さに対する、弧のふくらみ。正で、進む向きの左へふくらむ
  const move = (t0, t1, from, to, ease = glide, bow = 0.04) => path.push({ t0, t1, from, to, ease, bow });
  // 最初のコマで、もう画面の右下にいて、動いている（道のりを、撮り始める前から始めておく）。そのまま、最初に叩く所へ
  move(-0.45, CLICKS[0] - 0.3, [VIEW.width - 150, VIEW.height - 92], hits[0], glide, 0.08);
  // 叩いたら、少し止まってから次へ動き、叩く少し前に着く。間隔が詰まるほど、止まる時間も短くなる
  const smashCount = SMASH_CLICKS.length;
  for (let i = 1; i < smashCount; i++) {
    const gap = CLICKS[i] - CLICKS[i - 1];
    move(CLICKS[i - 1] + Math.min(0.35, gap * 0.25), CLICKS[i] - Math.min(0.3, gap * 0.15), hits[i - 1], hits[i], glide, i % 2 ? 0.1 : -0.1);
  }
  move(LAST_SMASH + 0.4, LAST_SMASH + 1.5, hits[smashCount - 1], rest, glide, -0.12);
  // 最後の1回：新しいガラスが張り終わるころに休み場所を出て、真ん中へ。叩いたら、そこで止まって終わる
  move(FINAL_CLICK - 0.9, FINAL_CLICK - 0.2, rest, hits[smashCount], glide, 0.1);
  const mouseAt = (t) => {
    let pos = path[0].from;
    for (const p of path) {
      if (t < p.t0) break;
      const u = p.ease(seg(t, p.t0, p.t1));
      const dx = p.to[0] - p.from[0];
      const dy = p.to[1] - p.from[1];
      const bulge = Math.sin(Math.PI * u) * p.bow;
      pos = [p.from[0] + dx * u + dy * bulge, p.from[1] + dy * u - dx * bulge];
    }
    return pos;
  };
  const cameraAt = (t) => (t < OPENING.until ? 1 + (OPENING.zoom - 1) * Math.pow(1 - t / OPENING.until, 3) : 1 - (1 - CAMERA.end) * quintic(seg(t, CAMERA.from, CAMERA.to)));
  // カメラが寄っても引いても、カーソルは画面（作品）の上の同じ場所にいる。本物のマウスも、そこへ動かす
  const onScreen = (pos, s) => [VIEW.width / 2 + (pos[0] - VIEW.width / 2) * s, VIEW.height / 2 + (pos[1] - VIEW.height / 2) * s];

  const events = [];
  for (const t of CLICKS) {
    events.push({ frame: Math.round(t * FPS), type: 'down' });
    events.push({ frame: Math.round((t + CLICK_HOLD) * FPS), type: 'up' });
  }
  events.sort((a, b) => a.frame - b.frame);

  let ffmpeg = null;
  let ffmpegDone = null;
  let writeFrame = null;
  if (!STILLS) {
    mkdirSync(dirname(SILENT), { recursive: true });
    ffmpeg = spawn(
      ffmpegPath,
      [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        // 下見：そのまま書き出す。本番：撮っている間は、軽くて劣化のない形（qp 0）で残すだけにする。
        // 4K の重い書き出しを撮影と同時に走らせると、メモリーが足りなくなるため
        ...(DRAFT ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0']),
        '-r', String(FPS),
        '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
        ...(DRAFT ? ['-movflags', '+faststart', SILENT] : [LOSSLESS]),
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    ffmpegDone = new Promise((done, fail) => {
      ffmpeg.on('error', fail);
      ffmpeg.on('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg が ${code} で止まった`))));
    });
    writeFrame = (buffer) => new Promise((done, fail) => ffmpeg.stdin.write(buffer, (error) => (error ? fail(error) : done())));
  } else mkdirSync(STILL_DIR, { recursive: true });
  const stillFrames = STILLS ? new Map(STILLS.map((t) => [Math.round(t * FPS), t])) : null;

  const lastFrame = UNTIL !== null ? Math.min(totalFrames, Math.round(UNTIL * FPS)) : totalFrames;
  const started = Date.now();
  const audioFrame0 = await page.evaluate(() => window.__vtAudio.advance()); // 最初のコマの頭の、音の時刻
  const statuses = [];
  const smashes = [];
  const clicks = [];
  const presses = [];
  let lastStatus = '';
  let nextEvent = 0;
  let lastMouse = null;
  let shotMs = 0;
  let shots = 0;

  for (let frame = 0; frame < lastFrame; frame++) {
    const t = frame / FPS;
    const camera = cameraAt(t);
    const pos = mouseAt(t);
    const real = onScreen(pos, camera);
    if (!lastMouse || real[0] !== lastMouse[0] || real[1] !== lastMouse[1]) {
      await page.mouse.move(real[0], real[1]);
      lastMouse = real;
    }
    while (nextEvent < events.length && events[nextEvent].frame <= frame) {
      const e = events[nextEvent++];
      if (e.type === 'down') {
        await page.mouse.down();
        presses.push(t);
        clicks.push({ frame, x: Number(pos[0].toFixed(1)), y: Number(pos[1].toFixed(1)) });
      } else await page.mouse.up();
    }
    const since = presses.length ? t - presses.at(-1) : 9;
    const squeeze = since < 0.07 ? since / 0.07 : since < 0.22 ? 1 - (since - 0.07) / 0.15 : 0;
    const cursor = [];
    for (let i = 0; i < BLUR_SAMPLES; i++) cursor.push(mouseAt(t + (((i + 0.5) / BLUR_SAMPLES - 0.5) * SHUTTER) / FPS));
    const state = await page.evaluate((a) => window.__stage.frame(a), {
      ms: 1000 / FPS,
      camera,
      desk: t - DESK.from,
      veil: OPENING.veil * (1 - sine(seg(t, 0, OPENING.veilUntil))),
      credit: sine(seg(t, CREDIT.from, CREDIT.from + CREDIT.rise)),
      brand: CENTER_LOGO ? sine(seg(t, BRAND.from, BRAND.from + BRAND.rise)) : 0,
      cursor,
      squeeze,
    });
    for (const [size, pan] of state.smashes) smashes.push({ frame, size: Number(size.toFixed(3)), pan: Number(pan.toFixed(3)) });
    if (state.status !== lastStatus) {
      lastStatus = state.status;
      statuses.push({ frame, t: Number(t.toFixed(3)), status: state.status });
      console.log(`  ${t.toFixed(3)}秒（コマ ${frame}）：${state.status}`);
    }
    if (!STILLS || stillFrames.has(frame)) {
      await page.evaluate(() => window.__vt.painted());
      const shotStart = Date.now();
      const png = await shoot();
      shotMs += Date.now() - shotStart;
      shots += 1;
      if (STILLS) writeFileSync(resolve(STILL_DIR, `s${String(SEED)}${DRAFT ? '' : FULL_RES ? '-4kfull' : '-4k'}-${stillFrames.get(frame).toFixed(2).padStart(5, '0')}.png`), png);
      else await writeFrame(png);
    }
    if (!STILLS && frame % 120 === 0) console.log(`${t.toFixed(1)}秒 / ${DURATION}秒（${Math.round((Date.now() - started) / 1000)}秒経過）`);
  }

  if (ffmpeg) {
    ffmpeg.stdin.end();
    await ffmpegDone;
  }
  console.log(`撮った枚数 ${shots}、1枚の撮影: 平均 ${(shotMs / Math.max(1, shots)).toFixed(0)}ms。かかった時間: ${((Date.now() - started) / 1000).toFixed(0)}秒`);

  let table = null;
  if (!STILLS || AUDIO_PROBE) {
    // 作品が出した音を、そのまま取り出す
    const info = await page.evaluate(() => window.__vtAudio.finish());
    const channels = [];
    for (let c = 0; c < 2; c++) {
      const data = new Float32Array(info.length);
      const CHUNK = 480000;
      for (let from = 0; from < info.length; from += CHUNK) {
        const text = await page.evaluate(([ch, f, n]) => window.__vtAudio.read(ch, f, n), [c, from, CHUNK]);
        const bytes = Buffer.from(text, 'base64');
        data.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), from);
      }
      channels.push(data);
    }
    const rawHash = writeWav(AUDIO_PROBE ? out(`${WORK_ID}${TAG}-probe.wav`) : RAW_WAV, channels[0], channels[1]);
    const cracked = crackHeard(channels, clicks, audioFrame0);
    console.log(`叩いた回ごとの、ひびの音（○ は鳴った。数字は、叩いたコマの頭から 4ms の間の、高い音の山 dB）: ${cracked.map((c, i) => `${i + 1}${c.hit ? '○' : '×'}${c.peakDb}`).join(' ')}`);
    if (AUDIO_PROBE) {
      console.log(`作品が出した音の指紋: ${rawHash}`);
      await browser.close();
      return null;
    }
    table = {
      fps: FPS,
      totalFrames,
      seed: SEED,
      view: VIEW,
      scale: SCALE,
      canvas: [canvasW, canvasH],
      pane,
      healAfter,
      fullRes: FULL_RES,
      audio: { sampleRate: info.sampleRate, length: info.length, frame0: audioFrame0, rawSha256: rawHash },
      clicks,
      cracked,
      smashes,
      statuses,
      net: { requests: netLog.length, blocked: netLog.filter((e) => !e.allowed).map((e) => e.url) },
      pageErrors,
    };
    writeFileSync(TABLE, JSON.stringify(table, null, 1));
  }
  await browser.close();
  console.log(`通信: ${netLog.length} 件（許したのは枠の HTML だけ）。止めた先: ${JSON.stringify(netLog.filter((e) => !e.allowed).map((e) => e.url))}`);
  return table;
}

// 作品の音（そのまま）の中で、叩いたコマの頭から 4ms の間に、ひびの「ピシッ」（2.5kHz より上の強い音）が始まったか。
// 穴の中を叩いた回は、ひびが入らず、音もしない
function crackHeard(channels, clicks, frame0) {
  const [L, R] = channels;
  const a = 1 - Math.exp((-2 * Math.PI * 2500) / SR);
  return clicks.map((click) => {
    const at = Math.round((frame0 + AUDIO_LEAD + click.frame / FPS) * SR);
    let lpL = 0;
    let lpR = 0;
    let peak = 0;
    for (let i = at - 480; i < at + Math.round(0.004 * SR); i++) {
      lpL += (L[i] - lpL) * a;
      lpR += (R[i] - lpR) * a;
      if (i >= at) peak = Math.max(peak, Math.abs(L[i] - lpL), Math.abs(R[i] - lpR));
    }
    return { frame: click.frame, hit: peak > 0.12, peakDb: Number(gainToDb(peak).toFixed(1)) };
  });
}

// 本番の書き出し（ブラウザを閉じてから）。撮るときに残した、劣化のない仮の絵から作る。色は撮るときに変換してあるので、ここでは変えない。
// メモリーを使いすぎないように、先読みのコマ数とスレッドの数を抑える（crf 15 では、絵の違いは出ない）
function encodeFinal() {
  if (DRAFT || !existsSync(LOSSLESS)) return;
  const started = Date.now();
  run(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', LOSSLESS,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-x264-params', 'rc-lookahead=20', '-threads', '6', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart',
    SILENT,
  ]);
  unlinkSync(LOSSLESS);
  console.log(`本番の書き出し: ${((Date.now() - started) / 1000).toFixed(0)}秒`);
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
function readWav(path) {
  const buf = readFileSync(path);
  const frames = (buf.length - 44) / 8;
  const L = new Float32Array(frames);
  const R = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    L[i] = buf.readFloatLE(44 + i * 8);
    R[i] = buf.readFloatLE(48 + i * 8);
  }
  return { L, R };
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`);
  return r;
}
// 大きさを測る（ebur128。48kHz のまま測る、ふつうの測り方）。i は全体の大きさ（LUFS）、tp は真のピーク（dBTP）
function measureLoudness(file) {
  const r = run(ffmpegPath, ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const num = (re) => Number(re.exec(tail)?.[1]);
  const m = { i: num(/I:\s+(-?[\d.]+) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), tp: num(/Peak:\s+(-?[\d.]+) dBFS/) };
  if (![m.i, m.lra, m.tp].every(Number.isFinite)) throw new Error(`大きさを測れなかった: ${file}`);
  return m;
}

// ---- 音楽：喫茶店に合う、ゆっくりしたジャズ風の伴奏（電気ピアノ、ビブラフォン、ウッドベース、ブラシ）。
// この動画のために新しく書いた。録音も、既存の曲やフレーズも使わない。音は、正弦波とノイズだけから計算する。同じ種から、毎回同じ音になる。
// 拍は 80（1拍 0.75 秒、1小節 3 秒）。小節の頭は 1, 4, 7, 10, 13, 16 秒で、最後の和音が 19 秒。叩く時刻（CLICKS）は、どれも拍か、その半分か、3連符の上にある。
// 和音は Dm9 → G13 → Cmaj9 → A7(♭9♭13) → Dm9 → G7(♭9) → C6/9（ジャズでいちばんよく使う進み方）。
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

function synthesizeMusic(seconds) {
  const N = Math.round(seconds * SR);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const rand = mulberry(MUSIC.seed);
  const beat = 60 / MUSIC.bpm;
  const S = MUSIC.swing; // 裏の拍を、後ろへ寄せる（はねる）
  const at = (bar, x) => MUSIC.firstBar + (bar * 4 + x) * beat;
  const human = (ms) => ((rand() - 0.5) * 2 * ms) / 1000; // 人の手の、わずかなずれ
  const put = (start, i, l, r) => {
    const k = start + i;
    if (k >= 0 && k < N) {
      L[k] += l;
      R[k] += r;
    }
  };
  const pans = (pan) => [Math.cos((pan * Math.PI) / 2), Math.sin((pan * Math.PI) / 2)];

  // 電気ピアノ：正弦波を、同じ高さの正弦波で揺らす。叩いた瞬間だけ、高い鈴の音が乗る。左右にゆっくり揺れる
  const piano = (t0, dur, midi, vel) => {
    const w = (2 * Math.PI * mtof(midi)) / SR;
    const start = Math.round(t0 * SR);
    const n = Math.round((dur + 0.5) * SR);
    const tau = 1.7 * Math.pow(2, (60 - midi) / 24);
    const [gl, gr] = pans(clamp(0.5 + (midi - 59) * 0.018, 0.32, 0.68));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env = t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / tau);
      if (t > dur) env *= Math.exp(-(t - dur) / 0.1);
      const depth = 1.3 * vel * Math.exp(-t / 0.4) + 0.22;
      const body = Math.sin(w * i + depth * Math.sin(w * i));
      const tine = Math.sin(w * i * 9.02) * Math.exp(-t / 0.045) * 0.16 * vel;
      const s = (body + tine) * env * vel * 0.3;
      const sway = 0.13 * Math.sin(2 * Math.PI * 4.3 * (t0 + t));
      put(start, i, s * gl * (1 + sway), s * gr * (1 - sway));
    }
  };
  // ビブラフォン：正弦波と、その4倍と10倍の高さ。音が震える
  const vibes = (t0, dur, midi, vel) => {
    const w = (2 * Math.PI * mtof(midi)) / SR;
    const start = Math.round(t0 * SR);
    const n = Math.round((dur + 0.9) * SR);
    const tau = 1.5 * Math.pow(2, (72 - midi) / 24);
    const [gl, gr] = pans(0.57);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let env = t < 0.002 ? t / 0.002 : Math.exp(-(t - 0.002) / tau);
      if (t > dur) env *= Math.exp(-(t - dur) / 0.25);
      const tone = Math.sin(w * i) + 0.3 * Math.exp(-t / 0.3) * Math.sin(4 * w * i) + 0.1 * Math.exp(-t / 0.06) * Math.sin(10 * w * i + 0.3);
      const s = tone * env * vel * 0.2 * (1 + 0.2 * Math.sin(2 * Math.PI * 5.1 * (t0 + t)));
      put(start, i, s * gl, s * gr);
    }
  };
  // ウッドベース：はじいた瞬間に少し高く、すぐ落ち着く。倍音を足して、小さなスピーカーでも聞こえるようにする
  const bass = (t0, dur, midi, vel) => {
    const f = mtof(midi);
    const start = Math.round(t0 * SR);
    const n = Math.round((dur + 0.12) * SR);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      phase += (2 * Math.PI * f * (1 + 0.025 * Math.exp(-t / 0.02))) / SR;
      let env = t < 0.007 ? t / 0.007 : Math.exp(-(t - 0.007) / 0.75);
      if (t > dur) env *= Math.exp(-(t - dur) / 0.05);
      const tone = Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.2 * Math.sin(3 * phase) + 0.07 * Math.sin(4 * phase);
      const s = (tone * env * 0.34 + (rand() * 2 - 1) * Math.exp(-t / 0.004) * 0.05) * vel * 0.707;
      put(start, i, s, s);
    }
  };
  // ライドシンバル：高さの合わない正弦波を重ねた「チン」
  const PARTIALS = [3140, 4320, 5270, 6410, 7830, 9150].map((hz) => hz * (0.98 + rand() * 0.04));
  const ride = (t0, vel) => {
    const start = Math.round(t0 * SR);
    const n = Math.round(0.5 * SR);
    const [gl, gr] = pans(0.36);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let tone = 0;
      PARTIALS.forEach((hz, k) => {
        tone += Math.sin(2 * Math.PI * hz * t + k) * Math.exp(-t / (0.22 - k * 0.025));
      });
      const s = ((tone / 6) * 0.2 + (rand() * 2 - 1) * Math.exp(-t / 0.01) * 0.06) * vel;
      put(start, i, s * gl, s * gr);
    }
  };

  // 和音（電気ピアノ）：1拍めと、2拍めの裏
  const CHORDS = [[53, 57, 60, 64], [53, 57, 59, 64], [52, 55, 59, 62], [55, 58, 61, 65], [53, 57, 60, 64], [53, 56, 59, 64]];
  CHORDS.forEach((notes, bar) => {
    for (const [x, len, vel] of [[0, 1.5, 0.8], [1 + S, 2.1, 0.62]]) {
      const t = at(bar, x) + (x ? human(6) : 0);
      notes.forEach((m, k) => piano(t + k * 0.009, len * beat, m, vel * (0.9 + rand() * 0.2)));
    }
  });
  // 3小節めと4小節め（割れ方が速くなる所）は、3拍めと4拍めにも短く刻む
  for (const bar of [2, 3]) for (const x of [2, 3]) CHORDS[bar].forEach((m, k) => piano(at(bar, x) + k * 0.007 + human(4), 0.45 * beat, m, 0.5 * (0.9 + rand() * 0.2)));
  [52, 57, 62, 67].forEach((m, k) => piano(at(6, 0) + k * 0.028, 2.2 * beat, m, 0.85));
  // ベース：1拍に1つずつ歩く
  const WALK = [[38, 41, 45, 48], [43, 45, 47, 50], [48, 47, 45, 43], [45, 43, 41, 40], [38, 40, 41, 45], [43, 41, 40, 38]];
  bass(at(-1, 3), 0.9 * beat, 45, 0.8);
  WALK.forEach((notes, bar) => notes.forEach((m, q) => bass(at(bar, q) + (q ? human(6) : 0), 0.92 * beat, m, q === 0 ? 0.95 : 0.8)));
  bass(at(6, 0), 1.6 * beat, 36, 1);
  // 旋律（ビブラフォン）：[小節, 拍, 高さ, 長さ（拍）, 強さ]。割れ方に合わせて、だんだん細かくなる。
  // 3小節め（7〜10 秒）は、叩く拍の裏で答える。4小節め（10〜13 秒）は、上がってから、3連符で駆け下りる（叩く時刻と同じ刻み）
  const T3 = 1 / 3;
  const LINE = [
    [-1, 3, 69, 0.6, 0.7], [-1, 3 + S, 72, 0.45, 0.7],
    [0, 0, 76, 0.9, 0.9], [0, 1 + S, 74, 0.4, 0.7], [0, 2, 72, 0.9, 0.75], [0, 3 + S, 69, 0.5, 0.7],
    [1, 0, 71, 0.9, 0.8], [1, 1 + S, 74, 0.4, 0.7], [1, 2, 76, 0.9, 0.8], [1, 3 + S, 74, 0.4, 0.7],
    [2, S, 71, 0.3, 0.7], [2, 1 + S, 74, 0.3, 0.72], [2, 2 + S, 76, 0.3, 0.75], [2, 3 + S, 79, 0.3, 0.8],
    [3, 0, 69, 0.4, 0.8], [3, S, 73, 0.3, 0.75], [3, 1, 76, 0.4, 0.8], [3, 1 + S, 79, 0.3, 0.8],
    [3, 2, 82, T3, 0.9], [3, 2 + T3, 81, T3, 0.85], [3, 2 + 2 * T3, 79, T3, 0.85], [3, 3, 77, T3, 0.85], [3, 3 + T3, 76, T3, 0.85], [3, 3 + 2 * T3, 73, T3, 0.9],
    [4, 0, 74, 1.4, 0.85], [4, 1 + S, 72, 0.4, 0.65], [4, 2, 69, 1.2, 0.7], [4, 3 + S, 72, 0.4, 0.65],
    [5, S, 68, 0.4, 0.65], [5, 1, 71, 0.6, 0.7], [5, 1 + S, 74, 0.45, 0.75], [5, 2, 77, 1.3, 0.85], [5, 3 + S, 76, 2.2, 0.85],
  ];
  for (const [bar, x, midi, len, vel] of LINE) vibes(at(bar, x) + (x % 1 ? human(8) : human(3)), len * beat, midi, vel);
  // シンバル：チン、チンチ、チン、チンチ
  ride(at(-1, 3), 0.8);
  ride(at(-1, 3 + S), 0.55);
  for (let bar = 0; bar < 6; bar++) {
    [[0, 0.8], [1, 1], [1 + S, 0.55], [2, 0.8], [3, 1], [3 + S, 0.55]].forEach(([x, vel]) => ride(at(bar, x) + human(4), vel * (bar === 2 || bar === 3 ? 1.3 : 1) * (0.9 + rand() * 0.2)));
  }
  ride(at(6, 0), 0.9);
  // ブラシ：太鼓の皮をなでる「サー」が、拍に合わせてふくらむ。2拍めと4拍めに、軽く叩く
  {
    const end = at(6, 0);
    const [gl, gr] = pans(0.62);
    const hpA = 1 - Math.exp((-2 * Math.PI * 1500) / SR);
    const lpA = 1 - Math.exp((-2 * Math.PI * 5500) / SR);
    let hp = 0;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const pos = (t - MUSIC.firstBar) / beat;
      const inBeat = pos - Math.floor(pos);
      const white = rand() * 2 - 1;
      hp += (white - hp) * hpA;
      lp += (white - hp - lp) * lpA;
      const swirl = 0.35 + 0.65 * Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * inBeat), 1.3);
      const tap = (((Math.floor(pos) % 2) + 2) % 2 === 1 ? 1.7 : 0) * Math.exp(-(inBeat * beat) / 0.03);
      const fade = t > end ? Math.exp(-(t - end) / 0.25) : Math.min(1, t / 0.2);
      const s = lp * (swirl + tap) * 0.09 * fade;
      L[i] += s * gl;
      R[i] += s * gr;
    }
  }

  // 小さな部屋の響き：櫛形の遅れを4本と、全域通過を2本（左右で長さを少し変える）
  for (const [ch, shift] of [[L, 0], [R, 23]]) {
    const dry = Float32Array.from(ch);
    const wet = new Float32Array(N);
    for (const len of [1693, 1759, 1621, 1547]) {
      const line = new Float32Array(len + shift);
      let at2 = 0;
      let damp = 0;
      for (let i = 0; i < N; i++) {
        const out = line[at2];
        damp += (out - damp) * 0.6;
        line[at2] = dry[i] + damp * 0.78;
        at2 = (at2 + 1) % line.length;
        wet[i] += out * 0.25;
      }
    }
    for (const len of [225, 556]) {
      const line = new Float32Array(len + shift);
      let at2 = 0;
      for (let i = 0; i < N; i++) {
        const delayed = line[at2];
        const input = wet[i];
        line[at2] = input + delayed * 0.5;
        at2 = (at2 + 1) % line.length;
        wet[i] = delayed - input * 0.5;
      }
    }
    // 高い所を少し丸めて、暖かくする。ごく低い所は切る
    const lpA = 1 - Math.exp((-2 * Math.PI * 9000) / SR);
    const hpA = 1 - Math.exp((-2 * Math.PI * 35) / SR);
    let a = 0;
    let low = 0;
    for (let i = 0; i < N; i++) {
      const s = dry[i] + wet[i] * 0.16;
      a += (s - a) * lpA;
      low += (a - low) * hpA;
      ch[i] = a - low;
    }
    // 割れ方が速くなるにつれて、少しだけ大きくなり（6.25 → 12.75 秒で +3 dB）、カメラが引くと元へ戻る
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      ch[i] *= 1 + 0.42 * (seg(t, 6.25, 12.75) - seg(t, 13.2, 15));
    }
    // 終わりは、最後の和音の響きを残して閉じる
    for (let i = 0; i < 0.35 * SR; i++) ch[N - 1 - i] *= i / (0.35 * SR);
  }
  return { L, R };
}

// ---- ガラスの音の足し（聞き比べ用の版だけ）。作品のガラスの音はそのまま残し、その上に重ねる。正弦波とノイズだけから計算する。
// ひびが入るコマ：高く澄んだ鳴りを重ねる（高さの合わない正弦波を6組。少しずらした2本で、うなりを作る）。
// 破片が砕けるコマ：細かいかけらが散る「チリチリ」を、大きさに合わせて 3〜53 個ばらまき、大きめのかけらがはねる「カラン」を数個足す。
function synthesizeGlass(table, N) {
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  const rand = mulberry(GLASS.seed);
  const ping = (t0, hz, tau, amp, pan) => {
    const start = Math.round(t0 * SR);
    const n = Math.round(tau * 7 * SR);
    const w = (2 * Math.PI * hz) / SR;
    const gl = Math.cos((pan * Math.PI) / 2);
    const gr = Math.sin((pan * Math.PI) / 2);
    const phase = rand() * 6.28;
    for (let i = 0; i < n && start + i < N; i++) {
      const t = i / SR;
      const sample = Math.sin(w * i + phase) * Math.exp(-t / tau) * Math.min(1, t / 0.0005) * amp;
      L[start + i] += sample * gl;
      R[start + i] += sample * gr;
    }
  };
  const hiss = (t0, seconds, lo, hi, amp, pan) => {
    const start = Math.round(t0 * SR);
    const n = Math.round(seconds * 4 * SR);
    const hpA = 1 - Math.exp((-2 * Math.PI * lo) / SR);
    const lpA = 1 - Math.exp((-2 * Math.PI * hi) / SR);
    const gl = Math.cos((pan * Math.PI) / 2);
    const gr = Math.sin((pan * Math.PI) / 2);
    let hp = 0;
    let lp = 0;
    for (let i = 0; i < n && start + i < N; i++) {
      const white = rand() * 2 - 1;
      hp += (white - hp) * hpA;
      lp += (white - hp - lp) * lpA;
      const sample = lp * Math.exp(-i / SR / seconds) * amp;
      L[start + i] += sample * gl;
      R[start + i] += sample * gr;
    }
  };
  const width = table.pane.right - table.pane.left;
  for (const click of table.clicks) {
    const t = click.frame / table.fps + 0.001;
    const pan = clamp(0.5 + ((click.x - table.pane.left) / width - 0.5) * 0.7);
    const base = 3200 + rand() * 1400;
    [1, 1.52, 2.18, 2.74, 3.39, 4.12].forEach((m, k) => {
      const hz = base * m * (0.99 + rand() * 0.02);
      const tau = 0.17 / (1 + k * 0.45);
      const amp = 0.5 / (1 + k * 0.55);
      ping(t + k * 0.0007, hz, tau, amp, pan);
      ping(t + k * 0.0007, hz * 1.006, tau, amp * 0.5, pan);
    });
    hiss(t, 0.02, 6000, 14000, 0.6, pan);
  }
  for (const smash of table.smashes ?? []) {
    const t0 = smash.frame / table.fps + 0.001;
    const size = smash.size;
    const pan = clamp(0.5 + smash.pan * 0.35);
    const span = 0.22 + 0.75 * size;
    const count = Math.round(3 + 50 * Math.pow(size, 1.5));
    for (let k = 0; k < count; k++) {
      const later = Math.pow(rand(), 1.8) * span;
      const amp = (0.25 + 0.75 * rand()) * (1 - (later / span) * 0.7) * (0.35 + 0.65 * size);
      ping(t0 + later, 3600 * Math.pow(3.6, rand()), 0.012 + rand() * 0.07, amp * 0.35, clamp(pan + (rand() - 0.5) * 0.35));
    }
    for (let k = 0; k < Math.round(1 + 4 * size); k++) {
      const at = t0 + 0.03 + rand() * span * 0.8;
      const hz = 1900 + rand() * 2600;
      const tau = 0.09 + rand() * 0.16;
      ping(at, hz, tau, 0.3 * (0.4 + 0.6 * size), pan);
      ping(at + 0.0004, hz * 2.71, tau * 0.5, 0.15 * (0.4 + 0.6 * size), pan);
    }
    hiss(t0, 0.06 + 0.12 * size, 4500, 12000, 0.5 * (0.4 + 0.6 * size), pan);
  }
  return { L, R };
}

// 標本と標本の間の山（真のピーク）も見る：4倍の細かさで間を埋めて、いちばん大きい値を取る
function truePeaks(ch) {
  const TAPS = 16;
  const kernels = [1, 2, 3].map((p) => {
    const k = new Float32Array(TAPS * 2);
    for (let j = -TAPS + 1; j <= TAPS; j++) {
      const x = p / 4 - j;
      k[j + TAPS - 1] = (Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos((Math.PI * x) / TAPS));
    }
    return k;
  });
  const peaks = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    let m = Math.abs(ch[i]);
    if (i >= TAPS && i < ch.length - TAPS) {
      for (const k of kernels) {
        let sum = 0;
        for (let j = 0; j < TAPS * 2; j++) sum += ch[i + j - TAPS + 1] * k[j];
        m = Math.max(m, Math.abs(sum));
      }
    }
    peaks[i] = m;
  }
  return peaks;
}

// ---- 音：動画の長さに切り、全体の大きさを整える。作品の音の中身（何が、いつ鳴るか）は変えない
function master(table, withGlass = false, tpTarget = LOUDNESS.TP) {
  const mixPath = withGlass ? MIX_GLASS_WAV : MIX_WAV;
  const raw = readWav(RAW_WAV);
  const N = Math.round((table.totalFrames / table.fps) * SR);
  const from = Math.round((table.audio.frame0 + AUDIO_LEAD) * SR);
  if (from + N > raw.L.length) throw new Error('作品の音が、動画の長さに足りない');
  const cut = (ch) => {
    const outBuf = new Float32Array(N);
    outBuf.set(ch.subarray(from, from + N));
    // 頭と終わりで音が切れないよう、短く閉じる
    for (let i = 0; i < 0.03 * SR; i++) outBuf[i] *= i / (0.03 * SR);
    for (let i = 0; i < 0.08 * SR; i++) outBuf[N - 1 - i] *= i / (0.08 * SR);
    return outBuf;
  };
  const L0 = cut(raw.L);
  const R0 = cut(raw.R);
  let rawPeak = 0;
  for (let i = 0; i < N; i++) rawPeak = Math.max(rawPeak, Math.abs(L0[i]), Math.abs(R0[i]));
  writeWav(mixPath, L0, R0);
  const before = measureLoudness(mixPath);
  console.log(`作品の音（そのまま）: ${before.i} LUFS、真のピーク ${before.tp} dBTP、標本のピーク ${gainToDb(rawPeak).toFixed(1)} dBFS`);

  // 音楽を足す。大きさの基準は、作品の雨の音。窓が割れる前（最初に叩くまで）と、穴だらけになった後（最後に叩いた後、張り直す前）の
  // 2か所で測り、穴だらけの後の雨と同じ大きさに置く（MUSIC.overOpenRainDb）。割れる前は、雨がこもって小さいので、音楽の方がよく聞こえる
  let musicInfo = null;
  if (!NO_MUSIC) {
    const music = synthesizeMusic(N / SR);
    const part = (from, to) => {
      writeWav(MUSIC_WAV, L0.subarray(Math.round(from * SR), Math.round(to * SR)), R0.subarray(Math.round(from * SR), Math.round(to * SR)));
      return measureLoudness(MUSIC_WAV).i;
    };
    const closed = part(0.2, CLICKS[0] - 0.1);
    const open = part(LAST_SMASH + 1.75, HEAL_AT - 0.2);
    writeWav(MUSIC_WAV, music.L, music.R);
    const asWritten = measureLoudness(MUSIC_WAV);
    const target = open + MUSIC.overOpenRainDb;
    const g = dbToGain(target - asWritten.i);
    for (let i = 0; i < N; i++) {
      music.L[i] *= g;
      music.R[i] *= g;
      L0[i] += music.L[i];
      R0[i] += music.R[i];
    }
    const hash = writeWav(MUSIC_WAV, music.L, music.R);
    musicInfo = { bpm: MUSIC.bpm, rainBeforeBreakLufs: closed, rainAfterBreakLufs: open, musicLufs: Number(target.toFixed(1)), sha256: hash };
    console.log(`音楽: ${musicInfo.musicLufs} LUFS で足した（作品の雨の音は、割れる前 ${closed} LUFS、穴だらけの後 ${open} LUFS）`);
  }

  // 聞き比べ用の版だけ：ガラスの音を足す。大きさは、作品の音のいちばん大きい山より GLASS.underPeakDb だけ小さい山にそろえる
  let glassInfo = null;
  if (withGlass) {
    const glass = synthesizeGlass(table, N);
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(glass.L[i]), Math.abs(glass.R[i]));
    const g = (rawPeak * dbToGain(GLASS.underPeakDb)) / (peak || 1);
    for (let i = 0; i < N; i++) {
      L0[i] += glass.L[i] * g;
      R0[i] += glass.R[i] * g;
    }
    glassInfo = { cracks: table.clicks.length, smashes: (table.smashes ?? []).length, underPeakDb: GLASS.underPeakDb };
  }

  // 全体を同じだけ上げて LOUDNESS.I にする。それで山が天井を越える所だけ、先読みのリミッターで下げる。
  // 下げた後は、すぐ戻す（35ms）：ひびの「ピシッ」のあとに続くガラスの鳴りまで、一緒に小さくしないため
  let ceilingDb = tpTarget - 0.5; // 真のピークの天井。ffmpeg の測り方で越えたら、その分だけ下げてやり直す
  writeWav(mixPath, L0, R0);
  let lift = LOUDNESS.I - measureLoudness(mixPath).i;
  let result = null;
  for (let pass = 0; pass < 10; pass++) {
    const g = dbToGain(lift);
    const ceiling = dbToGain(ceilingDb);
    const L = new Float32Array(N);
    const R = new Float32Array(N);
    const need = new Float32Array(N);
    // 1) 山の頭を丸める：天井の少し下（knee）から上を、なめらかに天井へ寄せる。ひびの「ピシッ」の最初の数 ms だけにかかる。
    //    音量を下げて山を通す方法（下の 2）だけだと、山のあとに続くガラスの鳴りまで小さくなって、硬さがなくなるため
    const knee = ceiling * dbToGain(-CLIP_KNEE_DB);
    const room = ceiling - knee;
    const round = (x) => {
      const m = Math.abs(x);
      return m <= knee ? x : Math.sign(x) * (knee + room * Math.tanh((m - knee) / room));
    };
    let clipped = 0;
    for (let i = 0; i < N; i++) {
      const l = L0[i] * g;
      const r = R0[i] * g;
      if (Math.abs(l) > knee || Math.abs(r) > knee) clipped += 1;
      L[i] = round(l);
      R[i] = round(r);
    }
    // 2) 丸めたあとに、標本の間の山（真のピーク）が天井を越える所だけ、先読みのリミッターで下げる
    const peaksL = truePeaks(L);
    const peaksR = truePeaks(R);
    for (let i = 0; i < N; i++) {
      const m = Math.max(peaksL[i], peaksR[i]);
      need[i] = m > ceiling ? ceiling / m : 1;
    }
    const attackStep = 1 / (0.002 * SR);
    const releaseStep = 1 / (0.035 * SR);
    for (let i = N - 2; i >= 0; i--) need[i] = Math.min(need[i], need[i + 1] + attackStep);
    let limited = 0;
    let deepest = 1;
    for (let i = 1; i < N; i++) {
      need[i] = Math.min(need[i], need[i - 1] + releaseStep);
      if (need[i] < 0.999) limited += 1;
      deepest = Math.min(deepest, need[i]);
    }
    for (let i = 0; i < N; i++) {
      L[i] *= need[i];
      R[i] *= need[i];
    }
    const hash = writeWav(mixPath, L, R);
    const now = measureLoudness(mixPath);
    result = { liftDb: Number(lift.toFixed(2)), ceilingDb: Number(ceilingDb.toFixed(2)), roundedPercent: Number(((clipped / N) * 100).toFixed(2)), limitedPercent: Number(((limited / N) * 100).toFixed(2)), deepestDb: Number(gainToDb(deepest).toFixed(1)), measured: now, mixSha256: hash };
    const miss = LOUDNESS.I - now.i;
    const over = now.tp - tpTarget;
    if (Math.abs(miss) < 0.05 && over <= 0) break;
    if (Math.abs(miss) >= 0.05) lift += miss;
    if (over > 0) ceilingDb -= over + 0.1;
  }
  console.log(`上げた量 ${result.liftDb} dB。山の頭を丸めた割合 ${result.roundedPercent}%。リミッターが効いた割合 ${result.limitedPercent}%、いちばん深く下げた所 ${result.deepestDb} dB`);
  return { before: { ...before, samplePeakDb: Number(gainToDb(rawPeak).toFixed(1)) }, music: musicInfo, glass: glassInfo, ...result };
}

// ---- 絵と合わせる。音は、上で整えたものを AAC にするだけ（ここでは大きさを変えない）
function mux(table, mixPath = MIX_WAV, outPath = OUT) {
  run(ffmpegPath, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', SILENT, '-i', mixPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy',
    '-ar', String(SR), '-ac', '2', '-c:a', 'aac', '-b:a', '256k',
    '-t', String(table.totalFrames / table.fps),
    '-movflags', '+faststart',
    outPath,
  ]);
  const final = measureLoudness(outPath);
  console.log(`完成した動画の音: ${final.i} LUFS、真のピーク ${final.tp} dBTP`);
  if (Math.abs(final.i - LOUDNESS.I) > 0.5) throw new Error(`全体の大きさが ${final.i} LUFS で、狙いの ${LOUDNESS.I} から離れている`);
  return final;
}

// 音を仕上げて、絵と合わせる。AAC にすると真のピークが上がる（山の頭を丸めた音では、1 dB を超えることがある）ので、
// 完成した動画で測って、基準（LOUDNESS.LIMIT_TP）に 0.2 dB の余裕で入るまで、書き出す前のピークの狙いを下げてやり直す
function finishSound(table, withGlass) {
  let tpTarget = LOUDNESS.TP;
  for (let attempt = 0; attempt < 4; attempt++) {
    const mastering = master(table, withGlass, tpTarget);
    const final = mux(table, withGlass ? MIX_GLASS_WAV : MIX_WAV, withGlass ? OUT_GLASS : OUT);
    if (final.tp <= LOUDNESS.LIMIT_TP - 0.2) return { mastering: { ...mastering, tpTargetBeforeAac: Number(tpTarget.toFixed(2)) }, final };
    tpTarget -= final.tp - (LOUDNESS.LIMIT_TP - 0.2) + 0.2;
  }
  throw new Error(`真のピークを ${LOUDNESS.LIMIT_TP} dBTP 以下に入れられなかった`);
}

// ---- 1秒ごとの絵を並べた1枚（0〜19秒と、最後のコマ）
async function makeSheet(table) {
  const cols = 5;
  const tileW = 640;
  const tileH = 360;
  const gap = 8;
  const label = 30;
  const picks = [];
  for (let s = 0; s * table.fps < table.totalFrames; s++) picks.push({ frame: s * table.fps, name: `${s}秒` });
  picks.push({ frame: table.totalFrames - 1, name: '最後のコマ' });
  const select = picks.map((p) => `eq(n\\,${p.frame})`).join('+');
  const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', OUT, '-vf', `select='${select}',scale=${tileW}:${tileH}:flags=area`, '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const size = tileW * tileH * 3;
  const rows = Math.ceil(picks.length / cols);
  const width = gap + cols * (tileW + gap);
  const height = gap + rows * (tileH + label + gap);
  const layers = [];
  picks.forEach((p, i) => {
    const left = gap + (i % cols) * (tileW + gap);
    const top = gap + Math.floor(i / cols) * (tileH + label + gap);
    layers.push({ input: r.stdout.subarray(i * size, (i + 1) * size), raw: { width: tileW, height: tileH, channels: 3 }, left, top });
    const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${label}"><text x="2" y="22" font-family="Yu Gothic UI, Meiryo, sans-serif" font-size="20" fill="#e8e4ee">${p.name}</text></svg>`;
    layers.push({ input: Buffer.from(text), left, top: top + tileH + 2 });
  });
  await sharp({ create: { width, height, channels: 3, background: '#17131c' } }).composite(layers).png().toFile(SHEET);
}

// ---- 完成した mp4 を測る：叩いたコマで、絵と音がそろっているか
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

// 音：叩いたコマの前 8ms から後ろ 20ms の間で、高い音（2.5kHz より上）の 1ms ぶんの大きさが、直前の 10ms の 2.5 倍を超える最初の場所を探す
// （ひびの「ピシッ」の頭）。速く叩く所では、前の音と重なって見つからないことがある（null）。その分は、table.cracked（作品の音そのもので確かめた結果）を見る
function findCrackSounds(table, pcm) {
  const hi = new Float32Array(pcm.n);
  const a = 1 - Math.exp((-2 * Math.PI * 2500) / SR);
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < pcm.n; i++) {
    lpL += (pcm.L[i] - lpL) * a;
    lpR += (pcm.R[i] - lpR) * a;
    hi[i] = Math.max(Math.abs(pcm.L[i] - lpL), Math.abs(pcm.R[i] - lpR));
  }
  const rms = (from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += (hi[i] ?? 0) ** 2;
    return Math.sqrt(sum / (to - from));
  };
  const ms = SR / 1000;
  return table.clicks.map((click) => {
    const at = Math.round((click.frame / table.fps) * SR);
    let onset = -1;
    let before = 0;
    for (let i = at - Math.round(8 * ms); i < at + Math.round(20 * ms) && onset < 0; i++) {
      const floor = rms(i - Math.round(10 * ms), i - Math.round(ms));
      if (rms(i, i + Math.round(ms)) > floor * 2.5 && rms(i, i + Math.round(ms)) > 0.03) {
        // その 1ms の中で、直前の大きさの 3 倍を最初に超えた標本
        onset = i;
        for (let j = i; j < i + Math.round(2 * ms); j++) {
          if ((hi[j] ?? 0) > floor * 3) {
            onset = j;
            break;
          }
        }
        before = floor;
      }
    }
    let peak = 0;
    for (let i = at; i < at + Math.round(0.05 * SR); i++) peak = Math.max(peak, Math.abs(pcm.L[i] ?? 0), Math.abs(pcm.R[i] ?? 0));
    const offsetMs = onset < 0 ? null : ((onset - at) / SR) * 1000;
    return {
      frame: click.frame,
      frameStartMs: Number(((click.frame / table.fps) * 1000).toFixed(2)),
      soundStartMs: onset < 0 ? null : Number(((onset / SR) * 1000).toFixed(2)),
      offsetMs: offsetMs === null ? null : Number(offsetMs.toFixed(2)),
      offsetFrames: offsetMs === null ? null : Math.round(offsetMs / (1000 / table.fps)), // いちばん近いコマ（AAC は、鋭い音の頭を 1ms 足らず手前へにじませることがある）
      peakDb: Number(gainToDb(peak).toFixed(1)),
      highBandJustBeforeDb: Number(gainToDb(before).toFixed(1)),
    };
  });
}

// 絵：叩いた点のまわり（160px 四方）だけを見て、絵が急に変わる最初のコマを探す（欠けと、走るひびと、光）
function findCrackPictures(table, video) {
  const k = table.scale;
  const box = 160;
  return table.clicks.map((click) => {
    const from = click.frame - 40;
    const to = click.frame + 8;
    const w = box * k;
    const crop = [w, w, Math.round((click.x - box / 2) * k), Math.round((click.y - box / 2) * k)];
    const r = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-ss', (from / table.fps).toFixed(6), '-i', video, '-frames:v', String(to - from + 1), '-vf', `crop=${crop.join(':')},format=gray`, '-vsync', '0', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(String(r.stderr));
    const size = w * w;
    const count = Math.floor(r.stdout.length / size);
    const diffs = [];
    for (let f = 1; f < count; f++) {
      let sum = 0;
      for (let i = 0; i < size; i++) sum += Math.abs(r.stdout[f * size + i] - r.stdout[(f - 1) * size + i]);
      diffs.push({ frame: from + f, diff: sum / size });
    }
    // 叩いたコマの前後3コマの中で、いちばん大きく変わったコマ（速く叩く所では、直前までカーソルが動いているので、こう数える）
    const around = diffs.filter((d) => Math.abs(d.frame - click.frame) <= 3);
    const first = around.reduce((best, d) => (d.diff > best.diff ? d : best), around[0]);
    const calmMax = Math.max(...diffs.filter((d) => d.frame >= click.frame - 12 && d.frame < click.frame - 1).map((d) => d.diff));
    const near = (n) => Number((diffs.find((d) => d.frame === click.frame + n)?.diff ?? 0).toFixed(2));
    return { frame: click.frame, pictureFrame: first ? first.frame : null, diffBeforeClick: near(-1), diffAtClick: near(0), diffAfterClick: near(1), calmMax: Number(calmMax.toFixed(2)) };
  });
}

function verify(table, mastering, final, glassVersion) {
  const pcm = decodePcm(OUT);
  const report = {
    file: OUT,
    fileMb: Number((statSync(OUT).size / 1024 / 1024).toFixed(1)),
    seed: table.seed,
    canvas: table.canvas,
    healAfterSeconds: table.healAfter,
    statuses: table.statuses,
    clicks: table.clicks,
    cracked: table.cracked,
    smashes: (table.smashes ?? []).length,
    glassVersion,
    crackSound: findCrackSounds(table, pcm),
    crackPicture: findCrackPictures(table, OUT),
    loudness: { target: LOUDNESS, workAsIs: mastering.before, music: mastering.music, liftDb: mastering.liftDb, ceilingDb: mastering.ceilingDb, roundedPercent: mastering.roundedPercent, limitedPercent: mastering.limitedPercent, deepestDb: mastering.deepestDb, beforeAac: mastering.measured, finalFile: final },
    audio: { rawSha256: table.audio.rawSha256, mixSha256: mastering.mixSha256, decodedSeconds: Number((pcm.n / SR).toFixed(3)) },
    net: table.net,
    pageErrors: table.pageErrors,
  };
  writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

// ---- 本体
let table;
if (AUDIO_ONLY) {
  if (!existsSync(TABLE) || !(existsSync(SILENT) || existsSync(LOSSLESS)) || !existsSync(RAW_WAV)) throw new Error('--audio-only の前に、絵を撮っておく必要がある');
  table = JSON.parse(readFileSync(TABLE, 'utf8'));
} else {
  table = await capture();
}
if (table && !CAPTURE_ONLY) {
  encodeFinal();
  const { mastering, final } = finishSound(table, false);
  await makeSheet(table);
  // 聞き比べ用：ガラスの音を足した版（絵は同じ）
  let glassVersion = null;
  if (WITH_GLASS && table.smashes) {
    const g = finishSound(table, true);
    const m = g.mastering;
    glassVersion = { file: OUT_GLASS, added: m.glass, liftDb: m.liftDb, roundedPercent: m.roundedPercent, limitedPercent: m.limitedPercent, deepestDb: m.deepestDb, finalFile: g.final };
  }
  verify(table, mastering, final, glassVersion);
  console.log(`出力: ${OUT}（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
}
