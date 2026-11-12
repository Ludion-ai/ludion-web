// Worker の中身（Hono）。入口（index.ts）は fetch だけを export する（Workers のモジュールは、ハンドラー以外を export できない）。

import { Hono } from 'hono';
import { account } from './account';
import { admin } from './admin';
import { apiLimitedBody, apiV1 } from './apiV1';
import { auth } from './auth';
import { listApprovedWorks } from './catalog';
import { count } from './count';
import type { Env } from './env';
import { files } from './files';
import { frames } from './frames';
import { google } from './google';
import { renderHome } from './home';
import { errorType, logError, routeKind } from './log';
import { isLoginNavigation, loginPageWithError } from './loginFlow';
import { mcp } from './mcp';
import { me } from './me';
import { oauth, wellKnown } from './oauth';
import { passkey } from './passkey';
import { post } from './post';
import { review } from './review';
import { redirectSaved, renderAboutPage, renderAccountPage, renderNewWorkPage, renderReviewPage, renderCreatorPage, renderLoginPage, renderNotFound, renderPrivacyPage, renderSignupPage, renderTermsPage, renderSharedFile, renderSharedPage, renderWorkCode, renderWorkPage } from './pages';
import { rateLimit } from './rateLimit';
import { publicHandleCheck, signup } from './signup';
import { renderSitemap } from './sitemap';
import { renderWallPage } from './wall';
import { renderWorkFile } from './workFile';
import { renderWorkMap, renderWorkRaw } from './workSite';
import { WINDOWS_DOWNLOAD_URL } from './download';

export const app = new Hono<{ Bindings: Env }>();

/** 作品の地図の道（/p/<id>.json）。'/p/:id' にも当たる形なので、それより先に置く */
const WORK_MAP_ROUTE = '/p/:file{[a-z0-9-]+\\.json}';

// 回数の制限。ルートより先に置く
app.post('/api/count', rateLimit('LIMIT_COUNT'));
app.post('/api/works/:id/like', rateLimit('LIMIT_TOGGLE'));
app.post('/api/works/:id/bookmark', rateLimit('LIMIT_TOGGLE'));
app.use('/auth/*', rateLimit('LIMIT_AUTH', (c) => (isLoginNavigation(c.req.method, c.req.path) ? loginPageWithError(c.req.query('next'), 'login_limited') : null)));
app.use('/api/account/*', rateLimit('LIMIT_ACCOUNT'));
app.use('/api/signup/*', rateLimit('LIMIT_ACCOUNT'));
app.post('/auth/passkey/recovery', rateLimit('LIMIT_RECOVERY'));
app.use('/api/post/*', rateLimit('LIMIT_ACCOUNT'));
app.post('/api/post/works', rateLimit('LIMIT_POST'));
app.post('/api/post/works/:id/revisions', rateLimit('LIMIT_POST'));
app.use('/api/review/*', rateLimit('LIMIT_ACCOUNT'));
// AI の口（docs/tasks/T037.md「2」）。鍵を確かめる前に、IP の束縛で数える（違う鍵を続けて試させない）。人ごとの上限は apiV1.ts
// '/api/v1/*' は '/api/v1' にも当たる（Hono）。'/api/v1' にも付けると、1回の要求で2回数える
app.use('/api/v1/*', rateLimit('LIMIT_ACCOUNT', undefined, apiLimitedBody));
// 作品のコードを文字で返す口（docs/tasks/T031.md「1」）。作品のページを読む人の束縛で数える。キャッシュに当たった分は Worker に来ないので数えない
app.get('/p/:id/code', rateLimit('LIMIT_COUNT'));
// 作品の地図と、ファイルの生の文字（WS006）。自分だけの作品は本人の鍵でも読めるので、鍵の確かめより先に、同じ束縛で数える
app.get(WORK_MAP_ROUTE, rateLimit('LIMIT_COUNT'));
app.get('/p/:id/raw/:file', rateLimit('LIMIT_COUNT'));
// AI につなぐ（MCP001）。許可の画面は人が開くので、ログインと同じ束縛で数える。
// 登録、トークン、/mcp は AI のサーバーから来る（多くの人が同じ IP を通る）ので IP では数えない（oauth.ts、mcp.ts の頭）
app.use('/oauth/authorize', rateLimit('LIMIT_AUTH'));
// リンクで見せる（SHARE001「7」）。合言葉を当てる連打（404）で Worker の回数を使い切られないよう、IP の束縛で数える。
// 200 のページはキャッシュに当たれば Worker に来ないので数えない。枠と本文も合言葉で D1 を読むので、同じ束縛で数える
app.use('/s/*', rateLimit('LIMIT_COUNT'));
app.use('/en/s/*', rateLimit('LIMIT_COUNT'));
app.use('/share-frame/*', rateLimit('LIMIT_COUNT'));

app.route('/.well-known', wellKnown);
app.route('/oauth', oauth);
app.route('/mcp', mcp);
app.route('/api/v1', apiV1);
app.route('/api/admin', admin);
app.route('/api/count', count);
app.route('/api/account', account);
app.route('/api/post', post);
app.route('/api/review', review);
app.route('/api', me);
app.route('/auth', auth);
app.route('/auth/google', google);
app.route('/auth/signup', signup);
app.route('/auth/passkey', passkey);
app.get('/api/signup/handle-check', publicHandleCheck);

// ホームからは呼ばない（一覧は HTML の中にある）。ほかのページからホームへ移ったときに使う（SPEC.md「8」）
app.get('/api/works', async (c) => c.json({ works: await listApprovedWorks(c.env.DB) }));

// API の知らない道は、ホームの HTML ではなく JSON の 404 にする
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

app.route('/', files);
app.route('/', frames);

app.get('/', renderHome);
app.get(WORK_MAP_ROUTE, renderWorkMap);
app.get('/p/:id', renderWorkPage);
app.get('/p/:id/raw/:file', renderWorkRaw);
app.get('/p/:id/code', renderWorkCode);
// 行の住所（WS003）：作品のページを、そのファイルを開いた形で描く。行（#L204-L760）はブラウザが当てる
app.get('/p/:id/code/:file', renderWorkPage);
// ページの本文のための読み口（WS003）。クレジット行なしで、行の番号は本物のファイルと同じ。回数の制限はかけない
app.get('/p/:id/file/:version/:file', renderWorkFile);
// 全画面の住所（WALL001）。壁紙のアプリが開く。言語の文字がないので、英語の道は作らない
app.get('/p/:id/wall', renderWallPage);
// リンクで見せる作品（SHARE001）。合言葉を知っている人だけ。一覧、検索、sitemap には出さない
app.get('/s/:token', renderSharedPage);
app.get('/s/:token/code/:file', renderSharedPage);
app.get('/s/:token/file/:version/:file', renderSharedFile);
// Windows アプリのダウンロード（APP001）。今の配り先へ送る
app.get('/download/windows', (c) => c.redirect(WINDOWS_DOWNLOAD_URL, 302));
app.get('/c/:handle', renderCreatorPage);
app.get('/login', renderLoginPage);
app.get('/signup', renderSignupPage);
app.get('/saved', redirectSaved);
app.get('/account', renderAccountPage);
app.get('/account/saved', renderAccountPage);
app.get('/account/likes', renderAccountPage);
app.get('/account/works', renderAccountPage);
app.get('/account/delete', renderAccountPage);
app.get('/new', renderNewWorkPage);
app.get('/admin/review', renderReviewPage);
app.get('/privacy', renderPrivacyPage);
app.get('/about', renderAboutPage);
app.get('/terms', renderTermsPage);
app.get('/sitemap.xml', renderSitemap);

// 英語のページ（SPEC.md 9）。日本語と同じ描き方で、言語は道から決まる
app.get('/en', renderHome);
app.get('/en/', (c) => c.redirect(`/en${new URL(c.req.url).search}`, 301));
app.get('/en/p/:id', renderWorkPage);
app.get('/en/p/:id/code/:file', renderWorkPage);
app.get('/en/s/:token', renderSharedPage);
app.get('/en/s/:token/code/:file', renderSharedPage);
app.get('/en/c/:handle', renderCreatorPage);
app.get('/en/login', renderLoginPage);
app.get('/en/signup', renderSignupPage);
app.get('/en/saved', redirectSaved);
app.get('/en/account', renderAccountPage);
app.get('/en/account/saved', renderAccountPage);
app.get('/en/account/likes', renderAccountPage);
app.get('/en/account/works', renderAccountPage);
app.get('/en/account/delete', renderAccountPage);
app.get('/en/new', renderNewWorkPage);
app.get('/en/admin/review', renderReviewPage);
app.get('/en/privacy', renderPrivacyPage);
app.get('/en/about', renderAboutPage);
app.get('/en/terms', renderTermsPage);

// 残りは静的アセット（JS、CSS、書体、robots.txt）。知らない道には、アセットが SPA の index.html を返すので、404 のページに換える
app.all('*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  const isFallback = response.status === 200 && response.headers.get('Content-Type')?.includes('text/html');
  return isFallback && (c.req.method === 'GET' || c.req.method === 'HEAD') ? renderNotFound(c) : response;
});

app.onError((error, c) => {
  logError('internal_error', { route: routeKind(c.req.path), type: errorType(error) });
  if (isLoginNavigation(c.req.method, c.req.path)) return c.redirect(loginPageWithError(c.req.query('next'), 'login_failed'));
  // AI の口のエラーは、どれも error と message（docs/tasks/T037.md「2」）
  if (c.req.path === '/api/v1' || c.req.path.startsWith('/api/v1/')) return c.json({ error: 'internal_error', message: 'Something went wrong on the server.' }, 500);
  // MCP は JSON-RPC の形で返す（AI が読める形）
  if (c.req.path === '/mcp') return c.json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }, 500);
  return c.json({ error: 'internal_error' }, 500);
});
