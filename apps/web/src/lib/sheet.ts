// ボタンから開くシート（「リミックス」と「壁紙にする」）の置き方。

/** スマホは下から出す。これ以上の幅は、押したボタンの近くに置く（docs/tasks/T030.md「1」）。 */
export const NEAR_BUTTON = '(min-width: 768px)';
const GAP = 8;
const EDGE = 16;

/** ページの座標で置く。ページをスクロールしても、シートはボタンの近くのまま（top layer の absolute はページが基準）。 */
export function placeNear(sheet: HTMLElement, anchor: HTMLElement) {
  const button = anchor.getBoundingClientRect();
  const { width, height } = sheet.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(button.right - width, document.documentElement.clientWidth - width - EDGE));
  const below = button.bottom + GAP;
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, button.top - GAP - height);
  sheet.style.left = `${left + window.scrollX}px`;
  sheet.style.top = `${top + window.scrollY}px`;
}

