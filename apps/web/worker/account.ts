// アカウントのページの API（docs/tasks/T020.md「2」「3」）。全部ログインが要る。
// 状態を変える要求は Origin を確かめる。回数の制限は app.ts。
// 退会と手段の足し引きは、直近10分以内のログインを求める（SEC001 B2-3、B2-5）。

import { Hono, type Context } from 'hono';
import { createAiKey, deleteAiKey, listAiKeys, MAX_KEYS_PER_USER, parseKeyName } from './aiKeys';
import { apiQuotaKeys } from './quota';
import { CATALOG_TAG, workTag } from './cachePolicy';
import { listCreatorWorks } from './catalog';
import type { Env } from './env';
import { isGoogleAvailable, isPasskeyAvailable } from './methods';
import { generateRecoveryCode, hashRecoveryCode } from './recoveryCode';
import { checkHandle, HANDLE_HOLD_MS } from './handle';
import { listIdentities, type Provider } from './identities';
import { isSameOrigin } from './origin';
import { parseProfile } from './profile';
import { purgeWithRetry } from './purge';
import { clearSessionCookie, getSessionUser, isRecentAuth, sessionId, startSession, type SessionUser } from './session';

type AccountEnv = { Bindings: Env; Variables: { user: SessionUser } };
type AccountContext = Context<AccountEnv>;

/** 取り下げの理由。人には見せない（reject_reason の決まった値）。 */
const REASON_ACCOUNT_DELETED = 'account_deleted';
const MAX_JSON_BYTES = 4096;

export const account = new Hono<AccountEnv>();

const purge = (c: AccountContext, tags: string[]) => purgeWithRetry((c.executionCtx as unknown as ExecutionContext).cache, tags);

async function readJson(c: AccountContext): Promise<Record<string, unknown> | null> {
  if (Number(c.req.header('Content-Length') ?? '0') > MAX_JSON_BYTES) return null;
  const body = (await c.req.json().catch(() => null)) as unknown;
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

account.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

/** 本人の情報を全部。HTML には入れない（SPEC.md「10」）。 */
account.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const [profile, sessions, works, passkeys, recovery] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT handle, display_name, avatar_url, x_url, site_url FROM users WHERE id = ?').bind(user.id),
    db.prepare('SELECT token_hash, created_at, last_used_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC, created_at DESC').bind(user.id, Date.now()),
    db
      .prepare(`SELECT COUNT(*) AS n FROM works w JOIN creators c ON c.id = w.creator_id WHERE c.user_id = ? AND w.status = 'approved'`)
      .bind(user.id),
    db.prepare('SELECT credential_id AS id, label, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at').bind(user.id),
    db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ?').bind(user.id),
  ]);
  const [identities, aiKeys] = await Promise.all([listIdentities(db, user.id), listAiKeys(db, user.id)]);
  return c.json({
    profile: profile.results[0],
    identities: identities.map(({ provider, label, created_at, last_used_at }) => ({ provider, label, created_at, last_used_at })),
    sessions: (sessions.results as { token_hash: string; created_at: number; last_used_at: number }[]).map((row) => ({
      id: sessionId(row.token_hash),
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      current: row.token_hash === user.tokenHash,
    })),
    passkeys: passkeys.results,
    has_recovery_code: Number(recovery.results[0].n) > 0,
    ai_keys: aiKeys,
    works_count: works.results[0].n,
    recent_auth: isRecentAuth(user),
    available: { google: isGoogleAvailable(c.env, c.req.url), passkey: isPasskeyAvailable(c.env, c.req.url) },
  });
});

/** 自分に結ばれた作者の、承認済みの作品。 */
account.get('/works', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare('SELECT id FROM creators WHERE user_id = ? ORDER BY created_at').bind(c.get('user').id).all<{ id: string }>();
  const lists = await Promise.all(results.map(({ id }) => listCreatorWorks(db, id)));
  return c.json({ works: lists.flat() });
});

/** プロフィールを変える。作り手のページに出る項目は、結ばれた作者にも写す。 */
account.post('/profile', async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'bad_request' }, 400);
  const parsed = parseProfile(body);
  if (!parsed.ok) return c.json({ error: 'invalid', field: parsed.field }, 400);
  const { display_name, x_url, site_url } = parsed.values;
  const user = c.get('user');
  const db = c.env.DB;
  const [, creators] = await db.batch([
    db.prepare('UPDATE users SET display_name = ?, x_url = ?, site_url = ? WHERE id = ?').bind(display_name, x_url, site_url, user.id),
    db
      .prepare('UPDATE creators SET name = ?, x_url = ?, site_url = ? WHERE user_id = ? AND handle = ? COLLATE NOCASE')
      .bind(display_name, x_url, site_url, user.id, user.handle),
  ]);
  if (creators.meta.changes > 0) await purge(c, [CATALOG_TAG]);
  return c.json({ profile: parsed.values });
});

/** 変える前に、画面で先に確かめる。 */
account.get('/handle-check', async (c) => {
  const handle = (c.req.query('handle') ?? '').toLowerCase();
  return c.json({ status: await checkHandle(c.env.DB, handle, c.get('user').id) });
});

/** handle を変える。前の handle は90日、ほかの人が取れない。結ばれた作者の handle も変わる。 */
account.post('/handle', async (c) => {
  const body = await readJson(c);
  const handle = typeof body?.handle === 'string' ? body.handle.toLowerCase() : '';
  const user = c.get('user');
  const db = c.env.DB;
  const status = await checkHandle(db, handle, user.id);
  if (status === 'same') return c.json({ handle });
  if (status !== 'ok') return c.json({ error: 'handle_rejected', status }, 400);

  const now = Date.now();
  let changes: D1Result[];
  try {
    changes = await db.batch([
      db.prepare('DELETE FROM handle_history WHERE released_at <= ? OR (handle = ? AND user_id = ?)').bind(now, handle, user.id),
      db
        .prepare('INSERT INTO handle_history (handle, user_id, released_at) VALUES (?1, ?2, ?3) ON CONFLICT (handle) DO UPDATE SET user_id = ?2, released_at = ?3')
        .bind(user.handle, user.id, now + HANDLE_HOLD_MS),
      db.prepare('UPDATE users SET handle = ? WHERE id = ?').bind(handle, user.id),
      db.prepare('UPDATE creators SET handle = ? WHERE user_id = ? AND handle = ? COLLATE NOCASE').bind(handle, user.id, user.handle),
    ]);
  } catch {
    // 確かめた後に、ほかの人が先に取った
    return c.json({ error: 'handle_rejected', status: 'taken' }, 409);
  }
  if (changes[3].meta.changes > 0) await purge(c, [CATALOG_TAG]);
  return c.json({ handle });
});

/** 1つの端末をログアウトする。今の端末なら cookie も消す。 */
account.post('/sessions/:id/revoke', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const result = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?').bind(user.id, id).run();
  if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
  if (sessionId(user.tokenHash) === id) clearSessionCookie(c);
  return c.body(null, 204);
});

/** この端末のほかを全部ログアウトする。 */
account.post('/sessions/revoke-others', async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').bind(user.id, user.tokenHash).run();
  return c.json({ revoked: result.meta.changes });
});

const countPasskeys = async (db: D1Database, userId: string) => (await db.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?').bind(userId).first<{ n: number }>())?.n ?? 0;

/** パスキーを外す。直近のログインを求める。最後の手段は外せない。パスキーがなくなれば回復のコードも消す（入る先がなくなるので）。 */
account.post('/passkeys/:id/remove', async (c) => {
  const user = c.get('user');
  if (!isRecentAuth(user)) return c.json({ error: 'reauth_required' }, 403);
  const db = c.env.DB;
  const credentialId = c.req.param('id');
  const [identities, passkeys] = await Promise.all([listIdentities(db, user.id), countPasskeys(db, user.id)]);
  const target = await db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ? AND credential_id = ?').bind(user.id, credentialId).first();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (identities.length + passkeys <= 1) return c.json({ error: 'last_method' }, 409);
  await db.batch([
    db.prepare('DELETE FROM passkeys WHERE user_id = ? AND credential_id = ?').bind(user.id, credentialId),
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?1 AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = ?1)').bind(user.id),
  ]);
  await startSession(c, user.id, { revokeOthers: true, keepAuthAt: user.authAt });
  return c.body(null, 204);
});

/** 回復のコードを作り直す。前のものは無効になる。コードはこの応答でしか見せない。 */
account.post('/recovery-code', async (c) => {
  const user = c.get('user');
  if (!isRecentAuth(user)) return c.json({ error: 'reauth_required' }, 403);
  const db = c.env.DB;
  if ((await countPasskeys(db, user.id)) === 0) return c.json({ error: 'no_passkey' }, 409);
  const code = generateRecoveryCode();
  await db.batch([
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(user.id),
    db.prepare('INSERT INTO recovery_codes (code_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await hashRecoveryCode(code), user.id, Date.now()),
  ]);
  return c.json({ recovery_code: code });
});

/** 手段を外す。直近のログインを求める。最後の1つは外せない。ほかのセッションを消し、今のセッションも作り直す。 */
account.post('/identities/:provider/remove', async (c) => {
  const user = c.get('user');
  if (!isRecentAuth(user)) return c.json({ error: 'reauth_required' }, 403);
  const provider = c.req.param('provider') as Provider;
  const db = c.env.DB;
  const identities = await listIdentities(db, user.id);
  const target = identities.find((identity) => identity.provider === provider);
  if (!target) return c.json({ error: 'not_found' }, 404);
  const others = identities.filter((identity) => identity.provider !== provider);
  if (others.length + (await countPasskeys(db, user.id)) === 0) return c.json({ error: 'last_method' }, 409);

  await db.batch([
    db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').bind(user.id, provider),
    // その手段から来たアバターは、残る手段のものに替える
    db
      .prepare('UPDATE users SET avatar_url = ? WHERE id = ? AND avatar_url IS ?')
      .bind(others.find((identity) => identity.avatar_url)?.avatar_url ?? null, user.id, target.avatar_url),
  ]);
  await startSession(c, user.id, { revokeOthers: true, keepAuthAt: user.authAt });
  return c.body(null, 204);
});

/**
 * AI の鍵を作る（docs/tasks/T037.md「1」）。名前と、投稿の同意の3つ（自分のもの、MIT、利用規約）が要る。
 * その鍵で置くものは、同意したものとして扱う。鍵の生の値は、この応答でしか見せない。
 */
account.post('/ai-keys', async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'bad_request' }, 400);
  const name = parseKeyName(body.name);
  if (name === null) return c.json({ error: 'bad_name' }, 400);
  if (body.own !== true || body.mit !== true || body.terms !== true) return c.json({ error: 'confirm_required' }, 400);
  const made = await createAiKey(c.env.DB, c.get('user').id, name);
  if (!made) return c.json({ error: 'too_many', max: MAX_KEYS_PER_USER }, 409);
  return c.json(made, 201);
});

/** AI の鍵を消す。消した鍵はすぐ使えなくなる（401）。 */
account.post('/ai-keys/:id/delete', async (c) => {
  if (!(await deleteAiKey(c.env.DB, c.get('user').id, c.req.param('id')))) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

/**
 * 退会。直近のログインを求める。
 * 消すもの：人、手段、パスキー、回復のコード、セッション、AI の鍵、いいね、しおり、前の handle の記録。
 * 結ばれた作者の作品は Ludion から取り下げる（CEO の確認待ち）。作者の行は handle だけを残し、ほかの人に取られないようにする。
 */
account.post('/delete', async (c) => {
  const user = c.get('user');
  if (!isRecentAuth(user)) return c.json({ error: 'reauth_required' }, 403);
  const db = c.env.DB;
  const { results: works } = await db
    .prepare(`SELECT w.id FROM works w JOIN creators c ON c.id = w.creator_id WHERE c.user_id = ? AND w.status = 'approved'`)
    .bind(user.id)
    .all<{ id: string }>();
  const results = await db.batch([
    db.prepare('DELETE FROM likes WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM identities WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM passkeys WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM handle_history WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM ai_keys WHERE user_id = ?').bind(user.id),
    // 自分だけの作品も同じに取り下げる（docs/tasks/T036.md「6」）。持ち主が外れるので、だれにも見えなくなる
    db
      .prepare(`UPDATE works SET status = 'rejected', reject_reason = ? WHERE status IN ('approved', 'private') AND creator_id IN (SELECT id FROM creators WHERE user_id = ?)`)
      .bind(REASON_ACCOUNT_DELETED, user.id),
    // 審査待ちと下書きと、自分だけで置いた版も止める。作者の行を外す前に
    db
      .prepare(`UPDATE revisions SET status = 'revoked', updated_at = ? WHERE status IN ('draft', 'submitted', 'approved', 'private') AND work_id IN (SELECT w.id FROM works w JOIN creators c ON c.id = w.creator_id WHERE c.user_id = ?)`)
      .bind(Date.now(), user.id),
    db.prepare('DELETE FROM quotas WHERE key IN (?, ?, ?, ?)').bind(`save:${user.id}`, `revision:${user.id}`, ...apiQuotaKeys(user.id)),
    db.prepare('UPDATE creators SET user_id = NULL, name = NULL, avatar_url = NULL, x_url = NULL, site_url = NULL WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  clearSessionCookie(c);
  // いいねの数と、取り下げた作品が、キャッシュの HTML に残らないように
  if (results[0].meta.changes > 0 || works.length > 0) await purge(c, [CATALOG_TAG, ...works.map(({ id }) => workTag(id))]);
  return c.body(null, 204);
});
