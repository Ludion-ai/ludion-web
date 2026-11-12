/**
 * 埋め込みの1行（EMBED001「4」）。外のサイトに貼ると、/e/<id> の中で作品が動く（worker/embed.ts）。
 * 幅と高さは、作品のページのプレビューの比率と同じ（lib/frame.ts）：部品は 4:3、Web の画面は 1280:800、スマホの画面は 390:844。
 * 狭い場所では幅いっぱいまで縮み、高さは比率で決まる。
 */
import type { Work } from '../data/works';
import { FRAME_SIZES } from './frame';

/** 貼る住所はいつも本番（workers.dev や手元で開いていても）。 */
const EMBED_ORIGIN = 'https://ludion.ai';

/** 貼ったときの幅（px）。部品と Web の画面。スマホの画面は Mobile の枠の幅のまま。 */
const EMBED_WIDTH = 640;

function escapeAttribute(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function embedSize(work: Pick<Work, 'type' | 'platform'>): { width: number; height: number } {
  if (work.type === 'component') return { width: EMBED_WIDTH, height: (EMBED_WIDTH * 3) / 4 };
  if (work.platform === 'mobile') return { ...FRAME_SIZES.mobile };
  const { width, height } = FRAME_SIZES.desktop;
  return { width: EMBED_WIDTH, height: Math.round((EMBED_WIDTH * height) / width) };
}

export function embedSnippet(work: Pick<Work, 'id' | 'title' | 'type' | 'platform'>, handle: string): string {
  const { width, height } = embedSize(work);
  const title = escapeAttribute(`${work.title} · UI by @${handle} · Ludion`);
  return (
    `<iframe src="${EMBED_ORIGIN}/e/${encodeURIComponent(work.id)}" width="${width}" height="${height}" ` +
    `style="border:0;max-width:100%;height:auto;aspect-ratio:${width}/${height}" title="${title}" loading="lazy"></iframe>`
  );
}
