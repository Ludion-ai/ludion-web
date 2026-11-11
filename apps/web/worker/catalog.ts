// 展示の一覧を D1 から読む（SPEC.md「7」「8」）。人によって変わる情報は入れない（ホームの HTML をキャッシュするため。SPEC.md「10」）。

import type { CreatorProfile, CreatorTotals } from '../src/data/pages';
import type { Work } from '../src/data/works';

/** 一覧に出す上限（SPEC.md「8」）。 */
const MAX_WORKS = 200;
/** Popular の順で数えるコピー数の範囲（SPEC.md「4」）。 */
const COPY_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * R2 のキーから、ブラウザが読む URL を作る。D1 にはキーのまま置く（docs/tasks/T005.md「0」）。
 * 返す道は files.ts。
 */
export const fileUrl = (key: string) => `/files/${key}`;

interface WorkRow {
  id: string;
  title: string;
  type: Work['type'];
  platform: Work['platform'];
  category: string;
  subtype: string;
  tags: string;
  version: string;
  license: string;
  pin_order: number | null;
  thumb_key: string;
  thumb_w: number;
  thumb_h: number;
  published_at: number;
  is_remix: number;
  views: number;
  likes: number;
  copies: number;
  copies_30d: number;
  creator_id: string;
  handle: string;
  name: string | null;
  kind: Work['creator']['kind'];
  avatar_key: string | null;
  x_url: string | null;
  site_url: string | null;
}

// ?1 はコピー数を数え始める日
const SELECT_WORKS = `
  SELECT w.id, w.title, w.type, w.platform, w.category, w.subtype, w.tags, w.version, w.license, w.pin_order,
    w.thumb_key, w.thumb_w, w.thumb_h, w.published_at, w.is_remix,
    COALESCE(n.views, 0) AS views, COALESCE(n.copies, 0) AS copies, COALESCE(n.copies_30d, 0) AS copies_30d, COALESCE(l.likes, 0) AS likes,
    w.creator_id, c.handle, c.name, c.kind, c.avatar_url AS avatar_key, c.x_url, c.site_url
  FROM works w
  JOIN creators c ON c.id = w.creator_id
  LEFT JOIN (
    SELECT work_id, SUM(views) AS views, SUM(copies) AS copies, SUM(CASE WHEN day >= ?1 THEN copies ELSE 0 END) AS copies_30d
    FROM counters GROUP BY work_id
  ) n ON n.work_id = w.id
  LEFT JOIN (SELECT work_id, COUNT(*) AS likes FROM likes GROUP BY work_id) l ON l.work_id = w.id`;

// 並びは lib/popular.ts の comparePopular と同じ。上限で切るので SQL で並べる（テストが一致を確かめる）
// ?2 は上限、?3 は作者で絞る（null なら全員）、?4 は作品で絞る（null なら全部）
const LIST_SQL = `${SELECT_WORKS}
  WHERE w.status = 'approved' AND (?3 IS NULL OR w.creator_id = ?3) AND (?4 IS NULL OR w.id = ?4)
  ORDER BY w.pin_order IS NULL, w.pin_order, copies_30d DESC, likes DESC, w.published_at DESC, w.id
  LIMIT ?2`;

// 本人のしおり。新しく保存した順。?2 は上限、?3 は本人
const BOOKMARKS_SQL = `${SELECT_WORKS}
  JOIN bookmarks b ON b.work_id = w.id
  WHERE b.user_id = ?3 AND w.status = 'approved'
  ORDER BY b.created_at DESC, w.id
  LIMIT ?2`;

// 本人のいいね。新しく押した順。?2 は上限、?3 は本人
const LIKES_SQL = `${SELECT_WORKS}
  JOIN likes mine ON mine.work_id = w.id
  WHERE mine.user_id = ?3 AND w.status = 'approved'
  ORDER BY mine.created_at DESC, w.id
  LIMIT ?2`;

function toWork(row: WorkRow): Work {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    platform: row.platform,
    category: row.category,
    subtype: row.subtype,
    tags: JSON.parse(row.tags) as string[],
    version: row.version,
    license: row.license,
    pin_order: row.pin_order,
    thumb_w: row.thumb_w,
    thumb_h: row.thumb_h,
    published_at: row.published_at,
    views: row.views,
    likes: row.likes,
    copies: row.copies,
    copies_30d: row.copies_30d,
    remix: row.is_remix === 1,
    creator: {
      handle: row.handle,
      name: row.name ?? `@${row.handle}`,
      kind: row.kind,
      avatar_url: row.avatar_key ? fileUrl(row.avatar_key) : null,
    },
  };
}

/** リンクや画像に使ってよい URL だけを返す（creator.json の値が javascript: などでもページに出さない）。 */
export function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

function toProfile(row: Pick<WorkRow, 'handle' | 'name' | 'kind' | 'avatar_key' | 'x_url' | 'site_url'>): CreatorProfile {
  return {
    handle: row.handle,
    name: row.name ?? `@${row.handle}`,
    kind: row.kind,
    avatar_url: row.avatar_key ? fileUrl(row.avatar_key) : null,
    x_url: safeUrl(row.x_url),
    site_url: safeUrl(row.site_url),
  };
}

/** カウンタの日は UTC の YYYY-MM-DD。 */
export const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

async function queryWorks(db: D1Database, filter: { creatorId?: string; workId?: string; limit?: number }): Promise<WorkRow[]> {
  const since = utcDay(Date.now() - COPY_WINDOW_DAYS * DAY_MS);
  const { results } = await db
    .prepare(LIST_SQL)
    .bind(since, filter.limit ?? MAX_WORKS, filter.creatorId ?? null, filter.workId ?? null)
    .all<WorkRow>();
  return results;
}

/** 承認済みの作品を Popular の順で返す。 */
export async function listApprovedWorks(db: D1Database): Promise<Work[]> {
  return (await queryWorks(db, {})).map(toWork);
}

/** 本人がしおりを付けた承認済みの作品を、新しく保存した順で返す。 */
export async function listBookmarkedWorks(db: D1Database, userId: string): Promise<Work[]> {
  const since = utcDay(Date.now() - COPY_WINDOW_DAYS * DAY_MS);
  const { results } = await db.prepare(BOOKMARKS_SQL).bind(since, MAX_WORKS, userId).all<WorkRow>();
  return results.map(toWork);
}

/** 本人がいいねした承認済みの作品を、新しく押した順で返す。 */
export async function listLikedWorks(db: D1Database, userId: string): Promise<Work[]> {
  const since = utcDay(Date.now() - COPY_WINDOW_DAYS * DAY_MS);
  const { results } = await db.prepare(LIKES_SQL).bind(since, MAX_WORKS, userId).all<WorkRow>();
  return results.map(toWork);
}

/** 承認済みの作品を1つ、作者と一緒に返す。なければ null（下書きと取り下げも null。CLAUDE.md 原則5）。 */
export async function getApprovedWork(db: D1Database, id: string): Promise<{ work: Work; creator: CreatorProfile; creatorId: string; prefix: string } | null> {
  const [row] = await queryWorks(db, { workId: id, limit: 1 });
  // 公開の版のファイルの置き場。サムネイルと同じ場所にある
  return row ? { work: toWork(row), creator: toProfile(row), creatorId: row.creator_id, prefix: row.thumb_key.replace(/\/thumb\.webp$/, '') } : null;
}

// 自分だけの作品を1つ。持ち主だけ（docs/tasks/T036.md「2」）。?2 は作品、?3 は本人
const PRIVATE_SQL = `${SELECT_WORKS}
  WHERE w.id = ?2 AND w.status = 'private' AND c.user_id = ?3`;

/** 自分だけの作品を1つ、作者と一緒に返す。持ち主でなければ null（ない作品と同じ）。 */
export async function getPrivateWork(db: D1Database, id: string, userId: string): Promise<{ work: Work; creator: CreatorProfile; creatorId: string } | null> {
  const since = utcDay(Date.now() - COPY_WINDOW_DAYS * DAY_MS);
  const row = await db.prepare(PRIVATE_SQL).bind(since, id, userId).first<WorkRow>();
  return row ? { work: toWork(row), creator: toProfile(row), creatorId: row.creator_id } : null;
}

/** 作者の承認済みの作品を Popular の順で返す。 */
export async function listCreatorWorks(db: D1Database, creatorId: string, limit?: number): Promise<Work[]> {
  return (await queryWorks(db, { creatorId, limit })).map(toWork);
}

/** 作者を handle で探す（大文字と小文字を区別しない。SPEC.md「7」）。 */
export async function getCreator(db: D1Database, handle: string): Promise<{ id: string; profile: CreatorProfile } | null> {
  const row = await db
    .prepare('SELECT id, handle, name, kind, avatar_url AS avatar_key, x_url, site_url FROM creators WHERE handle = ? COLLATE NOCASE')
    .bind(handle)
    .first<{ id: string } & Pick<WorkRow, 'handle' | 'name' | 'kind' | 'avatar_key' | 'x_url' | 'site_url'>>();
  return row ? { id: row.id, profile: toProfile(row) } : null;
}

/** 前の handle（まだ90日の間のもの）から、今の作者の handle を探す。 */
export async function findMovedCreator(db: D1Database, previous: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT c.handle FROM handle_history h
       JOIN users u ON u.id = h.user_id
       JOIN creators c ON c.user_id = u.id AND c.handle = u.handle COLLATE NOCASE
       WHERE h.handle = ? AND h.released_at > ?`,
    )
    .bind(previous.toLowerCase(), Date.now())
    .first<{ handle: string }>();
  return row?.handle ?? null;
}

/** 作者の承認済みの作品の数と、閲覧数とコピー数の合計。 */
export async function getCreatorTotals(db: D1Database, creatorId: string): Promise<CreatorTotals> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS works, COALESCE(SUM(n.views), 0) AS views, COALESCE(SUM(n.copies), 0) AS copies
       FROM works w
       LEFT JOIN (SELECT work_id, SUM(views) AS views, SUM(copies) AS copies FROM counters GROUP BY work_id) n ON n.work_id = w.id
       WHERE w.status = 'approved' AND w.creator_id = ?`,
    )
    .bind(creatorId)
    .first<CreatorTotals>();
  return row ?? { works: 0, views: 0, copies: 0 };
}
