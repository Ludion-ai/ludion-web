import type { Work } from './works';

/** 作者のページとリンクに要る情報。x_url と site_url は http(s) のものだけが入る。 */
export type CreatorProfile = Work['creator'] & {
  x_url: string | null;
  site_url: string | null;
};

export type CreatorTotals = { works: number; views: number; copies: number };

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
      /** コピー用の文字列（buildCopySnippet）。1行目はクレジット行 */
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
    }
  | { kind: 'creator'; creator: CreatorProfile; totals: CreatorTotals; works: Work[] }
  /** ログインの画面。使える手段はサイトの設定で決まる（Google とパスキーは workers.dev で使えない） */
  | { kind: 'login'; methods: { google: boolean; passkey: boolean } }
  /** handle を選ぶ画面。パスキーで新しく始められるか */
  | { kind: 'signup'; methods: { passkey: boolean } }
  | { kind: 'not-found' };
