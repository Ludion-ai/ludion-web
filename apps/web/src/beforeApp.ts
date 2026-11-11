/**
 * Worker が描いた HTML の直後に、インラインで動かす（worker/home.ts が埋め込む）。
 * React の本体を待たずに、次の2つをやる（SPEC.md 10）。
 *
 * 1. カードを置く。計算は lib/ のものをそのまま使うので、あとから React が同じ位置に置き直しても動かない。
 * 2. 作品のページのプレビューの倍率を決める（枠の幅に合わせて iframe を縮める）。
 */
import { frameScale, type FrameSize } from './lib/frame';
import { gridShape, WIDE_QUERY } from './lib/gridShape';
import { layoutMasonry } from './lib/masonry';

const frameBox = document.querySelector<HTMLElement>('[data-frame-size]');
if (frameBox) {
  frameBox.style.setProperty('--frame-scale', String(frameScale(frameBox.dataset.frameSize as FrameSize, frameBox.clientWidth)));
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
