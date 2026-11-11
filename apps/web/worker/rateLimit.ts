// 回数の制限（docs/tasks/T012.md「2」、T024「2」）。IP はその場で鍵を作るためだけに使う。束縛に渡さない、保存しない、ログにも出さない（CLAUDE.md 原則6）。
// 値は wrangler.jsonc の ratelimits。回数はデータセンターごとの近似（https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/）。

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { Env } from './env';
import { limitKey } from './limitKey';
import { logError, routeKind } from './log';

export type LimitBinding = 'LIMIT_COUNT' | 'LIMIT_TOGGLE' | 'LIMIT_AUTH' | 'LIMIT_ACCOUNT' | 'LIMIT_RECOVERY' | 'LIMIT_POST';

/** 窓の長さ（wrangler.jsonc の period と同じ）。 */
const RETRY_AFTER_SECONDS = 60;
/** 手元のサーバーが自分で付ける値。本番の CF-Connecting-IP は Cloudflare が付け直すので、この値にはならない。 */
export const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** 失敗したときは通す。数の守りのせいでサイトを止めない。秘密の値がないときも通し、生の IP で代わりに数えることはしない。 */
async function allowed(env: Env, binding: LimitBinding, ip: string, path: string): Promise<boolean> {
  const fields = { binding, route: routeKind(path) };
  if (!env.RATE_KEY_SECRET) {
    logError('rate_key_missing', fields);
    return true;
  }
  try {
    return (await env[binding].limit({ key: await limitKey(ip, env.RATE_KEY_SECRET) })).success;
  } catch {
    logError('rate_limit_failed', fields);
    return true;
  }
}

/**
 * Cloudflare の外から来る要求はないので、本番では CF-Connecting-IP は必ずあり、送り手には書き換えられない。
 * 手元のサーバーでは、同じ値を付けて開発とテストが止まらないよう、自分の値を数えない。テストはほかの IP を付けて確かめる。
 * limitedPage：人が画面として開く道で、JSON の代わりに送る先。なければ、または null を返せば、JSON の 429。
 */
export const rateLimit = (binding: LimitBinding, limitedPage?: (c: Context<{ Bindings: Env }>) => string | null) =>
  createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP');
    if (ip && !LOOPBACK.has(ip) && !(await allowed(c.env, binding, ip, c.req.path))) {
      const page = limitedPage?.(c);
      if (page) return c.redirect(page);
      return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(RETRY_AFTER_SECONDS) });
    }
    await next();
  });
