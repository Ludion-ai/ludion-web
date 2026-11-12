// 地図（outline.json）の形。WS002。画面（ファイルの木、この作品について、言語の帯）と AI の口が、この形を読む。
// 形を変えたら OUTLINE_VERSION を上げる。置き場の地図の版が違えば、読むときに作り直す（apps/web/worker/outline.ts）。

export const OUTLINE_VERSION = 1;

/** 地図が数える言語。シェーダーの文字列は glsl として数え、js から引く。 */
export type Language = 'html' | 'css' | 'js' | 'glsl';

/** 作品のファイル（part.html、part.css、part.js、文書の作品の index.html）。 */
export interface OutlineFile {
  name: string;
  /** UTF-8 のバイト数 */
  bytes: number;
  /** 行の数（最後の改行の後の空の行は数えない） */
  lines: number;
  language: Language;
}

export type SectionKind = 'shader' | 'settings' | 'heading' | 'function' | 'style' | 'script' | 'asset';

/** ファイルの中の分け目。行は 1 から数え、end を含む。 */
export interface Section {
  file: string;
  kind: SectionKind;
  name: string;
  start: number;
  end: number;
  /** 入れ子の深さ（0 がいちばん外） */
  depth: number;
  language: Language;
  /** UTF-8 のバイト数（関数、シェーダー、素材、style、script） */
  bytes?: number;
  /** シェーダー：#version に書いてある版（例 "300 es"）。書いていなければ出さない */
  glsl?: string;
  /** シェーダー：gl_Position があれば vertex、gl_FragColor か out vec4 があれば fragment。わからなければ出さない */
  stage?: 'vertex' | 'fragment';
  /** 素材（kind が asset）：data: の種類（例 image/png）か svg */
  mime?: string;
}

export type TechGroup = 'draw' | 'sound' | 'input' | 'motion' | 'care' | 'storage' | 'external';

/** 見つけた所。match はその行に書いてある文字（行の確かめに使う）。 */
export interface TechHit {
  file: string;
  line: number;
  match: string;
}

/** 見つけた技術。見つからない物は出さない。 */
export interface Tech {
  id: string;
  group: TechGroup;
  label: string;
  /** 見つけた数（hits は頭の MAX_HITS 個まで） */
  count: number;
  hits: TechHit[];
  /** 外から読む物：住所のホスト名 */
  hosts?: string[];
}

export interface LanguageBytes {
  language: Language;
  bytes: number;
  /** 全体に対する割合（%、小数1桁） */
  percent: number;
}

export interface Outline {
  version: typeof OUTLINE_VERSION;
  /** parts：part.html と part.css と part.js。document：文書の作品の index.html（DOC001） */
  format: 'parts' | 'document';
  files: OutlineFile[];
  sections: Section[];
  tech: Tech[];
  languages: LanguageBytes[];
}

/** 地図を作るのに要る版の中身（@ludion/render の Work と同じ名前）。 */
export interface OutlineInput {
  html: string;
  css: string;
  js?: string | null;
  document?: string | null;
}
