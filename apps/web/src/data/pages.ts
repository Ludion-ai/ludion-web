import type { Work } from './works';

/** 作者のページとリンクに要る情報。x_url と site_url は http(s) のものだけが入る。 */
export type CreatorProfile = Work['creator'] & {
  x_url: string | null;
  site_url: string | null;
};

export type CreatorTotals = { works: number; views: number; copies: number };

/** 壁紙の静止画の1枚（WALL002）。url は同じサイトの道（/w/<id>/<version>/wall-<幅>x<高さ>.png） */
export type WallStill = { width: number; height: number; url: string };

/** 印を押したときに飛ぶ所（WS003）：本当のファイルと、その行 */
export type AboutSpot = { file: string; line: number };

/** ファイルの木の分け目（地図の Section から、画面に出す分）。行は 1 から数え、end を含む */
export type TreeSection = {
  file: string;
  kind: 'shader' | 'settings' | 'heading' | 'function' | 'style' | 'script' | 'asset';
  name: string;
  start: number;
  end: number;
  /** 入れ子の深さ（0 がいちばん外） */
  depth: number;
  language: 'html' | 'css' | 'js' | 'glsl';
  bytes?: number;
  glsl?: string;
  stage?: 'vertex' | 'fragment';
  mime?: string;
};

/** ファイルの木と目次（WS003）。dropped：上限を超えて入れなかった分け目の数 */
export type WorkTree = {
  files: { name: string; bytes: number; lines: number; language: 'html' | 'css' | 'js' | 'glsl' }[];
  sections: TreeSection[];
  dropped: number;
};

/** 「この作品について」の1つの技術。id、まとまり、名前は地図（packages/outline）のもの */
export type AboutTech = {
  id: string;
  group: string;
  label: string;
  count: number;
  /** キー操作と読み上げ：書いてあった値（役目の名前、状態の属性の名前、キーの名前） */
  values?: string[];
  /** 外から読む物：住所のホスト名 */
  hosts?: string[];
  spot: AboutSpot | null;
};

/**
 * 「この作品について」（WS003）。版を置いたときに機械がコードを読んで作った地図（outline.json）から、画面に出す分だけ。
 * コードに書いてある物だけで、見つからない物は入れない。
 */
export type WorkAbout = {
  files: { name: string; bytes: number; lines: number }[];
  /** 全部のファイルの UTF-8 のバイト数 */
  bytes: number;
  /** 言語の帯（大きい順） */
  languages: { language: 'html' | 'css' | 'js' | 'glsl'; percent: number }[];
  shaders: { count: number; bytes: number; glsl: string[]; spot: AboutSpot | null } | null;
  /** 関数の数 */
  functions: number;
  tech: AboutTech[];
};

/** 版の一覧の1行（新しい順）。at は置いた時刻 */
export type WorkVersion = { version: string; at: number };

/** 系譜：この作品のリミックス（公開のものだけ）。count は全部の数 */
export type WorkLineage = { remixes: { id: string; title: string; handle: string }[]; count: number };

/**
 * Worker が HTML に埋め込むページのデータ（worker/pages.ts）。ブラウザで取り直さない。
 * 人によって変わる情報は入れない（SPEC.md 10）。
 */
export type PageData =
  | {
      kind: 'work';
      work: Work;
      creator: CreatorProfile;
      /** 同じ作者のほかの作品（Popular の順） */
      more: Work[];
      /** ほかの作者の作品（Popular の順） */
      others: Work[];
      /**
       * コピー用の文字列（buildCopySnippet）。1行目はクレジット行。
       * HTML の JSON には入れず、ブラウザがコードの箱の文字から戻す（lib/codeText.ts。PERF002「2」）
       */
      snippet: string;
      /** プレビューの枠の地（作者の --_bg）。読めなければ null */
      background: string | null;
      /**
       * リミックスの元（docs/tasks/T036.md「4」）。リミックスでなければ null。
       * 元が公開されていなければ（自分だけ、取り下げ）、題も作者も入れず hidden だけにする（リンクを付けない）
       */
      source: { id: string; title: string; handle: string } | { hidden: true } | null;
      /**
       * 自分だけの作品（docs/tasks/T036.md）。持ち主にだけ描き、このページはキャッシュしない。
       * 枠は下書きの枠（持ち主だけに返す）。公開の作品では null
       */
      private: { frames: { desktop: string; mobile: string } } | null;
      /** 壁紙の静止画（WALL002）。ld upload が置いた公開の壁紙の作品にだけある（大きい順）。ほかは空 */
      stills: WallStill[];
      /** 「この作品について」（WS003）。地図が作れなければ null（節を出さない） */
      about: WorkAbout | null;
      /** ファイルの木と目次（WS003）。地図が作れなければ null（木を出さない） */
      tree: WorkTree | null;
      /**
       * クレジット行の文字（1行目は作者、リミックスは2行目に元の作品）。本文から「ファイルをコピー」した文字の頭に入れる（原則4）。
       * /p/<id>/raw/<file> と同じ文字になる
       */
      credit: string[];
      /** 版の一覧（新しい順。公開の作品は承認済みの版だけ） */
      versions: WorkVersion[];
      /** この作品のリミックス（公開のものだけ） */
      lineage: WorkLineage;
    }
  | { kind: 'creator'; creator: CreatorProfile; totals: CreatorTotals; works: Work[] }
  /** ログインの画面。使える手段はサイトの設定で決まる（Google とパスキーは workers.dev で使えない） */
  | { kind: 'login'; methods: { google: boolean; passkey: boolean } }
  /** handle を選ぶ画面。パスキーで新しく始められるか */
  | { kind: 'signup'; methods: { passkey: boolean } }
  | { kind: 'not-found' };
