// キャッシュを消す（docs/tasks/T012.md「1」）。消すのは札で。消す回数の上限は1分に5回、貯められるのは25回（Workers Cache は常に Free の枠）。
// この中で Worker の束縛を使わない。e2e/cache.spec.ts がそのまま読むため。

import { logError } from './log';

/** ctx.cache の使う部分。 */
export interface PurgeCache {
  purge(options: { tags: string[] }): Promise<{ success: boolean; errors: unknown[] }>;
}

/** 1回目が失敗した後のやり直しの間隔。 */
export const PURGE_RETRY_DELAYS_MS = [1000, 2000, 4000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 消せたら true。最大3回やり直しても消せなければ false（一覧の反映は s-maxage の60秒まで遅れる）。 */
export async function purgeWithRetry(
  cache: PurgeCache | undefined,
  tags: string[],
  sleep: (ms: number) => Promise<void> = wait,
): Promise<boolean> {
  // 手元のサーバーには ctx.cache がなく、キャッシュもしない。本番にあることは scripts/verify-cache.mjs が確かめる
  if (!cache) return true;
  for (const delay of [0, ...PURGE_RETRY_DELAYS_MS]) {
    if (delay > 0) await sleep(delay);
    try {
      const result = await cache.purge({ tags });
      if (result.success) return true;
      logError('cache_purge_failed');
    } catch {
      logError('cache_purge_failed');
    }
  }
  return false;
}
