// 作品を動かす枠（CLAUDE.md「描画」、docs/tasks/T007.md「1」）。
//
// GET /frame/<id>/<version>/<desktop|mobile|inline>.html：R2 の作品から buildFrameHtml で作って返す。
// inline.html はヘッダーのスイッチの形（docs/tasks/T035.md「3」）。違うのは見た目と、スイッチの知らせだけで、守りは同じ。
// wall.html は全画面の住所（/p/<id>/wall。WALL001）の形。枠いっぱいに置き、いつも動かす。守りは同じ。
// 応答の頭の CSP に sandbox が入るので、ludion.ai のオリジンでは動かない。frame-ancestors で、ほかのサイトの枠にも入らない。
// 親からは <iframe sandbox="allow-scripts allow-forms"> で読む。allow-same-origin は付けない。
// 枠の外から開くと（Sec-Fetch-Dest が iframe でない）、作品を返さず作品のページへ戻す。
// 作品の JS が自分のタブを外へ移せるので、URL を直接開かせると、ludion.ai のリンクが外への入口になるため（docs/tasks/T008.md「1」）。

import { FRAME_RESPONSE_CSP, buildFrameHtml, type Work } from '@ludion/render';
import { Hono, type Context } from 'hono';
import type { Env } from './env';
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
  return new Response(buildFrameHtml(work, options), {
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
