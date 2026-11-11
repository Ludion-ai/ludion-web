// 手元の偽の GitHub（docs/tasks/T009.md「1」）。テストと手元の確かめだけで使う。受け取った値は出力しない。
// 本物の道と同じ形：
// - GET  /login/oauth/authorize：画面を出さず、すぐに redirect_uri へ code を付けて戻す
// - POST /login/oauth/access_token：code をトークンに替える（1回だけ。違えば本物と同じく 200 で error）
// - GET  /user：トークンの本人のプロフィール（本物と同じく User-Agent がないと 403）
// だれとしてログインするかは、cookie fake_user か、クエリ login_as で選ぶ（既定は octo）。
// cookie fake_hold=1 のときは、すぐに戻さず、押すまで待つ画面を出す。
// テストのための道：GET /__tokens は、今までに出したトークンの一覧を返す（D1 に残っていないことを確かめるため）。
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { fakeGitHubId } from './migration-fixture.mjs';

const port = Number(process.env.LD_TEST_GITHUB_PORT ?? 4179);
const host = '127.0.0.1';

const codes = new Map();
const tokens = new Map();

/** 見える色のアバター（読み込めたかがスクリーンショットで分かるように）。 */
const AVATAR = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#2f6f5e"/><circle cx="48" cy="38" r="17" fill="#e8f3ef"/><ellipse cx="48" cy="86" rx="31" ry="27" fill="#e8f3ef"/></svg>';

const cookieOf = (request, name) =>
  (request.headers.cookie ?? '')
    .split(/;\s*/)
    .map((part) => part.split('='))
    .find(([key]) => key === name)?.[1];

/** login から決まるプロフィール。本物と同じく、持たないはずの情報（email など）も返す。 */
function profile(login, name) {
  return {
    id: fakeGitHubId(login),
    login,
    name: name === undefined ? `Name of ${login}` : name,
    avatar_url: `http://localhost:${port}/avatars/${encodeURIComponent(login)}.svg`,
    email: `${login}@private.example`,
    company: 'Should Not Be Stored Inc',
  };
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** 本物の認可の画面のように、押すまで待つ画面。戻る、2回押す、2つのタブを試すため。 */
function holdScreen(response, url) {
  const go = new URL(url);
  go.searchParams.set('go', '1');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html lang="ja"><meta charset="utf-8"><title>偽の GitHub</title><a id="go" href="${go.href.replace(/&/g, '&amp;')}">続ける</a></html>`);
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);

  if (request.method === 'GET' && url.pathname === '/login/oauth/authorize') {
    if (cookieOf(request, 'fake_hold') === '1' && !url.searchParams.has('go')) {
      holdScreen(response, url);
      return;
    }
    const back = new URL(url.searchParams.get('redirect_uri'));
    back.searchParams.set('state', url.searchParams.get('state') ?? '');
    if (cookieOf(request, 'fake_deny') === '1' || url.searchParams.get('deny') === '1') {
      back.searchParams.set('error', 'access_denied');
    } else {
      const login = decodeURIComponent(url.searchParams.get('login_as') ?? cookieOf(request, 'fake_user') ?? 'octo');
      const rawName = url.searchParams.get('name_as');
      const code = randomBytes(10).toString('hex');
      codes.set(code, { login, name: rawName ?? undefined, redirectUri: back.origin + back.pathname });
      back.searchParams.set('code', code);
    }
    response.writeHead(302, { Location: back.href });
    response.end();
    return;
  }

  if (request.method === 'POST' && url.pathname === '/login/oauth/access_token') {
    const body = JSON.parse((await readBody(request)) || '{}');
    const entry = codes.get(body.code);
    codes.delete(body.code);
    if (!entry || !body.client_id || !body.client_secret || body.redirect_uri !== entry.redirectUri) {
      json(response, 200, { error: 'bad_verification_code' });
      return;
    }
    const token = `gho_fake_${randomBytes(18).toString('hex')}`;
    tokens.set(token, entry);
    json(response, 200, { access_token: token, token_type: 'bearer', scope: '' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/user') {
    if (!request.headers['user-agent']) {
      json(response, 403, { message: 'User-Agent required' });
      return;
    }
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1];
    const entry = token && tokens.get(token);
    if (!entry) {
      json(response, 401, { message: 'Bad credentials' });
      return;
    }
    json(response, 200, profile(entry.login, entry.name));
    return;
  }

  if (request.method === 'GET' && url.pathname.startsWith('/avatars/')) {
    response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    response.end(AVATAR);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/__tokens') {
    json(response, 200, { tokens: [...tokens.keys()] });
    return;
  }

  json(response, 404, { message: 'Not Found' });
});

server.listen(port, host);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
