// 場面0「入れる」の本物の記録を取る（V006）。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/workspace/connect.mjs --persist <置き場> --check        → お金のかからない確かめ：Ludion の道具（ludion.mjs login）を直に流し、「許可する」を押してつながることを見る。画面も撮る（--as scene0 で、動画が使う置き場に撮り直す）
//   node promo/workspace/connect.mjs --persist <置き場> --run scene0   → Claude Code に /ludion:connect を1回だけ流して記録する（お金がかかる。作り直しはしない）
//   （--check に --width 420 --height 900 --fit-height を足すと、幅 420 の窓で撮る。動画は、この狭い窓の画面を使う）
//   node promo/workspace/connect.mjs --transcript scene0               → 生の記録から promo/workspace/records/scene0/ を作り直す（お金はかからない）
//
// つなぐ先は、手元の開発のサーバー（LD_DEV_URL、既定 http://localhost:5473）だけ。本番（ludion.ai）には要求を送らない。
// 「許可する」を押す人は、動画に出す人（person.mjs が手元の D1 に入れる）。ブラウザは Playwright の1つだけで、名前解決を手元だけに絞る。
// この PC の本物のブラウザは開かない：道具が開くはずの住所を open-url-drop.cjs が受け取り、このスクリプトが自分のブラウザで開く。
// 撮った画面（promo/out/v006-record/<名前>-shots/）はコミットしない。--check --as <名前> で、AI を使わずに撮り直せる（動画が使うのは timeline.json の browser.shots）。
// 撮るブラウザは、字のふちに色を付けない（--disable-lcd-text）。大きく寄ると、色のにじみが見えるため。

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startDev } from './dev-server.mjs';
import { OUT_ROOT, useLocalTemp } from './out.mjs';
import { PERSON, ensurePerson } from './person.mjs';
import { waitForQuiet } from './quiet.mjs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PLUGIN = resolve(ROOT, 'plugins', 'ludion');
const CLI = resolve(PLUGIN, 'skills', 'ludion', 'ludion.mjs');
const PRELOAD = resolve(HERE, 'open-url-drop.cjs');
const OUT = resolve(OUT_ROOT, 'v006-record');
useLocalTemp(); // ブラウザの一時ファイルも、置き場の中に作らせる
const RECORDS = resolve(HERE, 'records');
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const RUNS = JSON.parse(readFileSync(resolve(HERE, 'records.json'), 'utf8'));
// 撮る画面（ブラウザの窓）の大きさ（CSS の画素）と、細かさ。4K でも寄れるよう3倍で撮る。--width と --height で窓の大きさを選べる。--fit-height は、窓の高さを中身に合わせる
const SHOT = { width: Number(valueOf('--width') || 1000), height: Number(valueOf('--height') || 700), scale: 3 };

mkdirSync(OUT, { recursive: true });
const log = (entry) => {
  appendFileSync(resolve(OUT, 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  console.log(JSON.stringify(entry));
};
{
  const host = new URL(BASE).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${BASE}`);
}

/** 道具と claude に渡す環境。Ludion の行き先は手元だけ。鍵は渡さない（つながっていない所から始める）。 */
function connectEnv(name, extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k === 'CLAUDE_EFFORT' || k === 'CLAUDE_JOB_DIR' || k === 'CLAUDE_PID' || k.startsWith('CLAUDE_CODE_') || k.startsWith('LUDION_')) delete env[k];
  }
  const home = resolve(OUT, `${name}-ludion-home`);
  rmSync(home, { recursive: true, force: true });
  const drop = resolve(OUT, `${name}-url.txt`);
  rmSync(drop, { force: true });
  Object.assign(env, { LUDION_URL: BASE, LUDION_HOME: home, LUDION_NO_BROWSER: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', NODE_OPTIONS: `--require ${JSON.stringify(PRELOAD)}`, LD_PROMO_URL_DROP: drop, ...extra });
  return { env, drop, home };
}

/** 道具が開くはずだった住所を待ち、動画に出す人として開いて「許可する」を押す。画面を撮る。 */
async function allowInBrowser(name, drop, waitMs = 120000) {
  const deadline = Date.now() + waitMs;
  while (!existsSync(drop)) {
    if (Date.now() > deadline) throw new Error('道具がブラウザを開こうとしなかった（住所が来ない）');
    await new Promise((done) => setTimeout(done, 200));
  }
  const url = readFileSync(drop, 'utf8').trim();
  if (!url.startsWith(`${BASE}/oauth/authorize`)) throw new Error(`開く住所が手元のサーバーではない: ${url.slice(0, 80)}`);
  const shots = resolve(OUT, `${name}-shots`);
  rmSync(shots, { recursive: true, force: true });
  mkdirSync(shots, { recursive: true });
  const blocked = [];
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost', '--disable-lcd-text'] }) // 字のふちに色を付けない（大きく寄ると、色のにじみが見えるため）;
  try {
    const context = await browser.newContext({ locale: 'ja-JP', viewport: { width: SHOT.width, height: SHOT.height }, deviceScaleFactor: SHOT.scale });
    await context.addCookies([{ name: 'ld_session', value: PERSON.session, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (host === 'localhost' || host === '127.0.0.1') return route.continue();
      blocked.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    const startedAt = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    const allow = page.getByRole('button', { name: '許可する' });
    await allow.waitFor({ timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    if (has('--fit-height')) {
      // 窓の高さを、中身のいちばん下＋余白に合わせる（幅は変えないので、字の並びは変わらない）
      const bottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('main *')].map((el) => el.getBoundingClientRect().bottom)));
      SHOT.height = Math.ceil(bottom + 48);
      await page.setViewportSize({ width: SHOT.width, height: SHOT.height });
    }
    const box = await allow.boundingBox();
    const texts = await page.evaluate(() => [...document.querySelectorAll('h1, h2, p, li, button, a')].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    // 画面の字の四角（1行ごと）。動画の見出しが字に重ならないことを確かめるのと、描いた絵から字の高さを測るのに使う
    const textRects = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const style = getComputedStyle(node.parentElement);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const round = (v) => Math.round(v * 100) / 100;
        for (const r of range.getClientRects()) {
          if (r.width > 1 && r.height > 1) out.push({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height), fontPx: parseFloat(style.fontSize), tag: node.parentElement.tagName.toLowerCase(), text: node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) });
        }
      }
      return out;
    });
    await page.screenshot({ path: join(shots, 'consent.png') });
    await allow.hover();
    await page.screenshot({ path: join(shots, 'consent-hover.png') });
    const consentPath = new URL(page.url()).pathname;
    await Promise.all([page.waitForURL(/127\.0\.0\.1:\d+\/callback/, { timeout: 15000 }), allow.click()]);
    await page.waitForLoadState('load');
    await page.screenshot({ path: join(shots, 'done.png') });
    const doneText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
    const manifest = { viewport: SHOT, files: ['consent.png', 'consent-hover.png', 'done.png'], allowButton: box, consentPath, consentTexts: texts, textRects, doneText, secondsToAllow: Number(((Date.now() - startedAt) / 1000).toFixed(1)), blockedRequests: blocked };
    writeFileSync(join(shots, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await browser.close();
  }
}

// ---- お金のかからない確かめ：道具を直に流す
async function check(name) {
  const { env, drop } = connectEnv(name);
  const helper = new Promise((done) => {
    const child = spawn(process.execPath, [CLI, 'login'], { cwd: OUT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
  const manifest = await allowInBrowser(name, drop);
  const result = await helper;
  log({ step: 'connect-check', helperExit: result.code, helperSays: result.stdout.replace(/\s+/g, ' ').trim(), helperStderrFirstLine: result.stderr.split('\n')[0], allowButton: manifest.allowButton, consentTexts: manifest.consentTexts, doneText: manifest.doneText, blockedRequests: manifest.blockedRequests });
  if (!/"ok":\s*true/.test(result.stdout)) throw new Error('つながらなかった');
}

// ---- Claude Code に /ludion:connect を1回だけ流す
function findClaude() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  return lines.find((l) => /\.exe$/i.test(l)) || lines[0];
}
async function run(name) {
  const spec = RUNS[name];
  if (!spec?.connect) throw new Error(`records.json に、つなぐ記録として書かれていない: ${name}`);
  const rawPath = resolve(OUT, `${name}.jsonl`);
  if (existsSync(rawPath) && !has('--again')) throw new Error(`${name} は、もう流してある。作り直しはお金がかかる。CEO の許しがあるときだけ --again を付ける`);
  const dir = resolve(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const { env, drop } = connectEnv(name);
  writeFileSync(rawPath, '');
  const started = Date.now();
  log({ step: 'run-start', name, prompt: spec.prompt, budgetUsd: spec.budgetUsd, limitMinutes: spec.limitMinutes });
  const args = ['-p', '--permission-mode', 'acceptEdits', '--tools', spec.tools, '--allowedTools', spec.allowedTools, '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'local', '--plugin-dir', PLUGIN, '--max-budget-usd', String(spec.budgetUsd)];
  const claude = new Promise((done) => {
    const child = spawn(findClaude(), args, { cwd: dir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    let last = null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, spec.limitMinutes * 60 * 1000);
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (!line) continue;
        appendFileSync(rawPath, `${JSON.stringify({ t: (Date.now() - started) / 1000, line })}\n`);
        try {
          const event = JSON.parse(line);
          if (event.type === 'result') {
            last = event;
            setTimeout(() => child.kill(), 3000);
          }
        } catch {
          // 生の記録には残る
        }
      }
    });
    child.stderr.on('data', (c) => (stderr += c));
    child.stdin.end(spec.prompt);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, last, timedOut, stderr: stderr.slice(-1500), seconds: (Date.now() - started) / 1000 });
    });
  });
  // 「許可する」を押す時刻も記録に残す（動画の時刻の対応に使う）
  let allowed = null;
  let allowError = null;
  try {
    const manifest = await allowInBrowser(name, drop, spec.limitMinutes * 60 * 1000);
    allowed = { t: (Date.now() - started) / 1000, ...manifest };
    appendFileSync(rawPath, `${JSON.stringify({ t: allowed.t, line: JSON.stringify({ type: 'promo', subtype: 'allowed_in_browser', secondsToAllow: manifest.secondsToAllow }) })}\n`);
  } catch (e) {
    allowError = String(e.message ?? e);
  }
  const result = await claude;
  log({ step: 'run-end', name, seconds: Number(result.seconds.toFixed(1)), timedOut: result.timedOut, costUsd: result.last?.total_cost_usd ?? null, turns: result.last?.num_turns ?? null, isError: result.last?.is_error ?? null, allowedAt: allowed?.t ?? null, allowError, blockedRequests: allowed?.blockedRequests ?? null, stderr: result.stderr || undefined });
  transcript(name);
}

// ---- 生の記録を、動画が読む形にする（作り話を入れない。機械が取り出すだけ）
const fence = (text, lang = '') => {
  let mark = '```';
  while (text.includes(mark)) mark += '`';
  return `${mark}${lang}\n${text}\n${mark}`;
};
const stamp = (t) => `+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`;
/** 手元のパスと、1回きりの値（許可の住所の中身）は記録に残さない（公開のリポジトリに入る）。 */
function redact(text) {
  const forms = (p) => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), p.replace(/^([A-Za-z]):\\/, (_m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/')];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pluginRe = new RegExp(forms(PLUGIN).map(esc).join('|'), 'gi');
  return text
    .replace(pluginRe, '<プラグイン>')
    .replace(/[A-Za-z]:[\\/]+(?:Users|dev)[\\/][^\s"'`<>）)]*/g, '<手元>')
    .replace(/\/(?:c|C)\/(?:Users|dev)\/[^\s"'`<>）)]*/g, '<手元>')
    .replace(/(\/oauth\/authorize\?)[^\s"'`<>]+/g, '$1<1回きりの値>');
}
function transcript(name) {
  const spec = RUNS[name];
  const events = readFileSync(resolve(OUT, `${name}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map(({ t, line }) => {
    try {
      return { t, event: JSON.parse(line) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  const init = events.find((e) => e.event.type === 'system' && e.event.subtype === 'init')?.event;
  const result = events.find((e) => e.event.type === 'result');
  const lines = [
    `# ${spec.prompt}：記録`,
    '',
    `- 動かした道具：Claude Code ${init?.claude_code_version ?? '?'}（モデル ${init?.model ?? '?'}）を \`claude -p\` で。空のフォルダで動かした。渡した道具は ${(init?.tools ?? []).join('、')}。足したプラグインは ${(init?.plugins ?? []).filter((p) => p.path !== 'builtin').map((p) => p.name).join('、') || '?'}（このリポジトリの \`plugins/ludion\`）だけ`,
    '- つないだ先：手元の開発のサーバー（見本のデータ）。本番には送っていない。つながっていない所（鍵もつながりもない）から始めた',
    '- ブラウザ：道具が開くはずだった住所を、記録を取るスクリプトが自分のブラウザ（動画に出す人でログイン済み）で開き、「許可する」を押した。この PC の本物のブラウザは開いていない',
    `- 掛かった時間：${result ? result.t.toFixed(1) : '?'} 秒、ターン数：${result?.event.num_turns ?? '?'}`,
    '- 下の「答え」は stream-json の出力から機械で取り出した。時刻は始まりからの経過。手元のパスは `<プラグイン>` などに、許可の住所の中の1回きりの値は `<1回きりの値>` に置き換えた。',
    '',
    '## 指示文',
    '',
    fence(spec.prompt, 'text'),
    '',
    '## 答え',
    '',
  ];
  for (const { t, event } of events) {
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) lines.push(`### ${stamp(t)} 文`, '', block.text.trim(), '');
        else if (block.type === 'tool_use') lines.push(`### ${stamp(t)} 道具 ${block.name}`, '', fence(String(block.input?.command ?? JSON.stringify(block.input ?? {})).slice(0, 1200)), '');
      }
    } else if (event.type === 'user') {
      for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
        if (block.type !== 'tool_result') continue;
        const text = Array.isArray(block.content) ? block.content.map((c) => c.text ?? '').join('\n') : String(block.content ?? '');
        lines.push(`### ${stamp(t)} 道具の答え`, '', fence(text.trim().slice(0, 1500)), '');
      }
    } else if (event.type === 'promo' && event.subtype === 'allowed_in_browser') {
      lines.push(`### ${stamp(t)} ブラウザ`, '', `「許可する」を押した（住所を開いてから ${event.secondsToAllow} 秒）`, '');
    }
  }
  if (result) lines.push(`### ${stamp(result.t)} 終わり`, '', result.event.result?.trim() || '（最後の文なし）', '');
  const out = resolve(RECORDS, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const text = redact(lines.join('\n'));
  if (/[A-Za-z]:[\\/]+Users|\/c\/Users|ld_[A-Za-z0-9]{40}|ldo_[A-Za-z0-9]{20}|code_challenge=/.test(text)) throw new Error('記録に、手元のパスか、鍵か、1回きりの値が残っている');
  writeFileSync(resolve(out, 'transcript.md'), text);
  writeFileSync(resolve(out, 'facts.json'), `${JSON.stringify({ name, prompt: spec.prompt, claudeCode: init?.claude_code_version ?? null, model: init?.model ?? null, seconds: result ? Number(result.t.toFixed(1)) : null, turns: result?.event.num_turns ?? null, files: [] }, null, 2)}\n`);
  log({ step: 'transcript', name, out: `promo/workspace/records/${name}/` });
}

if (has('--transcript')) transcript(valueOf('--transcript'));
else if (has('--check') || has('--run')) {
  const persist = valueOf('--persist');
  if (!persist) throw new Error('使い方: node promo/workspace/connect.mjs --persist <置き場> --check | --run <名前>');
  await waitForQuiet(Number(valueOf('--wait-max') || 8));
  log({ step: 'person', ...ensurePerson(resolve(persist)) });
  const dev = await startDev({ persist, base: BASE });
  try {
    if (has('--check')) await check(valueOf('--as') || 'connect-check');
    else await run(valueOf('--run'));
  } finally {
    await dev.stop();
  }
} else console.log('使い方: node promo/workspace/connect.mjs --persist <置き場> --check | --run <名前> | --transcript <名前>');
