/**
 * Worker が描いた HTML の直後に、インラインで動かす（worker/home.ts が埋め込む）。
 * React の本体を待たずに、次をやる（SPEC.md 10）。
 *
 * 1. カードを置く。計算は lib/ のものをそのまま使うので、あとから React が同じ位置に置き直しても動かない。
 * 2. 作品のページのプレビューの倍率を決める（枠の幅に合わせて iframe を縮める）。
 * 3. スマホでは、Web の画面の Desktop の枠を Mobile の枠に替える（React が載る前に。lib/frame.ts の PHONE_QUERY）。
 * 4. プレビューの枠を、見えている細かさ（実際の DPR × 縮めた割合）を付けた URL で読み始める（PREVIEW-DPR。lib/frame.ts の startFrame）。
 * 5. iPhone の消音モードでも、作品の音が鳴るようにする（下の audioSession）。
 */
import { startPreview } from './lib/previewStart';
import { gridShape, WIDE_QUERY } from './lib/gridShape';
import { layoutMasonry } from './lib/masonry';

// iPhone は、消音モードのとき、作品が AudioContext で作る音を鳴らさない（動画の音は鳴る）。
// 親のページが「このページの音は、再生するための音」と宣言すると、消音モードでも鳴る（Safari の navigator.audioSession）。
// 作品の枠の中からは宣言できない（Safari は、マイクを許した枠でしか受け付けない）ので、ここでやる。作品のファイルは変えない。
// 音が鳴るのは、今までどおり、見る人が作品を触ってから。鳴っている間は、ほかのアプリの音楽が止まる（iPhone の決まり）
const audioSession = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
if (audioSession) {
  try {
    audioSession.type = 'playback';
  } catch {
    // 宣言できない Safari では、今までどおり（消音モードでは鳴らない）
  }
}

// 2〜4 は lib/previewStart.ts。作品のページでは、枠の入れ物の直後の台本が先に一度呼んでいる（PERF002「1」）。
// ここでは、それより後に置かれた枠を読み始め、倍率をページが全部並んだ後の幅で決め直す
startPreview();


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
