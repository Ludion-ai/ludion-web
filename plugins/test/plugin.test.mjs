// Tests for the Claude Code plugin (plugins/ludion, MCP001 "2") against the fake server:
// the PostToolUse hook puts HTML automatically, auto on/off, connecting once with login (OAuth), and refreshing the token.
//   node --test plugins/test/plugin.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TEST_KEY, startFakeServer } from './fake-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(here, '../ludion');
const CLI = path.join(PLUGIN, 'skills/ludion/ludion.mjs');
const HOOK = path.join(PLUGIN, 'hooks/auto-save.mjs');

const WORK = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ripple</title></head>
<body><div data-ld-part="ripple"><button>Press</button></div>
<style>[data-ld-part="ripple"] button{padding:12px}</style></body></html>
`;

function run(file, args, { cwd, env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...process.env, LUDION_KEY: '', LUDION_URL: '', LUDION_AUTO: '', LUDION_NO_BROWSER: '1', ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        // leave null
      }
      resolve({ code, stdout, stderr, json });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

const tmp = (prefix) => mkdtempSync(path.join(tmpdir(), prefix));

function project(files = {}) {
  const dir = tmp('ludion-plugin-');
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

/** Runs the hook as Claude Code does: the tool call as JSON on stdin. */
const hook = (dir, filePath, env, toolName = 'Write') =>
  run(HOOK, [], { cwd: dir, env, input: JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'PostToolUse', tool_name: toolName, tool_input: { file_path: filePath, content: '' }, tool_response: {} }) });

describe('Claude Code plugin', () => {
  let server;
  before(async () => {
    server = await startFakeServer({ putLimit: 1000 });
  });
  after(() => server.close());

  test('the plugin files are in place (manifest, hook, commands, skill) and the marketplace points at it', () => {
    const manifest = JSON.parse(readFileSync(path.join(PLUGIN, '.claude-plugin/plugin.json'), 'utf8'));
    assert.equal(manifest.name, 'ludion');
    const hooks = JSON.parse(readFileSync(path.join(PLUGIN, 'hooks/hooks.json'), 'utf8'));
    const entry = hooks.hooks.PostToolUse[0];
    assert.match(entry.matcher, /Write/);
    assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/auto-save\.mjs/);
    for (const name of ['commands/connect.md', 'commands/auto.md', 'skills/ludion/SKILL.md']) assert.ok(existsSync(path.join(PLUGIN, name)), name);
    const market = JSON.parse(readFileSync(path.resolve(here, '../../.claude-plugin/marketplace.json'), 'utf8'));
    assert.equal(market.plugins[0].name, 'ludion');
    assert.equal(path.resolve(here, '../..', market.plugins[0].source), PLUGIN);
  });

  test('hook: writing an HTML file puts it; the same file again is a new version; unchanged is not sent', async () => {
    const dir = project({ 'ripple.html': WORK, 'notes.md': '# notes' });
    const env = { LUDION_URL: server.url, LUDION_KEY: TEST_KEY, LUDION_HOME: tmp('ludion-home-') };

    const calls = server.calls.length;
    const first = await hook(dir, path.join(dir, 'ripple.html'), env);
    assert.equal(first.code, 0, first.stderr);
    const context = first.json.hookSpecificOutput.additionalContext;
    assert.equal(first.json.hookSpecificOutput.hookEventName, 'PostToolUse');
    const put = server.calls.at(-1);
    assert.equal(put.path, '/api/v1/works');
    assert.equal(put.client, 'Claude Code');
    const id = JSON.parse(readFileSync(path.join(dir, '.ludion.json'), 'utf8')).works['ripple.html'].id;
    assert.match(context, new RegExp(`${server.url}/p/${id}`));
    assert.match(first.json.systemMessage, /Ludion: saved ripple\.html/);
    assert.equal(server.calls.length, calls + 1);

    // unchanged: nothing is sent, nothing is said
    const same = await hook(dir, path.join(dir, 'ripple.html'), env, 'Edit');
    assert.equal(same.code, 0);
    assert.equal(same.stdout.trim(), '');
    assert.equal(server.calls.length, calls + 1);

    // changed: a new version of the same work
    writeFileSync(path.join(dir, 'ripple.html'), WORK.replace('Press', 'Press me'));
    const second = await hook(dir, 'ripple.html', env, 'Edit');
    assert.equal(server.calls.at(-1).path, `/api/v1/works/${id}/versions`);
    assert.match(second.json.hookSpecificOutput.additionalContext, /version 2/);

    // not HTML, or another tool: nothing
    const before_ = server.calls.length;
    assert.equal((await hook(dir, path.join(dir, 'notes.md'), env)).stdout.trim(), '');
    assert.equal((await hook(dir, path.join(dir, 'ripple.html'), env, 'Read')).stdout.trim(), '');
    assert.equal(server.calls.length, before_);
  });

  test('hook: a page of a bigger project (other files) is skipped quietly; a file without <title> gets its file name', async () => {
    const dir = project({ 'index.html': '<!doctype html><title>App</title><div id="app"></div><script type="module" src="/src/main.tsx"></script>', 'card.html': WORK.replace('<title>Ripple</title>', '') });
    const env = { LUDION_URL: server.url, LUDION_KEY: TEST_KEY, LUDION_HOME: tmp('ludion-home-') };
    const before_ = server.calls.length;
    const page = await hook(dir, path.join(dir, 'index.html'), env);
    assert.equal(page.stdout.trim(), '');
    assert.equal(server.calls.length, before_);
    const card = await hook(dir, path.join(dir, 'card.html'), env);
    assert.ok(card.json.hookSpecificOutput.additionalContext.includes('saved'));
    assert.equal(JSON.parse(server.calls.at(-1).body).title, 'card');
  });

  test('auto off in a folder stops it there and below; on resumes; --all stops it everywhere', async () => {
    const dir = project({ 'a.html': WORK });
    const home = tmp('ludion-home-');
    const env = { LUDION_URL: server.url, LUDION_KEY: TEST_KEY, LUDION_HOME: home };
    const off = await run(CLI, ['auto', 'off'], { cwd: dir, env });
    assert.equal(off.json.ok, true);
    assert.equal(JSON.parse(readFileSync(path.join(dir, '.ludion.json'), 'utf8')).auto, false);
    const sub = path.join(dir, 'sub');
    (await import('node:fs')).mkdirSync(sub);
    writeFileSync(path.join(sub, 'b.html'), WORK);
    const before_ = server.calls.length;
    assert.equal((await hook(dir, path.join(dir, 'a.html'), env)).stdout.trim(), '');
    assert.equal((await hook(dir, path.join(sub, 'b.html'), env)).stdout.trim(), '');
    assert.equal(server.calls.length, before_);

    await run(CLI, ['auto', 'on'], { cwd: dir, env });
    assert.ok((await hook(dir, path.join(dir, 'a.html'), env)).json.hookSpecificOutput);
    assert.equal(server.calls.length, before_ + 1);

    const all = await run(CLI, ['auto', 'off', '--all'], { cwd: dir, env });
    assert.equal(all.json.scope, 'all');
    writeFileSync(path.join(dir, 'a.html'), WORK.replace('Press', 'Again'));
    assert.equal((await hook(dir, path.join(dir, 'a.html'), env)).stdout.trim(), '');
    assert.equal(server.calls.length, before_ + 1);
    // the environment variable also stops it
    await run(CLI, ['auto', 'on', '--all'], { cwd: dir, env });
    assert.equal((await hook(dir, path.join(dir, 'a.html'), { ...env, LUDION_AUTO: 'off' })).stdout.trim(), '');
    assert.equal(server.calls.length, before_ + 1);
  });

  test('not connected: says once a day how to connect, sends nothing', async () => {
    const dir = project({ 'a.html': WORK });
    const env = { LUDION_URL: server.url, LUDION_HOME: tmp('ludion-home-') };
    const before_ = server.calls.length;
    const first = await hook(dir, path.join(dir, 'a.html'), env);
    assert.match(first.json.hookSpecificOutput.additionalContext, /\/ludion:connect/);
    const second = await hook(dir, path.join(dir, 'a.html'), env);
    assert.equal(second.stdout.trim(), '');
    assert.equal(server.calls.length, before_);
  });

  test('login: connects once in the browser (PKCE), keeps the tokens privately, refreshes them, logout disconnects', async () => {
    const dir = project({ 'a.html': WORK });
    const home = tmp('ludion-home-');
    const env = { LUDION_URL: server.url, LUDION_HOME: home, LUDION_NO_OPEN: '1' };

    // The "browser": read the address from stderr, open it (the fake server allows at once), follow it back to the helper
    const child = spawn(process.execPath, [CLI, 'login'], { cwd: dir, env: { ...process.env, LUDION_KEY: '', ...env } });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    const authorizeUrl = await new Promise((resolve) => {
      let err = '';
      child.stderr.on('data', (d) => {
        err += d;
        const m = /(http:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?\S+)/.exec(err);
        if (m) resolve(m[1]);
      });
    });
    const authorize = new URL(authorizeUrl);
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(authorize.searchParams.get('resource'), `${server.url}/mcp`);
    assert.match(authorize.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    assert.equal(server.oauth.clients.get(authorize.searchParams.get('client_id')).name, 'Claude Code');
    const back = await fetch(authorizeUrl, { redirect: 'manual' });
    assert.equal(back.status, 302);
    const page = await fetch(back.headers.get('location'));
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Connected/);
    const code = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stdout);
    assert.equal(JSON.parse(stdout).connected, true);

    const authPath = path.join(home, 'auth.json');
    const saved = JSON.parse(readFileSync(authPath, 'utf8')).servers[server.url];
    assert.match(saved.access_token, /^ldo_/);
    assert.match(saved.refresh_token, /^ldr_/);
    if (process.platform !== 'win32') assert.equal(statSync(authPath).mode & 0o077, 0);
    // tokens are never printed
    assert.equal(stdout.includes(saved.access_token) || stdout.includes(saved.refresh_token), false);

    // put with the connection (no key)
    const put = await run(CLI, ['put', 'a.html'], { cwd: dir, env });
    assert.equal(put.json.ok, true, put.stdout);
    assert.equal(server.calls.at(-1).auth, `Bearer ${saved.access_token}`);

    // the access token expired: refreshed by itself, then used
    const auth = JSON.parse(readFileSync(authPath, 'utf8'));
    auth.servers[server.url].access_expires_at = Date.now() - 1000;
    writeFileSync(authPath, JSON.stringify(auth));
    const list = await run(CLI, ['list'], { cwd: dir, env });
    assert.equal(list.json.ok, true, list.stdout);
    const renewed = JSON.parse(readFileSync(authPath, 'utf8')).servers[server.url];
    assert.notEqual(renewed.access_token, saved.access_token);
    assert.equal(server.calls.at(-1).auth, `Bearer ${renewed.access_token}`);
    assert.ok(server.calls.some((call) => call.path === '/oauth/token' && call.body.includes('grant_type=refresh_token')));

    const status = await run(CLI, ['status'], { cwd: dir, env });
    assert.equal(status.json.connected, true);
    const out = await run(CLI, ['logout'], { cwd: dir, env });
    assert.equal(out.json.connected, false);
    assert.equal(JSON.parse(readFileSync(authPath, 'utf8')).servers[server.url], undefined);
    assert.equal(server.users.has(renewed.access_token), false);
    const after_ = await run(CLI, ['list'], { cwd: dir, env });
    assert.equal(after_.json.error, 'no_key');
  });

  test('login: pressing Cancel in the browser is not a connection', async () => {
    server.oauth.deny = true;
    try {
      const home = tmp('ludion-home-');
      const child = spawn(process.execPath, [CLI, 'login'], { env: { ...process.env, LUDION_KEY: '', LUDION_URL: server.url, LUDION_HOME: home, LUDION_NO_OPEN: '1' } });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      const url = await new Promise((resolve) => {
        let err = '';
        child.stderr.on('data', (d) => {
          err += d;
          const m = /(http:\/\/127\.0\.0\.1:\d+\/oauth\/authorize\?\S+)/.exec(err);
          if (m) resolve(m[1]);
        });
      });
      const back = await fetch(url, { redirect: 'manual' });
      await fetch(back.headers.get('location'));
      assert.equal(await new Promise((resolve) => child.on('close', resolve)), 1);
      assert.equal(JSON.parse(stdout).error, 'denied');
      assert.equal(existsSync(path.join(home, 'auth.json')), false);
    } finally {
      server.oauth.deny = false;
    }
  });
});
