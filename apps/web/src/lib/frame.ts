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
  // 読み始めた時を要素に残す（beforeApp と React は別の束なので、要素の上で渡す）。壁紙の静止画を重ねる時間を、ここから数える
  (frame as FrameWithStart).ldStartedAt = performance.now();
}

type FrameWithStart = HTMLIFrameElement & { ldStartedAt?: number };

/** 枠を読み始めた時（performance.now()）。まだなら null */
export const frameStartedAt = (frame: HTMLIFrameElement): number | null => (frame as FrameWithStart).ldStartedAt ?? null;

/**
 * 壁紙の作品のプレビューに、静止画（WALL002）を重ねておく時間（CEO の指示、11/11）。
 * 壁紙は開いた直後に絵を組み立てる途中（約2秒）が見えるので、枠を読み始めてからこの時間だけ静止画で隠し、COVER_FADE_MS で消す。
 * スマホ（pointer: coarse）は読み込みも組み立ても遅いので長く。
 */
export const COVER_MS = { coarse: 2500, fine: 1000 } as const;
export const COVER_FADE_MS = 400;

/** motion：端末の「動きを減らす」設定を超えて動きを見せる枠（docs/tasks/FIX-motion.md「1」）。 */
export function frameUrl(work: { id: string; version: string }, size: FrameSize, motion = false): string {
  return `/frame/${work.id}/${work.version}/${size}.html${motion ? '?motion=1' : ''}`;
}
