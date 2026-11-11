// Ludion の公式ローンチ動画を作る（docs/tasks/V002.md）。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/launch.mjs                 → promo/out/launch.mp4（3840×2160、60fps、H.264、ぶれ8回）
//   node promo/launch.mjs --draft         → promo/out/launch-draft.mp4（1920×1080、60fps、ぶれ2回）
//   node promo/launch.mjs --stills        → 要の静止画8枚を 3840×2160 で promo/out/launch-frames/、並べた1枚 promo/out/launch-sheet.png
//   node promo/launch.mjs --look 3.2,11.6 → 下見の下見。指定した秒の絵を 1920×1080 で promo/out/launch-look/ に出す
//   node promo/launch.mjs --audio-only    → 絵は撮り直さず、表から音だけ作り直して合わせる（--draft と併用できる）
//   node promo/launch.mjs --bench         → 1コマの時間を測って、全部を撮る時間を見積もる
//   node promo/launch.mjs --seam          → 画面に入る継ぎ目と出る継ぎ目の絵の差を測る
//
// 時間・文言・順・音は promo/launch/timeline.json だけから作る。
// 撮るときに外へは通信しない。作品を撮るブラウザは名前解決を手元だけに絞る。舞台のブラウザは手元のサーバーをプロキシにする。
// どちらも要求をすべて記録して断り、最後に本番への要求が 0 件であることを確かめる。

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { buildCopySnippet } from '@ludion/render';
import { findWork, readWork, toRenderable } from '../packages/ld/src/workspace.ts';
import { captureCards, captureSequence } from './launch/capture.mjs';
import { synthesize, writeWav } from './launch/audio.mjs';

const ffmpegPath = ffmpegInstaller.path;
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const LAUNCH = resolve(HERE, 'launch');
const OUT_DIR = resolve(HERE, 'out');
const CACHE = resolve(OUT_DIR, 'launch-cache');
const ASSETS = resolve(LAUNCH, 'assets');
const TIMELINE_PATH = resolve(LAUNCH, 'timeline.json');
const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8'));

const DRAFT = has('--draft');
const STILLS = has('--stills');
const LOOK = valueOf('--look');
const AUDIO_ONLY = has('--audio-only');
const BENCH = has('--bench');
const TAG = DRAFT ? '-draft' : '';
const OUT = resolve(OUT_DIR, `launch${TAG}.mp4`);
const SILENT = resolve(OUT_DIR, `launch${TAG}-silent.mp4`);
const WAV = resolve(OUT_DIR, `launch${TAG}-mix.wav`);
const REPORT = resolve(OUT_DIR, `launch${TAG}-report.json`);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE, { recursive: true });

// ---- 表の決まりを確かめる（作る前に落とす）
function checkTimeline() {
  const errors = [];
  if (timeline.duration < 45 || timeline.duration > 55) errors.push(`長さが ${timeline.duration} 秒。45〜55秒にする`);
  for (const c of timeline.captions) {
    const need = 1.2 + 0.08 * ([...c.ja].length + [...c.en].length);
    // 見出しが半分より濃く見えている時間で数える
    const shown = c.out - c.in - 0.62;
    if (shown + 1e-6 < need) errors.push(`「${c.ja}」の表示が ${shown.toFixed(2)} 秒。${need.toFixed(2)} 秒以上にする`);
  }
  const words = collectWords();
  for (const w of words) {
    // ドメインの ludion.ai はタスクが出せと言っているもの。単語としての AI を探す
    if (/(^|[^a-z.])ai([^a-z]|$)/i.test(w.replace(/ludion\.ai/gi, ''))) errors.push(`「AI」の言葉がある: ${w}`);
  }
  if (errors.length) throw new Error(`表の決まりに合わない:\n- ${errors.join('\n- ')}`);
}
function collectWords() {
  const c = timeline.captions.flatMap((x) => [x.ja, x.en]);
  return [...c, timeline.end.wordmark, timeline.end.domain, timeline.end.modelCredit?.show ? timeline.end.modelCredit.text : '', timeline.page.copyLabel, timeline.page.copiedLabel].filter(Boolean);
}
checkTimeline();

// ---- モデルと書体がなければ止める
for (const need of ['laptop/scene.gltf', 'laptop/scene.bin', 'fonts/NotoSansJP[wght].ttf', 'fonts/NotoSansMono[wdth,wght].ttf']) {
  if (!existsSync(resolve(ASSETS, need))) throw new Error(`promo/launch/assets/${need} がない。promo/launch/ASSETS.md を見て置く`);
}

// ---- 手元だけのサーバー：舞台のファイルを渡し、絵を受け取る
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.gltf': 'model/gltf+json', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const netLog = [];
let onFrame = async () => {};
let pageData = null;
// 舞台への呼び出し。舞台が /rpc/next で待ち、結果を /rpc/result/<id> に返す
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
    netLog.push({ url: req.url, phase: 'stage', allowed: false });
    res.writeHead(403);
    res.end();
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  const path = decodeURIComponent(url.pathname);
  netLog.push({ url: `local:${path.startsWith('/cache/sequence') ? '/cache/sequence' : path.startsWith('/frame/') ? '/frame' : path.startsWith('/rpc/') ? '/rpc' : path}`, phase: 'stage', allowed: true, method: req.method });
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
  if (path === '/' || path === '/stage.html') file = resolve(LAUNCH, 'stage.html');
  else if (path === '/stage.js') file = resolve(LAUNCH, 'stage.js');
  else if (path === '/timeline.json') file = TIMELINE_PATH;
  else if (path === '/data/page.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pageData));
    return;
  } else if (path === '/vendor/inter.woff2') file = resolve(ROOT, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
  else if (path.startsWith('/vendor/three/')) file = safeJoin(resolve(ROOT, 'node_modules/three'), path.slice('/vendor/three/'.length));
  else if (path.startsWith('/assets/')) file = safeJoin(ASSETS, path.slice('/assets/'.length));
  else if (path.startsWith('/cache/')) file = safeJoin(CACHE, path.slice('/cache/'.length));
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    netLog.push({ url: `local-missing:${path}`, phase: 'stage', allowed: false });
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
});

// プロキシの CONNECT（https で外へ出ようとしたもの）も記録して断る
server.on('connect', (req, socket) => {
  netLog.push({ url: `https://${req.url}`, phase: 'stage', allowed: false });
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
});

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}\n${r.stderr}`);
  return r;
}
const lastJson = (text) => JSON.parse(text.slice(text.lastIndexOf('{'), text.lastIndexOf('}') + 1));

async function launchBrowser() {
  // 作品の絵を撮るブラウザ。名前解決を手元だけに絞るので、外への要求は届かない
  return chromium.launch({
    args: [
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--disable-gpu-watchdog',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost, EXCLUDE ld-frame.localhost',
    ],
  });
}

// 作品の絵とコピー文を用意する
async function prepareData(browser) {
  const ids = timeline.cards.flights.map((f) => f.id);
  const cards = await captureCards(browser, ids, CACHE, netLog);
  const sequence = await captureSequence(browser, timeline, CACHE, netLog);
  const heroLocation = findWork(timeline.page.workId);
  const raw = readWork(heroLocation);
  const work = toRenderable(raw);
  const handle = JSON.parse(readFileSync(resolve(ROOT, 'creators', work.meta.creator, 'creator.json'), 'utf8')).handle;
  const snippet = buildCopySnippet(work, { handle });
  const lines = snippet.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.length > 0).slice(0, 13);
  if (!lines[0].startsWith(`<!-- UI by @${handle} — ludion.ai/p/${work.meta.id}`)) throw new Error(`1行目がクレジット行ではない: ${lines[0]}`);
  pageData = { cards, sequence, snippet: lines, page: { title: work.meta.title, handle } };
  return pageData;
}

function headlessShellPath() {
  // chromium-1248\chrome-win64\chrome.exe の隣の chromium_headless_shell-1248 を使う
  const full = chromium.executablePath();
  const build = /chromium-(\d+)/.exec(full)?.[1];
  const shell = resolve(dirname(dirname(dirname(full))), `chromium_headless_shell-${build}`, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  if (!existsSync(shell)) throw new Error(`headless shell がない: ${shell}。npx playwright install chromium を実行する`);
  return shell;
}

// 舞台の Chromium は Playwright を通さず直接起動する。外への要求は手元のサーバーをプロキシにして記録し、すべて断る
async function openStage(width, height, samples) {
  const { port } = server.address();
  const profile = mkdtempSync(join(tmpdir(), 'ld-launch-'));
  rpc.queue.length = 0;
  rpc.waiting = null;
  const ready = new Promise((done) => {
    rpc.ready = done;
  });
  // Playwright が既定で使うのと同じ headless shell。Windows のサンドボックスはこの起動のしかたでは権限で落ちるので、
  // Playwright と同じく外す。この舞台で動くのは promo/launch/ のコードだけで、作品の JS は動かさない
  const child = spawn(
    headlessShellPath(),
    [
      '--headless',
      '--no-sandbox',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--use-angle=d3d11',
      '--ignore-gpu-blocklist',
      '--enable-gpu',
      '--disable-gpu-watchdog',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-domain-reliability',
      '--no-pings',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
      `--proxy-server=http://127.0.0.1:${port}`,
      '--window-size=800,450',
      `http://127.0.0.1:${port}/stage.html?w=${width}&h=${height}&samples=${samples}`,
    ],
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
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const file = resolve(dir, namer(i, t));
    await new Promise((done, fail) => {
      onFrame = async (_id, buffer) => {
        try {
          rawToPng(buffer, width, height, file);
          results.push({ t, file, sha256: createHash('sha256').update(buffer).digest('hex') });
          done();
        } catch (e) {
          fail(e);
        }
      };
      stageCall('still', t, `http://127.0.0.1:${port}/frame/${i}`).catch(fail);
    });
    console.log(`静止画: ${t}秒 → ${file}`);
  }
  const measure = await stageCall('measure');
  await close();
  return { results, measure, info };
}

function makeSheet(files, out, cols = 4) {
  const inputs = files.flatMap((f) => ['-i', f]);
  const n = files.length;
  const rows = Math.ceil(n / cols);
  const pre = files.map((_, i) => `[${i}:v]scale=960:540[v${i}]`).join(';');
  const layout = files.map((_, i) => `${(i % cols) * 972}_${Math.floor(i / cols) * 552}`).join('|');
  const stack = files.map((_, i) => `[v${i}]`).join('');
  // 同梱の ffmpeg の xstack には fill がない。枚数は cols×rows ちょうどにする
  if (n !== cols * rows) throw new Error(`並べる枚数が ${n}。${cols}×${rows} にする`);
  const f = `${pre};${stack}xstack=inputs=${n}:layout=${layout}[o]`;
  run(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', f, '-map', '[o]', '-frames:v', '1', out]);
}

async function renderVideo(width, height, samples) {
  const { close, info, port } = await openStage(width, height, samples);
  const totalFrames = Math.round(timeline.duration * timeline.fps);
  const ffmpeg = spawn(
    ffmpegPath,
    [
      '-y', '-loglevel', 'error',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(timeline.fps), '-i', '-',
      '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', DRAFT ? 'medium' : 'slow', '-crf', DRAFT ? '17' : '14', '-r', String(timeline.fps),
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
  onFrame = async (_id, buffer) => {
    await writeFrame(buffer);
  };
  const started = Date.now();
  const sum = { seq: 0, draw: 0, read: 0, post: 0 };
  for (let frame = 0; frame < totalFrames; frame++) {
    const timing = await stageCall('frame', frame, `http://127.0.0.1:${port}/frame/${frame}`);
    for (const k of Object.keys(sum)) sum[k] += timing[k] ?? 0;
    if (frame % 240 === 0) {
      const sec = (Date.now() - started) / 1000;
      console.log(`${(frame / timeline.fps).toFixed(1)}秒 / ${timeline.duration}秒（${sec.toFixed(0)}秒経過、1コマ ${frame ? ((sec / frame) * 1000).toFixed(0) : '-'}ms）`);
    }
  }
  ffmpeg.stdin.end();
  await ffmpegDone;
  const measure = await stageCall('measure');
  await close();
  const seconds = (Date.now() - started) / 1000;
  const perFrame = Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number((v / totalFrames).toFixed(1))]));
  console.log(`かかった時間: ${seconds.toFixed(0)}秒（1コマ ${((seconds / totalFrames) * 1000).toFixed(0)}ms。内訳 ${JSON.stringify(perFrame)}）`);
  return { measure, info, seconds, totalFrames, perFrame };
}

// ---- 音を作って合わせる
function mux() {
  const synth = synthesize(timeline);
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
  return { wavHash, first: m, applied, limited: synth.limited };
}

function measureFile(file) {
  const probe = run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,duration,sample_rate,channels,channel_layout,color_space:format=duration,size,bit_rate', '-of', 'default=nw=1', file]);
  return probe.stdout;
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
  const external = netLog.filter((e) => !e.url.startsWith('local') && !e.url.startsWith('http://ld-frame.localhost/'));
  return { total: netLog.length, byHost: counts, productionRequests: production.length, externalAttempts: external.map((e) => e.url) };
}

// ---- 本体
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const report = { args: argv, timelineSha256: createHash('sha256').update(readFileSync(TIMELINE_PATH)).digest('hex') };
try {
  if (!AUDIO_ONLY) {
    // 作品の絵を撮るときだけ Playwright を使う
    const browser = await launchBrowser();
    try {
      await prepareData(browser);
    } finally {
      await browser.close();
    }
  }

  if (LOOK) {
    const times = LOOK.split(',').map(Number);
    const size = (valueOf('--size') || '1920x1080').split('x').map(Number);
    const { measure, results, info } = await renderStills(times, size[0], size[1], Number(valueOf('--samples') || 2), resolve(OUT_DIR, 'launch-look'), (_i, t) => `t${t.toFixed(2).padStart(6, '0')}.png`);
    report.look = { results, measure, info };
  } else if (has('--seam')) {
    // 継ぎ目の確かめ：画面の中の時間を止めて、部屋の中の画面に映した絵と、直接描いた絵を比べる
    const dir = resolve(OUT_DIR, 'launch-seam');
    mkdirSync(dir, { recursive: true });
    const { close, info, port } = await openStage(1920, 1080, 1);
    const shoot = async (name, t, innerAt) => {
      const file = resolve(dir, `${name}.png`);
      await new Promise((done, fail) => {
        onFrame = async (_id, buffer) => {
          rawToPng(buffer, 1920, 1080, file);
          done();
        };
        stageCall('stillAt', t, innerAt, `http://127.0.0.1:${port}/frame/${name}`).catch(fail);
      });
      return file;
    };
    const psnr = (a, b) => {
      const r = run(ffmpegPath, ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'psnr', '-f', 'null', '-']);
      return /average:([0-9.inf]+)/.exec(r.stderr)?.[1] ?? null;
    };
    const eps = 0.0001;
    const results = {};
    for (const [label, at, before, after] of [
      ['enter', info.tFill, info.tFill - eps, info.tFill + eps],
      ['exit', info.tExit, info.tExit - eps, info.tExit + eps],
    ]) {
      const a = await shoot(`${label}-before`, before, at);
      const b = await shoot(`${label}-after`, after, at);
      results[label] = { t: at, psnrDb: psnr(a, b) };
    }
    await close();
    report.seam = results;
    console.log('継ぎ目:', JSON.stringify(results));
  } else if (BENCH) {
    const out = [];
    for (const [w, h, s] of [[1920, 1080, 2], [3840, 2160, 8]]) {
      const { close, info, port } = await openStage(w, h, s);
      onFrame = async () => {};
      for (const t of [2, 11, 16.5, 24, 31, 37, 50]) {
        const f = Math.round(t * timeline.fps);
        await stageCall('frame', f, `http://127.0.0.1:${port}/frame/${f}`);
        const begin = Date.now();
        const samples = 3;
        for (let i = 1; i <= samples; i++) await stageCall('frame', f + i, `http://127.0.0.1:${port}/frame/${f + i}`);
        const ms = (Date.now() - begin) / samples;
        out.push({ width: w, height: h, samples: s, t, msPerFrame: Math.round(ms) });
        console.log(JSON.stringify(out.at(-1)));
      }
      report.gpu = info.gpu;
      // 実際に符号化したときの速さ（カードの多い 11 秒から 120 コマ）
      const encoder = spawn(
        ffmpegPath,
        [
          '-y', '-loglevel', 'error',
          '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(timeline.fps), '-i', '-',
          '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
          '-c:v', 'libx264', '-preset', w === 1920 ? 'medium' : 'slow', '-crf', w === 1920 ? '17' : '14',
          '-f', 'null', '-',
        ],
        { stdio: ['pipe', 'inherit', 'inherit'] },
      );
      const encoded = new Promise((done) => encoder.on('close', done));
      onFrame = (_id, buffer) => new Promise((done, fail) => encoder.stdin.write(buffer, (e) => (e ? fail(e) : done())));
      const encodeBegin = Date.now();
      const encodeFrames = 120;
      for (let i = 0; i < encodeFrames; i++) await stageCall('frame', 660 + i, `http://127.0.0.1:${port}/frame/${i}`);
      encoder.stdin.end();
      await encoded;
      const withEncode = Math.round((Date.now() - encodeBegin) / encodeFrames);
      out.push({ width: w, height: h, samples: s, withEncoderMsPerFrame: withEncode });
      console.log(JSON.stringify(out.at(-1)));
      onFrame = async () => {};
      await close();
    }
    const est = {};
    for (const key of ['1920x1080x2', '3840x2160x8']) {
      const [w, h, s] = key.split('x').map(Number);
      const rows = out.filter((r) => r.width === w && r.height === h && r.samples === s && r.msPerFrame);
      const mean = rows.reduce((a, r) => a + r.msPerFrame, 0) / rows.length;
      const enc = out.find((r) => r.width === w && r.height === h && r.withEncoderMsPerFrame).withEncoderMsPerFrame;
      est[key] = { meanMsPerFrame: Math.round(mean), withEncoderMsPerFrame: enc, totalMinutes: Number(((enc * timeline.duration * timeline.fps) / 60000).toFixed(1)) };
    }
    report.bench = { rows: out, estimate: est };
    console.log('見積もり:', JSON.stringify(est));
  } else if (STILLS) {
    const dir = resolve(OUT_DIR, 'launch-frames');
    const { measure, results, info } = await renderStills(timeline.stills, 3840, 2160, 8, dir, (i) => `scene-${i + 1}.png`);
    makeSheet(results.map((r) => r.file), resolve(OUT_DIR, 'launch-sheet.png'));
    report.stills = { results, measure, info };
  } else {
    if (!AUDIO_ONLY) {
      const [w, h, s] = DRAFT ? [1920, 1080, 2] : [3840, 2160, 8];
      report.video = await renderVideo(w, h, s);
    }
    if (!existsSync(SILENT)) throw new Error('--audio-only の前に、絵を撮っておく必要がある');
    report.audio = mux();
    report.probe = measureFile(OUT);
    console.log(report.probe);
    console.log(`出力: ${OUT}（${(statSync(OUT).size / 1024 / 1024).toFixed(1)} MB）`);
  }
  report.network = netSummary();
  console.log('通信:', JSON.stringify(report.network));
  if (report.network.productionRequests !== 0) throw new Error('本番へ要求を送ってしまった');
  const reportPath = has('--seam') ? resolve(OUT_DIR, 'launch-seam-report.json') : STILLS ? resolve(OUT_DIR, 'launch-stills-report.json') : LOOK ? resolve(OUT_DIR, 'launch-look-report.json') : BENCH ? resolve(OUT_DIR, 'launch-bench-report.json') : REPORT;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
} finally {
  server.closeAllConnections?.();
  server.close();
}
