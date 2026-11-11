#!/usr/bin/env node
// Ludion skill helper. Node 18+, no dependencies (only fetch). Output is JSON for the AI to read.
//
//   node ludion.mjs put <file.html> [--title <title>] [--from <source id>]
//   node ludion.mjs list
//   node ludion.mjs get <id> [-o <file>]
//   node ludion.mjs check <file.html>
//
// Key: env LUDION_KEY (never written to a file or printed). Server: env LUDION_URL (default https://ludion.ai).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://ludion.ai';
const STATE_FILE = '.ludion.json';
/** Same limits as the /new box: each of the HTML, CSS and JS parts up to 256KB, the whole request up to 4MB. */
const MAX_PART_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
/** XML namespace names look like URLs but load nothing. */
const NAMESPACE_PREFIXES = ['http://www.w3.org/', 'https://www.w3.org/'];

function out(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = code;
}

function fail(error, message, extra = {}) {
  out({ ok: false, error, message, ...extra }, 1);
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--title' || a === '--from' || a === '-o' || a === '--out') {
      if (i + 1 >= argv.length) throw new UsageError(`${a} needs a value`);
      flags[a === '--out' ? '-o' : a] = argv[++i];
    } else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...v] = a.split('=');
      flags[k] = v.join('=');
    } else positional.push(a);
  }
  return { positional, flags };
}

class UsageError extends Error {}

const USAGE = 'node ludion.mjs put <file.html> [--title <title>] [--from <id>] | list | get <id> [-o <file>] | check <file.html>';

// ---------- check ----------

function byteLength(s) {
  return Buffer.byteLength(s, 'utf8');
}

/** Splits the file roughly the way the /new box does: the <style> bodies, the <script> bodies, and the rest. */
function parts(html) {
  let css = '';
  let js = '';
  const rest = html
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, body) => {
      css += body;
      return '';
    })
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_, body) => {
      js += body;
      return '';
    });
  return { html: rest, css, js };
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function hostOf(url) {
  try {
    return new URL(url.startsWith('//') ? `https:${url}` : url).hostname;
  } catch {
    return '';
  }
}

const isAllowedUrl = (url) => FONT_HOSTS.has(hostOf(url)) || NAMESPACE_PREFIXES.some((p) => url.startsWith(p));

/** URLs that would load something from outside the file. */
function externalUrls(html) {
  const text = stripComments(html);
  const found = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s"'`()<>\\]+/gi)) found.add(m[0]);
  // Protocol-relative: only where a URL is expected (attributes, CSS url() and @import), not JS line comments.
  const rel = [
    /\b(?:src|href|srcset|poster|action|data|xlink:href|background)\s*=\s*["']?\s*(\/\/[^\s"'`()<>\\]+)/gi,
    /url\(\s*["']?\s*(\/\/[^\s"'`()<>\\]+)/gi,
    /@import\s+["'](\/\/[^"']+)/gi,
  ];
  for (const re of rel) for (const m of text.matchAll(re)) found.add(m[1]);
  return [...found].filter((u) => !isAllowedUrl(u.replace(/[.,;]+$/, '')));
}

const LOCAL_OK = /^(?:#|data:|blob:|mailto:|tel:|about:|javascript:|https?:|\/\/|\$\{|\{)/i;

/** References to other files next to this one (they would be missing once the file is put on Ludion). */
function localFiles(html) {
  const text = stripComments(html);
  const found = new Set();
  const tagAttr = /<(script|link|img|source|video|audio|track|iframe|embed|object|image|use|input)\b[^>]*?\s(src|href|srcset|poster|data|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of text.matchAll(tagAttr)) {
    const value = (m[3] ?? m[4] ?? m[5] ?? '').trim();
    const first = value.split(/[\s,]/)[0];
    if (first && !LOCAL_OK.test(first)) found.add(first);
  }
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const v = m[1].trim();
    if (v && !LOCAL_OK.test(v) && !v.startsWith('var(')) found.add(v);
  }
  for (const m of text.matchAll(/@import\s+["']([^"']+)["']/gi)) if (!LOCAL_OK.test(m[1])) found.add(m[1]);
  return [...found];
}

function titleOf(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(stripComments(html));
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Checks that need nothing but the file. Returns { problems, size, title }. */
export function staticCheck(html) {
  const problems = [];
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    problems.push({ code: 'not_html', message: 'The file has no HTML elements', fix: 'Write the UI as one HTML file' });
  }
  const external = externalUrls(html);
  if (external.length) {
    problems.push({
      code: 'external_urls',
      message: `The file loads ${external.length} URL(s) from outside (only Google Fonts is allowed)`,
      fix: 'Put images, sounds and fonts inside the file (data: URLs, inline <svg>, or CSS). Remove other outside URLs, including links (use href="#").',
      urls: external,
    });
  }
  const local = localFiles(html);
  if (local.length) {
    problems.push({
      code: 'local_files',
      message: `The file refers to ${local.length} other file(s); it must be a single HTML file`,
      fix: 'Inline each file: CSS into <style>, JS into <script>, images and fonts as data: URLs or inline <svg>.',
      files: local,
    });
  }
  const title = titleOf(html);
  if (!title) problems.push({ code: 'no_title', message: 'The file has no <title>', fix: 'Add <title>Short name of the UI</title> in <head>' });
  const p = parts(html);
  const size = { total: byteLength(html), html: byteLength(p.html), css: byteLength(p.css), js: byteLength(p.js), limit_per_part: MAX_PART_BYTES };
  for (const k of ['html', 'css', 'js']) {
    if (size[k] > MAX_PART_BYTES) {
      problems.push({ code: 'too_large', message: `The ${k.toUpperCase()} part is ${(size[k] / 1024).toFixed(1)}KB, over the ${MAX_PART_BYTES / 1024}KB limit`, fix: 'Make it smaller (compress images, remove unused code)' });
    }
  }
  if (size.total > MAX_BODY_BYTES) problems.push({ code: 'too_large', message: `The file is over ${MAX_BODY_BYTES / 1024 / 1024}MB`, fix: 'Make it smaller' });
  return { problems, size, title };
}

async function loadPlaywright() {
  if (process.env.LUDION_NO_BROWSER === '1') return { reason: 'LUDION_NO_BROWSER=1' };
  const bases = [path.join(process.cwd(), 'noop.js'), import.meta.url];
  for (const base of bases) {
    try {
      const resolved = createRequire(base).resolve('playwright');
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return { chromium };
    } catch {
      // try the next place
    }
  }
  return { reason: 'Playwright is not installed here' };
}

/** Opens the file once in Chromium, with every outside request blocked. */
async function renderCheck(file) {
  const pw = await loadPlaywright();
  if (!pw.chromium) return { skipped: true, reason: pw.reason };
  let browser;
  try {
    browser = await pw.chromium.launch();
  } catch (e) {
    return { skipped: true, reason: `Chromium could not start: ${String(e.message).split('\n')[0]}` };
  }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const fileUrl = pathToFileURL(path.resolve(file)).href;
    const errors = [];
    const blocked = [];
    page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === fileUrl || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      if (FONT_HOSTS.has(hostOf(url))) return route.fulfill({ status: 200, body: '' });
      blocked.push(url);
      return route.abort();
    });
    await page.goto(fileUrl, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(500);
    const rendered = await page.evaluate(() => {
      for (const el of document.body ? document.body.querySelectorAll('*') : []) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return true;
      }
      return false;
    });
    return { skipped: false, ok: errors.length === 0 && rendered, rendered, errors, blocked_requests: blocked };
  } catch (e) {
    return { skipped: false, ok: false, rendered: false, errors: [String(e.message).split('\n')[0]], blocked_requests: [] };
  } finally {
    await browser.close();
  }
}

async function check(file) {
  const html = readHtml(file);
  if (html === null) return;
  const result = staticCheck(html);
  const render = await renderCheck(file);
  const problems = [...result.problems];
  if (!render.skipped && !render.ok) {
    problems.push({
      code: 'render_failed',
      message: render.rendered ? 'The page has errors when opened' : 'Nothing visible was drawn when the page was opened',
      fix: 'Open the file by itself and fix the errors listed in render.errors',
    });
  }
  const ok = problems.length === 0;
  out({ ok, file, title: result.title, size: result.size, problems, render }, ok ? 0 : 1);
}

// ---------- server ----------

function readHtml(file) {
  if (!file) {
    fail('usage', USAGE);
    return null;
  }
  if (!existsSync(file)) {
    fail('no_file', `No file at ${file}`);
    return null;
  }
  return readFileSync(file, 'utf8');
}

function baseUrl() {
  return (process.env.LUDION_URL || DEFAULT_URL).replace(/\/+$/, '');
}

function key() {
  const k = process.env.LUDION_KEY;
  if (k) return k;
  fail('no_key', 'LUDION_KEY is not set. Ask the person to make an AI key on their account page and set it as the LUDION_KEY environment variable (do not paste it into files).', {
    how: `Sign in at ${baseUrl()}/account, make a key in "AI keys", then set LUDION_KEY in the shell that runs this command.`,
  });
  return null;
}

/** Calls the API. Returns the parsed body, or null after printing the failure. */
async function api(method, pathname, body, hints = {}) {
  const k = key();
  if (!k) return null;
  let res;
  try {
    res = await fetch(`${baseUrl()}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${k}`,
        Accept: 'application/json',
        'Accept-Language': process.env.LUDION_LANG || 'en',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    fail('network', `Could not reach ${baseUrl()}: ${e.cause?.code ?? e.message}`);
    return null;
  }
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 500) };
  }
  if (res.ok) return data;
  const extra = { status: res.status };
  if (Array.isArray(data.problems)) extra.problems = data.problems;
  if (res.status === 429) {
    const after = res.headers.get('Retry-After');
    extra.retry_at = data.retry_at ?? data.reset_at ?? (after && /^\d+$/.test(after) ? new Date(Date.now() + Number(after) * 1000).toISOString() : after) ?? null;
  }
  for (const [k2, v] of Object.entries(data)) if (!(k2 in extra) && k2 !== 'error' && k2 !== 'message') extra[k2] = v;
  const message = hints[res.status]
    ? hints[res.status]
    : res.status === 401
      ? `${data.message ?? 'The key was refused'}. The key may be wrong or deleted; ask the person to make a new one at ${baseUrl()}/account.`
      : res.status === 422 && extra.problems
        ? `${data.message ?? 'The work was not accepted'}. Fix each problem (see problems[].fix) and put again.`
        : res.status === 429
          ? `${data.message ?? 'Too many requests'}. Wait until retry_at, then try again.`
          : (data.message ?? `HTTP ${res.status}`);
  fail(data.error ?? `http_${res.status}`, message, extra);
  return null;
}

// ---------- .ludion.json (which file is which work) ----------

function findStateDir() {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, STATE_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
}

function loadState() {
  const dir = findStateDir();
  const file = path.join(dir, STATE_FILE);
  let state = { works: {} };
  if (existsSync(file)) {
    try {
      state = JSON.parse(readFileSync(file, 'utf8'));
      if (!state || typeof state.works !== 'object') state = { works: {} };
    } catch {
      state = { works: {} };
    }
  }
  return { dir, file, state };
}

function stateKey(dir, file) {
  return path.relative(dir, path.resolve(file)).split(path.sep).join('/');
}

function saveState({ file, state }) {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

// ---------- commands ----------

async function put(file, flags) {
  const html = readHtml(file);
  if (html === null) return;
  const local = staticCheck(html);
  if (local.problems.length) {
    fail('check_failed', 'The file did not pass the check; nothing was sent. Fix each problem and put again.', { problems: local.problems });
    return;
  }
  const st = loadState();
  const k = stateKey(st.dir, file);
  const known = st.state.works[k];
  const title = flags['--title'];
  let data;
  let note;
  if (known?.id) {
    if (flags['--from']) note = '--from is ignored: this file is already a work, so a new version was put';
    data = await api('POST', `/api/v1/works/${encodeURIComponent(known.id)}/versions`, { html, ...(title ? { title } : {}) }, {
      404: `Work ${known.id} (from ${STATE_FILE}) is not yours or no longer exists. To put this file as a new work, remove "${k}" from ${st.file} and put again.`,
    });
    if (!data) return;
  } else {
    data = await api('POST', '/api/v1/works', { html, ...(title ? { title } : {}), ...(flags['--from'] ? { from: flags['--from'] } : {}) });
    if (!data) return;
  }
  st.state.works[k] = { id: data.id, version: data.version };
  saveState(st);
  out({
    ok: true,
    action: known?.id ? 'new_version' : 'created',
    file: k,
    ...data,
    note: note ?? 'Only the owner can see this work. To publish it, the owner sends it for review from the site.',
    state_file: st.file,
  });
}

async function list() {
  const data = await api('GET', '/api/v1/works');
  if (data) out({ ok: true, ...data });
}

async function get(id, flags) {
  if (!id) return fail('usage', USAGE);
  const data = await api('GET', `/api/v1/works/${encodeURIComponent(id)}`);
  if (!data) return;
  const outFile = flags['-o'];
  if (!outFile) return out({ ok: true, ...data });
  writeFileSync(outFile, data.code ?? '');
  const st = loadState();
  const k = stateKey(st.dir, outFile);
  st.state.works[k] = { id: data.id, version: data.version };
  saveState(st);
  const { code, ...rest } = data;
  out({ ok: true, ...rest, written: outFile, bytes: byteLength(code ?? ''), note: `Putting ${outFile} again makes a new version of ${data.id}` });
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    return fail('usage', `${e.message}. ${USAGE}`);
  }
  const [cmd, arg] = args.positional;
  if (cmd === 'put') return put(arg, args.flags);
  if (cmd === 'list') return list();
  if (cmd === 'get') return get(arg, args.flags);
  if (cmd === 'check') return check(arg);
  return fail('usage', USAGE);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
