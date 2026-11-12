// 管理API（docs/tasks/T004.md「3」）。ld upload から作品を受け取り、D1 と R2 に置く。
//
// - POST /api/admin/works：multipart（ファイル名をフィールド名にする）。publish=true なら approved。
//   ないときは、新しい作品は draft、今ある作品は状態を変えずに版を差し替える（docs/tasks/T005.md「0」）
// - POST /api/admin/works/:id/unpublish：取り下げ（rejected）。JSON で { "reason": "…" } を付けてよい

import { Hono, type Context } from 'hono';
import { CATALOG_TAG, workTag } from './cachePolicy';
import type { Env } from './env';
import { logError } from './log';
import { OUTLINE_CONTENT_TYPE, OUTLINE_FILE, outlineFromBytes } from './outline';
import { purgeWithRetry } from './purge';
import { isRemixSource } from '../src/lib/isRemix';
import { CONTENT_TYPES, checkUpload, compareVersions, contentTypeOf } from './upload';

type AdminEnv = { Bindings: Env };
type CreatorRow = { id: string; handle: string; kind: 'person' | 'label'; user_id: string | null };

/**
 * 1回に受け取る大きさの上限（全部のファイルの合計の目安）。壁紙の静止画（WALL002。1枚 12MB まで、3枚）が入る大きさ。
 * Worker は multipart を全部メモリーに読むので、Worker のメモリー（128MB）の半分を超えない値にする。
 */
const MAX_BODY_BYTES = 40 * 1024 * 1024;

const encoder = new TextEncoder();

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

/** Bearer の管理トークンを、長さに依らない時間で比べる。 */
async function authorized(header: string | undefined, token: string | undefined): Promise<boolean> {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const [a, b] = await Promise.all([sha256(header.slice('Bearer '.length)), sha256(token)]);
  return crypto.subtle.timingSafeEqual(a, b);
}

export const admin = new Hono<AdminEnv>();

admin.use('*', async (c, next) => {
  // 状態を変える POST は、Origin が付いていれば自分のサイトであることを確かめる（CLAUDE.md「技術の決定」）。
  // ld upload は Origin を付けない
  const origin = c.req.header('Origin');
  if (origin !== undefined && origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden_origin' }, 403);
  if (!(await authorized(c.req.header('Authorization'), c.env.ADMIN_TOKEN))) {
    // 開発は apps/web/.dev.vars、本番は wrangler secret
    if (!c.env.ADMIN_TOKEN) logError('admin_token_missing');
    return c.json({ error: 'unauthorized', message: '管理トークンがない、または違う' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }
  await next();
});

/** ctx.cache で札を消す。Hono の ExecutionContext の型には cache がないので、Workers の型で読む。 */
const purge = (c: Context<AdminEnv>, tags: string[]) => purgeWithRetry((c.executionCtx as unknown as ExecutionContext).cache, tags);

/** R2 のキー。作品のファイルは works/<id>/<version>/（SPEC.md「7」）。 */
export const workKey = (id: string, version: string, name: string) => `works/${id}/${version}/${name}`;

async function readFiles(c: Context<AdminEnv>): Promise<{ files: Map<string, Uint8Array>; publish: boolean } | Response> {
  const length = Number(c.req.header('Content-Length') ?? '0');
  if (length > MAX_BODY_BYTES) return c.json({ error: 'too_large', message: `${MAX_BODY_BYTES / 1024 / 1024}MB まで` }, 413);
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: 'bad_request', message: 'multipart/form-data で送る' }, 400);
  }
  const files = new Map<string, Uint8Array>();
  let publish = false;
  for (const [name, value] of form.entries()) {
    if (name === 'publish') publish = value === 'true';
    else if (typeof value === 'string') files.set(name, encoder.encode(value));
    else files.set(name, new Uint8Array(await value.arrayBuffer()));
  }
  return { files, publish };
}

/** アバターの R2 のキー。中身が変わればキーも変わる（後で長くキャッシュするため）。 */
async function avatarKey(creatorId: string, avatar: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', avatar));
  const hex = [...digest.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `creators/${creatorId}/avatar-${hex}.webp`;
}

admin.post('/works', async (c) => {
  const body = await readFiles(c);
  if (body instanceof Response) return body;
  const checked = checkUpload(body.files);
  if (!checked.ok) {
    return c.json({ error: 'invalid', message: '検査で落ちた', failed: checked.failed }, 422);
  }
  const { work, warnings } = checked;
  const { meta, creator } = work;
  const db = c.env.DB;

  // 同じ版がもうあれば 409。今の版より古い版も置かない
  const current = await db.prepare('SELECT version, status FROM works WHERE id = ?').bind(meta.id).first<{ version: string; status: string }>();
  if (current) {
    const order = compareVersions(meta.version, current.version);
    if (order === 0) {
      return c.json({ error: 'conflict', message: `${meta.id} の版 ${meta.version} はもうある。中身を変えたら meta.json の version を上げる`, current: current.version }, 409);
    }
    if (order < 0) {
      return c.json({ error: 'conflict', message: `${meta.id} の今の版は ${current.version}。それより古い版 ${meta.version} は置かない`, current: current.version }, 409);
    }
  }

  const now = Date.now();
  const existing = await db
    .prepare('SELECT id, handle, kind, user_id FROM creators WHERE handle = ? COLLATE NOCASE')
    .bind(creator.handle)
    .first<CreatorRow>();
  // サイトで handle を変えた人は、creator.json の古い handle でも同じ作者（前の handle は handle_history に残る）
  const moved = existing
    ? null
    : await db
        .prepare('SELECT c.id, c.handle, c.kind, c.user_id FROM handle_history h JOIN creators c ON c.user_id = h.user_id WHERE h.handle = ? AND h.released_at > ?')
        .bind(creator.handle.toLowerCase(), now)
        .first<CreatorRow>();
  // 人が結ばれた作者は、サイトのプロフィールが正。handle、名前、リンク、アバターを上書きしない。作品だけを送る（docs/tasks/T021.md）
  const linked = existing?.user_id ? existing : moved;
  const creatorId = linked?.id ?? existing?.id ?? crypto.randomUUID();
  const avatar = linked ? null : await avatarKey(creatorId, work.avatar);

  // 中身の地図（WS002）。作れなくても置くことは止めない
  const bytesOf = (name: string) => work.files.find((file) => file.name === name)?.bytes ?? null;
  const outline = outlineFromBytes({ html: bytesOf('part.html'), css: bytesOf('part.css'), js: bytesOf('part.js'), document: null });

  // 先に R2 に置く。D1 に書けなかったときは、同じ版をもう一度送れば上書きされる
  await Promise.all([
    ...work.files.map((file) =>
      c.env.PARTS.put(workKey(meta.id, meta.version, file.name), file.bytes, { httpMetadata: { contentType: contentTypeOf(file.name) } }),
    ),
    ...(outline !== null ? [c.env.PARTS.put(workKey(meta.id, meta.version, OUTLINE_FILE), outline, { httpMetadata: { contentType: OUTLINE_CONTENT_TYPE } })] : []),
    ...(avatar ? [c.env.PARTS.put(avatar, work.avatar, { httpMetadata: { contentType: CONTENT_TYPES['avatar.webp'] } })] : []),
  ]);

  const status = body.publish ? 'approved' : (current?.status ?? 'draft');
  const publishedAt = status === 'approved' ? Date.parse(`${meta.published_at}T00:00:00Z`) : null;
  const thumbKey = workKey(meta.id, meta.version, 'thumb.webp');
  const decoder = new TextDecoder();
  const textOf = (name: string) => {
    const file = work.files.find((item) => item.name === name);
    return file ? decoder.decode(file.bytes) : '';
  };
  const remix = isRemixSource(textOf('part.html'), textOf('part.css'), textOf('part.js')) ? 1 : 0;
  await db.batch([
    ...(linked
      ? []
      : [
          db
            .prepare(
              `INSERT INTO creators (id, handle, name, kind, avatar_url, x_url, site_url, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
               ON CONFLICT (id) DO UPDATE SET handle = excluded.handle, name = excluded.name, kind = excluded.kind,
                 avatar_url = excluded.avatar_url, x_url = excluded.x_url, site_url = excluded.site_url`,
            )
            .bind(creatorId, creator.handle, creator.name, creator.kind, avatar, creator.x_url, creator.site_url, now),
        ]),
    db
      .prepare(
        `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status,
           pin_order, reject_reason, thumb_key, thumb_w, thumb_h, created_at, published_at, is_remix)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL, ?14, ?15, ?16, ?17, ?18, ?19)
         ON CONFLICT (id) DO UPDATE SET creator_id = excluded.creator_id, title = excluded.title, type = excluded.type,
           platform = excluded.platform, category = excluded.category, subtype = excluded.subtype, tags = excluded.tags,
           made_with = excluded.made_with, version = excluded.version, license = excluded.license, status = excluded.status,
           pin_order = excluded.pin_order, reject_reason = CASE WHEN excluded.status = 'rejected' THEN works.reject_reason END, thumb_key = excluded.thumb_key, thumb_w = excluded.thumb_w,
           thumb_h = excluded.thumb_h, published_at = excluded.published_at, is_remix = excluded.is_remix`,
      )
      .bind(
        meta.id,
        creatorId,
        meta.title,
        meta.type,
        meta.platform,
        meta.category,
        meta.subtype,
        JSON.stringify(meta.tags),
        meta.made_with,
        meta.version,
        meta.license,
        status,
        meta.pin_order,
        thumbKey,
        work.thumb.width,
        work.thumb.height,
        now,
        publishedAt,
        remix,
      ),
    // 直している最中の版は、この版で置き換える。公開の版はこの版の後も残る（古い HTML から読まれるため）
    db.prepare(`UPDATE revisions SET status = 'revoked', updated_at = ? WHERE work_id = ? AND status IN ('draft', 'submitted')`).bind(now, meta.id),
    db
      .prepare(
        `INSERT INTO revisions (id, work_id, version, status, r2_prefix, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, created_at, updated_at, is_remix)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16)
         ON CONFLICT (work_id, version) DO UPDATE SET status = excluded.status, r2_prefix = excluded.r2_prefix, content_hash = '', title = excluded.title, type = excluded.type, platform = excluded.platform,
           category = excluded.category, subtype = excluded.subtype, tags = excluded.tags, made_with = excluded.made_with, thumb_w = excluded.thumb_w, thumb_h = excluded.thumb_h, updated_at = excluded.updated_at, is_remix = excluded.is_remix`,
      )
      .bind(
        crypto.randomUUID().replaceAll('-', ''),
        meta.id,
        meta.version,
        status === 'rejected' ? 'revoked' : status,
        `works/${meta.id}/${meta.version}`,
        meta.title,
        meta.type,
        meta.platform,
        meta.category,
        meta.subtype,
        JSON.stringify(meta.tags),
        meta.made_with,
        work.thumb.width,
        work.thumb.height,
        now,
        remix,
      ),
  ]);

  // 承認と版の差し替えで、一覧が変わる。下書きは一覧に出ないので、消す回数を使わない
  const catalogPurged = status === 'approved' ? await purge(c, [CATALOG_TAG]) : true;

  return c.json(
    {
      id: meta.id,
      version: meta.version,
      previous_version: current?.version ?? null,
      status,
      creator: { id: creatorId, handle: linked?.handle ?? creator.handle, kind: linked?.kind ?? creator.kind },
      keys: work.files.map((file) => workKey(meta.id, meta.version, file.name)),
      warnings,
      catalog_purged: catalogPurged,
    },
    201,
  );
});

/** 1つの版だけを取り下げる（SEC001 A07）。今の公開の版なら、作品も公開から消す。前の版なら、今の版はそのまま。 */
admin.post('/revisions/:rid/revoke', async (c) => {
  const rid = c.req.param('rid');
  const db = c.env.DB;
  const revision = await db
    .prepare('SELECT r.work_id, r.version, w.version AS current_version FROM revisions r JOIN works w ON w.id = r.work_id WHERE r.id = ?')
    .bind(rid)
    .first<{ work_id: string; version: string; current_version: string }>();
  if (!revision) return c.json({ error: 'not_found' }, 404);
  const now = Date.now();
  const isCurrent = revision.version === revision.current_version;
  await db.batch([
    db.prepare("UPDATE revisions SET status = 'revoked', updated_at = ? WHERE id = ?").bind(now, rid),
    ...(isCurrent ? [db.prepare("UPDATE works SET status = 'rejected', reject_reason = 'revision_revoked' WHERE id = ? AND status = 'approved'").bind(revision.work_id)] : []),
  ]);
  const catalogPurged = await purge(c, isCurrent ? [CATALOG_TAG, workTag(revision.work_id)] : [workTag(revision.work_id)]);
  return c.json({ id: rid, status: 'revoked', work_id: revision.work_id, work_taken_down: isCurrent, catalog_purged: catalogPurged });
});

admin.post('/works/:id/unpublish', async (c) => {
  const id = c.req.param('id');
  let reason: string | null = null;
  if (c.req.header('Content-Type')?.includes('application/json')) {
    const body = (await c.req.json().catch(() => null)) as { reason?: unknown } | null;
    if (typeof body?.reason === 'string' && body.reason.trim()) reason = body.reason.trim().slice(0, 500);
  }
  const db = c.env.DB;
  const [result] = await db.batch([
    db.prepare("UPDATE works SET status = 'rejected', reject_reason = ? WHERE id = ?").bind(reason, id),
    db.prepare("UPDATE revisions SET status = 'revoked', updated_at = ? WHERE work_id = ? AND status <> 'revoked'").bind(Date.now(), id),
  ]);
  if (result.meta.changes === 0) return c.json({ error: 'not_found', message: `作品 ${id} がない` }, 404);
  // サムネイルも消す。当たると Worker を通らないので、取り下げた作品の画像が出続ける（CLAUDE.md 原則5）
  const catalogPurged = await purge(c, [CATALOG_TAG, workTag(id)]);
  return c.json({ id, status: 'rejected', reject_reason: reason, catalog_purged: catalogPurged });
});

