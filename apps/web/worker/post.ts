// 作り手が自分の作品を投稿する API（docs/tasks/T021.md 段階 A、SEC001 A04、A05、A07、B1-1、B1-5、B1-6）。管理 API（admin.ts）とは分ける。
//
// - 持ち主はセッションの人から決める。送られてきた handle、作者、状態、pin_order を受けない（知らない項目は断る）。
// - 作品の ID は、新しく作るときの名前としてだけ受ける。今ある作品を指すことはできない（他人のものは 403、自分のものは 409）。
// - 公開した版は変えない。直すと新しい版になり、もう一度審査する。直した版の審査中は、前の版がそのまま出る。
// - R2 のキーはサーバーが作る（版の id と中身のハッシュ）。
// - D1 と R2 に書くのは、全部の確かめが通った後だけ。

import {
  CATEGORIES,
  ID_PATTERN,
  MADE_WITH,
  MAX_PART_BYTES,
  MAX_TITLE_CHARS,
  SUBTYPES,
  TAGS,
  checkSubmission,
  workShape,
  type Category,
  type ProblemText,
} from '@ludion/rules';
import { Hono, type Context } from 'hono';
import { isRemixSource } from '../src/lib/isRemix';
import { CATALOG_TAG, workTag } from './cachePolicy';
import type { Env } from './env';
import { isSameOrigin } from './origin';
import { purgeWithRetry } from './purge';
import { takePostQuota } from './quota';
import { PRIVATE_WORKS_LIMIT, REVISION_ID, canPost, countPrivateWorks, draftFrameUrls, draftThumbUrl, loadRevisionFiles, ownedRevision, ownedWork, revisionFile, type RevisionRow } from './revisions';
import { getSessionUser, randomHex, type SessionUser } from './session';
import type { ThumbError, ThumbResult } from './thumb';
import { CONTENT_TYPES, compareVersions } from './upload';

type PostEnv = { Bindings: Env; Variables: { user: SessionUser } };
type PostContext = Context<PostEnv>;

/** 1回に受け取る上限。実際に読んだバイト数で止める（Content-Length を信じない。SEC001 A05）。 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_META_BYTES = 4 * 1024;
const FILE_FIELDS = new Set(['part.html', 'part.css', 'part.js', 'thumb']);
const META_KEYS = new Set(['id', 'title', 'category', 'subtype', 'tags', 'motion', 'made_with', 'remix_of']);
const ID_MIN = 3;
const ID_MAX = 60;
/** 取り下げの理由。人には見せない（reject_reason の決まった値）。 */
const REASON_OWNER_REVOKED = 'owner_revoked';
const MAX_JSON_BYTES = 1024;

export const post = new Hono<PostEnv>();

post.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && !isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  c.set('user', user);
  await next();
});

const purge = (c: PostContext, tags: string[]) => purgeWithRetry((c.executionCtx as unknown as ExecutionContext).cache, tags);

/** 本文を読む。上限を超えたら、そこで読むのをやめて null。 */
async function readBody(request: Request): Promise<Uint8Array | null> {
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BODY_BYTES) {
      // 読むのをやめる。送り手が先に切っていても構わない
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

interface PostFields {
  meta: string;
  html: string;
  css: string;
  js: string | null;
  thumb: Uint8Array | null;
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

/** multipart を読む。名前は固定で、知らない名前と重複は断る。だめなら応答を返す。 */
async function readFields(c: PostContext): Promise<PostFields | Response> {
  const contentType = c.req.header('Content-Type') ?? '';
  if (!/^multipart\/form-data\b/i.test(contentType)) return c.json({ error: 'bad_request' }, 400);
  const bytes = await readBody(c.req.raw);
  if (!bytes) return c.json({ error: 'too_large' }, 413);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData();
  } catch {
    return c.json({ error: 'bad_request' }, 400);
  }

  const values = new Map<string, Uint8Array>();
  for (const [name, value] of form.entries() as Iterable<[string, string | File]>) {
    if (name !== 'meta' && !FILE_FIELDS.has(name)) return c.json({ error: 'unknown_field' }, 400);
    if (values.has(name)) return c.json({ error: 'duplicate_field' }, 400);
    if (name === 'thumb' && typeof value === 'string') return c.json({ error: 'bad_request' }, 400);
    values.set(name, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(await value.arrayBuffer()));
  }
  const meta = values.get('meta');
  if (!meta || meta.length > MAX_META_BYTES) return c.json({ error: 'bad_meta' }, 400);
  for (const name of ['part.html', 'part.css', 'part.js']) {
    if ((values.get(name)?.length ?? 0) > MAX_PART_BYTES) return c.json({ error: 'too_large' }, 413);
  }
  try {
    // 改行は LF に揃える（FormData の文字列は CRLF に変わり、Windows のファイルも CRLF）。差分と中身のハッシュが改行で変わらないように
    const text = (name: string) => {
      const value = values.get(name);
      return value ? decoder.decode(value).replace(/\r\n?/g, '\n') : null;
    };
    const js = text('part.js');
    return {
      meta: text('meta')!,
      html: text('part.html') ?? '',
      css: text('part.css') ?? '',
      // 空の part.js は、ないのと同じ
      js: js !== null && js.trim() !== '' ? js : null,
      thumb: values.get('thumb') ?? null,
    };
  } catch {
    return c.json({ error: 'bad_encoding' }, 400);
  }
}

interface PostMeta {
  id: string | null;
  /** 下書きは空でよい。審査に出すときに要る（docs/tasks/T033.md A3） */
  title: string;
  /** リミックスの元。undefined は送られていない（直す版は作品の値を引き継ぐ） */
  remix_of: string | null | undefined;
  category: Category;
  subtype: string;
  tags: string[];
  made_with: (typeof MADE_WITH)[number];
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** 投稿の項目を読む。知らない項目（publish、pin_order、creator、kind など）は断る。タグは種類から足す。 */
function parseMeta(text: string): PostMeta | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'bad_meta' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'bad_meta' };
  const meta = raw as Record<string, unknown>;
  if (Object.keys(meta).some((key) => !META_KEYS.has(key))) return { error: 'unknown_field' };

  if (meta.title !== undefined && typeof meta.title !== 'string') return { error: 'bad_title' };
  const title = typeof meta.title === 'string' ? meta.title.trim() : '';
  if ([...title].length > MAX_TITLE_CHARS || CONTROL.test(title)) return { error: 'bad_title' };
  const category = meta.category as Category;
  if (!(CATEGORIES as readonly unknown[]).includes(category)) return { error: 'bad_category' };
  if (typeof meta.subtype !== 'string' || !SUBTYPES[category].includes(meta.subtype)) return { error: 'bad_subtype' };
  if (!(MADE_WITH as readonly unknown[]).includes(meta.made_with)) return { error: 'bad_made_with' };
  if (!Array.isArray(meta.tags) || meta.tags.some((tag) => !(TAGS as readonly unknown[]).includes(tag))) return { error: 'bad_tags' };
  if (meta.motion !== undefined && typeof meta.motion !== 'boolean') return { error: 'bad_tags' };
  if (meta.id !== undefined && typeof meta.id !== 'string') return { error: 'bad_id' };
  if (meta.remix_of !== undefined && meta.remix_of !== null && (typeof meta.remix_of !== 'string' || !ID_PATTERN.test(meta.remix_of))) return { error: 'bad_remix_of' };

  const tags = new Set(meta.tags as string[]);
  tags.delete('motion');
  tags.delete('dashboard');
  tags.delete('ecommerce');
  if (category === 'Dashboard') tags.add('dashboard');
  if (category === 'Ecommerce' || meta.subtype === 'Ecommerce') tags.add('ecommerce');
  if (meta.motion === true) tags.add('motion');
  return {
    id: (meta.id as string | undefined) ?? null,
    title,
    category,
    subtype: meta.subtype,
    tags: [...tags],
    made_with: meta.made_with as PostMeta['made_with'],
    remix_of: meta.remix_of as PostMeta['remix_of'],
  };
}

export type IdStatus = 'ok' | 'format' | 'reserved' | 'taken';

/** 新しい作品の ID を取れるか。ludion を含むものは、運営のものに見えるので取れない。 */
async function checkWorkId(db: D1Database, id: string): Promise<IdStatus> {
  if (id.length < ID_MIN || id.length > ID_MAX || !ID_PATTERN.test(id)) return 'format';
  if (id.includes('ludion')) return 'reserved';
  return (await db.prepare('SELECT 1 FROM works WHERE id = ?').bind(id).first()) ? 'taken' : 'ok';
}

/** 投稿する人の作者。なければ、その人の handle で作って結ぶ（作者を名乗れるのは結ばれた人だけ）。 */
async function ensureCreator(db: D1Database, user: SessionUser): Promise<{ id: string; handle: string } | null> {
  const select = db.prepare('SELECT id, handle FROM creators WHERE user_id = ? ORDER BY handle = ? COLLATE NOCASE DESC, created_at LIMIT 1').bind(user.id, user.handle);
  const own = await select.first<{ id: string; handle: string }>();
  if (own) return own;
  try {
    await db
      .prepare(`INSERT INTO creators (id, handle, name, kind, x_url, site_url, user_id, created_at) SELECT ?1, handle, display_name, 'person', x_url, site_url, id, ?3 FROM users WHERE id = ?2`)
      .bind(crypto.randomUUID(), user.id, Date.now())
      .run();
  } catch {
    // 同時に作られたなら、それを使う。下でも見つからなければ、handle がほかの作者とぶつかっている
  }
  return select.first<{ id: string; handle: string }>();
}

async function sha256Hex(parts: (string | Uint8Array)[]): Promise<string> {
  const encoder = new TextEncoder();
  const chunks = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
  const joined = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length + 8, 0));
  const view = new DataView(joined.buffer);
  let at = 0;
  for (const chunk of chunks) {
    // 長さを入れて、ファイルの境目を動かしても同じハッシュにならないようにする
    view.setBigUint64(at, BigInt(chunk.length));
    at += 8;
    joined.set(chunk, at);
    at += chunk.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const THUMB_STATUS: Record<ThumbError, string> = {
  format: 'thumb_format',
  animated: 'thumb_animated',
  too_large: 'thumb_too_large',
  too_small: 'thumb_too_small',
  broken: 'thumb_broken',
};

/** 次の版の番号。今までのどの版より大きい整数。 */
function nextVersion(versions: string[]): string {
  const highest = versions.reduce((max, version) => Math.max(max, Number(version.split('.')[0]) || 0), 0);
  const next = String(highest + 1);
  return versions.every((version) => compareVersions(next, version) > 0) ? next : String(highest + 2);
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<void> {
  await bucket.delete(['meta.json', 'part.html', 'part.css', 'part.js', 'thumb.webp', 'og.png'].map((name) => revisionFile(prefix, name)));
}

/** 下書きの保存。新しい作品（workId が null）、新しい版、今の下書きの上書きのどれか。 */
async function saveDraft(c: PostContext, workId: string | null): Promise<Response> {
  const user = c.get('user');
  const db = c.env.DB;
  if (!canPost(c.env, user)) return c.json({ error: 'not_found' }, 404);

  // 持ち主を先に確かめる。他人の作品なら、本文を読まずに断る
  const work = workId === null ? null : await ownedWork(db, workId);
  if (workId !== null) {
    if (!work) return c.json({ error: 'not_found' }, 404);
    if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  }

  const fields = await readFields(c);
  if (fields instanceof Response) return fields;
  const meta = parseMeta(fields.meta);
  if ('error' in meta) return c.json({ error: meta.error }, 400);

  let id: string;
  if (workId === null) {
    if (meta.id === null) return c.json({ error: 'bad_id' }, 400);
    id = meta.id;
    const status = await checkWorkId(db, id);
    if (status === 'taken') {
      const existing = await ownedWork(db, id);
      return existing?.owner_id === user.id ? c.json({ error: 'exists' }, 409) : c.json({ error: 'forbidden' }, 403);
    }
    if (status !== 'ok') return c.json({ error: 'bad_id', status }, 400);
  } else {
    // 今ある作品の ID は変えられない
    if (meta.id !== null && meta.id !== workId) return c.json({ error: 'bad_id' }, 400);
    id = workId;
  }

  // リミックスの元（docs/tasks/T033.md B3）。送られてきた値をそのまま信じない：元が承認済みの作品で、自分自身でないこと。
  // 作品を作った後は変えられない。直した版は、作品の remix_of を引き継ぐ
  let remixOf: string | null;
  if (work) {
    if (meta.remix_of !== undefined && meta.remix_of !== work.remix_of) return c.json({ error: 'bad_remix_of' }, 400);
    remixOf = work.remix_of;
  } else {
    remixOf = meta.remix_of ?? null;
    if (remixOf !== null && (remixOf === id || !(await db.prepare(`SELECT 1 FROM works WHERE id = ? AND status = 'approved'`).bind(remixOf).first()))) {
      return c.json({ error: 'bad_remix_of' }, 400);
    }
  }

  const { results: revisions } = await db
    .prepare('SELECT id, version, status, r2_prefix, created_at FROM revisions WHERE work_id = ? ORDER BY created_at DESC, rowid DESC')
    .bind(id)
    .all<Pick<RevisionRow, 'id' | 'version' | 'status' | 'r2_prefix' | 'created_at'>>();
  const open = revisions.find((revision) => revision.status === 'draft' || revision.status === 'submitted');
  // 審査中の版は変えない。見ているものと承認するものがずれないように
  if (open?.status === 'submitted') return c.json({ error: 'in_review' }, 409);

  const { type, platform } = workShape(meta.category);
  const check = checkSubmission({ id, type, tags: meta.tags, html: fields.html, css: fields.css, js: fields.js });
  if (check.required.length > 0) return c.json({ error: 'invalid', problems: check.required, optional: check.optional }, 422);
  // 下書きはサムネイルなしで保存できる。要るのは審査に出すとき（docs/tasks/T033.md A3）

  const limited = await takePostQuota(db, user.id, !open);
  if (limited) return c.json({ error: 'rate_limited', limit: limited }, 429);

  let images: Pick<ThumbResult, 'thumb' | 'og' | 'width' | 'height'> | null = null;
  if (fields.thumb) {
    // wasm は要るときだけ読む（Worker の起動を重くしない）
    const { processThumb } = await import('./thumb');
    const made = await processThumb(fields.thumb);
    if ('error' in made) return c.json({ error: THUMB_STATUS[made.error] }, 422);
    images = made;
  } else if (revisions.length > 0) {
    // 画像を出さずに直すときは、いちばん新しい版の画像を引き継ぐ。その版にも画像がなければ、画像なしの下書きのまま
    const base = revisions[0];
    const dimensions = await db.prepare('SELECT thumb_w, thumb_h FROM revisions WHERE id = ?').bind(base.id).first<{ thumb_w: number; thumb_h: number }>();
    if (dimensions && dimensions.thumb_w > 0) {
      const [thumbObject, ogObject] = await Promise.all([c.env.PARTS.get(revisionFile(base.r2_prefix, 'thumb.webp')), c.env.PARTS.get(revisionFile(base.r2_prefix, 'og.png'))]);
      if (thumbObject && ogObject) {
        images = { thumb: new Uint8Array(await thumbObject.arrayBuffer()), og: new Uint8Array(await ogObject.arrayBuffer()), width: dimensions.thumb_w, height: dimensions.thumb_h };
      }
    }
  }

  const creator = work ? { id: work.creator_id, handle: work.creator_handle } : await ensureCreator(db, user);
  if (!creator) return c.json({ error: 'conflict' }, 409);

  const revisionId = open?.id ?? randomHex(16);
  const version = open?.version ?? nextVersion(revisions.map((revision) => revision.version));
  const now = Date.now();
  const metaJson = JSON.stringify({
    id,
    title: meta.title,
    type,
    platform,
    category: meta.category,
    subtype: meta.subtype,
    tags: meta.tags,
    creator: creator.handle,
    license: 'MIT',
    made_with: meta.made_with,
    version,
    published_at: new Date(now).toISOString().slice(0, 10),
    pin_order: null,
  });
  const contentHash = await sha256Hex([metaJson, fields.html, fields.css, fields.js ?? '', ...(images ? [images.thumb, images.og] : [])]);
  const prefix = `revisions/${revisionId}/${contentHash.slice(0, 16)}`;
  const files: [string, Uint8Array | string, string][] = [
    ['meta.json', metaJson, CONTENT_TYPES['meta.json']],
    ['part.html', fields.html, CONTENT_TYPES['part.html']],
    ['part.css', fields.css, CONTENT_TYPES['part.css']],
    ...(fields.js !== null ? ([['part.js', fields.js, CONTENT_TYPES['part.js']]] as [string, string, string][]) : []),
    ...(images
      ? ([
          ['thumb.webp', images.thumb, CONTENT_TYPES['thumb.webp']],
          ['og.png', images.og, CONTENT_TYPES['og.png']],
        ] as [string, Uint8Array, string][])
      : []),
  ];
  await Promise.all(files.map(([name, body, contentType]) => c.env.PARTS.put(revisionFile(prefix, name), body, { httpMetadata: { contentType } })));

  const tags = JSON.stringify(meta.tags);
  const tokensOk = check.optional.length === 0 ? 1 : 0;
  // remix_of があればリミックス。ないときは、コードの「Remix by」を探す（ld upload の作品と同じ判定）
  const remix = remixOf !== null || isRemixSource(fields.html, fields.css, fields.js ?? '') ? 1 : 0;
  const thumbW = images?.width ?? 0;
  const thumbH = images?.height ?? 0;
  const insertRevision = db
    .prepare(
      `INSERT INTO revisions (id, work_id, version, status, r2_prefix, content_hash, title, type, platform, category, subtype, tags, made_with, thumb_w, thumb_h, tokens_ok, created_by, created_at, updated_at, is_remix, remix_of)
       VALUES (?1, ?2, ?3, 'draft', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17, ?18, ?19)`,
    )
    .bind(revisionId, id, version, prefix, contentHash, meta.title, type, platform, meta.category, meta.subtype, tags, meta.made_with, thumbW, thumbH, tokensOk, user.id, now, remix, remixOf);

  try {
    if (open) {
      const updated = await db
        .prepare(
          `UPDATE revisions SET r2_prefix = ?1, content_hash = ?2, title = ?3, type = ?4, platform = ?5, category = ?6, subtype = ?7, tags = ?8, made_with = ?9, thumb_w = ?10, thumb_h = ?11, tokens_ok = ?12, is_remix = ?13, updated_at = ?14
           WHERE id = ?15 AND status = 'draft'`,
        )
        .bind(prefix, contentHash, meta.title, type, platform, meta.category, meta.subtype, tags, meta.made_with, thumbW, thumbH, tokensOk, remix, now, revisionId)
        .run();
      // 確かめた後に、審査に出された
      if (updated.meta.changes === 0) throw new Error('not a draft');
    } else if (workId === null) {
      await db.batch([
        db
          .prepare(
            `INSERT INTO works (id, creator_id, title, type, platform, category, subtype, tags, made_with, version, license, status, thumb_key, thumb_w, thumb_h, created_at, is_remix, remix_of)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'MIT', 'draft', ?11, ?12, ?13, ?14, ?15, ?16)`,
          )
          .bind(id, creator.id, meta.title, type, platform, meta.category, meta.subtype, tags, meta.made_with, version, images ? revisionFile(prefix, 'thumb.webp') : '', thumbW, thumbH, now, remix, remixOf),
        insertRevision,
      ]);
    } else {
      await insertRevision.run();
    }
  } catch {
    // 同時に送られて、もう片方が先に通った。こちらのファイルは残さない
    if (open?.r2_prefix !== prefix) await deletePrefix(c.env.PARTS, prefix);
    return c.json({ error: 'conflict' }, 409);
  }
  if (open && open.r2_prefix !== prefix) await deletePrefix(c.env.PARTS, open.r2_prefix);

  return c.json(
    {
      work_id: id,
      revision: {
        id: revisionId,
        version,
        status: 'draft',
        content_hash: contentHash,
        frames: draftFrameUrls(revisionId),
        thumb: images ? draftThumbUrl(revisionId) : null,
        thumb_w: thumbW,
        thumb_h: thumbH,
      },
      remix_of: remixOf,
      optional: check.optional satisfies ProblemText[],
    },
    open ? 200 : 201,
  );
}

post.post('/works', (c) => saveDraft(c, null));
post.post('/works/:id/revisions', (c) => saveDraft(c, c.req.param('id')));

/** 新しい作品の ID を取れるか。画面で先に確かめる。 */
post.get('/id-check', async (c) => {
  if (!canPost(c.env, c.get('user'))) return c.json({ error: 'not_found' }, 404);
  return c.json({ status: await checkWorkId(c.env.DB, c.req.query('id') ?? '') });
});

/**
 * リミックスの元（/new?from=<id>。docs/tasks/T033.md B2）。承認済みの作品だけ。ほかは 404 で、画面は from を捨てる。
 * 先に入れておく種類、タグ、「動きがある」も返す。
 */
post.get('/remix-source/:id', async (c) => {
  if (!canPost(c.env, c.get('user'))) return c.json({ error: 'not_found' }, 404);
  const id = c.req.param('id');
  if (!ID_PATTERN.test(id)) return c.json({ error: 'not_found' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT w.id, w.title, w.category, w.subtype, w.tags, c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ? AND w.status = 'approved'`,
  )
    .bind(id)
    .first<{ id: string; title: string; category: string; subtype: string; tags: string; handle: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...row, tags: JSON.parse(row.tags) as string[] });
});

/**
 * 一度も審査に出していない作品を消す。「細かく直す」で作品の ID を変えるときに使う（新しい ID で保存し直してから、前の下書きを消す）。
 * 審査に出したことのある作品は消さない（取り下げを使う）。
 */
post.post('/works/:id/discard', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const work = await ownedWork(db, c.req.param('id'));
  if (!work) return c.json({ error: 'not_found' }, 404);
  if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  const { results } = await db
    .prepare('SELECT id, status, submitted_at, r2_prefix FROM revisions WHERE work_id = ?')
    .bind(work.id)
    .all<Pick<RevisionRow, 'id' | 'status' | 'submitted_at' | 'r2_prefix'>>();
  if (work.status !== 'draft' || results.some((revision) => revision.status !== 'draft' || revision.submitted_at !== null)) return c.json({ error: 'not_draft' }, 409);
  // 確かめた後に審査に出されたら、消さない
  const [deleted] = await db.batch([
    db.prepare(`DELETE FROM works WHERE id = ?1 AND status = 'draft' AND NOT EXISTS (SELECT 1 FROM revisions WHERE work_id = ?1 AND (status <> 'draft' OR submitted_at IS NOT NULL))`).bind(work.id),
    db.prepare(`DELETE FROM revisions WHERE work_id = ?1 AND NOT EXISTS (SELECT 1 FROM works WHERE id = ?1)`).bind(work.id),
  ]);
  if (deleted.meta.changes === 0) return c.json({ error: 'not_draft' }, 409);
  await Promise.all(results.map((revision) => deletePrefix(c.env.PARTS, revision.r2_prefix)));
  return c.json({ id: work.id, status: 'discarded' });
});

/** 自分の作品を全部。状態は、いちばん新しい版のもの。 */
post.get('/works', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.status AS work_status, w.version AS public_version, r.id AS revision_id, r.version, r.status, r.title, r.category, r.subtype, r.thumb_w, r.thumb_h, r.reject_code, r.reject_note, r.updated_at,
       (SELECT COUNT(*) FROM revisions v WHERE v.work_id = w.id) AS versions
     FROM works w
     JOIN creators c ON c.id = w.creator_id
     JOIN revisions r ON r.id = (SELECT id FROM revisions WHERE work_id = w.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     WHERE c.user_id = ?
     ORDER BY r.updated_at DESC, w.id`,
  )
    .bind(c.get('user').id)
    .all<{ work_status: string; public_version: string; revision_id: string } & Record<string, unknown>>();
  return c.json({
    works: results.map((row) => ({
      ...row,
      public: row.work_status === 'approved',
      // 自分だけの作品（docs/tasks/T036.md「3」）。public_version はこのとき、本人だけが見る今の版
      private: row.work_status === 'private',
      thumb: Number(row.thumb_w) > 0 ? draftThumbUrl(row.revision_id) : null,
    })),
  });
});

/** 直すために、自分の作品のいちばん新しい版を全部読む。 */
post.get('/works/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const work = await ownedWork(db, c.req.param('id'));
  if (!work) return c.json({ error: 'not_found' }, 404);
  if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  const revision = await db.prepare('SELECT * FROM revisions WHERE work_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(work.id).first<RevisionRow>();
  if (!revision) return c.json({ error: 'not_found' }, 404);
  const files = await loadRevisionFiles(c.env.PARTS, revision.r2_prefix);
  if (!files) return c.json({ error: 'not_found' }, 404);
  return c.json({
    id: work.id,
    public: work.status === 'approved',
    private: work.status === 'private',
    public_version: work.version,
    revision: {
      id: revision.id,
      version: revision.version,
      status: revision.status,
      title: revision.title,
      category: revision.category,
      subtype: revision.subtype,
      tags: JSON.parse(revision.tags) as string[],
      made_with: revision.made_with,
      reject_code: revision.reject_code,
      reject_note: revision.reject_note,
      frames: draftFrameUrls(revision.id),
      thumb: revision.thumb_w > 0 ? draftThumbUrl(revision.id) : null,
      thumb_w: revision.thumb_w,
      thumb_h: revision.thumb_h,
    },
    remix_of: work.remix_of,
    html: files.html,
    css: files.css,
    js: files.js,
  });
});

async function readConfirmations(c: PostContext): Promise<boolean> {
  if (Number(c.req.header('Content-Length') ?? '0') > MAX_JSON_BYTES) return false;
  const body = (await c.req.json().catch(() => null)) as { own?: unknown; mit?: unknown; terms?: unknown } | null;
  return body?.own === true && body.mit === true && body.terms === true;
}

/** 下書きを審査に出す。自分で作った、MIT で公開してよい、利用規約に同意、の3つが要る。 */
post.post('/revisions/:rid/submit', async (c) => {
  const rid = c.req.param('rid');
  if (!REVISION_ID.test(rid)) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const user = c.get('user');
  if (!canPost(c.env, user)) return c.json({ error: 'not_found' }, 404);
  const revision = await ownedRevision(db, rid);
  if (!revision) return c.json({ error: 'not_found' }, 404);
  if (revision.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (!(await readConfirmations(c))) return c.json({ error: 'confirm_required' }, 400);
  // 下書きは題とサムネイルなしで保存できる。審査に出すには両方が要る（docs/tasks/T033.md A3）
  if (revision.title.trim() === '') return c.json({ error: 'title_required' }, 422);
  if (revision.thumb_w <= 0) return c.json({ error: 'thumb_required' }, 422);
  const now = Date.now();
  const result = await db
    .prepare(`UPDATE revisions SET status = 'submitted', submitted_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'draft' AND title <> '' AND thumb_w > 0`)
    .bind(now, rid)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not_draft' }, 409);
  return c.json({ id: rid, status: 'submitted' });
});

/** 自分の作品を取り下げる。公開から消える。直している最中の版も止まる。もう一度出すには、新しい版を作って審査に出す。 */
post.post('/works/:id/revoke', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const work = await ownedWork(db, c.req.param('id'));
  if (!work) return c.json({ error: 'not_found' }, 404);
  if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  const now = Date.now();
  await db.batch([
    db.prepare(`UPDATE works SET status = 'rejected', reject_reason = ? WHERE id = ?`).bind(REASON_OWNER_REVOKED, work.id),
    // 差し戻しの版も。いちばん新しい版の状態を画面に出すので、残すと取り下げたように見えない
    db.prepare(`UPDATE revisions SET status = 'revoked', updated_at = ? WHERE work_id = ? AND status <> 'revoked'`).bind(now, work.id),
  ]);
  // サムネイルも消す。当たると Worker を通らないので、取り下げた作品の画像が出続ける
  const purged = work.status === 'approved' ? await purge(c, [CATALOG_TAG, workTag(work.id)]) : true;
  return c.json({ id: work.id, status: 'revoked', catalog_purged: purged });
});

/**
 * 自分だけで置く（docs/tasks/T036.md「1」）。審査に出さず、すぐ今の版になる。本人だけが見られる。
 * 検査は保存のときに通っている。同意の3つと題は、審査に出すときと同じに要る。サムネイルは無くてよい。
 * 公開している作品の新しい版は、今までどおり審査する（原則5）ので、ここでは置けない。
 */
post.post('/revisions/:rid/place', async (c) => {
  const rid = c.req.param('rid');
  if (!REVISION_ID.test(rid)) return c.json({ error: 'not_found' }, 404);
  const db = c.env.DB;
  const user = c.get('user');
  if (!canPost(c.env, user)) return c.json({ error: 'not_found' }, 404);
  const revision = await ownedRevision(db, rid);
  if (!revision) return c.json({ error: 'not_found' }, 404);
  if (revision.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (!(await readConfirmations(c))) return c.json({ error: 'confirm_required' }, 400);
  if (revision.status !== 'draft') return c.json({ error: 'not_draft' }, 409);
  if (revision.work_status === 'approved') return c.json({ error: 'public' }, 409);
  if (revision.title.trim() === '') return c.json({ error: 'title_required' }, 422);
  if (revision.work_status !== 'private' && (await countPrivateWorks(db, user.id, revision.work_id)) >= PRIVATE_WORKS_LIMIT) {
    return c.json({ error: 'private_limit', limit: PRIVATE_WORKS_LIMIT }, 409);
  }
  const now = Date.now();
  // 1つのトランザクション。版が置けたときだけ（changes() > 0）、作品の今の値をこの版にする。確かめた後に公開された作品には置かない
  const [placed, current] = await db.batch([
    db
      .prepare(
        `UPDATE revisions SET status = 'private', updated_at = ?1
         WHERE id = ?2 AND status = 'draft' AND title <> '' AND EXISTS (SELECT 1 FROM works WHERE id = ?3 AND status <> 'approved')`,
      )
      .bind(now, rid, revision.work_id),
    db
      .prepare(
        `UPDATE works SET status = 'private', reject_reason = NULL, title = ?1, type = ?2, platform = ?3, category = ?4, subtype = ?5, tags = ?6, made_with = ?7,
           version = ?8, thumb_key = ?9, thumb_w = ?10, thumb_h = ?11, is_remix = ?12
         WHERE id = ?13 AND status <> 'approved' AND changes() > 0`,
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
        revision.thumb_w > 0 ? revisionFile(revision.r2_prefix, 'thumb.webp') : '',
        revision.thumb_w,
        revision.thumb_h,
        revision.is_remix,
        revision.work_id,
      ),
  ]);
  if (placed.meta.changes === 0 || current.meta.changes === 0) return c.json({ error: 'not_draft' }, 409);
  return c.json({ id: rid, status: 'private', work_id: revision.work_id, version: revision.version });
});

/**
 * 自分だけ → 公開する（docs/tasks/T036.md「4」）。今の版を審査に出す。承認されるまで、ほかの人には見えないまま。
 * 差し戻されたら自分だけのまま。前に公開していた版でも、もう一度審査する。
 */
post.post('/works/:id/publish', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  if (!canPost(c.env, user)) return c.json({ error: 'not_found' }, 404);
  const work = await ownedWork(db, c.req.param('id'));
  if (!work) return c.json({ error: 'not_found' }, 404);
  if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (!(await readConfirmations(c))) return c.json({ error: 'confirm_required' }, 400);
  if (work.status !== 'private') return c.json({ error: 'not_private' }, 409);
  const revision = await db.prepare('SELECT * FROM revisions WHERE work_id = ? AND version = ?').bind(work.id, work.version).first<RevisionRow>();
  if (!revision || (revision.status !== 'private' && revision.status !== 'approved')) return c.json({ error: 'not_placed' }, 409);
  if (revision.title.trim() === '') return c.json({ error: 'title_required' }, 422);
  if (revision.thumb_w <= 0) return c.json({ error: 'thumb_required' }, 422);
  // 承認は見た中身のハッシュで結ぶ。ld upload の版はハッシュがないので、ここからは出せない
  if (!revision.content_hash) return c.json({ error: 'not_placed' }, 409);
  const now = Date.now();
  let changes: number;
  try {
    const result = await db
      .prepare(
        `UPDATE revisions SET status = 'submitted', submitted_at = ?1, updated_at = ?1
         WHERE id = ?2 AND status IN ('private', 'approved') AND title <> '' AND thumb_w > 0
           AND EXISTS (SELECT 1 FROM works WHERE id = ?3 AND status = 'private' AND version = ?4)`,
      )
      .bind(now, revision.id, work.id, revision.version)
      .run();
    changes = result.meta.changes;
  } catch {
    // 直している途中の下書きがある（直している版は1つの作品に1つまで）
    return c.json({ error: 'has_draft' }, 409);
  }
  if (changes === 0) return c.json({ error: 'not_placed' }, 409);
  return c.json({ id: work.id, status: 'submitted', revision_id: revision.id, version: revision.version });
});

/**
 * 公開 → 自分だけにする（docs/tasks/T036.md「4」）。すぐ。審査はしない。ホームと検索から消え、リンクを開いても 404 になる。
 * 閲覧数とコピー数、ほかの人のリミックスは残す。審査待ちの新しい版は審査から外して下書きに戻す（承認で公開に戻らないように）。
 */
post.post('/works/:id/make-private', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const work = await ownedWork(db, c.req.param('id'));
  if (!work) return c.json({ error: 'not_found' }, 404);
  if (work.owner_id !== user.id) return c.json({ error: 'forbidden' }, 403);
  if (work.status !== 'approved') return c.json({ error: 'not_public' }, 409);
  if ((await countPrivateWorks(db, user.id, work.id)) >= PRIVATE_WORKS_LIMIT) return c.json({ error: 'private_limit', limit: PRIVATE_WORKS_LIMIT }, 409);
  const now = Date.now();
  const [changed] = await db.batch([
    db.prepare(`UPDATE works SET status = 'private' WHERE id = ? AND status = 'approved'`).bind(work.id),
    db.prepare(`UPDATE revisions SET status = 'draft', updated_at = ?1 WHERE work_id = ?2 AND status = 'submitted' AND changes() > 0`).bind(now, work.id),
  ]);
  if (changed.meta.changes === 0) return c.json({ error: 'not_public' }, 409);
  // 一覧と作品のページ、サムネイルを、どの層からも消す（取り下げと同じ札）
  const purged = await purge(c, [CATALOG_TAG, workTag(work.id)]);
  return c.json({ id: work.id, status: 'private', catalog_purged: purged });
});
