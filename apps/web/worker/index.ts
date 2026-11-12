// Worker ludion-web の入口（CLAUDE.md「技術の決定」）。Hono で API を受け、ホームを描き、残りは静的アセットに渡す（app.ts）。
// 許可リストの道のほかは、すべての応答に Cache-Control: private, no-store を付ける（cachePolicy.ts）。
// 許可リストの道に知らない URL の値が付いた要求は、その値を外した URL へ送り直す（同じキャッシュに当てる）。
// すべての応答に、守りのヘッダーも付ける（securityHeaders.ts）。

import { app } from './app';
import { applyCachePolicy, canonicalCacheUrl } from './cachePolicy';
import type { Env } from './env';
import { applySecurityHeaders } from './securityHeaders';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // キャッシュの道に知らない URL の値が付いていれば、外した URL へ送り直す（D1 を読まない。cachePolicy.ts の canonicalCacheUrl）
    const canonical = canonicalCacheUrl(request.method, url);
    const response = canonical === null ? await app.fetch(request, env, ctx) : new Response(null, { status: 302, headers: { Location: canonical } });
    return applySecurityHeaders(applyCachePolicy(response, request.method, url.pathname));
  },
} satisfies ExportedHandler<Env>;
