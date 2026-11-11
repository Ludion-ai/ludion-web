// 作品の版を読む（docs/tasks/T021.md、SEC001 A07）。投稿、審査、枠、画像で同じものを使う。

import { DOCUMENT_FILE, type Work } from '@ludion/render';
import type { Env } from './env';
import type { SessionUser } from './session';

/** 投稿できるか。全員に開くまでは運営だけ（docs/PHASE0.md「投稿を知らない人に開く前の条件」）。 */
export const canPost = (env: Pick<Env, 'POSTING_OPEN'>, user: Pick<SessionUser, 'isOperator'> | null): boolean => Boolean(user) && (env.POSTING_OPEN === '1' || user?.isOperator === true);

/** 版の id の形。サーバーが作る16バイトの乱数の16進。ほかの形では D1 を読まない。 */
export const REVISION_ID = /^[0-9a-f]{32}$/;

export interface RevisionRow {
  id: string;
  work_id: string;
  version: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'revoked' | 'private';
  r2_prefix: string;
  content_hash: string;
  title: string;
  type: Work['meta']['type'];
  platform: Work['meta']['platform'];
  category: string;
  subtype: string;
  tags: string;
  made_with: string;
  thumb_w: number;
  thumb_h: number;
  tokens_ok: number;
  is_remix: number;
  /** リミックスの元の作品の ID（docs/tasks/T033.md B3） */
  remix_of: string | null;
  reject_code: string | null;
  reject_note: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  submitted_at: number | null;
  reviewed_at: number | null;
  reviewed_by: string | null;
}

export const revisionFile = (prefix: string, name: string) => `${prefix}/${name}`;
export const draftFrameUrls = (id: string) => ({ desktop: `/draft-frame/${id}/desktop.html`, mobile: `/draft-frame/${id}/mobile.html` });
export const draftThumbUrl = (id: string) => `/draft-thumb/${id}.webp`;

/**
 * R2 から版のファイルを読む。part.html か part.css か meta.json がなければ null。
 * 文書の作品（meta.json の format が document。DOC001）は index.html を読み、html と css を空、js を null にして返す。
 * index.html は part.html がないときだけ読むので、今ある作品の読み方（R2 を読む回数）は変わらない。
 */
export async function loadRevisionFiles(bucket: R2Bucket, prefix: string): Promise<Work | null> {
  const read = async (name: string) => (await bucket.get(revisionFile(prefix, name)))?.text() ?? null;
  const [meta, html, css, js] = await Promise.all([read('meta.json'), read('part.html'), read('part.css'), read('part.js')]);
  if (meta === null) return null;
  const parsed = JSON.parse(meta) as Work['meta'];
  if (html === null && parsed.format === 'document') {
    const document = await read(DOCUMENT_FILE);
    return document === null ? null : { meta: parsed, html: '', css: '', js: null, document };
  }
  if (html === null || css === null) return null;
  return { meta: parsed, html, css, js };
}

/** 公開してよい版の置き場。作品も版も承認済みのときだけ（前の版も、取り下げるまでは返す）。 */
export async function approvedPrefix(db: D1Database, workId: string, version: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT r.r2_prefix FROM revisions r JOIN works w ON w.id = r.work_id
       WHERE r.work_id = ? AND r.version = ? AND r.status = 'approved' AND w.status = 'approved'`,
    )
    .bind(workId, version)
    .first<{ r2_prefix: string }>();
  return row?.r2_prefix ?? null;
}

export interface OwnedWork {
  id: string;
  status: string;
  version: string;
  creator_id: string;
  creator_handle: string;
  /** 作者に結ばれた人。結ばれていなければ null */
  owner_id: string | null;
  /** リミックスの元の作品の ID。作品を作るときに決まり、変えない */
  remix_of: string | null;
}

/** 作品と持ち主。持ち主は作者に結ばれた人から決める。 */
export async function ownedWork(db: D1Database, workId: string): Promise<OwnedWork | null> {
  return db
    .prepare(
      `SELECT w.id, w.status, w.version, w.creator_id, c.handle AS creator_handle, c.user_id AS owner_id, w.remix_of
       FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?`,
    )
    .bind(workId)
    .first<OwnedWork>();
}

/** リミックスの元の作品。題と作者。取り下げられていても返す（コピーされるコードの2行目と審査の画面は、元が消えても残す）。 */
export async function remixSource(db: D1Database, workId: string | null): Promise<{ id: string; title: string; handle: string; status: string } | null> {
  if (!workId) return null;
  return db
    .prepare('SELECT w.id, w.title, w.status, c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?')
    .bind(workId)
    .first<{ id: string; title: string; handle: string; status: string }>();
}

/** 版と持ち主と、作品の状態。 */
export async function ownedRevision(db: D1Database, revisionId: string): Promise<(RevisionRow & { owner_id: string | null; work_status: string }) | null> {
  return db
    .prepare(
      `SELECT r.*, c.user_id AS owner_id, w.status AS work_status FROM revisions r
       JOIN works w ON w.id = r.work_id JOIN creators c ON c.id = w.creator_id WHERE r.id = ?`,
    )
    .bind(revisionId)
    .first<RevisionRow & { owner_id: string | null; work_status: string }>();
}

/**
 * 運営がこの版を見てよいか。自分だけの作品は、審査に出された版のほかは見ない（docs/tasks/T036.md「2」）。
 * 自分だけで置いた版（private）は、作品を後で公開しても審査していないので見ない。
 */
export const operatorMaySee = (revision: Pick<RevisionRow, 'status'> & { work_status: string }): boolean =>
  revision.status !== 'private' && (revision.work_status !== 'private' || revision.status === 'submitted');

/**
 * 公開前の版を見てよいか：持ち主と運営だけ（docs/tasks/T021.md「下書きの見え方」）。ほかの人には、あることも教えない。
 * 自分だけの作品の版は、持ち主だけ（運営は審査に出された版だけ。operatorMaySee）。
 */
export async function readableRevision(db: D1Database, revisionId: string, user: SessionUser | null): Promise<RevisionRow | null> {
  if (!user || !REVISION_ID.test(revisionId)) return null;
  const revision = await ownedRevision(db, revisionId);
  return revision && (revision.owner_id === user.id || (user.isOperator && operatorMaySee(revision))) ? revision : null;
}

/** 自分だけの作品の上限（docs/tasks/T036.md「5」）。1人100作品まで。 */
export const PRIVATE_WORKS_LIMIT = 100;

/** その人の自分だけの作品の数。except の作品は数えない（今の作品を数え直さないため）。 */
export async function countPrivateWorks(db: D1Database, userId: string, except: string | null = null): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM works w JOIN creators c ON c.id = w.creator_id WHERE c.user_id = ?1 AND w.status = 'private' AND (?2 IS NULL OR w.id <> ?2)`)
    .bind(userId, except)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 自分だけの作品の今の版（works.version の版）。持ち主だけに返す。ほかの人（運営も）には null で、ない作品と同じに見せる。
 */
export async function privateCurrentRevision(db: D1Database, workId: string, user: Pick<SessionUser, 'id'> | null): Promise<RevisionRow | null> {
  if (!user) return null;
  return db
    .prepare(
      `SELECT r.* FROM works w JOIN creators c ON c.id = w.creator_id JOIN revisions r ON r.work_id = w.id AND r.version = w.version
       WHERE w.id = ? AND w.status = 'private' AND c.user_id = ?`,
    )
    .bind(workId, user.id)
    .first<RevisionRow>();
}
