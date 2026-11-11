// 回数の上限（docs/tasks/T021.md、SEC001 A05、B1-5）。1時間と1日を D1 で数える。1分の窓は束縛（rateLimit.ts）。
// 数は quotaLimits.ts に置く。

import type { Env } from './env';
import { limitKey } from './limitKey';
import { API_LIMITS, POST_LIMITS, SIGNUP_LIMITS } from './quotaLimits';
import { LOOPBACK } from './rateLimit';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** 1回に消す、切れた行の上限。行は数えるたびにしか増えないので、これで溜まらない。 */
const EXPIRED_BATCH = 50;

const dayBucket = (now: number) => new Date(now).toISOString().slice(0, 10);
const hourBucket = (now: number) => new Date(now).toISOString().slice(0, 13);

/** 1つ数える。上限に達していれば数えずに false。1つの文なので、同時に来ても上限を超えない。 */
export async function takeQuota(db: D1Database, key: string, bucket: string, limit: number, expiresAt: number): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO quotas (key, bucket, n, expires_at) VALUES (?1, ?2, 1, ?4)
       ON CONFLICT (key, bucket) DO UPDATE SET n = n + 1 WHERE n < ?3`,
    )
    .bind(key, bucket, limit, expiresAt)
    .run();
  return result.meta.changes > 0;
}

/** 切れた行を少し消す。 */
export async function sweepQuotas(db: D1Database, now = Date.now()): Promise<void> {
  await db.prepare('DELETE FROM quotas WHERE rowid IN (SELECT rowid FROM quotas WHERE expires_at <= ? LIMIT ?)').bind(now, EXPIRED_BATCH).run();
}

export type PostLimit = 'revisions' | 'saves';

/**
 * 投稿の回数を数える。人ごとが先で、人の上限に当たれば全体を減らさない。
 * newRevision：新しい版を作るときは、版の数も数える。
 */
export async function takePostQuota(db: D1Database, userId: string, newRevision: boolean, now = Date.now()): Promise<PostLimit | null> {
  const bucket = dayBucket(now);
  const expires = now + 2 * DAY_MS;
  await sweepQuotas(db, now);
  if (!(await takeQuota(db, `save:${userId}`, bucket, POST_LIMITS.savesPerUserDay, expires))) return 'saves';
  if (!(await takeQuota(db, 'save:*', bucket, POST_LIMITS.savesAllDay, expires))) return 'saves';
  if (newRevision) {
    if (!(await takeQuota(db, `revision:${userId}`, bucket, POST_LIMITS.revisionsPerUserDay, expires))) return 'revisions';
    if (!(await takeQuota(db, 'revision:*', bucket, POST_LIMITS.revisionsAllDay, expires))) return 'revisions';
  }
  return null;
}

export type ApiLimit = 'put' | 'read';

/** AI の口の、人ごとの数の鍵（退会のときに消す）。 */
export const apiQuotaKeys = (userId: string): [string, string] => [`api-put:${userId}`, `api-read:${userId}`];

/** 次の UTC の時の頭。1時間の数が戻る時刻。 */
export const nextHour = (now: number) => (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
/** 次の UTC の日の頭。1日の数が戻る時刻。 */
export const nextDay = (now: number) => (Math.floor(now / DAY_MS) + 1) * DAY_MS;

/** AI の口の回数を数える（1人1時間）。上限に達していれば、数えずに false。 */
export async function takeApiQuota(db: D1Database, userId: string, kind: ApiLimit, now = Date.now()): Promise<boolean> {
  await sweepQuotas(db, now);
  const [putKey, readKey] = apiQuotaKeys(userId);
  return kind === 'put'
    ? takeQuota(db, putKey, hourBucket(now), API_LIMITS.putsPerUserHour, now + 2 * HOUR_MS)
    : takeQuota(db, readKey, hourBucket(now), API_LIMITS.readsPerUserHour, now + 2 * HOUR_MS);
}

/**
 * 新しい人を作ってよいか。IP はその場で HMAC にして数え、生の IP は置かない（CLAUDE.md 原則6）。
 * rateLimit.ts と同じく、手元のサーバーが自分で付ける値は数えない。秘密の値がなければ数えない（生の IP で代わりに数えない）。
 * 失敗したときは通す。数の守りのせいでログインを止めない。
 */
export async function takeSignupQuota(env: Pick<Env, 'DB' | 'RATE_KEY_SECRET'>, ip: string | undefined, now = Date.now()): Promise<boolean> {
  if (!ip || LOOPBACK.has(ip) || !env.RATE_KEY_SECRET) return true;
  try {
    await sweepQuotas(env.DB, now);
    const key = await limitKey(ip, env.RATE_KEY_SECRET, new Date(now));
    if (!(await takeQuota(env.DB, `signup:${key.slice(0, 32)}`, dayBucket(now), SIGNUP_LIMITS.perKeyDay, now + 2 * DAY_MS))) return false;
    return await takeQuota(env.DB, 'signup:*', hourBucket(now), SIGNUP_LIMITS.allHour, now + 2 * HOUR_MS);
  } catch {
    return true;
  }
}
