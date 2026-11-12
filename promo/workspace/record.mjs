// 動画の中のターミナルに出す、本物の記録を取る（V006「本物で作る」）。オーナーの裏方の道具（CLAUDE.md 原則1）。
//   node promo/workspace/record.mjs --check            → お金のかからない確かめ（鍵、フックの空打ち、claude が何を読み込むか）
//   node promo/workspace/record.mjs --run scene1       → claude -p を1回だけ流して記録する（お金がかかる。作り直しはしない）
//   node promo/workspace/record.mjs --transcript scene1 → 生の記録（promo/out/）から promo/workspace/records/<名前>/ を作り直す（お金はかからない）
//
// 手元の開発のサーバーは LD_DEV_URL（既定 http://localhost:5473）。Ludion のプラグイン（plugins/ludion）は、そのサーバーにだけつなぐ。
// 本番（ludion.ai）には要求を送らない：LUDION_URL が手元でなければ、流す前に止まる。
// claude には Read、Write、Edit だけを渡す（Bash で書かれると、プラグインのフックが動かない）。
// 利用者の設定と、リポジトリの CLAUDE.md は読ませない（--setting-sources local）。プラグインは --plugin-dir の1つだけ。

import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRIVATE_OWNER } from '../../apps/web/scripts/private-fixture.mjs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PLUGIN = resolve(ROOT, 'plugins', 'ludion');
const HOOK = resolve(PLUGIN, 'hooks', 'auto-save.mjs');
const CLI = resolve(PLUGIN, 'skills', 'ludion', 'ludion.mjs');
const OUT = resolve(HERE, '..', 'out', 'v006-record');
const RECORDS = resolve(HERE, 'records');
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const RUNS = JSON.parse(readFileSync(resolve(HERE, 'records.json'), 'utf8'));
const LOG = resolve(OUT, 'log.jsonl');

mkdirSync(OUT, { recursive: true });
const log = (entry) => {
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  console.log(JSON.stringify(entry));
};

// ---- 手元だけにつなぐ
function assertLocal(url) {
  const host = new URL(url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${url}`);
}
assertLocal(BASE);

/** 見本のデータの人（seed-dev.mjs が入れる）の名前で、本物の口から AI の鍵を作る。鍵は、このプロセスの中だけで持つ。 */
async function makeKey() {
  const response = await fetch(`${BASE}/api/account/ai-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: `ld_session=${PRIVATE_OWNER.session}` },
    body: JSON.stringify({ name: 'Claude Code', own: true, mit: true, terms: true }),
  });
  if (response.status !== 201) throw new Error(`鍵を作れなかった: ${response.status} ${await response.text()}`);
  const made = await response.json();
  return { id: made.key.id, secret: made.secret };
}
async function deleteKey(id) {
  await fetch(`${BASE}/api/account/ai-keys/${encodeURIComponent(id)}/delete`, { method: 'POST', headers: { Origin: BASE, Cookie: `ld_session=${PRIVATE_OWNER.session}` } });
}

/** claude とフックに渡す環境。このセッションの印（CLAUDE_CODE_…）は外し、Ludion の行き先は手元だけにする。 */
function runEnv(key, extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name === 'CLAUDECODE' || name === 'CLAUDE_EFFORT' || name === 'CLAUDE_JOB_DIR' || name === 'CLAUDE_PID' || name.startsWith('CLAUDE_CODE_') || name.startsWith('LUDION_')) delete env[name];
  }
  Object.assign(env, { LUDION_URL: BASE, LUDION_KEY: key, LUDION_HOME: resolve(OUT, 'ludion-home'), LUDION_NO_BROWSER: '1', LUDION_NO_OPEN: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ...extra });
  assertLocal(env.LUDION_URL);
  if (!/^ld_[A-Za-z0-9]{40}$/.test(env.LUDION_KEY)) throw new Error('鍵の形が違う');
  return env;
}

/** 流すフォルダ。空にして、どのファイルがどの作品かの覚え（.ludion.json）をここに置く（上のフォルダの覚えに書かせない）。 */
function freshDir(name) {
  const dir = resolve(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.ludion.json'), `${JSON.stringify({ works: {}, auto: true }, null, 2)}\n`);
  return dir;
}

function findClaude() {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  return lines.find((l) => /\.exe$/i.test(l)) || lines[0];
}
const claudeArgs = (budget) => ['-p', '--permission-mode', 'acceptEdits', '--tools', 'Read,Write,Edit', '--output-format', 'stream-json', '--verbose', '--include-hook-events', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'local', '--plugin-dir', PLUGIN, '--max-budget-usd', String(budget)];

// ---- お金のかからない確かめ
async function check() {
  const key = await makeKey();
  try {
    // 1. フックの空打ち：Claude Code がするのと同じ形（道具の呼び出しを JSON で stdin に）で流し、手元に置かれることを見る
    const dir = freshDir('check');
    const file = join(dir, 'hook-check.html');
    writeFileSync(file, '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Hook check</title></head><body><button>ok</button></body></html>\n');
    const hook = await new Promise((done) => {
      const child = execFile(process.execPath, [HOOK], { cwd: dir, env: runEnv(key.secret) }, (_error, stdout, stderr) => done({ stdout, stderr }));
      child.stdin.end(JSON.stringify({ session_id: 'check', cwd: dir, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file, content: '' }, tool_response: {} }));
    });
    const said = JSON.parse(hook.stdout);
    const message = said.systemMessage ?? '';
    if (!message.includes(`${BASE}/`)) throw new Error(`フックの答えに手元の住所がない: ${hook.stdout}`);
    const list = await (await fetch(`${BASE}/api/v1/works`, { headers: { Authorization: `Bearer ${key.secret}` } })).json();
    log({ step: 'check-hook', systemMessage: message, context: said.hookSpecificOutput?.additionalContext, works: list.works.map((w) => `${w.id}（${w.visibility}、版 ${w.version}）`) });

    // 2. claude が何を読み込むか：API へは届かせない（行き先を閉じた口にする）。最初の知らせ（init）だけを読んで止める
    const dir2 = freshDir('check-claude');
    const init = await new Promise((done) => {
      const child = spawn(findClaude(), [...claudeArgs(0.01), '--debug-file', resolve(OUT, 'check-debug.log')], { cwd: dir2, env: runEnv(key.secret, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' }), stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let found = null;
      const timer = setTimeout(() => child.kill(), 60000);
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        for (const line of buffer.split('\n')) {
          try {
            const event = JSON.parse(line);
            if (event.type === 'system' && event.subtype === 'init') {
              found = event;
              child.kill();
            }
          } catch {
            // 行の途中
          }
        }
      });
      child.stdin.end('確かめ');
      child.on('close', () => {
        clearTimeout(timer);
        done(found);
      });
    });
    if (!init) throw new Error('claude の最初の知らせ（init）が読めなかった');
    writeFileSync(resolve(OUT, 'check-init.json'), JSON.stringify(init, null, 2));
    log({ step: 'check-claude', version: init.claude_code_version, model: init.model, tools: init.tools, plugins: (init.plugins ?? []).map((p) => p.name), skills: init.skills, mcp: (init.mcp_servers ?? []).map((m) => m.name), memory: init.memory_paths ?? null, keys: Object.keys(init) });
  } finally {
    await deleteKey(key.id);
  }
}

// ---- 1回だけ流す
async function run(name) {
  const spec = RUNS[name];
  if (!spec) throw new Error(`records.json にない名前: ${name}`);
  const rawPath = resolve(OUT, `${name}.jsonl`);
  if (existsSync(rawPath) && !has('--again')) throw new Error(`${name} は、もう流してある（${rawPath}）。作り直しはお金がかかる。CEO の許しがあるときだけ --again を付ける`);
  const key = await makeKey();
  const dir = freshDir(name);
  writeFileSync(rawPath, '');
  const started = Date.now();
  const limitMs = spec.limitMinutes * 60 * 1000;
  log({ step: 'run-start', name, prompt: spec.prompt, budgetUsd: spec.budgetUsd, limitMinutes: spec.limitMinutes });
  try {
    const result = await new Promise((done) => {
      const child = spawn(findClaude(), claudeArgs(spec.budgetUsd), { cwd: dir, env: runEnv(key.secret), stdio: ['pipe', 'pipe', 'pipe'] });
      let buffer = '';
      let stderr = '';
      let last = null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, limitMs);
      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let at;
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).trim();
          buffer = buffer.slice(at + 1);
          if (!line) continue;
          const t = (Date.now() - started) / 1000;
          appendFileSync(rawPath, `${JSON.stringify({ t, line })}\n`);
          try {
            const event = JSON.parse(line);
            if (event.type === 'result') {
              last = event;
              // 結果が出たら終わり。-p が自分で終わらないことがあった（V004）ので、ここで閉じる
              setTimeout(() => child.kill(), 3000);
            }
          } catch {
            // 生の記録には残る
          }
        }
      });
      child.stderr.on('data', (c) => {
        stderr += c.toString('utf8');
      });
      child.stdin.end(spec.prompt);
      child.on('close', (code) => {
        clearTimeout(timer);
        done({ code, last, timedOut, stderr: stderr.slice(-2000), seconds: (Date.now() - started) / 1000 });
      });
    });
    const files = readdirSync(dir).filter((f) => /\.html?$/i.test(f));
    const list = await (await fetch(`${BASE}/api/v1/works`, { headers: { Authorization: `Bearer ${key.secret}` } })).json();
    log({ step: 'run-end', name, seconds: Number(result.seconds.toFixed(1)), timedOut: result.timedOut, costUsd: result.last?.total_cost_usd ?? null, turns: result.last?.num_turns ?? null, isError: result.last?.is_error ?? null, files, works: list.works.map((w) => `${w.id}（${w.visibility}、版 ${w.version}）`), stderr: result.stderr || undefined });
  } finally {
    await deleteKey(key.id);
  }
  transcript(name);
}

// ---- 生の記録を、動画が読む形にする（作り話を入れない。機械が取り出すだけ）
const fence = (text, lang = '') => {
  let mark = '```';
  while (text.includes(mark)) mark += '`';
  return `${mark}${lang}\n${text}\n${mark}`;
};
const stamp = (t) => `+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`;
/** 手元のパスは記録に残さない（公開のリポジトリに入る）。流したフォルダは <作業フォルダ> に、ほかの手元のパスは <手元> にする。 */
function redactor(dir) {
  const forms = (p) => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\'), p.replace(/^([A-Za-z]):\\/, (_m, d) => `/${d.toLowerCase()}/`).replace(/\\/g, '/')];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dirRe = new RegExp(forms(dir).map(esc).join('|'), 'gi');
  return (text) => text.replace(dirRe, '<作業フォルダ>').replace(/[A-Za-z]:[\\/]+(?:Users|dev)[\\/][^\s"'`<>）)]*/g, '<手元>').replace(/\/(?:c|C)\/(?:Users|dev)\/[^\s"'`<>）)]*/g, '<手元>');
}

function transcript(name) {
  const spec = RUNS[name];
  const rawPath = resolve(OUT, `${name}.jsonl`);
  const dir = resolve(OUT, name);
  const redact = redactor(dir);
  const events = readFileSync(rawPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map(({ t, line }) => {
    try {
      return { t, event: JSON.parse(line) };
    } catch {
      return null;
    }
  }).filter(Boolean);
  const init = events.find((e) => e.event.type === 'system' && e.event.subtype === 'init')?.event;
  const result = events.find((e) => e.event.type === 'result');
  const htmlFiles = readdirSync(dir).filter((f) => /\.html?$/i.test(f));
  const lines = [
    `# ${spec.prompt}：記録`,
    '',
    `- 動かした道具：Claude Code ${init?.claude_code_version ?? '?'}（モデル ${init?.model ?? '?'}）を \`claude -p\` で。どのファイルがどの作品かの覚え（.ludion.json。中身は空）だけを先に置いたフォルダで動かした。渡した道具は ${(init?.tools ?? []).join('、')}。足したプラグインは ${(init?.plugins ?? []).filter((p) => p.path !== 'builtin').map((p) => p.name).join('、') || '?'}（このリポジトリの \`plugins/ludion\`）だけ`,
    '- つないだ先：手元の開発のサーバー（見本のデータ）。本番には送っていない',
    `- 掛かった時間：${result ? result.t.toFixed(1) : '?'} 秒、ターン数：${result?.event.num_turns ?? '?'}、できたファイル：${htmlFiles.join('、') || 'なし'}`,
    '- 下の「答え」は stream-json の出力から機械で取り出した。時刻は始まりからの経過。Write の中身はここには行数だけを書く（中身は隣の HTML）。手元のパスは `<作業フォルダ>` に置き換えた。',
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
        else if (block.type === 'tool_use') {
          const input = block.input ?? {};
          const file = String(input.file_path ?? '').split(/[\\/]/).pop();
          if (block.name === 'Write') lines.push(`### ${stamp(t)} 道具 Write ${file}`, '', `${String(input.content ?? '').split('\n').length} 行、${Buffer.byteLength(String(input.content ?? ''))} バイト`, '');
          else if (block.name === 'Edit') lines.push(`### ${stamp(t)} 道具 Edit ${file}`, '', fence(`- ${String(input.old_string ?? '').slice(0, 800)}\n+ ${String(input.new_string ?? '').slice(0, 800)}`), '');
          else lines.push(`### ${stamp(t)} 道具 ${block.name} ${file}`, '');
        }
      }
    } else if (event.type === 'system' && event.subtype === 'hook_response') {
      // フックの答え（プラグインが返したもの）。systemMessage は画面に出る行、additionalContext は Claude に渡る文
      let said = null;
      try {
        said = JSON.parse(event.output ?? event.stdout ?? '');
      } catch {
        // JSON でなければ、そのまま写す
      }
      lines.push(`### ${stamp(t)} フック ${event.hook_name ?? ''}`.trimEnd(), '');
      if (said?.systemMessage) lines.push('画面に出る行（systemMessage）：', '', fence(said.systemMessage), '');
      if (said?.hookSpecificOutput?.additionalContext) lines.push('Claude に渡る文（additionalContext）：', '', fence(said.hookSpecificOutput.additionalContext), '');
      if (!said && typeof event.output === 'string' && event.output.trim()) lines.push(fence(event.output.trim()), '');
    }
  }
  if (result) lines.push(`### ${stamp(result.t)} 終わり`, '', result.event.result?.trim() || '（最後の文なし）', '');
  const out = resolve(RECORDS, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const text = redact(lines.join('\n'));
  if (/[A-Za-z]:[\\/]+Users|\/c\/Users|ld_[A-Za-z0-9]{40}/.test(text)) throw new Error('記録に、手元のパスか鍵が残っている');
  writeFileSync(resolve(out, 'transcript.md'), text);
  for (const f of htmlFiles) copyFileSync(join(dir, f), resolve(out, f));
  writeFileSync(resolve(out, 'facts.json'), `${JSON.stringify({ name, prompt: spec.prompt, claudeCode: init?.claude_code_version ?? null, model: init?.model ?? null, seconds: result ? Number(result.t.toFixed(1)) : null, turns: result?.event.num_turns ?? null, files: htmlFiles }, null, 2)}\n`);
  log({ step: 'transcript', name, out: `promo/workspace/records/${name}/`, files: ['transcript.md', 'facts.json', ...htmlFiles] });
}

if (has('--check')) await check();
else if (has('--run')) await run(valueOf('--run'));
else if (has('--transcript')) transcript(valueOf('--transcript'));
else console.log('使い方: node promo/workspace/record.mjs --check | --run <名前> | --transcript <名前>');
