// 審査の API（docs/tasks/T021.md 段階 C、SEC001 A02、A07、B1-6）。運営だけ。ほかの人には道があることも見せない（404）。
// 承認は、審査で見た中身のハッシュと一致するときだけ通る。見た後に変わった版を承認しない。

import { REJECT_CODES, checkSubmission, reviewFlags, type RejectCode } from '@ludion/rules';
import { Hono, type Context } from 'hono';
import { CATALOG_TAG } from './cachePolicy';
import type { Env } from './env';
import { isSameOrigin } from './origin';
import { purgeWithRetry } from './purge';
import { REVISION_ID, draftFrameUrls, draftThumbUrl, loadRevisionFiles, operatorMaySee, ownedRevision, remixSource, revisionFile, type RevisionRow } from './revisions';
import { getSessionUser, type SessionUser } from './session';

type ReviewEnv = { Bindings: Env; Variables: { user: SessionUser } };
type ReviewContext = Context<ReviewEnv>;

const MAX_JSON_BYTES = 4 * 1024;
const MAX_NOTE_CHARS = 500;
/** 1回に返す審査待ちの数。古い順なので、終わらせれば次が出る。 */
const QUEUE_LIMIT = 100;

export const review = new Hono<ReviewEnv>();

review.use('*', async (c, next) => {
  const user = await getSessionUser(c);
  if (!user?.isOperator) return c.json({ error: 'not_found' }, 404);
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  c.set('user', user);
  await next();
});

const purge = (c: ReviewContext, tags: string[]) => purgeWithRetry((c.executionCtx as unknown as ExecutionContext).cache, tags);

async function readJson(c: ReviewContext): Promise<Record<string, unknown> | null> {
  if (Number(c.req.header('Content-Length') ?? '0') > MAX_JSON_BYTES) return null;
  const body = (await c.req.json().catch(() => null)) as unknown;
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/** 審査待ちの一覧。古い順。 */
review.get('/queue', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.id, r.work_id, r.version, r.title, r.category, r.subtype, r.submitted_at, c.handle, c.kind,
       EXISTS (SELECT 1 FROM works w WHERE w.id = r.work_id AND w.status = 'approved') AS public
     FROM revisions r JOIN works w ON w.id = r.work_id JOIN creators c ON c.id = w.creator_id
     WHERE r.status = 'submitted'
     ORDER BY r.submitted_at, r.id
     LIMIT ?`,
  )
    .bind(QUEUE_LIMIT)
    .all();
  return c.json({ revisions: results });
});

/** 1つの版を全部。枠、コード、検査の結果、気になる書き方の印、前の公開の版のコード（差分のため）。 */
review.get('/revisions/:rid', async (c) => {
  const rid = c.req.param('rid');
  if (!REVISION_ID.test(rid)) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const found = await ownedRevision(db, rid);
  // 自分だけの作品は、審査に出された版のほかは運営も見ない（docs/tasks/T036.md「2」）
  const revision = found && operatorMaySee(found) ? found : null;
  const files = revision && (await loadRevisionFiles(c.env.PARTS, revision.r2_prefix));
  if (!revision || !files) return c.json({ error: 'not_found' }, 404);

  const tags = JSON.parse(revision.tags) as string[];
  const previousRow = await db
    .prepare(`SELECT r2_prefix, version FROM revisions WHERE work_id = ? AND status = 'approved' AND id <> ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(revision.work_id, rid)
    .first<Pick<RevisionRow, 'r2_prefix' | 'version'>>();
  const previous = previousRow && (await loadRevisionFiles(c.env.PARTS, previousRow.r2_prefix));
  const creator = await db
    .prepare('SELECT c.handle, c.name, c.kind FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?')
    .bind(revision.work_id)
    .first<{ handle: string; name: string | null; kind: string }>();
  // リミックスの元（docs/tasks/T033.md B5）。取り下げられていても出す
  const source = await remixSource(db, revision.remix_of);

  return c.json({
    revision: {
      id: revision.id,
      work_id: revision.work_id,
      version: revision.version,
      status: revision.status,
      content_hash: revision.content_hash,
      title: revision.title,
      type: revision.type,
      platform: revision.platform,
      category: revision.category,
      subtype: revision.subtype,
      tags,
      made_with: revision.made_with,
      tokens_ok: revision.tokens_ok === 1,
      submitted_at: revision.submitted_at,
      frames: draftFrameUrls(revision.id),
      thumb: draftThumbUrl(revision.id),
      thumb_w: revision.thumb_w,
      thumb_h: revision.thumb_h,
    },
    creator,
    remix_of: source && { id: source.id, title: source.title, handle: source.handle, public: source.status === 'approved' },
    code: { html: files.html, css: files.css, js: files.js ?? null },
    previous: previous && previousRow ? { version: previousRow.version, html: previous.html, css: previous.css, js: previous.js ?? null } : null,
    check: checkSubmission({ id: revision.work_id, type: revision.type, tags, html: files.html, css: files.css, js: files.js ?? null }),
    flags: reviewFlags({ html: files.html, css: files.css, js: files.js ?? null }),
  });
});

/** 承認する。公開され、一覧の札を消す。見た中身のハッシュと違えば通さない。 */
review.post('/revisions/:rid/approve', async (c) => {
  const rid = c.req.param('rid');
  if (!REVISION_ID.test(rid)) return c.json({ error: 'not_found' }, 404);
  const body = await readJson(c);
  if (typeof body?.content_hash !== 'string' || !body.content_hash) return c.json({ error: 'bad_request' }, 400);
  const db = c.env.DB;
  const revision = await ownedRevision(db, rid);
  if (!revision) return c.json({ error: 'not_found' }, 404);
  if (revision.status !== 'submitted') return c.json({ error: 'not_submitted' }, 409);
  if (revision.content_hash !== body.content_hash) return c.json({ error: 'content_changed' }, 409);

  const now = Date.now();
  // 1つのトランザクション。版が承認できたときだけ（changes() > 0）、作品の公開の値を差し替える
  const [approved, published] = await db.batch([
    db
      .prepare(
        `UPDATE revisions SET status = 'approved', reviewed_at = ?1, reviewed_by = ?2, reject_code = NULL, reject_note = NULL, updated_at = ?1
         WHERE id = ?3 AND status = 'submitted' AND content_hash = ?4`,
      )
      .bind(now, c.get('user').id, rid, body.content_hash),
    db
      .prepare(
        `UPDATE works SET status = 'approved', reject_reason = NULL, title = ?1, type = ?2, platform = ?3, category = ?4, subtype = ?5, tags = ?6, made_with = ?7,
           version = ?8, thumb_key = ?9, thumb_w = ?10, thumb_h = ?11, published_at = COALESCE(published_at, ?12), is_remix = ?13
         WHERE id = ?14 AND changes() > 0`,
      )
      .bind(
        revision.title,
        revision.type,
        revision.platform,
        revision.category,
        revision.subtype,
        revision.tags,
        revision.made_with,
        revision.version,
        revisionFile(revision.r2_prefix, 'thumb.webp'),
        revision.thumb_w,
        revision.thumb_h,
        now,
        revision.is_remix,
        revision.work_id,
      ),
  ]);
  if (approved.meta.changes === 0 || published.meta.changes === 0) return c.json({ error: 'not_submitted' }, 409);
  const catalogPurged = await purge(c, [CATALOG_TAG]);
  return c.json({ id: rid, status: 'approved', work_id: revision.work_id, version: revision.version, catalog_purged: catalogPurged });
});

/** 差し戻す。理由は作り手に見える。前の公開の版はそのまま。 */
review.post('/revisions/:rid/reject', async (c) => {
  const rid = c.req.param('rid');
  if (!REVISION_ID.test(rid)) return c.json({ error: 'not_found' }, 404);
  const body = await readJson(c);
  const code = body?.reason;
  if (!(REJECT_CODES as readonly unknown[]).includes(code)) return c.json({ error: 'bad_reason' }, 400);
  const note = typeof body?.note === 'string' ? body.note.trim() : '';
  if ([...note].length > MAX_NOTE_CHARS) return c.json({ error: 'bad_note' }, 400);
  const now = Date.now();
  const result = await c.env.DB.prepare(
    `UPDATE revisions SET status = 'rejected', reject_code = ?1, reject_note = ?2, reviewed_at = ?3, reviewed_by = ?4, updated_at = ?3
     WHERE id = ?5 AND status = 'submitted'`,
  )
    .bind(code as RejectCode, note || null, now, c.get('user').id, rid)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not_submitted' }, 409);
  return c.json({ id: rid, status: 'rejected' });
});
