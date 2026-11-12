// 「作業場」の宣伝の動画を作る（V006）。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/workspace.mjs                 → promo/out/workspace.mp4（3840×2160、60fps、H.264、1コマを12回の時刻で描いて重ねる）
//   node promo/workspace.mjs --draft         → promo/out/workspace-draft.mp4（1920×1080、60fps、6回）と、1秒ごとのコマを並べた1枚
//   node promo/workspace.mjs --stills        → 要の静止画を 1920×1080 で promo/out/workspace-frames/（--size 3840x2160 で大きく）
//   node promo/workspace.mjs --look 0.5,2.9  → 指定した秒の絵を 1920×1080 で promo/out/workspace-look/ に出す
//   node promo/workspace.mjs --audio-only    → 絵は撮り直さず、音だけ作り直して合わせる（--draft と併用できる）
//   node promo/workspace.mjs --bench         → 1コマの時間を測って、全部を描く時間を見積もる
//
// 時間、文言、順、音は promo/workspace/timeline.json だけから作る。ターミナルの文字は promo/workspace/records/ の本物の記録から作る。
// 本番（ludion.ai）には要求を送らない。舞台のブラウザは手元のサーバーをプロキシにし、要求をすべて記録して、外へのものは断る。
// まだ撮っていない場面（timeline.json の scenes の ready が false）は、空の板のまま出る。

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { synthesize, writeWav } from './workspace/audio.mjs';
import { waitForQuiet } from './workspace/quiet.mjs';
import { buildTerminal } from './workspace/terminal.mjs';

const ffmpegPath = ffmpegInstaller.path;
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const STAGE = resolve(HERE, 'workspace');
const OUT_DIR = resolve(HERE, 'out');
const ASSETS = resolve(HERE, 'launch', 'assets');
const TIMELINE_PATH = resolve(STAGE, 'timeline.json');
const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8'));

const DRAFT = has('--draft');
const STILLS = has('--stills');
const LOOK = valueOf('--look');
const AUDIO_ONLY = has('--audio-only');
const BENCH = has('--bench');
const TAG = DRAFT ? '-draft' : '';
const OUT = resolve(OUT_DIR, `workspace${TAG}.mp4`);
const SILENT = resolve(OUT_DIR, `workspace${TAG}-silent.mp4`);
const WAV = resolve(OUT_DIR, `workspace${TAG}-mix.wav`);
const REPORT = resolve(OUT_DIR, `workspace${TAG}-report.json`);
mkdirSync(OUT_DIR, { recursive: true });

// ---- ターミナルの行（本物の記録から）
const terminal = buildTerminal(timeline, resolve(STAGE, 'records'), ROOT);
const ITEMS = terminal.pages.flatMap((page) => page.items);
// 「許可する」の画面（記録を取ったときに撮ったもの。コミットしない）
const SHOTS_DIR = resolve(OUT_DIR, 'v006-record', `${timeline.browser.shots}-shots`);
if (!existsSync(resolve(SHOTS_DIR, 'manifest.json'))) throw new Error(`「許可する」の画面がない（promo/out/v006-record/${timeline.browser.shots}-shots/）。node promo/workspace/connect.mjs --persist <置き場> --check --as ${timeline.browser.shots} で撮る`);
const shots = JSON.parse(readFileSync(resolve(SHOTS_DIR, 'manifest.json'), 'utf8'));

// ---- 表の決まりを確かめる（作る前に落とす）
function checkTimeline() {
  const errors = [];
  if (timeline.duration < 34 || timeline.duration > 38) errors.push(`長さが ${timeline.duration} 秒。約36秒にする`);
  for (const c of timeline.captions) {
    const need = 1.2 + 0.08 * ([...c.ja].length + [...c.en].length);
    const shown = c.out - c.in - 0.62; // 見出しが半分より濃く見えている時間
    if (shown + 1e-6 < need) errors.push(`「${c.ja}」の表示が ${shown.toFixed(2)} 秒。${need.toFixed(2)} 秒以上にする`);
  }
  for (let i = 1; i < timeline.captions.length; i++) if (timeline.captions[i].in < timeline.captions[i - 1].out) errors.push(`見出し ${i} と ${i + 1} が重なる`);
  // 公式アカウントで使う文言に「AI」を入れない。ターミナルに出す行（本物の記録）も見る
  const words = [...timeline.captions.flatMap((c) => [c.ja, c.en]), timeline.end.wordmark, timeline.end.domain, timeline.terminal.title, ...ITEMS.map((i) => i.text)];
  for (const w of words) if (/(^|[^a-z.])ai([^a-z]|$)/i.test(w.replace(/ludion\.ai|Ludion-ai\//gi, ''))) errors.push(`「AI」の言葉がある: ${w}`);
  const beat = 60 / timeline.bpm;
  for (const s of timeline.scenes) if (Math.abs(s.from / beat - Math.round(s.from / beat)) > 1e-6) errors.push(`場面${s.id}の始まり ${s.from} が拍にのっていない`);
  // ターミナルの行は、面ごとに、上から出る順に時刻が進むこと
  for (const page of terminal.pages) for (let i = 1; i < page.items.length; i++) if (page.items[i].at < page.items[i - 1].at) errors.push(`${page.id} の行の時刻の順が合わない: ${page.items[i].text}`);
  const B = timeline.browser;
  if (!(B.in[1] <= B.cursor.move[0] && B.cursor.move[1] <= B.press && B.press < B.out[0])) errors.push('「許可する」の画面の時刻の順が合わない');
  const keys = timeline.camera.keys;
  for (let i = 1; i < keys.length; i++) if (keys[i].t <= keys[i - 1].t) errors.push(`カメラのキー ${i} の時刻が前より早い`);
  if (errors.length) throw new Error(`表の決まりに合わない:\n- ${errors.join('\n- ')}`);
}
checkTimeline();

for (const need of ['fonts/NotoSansJP[wght].ttf', 'fonts/NotoSansMono[wdth,wght].ttf']) {
  if (!existsSync(resolve(ASSETS, need))) throw new Error(`promo/launch/assets/${need} がない。promo/launch/ASSETS.md を見て置く`);
}

// ---- 手元だけのサーバー：舞台のファイルを渡し、絵を受け取る
const MIME = { '.png': 'image/png', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const netLog = [];
let onFrame = async () => {};
const pageData = { terminal, shots: { base: '/shots/', allowButton: shots.allowButton, viewport: shots.viewport } };
const rpc = { waiting: null, queue: [], pending: new Map(), nextId: 1, ready: null };
function pumpRpc() {
  if (!rpc.waiting || rpc.queue.length === 0) return;
  const res = rpc.waiting;
  rpc.waiting = null;
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(rpc.queue.shift()));
}
function stageCall(method, ...args) {
  return new Promise((done, fail) => {
    const id = rpc.nextId++;
    rpc.pending.set(id, { done, fail });
    rpc.queue.push({ id, method, args });
    pumpRpc();
  });
}
const readBody = (req) =>
  new Promise((done) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => done(Buffer.concat(chunks)));
  });
function safeJoin(base, rel) {
  const full = resolve(base, rel);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}
const server = createServer((req, res) => {
  // プロキシとして届いた要求は、外へ出ようとしたもの。記録して断る
  if (/^https?:\/\//i.test(req.url) && !req.url.startsWith(`http://127.0.0.1:${server.address().port}/`)) {
    netLog.push({ url: req.url, allowed: false });
    res.writeHead(403);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);
  netLog.push({ url: `local:${path.startsWith('/frame/') ? '/frame' : path.startsWith('/rpc/') ? '/rpc' : path.startsWith('/vendor/three/') ? '/vendor/three' : path}`, allowed: true });
  if (req.method === 'POST' && path.startsWith('/frame/')) {
    readBody(req).then(async (body) => {
      await onFrame(path.slice('/frame/'.length), body);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
    return;
  }
  if (path === '/rpc/next') {
    rpc.waiting = res;
    if (rpc.ready) {
      rpc.ready();
      rpc.ready = null;
    }
    pumpRpc();
    return;
  }
  if (req.method === 'POST' && path.startsWith('/rpc/result/')) {
    readBody(req).then((body) => {
      const id = Number(path.slice('/rpc/result/'.length));
      const job = rpc.pending.get(id);
      rpc.pending.delete(id);
      const { result, error } = JSON.parse(body.toString('utf8'));
      if (job) {
        if (error) job.fail(new Error(`舞台のエラー: ${error}`));
        else job.done(result);
      }
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  if (req.method === 'POST' && path === '/log') {
    readBody(req).then((body) => {
      console.error('舞台のエラー:', body.toString('utf8'));
      res.writeHead(200);
      res.end('ok');
    });
    return;
  }
  let file = null;
  if (path === '/' || path === '/stage.html') file = resolve(STAGE, 'stage.html');
  else if (path === '/stage.js') file = resolve(STAGE, 'stage.js');
  else if (path === '/timeline.json') file = TIMELINE_PATH;
  else if (path === '/data/page.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pageData));
    return;
  } else if (path === '/vendor/inter.woff2') file = resolve(ROOT, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
  else if (path.startsWith('/vendor/three/')) file = safeJoin(resolve(ROOT, 'node_modules/three'), path.slice('/vendor/three/'.length));
  else if (path.startsWith('/assets/')) file = safeJoin(ASSETS, path.slice('/assets/'.length));
  else if (path.startsWith('/shots/')) file = safeJoin(SHOTS_DIR, path.slice('/shots/'.length));
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    netLog.push({ url: `local-missing:${path}`, allowed: false });
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});
server.on('connect', (req, socket) => {
  netLog.push({ url: `https://${req.url}`, allowed: false });
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`);
  return r;
}
const lastJson = (text) => JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1));

// ---- 舞台のブラウザ（Playwright を通さず直に起こす。1コマが速い）
function headlessShellPath() {
  const full = chromium.executablePath();
  const build = /chromium-(\d+)/.exec(full)?.[1];
  const shell = resolve(dirname(dirname(dirname(full))), `chromium_headless_shell-${build}`, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  if (!existsSync(shell)) throw new Error('headless shell がない。npx playwright install chromium を実行する');
  return shell;
}
async function openStage(width, height, samples) {
  // PC の守り：ほかの試験や書き出しが動いている間は描かない（0 になるまで待つ）
  await waitForQuiet(Number(valueOf('--wait-max') || 8));
  const { port } = server.address();
  // 一時の置き場は promo/out/ の中（この PC では、一時ファイルを作業の置き場の外に作らない）
  const profile = mkdtempSync(join(OUT_DIR, 'workspace-profile-'));
  rpc.queue.length = 0;
  rpc.waiting = null;
  const ready = new Promise((done) => {
    rpc.ready = done;
  });
  // Windows のサンドボックスはこの起動のしかたでは権限で落ちるので外す。この舞台で動くのは promo/workspace/ のコードだけで、作品の JS は動かさない
  const child = spawn(
    headlessShellPath(),
    ['--headless', '--no-sandbox', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-gpu-watchdog', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-networking', '--disable-component-update', '--disable-default-apps', '--disable-sync', '--disable-domain-reliability', '--no-pings', '--metrics-recording-only', '--safebrowsing-disable-auto-update', `--proxy-server=http://127.0.0.1:${port}`, '--window-size=800,450', `http://127.0.0.1:${port}/stage.html?w=${width}&h=${height}&samples=${samples}`],
    { stdio: 'ignore' },
  );
  const close = async () => {
    child.kill();
    await new Promise((done) => setTimeout(done, 400));
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch {
      // 一時ファイルが消せなくても、作ったものには関係しない
    }
  };
  try {
    const timeout = new Promise((_, fail) => setTimeout(() => fail(new Error('舞台が3分で立ち上がらなかった')), 180000).unref());
    await Promise.race([ready, timeout]);
    const info = await stageCall('info');
    console.log('舞台:', JSON.stringify(info));
    if (/swiftshader|llvmpipe|microsoft basic/i.test(info.gpu)) throw new Error(`実の GPU ではない: ${info.gpu}`);
    return { close, info, port };
  } catch (error) {
    await close();
    throw error;
  }
}
function rawToPng(buffer, width, height, file) {
  const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-i', '-', '-vf', 'vflip,format=rgb24', '-frames:v', '1', file], { input: buffer, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
}
async function renderStills(times, width, height, samples, dir, namer) {
  mkdirSync(dir, { recursive: true });
  const { close, info, port } = await openStage(width, height, samples);
  const results = [];
  try {
    for (let i = 0; i < times.length; i++) {
      const t = times[i];
      const file = resolve(dir, namer(i, t));
      await new Promise((done, fail) => {
        onFrame = async (_id, buffer) => {
          try {
            rawToPng(buffer, width, height, file);
            results.push({ t, file: file.slice(ROOT.length + 1).replace(/\\/g, '/'), sha256: createHash('sha256').update(buffer).digest('hex') });
            done();
          } catch (e) {
            fail(e);
          }
        };
        stageCall('still', t, `http://127.0.0.1:${port}/frame/${i}`).catch(fail);
      });
      console.log(`静止画: ${t}秒 → ${namer(i, t)}`);
    }
    const measure = await stageCall('measure');
    return { results, measure, info };
  } finally {
    await close();
  }
}
const encodeArgs = (width, height, draft, out) => ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(timeline.fps), '-i', '-', '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', draft ? 'medium' : 'slow', '-crf', draft ? '17' : '14', '-r', String(timeline.fps), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', ...out];
async function renderVideo(width, height, samples) {
  const { close, info, port } = await openStage(width, height, samples);
  try {
    const totalFrames = Math.round(timeline.duration * timeline.fps);
    const ffmpeg = spawn(ffmpegPath, encodeArgs(width, height, DRAFT, ['-movflags', '+faststart', SILENT]), { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffmpegDone = new Promise((done, fail) => {
      ffmpeg.on('error', fail);
      ffmpeg.on('close', (code) => (code === 0 ? done() : fail(new Error(`ffmpeg が ${code} で止まった`))));
    });
    onFrame = (_id, buffer) => new Promise((done, fail) => ffmpeg.stdin.write(buffer, (error) => (error ? fail(error) : done())));
    const started = Date.now();
    const sum = { paint: 0, draw: 0, read: 0, post: 0 };
    for (let frame = 0; frame < totalFrames; frame++) {
      const timing = await stageCall('frame', frame, `http://127.0.0.1:${port}/frame/${frame}`);
      for (const k of Object.keys(sum)) sum[k] += timing[k] ?? 0;
      if (frame % 300 === 0) {
        const sec = (Date.now() - started) / 1000;
        console.log(`${(frame / timeline.fps).toFixed(1)}秒 / ${timeline.duration}秒（${sec.toFixed(0)}秒経過、1コマ ${frame ? ((sec / frame) * 1000).toFixed(0) : '-'}ms）`);
      }
    }
    ffmpeg.stdin.end();
    await ffmpegDone;
    const measure = await stageCall('measure');
    const seconds = (Date.now() - started) / 1000;
    const perFrame = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number((v / totalFrames).toFixed(1))]));
    console.log(`かかった時間: ${seconds.toFixed(0)}秒（1コマ ${((seconds / totalFrames) * 1000).toFixed(0)}ms。内訳 ${JSON.stringify(perFrame)}）`);
    return { measure, info, seconds: Number(seconds.toFixed(1)), totalFrames, msPerFrame: Number(((seconds / totalFrames) * 1000).toFixed(1)), perFrame };
  } finally {
    await close();
  }
}
function mux() {
  const synth = synthesize(timeline, terminal);
  const wavHash = writeWav(WAV, synth.L, synth.R);
  const L = timeline.audio.loudness;
  const af = `loudnorm=I=${L.I}:TP=${L.TP}:LRA=${L.LRA}`;
  const first = run(ffmpegPath, ['-hide_banner', '-i', WAV, '-af', `${af}:print_format=json`, '-f', 'null', '-']);
  const m = lastJson(first.stderr);
  console.log('loudnorm 1回目:', JSON.stringify(m));
  const second = `${af}:linear=true:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:print_format=json`;
  const done = run(ffmpegPath, ['-y', '-hide_banner', '-i', SILENT, '-i', WAV, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', second, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', '-t', String(timeline.duration), '-movflags', '+faststart', OUT]);
  const applied = lastJson(done.stderr);
  console.log('loudnorm 2回目:', JSON.stringify(applied));
  if (applied.normalization_type !== 'linear') throw new Error(`loudnorm が ${applied.normalization_type} になった。音の大小が潰れるので止める`);
  return { wavHash, first: m, applied, limited: synth.limited, events: synth.events };
}
/** 1秒ごとのコマを並べた1枚（通しの mp4 から）。 */
function makeSecondsSheet(video, out) {
  const cols = 6;
  const rows = Math.ceil(timeline.duration / cols);
  run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', video, '-vf', `fps=1:start_time=0.5:round=down,scale=640:360:flags=area,tile=${cols}x${rows}:padding=8:margin=8:color=white`, '-frames:v', '1', out]);
}
function netSummary() {
  const counts = {};
  for (const e of netLog) {
    let host = 'local';
    if (!e.url.startsWith('local')) {
      try {
        host = new URL(e.url).hostname;
      } catch {
        host = e.url;
      }
    }
    const key = `${host}${e.allowed ? '' : '（止めた）'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  const production = netLog.filter((e) => /(^|\/\/|\.)ludion\.ai/i.test(e.url));
  const external = netLog.filter((e) => !e.url.startsWith('local'));
  return { total: netLog.length, byHost: counts, productionRequests: production.length, externalAttempts: external.map((e) => e.url) };
}

// ---- 本体
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const report = { args: argv, timelineSha256: createHash('sha256').update(readFileSync(TIMELINE_PATH)).digest('hex') };
report.terminal = terminal.pages.map((page) => ({ id: page.id, record: page.record, source: page.source, speedAverage: page.speedAverage, speedLabel: page.speedLabel, recEnd: page.recEnd, clock: page.clock, cut: page.cut, items: page.items.filter((i) => i.kind !== 'code' || i.id).map((i) => `${i.kind}@${i.at}: ${i.text}`) }));
report.shots = { dir: `promo/out/v006-record/${timeline.browser.shots}-shots/`, consentTexts: shots.consentTexts, doneText: shots.doneText, blockedRequests: shots.blockedRequests };
report.notReady = timeline.scenes.filter((s) => !s.ready).map((s) => `場面${s.id}（${s.waits}）`);
try {
  if (LOOK) {
    const times = LOOK.split(',').map(Number);
    const size = (valueOf('--size') || '1920x1080').split('x').map(Number);
    report.look = await renderStills(times, size[0], size[1], Number(valueOf('--samples') || 6), resolve(OUT_DIR, 'workspace-look'), (_i, t) => `t${t.toFixed(2).padStart(6, '0')}.png`);
  } else if (BENCH) {
    const rows = [];
    for (const [w, h, s] of [[1920, 1080, 6], [3840, 2160, 12]]) {
      const { close, info, port } = await openStage(w, h, s);
      report.gpu = info.gpu;
      const encoder = spawn(ffmpegPath, encodeArgs(w, h, w === 1920, ['-f', 'null', '-']), { stdio: ['pipe', 'inherit', 'inherit'] });
      const encoded = new Promise((done) => encoder.on('close', done));
      onFrame = (_id, buffer) => new Promise((done, fail) => encoder.stdin.write(buffer, (e) => (e ? fail(e) : done())));
      // 場面ごとに 30 コマずつ
      let frames = 0;
      const begin = Date.now();
      for (const t of [0.5, 2, 3.5, 5, 7, 8.8, 13, 20, 28, 33, 35]) {
        const f = Math.round(t * timeline.fps);
        for (let i = 0; i < 30; i++) {
          await stageCall('frame', f + i, `http://127.0.0.1:${port}/frame/${f + i}`);
          frames += 1;
        }
      }
      encoder.stdin.end();
      await encoded;
      const ms = (Date.now() - begin) / frames;
      rows.push({ width: w, height: h, samples: s, msPerFrame: Math.round(ms), totalMinutes: Number(((ms * timeline.duration * timeline.fps) / 60000).toFixed(1)) });
      console.log(JSON.stringify(rows.at(-1)));
      onFrame = async () => {};
      await close();
    }
    report.bench = rows;
  } else if (STILLS) {
    const size = (valueOf('--size') || '1920x1080').split('x').map(Number);
    report.stills = await renderStills(timeline.stills, size[0], size[1], Number(valueOf('--samples') || 12), resolve(OUT_DIR, 'workspace-frames'), (i, t) => `still-${String(i + 1).padStart(2, '0')}-t${t.toFixed(2)}.png`);
  } else {
    if (!AUDIO_ONLY) {
      const [w, h, s] = DRAFT ? [1920, 1080, 6] : [3840, 2160, 12];
      report.video = await renderVideo(w, h, s);
    }
    if (!existsSync(SILENT)) throw new Error('--audio-only の前に、絵を描いておく必要がある');
    report.audio = mux();
  }
} finally {
  report.network = netSummary();
  console.log('通信:', JSON.stringify(report.network));
  server.closeAllConnections?.();
  server.close();
}
if (report.network.productionRequests !== 0) throw new Error('本番へ要求を送ってしまった');
{
  // カメラが寄って追う行は、字の高さが画面の高さの 4.5% 以上で、画面の幅に収まること
  const m = (report.stills ?? report.look ?? report.video)?.measure?.terminal;
  if (m && !(Object.values(m.textInkRatio).every((r) => r >= 0.045) && Object.values(m.rightAt).every((r) => r <= 0.97))) throw new Error(`ターミナルの字の大きさが決まりに合わない: ${JSON.stringify(m.textInkRatio)}、右端 ${JSON.stringify(m.rightAt)}`);
}
if (!LOOK && !BENCH && !STILLS) {
  report.probe = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,duration,sample_rate,channels,color_space:format=duration,size,bit_rate', '-of', 'default=nw=1', OUT]).stdout;
  console.log(report.probe);
  const sheet = resolve(OUT_DIR, `workspace${TAG}-sheet.png`);
  makeSecondsSheet(OUT, sheet);
  console.log(`出力: promo/out/workspace${TAG}.mp4（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）、並べた1枚: promo/out/workspace${TAG}-sheet.png`);
}
const reportPath = STILLS ? resolve(OUT_DIR, 'workspace-stills-report.json') : LOOK ? resolve(OUT_DIR, 'workspace-look-report.json') : BENCH ? resolve(OUT_DIR, 'workspace-bench-report.json') : REPORT;
writeFileSync(reportPath, JSON.stringify(report, null, 2));
