#!/usr/bin/env node
// Ludion skill helper. Node 18+, no dependencies (only fetch). Output is JSON for the AI to read.
//
//   node ludion.mjs put <file.html> [--title <title>] [--from <source id>] [--if-changed]
//   node ludion.mjs list
//   node ludion.mjs get <id> [-o <file>]
//   node ludion.mjs check <file.html>
//   node ludion.mjs login | logout | status
//   node ludion.mjs auto on|off [--all]
//
// Credentials: env LUDION_KEY (an AI key; never written to a file or printed), or the connection made once with `login`
// (OAuth in the browser; the tokens are kept in ~/.ludion/auth.json, readable only by you, and refreshed as needed).
// Server: env LUDION_URL (default https://ludion.ai). LUDION_HOME moves ~/.ludion (tests).
// Auto-save (the Claude Code plugin's hook): on unless `auto off` (this folder and below, kept in .ludion.json) or `auto off --all`.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_URL = 'https://ludion.ai';
const STATE_FILE = '.ludion.json';
const AUTH_FILE = 'auth.json';
const CONFIG_FILE = 'config.json';
/** The name this helper registers with when it connects (shown on the person's account page and on the works it puts). */
const CLIENT_NAME = 'Claude Code';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
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
    } else if (a === '--if-changed' || a === '--all') {
      flags[a] = true;
    } else if (a.startsWith('--') && a.includes('=')) {
      const [k, ...v] = a.split('=');
      flags[k] = v.join('=');
    } else positional.push(a);
  }
  return { positional, flags };
}

class UsageError extends Error {}

const USAGE = 'node ludion.mjs put <file.html> [--title <title>] [--from <id>] [--if-changed] | list | get <id> [-o <file>] | check <file.html> | login | logout | status | auto on|off [--all]';

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

// ---------- files ----------

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

export const homeDir = () => process.env.LUDION_HOME || path.join(os.homedir(), '.ludion');

function readJson(file, fallback) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

/** Writes a file only the person can read (the tokens). */
function writePrivate(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: the file is in the person's own profile folder
  }
}

const authFile = () => path.join(homeDir(), AUTH_FILE);
const configFile = () => path.join(homeDir(), CONFIG_FILE);
const loadAuth = () => readJson(authFile(), { servers: {} });

function saveConnection(entry) {
  const auth = loadAuth();
  auth.servers = auth.servers && typeof auth.servers === 'object' ? auth.servers : {};
  if (entry) auth.servers[baseUrl()] = entry;
  else delete auth.servers[baseUrl()];
  writePrivate(authFile(), auth);
}

const connectionOf = () => loadAuth().servers?.[baseUrl()] ?? null;

// ---------- credentials ----------

const NOT_CONNECTED = () => [
  'no_key',
  'Not connected to Ludion. Run `node ludion.mjs login` once (in Claude Code: /ludion:connect) and allow it in the browser, or set an AI key as the LUDION_KEY environment variable (do not paste it into files).',
  {
    how: `Run "node ludion.mjs login" and allow it in the browser. Or sign in at ${baseUrl()}/account, make a key in "AI keys", and set LUDION_KEY in the shell that runs this command.`,
  },
];

/** A fresh access token from the saved connection (refreshes it when it has expired). null if not connected. */
async function connectionToken() {
  const saved = connectionOf();
  if (!saved?.refresh_token || !saved.client_id) return null;
  if (saved.access_token && Number(saved.access_expires_at) > Date.now() + 60_000) return saved.access_token;
  let res;
  try {
    res = await fetch(`${baseUrl()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh_token, client_id: saved.client_id, resource: `${baseUrl()}/mcp` }),
    });
  } catch {
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // Disconnected on the site, or expired: forget it so the person can connect again
    if (res.status === 400 || res.status === 401) saveConnection(null);
    return null;
  }
  saveConnection({ ...saved, access_token: data.access_token, access_expires_at: Date.now() + Number(data.expires_in ?? 3600) * 1000, refresh_token: data.refresh_token ?? saved.refresh_token });
  return data.access_token;
}

/** The Authorization value: the AI key if set, otherwise the saved connection. Prints the failure and returns null if neither. */
async function authorization() {
  const k = process.env.LUDION_KEY;
  if (k) return `Bearer ${k}`;
  const token = await connectionToken();
  if (token) return `Bearer ${token}`;
  fail(...NOT_CONNECTED());
  return null;
}

/** Calls the API. Returns the parsed body, or null after printing the failure. */
async function api(method, pathname, body, hints = {}) {
  const auth = await authorization();
  if (!auth) return null;
  let res;
  try {
    res = await fetch(`${baseUrl()}${pathname}`, {
      method,
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        'Accept-Language': process.env.LUDION_LANG || 'en',
        // Which AI put it (a small mark on the person's works). The plugin's hook sets it
        ...(process.env.LUDION_CLIENT ? { 'X-Ludion-Client': process.env.LUDION_CLIENT } : {}),
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
      ? `${data.message ?? 'The key was refused'}. The key may be wrong or deleted, or the connection was cut on the site; connect again (node ludion.mjs login) or make a new key at ${baseUrl()}/account.`
      : res.status === 422 && extra.problems
        ? `${data.message ?? 'The work was not accepted'}. Fix each problem (see problems[].fix) and put again.`
        : res.status === 429
          ? `${data.message ?? 'Too many requests'}. Wait until retry_at, then try again.`
          : (data.message ?? `HTTP ${res.status}`);
  fail(data.error ?? `http_${res.status}`, message, extra);
  return null;
}

// ---------- .ludion.json (which file is which work; auto-save off for a folder) ----------

/** The nearest folder (from `start` up) that has a .ludion.json, or null. */
function findStateFile(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, STATE_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function findStateDir() {
  return findStateFile(process.cwd()) ?? process.cwd();
}

function readState(file) {
  const state = existsSync(file) ? readJson(file, { works: {} }) : { works: {} };
  if (!state.works || typeof state.works !== 'object') state.works = {};
  return state;
}

function loadState() {
  const dir = findStateDir();
  const file = path.join(dir, STATE_FILE);
  return { dir, file, state: readState(file) };
}

function stateKey(dir, file) {
  return path.relative(dir, path.resolve(file)).split(path.sep).join('/');
}

function saveState({ file, state }) {
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/**
 * Is auto-save on for this file? Off with LUDION_AUTO=off (or 0), with `auto off --all`, or with `auto off` in the file's folder or a
 * folder above it (the nearest .ludion.json that says "auto" decides).
 */
export function autoSaveOn(file) {
  if (/^(0|off|false|no)$/i.test(process.env.LUDION_AUTO ?? '')) return false;
  if (readJson(configFile(), {}).auto === false) return false;
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    const found = findStateFile(dir);
    if (!found) return true;
    const state = readState(path.join(found, STATE_FILE));
    if (typeof state.auto === 'boolean') return state.auto;
    const up = path.dirname(found);
    if (up === found) return true;
    dir = up;
  }
}

/** Is there anything to put with (a key or a saved connection)? Does not call the server. */
export const hasCredentials = () => Boolean(process.env.LUDION_KEY) || Boolean(connectionOf()?.refresh_token);

// ---------- commands ----------

async function put(file, flags) {
  const html = readHtml(file);
  if (html === null) return;
  const title = flags['--title'];
  const local = staticCheck(html);
  // A title given on the command line stands in for a missing <title>
  const problems = title ? local.problems.filter((p) => p.code !== 'no_title') : local.problems;
  if (problems.length) {
    fail('check_failed', 'The file did not pass the check; nothing was sent. Fix each problem and put again.', { problems });
    return;
  }
  const st = loadState();
  const k = stateKey(st.dir, file);
  const known = st.state.works[k];
  const hash = sha256(html);
  if (flags['--if-changed'] && known?.id && known.hash === hash) {
    out({ ok: true, action: 'unchanged', file: k, id: known.id, version: known.version, note: 'Same as the version already put; nothing was sent.' });
    return;
  }
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
  st.state.works[k] = { id: data.id, version: data.version, hash };
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

// ---------- login (OAuth with PKCE, once) ----------

const base64url = (buffer) => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Opens the address in the person's browser. Never throws. */
function openBrowser(url) {
  if (process.env.LUDION_NO_OPEN === '1') return false;
  try {
    const [cmd, args] =
      process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const DONE_PAGE = (ok) => `<!doctype html><meta charset="utf-8"><title>Ludion</title><body style="font:16px system-ui;margin:48px;max-width:480px">
<p style="font-weight:800">Ludion</p><p>${ok ? 'Connected. You can close this tab and go back to Claude Code.<br>つながりました。このタブは閉じてかまいません。' : 'Not connected. Go back to Claude Code and try again.<br>つながりませんでした。Claude Code に戻って、もう一度お試しください。'}</p></body>`;

async function login() {
  const base = baseUrl();
  // 1. Wait for the browser to come back to this computer (only on 127.0.0.1)
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(24));
  let finish;
  const done = new Promise((resolve) => {
    finish = resolve;
  });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
    res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' }).end(DONE_PAGE(ok));
    finish(ok ? { code: url.searchParams.get('code') } : { error: url.searchParams.get('error') ?? 'bad_state' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const stop = (result) => {
    server.close();
    return result;
  };

  try {
    // 2. Register this helper (dynamic client registration)
    let res;
    try {
      res = await fetch(`${base}/oauth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
      });
    } catch (e) {
      return stop(fail('network', `Could not reach ${base}: ${e.cause?.code ?? e.message}`));
    }
    const client = await res.json().catch(() => ({}));
    if (!res.ok || !client.client_id) return stop(fail('register_failed', `Ludion did not accept the registration (${res.status} ${client.error ?? ''}).`));

    // 3. The person logs in and allows it in the browser
    const authorize = new URL(`${base}/oauth/authorize`);
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'works', resource: `${base}/mcp` })) {
      authorize.searchParams.set(key, value);
    }
    const opened = openBrowser(authorize.toString());
    process.stderr.write(`${opened ? 'Opened your browser.' : 'Open this address in your browser:'} Log in to Ludion and choose "Allow":\n${authorize}\n`);
    const timer = setTimeout(() => finish({ error: 'timeout' }), Number(process.env.LUDION_LOGIN_TIMEOUT_MS ?? LOGIN_TIMEOUT_MS));
    const back = await done;
    clearTimeout(timer);
    if (back.error) {
      return stop(fail(back.error === 'access_denied' ? 'denied' : back.error, back.error === 'timeout' ? 'Nobody allowed it in the browser in time. Run login again.' : `Not connected (${back.error}). Run login again.`, { authorize_url: authorize.toString() }));
    }

    // 4. Exchange the code for tokens, and keep them where only the person can read them
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: back.code, redirect_uri: redirectUri, client_id: client.client_id, code_verifier: verifier, resource: `${base}/mcp` }),
    });
    const tokens = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) return stop(fail('token_failed', `Ludion did not give a token (${tokenRes.status} ${tokens.error ?? ''}). Run login again.`));
    saveConnection({ client_id: client.client_id, access_token: tokens.access_token, access_expires_at: Date.now() + Number(tokens.expires_in ?? 3600) * 1000, refresh_token: tokens.refresh_token, connected_at: new Date().toISOString() });
    return stop(out({ ok: true, connected: true, server: base, note: 'Connected. From now on, HTML files you write are saved to Ludion as "Only me" automatically (the Claude Code plugin). Disconnect any time on the account page.' }));
  } catch (e) {
    return stop(fail('login_failed', String(e.message ?? e)));
  }
}

async function logout() {
  const saved = connectionOf();
  if (!saved) return out({ ok: true, connected: false, note: 'Not connected.' });
  try {
    await fetch(`${baseUrl()}/oauth/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: saved.refresh_token, client_id: saved.client_id }),
    });
  } catch {
    // forget it here anyway
  }
  saveConnection(null);
  out({ ok: true, connected: false, note: 'Disconnected.' });
}

function status() {
  const saved = connectionOf();
  out({ ok: true, server: baseUrl(), key: Boolean(process.env.LUDION_KEY), connected: Boolean(saved?.refresh_token), connected_at: saved?.connected_at ?? null, auto: autoSaveOn(path.join(process.cwd(), 'x.html')) });
}

function auto(value, flags) {
  if (value !== 'on' && value !== 'off') return fail('usage', 'node ludion.mjs auto on|off [--all]');
  const on = value === 'on';
  if (flags['--all']) {
    writePrivate(configFile(), { ...readJson(configFile(), {}), auto: on });
    return out({ ok: true, auto: on, scope: 'all', note: on ? 'Auto-save is on (folders turned off with "auto off" stay off).' : 'Auto-save is off everywhere.' });
  }
  const file = path.join(process.cwd(), STATE_FILE);
  const state = readState(file);
  state.auto = on;
  saveState({ file, state });
  out({ ok: true, auto: on, scope: 'folder', folder: process.cwd(), note: on ? 'Auto-save is on in this folder.' : 'Auto-save is off in this folder and the folders inside it.' });
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
  if (cmd === 'login') return login();
  if (cmd === 'logout') return logout();
  if (cmd === 'status') return status();
  if (cmd === 'auto') return auto(arg, args.flags);
  return fail('usage', USAGE);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();
