// 「壁紙にする」（WALL001「2」）。全画面の住所、Plash の住所、端末に合わせた並び。

/** 共有する住所はいつも本番のもの（作品のページの共有と同じ）。壁紙のアプリは PC で開くので、手元の住所を渡しても使えない。 */
const SHARE_ORIGIN = 'https://ludion.ai';

/** 公式の配布のページ（11/11 に確かめた。Plash は sindresorhus.com/plash、Lively は GitHub の README の Microsoft Store のリンク） */
export const PLASH_STORE_URL = 'https://apps.apple.com/app/id1494023538';
export const LIVELY_STORE_URL = 'https://apps.microsoft.com/store/detail/9NTM2QC6QWS7';

/** 全画面の住所（worker/wall.ts）。 */
export const wallUrl = (id: string) => `${SHARE_ORIGIN}/p/${encodeURIComponent(id)}/wall`;

/** Plash に直接足す住所。Plash の説明のとおり、値はすべて URL の形に符号化する（plash:add?url=…&title=…）。 */
export const plashUrl = (id: string, title: string) => `plash:add?url=${encodeURIComponent(wallUrl(id))}&title=${encodeURIComponent(title)}`;

/** 「HTML を保存」のファイルの名前。 */
export const wallpaperFileName = (id: string) => `${id}.html`;

export type WallpaperDevice = 'mac' | 'windows' | 'other' | 'mobile';

interface DeviceHints {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/**
 * 開いている端末の種類。シートの並びを変えるだけに使い、送らず、保存しない（CLAUDE.md 原則6）。
 * iPad は Mac と同じ UA を名乗るので、触れる点の数で分ける。
 */
export function wallpaperDevice({ userAgent, platform, maxTouchPoints }: DeviceHints): WallpaperDevice {
  const text = `${platform} ${userAgent}`;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(text)) return 'mobile';
  if (/Mac/i.test(text)) return maxTouchPoints > 1 ? 'mobile' : 'mac';
  if (/Win/i.test(text)) return 'windows';
  return 'other';
}

export function currentWallpaperDevice(): WallpaperDevice {
  return wallpaperDevice({ userAgent: navigator.userAgent, platform: navigator.platform ?? '', maxTouchPoints: navigator.maxTouchPoints ?? 0 });
}

/** Windows の端末では Windows の方を先に。ほかは Mac が先。 */
export const wallpaperOrder = (device: WallpaperDevice): ('mac' | 'windows')[] => (device === 'windows' ? ['windows', 'mac'] : ['mac', 'windows']);

/**
 * 静止画（WALL002）の初めの大きさ：開いている画面の画素の幅（CSS の幅 × 画素の密度）に一番近いもの。同じ近さなら大きい方。
 * 画面の大きさは選ぶのに使うだけで、送らず、保存しない。
 */
export function nearestStill<T extends { width: number }>(stills: readonly T[], screenPixels: number): T {
  let best = stills[0];
  for (const still of stills) {
    const gap = Math.abs(still.width - screenPixels);
    const bestGap = Math.abs(best.width - screenPixels);
    if (gap < bestGap || (gap === bestGap && still.width > best.width)) best = still;
  }
  return best;
}

export function currentScreenPixels(): number {
  return Math.round((window.screen?.width || window.innerWidth) * (window.devicePixelRatio || 1));
}

/** 落とすときのファイルの名前（<id>-3840x2160.png。Worker の Content-Disposition と同じ） */
export const stillDownloadName = (id: string, still: { width: number; height: number }) => `${id}-${still.width}x${still.height}.png`;

/**
 * 「HTML を保存」：コピーされるコードと同じ中身を、そのままファイルにする（クレジット行も残る）。
 * リンクは開いているシート（container）の中に置く。モーダルの外は inert なので。
 */
export function downloadWallpaperHtml(id: string, snippet: string, container: HTMLElement): void {
  const url = URL.createObjectURL(new Blob([snippet], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = wallpaperFileName(id);
  link.hidden = true;
  container.append(link);
  link.click();
  link.remove();
  // すぐ消すと、ブラウザによっては保存が始まる前に消える
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
