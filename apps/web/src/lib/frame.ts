/**
 * プレビューの枠（CLAUDE.md「描画」、docs/tasks/T007.md「1」）。
 * beforeApp と React が同じ計算を使うので、React が載っても枠の中身が動かない。
 */

/** 幅を見せる枠。メディアクエリを効かせるため、それぞれ別の iframe にする。 */
export const FRAME_SIZES = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;

export type FrameSize = keyof typeof FRAME_SIZES;

/** 枠の中身の倍率。Desktop は枠の幅に合わせる。Mobile は縮めるだけで、広げない。 */
export function frameScale(size: FrameSize, boxWidth: number): number {
  const fit = boxWidth / FRAME_SIZES[size].width;
  return size === 'mobile' ? Math.min(1, fit) : fit;
}

/** motion：端末の「動きを減らす」設定を超えて動きを見せる枠（docs/tasks/FIX-motion.md「1」）。 */
export function frameUrl(work: { id: string; version: string }, size: FrameSize, motion = false): string {
  return `/frame/${work.id}/${work.version}/${size}.html${motion ? '?motion=1' : ''}`;
}
