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
  // 部品：枠の幅のままの iframe の中央に置く（置くのは buildFrameHtml）。
  // 幅767px以下：枠の上に作品の頭があるので（WS003）、低い画面では枠を低くして、すぐ下の「リミックス」を最初の画面に入れる
  // （下に残す124px＝ボタンとの間12px＋ボタン44px＋下のタブの分64px＋枠の線と余り）。320px より低くはしない。高い画面では今までどおり420px
  component: 'aspect-[4/3] min-h-[420px] w-full max-md:min-h-[clamp(320px,calc(100svh-var(--frame-top,72px)-124px),420px)]',
  desktop: 'aspect-[1280/800]',
  // 幅が390に足りないときは、枠の高さも同じ割合で縮める。
  // スマホ：高さは「見えている画面の高さ − 枠の上の端までの高さ（--frame-top）− 下に残す72px（ボタンとの間12px、下のタブ48px、その上下）」。
  // 枠の上には、ヘッダー64px、上の余白8px、作品の頭（@作者 / 題。WS003）がある。頭の高さは題の長さで変わるので、fitFrameTop が測って入れる。
  // 測る前の値は 72px（ヘッダーと上の余白）。縦÷横は 1.3 から 1.8 の間に収める
  mobile: 'h-[min(844px,calc(100cqw*844/390))] phone:h-[clamp(130cqw,calc(100svh-var(--frame-top,72px)-72px),180cqw)]',
};

/**
 * 狭い画面の枠の高さのために、枠の入れ物の上の端が、ページの上から何 px かを入れる（BOX_CLASS の --frame-top）。
 * 枠が最初の画面に収まり、すぐ下のボタンが見えるようにするため。広い画面では使わない（入れても何も変わらない）。beforeApp（lib/previewStart.ts）と React（FramePreview.tsx）が同じ計算を使う。
 */
export function fitFrameTop(box: HTMLElement): void {
  box.style.setProperty('--frame-top', `${Math.round(box.getBoundingClientRect().top + window.scrollY)}px`);
}

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

/**
 * 枠が実際に縮めて見せられる割合（細かさを伝えるため。PREVIEW-DPR）。
 * スマホの Mobile の枠は縮めずに描く（FRAME_CLASS の phone:）ので 1。ほかは frameScale と同じ。
 */
export function previewScale(size: FrameSize, boxWidth: number, phone: boolean): number {
  return size === 'mobile' && phone ? 1 : frameScale(size, boxWidth);
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
