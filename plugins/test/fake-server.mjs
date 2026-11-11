// A fake Ludion that answers the T037 API contract (docs/tasks/T037.md "2"), for testing the skill before T037 lands.
//
//   node plugins/test/fake-server.mjs [--port 8787] [--dump <dir>]
//
// Prints { url, key } as JSON. With --dump, every accepted put is also written to <dir>/<id>-v<version>.html.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const TEST_KEY = `ld_${'a1B2c3D4e5'.repeat(4)}`;
export const OTHER_KEY = `ld_${'Z9y8X7w6V5'.repeat(4)}`;
const MAX_PART_BYTES = 256 * 1024;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const HOUR = 60 * 60 * 1000;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const randomToken = () => Array.from(randomBytes(40), (b) => ALPHABET[b % ALPHABET.length]).join('');

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
  /** OAuth (MCP001). deny: answer "Cancel" instead of "Allow". */
  const oauth = { clients: new Map(), codes: new Map(), refresh: new Map(), deny: false };
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
    calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, client: req.headers['x-ludion-client'] ?? null, body: raw });

    // OAuth (MCP001): register, authorize (allows at once, as if the person pressed "Allow"), token, revoke
    if (req.method === 'POST' && url.pathname === '/oauth/register') {
      const meta = JSON.parse(raw || '{}');
      const id = `client${++seq}`;
      oauth.clients.set(id, { name: meta.client_name, redirect_uris: meta.redirect_uris });
      return send(201, { client_id: id, client_name: meta.client_name, redirect_uris: meta.redirect_uris, token_endpoint_auth_method: 'none' });
    }
    if (req.method === 'GET' && url.pathname === '/oauth/authorize') {
      const q = url.searchParams;
      const client = oauth.clients.get(q.get('client_id'));
      if (!client || !client.redirect_uris.includes(q.get('redirect_uri'))) return send(400, { error: 'invalid_request' });
      const back = new URL(q.get('redirect_uri'));
      if (oauth.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = `code${++seq}`;
        oauth.codes.set(code, { client_id: q.get('client_id'), challenge: q.get('code_challenge'), redirect_uri: q.get('redirect_uri') });
        back.searchParams.set('code', code);
      }
      back.searchParams.set('state', q.get('state') ?? '');
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (req.method === 'POST' && url.pathname === '/oauth/token') {
      const q = new URLSearchParams(raw);
      const issue = () => {
        const access = `ldo_${randomToken()}`;
        const refresh = `ldr_${randomToken()}`;
        users.set(access, { id: 'u1', handle: 'me' });
        oauth.refresh.set(refresh, access);
        return send(200, { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600 });
      };
      if (q.get('grant_type') === 'authorization_code') {
        const saved = oauth.codes.get(q.get('code'));
        oauth.codes.delete(q.get('code'));
        const s256 = createHash('sha256').update(q.get('code_verifier') ?? '').digest('base64url');
        if (!saved || saved.challenge !== s256 || saved.redirect_uri !== q.get('redirect_uri')) return send(400, { error: 'invalid_grant' });
        return issue();
      }
      if (q.get('grant_type') === 'refresh_token') {
        const old = oauth.refresh.get(q.get('refresh_token'));
        if (!old) return send(400, { error: 'invalid_grant' });
        oauth.refresh.delete(q.get('refresh_token'));
        users.delete(old);
        return issue();
      }
      return send(400, { error: 'unsupported_grant_type' });
    }
    if (req.method === 'POST' && url.pathname === '/oauth/revoke') {
      const q = new URLSearchParams(raw);
      const access = oauth.refresh.get(q.get('token'));
      oauth.refresh.delete(q.get('token'));
      if (access) users.delete(access);
      res.writeHead(200).end();
      return undefined;
    }

    const code_ = /^\/p\/([^/]+)\/code$/.exec(url.pathname);
    if (req.method === 'GET' && code_) {
      const w = works.get(code_[1]);
      if (!w || w.visibility !== 'public') return send(404, { error: 'not_found', message: 'No such work' });
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(code(w));
    }
    if (!url.pathname.startsWith('/api/v1/')) return send(404, { error: 'not_found', message: 'Not found' });

    const m = /^Bearer (ldo?_[A-Za-z0-9]{40})$/.exec(req.headers.authorization ?? '');
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
      resolve({ url: base, works, calls, oauth, users, close: () => new Promise((r) => server.close(r)) });
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
