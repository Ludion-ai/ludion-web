// 新しい人を作る（docs/tasks/T020.md「6」）。手段で確かめた後、handle を選んでもらってから人を作る。
// 選ぶまでは D1 の途中の状態にだけ置き、users には入れない。

import { Hono, type Context } from 'hono';
import { localeOfPath, localizedPath } from '../src/i18n';
import { readFlow, startFlow, takeFlow, type FlowCookie } from './authFlow';
import type { Env } from './env';
import { checkHandle, suggestHandles } from './handle';
import { findIdentityUser, type Provider } from './identities';
import { isSameOrigin } from './origin';
import { takeSignupQuota } from './quota';
import { getSessionUser, startSession } from './session';

type SignupEnv = { Bindings: Env };

/** handle を選ぶ間の時間。 */
const SIGNUP_SECONDS = 10 * 60;
export const SIGNUP_FLOW: FlowCookie = { name: 'ld_signup', path: '/auth/signup', kind: 'signup', seconds: SIGNUP_SECONDS };

export interface PendingSignup {
  provider: Provider;
  subject: string;
  /** 手段の中の名前。表示の名前の始まりと、handle の候補に使う */
  name: string | null;
  avatarUrl: string | null;
  next: string;
}

/** 手段で確かめた新しい人を、handle を選ぶ画面へ送る。 */
export async function startSignup(c: Context<SignupEnv>, pending: PendingSignup): Promise<Response> {
  await startFlow(c, SIGNUP_FLOW, pending);
  return c.redirect(localizedPath(localeOfPath(new URL(pending.next, 'https://next.invalid').pathname), '/signup'));
}

export const signup = new Hono<SignupEnv>();

/** handle を選ぶ画面が読む。手段の中の名前と、handle の候補。 */
signup.get('/pending', async (c) => {
  const pending = await readFlow<PendingSignup, SignupEnv>(c, SIGNUP_FLOW);
  if (!pending) return c.json({ error: 'no_pending' }, 404);
  return c.json({ provider: pending.provider, name: pending.name, suggestions: await suggestHandles(c.env.DB, pending.name ?? '') });
});

/** handle を決めて人を作り、ログインした状態にする。 */
signup.post('/complete', async (c) => {
  if (!isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  const pending = await readFlow<PendingSignup, SignupEnv>(c, SIGNUP_FLOW);
  if (!pending) return c.json({ error: 'no_pending' }, 404);
  const body = (await c.req.json().catch(() => null)) as { handle?: unknown } | null;
  const handle = typeof body?.handle === 'string' ? body.handle.toLowerCase() : '';
  const db = c.env.DB;
  const status = await checkHandle(db, handle, null);
  if (status !== 'ok') return c.json({ error: 'handle_rejected', status }, 400);

  // 同じ手段の人が別のタブで先にできたときは、作らないので数えない
  if (!(await findIdentityUser(db, pending.provider, pending.subject)) && !(await takeSignupQuota(c.env, c.req.header('CF-Connecting-IP')))) {
    return c.json({ error: 'signup_limited' }, 429);
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  let userId = id;
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, handle, pending.name, pending.avatarUrl, now),
      db
        .prepare('INSERT INTO identities (user_id, provider, subject, label, avatar_url, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, pending.provider, pending.subject, pending.name, pending.avatarUrl, now, now),
    ]);
  } catch {
    // 同じ手段の人が別のタブで先にできたなら、その人としてログインする。そうでなければ、handle を先に取られた
    const winner = await findIdentityUser(db, pending.provider, pending.subject);
    if (!winner) return c.json({ error: 'handle_rejected', status: 'taken' }, 409);
    userId = winner;
  }
  await takeFlow(c, SIGNUP_FLOW);
  await startSession(c, userId);
  return c.json({ next: pending.next });
});

/** ログインしていない人でも使う handle の確かめ（新しく作る人のため）。回数の制限は app.ts。 */
export async function publicHandleCheck(c: Context<SignupEnv>): Promise<Response> {
  const handle = (c.req.query('handle') ?? '').toLowerCase();
  const user = await getSessionUser(c);
  return c.json({ status: await checkHandle(c.env.DB, handle, user?.id ?? null) });
}
