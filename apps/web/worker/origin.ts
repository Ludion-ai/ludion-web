import type { Context } from 'hono';

/** 状態を変える POST は、Origin が自分のサイトのときだけ受ける（CLAUDE.md「技術の決定」）。ない場合も、作品の枠（null）も断る。 */
export const isSameOrigin = (c: Context): boolean => c.req.header('Origin') === new URL(c.req.url).origin;
