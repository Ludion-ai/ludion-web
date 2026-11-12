// サイトの口（WS006）：作品の地図 /p/<id>.json と、ファイルの生の文字 /p/<id>/raw/<file>。
//
// - 公開の作品は、だれにでも公開の版を返す。人によって変えない（cachePolicy.ts でキャッシュする。/p/:id/code と同じ扱い）。
// - 公開していない作品は、cookie も鍵も読んだうえで、持ち主にだけ自分だけの作品の今の版を返す。残さない（PRIVATE_HEADERS）。
//   本人の鍵は、セッションの cookie、AI の鍵（ld_…）、AI につないだトークン（ldo_…）。ほかの人（運営も）には、ない作品と同じ 404。
// - 鍵を試させないよう、IP の束縛（app.ts の LIMIT_COUNT）を鍵の確かめより先に置く。鍵で読んだ分は、AI の口の読み取りとして数える。
// - 開いても数えない（閲覧数は POST /api/count だけが増やす）。
// - 生の文字は text/plain と nosniff。頭にクレジット行（/p/:id/code と同じ決まり）を入れるので、行の番号は地図と、その行の数だけずれる。
//   行で読むのは AI の口（/api/v1/works/:id/code）。

import type { Context } from 'hono';
import { apiUser } from './apiV1';
import { shareOrigin } from './cachePolicy';
import type { Env } from './env';
import { takeApiQuota } from './quota';
import { getSessionUser } from './session';
import { creditTexts, loadFiles, loadMap, rawFile, readableWork, type ReadableWork } from './workRead';

type SiteContext = Context<{ Bindings: Env }>;

/** 自分だけの作品の応答の頭（pages.ts と同じ）。どの層にも残さない。 */
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const NOSNIFF = { 'X-Content-Type-Options': 'nosniff' };
const PLAIN_TEXT = { 'Content-Type': 'text/plain; charset=utf-8', ...NOSNIFF };

/**
 * 読む版。公開の作品は、cookie も鍵も読まずに公開の版。そうでなければ、本人の鍵を確かめて、自分だけの作品の今の版。
 * 'limited'：鍵の読み取りの上限に達した。
 */
async function siteTarget(c: SiteContext, id: string): Promise<ReadableWork | 'limited' | null> {
  const db = c.env.DB;
  const open = await readableWork(db, id, null, 'published');
  if (open && open !== 'version_changed') return open;
  const authorization = c.req.header('Authorization');
  let readerId: string | null;
  if (authorization !== undefined) {
    const user = await apiUser(db, authorization, undefined);
    if (!user) return null;
    if (!(await takeApiQuota(db, user.id, 'read'))) return 'limited';
    readerId = user.id;
  } else {
    readerId = (await getSessionUser(c))?.id ?? null;
  }
  if (readerId === null) return null;
  const own = await readableWork(db, id, readerId, 'published');
  return own && own !== 'version_changed' ? own : null;
}

const headersOf = (target: ReadableWork, base: Record<string, string>) => (target.published ? base : { ...base, ...PRIVATE_HEADERS });

/** GET /p/<id>.json：作品の地図（ファイル、行の数、技術とその行、分け目、言語）と、読む先の住所。 */
export async function renderWorkMap(c: SiteContext): Promise<Response> {
  const id = (c.req.param('file') ?? '').replace(/\.json$/, '');
  const target = await siteTarget(c, id);
  if (target === 'limited') return c.json({ error: 'rate_limited' }, 429, NOSNIFF);
  const outline = target && (await loadMap(c.env, target));
  if (!target || !outline) return c.json({ error: 'not_found' }, 404, NOSNIFF);
  const origin = shareOrigin(c.req.url);
  const page = `${origin}/p/${encodeURIComponent(target.id)}`;
  return c.json(
    {
      id: target.id,
      title: target.title,
      creator: target.creator.handle,
      version: target.version,
      license: 'MIT',
      credit: creditTexts(target),
      url: page,
      code_url: `${page}/code`,
      raw: Object.fromEntries(outline.files.map((file) => [file.name, `${page}/raw/${file.name}`])),
      outline,
    },
    200,
    headersOf(target, NOSNIFF),
  );
}

/** GET /p/<id>/raw/<file>：1つのファイルの生の文字。頭にクレジット行。 */
export async function renderWorkRaw(c: SiteContext): Promise<Response> {
  const target = await siteTarget(c, c.req.param('id') ?? '');
  if (target === 'limited') return new Response('Too many requests\n', { status: 429, headers: PLAIN_TEXT });
  const files = target && (await loadFiles(c.env, target));
  const text = target && files ? rawFile(target, files, c.req.param('file') ?? '') : null;
  if (!target || text === null) return new Response('Not found\n', { status: 404, headers: PLAIN_TEXT });
  return new Response(text, { headers: headersOf(target, PLAIN_TEXT) });
}
