// 作品のファイルの形（docs/tasks/T002.md「1」）。T003 もこの形を読む。

export type WorkType = 'screen' | 'component';
export type Platform = 'web' | 'mobile';
export type MadeWith = 'human' | 'ai-assisted';
export type Palette = 'author' | 'light' | 'dark';
/** 作者の種類。label は運営のレーベル（CLAUDE.md 原則10）。 */
export type CreatorKind = 'person' | 'label';

/** meta.json の中身。 */
export interface WorkMeta {
  id: string;
  title: string;
  type: WorkType;
  platform: Platform | null;
  category: string;
  subtype: string;
  tags: string[];
  creator: string;
  license: string;
  made_with: MadeWith;
  version: string;
  published_at: string;
  pin_order: number | null;
  /** 任意。サムネイルと OG 画像を撮り、崩れとアクセシビリティを測るまで、読み込みから待つ時間（0〜8000。既定は0） */
  capture?: { delay_ms: number };
}

/** 描画に要る作品の中身。ファイルの読み方は使う側（ld、Worker）が決める。 */
export interface Work {
  meta: WorkMeta;
  /** part.html */
  html: string;
  /** part.css */
  css: string;
  /** part.js（動きがあるときだけ） */
  js?: string | null;
}

/** creators/<handle>/creator.json の中身。 */
export interface Creator {
  handle: string;
  name: string;
  kind: CreatorKind;
  x_url: string | null;
  site_url: string | null;
}
