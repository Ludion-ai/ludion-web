// 壁紙の静止画（WALL002）。アプリを入れない人が、OS の標準の機能で壁紙にする PNG。
// ld upload が置く人のブラウザで作り、Worker が R2 に置いて配る。大きさと名前はここだけで決める。

/** 作品の種類（subtype）が壁紙のもの。画面の側は apps/web/src/lib/homeQuery.ts に同じ値がある（画面は rules を読まない） */
export const WALLPAPER_SUBTYPE = 'Wallpaper';

/** 静止画の大きさ。大きい順。 */
export const STILL_SIZES = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
] as const;

export type StillSize = (typeof STILL_SIZES)[number];

/** R2 と配る道でのファイルの名前（wall-3840x2160.png）。 */
export const stillFileName = (size: { width: number; height: number }) => `wall-${size.width}x${size.height}.png`;

/** 静止画のファイルの名前の全部。 */
export const STILL_FILES = STILL_SIZES.map(stillFileName);

/**
 * 1枚の上限（バイト）。雨の窓ぎわの 4K は 3.8MB。管理 API は1回で全部を受け取るので、3枚と作品が入る大きさに抑える（worker/admin.ts）。
 */
export const MAX_STILL_BYTES = 12 * 1024 * 1024;

/** 落とすときのファイルの名前（<id>-3840x2160.png）。 */
export const stillDownloadName = (id: string, size: { width: number; height: number }) => `${id}-${size.width}x${size.height}.png`;
