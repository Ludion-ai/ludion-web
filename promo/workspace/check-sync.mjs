// 出来事の絵と音のずれを測る（V006）。
//   node promo/workspace/check-sync.mjs promo/out/workspace-draft.mp4
// 絵：出来事の前後のコマの差を見て、絵が変わった最初のコマを探す（カメラが止まっている出来事だけ）。
// 音：表から作った WAV（出来事を置いた時刻が分かっている）と、mp4 に入った音を重ね合わせ、ずれを標本の数で出す。
// 報告（…-report.json）と WAV（…-mix.wav）は、mp4 と同じ名前で隣にあるものを読む。

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const file = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(file.replace(/\.mp4$/, '-report.json'), 'utf8'));
const wav = file.replace(/\.mp4$/, '-mix.wav');
const FPS = 60;
const SR = 48000;
const ff = (args) => {
  const r = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout;
};

// ---- 絵
const W = 480;
const H = 270;
function pictureFrame(t) {
  const from = Math.round(t * FPS) - 6;
  const count = 14;
  // コマの番号で選ぶ（時刻で頭出しすると、1コマずれることがあった）
  const raw = ff(['-i', file, '-vf', `select='between(n,${from},${from + count - 1})',scale=${W}:${H}:flags=area,format=gray`, '-vsync', '0', '-f', 'rawvideo', '-']);
  const size = W * H;
  const diffs = [];
  for (let f = 1; f < count; f++) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Math.abs(raw[f * size + i] - raw[(f - 1) * size + i]);
    diffs.push(sum / size);
  }
  // diffs[k] は、コマ from+k と from+k+1 の差。出来事の前の3つを、静かなときの差とする
  const base = Math.max(...diffs.slice(0, 3));
  const k = diffs.findIndex((d, i) => i >= 3 && d > base * 4 + 0.004);
  return { frame: k < 0 ? null : from + k + 1, base: Number(base.toFixed(4)), diffs: diffs.map((d) => Number(d.toFixed(3))) };
}

// ---- 音
function mono(input, from, seconds) {
  const raw = ff(['-ss', String(from), '-t', String(seconds), '-i', input, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
}
function lagAround(t) {
  const from = Math.max(0, t - 0.4);
  const a = mono(wav, from, 1.4);
  const b = mono(file, from, 1.4);
  const n = Math.min(a.length, b.length) - 4800;
  let best = { lag: 0, score: -Infinity };
  for (let lag = -2400; lag <= 2400; lag++) {
    let sum = 0;
    for (let i = 2400; i < n; i += 3) sum += a[i] * b[i + lag];
    if (sum > best.score) best = { lag, score: sum };
  }
  return best.lag;
}

const rows = [];
for (const e of report.audio.events.filter((x) => ['save', 'say'].includes(x.kind))) {
  const pic = pictureFrame(e.t);
  const lag = lagAround(e.t);
  const audioAt = e.t + lag / SR;
  const pictureAt = pic.frame == null ? null : pic.frame / FPS;
  rows.push({ event: e.kind, planned: e.t, pictureFrame: pic.frame, pictureAt: pictureAt == null ? null : Number(pictureAt.toFixed(4)), audioLagSamples: lag, audioAt: Number(audioAt.toFixed(4)), offsetMs: pictureAt == null ? null : Number(((pictureAt - audioAt) * 1000).toFixed(1)), offsetFrames: pictureAt == null ? null : Number(((pictureAt - audioAt) * FPS).toFixed(2)), diffs: pic.diffs });
}
console.log(JSON.stringify({ file: process.argv[2], rows }, null, 1));
