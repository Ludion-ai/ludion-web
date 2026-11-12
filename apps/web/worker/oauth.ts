// AI につなぐ（MCP001「1」）。Ludion の MCP サーバー（/mcp）のための OAuth 2.1 の認可サーバー。
//
// - MCP の認可の決まり（https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization）に合わせる：
//   守る資源のメタデータ（RFC 9728）、認可サーバーのメタデータ（RFC 8414）、動的なクライアントの登録（RFC 7591）、
//   PKCE の S256 だけ、resource の値（RFC 8707）、トークンの取り消し（RFC 7009）。
// - 使う人は、AI の設定で https://ludion.ai/mcp を足し、Ludion にログインして「許可」を押すだけ。鍵をコピーさせない。
// - トークンの生の値は持たない。D1 にはハッシュだけ（AI の鍵と同じ考え。aiKeys.ts）。つながり（oauth_grants の行）を消せば、
//   アクセスのトークンもリフレッシュのトークンも、その場で使えなくなる（どの要求も D1 で確かめるため）。
// - 「許可」を押すと、その AI が置くものは、投稿の同意の3つ（自分のもの、MIT、利用規約）に同意したものとして扱う（AI の鍵と同じ）。
//   許可の画面に、その文を出す。
// - 回数の制限：許可の画面は人が開くので IP の束縛（LIMIT_AUTH）。登録とトークンは AI のサーバーから来る（多くの人が同じ IP を通る）。
//   登録は、IP の束縛（LIMIT_REGISTER、1分）と、IP の鍵ごとの1日の数を先に効かせ、全体の1日の数（quotas）は余裕を持たせる
//   （ひとりで全体を使い切らせない。LIMIT001。数は quotaLimits.ts）。トークンは IP では数えない。238 ビットの乱数なので、当てずっぽうでは当たらない。

import { Hono, type Context } from 'hono';
import type { Env } from './env';
import { isSameOrigin } from './origin';
import { takeRegisterQuota } from './quota';
import { getSessionUser, hashToken } from './session';

type OAuthContext = Context<{ Bindings: Env }>;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** アクセスのトークンの寿命。切れたら、AI がリフレッシュのトークンで取り直す。 */
export const ACCESS_TTL_MS = HOUR_MS;
/** リフレッシュのトークンの寿命。使うたびに作り直すので、180日使わなければ、つなぎ直す。 */
export const REFRESH_TTL_MS = 180 * DAY_MS;
/** 「許可」の後の証の寿命。 */
const CODE_TTL_MS = 10 * MINUTE_MS;
/**
 * ひとつ前のリフレッシュのトークンがまた来たとき、つながりを切らずに断るだけの間（OAUTH002）。
 * 同時に2本の更新を送る AI では、遅れた1本が、替えたばかりの前のトークンを持って来るため。これより後なら、盗まれた見込みとして切る。
 */
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;
/** 1人がつないでおける AI の数。超えたら、いちばん古いつながりから切る。 */
export const MAX_GRANTS_PER_USER = 20;
const MAX_CLIENT_NAME_CHARS = 60;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;
const MAX_STATE_LENGTH = 1000;
/** 一度もつながらなかった登録は、この日数で消す。 */
const UNUSED_CLIENT_DAYS = 7;
const MAX_FORM_BYTES = 64 * 1024;

const TOKEN_BODY_LENGTH = 40;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const ACCESS_PREFIX = 'ldo_';
const REFRESH_PREFIX = 'ldr_';
const CODE_PREFIX = 'ldc_';
const SECRET_PREFIX = 'lds_';
export const ACCESS_PATTERN = /^ldo_[A-Za-z0-9]{40}$/;
const REFRESH_PATTERN = /^ldr_[A-Za-z0-9]{40}$/;
const CODE_PATTERN = /^ldc_[A-Za-z0-9]{40}$/;
const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/;
/** PKCE の code_verifier（RFC 7636 4.1）。 */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

/** 62文字から偏りなく選んだ乱数（aiKeys.ts の generateKey と同じ作り方）。 */
export function randomToken(prefix: string): string {
  const out: string[] = [];
  while (out.length < TOKEN_BODY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(TOKEN_BODY_LENGTH * 2))) {
      if (byte >= 248) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === TOKEN_BODY_LENGTH) break;
    }
  }
  return `${prefix}${out.join('')}`;
}

const randomHexId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');

async function s256(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const startOfDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;

// ---------- 住所 ----------

export const issuerOf = (c: Context) => new URL(c.req.url).origin;
export const mcpResourceOf = (c: Context) => `${issuerOf(c)}/mcp`;
export const resourceMetadataUrl = (c: Context) => `${issuerOf(c)}/.well-known/oauth-protected-resource/mcp`;

/** resource（RFC 8707）は、この MCP サーバーだけ。書き方の揺れ（末尾の /、origin だけ）は受ける。 */
function isOurResource(c: Context, value: string | null | undefined): boolean {
  if (value === null || value === undefined || value === '') return true;
  const issuer = issuerOf(c);
  return value === issuer || value === `${issuer}/` || value === `${issuer}/mcp` || value === `${issuer}/mcp/`;
}

/** 応答の CORS。cookie を読まない口だけに付ける（ブラウザで動く MCP のクライアントのため）。 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

const preflight = () => new Response(null, { status: 204, headers: CORS_HEADERS });

// ---------- メタデータ ----------

export const wellKnown = new Hono<{ Bindings: Env }>();

const protectedResource = (c: OAuthContext) =>
  c.json(
    {
      resource: mcpResourceOf(c),
      authorization_servers: [issuerOf(c)],
      scopes_supported: ['works'],
      bearer_methods_supported: ['header'],
      resource_name: 'Ludion',
      resource_documentation: `${issuerOf(c)}/api/v1`,
    },
    200,
    CORS_HEADERS,
  );

const authorizationServer = (c: OAuthContext) => {
  const issuer = issuerOf(c);
  return c.json(
    {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['works'],
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${issuer}/api/v1`,
    },
    200,
    CORS_HEADERS,
  );
};

wellKnown.get('/oauth-protected-resource', protectedResource);
wellKnown.get('/oauth-protected-resource/mcp', protectedResource);
wellKnown.get('/oauth-authorization-server', authorizationServer);
// issuer に道を付けて探すクライアントのため（RFC 8414 3.1 の書き方で /mcp を足すもの）
wellKnown.get('/oauth-authorization-server/mcp', authorizationServer);
wellKnown.options('*', preflight);

// ---------- クライアント ----------

interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
}

/** AI のアプリの名前。制御文字を外し、1〜60文字。なければ「AI」。 */
export function cleanClientName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '';
  return name === '' ? 'AI' : [...name].slice(0, MAX_CLIENT_NAME_CHARS).join('').trim();
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
/** 戻り先にしてはいけない種類（ブラウザの中で動くもの、ファイル、平文の外の住所）。 */
const DENIED_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'filesystem:', 'ftp:', 'ws:', 'wss:', 'view-source:', 'chrome:', 'mailto:', 'tel:']);

/**
 * 戻り先（RFC 8252、OAuth 2.1 の 7.5）。https の住所、手元の http（localhost、127.0.0.1、[::1]）、アプリの独自の種類（cursor:// など）。
 * フラグメントは許さない。
 */
export function parseRedirectUri(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH || HAS_CONTROL.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hash !== '' || value.includes('#')) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (DENIED_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname) ? url : null;
  if (url.protocol === 'https:') return url.hostname !== '' ? url : null;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) ? url : null;
}

/** 登録した戻り先と合っているか。手元の http は、ポートだけ違ってよい（RFC 8252 7.3）。 */
function redirectMatches(registered: string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const asked = parseRedirectUri(requested);
  if (!asked || asked.protocol !== 'http:') return false;
  return registered.some((uri) => {
    const known = parseRedirectUri(uri);
    return known !== null && known.protocol === 'http:' && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
  });
}

async function findClient(db: D1Database, id: string | null | undefined): Promise<(ClientRow & { uris: string[] }) | null> {
  if (!id || !CLIENT_ID_PATTERN.test(id)) return null;
  const row = await db.prepare('SELECT id, name, redirect_uris, secret_hash FROM oauth_clients WHERE id = ?').bind(id).first<ClientRow>();
  return row ? { ...row, uris: JSON.parse(row.redirect_uris) as string[] } : null;
}

const oauthError = (c: OAuthContext, status: 400 | 401 | 403 | 404 | 429 | 503, error: string, description: string) =>
  c.json({ error, error_description: description }, status, { ...CORS_HEADERS, ...(status === 401 ? { 'WWW-Authenticate': 'Basic realm="ludion"' } : {}) });

export const oauth = new Hono<{ Bindings: Env }>();

oauth.options('/register', preflight);
oauth.options('/token', preflight);
oauth.options('/revoke', preflight);

/** 動的なクライアントの登録（RFC 7591）。名前と戻り先だけを持つ。秘密を求めたクライアントには、1回だけ秘密を返す。 */
oauth.post('/register', async (c) => {
  const db = c.env.DB;
  const raw = await readBodyText(c.req.raw);
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = raw === null ? null : (JSON.parse(raw) as unknown);
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body) return oauthError(c, 400, 'invalid_client_metadata', 'Send the client metadata as a JSON object.');
  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) return oauthError(c, 400, 'invalid_redirect_uri', `Send 1 to ${MAX_REDIRECT_URIS} redirect_uris.`);
  if (!uris.every((uri) => parseRedirectUri(uri) !== null)) return oauthError(c, 400, 'invalid_redirect_uri', 'Each redirect URI must be https, http on localhost, or an app scheme, without a fragment.');
  const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grantTypes) || !grantTypes.every((type) => type === 'authorization_code' || type === 'refresh_token')) {
    return oauthError(c, 400, 'invalid_client_metadata', 'Only authorization_code and refresh_token are supported.');
  }
  const responseTypes = body.response_types ?? ['code'];
  if (!Array.isArray(responseTypes) || !responseTypes.every((type) => type === 'code')) return oauthError(c, 400, 'invalid_client_metadata', 'Only the code response type is supported.');
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') {
    return oauthError(c, 400, 'invalid_client_metadata', 'token_endpoint_auth_method must be none, client_secret_post or client_secret_basic.');
  }

  const now = Date.now();
  // 登録は名前と戻り先だけで、人に結ばない
  if (!(await takeRegisterQuota(c.env, c.req.header('CF-Connecting-IP'), now))) {
    return oauthError(c, 429, 'temporarily_unavailable', 'Too many registrations today. Try again tomorrow.');
  }
  // 一度もつながらなかった古い登録を少し消す（登録は人に結ばないので、溜めない）
  await db
    .prepare(
      `DELETE FROM oauth_clients WHERE id IN (SELECT id FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_grants) LIMIT 50)`,
    )
    .bind(now - UNUSED_CLIENT_DAYS * DAY_MS)
    .run();

  const id = randomHexId();
  const name = cleanClientName(body.client_name);
  const secret = method === 'none' ? null : randomToken(SECRET_PREFIX);
  await db
    .prepare('INSERT INTO oauth_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, name, JSON.stringify(uris), secret ? await hashToken(secret) : null, now)
    .run();
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(now / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      scope: 'works',
    },
    201,
    CORS_HEADERS,
  );
});

// ---------- 許可の画面 ----------

interface AuthorizeRequest {
  client: ClientRow & { uris: string[] };
  redirectUri: string;
  state: string | null;
  challenge: string;
}

type Parsed = { ok: true; request: AuthorizeRequest } | { ok: false; redirect: string | null; error: string; description: string };

/** 許可の求めを確かめる。クライアントと戻り先が正しいときだけ、戻り先へエラーを返せる。 */
async function parseAuthorize(c: OAuthContext, params: URLSearchParams): Promise<Parsed> {
  const client = await findClient(c.env.DB, params.get('client_id'));
  if (!client) return { ok: false, redirect: null, error: 'invalid_client', description: 'unknown_client' };
  const asked = params.get('redirect_uri');
  const redirectUri = asked ?? (client.uris.length === 1 ? client.uris[0] : null);
  if (!redirectUri || !redirectMatches(client.uris, redirectUri) || !parseRedirectUri(redirectUri)) {
    return { ok: false, redirect: null, error: 'invalid_request', description: 'bad_redirect' };
  }
  const state = params.get('state');
  const back = (error: string, description: string): Parsed => ({ ok: false, redirect: withParams(redirectUri, { error, error_description: description, ...(state ? { state } : {}), iss: issuerOf(c) }), error, description });
  if (state !== null && state.length > MAX_STATE_LENGTH) return back('invalid_request', 'state is too long');
  if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  const challenge = params.get('code_challenge');
  if (!challenge || !CHALLENGE_PATTERN.test(challenge)) return back('invalid_request', 'PKCE code_challenge (S256) is required.');
  if (params.get('code_challenge_method') !== 'S256') return back('invalid_request', 'code_challenge_method must be S256.');
  if (!isOurResource(c, params.get('resource'))) return back('invalid_target', 'The resource must be this MCP server.');
  return { ok: true, request: { client, redirectUri, state, challenge } };
}

function withParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

type Locale = 'ja' | 'en';
const localeOf = (c: OAuthContext): Locale => (/^\s*ja\b/i.test(c.req.header('Accept-Language') ?? '') ? 'ja' : 'en');

const TEXT = {
  ja: {
    title: 'AI につなぐ · Ludion',
    heading: (name: string) => `${name} を Ludion につなぎますか`,
    as: (handle: string) => `@${handle} としてつなぎます。`,
    can: 'つなぐと、この AI は次のことができます。',
    items: ['作った HTML を、あなたの置き場に「自分だけ」で置く（新しい版も）', 'あなたの作品の一覧とコードを読む'],
    cannot: '公開はできません。公開は、今までどおりあなたがサイトで押します（審査があります）。',
    agree: (terms: string) => `この AI が置く作品は、全部、あなたが作った（または権利がある）もので、MIT で公開してよく、${terms}に同意したものとして扱います。`,
    terms: '利用規約',
    back: (host: string) => `許可すると ${host} に戻ります。`,
    allow: '許可する',
    deny: 'やめる',
    later: 'つないだ AI は、アカウントの「AI につなぐ」でいつでも切れます。',
    errorTitle: 'つなげませんでした · Ludion',
    errorHeading: 'つなげませんでした',
    errors: {
      unknown_client: 'この AI の登録が見つかりません。AI の設定から、もう一度つないでください。',
      bad_redirect: '戻り先が登録と合いません。AI の設定から、もう一度つないでください。',
      bad_origin: '送り元を確かめられませんでした。AI の設定から、もう一度つないでください。',
    } as Record<string, string>,
  },
  en: {
    title: 'Connect an AI · Ludion',
    heading: (name: string) => `Connect ${name} to Ludion?`,
    as: (handle: string) => `You’ll connect as @${handle}.`,
    can: 'Once connected, this AI can:',
    items: ['Put HTML it made into your works as “Only me” (and new versions)', 'Read the list and code of your works'],
    cannot: 'It can’t publish. You publish from the site yourself, as before (with review).',
    agree: (terms: string) => `Every work this AI puts is treated as your own (or one you have the rights to), published under MIT, and you agree to the ${terms}.`,
    terms: 'terms',
    back: (host: string) => `After you allow, you’ll go back to ${host}.`,
    allow: 'Allow',
    deny: 'Cancel',
    later: 'You can disconnect it any time under “Connect an AI” on your account page.',
    errorTitle: 'Couldn’t connect · Ludion',
    errorHeading: 'Couldn’t connect',
    errors: {
      unknown_client: 'We can’t find this AI’s registration. Connect again from the AI’s settings.',
      bad_redirect: 'The return address doesn’t match the registration. Connect again from the AI’s settings.',
      bad_origin: 'We couldn’t verify where this was sent from. Connect again from the AI’s settings.',
    } as Record<string, string>,
  },
};

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const PAGE_STYLE = `
:root{color-scheme:light dark;--bg:#ffffff;--fg:#111114;--fg2:#6b6b76;--line:#e4e4ea;--primary:#16161d;--on-primary:#ffffff;--field:#f5f5f7}
@media (prefers-color-scheme: dark){:root{--bg:#0f0f12;--fg:#ededf0;--fg2:#8e8e99;--line:#303037;--primary:#ededf0;--on-primary:#0f0f12;--field:#18181c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:480px;margin:0 auto;padding:48px 16px}
.mark{font-weight:800;letter-spacing:-0.02em;font-size:18px;margin:0 0 32px}
h1{font-size:22px;line-height:1.4;margin:0 0 8px;overflow-wrap:anywhere}
p{margin:8px 0}
.sub{color:var(--fg2);font-size:13px}
ul{margin:8px 0 16px;padding-left:20px}
.box{border:1px solid var(--line);border-radius:12px;padding:16px;margin:16px 0}
.buttons{display:flex;flex-direction:column;gap:8px;margin-top:24px}
button{height:44px;border-radius:10px;font:600 15px/1 inherit;cursor:pointer;width:100%}
.allow{background:var(--primary);color:var(--on-primary);border:0}
.deny{background:var(--bg);color:var(--fg);border:1px solid var(--line)}
a{color:inherit}
`;

/**
 * Referrer-Policy は same-origin。no-referrer だと、この画面の form の POST に Origin: null が付き、
 * POST /authorize の isSameOrigin で必ず断られる。same-origin なら、よそのサイトには参照元を出さず、自分への POST には Origin が付く。
 */
function page(c: OAuthContext, title: string, body: string, status: 200 | 400 = 200) {
  const locale = localeOf(c);
  return c.html(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style></head><body><main><p class="mark">Ludion</p>${body}</main></body></html>`,
    status,
    { 'Referrer-Policy': 'same-origin', 'X-Robots-Tag': 'noindex' },
  );
}

function errorPage(c: OAuthContext, code: string) {
  const text = TEXT[localeOf(c)];
  return page(c, text.errorTitle, `<h1>${escapeHtml(text.errorHeading)}</h1><p>${escapeHtml(text.errors[code] ?? text.errors.unknown_client)}</p>`, 400);
}

function hostOf(uri: string): string {
  const url = new URL(uri);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}`;
}

function consentPage(c: OAuthContext, request: AuthorizeRequest, handle: string, params: URLSearchParams) {
  const locale = localeOf(c);
  const text = TEXT[locale];
  const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
    .filter((name) => params.get(name) !== null)
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name)!)}">`)
    .join('');
  const name = escapeHtml(request.client.name);
  const terms = `<a href="${locale === 'ja' ? '/terms' : '/en/terms'}" target="_blank" rel="noopener">${escapeHtml(text.terms)}</a>`;
  return page(
    c,
    text.title,
    `<h1>${escapeHtml(text.heading(request.client.name)).replace(escapeHtml(request.client.name), `<span data-client-name>${name}</span>`)}</h1>
<p class="sub">${escapeHtml(text.as(handle))}</p>
<div class="box"><p>${escapeHtml(text.can)}</p><ul>${text.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul><p>${escapeHtml(text.cannot)}</p></div>
<p class="sub">${text.agree(terms).replace(/&(?![a-z#0-9]+;)/g, '&amp;')}</p>
<p class="sub">${escapeHtml(text.back(hostOf(request.redirectUri)))}</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="buttons"><button class="allow" type="submit" name="decision" value="allow">${escapeHtml(text.allow)}</button><button class="deny" type="submit" name="decision" value="deny">${escapeHtml(text.deny)}</button></div></form>
<p class="sub">${escapeHtml(text.later)}</p>`,
  );
}

/** 許可の画面。ログインしていなければ、ログインしてからここへ戻す。 */
oauth.get('/authorize', async (c) => {
  const params = new URL(c.req.url).searchParams;
  const parsed = await parseAuthorize(c, params);
  if (!parsed.ok) return parsed.redirect ? c.redirect(parsed.redirect) : errorPage(c, parsed.description);
  const user = await getSessionUser(c);
  if (!user) {
    const next = `/oauth/authorize?${params.toString()}`;
    const login = localeOf(c) === 'ja' ? '/login' : '/en/login';
    return c.redirect(`${login}?next=${encodeURIComponent(next)}`);
  }
  return consentPage(c, parsed.request, user.handle, params);
});

/** 「許可する」か「やめる」。自分のサイトの画面から送られたときだけ受ける。 */
oauth.post('/authorize', async (c) => {
  if (!isSameOrigin(c)) return errorPage(c, 'bad_origin');
  const raw = await readBodyText(c.req.raw);
  if (raw === null) return errorPage(c, 'unknown_client');
  const params = new URLSearchParams(raw);
  const parsed = await parseAuthorize(c, params);
  if (!parsed.ok) return parsed.redirect ? c.redirect(parsed.redirect) : errorPage(c, parsed.description);
  const { request } = parsed;
  const user = await getSessionUser(c);
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params.toString()}`)}`);
  const iss = issuerOf(c);
  const state: Record<string, string> = request.state ? { state: request.state } : {};
  if (params.get('decision') !== 'allow') return c.redirect(withParams(request.redirectUri, { error: 'access_denied', ...state, iss }));

  const db = c.env.DB;
  const now = Date.now();
  const code = randomToken(CODE_PREFIX);
  await db.batch([
    db.prepare('DELETE FROM oauth_codes WHERE code_hash IN (SELECT code_hash FROM oauth_codes WHERE expires_at <= ? LIMIT 50)').bind(now),
    db
      .prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await hashToken(code), request.client.id, user.id, request.redirectUri, request.challenge, now + CODE_TTL_MS),
  ]);
  return c.redirect(withParams(request.redirectUri, { code, ...state, iss }));
});

// ---------- トークン ----------

async function readBodyText(request: Request): Promise<string | null> {
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_FORM_BYTES) return null;
  const text = await request.text().catch(() => null);
  return text !== null && text.length <= MAX_FORM_BYTES ? text : null;
}

/** トークンの口の本文。ふつうはフォームの形。JSON でも受ける。 */
async function readTokenParams(c: OAuthContext): Promise<URLSearchParams | null> {
  const raw = await readBodyText(c.req.raw);
  if (raw === null) return null;
  if (/^application\/json\b/i.test(c.req.header('Content-Type') ?? '')) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) if (typeof value === 'string') params.set(key, value);
      return params;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw);
}

/** クライアントを確かめる。秘密を持つクライアントは、秘密が合うときだけ。 */
async function authenticateClient(c: OAuthContext, params: URLSearchParams): Promise<(ClientRow & { uris: string[] }) | null> {
  let id = params.get('client_id');
  let secret = params.get('client_secret');
  const basic = /^Basic\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '');
  if (basic) {
    try {
      const [user, pass] = atob(basic[1]).split(':');
      id = decodeURIComponent(user);
      secret = decodeURIComponent(pass ?? '');
    } catch {
      return null;
    }
  }
  const client = await findClient(c.env.DB, id);
  if (!client) return null;
  if (client.secret_hash !== null && (!secret || (await hashToken(secret)) !== client.secret_hash)) return null;
  return client;
}

function tokenResponse(c: OAuthContext, access: string, refresh: string) {
  return c.json(
    { access_token: access, token_type: 'Bearer', expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope: 'works' },
    200,
    { ...CORS_HEADERS, Pragma: 'no-cache' },
  );
}

oauth.post('/token', async (c) => {
  const db = c.env.DB;
  const params = await readTokenParams(c);
  if (!params) return oauthError(c, 400, 'invalid_request', 'Send the token request as a form.');
  const client = await authenticateClient(c, params);
  if (!client) return oauthError(c, 401, 'invalid_client', 'Unknown client or wrong client secret.');
  if (!isOurResource(c, params.get('resource'))) return oauthError(c, 400, 'invalid_target', 'The resource must be this MCP server.');
  const now = Date.now();
  const grantType = params.get('grant_type');

  if (grantType === 'authorization_code') {
    const code = params.get('code') ?? '';
    const verifier = params.get('code_verifier') ?? '';
    if (!CODE_PATTERN.test(code)) return oauthError(c, 400, 'invalid_grant', 'The code is wrong or expired.');
    if (!VERIFIER_PATTERN.test(verifier)) return oauthError(c, 400, 'invalid_grant', 'PKCE code_verifier is required.');
    // 1回だけ使える：消しながら読む。2回目は見つからない
    const row = await db
      .prepare('DELETE FROM oauth_codes WHERE code_hash = ? RETURNING client_id, user_id, redirect_uri, code_challenge, expires_at')
      .bind(await hashToken(code))
      .first<{ client_id: string; user_id: string; redirect_uri: string; code_challenge: string; expires_at: number }>();
    if (!row || row.client_id !== client.id || row.expires_at <= now) return oauthError(c, 400, 'invalid_grant', 'The code is wrong or expired.');
    // redirect_uri は、送られたときだけ比べる。OAuth 2.1 はトークンの口から外した（証は PKCE の S256 で、この AI に結んでいる）
    const redirect = params.get('redirect_uri');
    if (redirect !== null && redirect !== row.redirect_uri) return oauthError(c, 400, 'invalid_grant', 'redirect_uri does not match.');
    if ((await s256(verifier)) !== row.code_challenge) return oauthError(c, 400, 'invalid_grant', 'PKCE verification failed.');
    if (!(await db.prepare('SELECT 1 FROM users WHERE id = ?').bind(row.user_id).first())) return oauthError(c, 400, 'invalid_grant', 'The account no longer exists.');

    const access = randomToken(ACCESS_PREFIX);
    const refresh = randomToken(REFRESH_PREFIX);
    await db.batch([
      db
        .prepare(
          `INSERT INTO oauth_grants (id, user_id, client_id, client_name, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at, last_used_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(randomHexId(), row.user_id, client.id, client.name, await hashToken(access), now + ACCESS_TTL_MS, await hashToken(refresh), now + REFRESH_TTL_MS, now, startOfDay(now)),
      // 切れたつながりと、上限を超えたつながり（古いものから）を消す
      db.prepare('DELETE FROM oauth_grants WHERE user_id = ? AND refresh_expires_at <= ?').bind(row.user_id, now),
      db
        .prepare(`DELETE FROM oauth_grants WHERE user_id = ?1 AND id NOT IN (SELECT id FROM oauth_grants WHERE user_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2)`)
        .bind(row.user_id, MAX_GRANTS_PER_USER),
    ]);
    return tokenResponse(c, access, refresh);
  }

  if (grantType === 'refresh_token') {
    const refresh = params.get('refresh_token') ?? '';
    if (!REFRESH_PATTERN.test(refresh)) return oauthError(c, 400, 'invalid_grant', 'The refresh token is wrong, expired, or revoked.');
    const access = randomToken(ACCESS_PREFIX);
    const next = randomToken(REFRESH_PREFIX);
    const refreshHash = await hashToken(refresh);
    // 作り直す。前のリフレッシュのトークンは、この文で使えなくなる。そのハッシュと替えた時刻を、ひとつ前として残す
    const updated = await db
      .prepare(
        `UPDATE oauth_grants SET access_hash = ?1, access_expires_at = ?2, refresh_hash = ?3, refresh_expires_at = ?4, prev_refresh_hash = ?5, refresh_rotated_at = ?7
         WHERE refresh_hash = ?5 AND client_id = ?6 AND refresh_expires_at > ?7`,
      )
      .bind(await hashToken(access), now + ACCESS_TTL_MS, await hashToken(next), now + REFRESH_TTL_MS, refreshHash, client.id, now)
      .run();
    if (updated.meta.changes === 0) {
      // ひとつ前のトークンがまた来た：替えてから30秒より後なら、そのつながりを消す（OAuth 2.1 の 4.3.1）。30秒以内は断るだけ
      await db
        .prepare('DELETE FROM oauth_grants WHERE prev_refresh_hash = ?1 AND client_id = ?2 AND refresh_rotated_at < ?3')
        .bind(refreshHash, client.id, now - REFRESH_REUSE_GRACE_MS)
        .run();
      return oauthError(c, 400, 'invalid_grant', 'The refresh token is wrong, expired, or revoked.');
    }
    return tokenResponse(c, access, next);
  }

  return oauthError(c, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
});

/** トークンの取り消し（RFC 7009）。どちらのトークンでも、つながりごと切る。知らないトークンでも 200。 */
oauth.post('/revoke', async (c) => {
  const params = await readTokenParams(c);
  if (!params) return oauthError(c, 400, 'invalid_request', 'Send the token as a form.');
  const client = await authenticateClient(c, params);
  if (!client) return oauthError(c, 401, 'invalid_client', 'Unknown client or wrong client secret.');
  const token = params.get('token') ?? '';
  if (ACCESS_PATTERN.test(token) || REFRESH_PATTERN.test(token)) {
    const hash = await hashToken(token);
    await c.env.DB.prepare('DELETE FROM oauth_grants WHERE client_id = ?1 AND (access_hash = ?2 OR refresh_hash = ?2)').bind(client.id, hash).run();
  }
  return c.body(null, 200, CORS_HEADERS);
});

// ---------- つながり ----------

export interface GrantUser {
  id: string;
  handle: string;
  isOperator: boolean;
  grantId: string;
  clientName: string;
}

/** アクセスのトークンの持ち主。形が違う、ない、切れた、切ったつながりなら null。最後に使った日は、日が変わったときだけ書く。 */
export async function grantUser(db: D1Database, token: string, now = Date.now()): Promise<GrantUser | null> {
  if (!ACCESS_PATTERN.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT g.id AS grant_id, g.client_name, g.last_used_at, u.id, u.handle, u.is_operator FROM oauth_grants g JOIN users u ON u.id = g.user_id
       WHERE g.access_hash = ? AND g.access_expires_at > ?`,
    )
    .bind(await hashToken(token), now)
    .first<{ grant_id: string; client_name: string; last_used_at: number | null; id: string; handle: string; is_operator: number }>();
  if (!row) return null;
  const today = startOfDay(now);
  if (row.last_used_at === null || row.last_used_at < today) await db.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').bind(today, row.grant_id).run();
  return { id: row.id, handle: row.handle, isOperator: row.is_operator === 1, grantId: row.grant_id, clientName: row.client_name };
}

export interface GrantRow {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

/** 本人のつながり。新しい順。切れたものは出さない。 */
export async function listGrants(db: D1Database, userId: string, now = Date.now()): Promise<GrantRow[]> {
  const { results } = await db
    .prepare('SELECT id, client_name AS name, created_at, last_used_at FROM oauth_grants WHERE user_id = ? AND refresh_expires_at > ? ORDER BY created_at DESC, rowid DESC')
    .bind(userId, now)
    .all<GrantRow>();
  return results;
}

/** つながりを切る。行を消すので、どちらのトークンもすぐ使えなくなる。 */
export async function revokeGrant(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM oauth_grants WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return result.meta.changes > 0;
}
