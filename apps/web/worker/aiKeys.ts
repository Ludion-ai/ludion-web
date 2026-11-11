// AI の鍵（docs/tasks/T037.md「1」、CLAUDE.md 原則6）。AI（Claude Code など）が本人の代わりに作品を置くための鍵。
//
// - 鍵は ld_ ＋ 英数字40文字（約238ビット）。作ったときの応答で1回だけ返す。D1 に置くのは SHA-256 のハッシュだけ。
// - 持つもの：ハッシュ、名前、持ち主、作った日時、最後に使った日（UTC の日）、消した日時。
// - 1人5本まで（消した鍵は数えない）。消した鍵は使えない（401）。退会したら行ごと消す（account.ts）。
// - 鍵の生の値は、ログにも R2 にも書かない。比べるのは、いつもハッシュで。

import { hashToken } from './session';

export const MAX_KEYS_PER_USER = 5;
export const MAX_KEY_NAME_CHARS = 40;
export const KEY_PREFIX = 'ld_';
const KEY_BODY_LENGTH = 40;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** 鍵の形。ほかの形では D1 を読まない。 */
export const KEY_PATTERN = /^ld_[A-Za-z0-9]{40}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 新しい鍵の生の値。62文字から偏りなく選ぶ（248 以上の値は捨てて引き直す）。 */
export function generateKey(): string {
  const out: string[] = [];
  while (out.length < KEY_BODY_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(KEY_BODY_LENGTH * 2))) {
      if (byte >= 248) continue;
      out.push(ALPHABET[byte % ALPHABET.length]);
      if (out.length === KEY_BODY_LENGTH) break;
    }
  }
  return `${KEY_PREFIX}${out.join('')}`;
}

export const hashKey = (key: string) => hashToken(key);

/** 鍵の名前。前後の空白を外し、1〜40文字、制御文字なし。だめなら null。 */
export function parseKeyName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  const length = [...name].length;
  return length >= 1 && length <= MAX_KEY_NAME_CHARS && !CONTROL.test(name) ? name : null;
}

export interface AiKeyRow {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

/** 本人の、消していない鍵。新しい順。 */
export async function listAiKeys(db: D1Database, userId: string): Promise<AiKeyRow[]> {
  const { results } = await db
    .prepare('SELECT id, name, created_at, last_used_at FROM ai_keys WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, rowid DESC')
    .bind(userId)
    .all<AiKeyRow>();
  return results;
}

/**
 * 鍵を作る。上限に達していれば null。数えるのと足すのを1つの文にして、同時に作られても5本を超えない。
 * 返す secret は、この応答でしか見られない。
 */
export async function createAiKey(db: D1Database, userId: string, name: string, now = Date.now()): Promise<{ key: AiKeyRow; secret: string } | null> {
  const secret = generateKey();
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO ai_keys (id, user_id, key_hash, name, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM ai_keys WHERE user_id = ?2 AND deleted_at IS NULL) < ?6`,
    )
    .bind(id, userId, await hashKey(secret), name, now, MAX_KEYS_PER_USER)
    .run();
  if (result.meta.changes === 0) return null;
  return { key: { id, name, created_at: now, last_used_at: null }, secret };
}

/** 鍵を消す（使えなくする）。本人の、消していない鍵だけ。 */
export async function deleteAiKey(db: D1Database, userId: string, id: string, now = Date.now()): Promise<boolean> {
  const result = await db.prepare('UPDATE ai_keys SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(now, id, userId).run();
  return result.meta.changes > 0;
}

export interface KeyUser {
  id: string;
  handle: string;
  isOperator: boolean;
  keyId: string;
}

/** 鍵の持ち主。形が違う、ない、消した鍵なら null。最後に使った日は、日が変わったときだけ書く。 */
export async function keyUser(db: D1Database, key: string, now = Date.now()): Promise<KeyUser | null> {
  if (!KEY_PATTERN.test(key)) return null;
  const row = await db
    .prepare(
      `SELECT k.id AS key_id, k.last_used_at, u.id, u.handle, u.is_operator FROM ai_keys k JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ? AND k.deleted_at IS NULL`,
    )
    .bind(await hashKey(key))
    .first<{ key_id: string; last_used_at: number | null; id: string; handle: string; is_operator: number }>();
  if (!row) return null;
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  if (row.last_used_at === null || row.last_used_at < today) await db.prepare('UPDATE ai_keys SET last_used_at = ? WHERE id = ?').bind(today, row.key_id).run();
  return { id: row.id, handle: row.handle, isOperator: row.is_operator === 1, keyId: row.key_id };
}
