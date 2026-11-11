// 本人のための API（SPEC.md「8」、docs/tasks/T009.md「2」）。
// HTML は人によって変えない。本人のいいね済み・しおり済みは、読み込みの後にここから足す（SPEC.md「10」）。

import { Hono, type Context } from 'hono';
import { listBookmarkedWorks, listLikedWorks } from './catalog';
import type { Env } from './env';
import { isSameOrigin } from './origin';
import { canPost } from './revisions';
import { getSessionUser } from './session';

type MeEnv = { Bindings: Env };

/** 切り替えるもの。表の名前はこの固定の表からだけ SQL に入れる。 */
const TOGGLES = {
  like: { table: 'likes', field: 'liked' },
  bookmark: { table: 'bookmarks', field: 'bookmarked' },
} as const;

async function toggle(c: Context<MeEnv>, kind: keyof typeof TOGGLES): Promise<Response> {
  if (!isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const { table, field } = TOGGLES[kind];
  const db = c.env.DB;
  const workId = c.req.param('id') ?? '';
  // batch は1つのトランザクション。消せたら外す、消せなければ（changes() = 0）入れる。
  // 2回に分けると、同時に押されたときに「入っていた、でももう消えていた」が起きて、承認済みの作品に 400 を返してしまう
  const [removed, added] = await db.batch([
    db
      .prepare(
        `DELETE FROM ${table} WHERE user_id = ?1 AND work_id = ?2
         AND EXISTS (SELECT 1 FROM works WHERE id = ?2 AND status = 'approved')`,
      )
      .bind(user.id, workId),
    db
      .prepare(
        `INSERT INTO ${table} (user_id, work_id, created_at)
         SELECT ?1, id, ?3 FROM works WHERE id = ?2 AND status = 'approved' AND changes() = 0
         ON CONFLICT (user_id, work_id) DO NOTHING`,
      )
      .bind(user.id, workId, Date.now()),
  ]);
  if (removed.meta.changes > 0) return c.json({ [field]: false });
  if (added.meta.changes > 0) return c.json({ [field]: true });
  return c.json({ error: 'bad_request', message: '承認済みの作品ではない' }, 400);
}

export const me = new Hono<MeEnv>();

me.get('/me', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ user: null });
  const db = c.env.DB;
  const [liked, bookmarked] = await db.batch<{ work_id: string }>([
    db.prepare('SELECT work_id FROM likes WHERE user_id = ?').bind(user.id),
    db.prepare('SELECT work_id FROM bookmarks WHERE user_id = ?').bind(user.id),
  ]);
  // 審査待ちの数は運営にだけ返す。ホームの API はこの1本なので、別の要求にしない
  const pending = user.isOperator ? await db.prepare(`SELECT COUNT(*) AS n FROM revisions WHERE status = 'submitted'`).first<{ n: number }>() : null;
  return c.json({
    user: { handle: user.handle, display_name: user.display_name, avatar_url: user.avatar_url, ...(user.isOperator ? { review_pending: pending?.n ?? 0 } : {}) },
    liked: liked.results.map((row) => row.work_id),
    bookmarked: bookmarked.results.map((row) => row.work_id),
    can_post: canPost(c.env, user),
  });
});

me.get('/me/bookmarks', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ works: await listBookmarkedWorks(c.env.DB, user.id) });
});

me.get('/me/likes', async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  return c.json({ works: await listLikedWorks(c.env.DB, user.id) });
});

me.post('/works/:id/like', (c) => toggle(c, 'like'));
me.post('/works/:id/bookmark', (c) => toggle(c, 'bookmark'));
