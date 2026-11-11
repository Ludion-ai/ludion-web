// A fake Ludion that answers the T037 API contract (docs/tasks/T037.md "2"), for testing the skill before T037 lands.
//
//   node skills/test/fake-server.mjs [--port 8787] [--dump <dir>]
//
// Prints { url, key } as JSON. With --dump, every accepted put is also written to <dir>/<id>-v<version>.html.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEST_KEY = `ld_${'a1B2c3D4e5'.repeat(4)}`;
export const OTHER_KEY = `ld_${'Z9y8X7w6V5'.repeat(4)}`;
const MAX_PART_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

function credit(handle, id) {
  return `<!-- UI by @${handle} — ludion.ai/p/${id} (MIT) -->`;
}

/** Removes credit lines the AI kept from a source work; the server writes them itself. */
function stripCredits(html) {
  return html.replace(/^(?:\s*<!--\s*(?:Remix of )?UI by @[^>]*-->\s*\n?)+/, '');
}

function problemsOf(html) {
  const problems = [];
  if (!/<[a-z][\s\S]*>/i.test(html)) problems.push({ message: 'No HTML element was found', fix: 'Paste the HTML of the UI' });
  if (/<script\b[^>]*\ssrc\s*=/i.test(html)) problems.push({ message: '<script src> loads code from another file', fix: 'Put the JS inside <script> in the same file' });
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('');
  if (Buffer.byteLength(css) > MAX_PART_BYTES) problems.push({ message: 'part.css is over the 256KB limit', fix: 'Make it smaller' });
  return problems;
}

function titleOf(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? m[1].trim() : '';
}

export function startFakeServer({ port = 0, putLimit = 30, readLimit = 300, dump } = {}) {
  const users = new Map([
    [TEST_KEY, { id: 'u1', handle: 'me' }],
    [OTHER_KEY, { id: 'u2', handle: 'other' }],
  ]);
  /** id → { id, owner, handle, title, visibility, status, versions: [html], from, updated_at } */
  const works = new Map();
  works.set('ripple-public', {
    id: 'ripple-public',
    owner: 'u2',
    handle: 'other',
    title: 'Public button',
    visibility: 'public',
    status: 'approved',
    versions: ['<!doctype html><title>Public button</title><button class="b">Hi</button><style>.b{color:red}</style>'],
    from: null,
    updated_at: new Date().toISOString(),
  });
  works.set('other-private', { ...works.get('ripple-public'), id: 'other-private', visibility: 'private', status: 'draft' });
  const calls = [];
  const quota = new Map();
  let seq = 0;
  let base = '';

  const takeQuota = (user, kind) => {
    const limit = kind === 'put' ? putLimit : readLimit;
    const k = `${user.id}:${kind}`;
    const now = Date.now();
    const q = quota.get(k) ?? { start: now, n: 0 };
    if (now - q.start >= HOUR) Object.assign(q, { start: now, n: 0 });
    q.n++;
    quota.set(k, q);
    return q.n > limit ? new Date(q.start + HOUR) : null;
  };

  const view = (w) => ({ id: w.id, version: w.versions.length, url: `${base}/p/${w.id}`, code_url: `${base}/p/${w.id}/code`, visibility: w.visibility });
  const code = (w) => {
    const lines = [credit(w.handle, w.id)];
    if (w.from) lines.push(`<!-- Remix of UI by @${works.get(w.from)?.handle ?? 'unknown'} — ludion.ai/p/${w.from} (MIT) -->`);
    return `${lines.join('\n')}\n${w.versions.at(-1)}`;
  };

  const server = createServer(async (req, res) => {
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BODY_BYTES) return send(413, { error: 'too_large', message: 'The body is over 4MB' });
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, body: raw });

    const code_ = /^\/p\/([^/]+)\/code$/.exec(url.pathname);
    if (req.method === 'GET' && code_) {
      const w = works.get(code_[1]);
      if (!w || w.visibility !== 'public') return send(404, { error: 'not_found', message: 'No such work' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(code(w));
    }
    if (!url.pathname.startsWith('/api/v1/')) return send(404, { error: 'not_found', message: 'Not found' });

    const m = /^Bearer (ld_[A-Za-z0-9]{40})$/.exec(req.headers.authorization ?? '');
    const user = m && users.get(m[1]);
    if (!user) return send(401, { error: 'unauthorized', message: 'The key is missing, wrong or deleted' });

    const isPut = req.method === 'POST';
    const retry = takeQuota(user, isPut ? 'put' : 'read');
    if (retry) {
      return send(429, { error: 'rate_limited', message: isPut ? 'You can put 30 times an hour' : 'You can read 300 times an hour', retry_at: retry.toISOString() }, { 'Retry-After': String(Math.ceil((retry - Date.now()) / 1000)) });
    }

    let body = {};
    if (isPut) {
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: 'bad_json', message: 'The body is not JSON' });
      }
      if (typeof body.html !== 'string') return send(400, { error: 'bad_request', message: 'html must be a string' });
      const problems = problemsOf(body.html);
      if (problems.length) return send(422, { error: 'invalid_work', message: 'The work does not have the right shape', problems });
    }
    const html = isPut ? stripCredits(body.html) : '';
    const title = isPut ? (typeof body.title === 'string' && body.title.trim()) || titleOf(html) || 'Untitled' : '';
    const done = (w) => {
      if (dump) {
        mkdirSync(dump, { recursive: true });
        writeFileSync(path.join(dump, `${w.id}-v${w.versions.length}.html`), w.versions.at(-1));
      }
      return send(201, view(w));
    };

    if (req.method === 'POST' && url.pathname === '/api/v1/works') {
      if (body.from !== undefined) {
        const src = works.get(body.from);
        if (!src || src.visibility !== 'public') return send(422, { error: 'bad_from', message: 'The source work does not exist or is not public' });
      }
      const id = `w${++seq}-${Math.random().toString(16).slice(2, 8)}`;
      const w = { id, owner: user.id, handle: user.handle, title, visibility: 'draft', status: 'draft', versions: [html], from: body.from ?? null, updated_at: new Date().toISOString() };
      works.set(id, w);
      return done(w);
    }
    const one = /^\/api\/v1\/works\/([^/]+)(\/versions)?$/.exec(url.pathname);
    const w = one && works.get(decodeURIComponent(one[1]));
    if (one && (!w || w.owner !== user.id)) return send(404, { error: 'not_found', message: 'No such work of yours' });
    if (req.method === 'POST' && one?.[2]) {
      w.versions.push(html);
      w.title = title;
      w.updated_at = new Date().toISOString();
      return done(w);
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/works') {
      const mine = [...works.values()].filter((x) => x.owner === user.id);
      return send(200, { works: mine.map((x) => ({ id: x.id, title: x.title, visibility: x.visibility, status: x.status, version: x.versions.length, updated_at: x.updated_at, url: `${base}/p/${x.id}` })) });
    }
    if (req.method === 'GET' && one && !one[2]) {
      return send(200, { id: w.id, title: w.title, visibility: w.visibility, status: w.status, version: w.versions.length, from: w.from, url: `${base}/p/${w.id}`, code: code(w) });
    }
    return send(404, { error: 'not_found', message: 'Not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve({ url: base, works, calls, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const s = await startFakeServer({ port: Number(arg('--port') ?? 8787), dump: arg('--dump') });
  console.log(JSON.stringify({ url: s.url, key: TEST_KEY }));
}
