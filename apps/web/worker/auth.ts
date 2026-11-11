// GitHub のログイン（docs/tasks/T009.md「1」、SPEC.md「8」）。
// 公開のプロフィールだけを読む（scope なし）。GitHub のトークンは保存しない（プロフィールを読んだら捨てる）。
// 持つのは id、login、名前、アバターの URL だけ（CLAUDE.md 原則6）。
// 人の鍵は users.id。GitHub の id は identities にある手段の1つで、名前やメールの一致で別の手段と合わせない（SEC001 B2-1、B2-3）。

import { Hono, type Context } from 'hono';
import { startStateFlow, takeStateFlow, type FlowCookie } from './authFlow';
import { safeUrl } from './catalog';
import type { Env } from './env';
import { pickHandle } from './handle';
import { findIdentityUser } from './identities';
import { logError } from './log';
import { finishProviderLogin, loginFailedPage, loginPageWithError, parseIntent, safeNext, withError, type LoginIntent } from './loginFlow';
import { isSameOrigin } from './origin';
import { takeSignupQuota } from './quota';
import { endSession, getSessionUser, isRecentAuth, randomHex, startSession } from './session';


type AuthEnv = { Bindings: Env };

const GITHUB_FLOW: FlowCookie = { name: 'ld_github_flow', path: '/auth/github', kind: 'github', seconds: 10 * 60 };
/** 256ビット。 */
const STATE_BYTES = 32;
const GITHUB_TIMEOUT_MS = 10_000;

interface GitHubFlow {
  state: string;
  next: string;
  /** 何のためのログインか（loginFlow.ts）。login のほかは今のセッションの本人と合わせる。 */
  intent: LoginIntent;
}

/** GitHub の API は User-Agent のない要求を断る。 */
const USER_AGENT = 'ludion-web';
interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

async function githubJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GitHub が ${response.status} を返した（${new URL(url).pathname}）`);
  return (await response.json()) as Record<string, unknown>;
}

/** code をトークンに替え、本人のプロフィールを読む。トークンはこの関数の外に出さない。 */
async function readGitHubUser(env: Env, code: string, redirectUri: string): Promise<GitHubUser> {
  const exchange = await githubJson(`${env.GITHUB_WEB_URL}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (typeof exchange.access_token !== 'string') throw new Error('GitHub がトークンを返さなかった');

  const profile = await githubJson(`${env.GITHUB_API_URL}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${exchange.access_token}`,
      'User-Agent': USER_AGENT,
    },
  });
  if (typeof profile.id !== 'number' || typeof profile.login !== 'string') throw new Error('GitHub のプロフィールの形が違う');
  return {
    id: profile.id,
    login: profile.login,
    name: typeof profile.name === 'string' ? profile.name : null,
    avatar_url: typeof profile.avatar_url === 'string' ? safeUrl(profile.avatar_url) : null,
  };
}

/** この GitHub の人を新しく作る。同時に作られて先を越されたら、先にできた人を返す。 */
async function createGitHubUser(db: D1Database, user: GitHubUser, subject: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db
        .prepare('INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, await pickHandle(db, user.login), user.name, user.avatar_url, now),
      db
        .prepare(`INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES (?, 'github', ?, ?, ?, ?, ?)`)
        .bind(id, subject, user.login, user.avatar_url, now, now),
    ]);
    return id;
  } catch (error) {
    const winner = await findIdentityUser(db, 'github', subject);
    if (winner) return winner;
    throw error;
  }
}

const callbackUrl = (c: Context<AuthEnv>) => new URL('/auth/github/callback', c.req.url).href;

export const auth = new Hono<AuthEnv>();

auth.get('/github', async (c) => {
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret, GITHUB_WEB_URL: webUrl } = c.env;
  const next = safeNext(c.req.query('next'));
  if (!clientId || !clientSecret) return c.redirect(loginPageWithError(next, 'login_failed'));

  const intent = parseIntent(c.req.query('intent'));
  // 足すのは、直近のログインがあるときだけ。GitHub の画面へ行く前に断る
  if (intent === 'link') {
    const current = await getSessionUser(c);
    if (!current || !isRecentAuth(current)) return c.redirect(withError(next, 'reauth_required'));
  }

  const state = randomHex(STATE_BYTES);
  await startStateFlow<GitHubFlow, AuthEnv>(c, GITHUB_FLOW, { state, next, intent });

  const authorize = new URL('/login/oauth/authorize', webUrl);
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl(c));
  authorize.searchParams.set('state', state);
  return c.redirect(authorize.href);
});

auth.get('/github/callback', async (c) => {
  // state は1回だけ使う
  const result = await takeStateFlow<GitHubFlow, AuthEnv>(c, GITHUB_FLOW, c.req.query('state'));
  if (!result.taken) return c.redirect(loginPageWithError(result.retryNext, result.retryError));
  const { next, intent } = result.taken;
  // GitHub の画面で断られたとき。ふつうのログインはホームへ（/account へ戻すと、またログインの画面に送られる）、確かめ直しと足すのは元の画面へ戻す
  if (c.req.query('error')) return c.redirect(intent === 'login' ? '/' : withError(next, 'provider_denied'));
  const code = c.req.query('code');
  if (!code) return c.redirect(loginFailedPage(intent, next));

  let user: GitHubUser;
  try {
    user = await readGitHubUser(c.env, code, callbackUrl(c));
  } catch {
    logError('github_failed', { route: 'auth' });
    return c.redirect(loginFailedPage(intent, next));
  }
  const subject = String(user.id);
  return finishProviderLogin(c, { provider: 'github', subject, label: user.login, avatarUrl: user.avatar_url }, intent, next, async () => {
    // 新しい人を作る回数の上限（docs/tasks/T021.md）。ログインの画面で知らせる
    if (!(await takeSignupQuota(c.env, c.req.header('CF-Connecting-IP')))) {
      return c.redirect(loginPageWithError(next, 'signup_limited'));
    }
    await startSession(c, await createGitHubUser(c.env.DB, user, subject));
    return c.redirect(next);
  });
});

auth.post('/logout', async (c) => {
  if (!isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  await endSession(c);
  return c.body(null, 204);
});
