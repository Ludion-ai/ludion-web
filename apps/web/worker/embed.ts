// 埋め込みの住所（/e/<id>。EMBED001）。外のサイトが <iframe src="https://ludion.ai/e/<id>"> と書くと、作品が動く。
//
// - 形は全画面の住所（wall.ts）に近い：サイトの頭もボタンも出さず、React も読まず、作品を枠いっぱいに出す。だから GA4 も動かない。
//   違い：端末の「動きを減らす」設定に従う（作品のページと同じ）。角に小さく印（Ludion · Remix）を出し、押すと作品のページが新しいタブで開く。
//   印は作品の枠の外（このページの側）に置く。作品のファイルは変えない。
// - 作品は今と同じ封をした枠（sandbox、応答の頭の CSP、Sec-Fetch-Dest の確かめ）の中でだけ動かす（原則7）。
//   開けるのは「誰の枠に入れるか」だけ。このページの応答と、埋め込みの枠（/frame/<id>/<version>/embed.html）の応答だけ、frame-ancestors を開ける。
//   このページの frame-src 'self' と枠の見張り（frameGuard.ts）は、ほかのページと同じ。
// - 出せるのは、公開されて承認された作品の、いま出ている版だけ。ほかは 404。Cookie は読まない（ログインの有無で中身を変えない）。
// - 検索には出さない（noindex）。キャッシュは作品のページと同じ（cachePolicy.ts）。数えるのと上限は、キャッシュに乗らない枠の側（frames.ts）。
// - 1日の上限（quotaLimits.ts の EMBED_LIMITS）に達したら、枠を置かず、止めた絵（サムネイル）と作品のページへのリンクを返す。

import { FRAME_SANDBOX, authorBackground } from '@ludion/render';
import type { Context } from 'hono';
import frameGuard from 'virtual:ludion/frame-guard';
import { getApprovedWork } from './catalog';
import type { Env } from './env';
import { embedPaused } from './quota';
import { loadRevisionFiles } from './revisions';
import { EMBED_PAGE_CSP } from './securityHeaders';

type EmbedContext = Context<{ Bindings: Env }>;

const NOINDEX = 'noindex, nofollow';

/** 枠の文書が「今日は止めた」と知らせる言葉（frames.ts の止めた枠）。 */
export const EMBED_PAUSED_MESSAGE = 'ld-embed-paused';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 埋め込みの枠の URL。版が変われば URL も変わる。 */
export const embedFrameUrl = (work: { id: string; version: string }) =>
  `/frame/${encodeURIComponent(work.id)}/${encodeURIComponent(work.version)}/embed.html`;

const workPath = (id: string) => `/p/${encodeURIComponent(id)}`;
const thumbPath = (work: { id: string; version: string }) => `/w/${encodeURIComponent(work.id)}/${encodeURIComponent(work.version)}/thumb.webp`;

/** ロゴのマーク「」（Header.tsx と同じ形）。地の暗い印の上なので、左上を白にする。 */
const MARK =
  '<svg viewBox="8 8 80 80" width="12" height="12" aria-hidden="true"><path fill="#fff" d="M8 8H56V24H24V72H8Z"/><path fill="#e5412a" d="M88 88H40V72H72V24H88Z"/></svg>';

const STYLE =
  'html,body{margin:0;width:100%;height:100%;overflow:hidden}' +
  'iframe{position:fixed;inset:0;display:block;width:100%;height:100%;border:0}' +
  '.ld-badge{position:fixed;right:8px;bottom:8px;z-index:1;display:inline-flex;align-items:center;gap:5px;padding:3px 8px 3px 6px;' +
  'border-radius:9999px;background:rgba(17,17,19,.72);color:#fff;font:600 11px/16px system-ui,-apple-system,"Segoe UI",sans-serif;' +
  'letter-spacing:.01em;text-decoration:none;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
  '.ld-badge:hover{background:rgba(17,17,19,.86)}.ld-badge:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
  '.ld-paused{position:fixed;inset:0;display:block}.ld-paused img{display:block;width:100%;height:100%;object-fit:cover}' +
  'p{margin:0;padding:24px;font:16px/1.5 system-ui,sans-serif;color:#6b6b76}';

/** 止めた絵。サムネイル全体が作品のページへのリンク（新しいタブ）。文字は出さない（言語を分けないため）。 */
function pausedMarkup(work: { id: string; version: string; title: string }): string {
  return (
    `<a class="ld-paused" data-ld-paused="" href="${escapeHtml(workPath(work.id))}" target="_blank" rel="noopener" aria-label="${escapeHtml(work.title)} · Ludion">` +
    `<img src="${escapeHtml(thumbPath(work))}" alt=""></a>`
  );
}

/**
 * 枠が「今日は止めた」と知らせたら、枠を止めた絵に替える。上限に達した直後の、キャッシュに残った /e/<id> のため。
 * 受け取るのは、今の枠の文書（sandbox のオリジンは null）から、決まった言葉だけ（CLAUDE.md「描画」）。
 */
const PAUSE_SCRIPT =
  `addEventListener('message',(e)=>{const f=document.querySelector('iframe[data-ld-frame]');` +
  `if(!f||e.source!==f.contentWindow||e.origin!=='null'||e.data!=='${EMBED_PAUSED_MESSAGE}')return;` +
  `const t=document.getElementById('ld-paused');if(!t)return;f.replaceWith(t.content.cloneNode(true))});`;

function embedDocument(body: string, title: string, background: string): string {
  return [
    '<!doctype html>',
    '<html lang="ja">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="robots" content="${NOINDEX}">`,
    `<title>${escapeHtml(title)}</title>`,
    `<style>html,body{background:${background}}${STYLE}</style>`,
    // 枠より先に動かす（作品のページと同じ。frameGuard.ts）
    `<script>${frameGuard}${PAUSE_SCRIPT}</script>`,
    '</head>',
    `<body>${body}</body>`,
    '</html>',
    '',
  ].join('\n');
}

const HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': NOINDEX, 'Content-Security-Policy': EMBED_PAGE_CSP };

/** ない作品と、公開していない作品は 404。外のサイトの枠の中に出るので、404 も枠に入れる。文字だけ（GA4 を読まない）。 */
function notFound(): Response {
  return new Response(embedDocument('<p>Not found · 見つかりません</p>', 'Ludion', '#ffffff'), { status: 404, headers: HEADERS });
}

export async function renderEmbedPage(c: EmbedContext): Promise<Response> {
  const found = await getApprovedWork(c.env.DB, c.req.param('id') ?? '');
  const files = found && (await loadRevisionFiles(c.env.PARTS, found.prefix));
  if (!found || !files) return notFound();
  const { work } = found;
  // 枠が読み込まれるまでの地は、作者の背景の色（作品のページの枠と同じ）
  const background = authorBackground(files.css) ?? '#000000';
  const badge =
    `<a class="ld-badge" data-ld-badge="" href="${escapeHtml(workPath(work.id))}" target="_blank" rel="noopener" ` +
    `aria-label="${escapeHtml(work.title)} · Ludion">${MARK}<span>Ludion · Remix</span></a>`;
  const paused = pausedMarkup(work);
  const main = (await embedPaused(c.env.DB))
    ? paused
    : `<iframe data-ld-frame="" title="${escapeHtml(work.title)}" sandbox="${FRAME_SANDBOX}" src="${escapeHtml(embedFrameUrl(work))}"></iframe>` +
      `<template id="ld-paused">${paused}</template>`;
  return new Response(embedDocument(main + badge, `${work.title} · Ludion`, background), { headers: HEADERS });
}
