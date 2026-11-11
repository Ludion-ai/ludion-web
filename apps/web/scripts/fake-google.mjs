// 手元の偽の Google（docs/tasks/T020.md「6」）。テストと手元の確かめだけで使う。受け取った値は出力しない。
// 本物の道と同じ形：
// - GET  /o/oauth2/v2/auth：画面を出さず、すぐに redirect_uri へ code を付けて戻す。PKCE と nonce を覚える
// - POST /token：code を ID トークンに替える（1回だけ。PKCE を確かめる）
// - GET  /certs：公開鍵（JWKS）
// だれとしてログインするかは、cookie fake_google か、クエリ login_as で選ぶ（既定は octo）。
// クエリ tamper で、形の悪い ID トークンを返す（wrong_aud、wrong_iss、expired、wrong_nonce、bad_sig、alg_none、no_sub、wrong_azp）。
// cookie fake_hold=1 のときは、すぐに戻さず、押すまで待つ画面を出す。
// テストのための道：GET /__last は、最後に受けた認可の要求の値を返す（スコープを確かめるため）。
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.LD_TEST_GOOGLE_PORT ?? 4182);
const host = '127.0.0.1';
const issuer = `http://localhost:${port}`;
const KID = 'fake-google-key';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const codes = new Map();
let last = null;

const AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#3b5ba5"/><circle cx="48" cy="38" r="17" fill="#e8eef9"/><ellipse cx="48" cy="86" rx="31" ry="27" fill="#e8eef9"/></svg>';

const base64url = (value) => Buffer.from(value).toString('base64url');

function sign(header, claims, key) {
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  return `${body}.${signer.sign(key).toString('base64url')}`;
}

/** login から決まる番号と名前。 */
const subjectOf = (login) => `google-${createHash('sha256').update(login).digest('hex').slice(0, 21)}`;

function idToken(entry, clientId) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: clientId,
    azp: clientId,
    sub: subjectOf(entry.login),
    iat: now,
    exp: now + 3600,
    nonce: entry.nonce,
    name: entry.name === undefined ? `Name of ${entry.login}` : entry.name || undefined,
    picture: `http://localhost:${port}/avatars/${encodeURIComponent(entry.login)}.svg`,
    // 本物はスコープがなければ返さない。持たないことを確かめるため、ここでは返す
    email: `${entry.login}@private.example`,
    email_verified: true,
  };
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  switch (entry.tamper) {
    case 'wrong_aud':
      return sign(header, { ...claims, aud: 'someone-else' }, privateKey);
    case 'wrong_azp':
      return sign(header, { ...claims, azp: 'someone-else' }, privateKey);
    case 'wrong_iss':
      return sign(header, { ...claims, iss: 'https://evil.example' }, privateKey);
    case 'expired':
      return sign(header, { ...claims, iat: now - 7200, exp: now - 3600 }, privateKey);
    case 'wrong_nonce':
      return sign(header, { ...claims, nonce: 'not-the-nonce' }, privateKey);
    case 'no_sub':
      return sign(header, { ...claims, sub: undefined }, privateKey);
    case 'bad_sig':
      return sign(header, claims, other.privateKey);
    case 'alg_none':
      return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.`;
    default:
      return sign(header, claims, privateKey);
  }
}

const cookieOf = (request, name) =>
  (request.headers.cookie ?? '')
    .split(/;\s*/)
    .map((part) => part.split('='))
    .find(([key]) => key === name)?.[1];

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** 本物のアカウントの選択のように、押すまで待つ画面。戻る、2回押す、2つのタブを試すため。 */
function holdScreen(response, url) {
  const go = new URL(url);
  go.searchParams.set('go', '1');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>偽の Google</title><a id="go" href="${go.href.replace(/&/g, '&amp;')}">続ける</a></html>`);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, issuer);

  if (request.method === 'GET' && url.pathname === '/o/oauth2/v2/auth') {
    const query = url.searchParams;
    last = Object.fromEntries(query);
    const redirect = query.get('redirect_uri');
    if (!redirect || query.get('response_type') !== 'code' || !query.get('client_id') || query.get('code_challenge_method') !== 'S256' || !query.get('code_challenge') || !query.get('nonce') || !query.get('state')) {
      json(response, 400, { error: 'invalid_request' });
      return;
    }
    if (cookieOf(request, 'fake_hold') === '1' && !query.has('go')) {
      holdScreen(response, url);
      return;
    }
    const back = new URL(redirect);
    back.searchParams.set('state', query.get('state'));
    if (cookieOf(request, 'fake_google_deny') === '1' || query.get('deny') === '1') {
      back.searchParams.set('error', 'access_denied');
    } else {
      const login = decodeURIComponent(query.get('login_as') ?? cookieOf(request, 'fake_google') ?? 'octo');
      const code = randomBytes(10).toString('hex');
      codes.set(code, {
        login,
        name: query.get('name_as') ?? undefined,
        nonce: query.get('nonce'),
        challenge: query.get('code_challenge'),
        redirectUri: redirect,
        tamper: query.get('tamper') ?? undefined,
      });
      back.searchParams.set('code', code);
    }
    response.writeHead(302, { Location: back.href });
    response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/token') {
    const body = new URLSearchParams(await readBody(request));
    const entry = codes.get(body.get('code'));
    codes.delete(body.get('code'));
    const challenge = createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url');
    if (!entry || !body.get('client_id') || !body.get('client_secret') || body.get('grant_type') !== 'authorization_code' || body.get('redirect_uri') !== entry.redirectUri || challenge !== entry.challenge) {
      json(response, 400, { error: 'invalid_grant' });
      return;
    }
    json(response, 200, { access_token: `ya29.fake_${randomBytes(18).toString('hex')}`, token_type: 'Bearer', expires_in: 3599, scope: 'openid profile', id_token: idToken(entry, body.get('client_id')) });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/certs') {
    json(response, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] });
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/avatars/')) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(AVATAR);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/__last') {
    json(response, 200, last ?? {});
    return;
  }

  json(response, 404, { error: 'not_found' });
});

server.listen(port, host);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
