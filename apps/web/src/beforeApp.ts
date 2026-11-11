/**
 * Worker が描いた HTML の直後に、インラインで動かす（worker/home.ts が埋め込む）。
 * React の本体を待たずに、次の2つをやる（SPEC.md 10）。
 *
 * 1. カードを置く。計算は lib/ のものをそのまま使うので、あとから React が同じ位置に置き直しても動かない。
 * 2. 作品のページのプレビューの倍率を決める（枠の幅に合わせて iframe を縮める）。
 * 3. プレビューの枠を、見えている細かさ（実際の DPR × 縮めた割合）を付けた URL で読み始める（PREVIEW-DPR。lib/frame.ts の startFrame）。
 * 4. Web の画面をスマホで開いたら、プレビューを「モバイル」の形に直す（React も同じ決め方で「モバイル」から始める）。
 *    Worker は「デスクトップ」で描くので、React を待つと、枠の高さが変わって下がずれ、デスクトップの枠を読んでしまう。
 */
import { chipClass } from './components/chip';
import { BOX_CLASS, FRAME_CLASS, frameScale, opensMobileFirst, startFrame, type FrameSize } from './lib/frame';
import { gridShape, WIDE_QUERY } from './lib/gridShape';
import { layoutMasonry } from './lib/masonry';

/** 「デスクトップ」で描かれたプレビューを「モバイル」にする。FramePreview が size = 'mobile' で描くものと同じ形 */
function showMobile(box: HTMLElement) {
  box.dataset.frameSize = 'mobile';
  box.className = box.className.replace(BOX_CLASS.desktop, BOX_CLASS.mobile);
  const frame = box.querySelector<HTMLIFrameElement>('iframe[data-ld-frame]');
  if (frame?.dataset.src) {
    frame.className = FRAME_CLASS.mobile;
    frame.dataset.src = frame.dataset.src.replace('/desktop.html', '/mobile.html');
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-frame-choice]')) {
    const pressed = button.dataset.frameChoice === 'mobile';
    button.setAttribute('aria-pressed', String(pressed));
    button.className = chipClass(pressed);
    button.querySelector('svg')?.classList.toggle('text-site-fg-3', !pressed);
  }
}

const frameBox = document.querySelector<HTMLElement>('[data-frame-size]');
if (frameBox?.hasAttribute('data-frame-choices') && frameBox.dataset.frameSize === 'desktop' && opensMobileFirst()) showMobile(frameBox);
if (frameBox) {
  frameBox.style.setProperty('--frame-scale', String(frameScale(frameBox.dataset.frameSize as FrameSize, frameBox.clientWidth)));
}
for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-ld-frame][data-src]')) {
  // 部品の枠は縮めない（data-frame-size のない入れ物）
  const box = frame.closest<HTMLElement>('[data-frame-size]');
  startFrame(frame, box ? frameScale(box.dataset.frameSize as FrameSize, box.clientWidth) : 1);
}

// 作品のページには、同じ作者の並びとほかの作者の並びの2つがある
for (const grid of document.querySelectorAll<HTMLElement>('[data-masonry]')) {
  const cards = [...grid.children] as HTMLElement[];
  const items = cards.map((card) => {
    const thumb = card.querySelector('img')!;
    return { thumb_w: Number(thumb.getAttribute('width')), thumb_h: Number(thumb.getAttribute('height')) };
  });
  const shape = gridShape(grid.clientWidth, window.matchMedia(WIDE_QUERY).matches);
  const { positions, height } = layoutMasonry(items, shape);

  cards.forEach((card, index) => {
    card.style.left = `${positions[index].x}px`;
    card.style.top = `${positions[index].y}px`;
    card.style.width = `${shape.columnWidth}px`;
  });
  grid.style.height = `${height}px`;
}
