// Tests for plugins/ludion/skills/ludion/ludion.mjs against the fake server (docs/tasks/T038.md).
//   node --test plugins/test/ludion.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { OTHER_KEY, TEST_KEY, startFakeServer } from './fake-server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../ludion/skills/ludion/ludion.mjs');

const GOOD = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ripple button</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">
<style>button{padding:12px 20px;font:16px Inter,sans-serif}</style></head>
<body><button>Press</button>
<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4" cx="5" cy="5"/></svg>
<script>
// a line comment with //slashes is fine
document.querySelector('button').addEventListener('click', () => {
  const ns = 'http://www.w3.org/2000/svg';
  document.createElementNS(ns, 'g');
});
</script></body></html>
`;

/** Runs the CLI (async, so the in-process server keeps answering). */
function run(args, { cwd, env = {} } = {}) {
  return new Promise((resolve) => {
    // LUDION_HOME：この PC の ~/.ludion（つないだときのトークン）を読まない
    execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, LUDION_KEY: '', LUDION_URL: '', LUDION_HOME: mkdtempSync(path.join(tmpdir(), 'ludion-home-')), ...env } }, (err, stdout, stderr) => {
      let json = null;
      try {
        json = JSON.parse(stdout);
      } catch {
        // leave null
      }
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr, json });
    });
  });
}

function project(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ludion-skill-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

describe('ludion skill', () => {
  let server;
  let env;
  before(async () => {
    server = await startFakeServer({ putLimit: 1000 });
    env = { LUDION_URL: server.url, LUDION_KEY: TEST_KEY, LUDION_NO_BROWSER: '1' };
  });
  after(() => server.close());

  test('no key: stops and tells where to make one, sends nothing', async () => {
    const dir = project({ 'a.html': GOOD });
    const before_ = server.calls.length;
    const r = await run(['put', 'a.html'], { cwd: dir, env: { LUDION_URL: server.url } });
    assert.equal(r.code, 1);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, 'no_key');
    assert.match(r.json.how, new RegExp(`${server.url}/account`));
    assert.equal(server.calls.length, before_);
    assert.equal(existsSync(path.join(dir, '.ludion.json')), false);
  });

  test('put twice: first creates, second makes a new version of the same work', async () => {
    const dir = project({ 'ripple.html': GOOD });
    const first = await run(['put', 'ripple.html'], { cwd: dir, env });
    assert.equal(first.code, 0, first.stdout);
    assert.equal(first.json.ok, true);
    assert.equal(first.json.action, 'created');
    assert.equal(first.json.version, 1);
    assert.equal(first.json.url, `${server.url}/p/${first.json.id}`);
    assert.equal(first.json.code_url, `${server.url}/p/${first.json.id}/code`);
    assert.equal(first.json.visibility, 'draft');
    const call = server.calls.at(-1);
    assert.equal(call.path, '/api/v1/works');
    assert.equal(call.auth, `Bearer ${TEST_KEY}`);
    assert.equal(call.cookie, null);
    assert.deepEqual(JSON.parse(call.body), { html: GOOD });

    const state = JSON.parse(readFileSync(path.join(dir, '.ludion.json'), 'utf8'));
    assert.equal(state.works['ripple.html'].id, first.json.id);
    assert.equal(state.works['ripple.html'].version, 1);
    assert.match(state.works['ripple.html'].hash, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(path.join(dir, '.ludion.json'), 'utf8').includes(TEST_KEY), false);

    writeFileSync(path.join(dir, 'ripple.html'), GOOD.replace('Press', 'Press me'));
    const second = await run(['put', 'ripple.html', '--title', 'Ripple v2'], { cwd: dir, env });
    assert.equal(second.code, 0, second.stdout);
    assert.equal(second.json.action, 'new_version');
    assert.equal(second.json.id, first.json.id);
    assert.equal(second.json.version, 2);
    assert.equal(server.calls.at(-1).path, `/api/v1/works/${first.json.id}/versions`);
    assert.equal(JSON.parse(server.calls.at(-1).body).title, 'Ripple v2');
    assert.equal(server.works.get(first.json.id).versions.length, 2);

    // .ludion.json is found from a subfolder too
    const sub = path.join(dir, 'sub');
    (await import('node:fs')).mkdirSync(sub);
    const third = await run(['put', '../ripple.html'], { cwd: sub, env });
    assert.equal(third.json.id, first.json.id);
    assert.equal(third.json.version, 3);
  });

  test('put --from sends the source id; a bad source is a 422 with the message', async () => {
    const dir = project({ 'remix.html': GOOD });
    const ok = await run(['put', 'remix.html', '--from', 'ripple-public'], { cwd: dir, env });
    assert.equal(ok.code, 0, ok.stdout);
    assert.equal(JSON.parse(server.calls.at(-1).body).from, 'ripple-public');
    const dir2 = project({ 'remix.html': GOOD });
    const bad = await run(['put', 'remix.html', '--from', 'other-private'], { cwd: dir2, env });
    assert.equal(bad.code, 1);
    assert.equal(bad.json.status, 422);
    assert.equal(bad.json.error, 'bad_from');
    assert.equal(existsSync(path.join(dir2, '.ludion.json')), false);
  });

  test('list and get: own works only, get -o writes the code and remembers the file', async () => {
    const dir = project({ 'a.html': GOOD });
    const put = await run(['put', 'a.html'], { cwd: dir, env });
    const list = await run(['list'], { cwd: dir, env });
    assert.equal(list.code, 0);
    assert.ok(list.json.works.some((w) => w.id === put.json.id && w.title === 'Ripple button' && w.version === 1));
    assert.ok(list.json.works.every((w) => !w.id.startsWith('ripple-public') && !w.id.startsWith('other-')));

    const got = await run(['get', put.json.id], { cwd: dir, env });
    assert.equal(got.code, 0);
    assert.equal(got.json.id, put.json.id);
    assert.match(got.json.code, /^<!-- UI by @me — ludion\.ai\/p\//);

    const toFile = await run(['get', put.json.id, '-o', 'copy.html'], { cwd: dir, env });
    assert.equal(toFile.code, 0);
    assert.equal(toFile.json.code, undefined);
    assert.equal(readFileSync(path.join(dir, 'copy.html'), 'utf8'), got.json.code);
    const again = await run(['put', 'copy.html'], { cwd: dir, env });
    assert.equal(again.json.action, 'new_version');
    assert.equal(again.json.id, put.json.id);

    const other = await run(['get', 'other-private'], { cwd: dir, env });
    assert.equal(other.code, 1);
    assert.equal(other.json.status, 404);
  });

  test('401: a wrong key is refused, and the key is never printed', async () => {
    const dir = project({ 'a.html': GOOD });
    const wrong = `ld_${'q'.repeat(40)}`;
    for (const args of [['put', 'a.html'], ['list'], ['get', 'x']]) {
      const r = await run(args, { cwd: dir, env: { ...env, LUDION_KEY: wrong } });
      assert.equal(r.code, 1);
      assert.equal(r.json.status, 401);
      assert.equal(r.json.error, 'unauthorized');
      assert.match(r.json.message, /\/account/);
      assert.equal(r.stdout.includes(wrong) || r.stderr.includes(wrong), false);
    }
    assert.equal(existsSync(path.join(dir, '.ludion.json')), false);
    // another person's key cannot add a version to my work
    const mine = await run(['put', 'a.html'], { cwd: dir, env });
    const r = await run(['put', 'a.html'], { cwd: dir, env: { ...env, LUDION_KEY: OTHER_KEY } });
    assert.equal(r.json.status, 404);
    assert.match(r.json.message, new RegExp(mine.json.id));
  });

  test('422: the server problems are passed through as they are', async () => {
    const dir = project({ 'a.html': GOOD.replace('</body>', '<script src="x.js"></script></body>') });
    // passes the local check (a data: URL is inside the file) but the server refuses <script src>
    const shaped = '<!doctype html><title>t</title><script src="data:text/javascript,1"></script><p>x</p>';
    writeFileSync(path.join(dir, 'c.html'), shaped);
    const r = await run(['put', 'c.html'], { cwd: dir, env });
    assert.equal(r.code, 1);
    assert.equal(r.json.status, 422);
    assert.equal(r.json.error, 'invalid_work');
    assert.deepEqual(r.json.problems, [{ message: '<script src> loads code from another file', fix: 'Put the JS inside <script> in the same file' }]);
    assert.equal(existsSync(path.join(dir, '.ludion.json')), false);
    // the local check stops a file that refers to another file, without calling the server
    const n = server.calls.length;
    const local = await run(['put', 'a.html'], { cwd: dir, env });
    assert.equal(local.json.error, 'check_failed');
    assert.equal(server.calls.length, n);
  });

  test('429: says when it can be used again', async () => {
    const limited = await startFakeServer({ putLimit: 1, readLimit: 1 });
    try {
      const dir = project({ 'a.html': GOOD, 'b.html': GOOD });
      const e = { ...env, LUDION_URL: limited.url };
      assert.equal((await run(['put', 'a.html'], { cwd: dir, env: e })).code, 0);
      const r = await run(['put', 'b.html'], { cwd: dir, env: e });
      assert.equal(r.code, 1);
      assert.equal(r.json.status, 429);
      assert.equal(r.json.error, 'rate_limited');
      assert.ok(Date.parse(r.json.retry_at) > Date.now());
      assert.match(r.json.message, /retry_at/);
      assert.equal((await run(['list'], { cwd: dir, env: e })).code, 0);
      assert.equal((await run(['list'], { cwd: dir, env: e })).json.status, 429);
    } finally {
      await limited.close();
    }
  });

  test('check: a good single file passes', async () => {
    const dir = project({ 'a.html': GOOD });
    const r = await run(['check', 'a.html'], { cwd: dir, env });
    assert.equal(r.code, 0, r.stdout);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.title, 'Ripple button');
    assert.deepEqual(r.json.problems, []);
    assert.deepEqual(r.json.render, { skipped: true, reason: 'LUDION_NO_BROWSER=1' });
  });

  test('check: lists outside URLs (not Google Fonts), other files, a missing title and size', async () => {
    const bad = `<!doctype html><html><head>
<link rel="stylesheet" href="https://cdn.example.com/x.css">
<link rel="stylesheet" href="styles.css">
<style>@import url(//cdn.example.org/y.css); .a{background:url(img/bg.png)} .b{background:url(data:image/png;base64,AAAA)}</style>
</head><body><img src="https://images.example.net/a.png"><img src="logo.svg"><a href="#">ok</a>
<a href="https://example.com/out">out</a>
<script>fetch('https://api.example.com/data')</script>
<!-- https://in-a-comment.example.com is fine -->
</body></html>`;
    const dir = project({ 'bad.html': bad, 'big.html': `<title>big</title><style>${'a{}'.repeat(100_000)}</style><p>x</p>` });
    const r = await run(['check', 'bad.html'], { cwd: dir, env });
    assert.equal(r.code, 1);
    const by = Object.fromEntries(r.json.problems.map((p) => [p.code, p]));
    assert.deepEqual(by.external_urls.urls.sort(), ['//cdn.example.org/y.css', 'https://api.example.com/data', 'https://cdn.example.com/x.css', 'https://example.com/out', 'https://images.example.net/a.png']);
    assert.deepEqual(by.local_files.files.sort(), ['img/bg.png', 'logo.svg', 'styles.css']);
    assert.ok(by.no_title);
    assert.ok(by.no_title.fix);
    const big = await run(['check', 'big.html'], { cwd: dir, env });
    assert.equal(big.json.problems[0].code, 'too_large');
    assert.match(big.json.problems[0].message, /CSS part is .*256KB/);
  });

  test('check: opens the page once in a browser when Playwright is there', async (t) => {
    const dir = project({
      'a.html': GOOD,
      'throws.html': '<!doctype html><title>t</title><p>x</p><script>throw new Error("boom")</script>',
      'empty.html': '<!doctype html><title>t</title><div style="display:none">x</div>',
    });
    const e = { ...env, LUDION_NO_BROWSER: '' };
    const good = await run(['check', 'a.html'], { cwd: dir, env: e });
    if (good.json.render.skipped) return t.skip(`browser check skipped: ${good.json.render.reason}`);
    assert.equal(good.code, 0, good.stdout);
    assert.equal(good.json.render.ok, true);
    const throws = await run(['check', 'throws.html'], { cwd: dir, env: e });
    assert.equal(throws.code, 1);
    assert.equal(throws.json.problems.at(-1).code, 'render_failed');
    assert.match(throws.json.render.errors.join(' '), /boom/);
    const empty = await run(['check', 'empty.html'], { cwd: dir, env: e });
    assert.equal(empty.json.render.rendered, false);
    assert.equal(empty.json.ok, false);
  });
});
