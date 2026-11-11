// 作品を動かす枠（CLAUDE.md「描画」、docs/tasks/T007.md「1」）。
//
// GET /frame/<id>/<version>/<desktop|mobile|inline>.html：R2 の作品から buildFrameHtml で作って返す。
// inline.html はヘッダーのスイッチの形（docs/tasks/T035.md「3」）。違うのは見た目と、スイッチの知らせだけで、守りは同じ。
// wall.html は全画面の住所（/p/<id>/wall。WALL001）の形。枠いっぱいに置き、いつも動かす。守りは同じ。
// embed.html は埋め込みの住所（/e/<id>。EMBED001）の中の形。下の別の道で返す。
// 応答の頭の CSP に sandbox が入るので、ludion.ai のオリジンでは動かない。frame-ancestors で、ほかのサイトの枠にも入らない。
// 親からは <iframe sandbox="allow-scripts allow-forms"> で読む。allow-same-origin は付けない。
// 文書の作品（DOC001）は、文書をそのまま返す（頭にサイトの小さなスクリプトだけを差し込む。packages/render/src/document.ts）。守りは同じ。
// 枠の外から開くと（Sec-Fetch-Dest が iframe でない）、作品を返さず作品のページへ戻す。
// 作品の JS が自分のタブを外へ移せるので、URL を直接開かせると、ludion.ai のリンクが外への入口になるため（docs/tasks/T008.md「1」）。

import { EMBED_FRAME_RESPONSE_CSP, FRAME_RESPONSE_CSP, buildDocumentFrameHtml, buildFrameHtml, type Work } from '@ludion/render';
import { Hono, type Context } from 'hono';
import { EMBED_PAUSED_MESSAGE } from './embed';
import type { Env } from './env';
import { takeEmbedView } from './quota';
import { countEmbedView, embedHost } from './count';
import { approvedPrefix, loadRevisionFiles, readableRevision } from './revisions';
import { getSessionUser } from './session';

/** 枠の幅（CLAUDE.md「描画」）。メディアクエリを効かせるため、幅ごとに別の iframe にする。 */
const FRAME_WIDTHS = { desktop: 1280, mobile: 390 } as const;

export const frames = new Hono<{ Bindings: Env }>();

type FrameContext = Context<{ Bindings: Env }>;

const FROM_IFRAME = 'iframe';

/** 枠の応答。公開の版も下書きも同じ守り（sandbox、CSP、キャッシュしない）。 */
function frameResponse(c: FrameContext, work: Work, file: string): Response {
  // ?motion=1：見る人が「動きを見る」を選んだ枠（docs/tasks/FIX-motion.md「1」）。守りとキャッシュの決まりは同じ
  const motion = c.req.query('motion') === '1';
  // 壁紙は本人が選んで置くものなので、端末の「動きを減らす」設定でも動かす（WALL001「1」）
  const options =
    file === 'inline.html'
      ? { palette: 'author' as const, placement: 'inline' as const, motion }
      : file === 'wall.html'
        ? { palette: 'author' as const, placement: 'fill' as const, motion: true }
        : { palette: 'author' as const, width: FRAME_WIDTHS[file === 'mobile.html' ? 'mobile' : 'desktop'], motion };
  // 文書の作品は、置き方（中央、幅、ヘッダー、全画面）を文書が自分で決める。変えるのは「動きを見る」だけ
  const html = typeof work.document === 'string' ? buildDocumentFrameHtml(work.document, { motion: options.motion }) : buildFrameHtml(work, options);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': FRAME_RESPONSE_CSP,
      Vary: 'Sec-Fetch-Dest',
    },
  });
}

frames.get('/frame/:id/:version{[0-9][0-9.]*}/:file{desktop\\.html|mobile\\.html|inline\\.html|wall\\.html}', async (c) => {
  const { id, version, file } = c.req.param();
  // 見出しがないときも同じ。ここでは D1 も R2 も読まない。ない作品は戻った先の /p/<id> が 404 を返す
  if (c.req.header('Sec-Fetch-Dest') !== FROM_IFRAME) {
    c.header('Vary', 'Sec-Fetch-Dest');
    return c.redirect(`/p/${encodeURIComponent(id)}`, 302);
  }
  // 下書きと取り下げた作品は動かさない（CLAUDE.md 原則5）。前の版の URL は、その版を取り下げるまで返す
  const prefix = await approvedPrefix(c.env.DB, id, version);
  const work = prefix ? await loadRevisionFiles(c.env.PARTS, prefix) : null;
  if (!work) return c.json({ error: 'not_found' }, 404);
  return frameResponse(c, work, file);
});

// 埋め込みの枠（/e/<id> の中。EMBED001、embed.ts）。守りは公開の枠と同じで、応答の CSP の frame-ancestors だけを開ける
// （外のサイト → /e/<id> → この枠、と重なるため）。端末の「動きを減らす」設定に従う（?motion=1 も読まない）。
// - Sec-Fetch-Site が same-origin のときだけ返す。外のサイトがこの枠を直に置いて、/e/<id> の印を飛ばすことをさせない。
//   作品の JS が自分の枠をここへ移しても（sandbox のオリジンは null なので cross-site）、返さない。
// - キャッシュしない（見出しで返すものが変わる。CLAUDE.md「描画」）。だから、ここで1日の上限を数える（quota.ts の takeEmbedView）。
//   上限に達したら作品を返さず、/e/<id> に止めた絵へ替えさせる小さな文書を返す。
frames.get('/frame/:id/:version{[0-9][0-9.]*}/embed.html', async (c) => {
  const { id, version } = c.req.param();
  if (c.req.header('Sec-Fetch-Dest') !== FROM_IFRAME || c.req.header('Sec-Fetch-Site') !== 'same-origin') {
    c.header('Vary', EMBED_VARY);
    return c.redirect(`/p/${encodeURIComponent(id)}`, 302);
  }
  const prefix = await approvedPrefix(c.env.DB, id, version);
  if (!prefix) return c.json({ error: 'not_found' }, 404);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': EMBED_FRAME_RESPONSE_CSP, Vary: EMBED_VARY };
  if (!(await takeEmbedView(c.env.DB))) return new Response(EMBED_PAUSED_FRAME, { status: 429, headers });
  // 埋め込みの表示回数（日ごと。EMBED001「6」）。閲覧数とは別の数。Cookie は読まないので、持ち主の表示も数える
  await countEmbedView(c.env.DB, id, embedHost(c.req.query('from')));
  const work = await loadRevisionFiles(c.env.PARTS, prefix);
  if (!work) return c.json({ error: 'not_found' }, 404);
  // 文書の作品（DOC001）は、文書をそのまま返す（作品のページの枠と同じ）。motion は付けない：端末の「動きを減らす」に従う
  const html = typeof work.document === 'string' ? buildDocumentFrameHtml(work.document) : buildFrameHtml(work, { palette: 'author' });
  return new Response(html, { headers });
});

const EMBED_VARY = 'Sec-Fetch-Dest, Sec-Fetch-Site';

/** 上限に達したときの枠の文書。作品は入れない。親の見張りに「読み込めた」、/e/<id> に「止めた」を知らせる。 */
const EMBED_PAUSED_FRAME =
  '<!doctype html><html><head><meta charset="utf-8"><title>Ludion</title>' +
  `<script>addEventListener('load',()=>{parent.postMessage('ld-frame-loaded','*');parent.postMessage('${EMBED_PAUSED_MESSAGE}','*')})</script>` +
  '</head><body></body></html>';

// 公開前の版の枠（docs/tasks/T021.md「下書きの見え方」）。持ち主と運営だけ。ほかの人には、あることも教えない。
// 枠の外から開くと、自分の作品の一覧へ戻す。公開の枠と同じ理由（作品の JS が自分のタブを外へ移せる）
frames.get('/draft-frame/:rid/:file{desktop\\.html|mobile\\.html}', async (c) => {
  const { rid, file } = c.req.param();
  if (c.req.header('Sec-Fetch-Dest') !== FROM_IFRAME) {
    c.header('Vary', 'Sec-Fetch-Dest');
    return c.redirect('/account/works', 302);
  }
  const revision = await readableRevision(c.env.DB, rid, await getSessionUser(c));
  const work = revision ? await loadRevisionFiles(c.env.PARTS, revision.r2_prefix) : null;
  if (!work) return c.json({ error: 'not_found' }, 404);
  return frameResponse(c, work, file);
});
