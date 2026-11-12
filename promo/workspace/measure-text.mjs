// 描いた絵から、「許可する」の画面の字の高さを測る（V006）。計算ではなく、絵の画素を数える。
//   node promo/workspace/measure-text.mjs [--at 3.88] [--video <mp4>] [--what browser] [--min 0.045 --need 許可する]
// --what は、測る字の種類の頭（browser：「許可する」の画面、site：サイトの窓、terminal：ターミナルの行）
// --video を付けると、静止画ではなく、その動画の同じ時刻のコマを測る（カメラが止まっている時刻だけ）。
// 読むもの：置き場の workspace-stills-report.json（舞台が出した、その時刻に読める字の四角）と、workspace-frames/ のその時刻の静止画。
// 測り方：字の四角を少し広げて切り出し、地の色（四角のふちの色）から離れた画素のある行を数える。上端の行から下端の行までが、字の高さ。
// --need の字が --min（画面の高さとの比）を下回れば、止まる。

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { OUT_ROOT } from './out.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const at = valueOf('--at') || '3.88';
const report = JSON.parse(readFileSync(resolve(OUT_ROOT, 'workspace-stills-report.json'), 'utf8'));
const texts = report.stills.texts[at];
if (!texts) throw new Error(`静止画の報告に、${at} 秒の字の四角がない（timeline.json の measureAt に入れて、--stills を流す）`);
const dir = resolve(OUT_ROOT, 'workspace-frames');
const video = valueOf('--video');
const file = video ? `${video}（コマ ${Math.round(Number(at) * 60)}）` : readdirSync(dir).find((f) => f.endsWith(`-t${Number(at).toFixed(2)}.png`));
if (!file) throw new Error(`${at} 秒の静止画がない（timeline.json の stills に入れて、--stills を流す）`);
const probe = video ? spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', resolve(video)], { encoding: 'utf8' }).stdout.trim().split(',').map(Number) : [report.stills.info.width, report.stills.info.height];
const [W, H] = probe;
const r = video
  ? spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-i', resolve(video), '-vf', `select='eq(n\,${Math.round(Number(at) * 60)})',format=gray`, '-vsync', '0', '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 })
  : spawnSync(ffmpegInstaller.path, ['-hide_banner', '-loglevel', 'error', '-i', resolve(dir, file), '-vf', 'format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
if (r.status !== 0) throw new Error(String(r.stderr));
const gray = r.stdout;
const k = W / 1920; // 四角は 1920×1080 の画素

const rows = [];
const what = valueOf('--what') || 'browser';
for (const t of texts.filter((x) => x.what === what || x.what.startsWith(`${what}:`))) {
  const x0 = Math.max(0, Math.floor(t.x * k));
  const x1 = Math.min(W, Math.ceil((t.x + t.w) * k));
  const pad = Math.round(t.h * 0.2 * k);
  const y0 = Math.max(0, Math.floor(t.y * k) - pad);
  const y1 = Math.min(H, Math.ceil((t.y + t.h) * k) + pad);
  if (x1 - x0 < 8 || y1 - y0 < 8 || t.y < 0 || t.y + t.h > 1080) continue; // 画面の端で切れている行は測らない
  // 地の色：四角の上の辺と下の辺の、まん中の値
  const edge = [];
  for (let x = x0; x < x1; x++) edge.push(gray[y0 * W + x], gray[(y1 - 1) * W + x]);
  edge.sort((a, b) => a - b);
  const bg = edge[edge.length >> 1];
  let top = null;
  let bottom = null;
  for (let y = y0; y < y1; y++) {
    let ink = 0;
    for (let x = x0; x < x1; x++) if (Math.abs(gray[y * W + x] - bg) > 80) ink += 1;
    if (ink >= 2) {
      if (top === null) top = y;
      bottom = y;
    }
  }
  const px = top === null ? 0 : bottom - top + 1;
  rows.push({ what: t.what, text: t.text, tag: t.tag, fontPx: t.fontPx, inkPx: px, ratio: Number((px / H).toFixed(4)) });
}
console.log(JSON.stringify({ at: Number(at), still: file, size: `${W}x${H}`, rows }, null, 1));
const min = Number(valueOf('--min') || 0);
const need = valueOf('--need');
if (min && need) {
  const row = rows.find((x) => x.text === need);
  if (!row) throw new Error(`測る字「${need}」が、${at} 秒の絵にない`);
  if (row.ratio < min) throw new Error(`「${need}」の字の高さが ${(row.ratio * 100).toFixed(2)}%。${(min * 100).toFixed(1)}% 以上にする`);
}
