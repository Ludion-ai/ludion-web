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

/**
 * スマホ（指で触る端末で、画面の幅が狭い）。index.css の phone: と同じ条件。
 * スマホでは、Web の画面も Mobile の枠だけを見せ、枠を縮めずにその大きさのまま描く（SPEC.md 13「プレビュー」）。
 */
export const PHONE_QUERY = '(pointer: coarse) and (max-width: 767px)';

/** 今の端末がスマホか。Worker の描画では、いつも false。 */
export function isPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/** 入れ物の形。beforeApp も同じ文字列を使う（スマホで Desktop の枠を Mobile に替えるとき）。 */
export const BOX_CLASS = {
  // 部品：枠の幅のままの iframe の中央に置く（置くのは buildFrameHtml）
  component: 'aspect-[4/3] min-h-[420px] w-full',
  desktop: 'aspect-[1280/800]',
  // 幅が390に足りないときは、枠の高さも同じ割合で縮める。
  // スマホ：高さは「見えている画面の高さ − ヘッダー64px − 上の余白8px − 下に残す72px（ボタンとの間12px、下のタブ48px、その上下）」。
  // 縦÷横は 1.3 から 1.8 の間に収める
  mobile: 'h-[min(844px,calc(100cqw*844/390))] phone:h-[clamp(130cqw,calc(100svh-144px),180cqw)]',
};

export const FRAME_CLASS = {
  component: 'absolute inset-0 size-full',
  desktop: 'absolute top-0 left-0 h-[800px] w-[1280px] origin-top-left [transform:scale(var(--frame-scale,1))]',
  // スマホ：入れ物いっぱいに、縮めずに描く（CSS の scale を使わない）
  mobile:
    'absolute top-0 left-1/2 h-[844px] w-[390px] origin-top [transform:translateX(-50%)_scale(var(--frame-scale,1))] phone:left-0 phone:size-full phone:[transform:none]',
};

/** 枠の中身の倍率。Desktop は枠の幅に合わせる。Mobile は縮めるだけで、広げない。 */
export function frameScale(size: FrameSize, boxWidth: number): number {
  const fit = boxWidth / FRAME_SIZES[size].width;
  return size === 'mobile' ? Math.min(1, fit) : fit;
}

/** motion：端末の「動きを減らす」設定を超えて動きを見せる枠（docs/tasks/FIX-motion.md「1」）。 */
export function frameUrl(work: { id: string; version: string }, size: FrameSize, motion = false): string {
  return `/frame/${work.id}/${work.version}/${size}.html${motion ? '?motion=1' : ''}`;
}
