// www.ludion.ai を https://ludion.ai へ転送するだけの Worker（docs/tasks/T013.md「1」）。
//
// ludion-web には足さない：Workers Cache は Worker より前で効き、キーにホストが入らない。
// 同じ Worker に www をつなぐと、キャッシュに当たった www のページは転送されず、HTML がそのまま返る。
// ここではキャッシュを有効にせず、何も保存も記録もしない（CLAUDE.md 原則6）。

const TARGET = 'https://ludion.ai';

/** 道と URL の値はそのまま、送り先だけを変える。 */
export function redirectTarget(requestUrl: string): string {
  const { pathname, search } = new URL(requestUrl);
  return `${TARGET}${pathname}${search}`;
}

export default {
  fetch(request: Request): Response {
    // 恒久の転送でも、ブラウザに永遠には覚えさせない（送り先を変えられるように、1日）
    return new Response(null, {
      status: 301,
      headers: {
        Location: redirectTarget(request.url),
        'Cache-Control': 'public, max-age=86400',
        // ludion-web の worker/securityHeaders.ts と同じ考え（docs/tasks/T022.md「2」）。本文がないので、HTML 用のものは要らない
        'X-Content-Type-Options': 'nosniff',
        'Strict-Transport-Security': 'max-age=604800',
      },
    });
  },
};
