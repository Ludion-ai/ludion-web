// POST /api/count：閲覧数とコピー数（SPEC.md「7」「8」、docs/tasks/T007.md「3」）。埋め込みのコードのコピー数（embed_copy。EMBED001「6」。別の数で、コピー数に足さない）。
// その日の行を1つ増やすだけ。IP と UA は読まない、保存しない（CLAUDE.md 原則6）。
// ログイン中の人が作品の持ち主なら数えない（docs/tasks/T021.md）。そのためだけに cookie を読み、保存するものは増やさない。

import { Hono } from 'hono';
import { utcDay } from './catalog';
import type { Env } from './env';
import { isSameOrigin } from './origin';
import { getSessionUser } from './session';

const COLUMNS = { view: 'views', copy: 'copies', embed_copy: 'embed_copies' } as const;

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

  // 承認済みの作品のときだけ行ができる。列の名前は上の固定の表から
  const column = COLUMNS[type];
  const result = await c.env.DB.prepare(
    `INSERT INTO counters (work_id, day, ${column})
     SELECT id, ?2, 1 FROM works WHERE id = ?1 AND status = 'approved'
     ON CONFLICT (work_id, day) DO UPDATE SET ${column} = ${column} + 1`,
  )
    .bind(body.work_id, utcDay(Date.now()))
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'bad_request', message: '承認済みの作品ではない' }, 400);
  return c.body(null, 204);
});

/** 埋め込みの表示を1つ数える（worker/frames.ts の埋め込みの枠）。承認済みの作品のときだけ行ができる。 */
export async function countEmbedView(db: D1Database, workId: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO counters (work_id, day, embed_views)
       SELECT id, ?2, 1 FROM works WHERE id = ?1 AND status = 'approved'
       ON CONFLICT (work_id, day) DO UPDATE SET embed_views = embed_views + 1`,
    )
    .bind(workId, utcDay(now))
    .run();
}
