// 作品のページ（/p/:id）と作り手のページ（/c/:handle）を Worker で描く（docs/tasks/T007.md「1」「2」）。
// 数は描画のときに D1 から入れる。作品のコードは R2 から読み、コピー用の文字列だけをページに入れる。ページの中では動かさない。

import { authorBackground, buildCopySnippet } from '@ludion/render';
import type { Context } from 'hono';
import type { Work } from '../src/data/works';
import { copyFor, localeOfPath, localizedPath } from '../src/i18n';
import { shareOrigin } from './cachePolicy';
import { isGoogleAvailable, isPasskeyAvailable } from './methods';
import { safeNext } from './loginFlow';
import { findMovedCreator, getApprovedWork, getCreator, getCreatorTotals, listApprovedWorks, listCreatorWorks } from './catalog';
import type { Env } from './env';
import { canPost, loadRevisionFiles } from './revisions';
import { getSessionUser } from './session';
import { renderDocument } from './ssr';

type PageContext = Context<{ Bindings: Env }>;

const copyOf = (c: PageContext) => copyFor(localeOfPath(c.req.path));

const ogImage = (c: PageContext, work: Pick<Work, 'id' | 'version'>) => `${shareOrigin(c.req.url)}/w/${work.id}/${work.version}/og.png`;

export const renderNotFound = (c: PageContext) =>
  renderDocument(c, { page: { kind: 'not-found' }, head: { title: copyOf(c).notFound.pageTitle }, status: 404 });

/** 承認済みの作品の今の版と、その「コピーされるコード」。作品のページの「コードをコピー」と /p/:id/code は、この同じ文字列を出す。 */
async function loadApprovedWork(c: PageContext) {
  const found = await getApprovedWork(c.env.DB, c.req.param('id') ?? '');
  const files = found && (await loadRevisionFiles(c.env.PARTS, found.prefix));
  if (!found || !files) return null;
  const { creator } = found;
  // リミックスは2行目に元の作品のクレジット行（docs/tasks/T033.md B4）。remix_of から作るので、作り手がコードから消しても残る。元が取り下げられていても残す
  const source = await c.env.DB.prepare(
    `SELECT o.id, oc.handle FROM works w JOIN works o ON o.id = w.remix_of JOIN creators oc ON oc.id = o.creator_id WHERE w.id = ?`,
  )
    .bind(found.work.id)
    .first<{ id: string; handle: string }>();
  const snippet = buildCopySnippet(
    { ...files, meta: { ...files.meta, creator: creator.handle } },
    { handle: creator.handle, name: creator.name, kind: creator.kind, x_url: creator.x_url, site_url: creator.site_url },
    source,
  );
  return { ...found, files, snippet };
}

const PLAIN_TEXT = { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };

/**
 * 作品の「コピーされるコード」を文字のまま返す（docs/tasks/T031.md「1」）。リミックスの指示文が、コードの全文の代わりにこの URL を渡す。
 * 人によって変えない。開いても数えない（数えるのは、指示文をコピーしたとき）。
 */
export async function renderWorkCode(c: PageContext): Promise<Response> {
  const loaded = await loadApprovedWork(c);
  if (!loaded) return new Response('Not found\n', { status: 404, headers: PLAIN_TEXT });
  return new Response(loaded.snippet, { headers: PLAIN_TEXT });
}

export async function renderWorkPage(c: PageContext): Promise<Response> {
  const db = c.env.DB;
  const loaded = await loadApprovedWork(c);
  if (!loaded) return renderNotFound(c);

  const { work, creator, files, snippet } = loaded;
  // 作品のページから行き止まりをなくす（docs/tasks/T018.md「1」）。同じ作者が先で、それぞれ Popular の順
  const rest = (await listApprovedWorks(db)).filter((other) => other.id !== work.id);

  return renderDocument(c, {
    page: {
      kind: 'work',
      work,
      creator,
      more: rest.filter((other) => other.creator.handle === creator.handle),
      others: rest.filter((other) => other.creator.handle !== creator.handle),
      snippet,
      background: authorBackground(files.css),
    },
    head: { title: copyOf(c).work.pageTitle(work.title, creator.handle), image: ogImage(c, work), path: `/p/${encodeURIComponent(work.id)}` },
  });
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
