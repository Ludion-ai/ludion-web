// セッション（CLAUDE.md「技術の決定」、docs/tasks/T009.md「1」、T020「1」、SEC001 A13）。
// cookie には 256ビットの乱数、D1 にはそのハッシュだけを置く。IP と UA は持たない。

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';

type AppBindings = { Bindings: Env };

const SESSION_COOKIE = 'ld_session';
const SESSION_DAYS = 30;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const SESSION_BYTES = 32;
/** randomHex(SESSION_BYTES) の形。ほかの形の cookie では D1 を読まない。 */
const SESSION_TOKEN = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** 1人のセッションの上限。超えたら、切れるのが早いものから消す。 */
const MAX_SESSIONS_PER_USER = 20;
/** ログインのたびに消す、切れた行の上限。行はログインでしか増えないので、これで溜まらない。 */
const EXPIRED_BATCH = 50;
/** 画面に出す id の長さ（ハッシュの頭）。本人の行の中で区別できればよい。 */
const SESSION_ID_LENGTH = 16;
/** 退会と手段の足し引きに求める、直近のログイン（SEC001 B2-3、B2-5）。 */
export const RECENT_AUTH_MS = 10 * 60 * 1000;

export const SECURE_COOKIE = { httpOnly: true, secure: true, sameSite: 'Lax' } as const;
const SESSION_COOKIE_OPTIONS = { ...SECURE_COOKIE, path: '/' };

export interface SessionUser {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  /** このセッションのハッシュ */
  tokenHash: string;
  /** このセッションでログインした時刻。直近のログインを確かめるためだけに使う */
  authAt: number;
  /** 運営か。審査の API と画面はこの人だけ（docs/tasks/T021.md） */
  isOperator: boolean;
}

export function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** その日の UTC の0時。セッションの日時は日の単位までしか持たない。 */
const startOfDay = (time: number) => Math.floor(time / DAY_MS) * DAY_MS;

export const sessionId = (tokenHash: string) => tokenHash.slice(0, SESSION_ID_LENGTH);

export const isRecentAuth = (user: Pick<SessionUser, 'authAt'>, now = Date.now()) => now - user.authAt < RECENT_AUTH_MS;

/** cookie のセッションの本人。なければ、切れていれば、null。最後に使った日は、日が変わったときだけ書く。 */
export async function getSessionUser<E extends AppBindings>(c: Context<E>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || !SESSION_TOKEN.test(token)) return null;
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.handle, u.display_name, u.avatar_url, u.is_operator, s.auth_at, s.last_used_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, now)
    .first<{ id: string; handle: string; display_name: string | null; avatar_url: string | null; is_operator: number; auth_at: number; last_used_at: number }>();
  if (!row) return null;
  const today = startOfDay(now);
  if (row.last_used_at < today) await c.env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?').bind(today, tokenHash).run();
  return { id: row.id, handle: row.handle, display_name: row.display_name, avatar_url: row.avatar_url, tokenHash, authAt: row.auth_at, isOperator: row.is_operator === 1 };
}

/**
 * 新しいセッションを作って cookie に入れる（固定を防ぐため、ログインのたびに作り直す）。
 * 今の cookie のセッション、切れた行を少し、上限を超えた行を消す。revokeOthers なら、その人のほかのセッションも全部消す。
 * keepAuthAt：ログインし直していないのにセッションだけを作り直すとき、前のログインの時刻を引き継ぐ。
 * 引き継がないと、手段を足し引きするたびに「直近のログイン」が延びる。
 */
export async function startSession<E extends AppBindings>(c: Context<E>, userId: string, { revokeOthers = false, keepAuthAt }: { revokeOthers?: boolean; keepAuthAt?: number } = {}): Promise<void> {
  const token = randomHex(SESSION_BYTES);
  const now = Date.now();
  const today = startOfDay(now);
  const previous = getCookie(c, SESSION_COOKIE);
  const tokenHash = await hashToken(token);
  const db = c.env.DB;
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(previous ? await hashToken(previous) : ''),
    db.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ? LIMIT ?)').bind(now, EXPIRED_BATCH),
    ...(revokeOthers ? [db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)] : []),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_used_at, auth_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(tokenHash, userId, now + SESSION_SECONDS * 1000, today, today, keepAuthAt ?? now),
    db
      .prepare(
        `DELETE FROM sessions WHERE user_id = ?1 AND token_hash NOT IN
           (SELECT token_hash FROM sessions WHERE user_id = ?1 ORDER BY expires_at DESC LIMIT ?2)`,
      )
      .bind(userId, MAX_SESSIONS_PER_USER),
  ]);
  setCookie(c, SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_SECONDS });
}

/** cookie を消す。 */
export function clearSessionCookie<E extends AppBindings>(c: Context<E>): void {
  deleteCookie(c, SESSION_COOKIE, SESSION_COOKIE_OPTIONS);
}

/** セッションの行を消し、cookie を消す。 */
export async function endSession<E extends AppBindings>(c: Context<E>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hashToken(token)).run();
  clearSessionCookie(c);
}
