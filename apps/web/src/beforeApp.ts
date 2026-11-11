/**
 * Worker が描いた HTML の直後に、インラインで動かす（worker/home.ts が埋め込む）。
 * React の本体を待たずに、次をやる（SPEC.md 10）。
 *
 * 1. カードを置く。計算は lib/ のものをそのまま使うので、あとから React が同じ位置に置き直しても動かない。
 * 2. 作品のページのプレビューの倍率を決める（枠の幅に合わせて iframe を縮める）。
 * 3. スマホでは、Web の画面の Desktop の枠を Mobile の枠に替える（React が載る前に。lib/frame.ts の PHONE_QUERY）。
 * 4. プレビューの枠を、見えている細かさ（実際の DPR × 縮めた割合）を付けた URL で読み始める（PREVIEW-DPR。lib/frame.ts の startFrame）。
 */
import { BOX_CLASS, FRAME_CLASS, frameScale, isPhone, previewScale, startFrame, type FrameSize } from './lib/frame';
import { gridShape, WIDE_QUERY } from './lib/gridShape';
import { layoutMasonry } from './lib/masonry';

const phone = isPhone();
const frameBox = document.querySelector<HTMLElement>('[data-frame-size]');
if (frameBox) {
  // Worker はどの端末かを知らないので、Web の画面を Desktop の枠で描く。スマホなら、React が同じ形で載るよう、ここで Mobile に替える。
  // 枠はまだ読み始めていない（src がない。下の startFrame が入れる）ので、読む先（data-src）と形を替えるだけでよい
  const phoneSrc = frameBox.dataset.phoneSrc;
  const frame = frameBox.querySelector<HTMLIFrameElement>('iframe[data-ld-frame]');
  if (frame && phoneSrc && frameBox.dataset.frameSize === 'desktop' && phone && !frame.hasAttribute('src')) {
    frameBox.dataset.frameSize = 'mobile';
    frameBox.className = frameBox.className.replace(BOX_CLASS.desktop, BOX_CLASS.mobile);
    frame.className = FRAME_CLASS.mobile;
    frame.dataset.src = phoneSrc;
  }
  frameBox.style.setProperty('--frame-scale', String(frameScale(frameBox.dataset.frameSize as FrameSize, frameBox.clientWidth)));
}
for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-ld-frame][data-src]')) {
  // 部品の枠は縮めない（data-frame-size のない入れ物）。スマホの Mobile の枠も縮めない（previewScale）
  const box = frame.closest<HTMLElement>('[data-frame-size]');
  startFrame(frame, box ? previewScale(box.dataset.frameSize as FrameSize, box.clientWidth, phone) : 1);
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
