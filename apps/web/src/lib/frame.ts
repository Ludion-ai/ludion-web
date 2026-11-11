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

/** 枠の入れ物の形（FramePreview、RevisionFrame。Web の画面をスマホで開くとき、beforeApp も使う） */
export const BOX_CLASS = {
  // 部品：枠の幅のままの iframe の中央に置く（置くのは buildFrameHtml）
  component: 'aspect-[4/3] min-h-[420px] w-full',
  desktop: 'aspect-[1280/800]',
  // 幅が390に足りないときは、枠の高さも同じ割合で縮める
  mobile: 'h-[min(844px,calc(100cqw*844/390))]',
};

export const FRAME_CLASS = {
  component: 'absolute inset-0 size-full',
  desktop: 'absolute top-0 left-0 h-[800px] w-[1280px] origin-top-left [transform:scale(var(--frame-scale,1))]',
  mobile: 'absolute top-0 left-1/2 h-[844px] w-[390px] origin-top [transform:translateX(-50%)_scale(var(--frame-scale,1))]',
};

/**
 * Web の画面のプレビューを、最初から「モバイル」で開く端末（CEO の指示、11/11）。スマホ：指で触る（pointer: coarse）、幅が狭い（767px 以下）。
 * PC と、幅の広いタブレットは今のまま「デスクトップ」。Worker は端末を知らないので、beforeApp と React がこれで決める。
 */
export const MOBILE_FIRST_QUERY = '(pointer: coarse) and (max-width: 767px)';

export function opensMobileFirst(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_FIRST_QUERY).matches;
}

/** 枠の中身の倍率。Desktop は枠の幅に合わせる。Mobile は縮めるだけで、広げない。 */
export function frameScale(size: FrameSize, boxWidth: number): number {
  const fit = boxWidth / FRAME_SIZES[size].width;
  return size === 'mobile' ? Math.min(1, fit) : fit;
}

/**
 * 枠に伝える細かさ（PREVIEW-DPR）。実際の DPR × 縮めた割合で、上限は実際の DPR。
 * 細かさが足りなくならないよう、小数2桁に切り上げる。縮めない枠（部品、ヘッダーのスイッチ）は割合 1。
 */
export function frameDpr(scale: number, dpr: number): number {
  const real = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const shown = Number.isFinite(scale) && scale > 0 ? real * scale : real;
  return Math.min(real, Math.ceil(shown * 100 - 1e-9) / 100);
}

/** 枠の URL の # に細かさを付ける。枠の文書の最初のスクリプト（packages/render の DPR_SCRIPT。鍵は DPR_HASH_KEY）が読む。 */
export function withFrameDpr(url: string, scale: number, dpr: number): string {
  return `${url}#ldpr=${frameDpr(scale, dpr)}`;
}

/**
 * 枠を読み始める。枠は src を付けずに描き（URL は data-src）、ここで細かさを付けた src を入れる。
 * Worker が描いた枠は beforeApp が、React が作った枠は React が、同じ計算で入れる。もう読み始めた枠には何もしない。
 * src のない枠の load（about:blank）は、見張り（frameGuard.ts）が数えない。
 */
export function startFrame(frame: HTMLIFrameElement, scale: number): void {
  const url = frame.dataset.src;
  if (!url || frame.hasAttribute('src')) return;
  frame.src = withFrameDpr(url, scale, window.devicePixelRatio);
}

/** motion：端末の「動きを減らす」設定を超えて動きを見せる枠（docs/tasks/FIX-motion.md「1」）。 */
export function frameUrl(work: { id: string; version: string }, size: FrameSize, motion = false): string {
  return `/frame/${work.id}/${work.version}/${size}.html${motion ? '?motion=1' : ''}`;
}
