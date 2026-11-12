// リンクで見せる（SHARE001）。自分だけの作品を、リンク（/s/<合言葉>）を知っている人だけが見られる形。
//
// - 作品の状態は3つ：自分だけ／リンクで見せる／公開。リンクで見せる作品も works.status は 'private' のまま。
//   一覧、検索、作り手のページ、sitemap、/api/works、MCP の一覧は、どれも approved だけを読むので、どこにも出ない。
// - 合言葉は 16 バイトの乱数の base64url（22 文字）。/p/<id> は今までどおり持ち主だけ（id は短いので住所に使わない）。
// - オフにすると合言葉を捨てる（古いリンクは 404）。もう一度オンにすると新しい合言葉。運営が止めると、合言葉を捨て、持ち主はオンにできない。
// - 変えられるのは、人がサイトで押したときだけ（/api/post の下。セッションの cookie と Origin の確かめ）。AI の口（/api/v1、MCP）からは変えられない。
//   AI の口は、持ち主の作品の今の状態と住所を読むだけ（apiV1.ts の workInfo）。
// - 合言葉は、ログ（log.ts は道の頭の1語だけ）、GA4（/s/ では読まない）、参照元（no-referrer）に出さない。

import type { Context } from 'hono';
import { shareOrigin, shareTag } from './cachePolicy';
import { purgeWithRetry } from './purge';
import { ownedWork } from './revisions';
import type { SessionUser } from './session';
import type { Env } from './env';

/** 合言葉の形。ほかの形では D1 を読まない。 */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** 128 ビットの乱数を base64url（= なし）にする。 */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const sharePath = (token: string) => `/s/${token}`;
export const shareFrameUrls = (token: string) => ({ desktop: `/share-frame/${token}/desktop.html`, mobile: `/share-frame/${token}/mobile.html` });
/** /s/ の HTML と本文の札（cachePolicy.ts）。合言葉ごと。オフ、運営が止めた、新しい版、公開、取り下げ、退会のときに消す。 */
export { shareTag };

/** /s/ のページ、本文、枠の応答の頭。住所を参照元に載せない。検索に出さない。 */
export const SHARE_HEADERS = { 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } as const;

export interface SharedRow {
  id: string;
  status: string;
  owner_id: string | null;
  r2_prefix: string | null;
  revision_id: string | null;
  version: string;
}

/**
 * 合言葉から作品を探す。見せてよいのは、作品が自分だけ（private）で、運営が止めていず、今の版があるときだけ。
 * 公開になった作品は、作品のページへ送る（public）。ほかは null（ない住所と同じ 404）。
 */
export async function sharedWork(db: D1Database, token: string): Promise<{ kind: 'private'; row: SharedRow & { r2_prefix: string; owner_id: string } } | { kind: 'public'; id: string } | null> {
  if (!SHARE_TOKEN.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT w.id, w.status, w.version, w.share_blocked_at, c.user_id AS owner_id, r.r2_prefix, r.id AS revision_id
       FROM works w JOIN creators c ON c.id = w.creator_id
       LEFT JOIN revisions r ON r.work_id = w.id AND r.version = w.version
       WHERE w.share_token = ?`,
    )
    .bind(token)
    .first<SharedRow & { share_blocked_at: number | null }>();
  if (!row || row.share_blocked_at !== null) return null;
  if (row.status === 'approved') return { kind: 'public', id: row.id };
  if (row.status !== 'private' || !row.r2_prefix || !row.owner_id) return null;
  return { kind: 'private', row: { ...row, r2_prefix: row.r2_prefix, owner_id: row.owner_id } };
}

/** 作品の今の見せ方。off：自分だけ／on：リンクで見せる／blocked：運営が止めた／unavailable：自分だけの作品でない（公開、審査待ちの初めての版など） */
export type ShareState = 'off' | 'on' | 'blocked' | 'unavailable';

interface ShareColumns {
  status: string;
  share_token: string | null;
  share_blocked_at: number | null;
}

export const shareStateOf = (row: ShareColumns): ShareState =>
  row.share_blocked_at !== null ? 'blocked' : row.status !== 'private' ? 'unavailable' : row.share_token ? 'on' : 'off';

/** 持ち主に返す形。url はいつも本番の住所（workers.dev で開いていても ludion.ai）。 */
export const shareInfo = (requestUrl: string, row: ShareColumns) => {
  const state = shareStateOf(row);
  return { state, url: state === 'on' && row.share_token ? `${shareOrigin(requestUrl)}${sharePath(row.share_token)}` : null };
};

export async function shareColumns(db: D1Database, workId: string): Promise<ShareColumns | null> {
  return db.prepare('SELECT status, share_token, share_blocked_at FROM works WHERE id = ?').bind(workId).first<ShareColumns>();
}

/** 作品の札と同じく、合言葉の札を消す。手元のサーバーにはキャッシュがないので、いつも true。失敗しても s-maxage の 60 秒で消える。 */
export const purgeShare = (c: Context, tokens: (string | null | undefined)[]) => {
  const tags = tokens.filter((token): token is string => typeof token === 'string' && token !== '').map(shareTag);
  return tags.length === 0 ? Promise.resolve(true) : purgeWithRetry((c.executionCtx as unknown as ExecutionContext).cache, tags);
};

type OwnerContext = Context<{ Bindings: Env; Variables: { user: SessionUser } }>;

const ID_PATTERN = /^[a-z0-9-]{1,60}$/;

async function ownWork(c: OwnerContext) {
  const id = c.req.param('id') ?? '';
  const work = ID_PATTERN.test(id) ? await ownedWork(c.env.DB, id) : null;
  return work && work.owner_id === c.get('user').id ? work : null;
}

/** GET /api/post/works/:id/share：今の見せ方と住所。持ち主だけ。ほかの人には 404。 */
export async function getShare(c: OwnerContext): Promise<Response> {
  const work = await ownWork(c);
  const row = work && (await shareColumns(c.env.DB, work.id));
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(shareInfo(c.req.url, row));
}

/**
 * POST /api/post/works/:id/share { on: boolean }：リンクで見せるのオンとオフ。持ち主だけ（セッションと Origin は post.ts の頭で確かめる）。
 * オンは、自分だけの作品で、運営が止めていないときだけ。もうオンなら、今の住所を返す（押し直しても住所は変わらない）。
 * オフは、合言葉を捨てて、キャッシュの札を消す。
 */
export async function setShare(c: OwnerContext): Promise<Response> {
  const work = await ownWork(c);
  if (!work) return c.json({ error: 'not_found' }, 404);
  const body = (await c.req.json().catch(() => null)) as { on?: unknown } | null;
  if (!body || typeof body.on !== 'boolean') return c.json({ error: 'bad_request' }, 400);
  const db = c.env.DB;
  const before = await shareColumns(db, work.id);
  if (!before) return c.json({ error: 'not_found' }, 404);
  if (before.share_blocked_at !== null) return c.json({ error: 'share_blocked', ...shareInfo(c.req.url, before) }, 403);

  if (body.on) {
    if (before.status !== 'private') return c.json({ error: 'not_private', ...shareInfo(c.req.url, before) }, 409);
    if (!before.share_token) {
      await db
        .prepare(`UPDATE works SET share_token = ?1, shared_at = ?2 WHERE id = ?3 AND status = 'private' AND share_blocked_at IS NULL AND share_token IS NULL`)
        .bind(newShareToken(), Date.now(), work.id)
        .run();
    }
  } else if (before.share_token) {
    await db.prepare('UPDATE works SET share_token = NULL, shared_at = NULL WHERE id = ?1 AND share_token = ?2').bind(work.id, before.share_token).run();
    await purgeShare(c, [before.share_token]);
  }
  const after = await shareColumns(db, work.id);
  return after ? c.json(shareInfo(c.req.url, after)) : c.json({ error: 'not_found' }, 404);
}

/** 運営の画面に入れた文字（/s/ の住所、合言葉、/p/ の住所、作品の ID）から、作品の ID を探す。 */
export async function workOfAddress(db: D1Database, address: string): Promise<string | null> {
  const text = address.trim();
  const token = /(?:^|\/s\/)([A-Za-z0-9_-]{22})(?:[/?#]|$)/.exec(text)?.[1];
  if (token) {
    const row = await db.prepare('SELECT id FROM works WHERE share_token = ?').bind(token).first<{ id: string }>();
    if (row) return row.id;
  }
  const id = /(?:^|\/p\/)([a-z0-9-]{1,60})(?:[/?#]|$)/.exec(text)?.[1];
  if (!id) return null;
  const row = await db.prepare('SELECT id FROM works WHERE id = ?').bind(id).first<{ id: string }>();
  return row?.id ?? null;
}

/** 作品の今の合言葉の札を消す（新しい版を置いた時。オフのときは何もしない）。 */
export async function purgeShareOf<E extends { Bindings: Env }>(c: Context<E>, workId: string): Promise<boolean> {
  const row = await c.env.DB.prepare('SELECT share_token FROM works WHERE id = ?').bind(workId).first<{ share_token: string | null }>();
  return purgeShare(c, [row?.share_token]);
}
