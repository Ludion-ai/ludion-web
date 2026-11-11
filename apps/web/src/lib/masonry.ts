/**
 * 石組みの計算（SPEC.md 6）。並び順に1枚ずつ、いちばん低い列へ置く。
 * 高さは縦横比から決まるので、画像の読み込みを待たない。
 * ブラウザの CSS（aspect-ratio）と同じ高さになるよう、丸めない。
 */
export const MIN_THUMB_RATIO = 0.6;
export const MAX_THUMB_RATIO = 1.25;

export type MasonryOptions = {
  columns: number;
  columnWidth: number;
  gap: number;
};

export type MasonryItem = { thumb_w: number; thumb_h: number };

export type MasonryPosition = {
  column: number;
  x: number;
  y: number;
  height: number;
};

/** サムネイルの高さ÷幅。0.6〜1.25 に収める（はみ出す分は object-fit で切る）。 */
export function thumbRatio({ thumb_w, thumb_h }: MasonryItem): number {
  return Math.min(MAX_THUMB_RATIO, Math.max(MIN_THUMB_RATIO, thumb_h / thumb_w));
}

export function layoutMasonry(items: MasonryItem[], options: MasonryOptions) {
  const { columns, columnWidth, gap } = options;
  const bottoms = new Array<number>(columns).fill(0);

  const positions: MasonryPosition[] = items.map((item) => {
    const column = bottoms.indexOf(Math.min(...bottoms));
    const height = columnWidth * thumbRatio(item);
    const y = bottoms[column];
    bottoms[column] = y + height + gap;
    return { column, x: column * (columnWidth + gap), y, height };
  });

  return { positions, height: positions.length ? Math.max(...bottoms) - gap : 0 };
}
