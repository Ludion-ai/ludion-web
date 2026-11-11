// 全画面の住所（/p/<id>/wall。WALL001「1」）。作品だけを画面いっぱいに出す。PC の壁紙のアプリ（Plash、Lively Wallpaper など）が開く。
//
// - サイトの頭、ボタン、文は出さない。React も読まない。だから閲覧数とコピー数を数えず、GA4 も動かない
//   （壁紙は PC を起動するたびに開くので、数が膨らむ。CLAUDE.md 原則10）。
// - 作品は作品のページと同じ守りの枠（sandbox、応答の頭の CSP、/frame/... の Sec-Fetch-Dest の確かめ）の中で動かす（原則7）。
//   このページの応答には、ほかのページと同じ親の CSP（frame-src 'self' など。securityHeaders.ts）が付き、枠の見張り（frameGuard.ts）も入れる。
// - 検索には出さない（noindex）。キャッシュは作品のページと同じ（cachePolicy.ts）。人によって変えない。

import { FRAME_SANDBOX, authorBackground } from '@ludion/render';
import type { Context } from 'hono';
import frameGuard from 'virtual:ludion/frame-guard';
import { getApprovedWork } from './catalog';
import type { Env } from './env';
import { loadRevisionFiles } from './revisions';

type WallContext = Context<{ Bindings: Env }>;

const NOINDEX = 'noindex, nofollow';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 枠の URL。版が変われば URL も変わる。 */
export const wallFrameUrl = (work: { id: string; version: string }) =>
  `/frame/${encodeURIComponent(work.id)}/${encodeURIComponent(work.version)}/wall.html`;

function wallDocument(body: string, title: string, background: string): string {
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="robots" content="${NOINDEX}">`,
    `<title>${escapeHtml(title)}</title>`,
    // 枠を画面いっぱいに置く。4K や横長の画面でも、枠の中の作品が画面の大きさで描く
    `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background}}` +
      'iframe{position:fixed;inset:0;display:block;width:100%;height:100%;border:0}p{margin:0;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#6b6b76}</style>',
    // 枠より先に動かす（作品のページと同じ。frameGuard.ts）
    `<script>${frameGuard}</script>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
    '',
  ].join('\n');
}

const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': NOINDEX };

/** ない作品と、公開していない作品は 404。サイトの 404 のページは GA4 を読むので、ここでは文字だけの 404 にする。 */
function notFound(): Response {
  return new Response(wallDocument('<p>Not found · 見つかりません</p>', 'Ludion', '#ffffff'), { status: 404, headers: HTML_HEADERS });
}

export async function renderWallPage(c: WallContext): Promise<Response> {
  const found = await getApprovedWork(c.env.DB, c.req.param('id') ?? '');
  const files = found && (await loadRevisionFiles(c.env.PARTS, found.prefix));
  if (!found || !files) return notFound();
  const { work } = found;
  // 枠が読み込まれるまでの地は、作者の背景の色（作品のページの枠と同じ）
  const background = authorBackground(files.css) ?? '#000000';
  const frame =
    `<iframe data-ld-frame="" title="${escapeHtml(work.title)}" sandbox="${FRAME_SANDBOX}" src="${escapeHtml(wallFrameUrl(work))}"></iframe>`;
  return new Response(wallDocument(frame, `${work.title} · Ludion`, background), { headers: HTML_HEADERS });
}
