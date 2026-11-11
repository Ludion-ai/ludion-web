// 作品のページ（/p/:id）と作り手のページ（/c/:handle）を Worker で描く（docs/tasks/T007.md「1」「2」）。
// 数は描画のときに D1 から入れる。作品のコードは R2 から読み、コピー用の文字列だけをページに入れる。ページの中では動かさない。

import { authorBackground, buildCopySnippet } from '@ludion/render';
import { STILL_SIZES, stillFileName } from '@ludion/rules';
import type { Context } from 'hono';
import type { CreatorProfile, WallStill } from '../src/data/pages';
import type { Work } from '../src/data/works';
import { copyFor, localeOfPath, localizedPath } from '../src/i18n';
import { isWallpaper } from '../src/lib/homeQuery';
import { shareOrigin } from './cachePolicy';
import { isGoogleAvailable, isPasskeyAvailable } from './methods';
import { safeNext } from './loginFlow';
import { findMovedCreator, getApprovedWork, getCreator, getCreatorTotals, getPrivateWork, listApprovedWorks, listCreatorWorks } from './catalog';
import type { Env } from './env';
import { canPost, draftFrameUrls, loadRevisionFiles, ownedWork, privateCurrentRevision, revisionFile } from './revisions';
import { getSessionUser } from './session';
import { renderDocument } from './ssr';

type PageContext = Context<{ Bindings: Env }>;

const copyOf = (c: PageContext) => copyFor(localeOfPath(c.req.path));

const ogImage = (c: PageContext, work: Pick<Work, 'id' | 'version'>) => `${shareOrigin(c.req.url)}/w/${work.id}/${work.version}/og.png`;

export const renderNotFound = (c: PageContext) =>
  renderDocument(c, { page: { kind: 'not-found' }, head: { title: copyOf(c).notFound.pageTitle }, status: 404 });

/** 自分だけの作品の応答の頭（docs/tasks/T036.md「2」）。どの層にも残さず、次のページの参照元にも住所を残さない。 */
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };

/**
 * 作品の今の版と、その「コピーされるコード」。作品のページの「コードをコピー」と /p/:id/code は、この同じ文字列を出す。
 * 承認済みの作品はだれにでも。自分だけの作品（docs/tasks/T036.md）は持ち主にだけ返し、ほかの人（運営も）には null（ない作品と同じ 404）。
 */
async function loadWork(c: PageContext) {
  const db = c.env.DB;
  const id = c.req.param('id') ?? '';
  const approved = await getApprovedWork(db, id);
  let found: { work: Work; creator: CreatorProfile; creatorId: string; prefix: string; private: { revisionId: string } | null } | null = approved && { ...approved, private: null };
  if (!found) {
    // 公開されていない作品だけ、cookie を読む。公開の作品のページは人によって変えない（キャッシュするため）
    const user = await getSessionUser(c);
    const revision = user && (await privateCurrentRevision(db, id, user));
    const own = revision && (await getPrivateWork(db, id, user.id));
    found = revision && own ? { ...own, prefix: revision.r2_prefix, private: { revisionId: revision.id } } : null;
  }
  const files = found && (await loadRevisionFiles(c.env.PARTS, found.prefix));
  if (!found || !files) return null;
  const { creator } = found;
  // リミックスは2行目に元の作品のクレジット行（docs/tasks/T033.md B4）。remix_of から作るので、作り手がコードから消しても残る。
  // 元が取り下げられていても、自分だけになっていても残す（docs/tasks/T036.md「4」）
  const source = await db
    .prepare(`SELECT o.id, o.title, o.status, oc.handle FROM works w JOIN works o ON o.id = w.remix_of JOIN creators oc ON oc.id = o.creator_id WHERE w.id = ?`)
    .bind(found.work.id)
    .first<{ id: string; title: string; status: string; handle: string }>();
  const snippet = buildCopySnippet(
    { ...files, meta: { ...files.meta, creator: creator.handle } },
    { handle: creator.handle, name: creator.name, kind: creator.kind, x_url: creator.x_url, site_url: creator.site_url },
    source && { id: source.id, handle: source.handle },
  );
  // 帯には、公開されている元だけを出す。そうでなければ題も作者も出さない
  const band = source ? (source.status === 'approved' ? { id: source.id, title: source.title, handle: source.handle } : { hidden: true as const }) : null;
  return { ...found, files, snippet, source: band };
}

/**
 * 公開の作品の「コピーされるコード」（/p/:id/code と同じ文字列）。MCP の get_public_work（worker/mcp.ts）が使う。
 * 公開の作品だけ。cookie は読まない（自分だけの作品は、本人が get_work で取る）。
 */
export async function approvedSnippet(env: Pick<Env, 'DB' | 'PARTS'>, id: string) {
  const found = await getApprovedWork(env.DB, id);
  const files = found && (await loadRevisionFiles(env.PARTS, found.prefix));
  if (!found || !files) return null;
  const { creator, work } = found;
  const source = await env.DB.prepare(`SELECT o.id, oc.handle FROM works w JOIN works o ON o.id = w.remix_of JOIN creators oc ON oc.id = o.creator_id WHERE w.id = ?`)
    .bind(work.id)
    .first<{ id: string; handle: string }>();
  const snippet = buildCopySnippet(
    { ...files, meta: { ...files.meta, creator: creator.handle } },
    { handle: creator.handle, name: creator.name, kind: creator.kind, x_url: creator.x_url, site_url: creator.site_url },
    source,
  );
  return { work, creator, snippet };
}

/**
 * 壁紙の静止画（WALL002）。ld upload が公開の版と一緒に置いたものだけ。R2 にあるかを見て、ある大きさだけを返す。
 * 投稿（/new）の壁紙や自分だけの作品には置かれないので、空になる（シートに「静止画で使う」を出さない）。
 */
async function wallStills(bucket: R2Bucket, work: Work, prefix: string): Promise<WallStill[]> {
  if (!isWallpaper(work)) return [];
  const found = await Promise.all(STILL_SIZES.map((size) => bucket.head(revisionFile(prefix, stillFileName(size)))));
  return STILL_SIZES.filter((_, i) => found[i]).map((size) => ({
    width: size.width,
    height: size.height,
    url: `/w/${encodeURIComponent(work.id)}/${encodeURIComponent(work.version)}/${stillFileName(size)}`,
  }));
}

const PLAIN_TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

/**
 * 作品の「コピーされるコード」を文字のまま返す（docs/tasks/T031.md「1」）。リミックスの指示文が、コードの全文の代わりにこの URL を渡す。
 * 人によって変えない。開いても数えない（数えるのは、指示文をコピーしたとき）。自分だけの作品は持ち主にだけ返し、残さない。
 */
export async function renderWorkCode(c: PageContext): Promise<Response> {
  const loaded = await loadWork(c);
  if (!loaded) return new Response('Not found\n', { status: 404, headers: PLAIN_TEXT });
  return new Response(loaded.snippet, { headers: loaded.private ? { ...PLAIN_TEXT, ...PRIVATE_HEADERS } : PLAIN_TEXT });
}

export async function renderWorkPage(c: PageContext): Promise<Response> {
  const db = c.env.DB;
  // 公開の作品はだれにでも。自分だけの作品（docs/tasks/T036.md）は持ち主にだけ描く
  const loaded = await loadWork(c);
  if (!loaded) {
    // 公開していない作品は、持ち主にだけ、その下書きの画面（/new?work=）へ進める。AI の口が返す url（docs/tasks/T037.md「2」）。
    // ほかの人には、ない作品と同じ 404。302 も 404 もキャッシュしない（cachePolicy.ts は 200 だけ）
    const id = c.req.param('id') ?? '';
    const user = /^[a-z0-9-]{1,60}$/.test(id) ? await getSessionUser(c) : null;
    const own = user ? await ownedWork(db, id) : null;
    if (user && own?.owner_id === user.id) return c.redirect(`${localizedPath(localeOfPath(c.req.path), '/new')}?work=${encodeURIComponent(id)}`);
    return renderNotFound(c);
  }

  const { work, creator, files, snippet, source } = loaded;
  // 作品のページから行き止まりをなくす（docs/tasks/T018.md「1」）。同じ作者が先で、それぞれ Popular の順
  const rest = (await listApprovedWorks(db)).filter((other) => other.id !== work.id);

  const response = await renderDocument(c, {
    page: {
      kind: 'work',
      work,
      creator,
      more: rest.filter((other) => other.creator.handle === creator.handle),
      others: rest.filter((other) => other.creator.handle !== creator.handle),
      snippet,
      background: authorBackground(files.css),
      source,
      private: loaded.private && { frames: draftFrameUrls(loaded.private.revisionId) },
      stills: loaded.private ? [] : await wallStills(c.env.PARTS, work, loaded.prefix),
    },
    // 自分だけの作品には共有の画像と canonical を付けない（公開の道からは見えない）
    head: loaded.private
      ? { title: copyOf(c).work.pageTitle(work.title || copyOf(c).post.untitled, creator.handle) }
      : { title: copyOf(c).work.pageTitle(work.title, creator.handle), image: ogImage(c, work), path: `/p/${encodeURIComponent(work.id)}` },
  });
  if (loaded.private) for (const [name, value] of Object.entries(PRIVATE_HEADERS)) response.headers.set(name, value);
  return response;
}

/** ログインの画面。ログイン済みなら戻り先へ。使える手段はサイトの設定で決まり、人では変わらない。キャッシュしない。 */
export async function renderLoginPage(c: PageContext): Promise<Response> {
  if (await getSessionUser(c)) {
    const next = c.req.query('next');
    return c.redirect(next ? safeNext(next) : localizedPath(localeOfPath(c.req.path), '/'));
  }
  return renderDocument(c, {
    page: { kind: 'login', methods: { google: isGoogleAvailable(c.env, c.req.url), passkey: isPasskeyAvailable(c.env, c.req.url) } },
    head: { title: copyOf(c).login.pageTitle },
  });
}

/** handle を選ぶ画面。中身はブラウザが読む（GET /auth/signup/pending）。パスキーを作るのは、できた後に回復のコードを見せるので、作ったページの中で進める。 */
export async function renderSignupPage(c: PageContext): Promise<Response> {
  if (await getSessionUser(c)) return c.redirect(localizedPath(localeOfPath(c.req.path), '/'));
  return renderDocument(c, { page: { kind: 'signup', methods: { passkey: isPasskeyAvailable(c.env, c.req.url) } }, head: { title: copyOf(c).signup.pageTitle } });
}

/** 今までの /saved のリンクを壊さない（docs/tasks/T020.md「2」）。ログインの確かめは行った先でする。 */
export function redirectSaved(c: PageContext): Response {
  return c.redirect(`${localizedPath(localeOfPath(c.req.path), '/account/saved')}${new URL(c.req.url).search}`, 301);
}

/** アカウントのページ。中身はブラウザが API で読む（GET /api/account など）。HTML は枠だけで、人によって変えない。 */
export async function renderAccountPage(c: PageContext): Promise<Response> {
  if (!(await getSessionUser(c))) return c.redirect(`${localizedPath(localeOfPath(c.req.path), '/login')}?next=${encodeURIComponent(c.req.path)}`);
  return renderDocument(c, { head: { title: copyOf(c).account.pageTitle } });
}

/** 作品を置く画面（docs/tasks/T021.md 段階 B）。ログインが要る。中身はブラウザが作る。HTML は人によって変えず、キャッシュしない。 */
export async function renderNewWorkPage(c: PageContext): Promise<Response> {
  const user = await getSessionUser(c);
  // 全員に開くまでは、運営のほかには道があることも見せない
  if (c.env.POSTING_OPEN !== '1' && !canPost(c.env, user)) return renderNotFound(c);
  if (!user) return c.redirect(`${localizedPath(localeOfPath(c.req.path), '/login')}?next=${encodeURIComponent(c.req.path + new URL(c.req.url).search)}`);
  return renderDocument(c, { head: { title: copyOf(c).post.pageTitle }, frameGuard: true });
}

/** 審査の画面（docs/tasks/T021.md 段階 C）。運営だけ。ほかの人には、ないページと同じ 404。 */
export async function renderReviewPage(c: PageContext): Promise<Response> {
  const user = await getSessionUser(c);
  if (!user?.isOperator) return renderNotFound(c);
  return renderDocument(c, { head: { title: copyOf(c).review.pageTitle }, frameGuard: true });
}

/** サイトを表す1枚（apps/web/public/og-home.png。scripts/make-site-images.mjs が作る）。 */
export const siteImage = (c: PageContext) => `${shareOrigin(c.req.url)}/og-home.png`;

/** プライバシー（docs/tasks/T016.md「1」）。中身は React の木にあり、人によって変わらない。 */
export const renderPrivacyPage = (c: PageContext) =>
  renderDocument(c, {
    head: { title: copyOf(c).privacy.pageTitle, description: copyOf(c).privacy.description, image: siteImage(c), path: '/privacy' },
  });

/** 運営者（docs/tasks/T016.md「1」）。 */
export const renderAboutPage = (c: PageContext) =>
  renderDocument(c, {
    head: { title: copyOf(c).about.pageTitle, description: copyOf(c).about.description, image: siteImage(c), path: '/about' },
  });

/** 利用規約（docs/tasks/T027.md）。 */
export const renderTermsPage = (c: PageContext) =>
  renderDocument(c, {
    head: { title: copyOf(c).terms.pageTitle, description: copyOf(c).terms.description, image: siteImage(c), path: '/terms' },
  });

export async function renderCreatorPage(c: PageContext): Promise<Response> {
  const db = c.env.DB;
  const handle = c.req.param('handle') ?? '';
  const creator = await getCreator(db, handle);
  if (!creator) {
    // 前の handle なら、新しい方へ転送する（docs/tasks/T020.md「1」）
    const moved = await findMovedCreator(db, handle);
    if (moved) return c.redirect(`${localizedPath(localeOfPath(c.req.path), `/c/${encodeURIComponent(moved)}`)}${new URL(c.req.url).search}`, 301);
  }
  const works = creator ? await listCreatorWorks(db, creator.id) : [];
  // 承認済みの作品がない作者のページは出さない（下書きしかない人の名前を見せない）
  if (!creator || works.length === 0) return renderNotFound(c);

  return renderDocument(c, {
    page: { kind: 'creator', creator: creator.profile, totals: await getCreatorTotals(db, creator.id), works },
    head: {
      title: copyOf(c).creator.pageTitle(creator.profile.name, creator.profile.handle),
      image: ogImage(c, works[0]),
      path: `/c/${encodeURIComponent(creator.profile.handle)}`,
    },
  });
}
