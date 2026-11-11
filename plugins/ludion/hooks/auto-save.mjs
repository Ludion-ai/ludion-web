#!/usr/bin/env node
// Ludion auto-save (Claude Code PostToolUse hook, MCP001 "2").
// After Claude Code writes or edits an .html file, put it on the person's Ludion as "Only me" with ludion.mjs.
// The same file again becomes a new version of the same work (.ludion.json); an unchanged file is not sent again.
//
// Never blocks Claude Code: always exits 0. Tells Claude the address (additionalContext) so it can tell the person.
// Off: `node ludion.mjs auto off` in a folder (that folder and below), `auto off --all`, or LUDION_AUTO=off.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoSaveOn, hasCredentials, homeDir } from '../skills/ludion/ludion.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../skills/ludion/ludion.mjs');
const TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
/** Folders whose HTML is not the person's work (build output, dependencies). */
const SKIP = /(^|[\\/])(node_modules|\.git|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.cache|vendor)([\\/]|$)/;
/** Problems that mean "this is a page of a bigger project, not one self-contained work": say nothing. */
const NOT_A_WORK = new Set(['local_files', 'not_html']);

function reply(context, message) {
  const output = { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } };
  if (message) output.systemMessage = message;
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Says "not connected" at most once a day, so it does not repeat on every file. */
function nudgeOnce() {
  const file = path.join(homeDir(), 'nudged');
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (existsSync(file) && readFileSync(file, 'utf8').trim() === today) return false;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, today);
  } catch {
    // still say it
  }
  return true;
}

function runPut(file, cwd, title) {
  return new Promise((resolve) => {
    const args = [CLI, 'put', file, '--if-changed', ...(title ? ['--title', title] : [])];
    execFile(process.execPath, args, { cwd, env: { ...process.env, LUDION_CLIENT: process.env.LUDION_CLIENT || 'Claude Code' }, timeout: 50_000 }, (_error, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ ok: false, error: 'no_answer', message: 'ludion.mjs gave no answer' });
      }
    });
  });
}

async function main() {
  const input = await readInput();
  if (!input || !TOOLS.has(input.tool_name)) return;
  const cwd = input.cwd || process.cwd();
  const raw = input.tool_input?.file_path;
  if (typeof raw !== 'string' || !/\.html?$/i.test(raw)) return;
  const file = path.resolve(cwd, raw);
  if (SKIP.test(path.relative(cwd, file)) || !existsSync(file)) return;
  if (!autoSaveOn(file)) return;
  if (!hasCredentials()) {
    if (nudgeOnce()) {
      reply('The Ludion plugin is installed but not connected, so this HTML was not saved to Ludion. If the person wants their HTML saved automatically, tell them to run /ludion:connect once (it opens the browser to allow it). Do not ask again today.');
    }
    return;
  }

  // A file without <title> gets its file name as the title
  const html = readFileSync(file, 'utf8');
  const title = /<title\b[^>]*>[\s\S]*?\S[\s\S]*?<\/title>/i.test(html) ? null : path.basename(file).replace(/\.html?$/i, '');
  const result = await runPut(file, cwd, title);
  const name = path.relative(cwd, file) || path.basename(file);

  if (result.ok && result.action === 'unchanged') return;
  if (result.ok) {
    const what = result.action === 'new_version' ? `a new version (version ${result.version}) of the same work` : 'a new work';
    const seen = result.visibility === 'public' ? 'as a draft of the public work (the public version stays until the person sends it for review)' : 'as "Only me" (only the person can see it)';
    reply(
      `Ludion auto-save: ${name} was saved to the person's Ludion as ${what}, ${seen}: ${result.url}\nTell the person this address once (no need to repeat it for every small edit). To publish, they press Publish on the site (it is reviewed first).`,
      `Ludion: saved ${name} → ${result.url}`,
    );
    return;
  }
  if (result.error === 'check_failed') {
    const problems = result.problems ?? [];
    if (problems.some((p) => NOT_A_WORK.has(p.code))) return;
    reply(`Ludion auto-save skipped ${name}: ${problems.map((p) => `${p.message} (fix: ${p.fix})`).join('; ')}. Only fix this if the person wants this file on Ludion.`);
    return;
  }
  if (result.error === 'invalid_work') {
    const problems = (result.problems ?? []).map((p) => `${p.message}${p.fix ? ` (fix: ${p.fix})` : ''}`).join('; ');
    reply(`Ludion auto-save could not save ${name}: ${result.message ?? ''} ${problems}. Only fix this if the person wants this file on Ludion; it is saved automatically after the next edit.`);
    return;
  }
  if (result.error === 'no_key' || result.status === 401) {
    if (nudgeOnce()) reply(`Ludion auto-save could not save ${name}: the connection to Ludion was cut or has expired. If the person wants auto-save, tell them to run /ludion:connect again.`);
    return;
  }
  // Network, limits, server: say it briefly; the next edit tries again
  reply(`Ludion auto-save could not save ${name} this time (${result.error ?? 'error'}: ${result.message ?? ''}). It will try again after the next edit.`);
}

try {
  await main();
} catch {
  // never block Claude Code
}
process.exitCode = 0;
