// 出来事の絵と音のずれを測る（V006）。
//   node promo/workspace/check-sync.mjs <置き場の mp4>
// 報告（…-report.json）と WAV（…-mix.wav）は、mp4 と同じ名前で隣にあるものを読む。
//
// 絵：舞台が、出来事ごとに「その絵が出る四角」を、前後のコマについて出している（report の video.events。カメラの動きに合わせて、コマごとに四角が動く）。
//     コマをその四角で切り出して同じ大きさにそろえ、隣のコマとの差を見る。出来事のコマより前の2つの差を「静かなときの差」とし、それをはっきり超えた最初のコマが、絵の変わったコマ。
//     止めた四角だと、カメラの動きを出来事と取り違えるので、四角を動かす。
// 音：表から作った WAV（出来事を置いた時刻が分かっている）と、mp4 に入った音を重ね合わせ、ずれを標本の数で出す。
// 打鍵の1つずつは、絵の文字が毎コマ変わるので、絵からは測らない。打ち始め（最初の1字）だけを測り、残りは計算で出す（字が出るのは、打鍵の時刻以後の最初のコマ）。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const file = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(file.replace(/\.mp4$/, '-report.json'), 'utf8'));
const wav = file.replace(/\.mp4$/, '-mix.wav');
const FPS = 60;
const SR = 48000;
const W = report.video.info.width;
const H = report.video.info.height;
const K = W / 1920; // 四角は 1920×1080 の画素
const ff = (args) => {
  const r = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
};

// ---- 絵
/** コマ from〜to を、灰色の生の絵で取る（コマの番号で選ぶ）。 */
function frames(from, to) {
  const raw = ff(['-i', file, '-vf', `select='between(n,${from},${to})',format=gray`, '-vsync', '0', '-f', 'rawvideo', '-']);
  const size = W * H;
  if (raw.length < size * (to - from + 1)) throw new Error(`コマ ${from}〜${to} が取れなかった`);
  return (f) => raw.subarray((f - from) * size, (f - from + 1) * size);
}
/** 四角を切り出して、決めた大きさにそろえる（面積の平均）。 */
function crop(gray, rect, tw, th) {
  const out = new Float32Array(tw * th);
  const x0 = rect.x * K;
  const y0 = rect.y * K;
  const sx = (rect.w * K) / tw;
  const sy = (rect.h * K) / th;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const ax = Math.max(0, Math.floor(x0 + i * sx));
      const bx = Math.min(W, Math.max(ax + 1, Math.ceil(x0 + (i + 1) * sx)));
      const ay = Math.max(0, Math.floor(y0 + j * sy));
      const by = Math.min(H, Math.max(ay + 1, Math.ceil(y0 + (j + 1) * sy)));
      let sum = 0;
      for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) sum += gray[y * W + x];
      out[j * tw + i] = sum / ((bx - ax) * (by - ay));
    }
  }
  return out;
}
function picture(event) {
  const F = event.frame;
  const from = Math.max(0, F - 4);
  const to = F + 7;
  for (let f = from; f <= to; f++) if (!event.rects[f]) return { frame: null, why: `コマ ${f} で、四角が画面の外` };
  const get = frames(from, to);
  const base = event.rects[F];
  const scale = 64 / Math.max(base.w, base.h);
  const tw = Math.max(4, Math.round(base.w * scale));
  const th = Math.max(4, Math.round(base.h * scale));
  const crops = {};
  for (let f = from; f <= to; f++) crops[f] = crop(get(f), event.rects[f], tw, th);
  const diff = {};
  for (let f = from + 1; f <= to; f++) {
    let sum = 0;
    for (let i = 0; i < tw * th; i++) sum += Math.abs(crops[f][i] - crops[f - 1][i]);
    diff[f] = sum / (tw * th);
  }
  const quiet = Math.max(diff[F - 2] ?? 0, diff[F - 1] ?? 0);
  // 静かなときの差の2倍を、はっきり超えること（カメラが速く動く所では、静かなときの差も大きい）
  const floor = quiet * 2 + 1.5;
  let found = null;
  for (let f = F; f <= to; f++) {
    if (diff[f] > floor) {
      found = f;
      break;
    }
  }
  return { frame: found, quiet: Number(quiet.toFixed(2)), floor: Number(floor.toFixed(2)), diffs: Object.fromEntries(Object.entries(diff).map(([f, d]) => [f, Number(d.toFixed(2))])), moving: JSON.stringify(event.rects[F - 2] ?? base) !== JSON.stringify(event.rects[F + 2] ?? base) };
}

// ---- 音
function mono(input, from, seconds) {
  const raw = ff(['-ss', String(from), '-t', String(seconds), '-i', input, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}
/** 音の立ち上がりを強める（隣の標本との差を取る）。パッドやベルのような、同じ波がくり返す音だけで重ねると、1周期ずれた所を取り違えるため。 */
const edges = (x) => {
  const out = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) out[i] = x[i] - x[i - 1];
  return out;
};
/** WAV と mp4 の音を重ね合わせて、ずれ（標本の数）を出す。sure は、いちばん合う所が、ほかの所よりはっきり高いか。 */
function lagIn(from, seconds, range) {
  const a = edges(mono(wav, from, seconds));
  const b = edges(mono(file, from, seconds));
  const n = Math.min(a.length, b.length) - range * 2;
  const score = new Float64Array(range * 2 + 1);
  for (let lag = -range; lag <= range; lag++) {
    let sum = 0;
    for (let i = range; i < n; i++) sum += a[i] * b[i + lag];
    score[lag + range] = sum;
  }
  let best = 0;
  for (let i = 1; i < score.length; i++) if (score[i] > score[best]) best = i;
  let second = -Infinity;
  for (let i = 0; i < score.length; i++) if (Math.abs(i - best) > 8) second = Math.max(second, score[i]);
  return { lag: best - range, sure: score[best] > 0 && second < score[best] * 0.8 };
}
// 全体のずれ：打鍵のある最初の6秒で測る（mp4 の音の遅れは、動画の中で変わらない）
const whole = lagIn(0, 6, 2400);
/** 出来事のまわりのずれ。その出来事の音だけでは決めきれないとき（同じ波がくり返す音）は、全体のずれを使う。 */
function lagAround(t) {
  const local = lagIn(Math.max(0, t - 0.25), 0.7, 1200);
  return local.sure ? { lag: local.lag, from: '出来事のまわり' } : { lag: whole.lag, from: '全体' };
}

const sounds = new Map(report.audio.events.filter((e) => e.id).map((e) => [e.id, e]));
const rows = [];
for (const event of report.video.events) {
  const sound = sounds.get(event.id);
  if (!sound) continue; // 音の付かない出来事（道具の行など）は、表に入れない
  const pic = picture(event);
  const { lag, from: lagFrom } = lagAround(sound.t);
  const soundFrame = (sound.t + lag / SR) * FPS;
  rows.push({ id: event.id, planned: Number(event.t.toFixed(4)), plannedFrame: event.frame, soundAt: Number(sound.t.toFixed(4)), pictureFrame: pic.frame, audioLagSamples: lag, audioLagFrom: lagFrom, offsetFrames: pic.frame == null ? null : Number((pic.frame - soundFrame).toFixed(2)), cameraMoving: pic.moving ?? null, quiet: pic.quiet, floor: pic.floor, diffs: pic.diffs, why: pic.why });
}
// 打鍵（計算）：字が出るのは、打鍵の時刻以後の最初のコマ
const ticks = report.audio.events.filter((e) => e.kind === 'type');
const late = ticks.map((e) => Math.ceil(e.t * FPS - 1e-6) / FPS - e.t);
const summary = { wholeAudioLagSamples: whole.lag, wholeAudioLagSure: whole.sure, events: rows.length, measured: rows.filter((r) => r.pictureFrame != null).length, maxAbsOffsetFrames: Math.max(...rows.filter((r) => r.offsetFrames != null).map((r) => Math.abs(r.offsetFrames))), typeTicks: { count: ticks.length, maxLateFrames: Number((Math.max(...late) * FPS).toFixed(2)), how: '計算（字が出るのは、打鍵の時刻以後の最初のコマ）' } };
console.log(JSON.stringify({ file: process.argv[2], summary, rows }, null, 1));
