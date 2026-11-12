// 作品のページの本文のための読み口（WS003）：GET /p/<id>/file/<版>/<ファイル>。
//
// - 版のファイルを、置いてあるとおりの文字で返す。クレジット行を足さないので、行の番号は地図（outline.json）と同じ。
//   人が持ち出す文字（「ファイルをコピー」、/p/<id>/raw/<file>、/p/<id>/code）には、クレジット行が入る（CLAUDE.md 原則4）。ここは画面に出すためだけ。
// - 公開の作品：承認済みの作品の、承認済みのその版だけ。cookie を読まない。人によって変えない（cachePolicy.ts でキャッシュする）。
// - 自分だけの作品：持ち主のセッションにだけ、今の版を返す。残さない。ほかの人（運営も）には、ない作品と同じ 404。
// - 回数の制限はかけない（ページの本文を出すたびに読むため）。id、版、ファイルの名前は、D1 と R2 を読む前に形で弾く。
// - text/plain と nosniff。作品の JS を、このオリジンのスクリプトとして読ませない。

import { workFiles } from '@ludion/outline';
import type { Context } from 'hono';
import type { Env } from './env';
import { approvedPrefix, loadRevisionFiles, privateCurrentRevision } from './revisions';
import { getSessionUser } from './session';

type FileContext = Context<{ Bindings: Env }>;

/** 版のファイルの名前（部品の作品の3つと、文書の作品の1つ） */
export const WORK_FILE_NAMES = ['part.html', 'part.css', 'part.js', 'index.html'] as const;
export const isWorkFileName = (name: string): name is (typeof WORK_FILE_NAMES)[number] => (WORK_FILE_NAMES as readonly string[]).includes(name);

const WORK_ID = /^[a-z0-9-]{1,60}$/;
const VERSION = /^[A-Za-z0-9._-]{1,32}$/;

const PLAIN_TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
/** 自分だけの作品の応答の頭（pages.ts と同じ）。どの層にも残さない。 */
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };

const notFound = () => new Response('Not found\n', { status: 404, headers: PLAIN_TEXT });

export async function renderWorkFile(c: FileContext): Promise<Response> {
  const id = c.req.param('id') ?? '';
  const version = c.req.param('version') ?? '';
  const name = c.req.param('file') ?? '';
  if (!WORK_ID.test(id) || !VERSION.test(version) || !isWorkFileName(name)) return notFound();

  const db = c.env.DB;
  let prefix = await approvedPrefix(db, id, version);
  let isPrivate = false;
  if (!prefix) {
    // 公開されていない版だけ、cookie を読む
    const revision = await privateCurrentRevision(db, id, await getSessionUser(c));
    if (!revision || revision.version !== version) return notFound();
    prefix = revision.r2_prefix;
    isPrivate = true;
  }
  const files = await loadRevisionFiles(c.env.PARTS, prefix);
  const file = files && workFiles(files).find((item) => item.name === name);
  if (!file) return notFound();
  return new Response(file.text, { headers: isPrivate ? { ...PLAIN_TEXT, ...PRIVATE_HEADERS } : { ...PLAIN_TEXT, 'X-Robots-Tag': 'noindex' } });
}
