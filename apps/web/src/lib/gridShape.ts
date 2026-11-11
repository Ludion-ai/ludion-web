/** 広い画面の境目。CSS の md と同じ（SPEC.md 5）。 */
export const WIDE_QUERY = '(min-width: 768px)';

const PHONE_COLUMNS = 2;
const PHONE_GAP = 8;
const WIDE_GAP = 16;
/** 広い画面の列の幅の目安。入れ物の幅に合わせて少し伸び縮みする。 */
const WIDE_COLUMN = 240;

export type GridShape = {
  columns: number;
  columnWidth: number;
  gap: number;
};

/** 列の数と間隔（SPEC.md 3、5）。列の幅は、広い画面でいちばん 240px に近くなる列の数から決める。 */
export function gridShape(containerWidth: number, wide: boolean): GridShape {
  const gap = wide ? WIDE_GAP : PHONE_GAP;
  const columns = wide ? Math.max(PHONE_COLUMNS, Math.round((containerWidth + gap) / (WIDE_COLUMN + gap))) : PHONE_COLUMNS;
  return { columns, gap, columnWidth: (containerWidth - gap * (columns - 1)) / columns };
}
