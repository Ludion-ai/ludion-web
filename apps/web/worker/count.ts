// POST /api/count：閲覧数とコピー数（SPEC.md「7」「8」、docs/tasks/T007.md「3」）。
// その日の行を1つ増やすだけ。UA は読まない。IP と UA は保存しない（CLAUDE.md 原則6）。
// ログイン中の人が作品の持ち主なら数えない（docs/tasks/T021.md）。そのためだけに cookie を読み、保存するものは増やさない。
// 同じ相手（回数の制限と同じ IP の束ね方）の、同じ作品の同じ種類は、UTC の1日に1回だけ数える（LIMIT001）。
// IP はその場で HMAC にし、作品と種類と日も混ぜた印だけを quotas に2日置く。生の IP も作品の id も残らない（worker/limitKey.ts の countKey）。

import { Hono } from 'hono';
import { utcDay } from './catalog';
import type { Env } from './env';
import { countKey } from './limitKey';
import { isSameOrigin } from './origin';
import { sweepQuotas } from './quota';
import { LOOPBACK } from './rateLimit';
import { getSessionUser } from './session';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * この相手の、この作品のこの種類を、今日はじめて数えるか。印を置けたら true。
 * 承認済みの作品のときだけ印を置く（ない作品の id で quotas を増やさせない）。
 * 数えない相手（手元のサーバー、IP がない、秘密の値がない）は、今までどおり毎回数える。
 */
async function firstToday(env: Env, ip: string | undefined, workId: string, type: string, now: number): Promise<boolean> {
  if (!ip || LOOPBACK.has(ip) || !env.RATE_KEY_SECRET) return true;
  const key = await countKey(ip, env.RATE_KEY_SECRET, workId, type, new Date(now));
  await sweepQuotas(env.DB, now);
  const result = await env.DB.prepare(
    `INSERT INTO quotas (key, bucket, n, expires_at)
     SELECT ?1, ?2, 1, ?3 FROM works WHERE id = ?4 AND status = 'approved'
     ON CONFLICT (key, bucket) DO NOTHING`,
  )
    .bind(`count:${key.slice(0, 32)}`, utcDay(now), now + 2 * DAY_MS, workId)
    .run();
  return result.meta.changes > 0;
}

const COLUMNS = { view: 'views', copy: 'copies' } as const;

export const count = new Hono<{ Bindings: Env }>();

count.post('/', async (c) => {
  if (!isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);

  const body = (await c.req.json().catch(() => null)) as { work_id?: unknown; type?: unknown } | null;
  const type = typeof body?.type === 'string' && Object.hasOwn(COLUMNS, body.type) ? (body.type as keyof typeof COLUMNS) : null;
  if (!type || typeof body?.work_id !== 'string') return c.json({ error: 'bad_request' }, 400);

  // 作り手自身の閲覧とコピーは数えない。答えは数えたときと同じにする
  const viewer = await getSessionUser(c);
  if (viewer) {
    const own = await c.env.DB.prepare(`SELECT 1 FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ? AND w.status = 'approved' AND c.user_id = ?`).bind(body.work_id, viewer.id).first();
    if (own) return c.body(null, 204);
  }

  const now = Date.now();
  if (!(await firstToday(c.env, c.req.header('CF-Connecting-IP'), body.work_id, type, now))) {
    // 今日もう数えた相手には、数えたときと同じ答え。承認済みでない作品は、今までどおり 400
    const approved = await c.env.DB.prepare(`SELECT 1 FROM works WHERE id = ? AND status = 'approved'`).bind(body.work_id).first();
    return approved ? c.body(null, 204) : c.json({ error: 'bad_request', message: '承認済みの作品ではない' }, 400);
  }

  // 承認済みの作品のときだけ行ができる。列の名前は上の固定の表から
  const column = COLUMNS[type];
  const result = await c.env.DB.prepare(
    `INSERT INTO counters (work_id, day, ${column})
     SELECT id, ?2, 1 FROM works WHERE id = ?1 AND status = 'approved'
     ON CONFLICT (work_id, day) DO UPDATE SET ${column} = ${column} + 1`,
  )
    .bind(body.work_id, utcDay(now))
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'bad_request', message: '承認済みの作品ではない' }, 400);
  return c.body(null, 204);
});
