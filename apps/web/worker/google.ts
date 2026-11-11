// Google のログイン（docs/tasks/T020.md「6」）。認可コード ＋ PKCE ＋ state ＋ nonce。
// スコープは openid と profile だけ。メールは求めない。持つのは sub、名前、アバターの URL だけ（CLAUDE.md 原則6）。
// ID トークンの署名は jose で確かめる（自前で確かめない）。アクセストークンは保存しない。

import { Hono, type Context } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { startStateFlow, takeStateFlow, type FlowCookie } from './authFlow';
import { safeUrl } from './catalog';
import type { Env } from './env';
import { logError } from './log';
import { finishProviderLogin, loginFailedPage, loginPageWithError, parseIntent, safeNext, withError, type LoginIntent } from './loginFlow';
import { isGoogleAvailable } from './methods';
import { getSessionUser, isRecentAuth, randomHex } from './session';
import { startSignup } from './signup';

type GoogleEnv = { Bindings: Env };

const SCOPE = 'openid profile';
const FLOW_SECONDS = 10 * 60;
const GOOGLE_FLOW: FlowCookie = { name: 'ld_google_flow', path: '/auth/google', kind: 'google', seconds: FLOW_SECONDS };
const RANDOM_BYTES = 32;
const GOOGLE_TIMEOUT_MS = 10_000;

interface GoogleFlow {
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  intent: LoginIntent;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const randomBase64url = () => base64url(crypto.getRandomValues(new Uint8Array(RANDOM_BYTES)));

async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

const callbackUrl = (c: Context<GoogleEnv>) => new URL('/auth/google/callback', c.req.url).href;

interface GoogleUser {
  subject: string;
  name: string | null;
  avatarUrl: string | null;
}

/** code を ID トークンに替え、確かめて、本人の情報を返す。トークンはこの関数の外に出さない。 */
async function readGoogleUser(c: Context<GoogleEnv>, code: string, flow: GoogleFlow): Promise<GoogleUser> {
  const env = c.env;
  const clientId = env.GOOGLE_CLIENT_ID!;
  const response = await fetch(env.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: callbackUrl(c),
      code_verifier: flow.verifier,
    }),
    signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('Google がトークンを返さなかった');
  const { id_token: idToken } = (await response.json()) as { id_token?: unknown };
  if (typeof idToken !== 'string') throw new Error('Google が ID トークンを返さなかった');

  const issuer = env.GOOGLE_ISSUER;
  // jwtVerify が、署名、iss、aud、exp を確かめる。Google の iss は https:// のあるものとないものの2つ（Google の説明書）
  const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(env.GOOGLE_JWKS_URL)), {
    issuer: [issuer, issuer.replace(/^https?:\/\//, '')],
    audience: clientId,
    algorithms: ['RS256'],
  });
  if (payload.nonce !== flow.nonce) throw new Error('nonce が違う');
  if (payload.azp !== undefined && payload.azp !== clientId) throw new Error('azp が違う');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('sub がない');
  return {
    subject: payload.sub,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : null,
    avatarUrl: typeof payload.picture === 'string' ? safeUrl(payload.picture) : null,
  };
}

export const google = new Hono<GoogleEnv>();

google.get('/', async (c) => {
  const next = safeNext(c.req.query('next'));
  if (!isGoogleAvailable(c.env, c.req.url)) return c.redirect(loginPageWithError(next, 'login_failed'));
  const intent = parseIntent(c.req.query('intent'));
  // 足すのは、直近のログインがあるときだけ。Google の画面へ行く前に断る
  if (intent === 'link') {
    const current = await getSessionUser(c);
    if (!current || !isRecentAuth(current)) return c.redirect(withError(next, 'reauth_required'));
  }

  const flow: GoogleFlow = { state: randomHex(RANDOM_BYTES), nonce: randomHex(RANDOM_BYTES), verifier: randomBase64url(), next, intent };
  await startStateFlow<GoogleFlow, GoogleEnv>(c, GOOGLE_FLOW, flow);

  const authorize = new URL(c.env.GOOGLE_AUTH_URL);
  authorize.searchParams.set('client_id', c.env.GOOGLE_CLIENT_ID!);
  authorize.searchParams.set('redirect_uri', callbackUrl(c));
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('state', flow.state);
  authorize.searchParams.set('nonce', flow.nonce);
  authorize.searchParams.set('code_challenge', await pkceChallenge(flow.verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('prompt', 'select_account');
  return c.redirect(authorize.href);
});

google.get('/callback', async (c) => {
  // 途中の状態は1回だけ使う
  const result = await takeStateFlow<GoogleFlow, GoogleEnv>(c, GOOGLE_FLOW, c.req.query('state'));
  if (!result.taken) return c.redirect(loginPageWithError(result.retryNext, result.retryError));
  const flow = result.taken;
  // Google の画面で断られたとき。ふつうのログインはホームへ、確かめ直しと足すのは元の画面へ戻す
  if (c.req.query('error')) return c.redirect(flow.intent === 'login' ? '/' : withError(flow.next, 'provider_denied'));
  const code = c.req.query('code');
  if (!code) return c.redirect(loginFailedPage(flow.intent, flow.next));

  let user: GoogleUser;
  try {
    user = await readGoogleUser(c, code, flow);
  } catch {
    logError('google_failed', { route: 'auth' });
    return c.redirect(loginFailedPage(flow.intent, flow.next));
  }
  return finishProviderLogin(c, { provider: 'google', subject: user.subject, label: user.name, avatarUrl: user.avatarUrl }, flow.intent, flow.next, () =>
    startSignup(c, { provider: 'google', subject: user.subject, name: user.name, avatarUrl: user.avatarUrl, next: flow.next }),
  );
});
