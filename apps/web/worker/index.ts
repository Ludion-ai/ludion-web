// Worker ludion-web の入口（CLAUDE.md「技術の決定」）。Hono で API を受け、ホームを描き、残りは静的アセットに渡す（app.ts）。
// 許可リストの道のほかは、すべての応答に Cache-Control: private, no-store を付ける（cachePolicy.ts）。
// すべての応答に、守りのヘッダーも付ける（securityHeaders.ts）。

import { app } from './app';
import { applyCachePolicy } from './cachePolicy';
import type { Env } from './env';
import { applySecurityHeaders } from './securityHeaders';

export default {
  async fetch(request, env, ctx) {
    return applySecurityHeaders(applyCachePolicy(await app.fetch(request, env, ctx), request.method, new URL(request.url).pathname));
  },
} satisfies ExportedHandler<Env>;
