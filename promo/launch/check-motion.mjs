// 完成した動画の動きを測る（V002）。連続するコマの差を出し、まわりより急に大きいところ（飛び、ちらつき）を探す。
//   node promo/launch/check-motion.mjs promo/out/launch-draft.mp4
// 目で見る代わりにはならない。飛びを見落とさないための道具。

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const file = resolve(process.argv[2]);
const W = 320;
const H = 180;
const r = spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vf', `scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
if (r.status !== 0) throw new Error(String(r.stderr));
const size = W * H;
const count = Math.floor(r.stdout.length / size);
const diffs = new Float64Array(count);
for (let f = 1; f < count; f++) {
  let sum = 0;
  const a = (f - 1) * size;
  const b = f * size;
  for (let i = 0; i < size; i++) sum += Math.abs(r.stdout[a + i] - r.stdout[b + i]);
  diffs[f] = sum / size;
}

// まわり（前後 12 コマ）の中央値と比べる
const median = (arr) => {
  const s = [...arr].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const spikes = [];
for (let f = 13; f < count - 13; f++) {
  const around = [];
  for (let k = -12; k <= 12; k++) if (k !== 0) around.push(diffs[f + k]);
  const m = median(around);
  if (diffs[f] > m * 2.2 && diffs[f] - m > 0.35) spikes.push({ frame: f, t: Number((f / 60).toFixed(3)), diff: Number(diffs[f].toFixed(2)), around: Number(m.toFixed(2)) });
}
// 秒ごとの動きの量
const perSecond = [];
for (let s = 0; s < Math.floor(count / 60); s++) {
  let sum = 0;
  let max = 0;
  for (let f = s * 60; f < (s + 1) * 60 && f < count; f++) {
    sum += diffs[f];
    max = Math.max(max, diffs[f]);
  }
  perSecond.push({ s, mean: Number((sum / 60).toFixed(2)), max: Number(max.toFixed(2)) });
}
console.log(JSON.stringify({ frames: count, spikeCount: spikes.length, spikes: spikes.slice(0, 60), perSecond }));
