# SPEC：ホーム（展示）

11/8 に CEO が、ホームを Pinterest のような絵だけの並びに変えた。正解の見た目は docs/reference/pinterest-mobile.png（形だけ）。docs/reference/home.png は最初の版。
中の絵は他人の作品なので、形だけを見る。CEO の言葉：「情報が多すぎる。Pinterest のようにする。境界もアイコンも要らない」。

この文書は、画像から読み取れない数字、動き、データを決める。動きとデータは、この文書を正とする。
見た目の値の正本は、この文書の「2. サイトの色と形」と「3. 画面の骨組み」の1つだけ（作品のページと作り手のページは「13」「14」、プライバシーと運営者のページは「16」）。数字のないところの見た目は画像に合わせる。
「2」〜「6」「9」は 11/8 の形に、「12」は 11/9 の形に書き直した。「0」「1」に残る home.png どおりの話と、「13」「14」の英語の文言は、最初の版のもの。形は「2」〜「6」を、文言は `copy.ts`（「9」）を正とする。

## 0. 段階（11/4にCEOが決定）

- **段階1（今）：UIだけ。** `apps/web` のフロントエンドだけを作る。データは `seed/works.json` の固定データ。ログイン、API、D1、R2、Workerは作らない。
  - Log in と Sign up は、見た目だけ（押しても何もしない）。
  - しおりといいねは、ブラウザの中の状態だけで切り替わる（再読み込みで戻ってよい）。
  - 検索、チップ、並び、石組み、hover、画面幅ごとの形、⌘K／Ctrl+K は、本物として動かす。
- **段階2：データとログイン。** 7〜8のデータ、API、GitHubのログインをつなぐ。段階1のコンポーネントは、データの取り方だけを差し替えて使い回せる形にしておく。
  - ホームの HTML は Worker で作る（11/4に決定）。段階1のビルド時のプリレンダーは、これに置き換える。詳しくは「10. 速さ」。
  - JS を止めたときのカードは、`<noscript>` で単純な並び（等幅のグリッド、同じ縦横比のサムネイル）を出す。
  - Worker は、ブラウザが読む URL の値（c、sort、q、type）をすべて読み、ブラウザと同じ並びを返す。
  - 作り手の募集の投稿は、段階2を作り終えてから出す（11/8にCEOが決定。静的なカタログで先に出す案は取り下げ）。出す条件は `docs/PHASE0.md`。

## 1. 画像から変えるところ（これ以外は画像どおり）

- ロゴの文字を「UI Showcase」から「Ludion」にする。書体、太さ、大きさは画像のまま。
- カードの中身（サムネイル、題名、作者、数）は、実際の作品のデータを出す。画像の中のサンプル（Plot、Acme、紫の画面など）は使わない。
- 検索欄の右のキーの表示は、Macでは「⌘ K」、それ以外では「Ctrl K」にする。

## 2. サイトの色と形

作品の色は作品が持つ。サイトの枠は、次の値だけで作る。`apps/web/src/index.css` の `@theme` はこの写しで、`e2e/spec-sync.spec.ts` が一致を確かめる。

### 色

ダークは `<html data-theme="dark">` のときの値（docs/tasks/T035.md「2」）。名前は同じで、値だけを差し替える。比は WCAG のコントラスト比（ライト / ダーク）で、文字は 4.5:1 以上。作品の枠の中、サムネイル、OG 画像は変えない。`e2e/spec-sync.spec.ts` が、ダークの列と `index.css` の `:root[data-theme='dark']` の一致も確かめる。

| 名前 | 値 | ダーク | 比（ライト / ダーク） | 使う場所 |
| --- | --- | --- | --- | --- |
| `site-bg` | `#FFFFFF` | `#0F0F12` | — | ページの背景。濃い地の上の文字（ダークでは、濃い地の上の文字は `site-fg`） |
| `site-fg` | `#111114` | `#EDEDF0` | 地の上 18.8 / 16.4 | ロゴ、本文、虫めがね、サイドバーのアイコン、チップの文字 |
| `site-fg-2` | `#6B6B76` | `#8E8E99` | 地 5.3 / 5.9、hover 4.7 / 4.8、field 4.8 / 5.2 | 作品のページの2行目、選ばれていない「新着」「人気」 |
| `site-fg-3` | `#4A4A55` | `#B9B9C3` | 地 8.7 / 9.8、field 8.0 / 8.7、key 7.2 / 7.1 | 作品のページの数、検索欄の文字の見本、「⌘ K」 |
| `site-line` | `#ECECF0` | `#26262C` | — | 作品のページのプレビューとコードの箱の枠。ホームの並びでは使わない |
| `site-line-2` | `#E4E4EA` | `#303037` | — | 作品のページの白いボタン、メニューの枠。ホームの並びでは使わない |
| `site-field` | `#F4F4F6` | `#1C1C21` | — | 検索欄の地、サムネイルの読み込み中の地 |
| `site-key` | `#E9E9EE` | `#2C2C33` | — | 「⌘ K」の地 |
| `site-hover` | `#F1F1F4` | `#24242A` | — | サイドバーの今いる項目、チップと文字のボタンの hover、選ばれた並び |
| `site-primary` | `#16161D` | `#EDEDF0` | 上の `site-bg` の文字 18.0 / 16.4 | 選ばれたチップ、カードの「保存」、コードをコピー |
| `site-logo` | `#E5412A` | `#E5412A` | 地の上 4.1 / 4.7（図形なので 3:1 以上） | ロゴのマークの右の括弧。ダークでも同じ値 |
| `site-tab` | `rgb(38 38 44 / .78)` | `rgb(44 44 52 / .86)` | 上の白い文字 7.3 / 12.5 | 下のタブのボタンの地（少し透ける濃い地）。ダークでは文字に `site-fg` を使う |
| `site-scrim` | `rgb(0 0 0 / .64)` | `rgb(0 0 0 / .64)` | — | カードの hover で、絵の下の方を暗くする。ダークでは文字に `site-fg` を使う |
| `site-remix` | `#1D4ED8` | `#2A5AE6` | 上の文字 6.7 / 4.9 | リミックスの帯の地。文字はライトでは白（`site-bg`）、ダークでは `site-fg`。色味は同じで、ダークでは少し明るい |
| `site-lang-js` | `#9A6700` | `#E3C341` | 地の上 4.9 / 11.1（図形なので 3:1 以上） | 作品のページの言語の帯の JavaScript（WS003） |
| `site-lang-glsl` | `#2F6F9F` | `#6FA8CC` | 地の上 5.4 / 7.4 | 言語の帯の GLSL |
| `site-lang-css` | `#7C4DBA` | `#B18CEB` | 地の上 5.8 / 7.1 | 言語の帯の CSS |
| `site-lang-html` | `#C9431E` | `#F0764F` | 地の上 4.9 / 6.8 | 言語の帯の HTML |

### 角丸

| 名前 | 値 | 使う場所 |
| --- | --- | --- |
| `radius-control` | `12px` | ボタン、検索欄、サイドバーの項目 |
| `radius-card` | `16px` | サムネイル、プレビューの枠 |
| `radius-tab` | `14px` | 下のタブのボタン |
| `radius-chip` | `999px` | チップ、カードの「保存」、アバター |
| `radius-key` | `6px` | 「⌘ K」、ツールチップ、メニューの項目 |

### 影

ホームの並びとチップには影を付けない。

| 名前 | 値 | 使う場所 |
| --- | --- | --- |
| `shadow-card` | `0 1px 2px rgb(16 16 24 / .04)` | 作品のページの「もう一度」 |
| `shadow-menu` | `0 8px 24px rgb(16 16 24 / .08)` | アカウントのメニュー |

### 文字

文字は 12px 未満にしない。大きさは整数にする。

| 名前 | 値（大きさ / 行の高さ） | 使う場所 |
| --- | --- | --- |
| `text-logo` | `20px / 24px` | ロゴ |
| `text-title` | `24px / 34px` | 作品のページの題名、作り手のページの名前 |
| `text-subhead` | `18px / 26px` | 作品のページの「ほかの作品」の見出し |
| `text-meta` | `13px / 20px` | 作品のページのレーベル、ライセンスの行 |
| `text-body` | `14px / 20px` | 検索欄、ログイン、チップ、カードの題名、空の表示 |
| `text-small` | `12px / 16px` | 「人気」「新着」、カードの「@作者」と「保存」、作品のページの数 |
| `text-key` | `12px / 17px` | 「⌘ K」、ツールチップ |
| `text-input` | `16px / 24px` | 幅767px以下の「リミックス」の入力欄（iOS の Safari は 16px 未満の入力欄で画面を拡大するため） |
| `tracking-logo` | `-0.02em` | ロゴ |

- 書体：`Inter Variable, "Hiragino Sans", "Noto Sans JP", "BIZ UDPGothic", "Yu Gothic UI", system-ui, sans-serif`。日本語の書体はダウンロードしない（表示の速さのため）。
- サイト全体を `font-feature-settings: "palt"` にする。コード（`pre`、`code`）だけ外す。
- 字間は足さない（ロゴの `tracking-logo` だけ）。`palt` に負の字間を重ねると、かなが詰まりすぎるため。
- 太さは 400、600、700、800 だけ。500 は使わない。Hiragino、Yu Gothic UI、Meiryo で細くも太くも出て、揃わないため。
- 折り返し：`line-break: strict`、`h1`〜`h3` と `p` は `word-break: auto-phrase`。見出しは `text-wrap: balance`、段落は `text-wrap: pretty`。和文と英数字の間は `text-autospace: normal`。
- `<html lang="ja">`。
- フォーカス：すべての押せるものに `outline: 2px solid #16161D; outline-offset: 2px`（`:focus-visible` だけ）。ダークでは `site-primary` の `#EDEDF0`。

### 寸法

| 名前 | 値 | 使う場所 |
| --- | --- | --- |
| `spacing-header` | `88px` | ヘッダーの高さ |
| `spacing-sidebar` | `68px` | サイドバーの幅 |
| `spacing-sidebar-open` | `264px` | サイドバーの開いた形の幅（WS001） |
| `spacing-chip` | `38px` | チップの高さ、作品のページの「もう一度」の高さ |

## 3. 画面の骨組み

幅1440pxと幅390pxの基準。ほかの幅は「5」。

### ヘッダー

- 背景は `site-bg`（ライトは白）。下に線を引かない。高さは 767px 以下が64px、768px 以上が88px。
- 左：ロゴのマーク「」（20×20px。左の括弧は `site-fg`、右の括弧は `site-logo`）＋間隔8px＋ロゴの文字「Ludion」。374px 以下は、スイッチが入っても1行に収まるよう、文字を隠してマークだけにする（読み上げの名前「Ludion」は残す。docs/tasks/T035.md）。20px、太さ800、字間 -0.02em。左端は 767px 以下が16px、768〜1023px が24px、1024px 以上が82px（サイドバーの右から14px）。
- 中央（768px 以上）：検索欄。ビューポートの中央に置く。1024px 以上の幅は `min(668px, 46vw, 100vw - 568px)`、768〜1023px は46vw。高さ44px、地 `site-field`、枠なし。
  - 左に虫めがね（lucide `search`、22px、`site-fg`）、左余白16px。文字は左から49px。
  - 文字の見本：「UI、作品、作者をさがす」14px、`site-fg-3`。どの幅でも同じ文。
  - 右に「⌘ K」：12px、`site-fg-3`、地 `site-key`、角丸6px、余白 2px 6px、キーの間7px、右余白16px。
- 右：ログインしていなければ「ログイン」の文字のボタン（地なし、枠なし、高さ44px、左右12px、14px／太さ600、hover は `site-hover`）。していれば本人のアバター（36pxの円）。ログインのボタンはこの1つだけ（Log in と Sign up はどちらも同じ GitHub のログインなので、分けない。保存した作品へはサイドバーか下のタブから行く）。右端は、グリッドの右端と揃える。
- ログインしていなければ、どの幅でも、「ログイン」のすぐ左にメニューのボタン（lucide `ellipsis`、22px、押せる範囲44×44px、`aria-label`「メニュー」）を置く。押すとメニュー（このスイッチの作品を見る、利用規約、プライバシー、運営者、English）が開く。中身はアカウントのメニューのうちログインしていなくても使うもので、並びも同じ。形とキーボードの動きはアカウントのメニューと同じ（docs/tasks/T035.md「1」）。
- JS が動かないときは、同じ4つ（利用規約、プライバシー、運営者、English）を `<noscript>` の文字のリンクでページの下に置く。
- 767px 以下は、右に検索のボタン（lucide `search`、押せる範囲44×44px）とログインを置く。押すと検索欄が開く。
- ライトとダークのスイッチ（docs/tasks/T035.md「3」）：アバター（ログインしていなければ「…」と「ログイン」）の左、767px 以下では検索のボタンの左。どの幅でも出す。
  - 次の作品のどれかを、ページを開くたびにブラウザが1つ選ぶ（`apps/web/src/lib/themeSwitches.ts`）。承認済みで公開中の今の版だけ。サイトの中で別のページへ移っても選び直さない。
  - 作品は作品のページと同じ守りの枠（`/frame/<id>/<version>/inline.html`、`sandbox="allow-scripts allow-forms"`）で動かす。地は透明、余白は0、根を枠の高さに縮めて中央に置く。
  - 枠の大きさ：767px 以下は 69×42px、768px 以上は 87×53px（作品の横長の丸の高さが 32px と 40px になる）。どの幅でもこの大きさのまま。
  - 枠は、ページの `load` の後、手が空いたときに読む。それまでと、読めなかったときは、太陽と月のボタン（lucide `moon` と `sun`、22px、押せる範囲44×44px）で切り替える。
  - 作品の `[role="switch"]` の `aria-checked="true"` がダーク。枠の中の Ludion のスクリプトと親が `postMessage`（`ld-switch-press`、`ld-switch`、`ld-switch-set`）で知らせ合う。親のモードが正。
  - 押した瞬間にサイトの色を変える：枠のスクリプトがスイッチの `click`（キーで押したときも）を捕まえて `ld-switch-press` を送り、親はすぐに今のモードの逆にする。作品の `aria-checked` は、つまみが渡りきってから変わる。その後の `ld-switch`（`aria-checked` の変化と、ドラッグを離して止まった後の知らせ）は、親のモードと違うときだけ合わせる。モードを変える知らせが1秒に3回以上来たら無視し、静かになってから親のモードを枠に言い直す。
  - 吹き出しは出さない（docs/tasks/T039.md）。作者を示すのは、アカウントと「…」のメニューの「このスイッチの作品を見る」（原則4）。読み上げでは、枠の title が「ダークモードの切り替え（〈作品の題〉 · @作者）」と言う。
  - 最初は端末の設定（`prefers-color-scheme`）に従う。押して選んだら、その端末の `localStorage` の `ld-theme` に覚える。サーバーには送らない。GA4 にも送らない。
  - `<html data-theme>` は `index.html` の小さなインラインのスクリプトが、最初の描画の前に付ける。`color-scheme` と `<meta name="theme-color">` も合わせる。

### サイドバー（1024px 以上）

- 幅68px。ヘッダーの下から始まる。右の区切り線はない。スクロールしても動かない（sticky）。
- 3項目を縦に並べる。各46×46px、角丸12px、間隔8px。1つ目の上端は、ヘッダーの下から20px。その下に、作品を置ける人にだけ「作品を置く」（lucide `plus`。同じ形で、読み込み直して移る。「19」）。
- アイコン（lucide、22px、線の太さ1.75、`site-fg`）：`house`、`compass`、`bookmark`。
- 今いる項目だけ、地を `site-hover` にする。
- 各項目に `aria-label` と、右に出るツールチップ：ホーム、探す、保存。
- 列の下の端には何も置かない。利用規約、プライバシー、運営者、English は、ヘッダーのメニュー（アカウントと「…」）にある（docs/tasks/T035.md「1」。2か所に置かない）。
- **自分の作品**（WS001）：
  - たたんだ形（68px）は、上の項目の下に「自分の作品」（lucide `folder`。`/account/works`）。ログインしていない人には、押すとログインへ行き、ツールチップと読み上げで「ログインすると、作った作品がここに並ぶ」の1行を出す。ログインしている人には、その下に「左のナビを広げる」（`panel-left-open`）。
  - 開いた形（幅 `spacing-sidebar-open` の264px）：ホーム、探す、保存（アイコンの右に名前）→ 区切り →「自分の作品」と「＋ 新しく」→ 題で探す欄 → 作品の並び →「すべての作品」→「たたむ」。アイコンは、たたんだ形と同じ位置（左から11px）。
  - 作品の並び：40×25px のサムネイル（なければコードの印 `code-xml`）、題、2行目に「版 N」、右に状態の印（自分の作品のページの札と同じ分け方。読み上げは札と同じ言葉）。いちばん新しい版の日時の新しい順。今開いている作品は `aria-current="page"` と地 `site-hover`。押すとその作品のページ（読み込み直して開く）。まだページのない下書きは続きを書く画面、審査を待っているものは自分の作品のページへ。
  - ログインしていて作品が1つ以上ある人は、開いた形が初め。たたんだかどうかは、その端末の `localStorage` の `ld-nav` にだけ覚える（読めなければ開いた形）。作品が 0 の人は、たたんだ形が初めで、開くと「AI につなぐと、作ったものがここに並ぶ」とアカウントの「AI につなぐ」へのリンク。
  - HTML は人によって変えないので、Worker の描画はたたんだ形。前に開いた形だった端末は、`index.html` のインラインのスクリプトが最初の描画の前に `<html data-nav="open">` を付け（`localStorage` の `ld-nav-open`）、中身の幅が後から動かないようにする。
  - 一覧は、`GET /api/me` の `works_count` が 1 以上のときだけ、その後に `GET /api/post/works` で読む。画面の中で移るとき（ホーム、探す、保存、自分の作品）は読み直さない。読み込み直して開くページ（作品のページ、作品を置く画面）では、`GET /api/me` と同じく、開くたびに1回読む。並びと開いた形の中身の JS は、ログインしている人にだけ、その後に読む。

### 下のタブ（1023px 以下）

- 画面の下の中央に浮いた3つのボタン（ホーム、探す、保存）。中身はその下を流れる。下から16px。ボタンの間は8px。
- ログインしている人だけ、3つ目に「作品」（lucide `folder`）を足して4つにする（WS001）。押すと下からシート：「自分の作品」と「＋ 新しく」、題で探す欄、絞り（すべて、自分だけ、公開）、作品の並び（サイドバーと同じ行）、「すべての作品」。触る所は高さ44px 以上。Esc と後ろの暗い所で閉じ、押したボタンにフォーカスを戻す。開いている間は、シートの中だけをキーで回る（`<dialog>`）。
- 各48×48px、角丸14px、地 `site-tab`、背景のぼかし（`backdrop-filter: blur`）。枠なし。アイコンは22px、白。
- 今いる項目は、線の太さ2.5、白。ほかは線の太さ1.75、白の65%。
- 帯の部分はないので、ボタンの間は下のカードを押せる。
- 本文の下の余白は96px にして、最後の列がタブに隠れないようにする。

### 絞り込みの列

- ヘッダーの下から13px（767px 以下は8px）。左端はグリッドの左端に揃える。
- チップ9個は文字だけ。アイコン、枠線、影はない。高さ38px、角丸999px、左右14px、間隔4px、14px／太さ600。
  - 選ばれていないチップ：地なし、文字 `site-fg`、hover は `site-hover`。
  - 選ばれたチップ：地 `site-primary`、文字は白。選んでも幅は変わらない。
  - 文字：すべて、Web、モバイル、ダッシュボード、EC、ミニマル、実験、モーション、壁紙。
  - 767px 以下は横に流れ、端まで使う（スクロールの線は出さない）。
- チップは `<a href="/?c=web">` の形のリンクにする。JS が届く前でも押せば移れて、URL を人に送れる。選ばれた項目に `aria-current="true"` を付ける（同じページの中の絞り込みだから。`"page"` は、サイドバーと下のタブの今いる項目にだけ付ける）。検索語や並びなど、ほかの絞り込みは保つ。
- 768px 以上は、右端に小さく「人気」「新着」の切り替えを置く。高さ32px、左右12px、12px／太さ600、角丸999px。選ばれた項目は地 `site-hover`、文字 `site-fg`。ほかは地なし、文字 `site-fg-2`。リンクで、`aria-current="true"` を付ける。
- 767px 以下には切り替えを置かない。新着は下のタブの「探す」（`/?sort=new`）から見る。
- 「Sort: Popular」の行は置かない。

### グリッド

- 絞り込みの列の下から16px（767px 以下は8px）。
- 石組み（masonry）。
  - 767px 以下：2列。列の間も縦も8px。左右の余白8px。
  - 768px 以上：列の幅を約240px にして入るだけ並べる（「5」）。列の間も縦も16px。左右の余白24px（左はサイドバーの右から）。
- カードは絵だけ。カードの枠線、影、背景の面、題名、カテゴリの行、作者のアバターと名前、いいねの数、しおりのボタンを並びに置かない。
  - リミックス（`remix_of` がある作品と、コードに「Remix by」または「Remixed by」がある作品）だけ、絵の左上に斜めの帯を出す。地は `site-remix`、文字は白の「Remix」（12px、太さ700）。影は付けない。保存のボタン（右上）とは重ならない。帯はリンクの中で、角丸で切れる。
  - サムネイル：カードの幅いっぱい。角丸16px。縦横比は作品ごと（`thumb_w`、`thumb_h`）。ただし高さ÷幅は 0.6〜1.25 に収め、はみ出す分は `object-fit: cover; object-position: top` で切る。読み込み中の地は `site-field`。
  - 作者の名前は、作品のページ、作り手のページ、コピーしたコードの1行目に、今までどおり出す（CLAUDE.md 原則4）。並びから消えるのは見た目だけで、題名と「@作者」は読み上げには残す。
- 768px 以上で、カーソルを乗せたとき、またはキーボードでカードの中にフォーカスがあるときだけ、次のものを 150ms で重ねる。絵は拡大しない。
  - 絵の下の方を暗くする：下から高さ112pxのグラデーション。下から52px までは `site-scrim` の濃さで、白い絵の上でも白い文字が読める。
  - 絵の左下に、題名（14px／太さ600）と「@作者」（12px）。白い文字で、余白は左右12px、下12px。1行に収めて「…」で切る。
  - 絵の右上（上と右から8px）に「保存」のボタン。高さ36px、左右14px、角丸999px、12px／太さ600。地 `site-primary`、文字は白。保存済みなら「保存済み」で、地は白、文字 `site-fg`。
- 767px 以下では何も重ねない。保存のボタンも置かない（保存は作品のページから）。
- カーソルのない画面（`hover: none`）では、768px 以上でも見えない保存のボタンを押せないようにする。絵のどこを押しても作品のページへ行く。
- マークアップ：カードは `<article>`。絵は `/p/:id` への `<a>` で、題名の `<h2>` と「@作者」もこの中に入れる（767px 以下は読み上げだけ）。保存は `<a>` の外の `<button>`（リンクの中にボタンを入れない）。

### 数の書き方

作品のページと作り手のページで使う。

- 1万未満はカンマ区切り（952、1,240）。1万以上は小数1桁＋万（1.2万、12万）。末尾が .0 なら省く。1億以上は億（1.2億）。

## 4. 動き

- **検索**：題名、カテゴリとサブ種類（データの英語と画面の日本語のどちらでも）、作者名で絞る。入力から150ms後に反映し、URLの `?q=` に入れる。`⌘K`／`Ctrl+K` で検索欄にフォーカス、Escで外す。
- **チップ**：1つだけ選べる。URLは `?c=web|mobile|dashboard|ecommerce|minimal|experimental|motion|wallpaper`。「すべて」は `c` なし。
- **並び**：人気と新着。既定は人気。新着は `?sort=new`。
  - 人気の順：オーナーが付けた `pin_order`（小さい順、付いていない作品は後ろ）→ 直近30日のコピー数 → いいね数 → 公開日の新しい順。いいね数だけでは並べない。
- **カード**：絵を押すと `/p/:id` へ。
- **保存（しおり）**：ログインしていなければ、GitHubのログインへ行き、終わったら元のURLに戻る。ログインしていれば、その場で切り替える（先に見た目を変え、失敗したら戻す）。
- **いいね**：押すのは作品のページ（`/p/:id`）。並びには数を出さない。
- **サイドバーと下のタブ**：ホーム → `/`、探す → `/?sort=new`、保存 → `/account/saved`（要ログイン。`/saved` は転送する）。部品だけの一覧 `/?type=component` は、項目を置かないが URL としては動く。
- **ログイン**：GitHubのログイン（`/auth/github`）へ。ログイン後は、ボタンの場所に本人のアバター（36pxの円）を出す。押すとメニュー（保存した作品、プライバシー、運営者、ログアウト）。

## 5. 画面幅

| 幅 | 列 | 間隔 | サイドバー | ヘッダー |
| --- | --- | --- | --- | --- |
| 1024px以上 | 列の幅が約240pxになる数（1440pxで5列、1920pxで7列） | 16px | 左に出す（3項目） | ロゴ＋検索欄＋ログイン |
| 768〜1023px | 同じ（768pxで3列、1023pxで4列） | 16px | 隠し、下のタブ（3項目） | ロゴ＋検索欄＋ログイン。ロゴの左端は24px |
| 767px以下 | 2 | 8px | 下のタブ（3項目） | 高さ64px。ロゴ＋検索のアイコン＋ログイン。アイコンを押すと検索欄が開く。チップは横にスクロール |

- 列の数は、入れ物の幅を `w` として `max(2, round((w + 16) / (240 + 16)))`。列の幅は `(w - 16 × (列の数 - 1)) / 列の数`。
- サイドバーの開いた形（264px。「3」、WS001）のときは、入れ物が196px狭くなる。同じ式で、1440px と 1280px は4列になる。
- どの幅でも、ページに横スクロールを出さない。

## 6. 石組みの並べ方

- CSSの `columns` は使わない。上から下へ流れるので、人気の順が左上から右へ読めなくなる。
- 各カードの高さは、サムネイルの縦横比から計算できる（カードは絵だけ）。並び順に1枚ずつ、いちばん低い列へ置く。画像の読み込みは待たない。
- これで、人気の順に左上から右へ読め、画像が読み込まれてもカードが動かない。

## 7. データ（D1 `ludion-app`）

```sql
CREATE TABLE users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, display_name TEXT, avatar_url TEXT, x_url TEXT, site_url TEXT, created_at INTEGER NOT NULL, is_operator INTEGER NOT NULL DEFAULT 0); -- id は変わらない本人の鍵。handle は小文字の [a-z0-9_] で3〜20文字（CHECK）。is_operator は運営の印で、審査はこの人だけ
CREATE TABLE identities (user_id TEXT NOT NULL, provider TEXT NOT NULL CHECK (provider IN ('github','google')), subject TEXT NOT NULL, label TEXT, avatar_url TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, PRIMARY KEY (provider, subject)); -- ログインの手段。1人につき同じ手段は1つまで。subject はその手段の中の変わらない番号、label は手段の中の名前（GitHub は login）。名前やメールの一致で別の手段を同じ人にしない
CREATE TABLE handle_history (handle TEXT PRIMARY KEY, user_id TEXT NOT NULL, released_at INTEGER NOT NULL); -- 前の handle。released_at（変えてから90日）までほかの人が取れず、/c/前の handle は新しい方へ転送する
CREATE TABLE passkeys (credential_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', label TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER); -- 持つのは公開鍵とその情報だけ。label は本人が付ける名前（任意）
CREATE TABLE recovery_codes (code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL); -- 回復のコードのハッシュ。1人に1つ。使ったら消える
CREATE TABLE ai_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, deleted_at INTEGER); -- AI の鍵（/api/v1。docs/tasks/T037.md）。持つのは SHA-256 のハッシュだけ。1人5本まで。last_used_at は日の単位。消した鍵は deleted_at を入れて残し、退会で行ごと消す
CREATE TABLE oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, secret_hash TEXT, created_at INTEGER NOT NULL); -- AI につなぐ（/mcp。MCP001）。動的に登録した AI のアプリの名前と戻り先。人に結ばない。一度もつながらなかった登録は7日で消す
CREATE TABLE oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, user_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, code_challenge TEXT NOT NULL, expires_at INTEGER NOT NULL); -- 「許可」の後の証のハッシュ。PKCE（S256）に結び、1回だけ使え、10分で切れる
CREATE TABLE oauth_grants (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL, client_name TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, access_expires_at INTEGER NOT NULL, refresh_hash TEXT NOT NULL UNIQUE, refresh_expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER); -- つないでいる AI。トークンは SHA-256 のハッシュだけ（アクセス1時間、リフレッシュ180日で、使うたびに作り直す）。1人20まで。last_used_at は日の単位。切ったら、退会したら行ごと消す
CREATE TABLE auth_flows (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL); -- ログインの途中の状態。cookie には乱数だけを渡す。1回だけ使え、短い時間で切れる
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER NOT NULL DEFAULT 0, auth_at INTEGER NOT NULL DEFAULT 0); -- created_at と last_used_at は日の単位（UTC の0時）。auth_at はログインした時刻で、直近10分以内のログインを確かめるためだけに使う。IP と UA は持たない
CREATE TABLE creators (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, name TEXT, kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','label')), avatar_url TEXT, x_url TEXT, site_url TEXT, user_id TEXT, created_at INTEGER NOT NULL); -- kind：label は運営のレーベル（CLAUDE.md 原則10）。handle は大文字と小文字を区別せずに一意。user_id は作者と人を結ぶ。結ばれていない作者の handle は、ほかの人が取れない
CREATE TABLE works (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL, title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screen','component')),
  platform TEXT CHECK (platform IN ('web','mobile')),
  category TEXT NOT NULL,      -- カードの2行目の左（Web、Mobile、Dashboard、Ecommerce、Components）
  subtype TEXT NOT NULL,       -- カードの2行目の右（Landing Page、Travel、Analytics、UI Kit など）
  tags TEXT NOT NULL DEFAULT '[]', -- JSON。dashboard、ecommerce、minimal、experimental、motion
  made_with TEXT NOT NULL CHECK (made_with IN ('human','ai-assisted')), -- 作り方（CLAUDE.md 原則9）
  version TEXT NOT NULL, license TEXT NOT NULL DEFAULT 'MIT',
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected','private')), -- private は自分だけの作品（docs/tasks/T036.md）
  tokens_locked TEXT NOT NULL DEFAULT '[]', pin_order INTEGER, reject_reason TEXT,
  thumb_key TEXT NOT NULL, thumb_w INTEGER NOT NULL, thumb_h INTEGER NOT NULL,
  is_remix INTEGER NOT NULL DEFAULT 0, -- remix_of がある、またはコードに Remix by か Remixed by がある。一覧の帯に使う
  remix_of TEXT, -- リミックスの元の作品の ID（docs/tasks/T033.md B3）。作品を作るときに決まり、変えない。元が取り下げられても残す
  created_at INTEGER NOT NULL, published_at INTEGER
);
CREATE TABLE revisions (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL,
  version TEXT NOT NULL,       -- 枠とサムネイルの URL に入る。作品の中で一意
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','rejected','revoked','private')), -- private は自分だけで置いた版（審査していない）
  r2_prefix TEXT NOT NULL,     -- サーバーが作る。ld upload の版は works/<id>/<version>、投稿の版は revisions/<版の id>/<中身のハッシュの頭>
  content_hash TEXT NOT NULL DEFAULT '', -- 審査で見たものと承認するものを結ぶ
  title TEXT NOT NULL, type TEXT NOT NULL, platform TEXT, category TEXT NOT NULL, subtype TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', made_with TEXT NOT NULL,
  thumb_w INTEGER NOT NULL, thumb_h INTEGER NOT NULL, -- サムネイルのない下書きは 0（審査に出すには要る）
  tokens_ok INTEGER NOT NULL DEFAULT 0, -- 10個のトークンに合っているか。データだけで、今は印を出さない
  is_remix INTEGER NOT NULL DEFAULT 0, -- 承認すると works.is_remix に写す
  remix_of TEXT, -- 作品の remix_of を写す
  via TEXT, -- その版をどの AI から置いたか（X-Ludion-Client があればそれ。なければ、つないだ AI の名前、AI の鍵なら API。MCP001、VIA001）。画面から置いた版は NULL。持ち主の置き場にだけ出す
  reject_code TEXT, reject_note TEXT, created_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, submitted_at INTEGER, reviewed_at INTEGER, reviewed_by TEXT,
  UNIQUE (work_id, version)
); -- 作品ごとの版。公開した版は変えない。直している最中の版（draft か submitted）は1つの作品に1つまで（一意の索引）
CREATE TABLE quotas (key TEXT NOT NULL, bucket TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, PRIMARY KEY (key, bucket)); -- 1時間と1日の回数の上限（worker/quota.ts）。IP は秘密の値と日付の HMAC だけを置く。切れたら消す
CREATE TABLE counters (work_id TEXT, day TEXT, views INTEGER NOT NULL DEFAULT 0, copies INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (work_id, day));
CREATE TABLE likes (user_id TEXT, work_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, work_id));
CREATE TABLE bookmarks (user_id TEXT, work_id TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, work_id));
CREATE TABLE applications (id TEXT PRIMARY KEY, handle TEXT, urls TEXT, note TEXT, status TEXT, created_at INTEGER);
CREATE TABLE invites (token_hash TEXT PRIMARY KEY, creator_id TEXT, expires_at INTEGER, used_at INTEGER);
```

チップと絞り込みの対応：Web → `platform='web'`、Mobile → `platform='mobile'`、Dashboard・Ecommerce・Minimal・Experimental・Motion → `tags` に含む。壁紙 → `subtype='Wallpaper'`（WALL001）。Components → `type='component'`。

`works` は公開の値を持つ（一覧と作品のページが読む）。投稿の版を承認すると、その版の値で `works` を差し替える。直した版の審査中は、前の版の値のまま。`works.status` の `rejected` は取り下げも含む（`reject_reason` が `owner_revoked` など）。`works.status` の `private` は自分だけの作品で、`works` の値は本人に見せる今の版（自分だけで置いた版か、前に公開していた版）。一覧と公開の道は `approved` だけを読むので、`private` はどこにも出ない（docs/tasks/T036.md）。

R2（`ludion-parts`）：版の `r2_prefix` の下に `part.html`、`part.css`、`part.js`、`meta.json`、`thumb.webp`、`og.png`。オーナーの壁紙の作品は、ほかに静止画 `wall-3840x2160.png`、`wall-2560x1440.png`、`wall-1920x1080.png`（WALL002）。サムネイルは Worker が `Cache-Control: public, max-age=3600, s-maxage=31536000` で返す（パスに version が入るので、変わったら別の URL になる。ブラウザに長く残すと取り下げが届かないので、ブラウザには1時間。SEC001 A07）。

## 8. API

| メソッドとパス | 中身 |
| --- | --- |
| `GET /api/works` | 承認済みの作品をすべて（200件まで）、Popularの順で返す。各作品に閲覧数、いいね数、コピー数、リミックスの帯（`remix`）。人によって変わる情報は入れない（ホームの HTML をキャッシュするため。「10. 速さ」）。絞り込み・検索・Newestはブラウザでやる |
| `POST /api/works/:id/like` | いいねを切り替える（要ログイン） |
| `POST /api/works/:id/bookmark` | しおりを切り替える（要ログイン） |
| `GET /api/me` | ログイン中の本人（`handle`、`display_name`、`avatar_url`。運営にだけ審査待ちの数 `review_pending`）と、いいね済み・しおり済みの作品の id、作品を置けるか（`can_post`）（いなければ `null`） |
| `GET /api/me/bookmarks` | 本人のしおり |
| `GET /api/me/likes` | 本人のいいね |
| `GET /api/account` | 本人のプロフィール、ログインの手段、ログイン中の端末、公開している作品の数、直近のログインか |
| `GET /api/account/works` | 自分に結ばれた作者の、承認済みの作品 |
| `GET /api/account/handle-check?handle=` | その handle を取れるか（`ok`、`same`、`format`、`reserved`、`taken`、`held`） |
| `POST /api/account/profile` | 表示の名前、X の URL、サイトの URL（`https://` だけ）を変える。結ばれた作者にも写す |
| `POST /api/account/handle` | handle を変える。結ばれた作者の handle も変わる |
| `POST /api/account/sessions/:id/revoke` | 1つの端末をログアウトする |
| `POST /api/account/sessions/revoke-others` | この端末のほかを全部ログアウトする |
| `POST /api/account/identities/:provider/remove` | 手段を外す。直近10分以内のログインが要る。最後の1つは外せない |
| `POST /api/account/delete` | 退会。直近10分以内のログインが要る |
| `POST /api/count` | `{ work_id, type: "view" \| "copy" }`。その日のカウンタを1つ増やすだけ。ログイン中の人が作品の持ち主なら数えない |
| `GET /auth/github` | GitHubのログインへ。`?next=` に戻り先（自分のサイトのパスだけ受け付ける）。`?intent=reauth` は今の本人の手段でなければ断る |
| `GET /auth/github/callback` | セッションを作り、`next` へ戻す |
| `GET /auth/google` | Google のログインへ。認可コード ＋ PKCE ＋ state ＋ nonce。スコープは `openid profile` だけ。`?next=`、`?intent=reauth`、`?intent=link` は GitHub と同じ |
| `GET /auth/google/callback` | ID トークンを確かめ、知っている人はセッションを作って `next` へ、新しい人は `/signup` へ |
| `GET /auth/signup/pending` | 手段で確かめた新しい人の、手段の名前と handle の候補 |
| `POST /auth/signup/complete` | handle を決めて人を作り、ログインした状態にする |
| `GET /api/signup/handle-check?handle=` | ログインしていない人の handle の確かめ |
| `POST /auth/passkey/register/options`、`/register/verify` | パスキーを作る。ログイン中の人は足す（直近10分以内のログインが要る）。していない人は handle を選んで新しく作り、回復のコードを1回だけ受け取る |
| `POST /auth/passkey/login/options`、`/login/verify` | パスキーでログインする。名前は打たない。`intent: "reauth"` は今の本人のパスキーだけを受ける |
| `POST /auth/passkey/recovery` | 回復のコードで入る。1回で消え、ほかのセッションも消える |
| `POST /api/account/passkeys/:id/remove` | パスキーを外す。直近10分以内のログインが要る。最後の手段は外せない |
| `POST /api/account/recovery-code` | 回復のコードを作り直す。前のものは無効になる |
| `POST /auth/logout` | セッションを消す |
| `POST /api/admin/works` | `ld upload` から受け取る（管理トークン）。人が結ばれた作者の handle、名前、リンク、アバターは上書きしない |
| `POST /api/admin/revisions/:rid/revoke` | 1つの版だけを取り下げる（管理トークン）。今の公開の版なら作品も公開から消す |
| `POST /api/post/works`、`POST /api/post/works/:id/revisions` | 投稿の保存（要ログイン）。multipart で、名前は `meta`、`part.html`、`part.css`、`part.js`、`thumb` だけ。全体 4 MiB を実際のバイト数で止める。知らない名前と重複は断る。他人の作品は 403。検査で落ちると 422 で、どこが何で落ちたかと直し方を返す |
| `GET /api/post/works`、`GET /api/post/works/:id` | 自分の作品の一覧と状態。直すための版の中身 |
| `GET /api/post/id-check?id=` | 新しい作品の ID を取れるか（`ok`、`format`、`reserved`、`taken`） |
| `POST /api/post/revisions/:rid/submit` | 下書きを審査に出す。`{ own, mit, terms }` が全部 `true` のときだけ |
| `POST /api/post/revisions/:rid/place` | 下書きを自分だけで置く（審査しない）。`{ own, mit, terms }` が全部 `true`、題が要る。サムネイルは無くてよい。公開している作品の版は置けない（`public`）。自分だけの作品は1人100作品まで（`private_limit`） |
| `POST /api/post/works/:id/publish` | 自分だけ → 公開する。今の版を審査に出す。承認まで、ほかの人には 404 のまま。差し戻されたら自分だけのまま。サムネイルが要る |
| `POST /api/post/works/:id/make-private` | 公開 → 自分だけにする。すぐ。審査待ちの版は下書きに戻す。`catalog` と作品の札を消す |
| `POST /api/post/works/:id/revoke` | 自分の作品を取り下げる（画面からは使わない。持ち主の画面は「自分だけにする」。docs/reports/T036.md） |
| `GET /api/review/queue`、`GET /api/review/revisions/:rid` | 審査待ちの一覧（古い順）と1件の全部（運営だけ。ほかの人には 404） |
| `POST /api/review/revisions/:rid/approve` | `{ content_hash }`。見た中身のハッシュと同じときだけ承認する（運営だけ） |
| `POST /api/review/revisions/:rid/reject` | `{ reason, note }`。理由は作り手に見える（運営だけ） |
| `GET /sitemap.xml` | ホーム、承認済みの全作品のページ、承認済みの作品がある作り手のページ、`/about`、`/privacy`。D1 から作り、URL はすべて `https://ludion.ai/...`。キャッシュは `catalog` の札で消える。`robots.txt` が指す |

応募と招待の流れはやめ、作り手が自分で投稿する（`docs/tasks/T021.md`。「19」）。

## 9. 文言

### 言語（11/9 に CEO が多言語にすると決定。判定の形は「一番良い形」として任された）

- 日本語は今の URL、英語は `/en` の下（`/en`、`/en/p/:id`、`/en/c/:handle`、`/en/account` とその下、`/en/privacy`、`/en/about`）。今までのリンクは変えない。
- 言語は必ず URL で分ける。Workers Cache は Worker の前に立ち、キーは道と URL の値だけなので、同じ URL で人によって言語を変えると、別の人に別の言語が出る。
- 決める順番は、言語の切り替えで選んだ言語（cookie `ld_lang`）→ ブラウザの言語。`navigator.languages` のどこかに `ja` があれば日本語、なければ英語。`/en` を直接開いた人は、選んでいなければ英語のまま。
- 判定は `index.html` のインラインのスクリプトで、最初の描画の前にやる。移るときは React も GA4 も閲覧数も動かさない。追加の通信はなく、日本語のブラウザには何も足さない。
- IP と国は使わない。国と言語は一致しないし（海外にいる日本人、日本にいる外国人、VPN）、Worker の前のキャッシュが当たると国を読めない。
- 検索エンジンと共有のカードのボットは移さない（UA で見分ける）。すべてのページに `hreflang`（`ja`、`en`、`x-default` は英語）と、サイトマップの対応を入れる。
- 切り替えは、どの幅でもヘッダーのメニュー（アカウントと「…」）。JS が動かないときはページの下の文字のリンク。同じページのもう一方の言語へ移る。
- 共有のリンクは言語のない `/p/:id`。受け取った人のブラウザの言語で開く。
- 作品の題名と中身は作り手のものなので訳さない。`/en/privacy` は翻訳で、日本語版を正とする。
- 数は、英語では `952`、`12.4k`、`1.2M`。

サイトの言葉は日本語（11/8 に CEO が決定）。画面の文字、読み上げの文字（`aria-label`）、`<title>` は、すべて `apps/web/src/copy.ts` の1か所に置く。英語は `copy.en.ts` に同じ形で置く。仕組みはこのまま1か所にまとめておく。文言の正本は `copy.ts` で、この文書の他の節に残る英語の文言（「0」「1」「13」「14」）は `copy.ts` の日本語に読み替える。

主な言葉：

- チップ：すべて、Web、モバイル、ダッシュボード、EC、ミニマル、実験、モーション、壁紙
- 並び：人気、新着
- 移動：ホーム、探す、保存。保存した作品のページの見出しは「保存した作品」
- ヘッダー：ログイン、ログアウト。検索の見本は「UI、作品、作者をさがす」
- 作品のページ：保存、保存済み、コードをコピー、コピーしました、見られた数、コピーされた数
- レーベル：作品のページは「Ludion Studio のレーベル」、作り手のページは「Ludion Studio のレーベル（運営が制作）」
- 検索で何も見つからないとき：「「{q}」の作品が見つかりません」＋ボタン「条件をはずす」
- 保存が空のとき：「まだ何も保存していません」

英字のままでよいのは、固有名詞の Ludion（Ludion Studio）、GitHub、Web、EC、UI、MIT、X と、キーの名前の Ctrl、K だけ。プライバシーと運営者のページ（「16」）に要るものとして、Google（Google LLC）、GA4、Cloudflare、Lattice（@Lattice_Node）、URL、IP、UA、ID、cookie と、cookie の名前（`ld_session`、`ld_github_flow`、`ld_google_flow`、`ld_signup`、`ld_passkey_flow`、`_ga`）も認める。作品のページの知らせ（「13」のプレビュー）に要るものとして、3D、WebGL も認める。作品を置く画面（「19」）に要るものとして、AI、Claude、ChatGPT、HTML、CSS、JS、PNG、JPEG、WebP、KB、MB、px、`part.html`、`part.css`、`part.js`、`data-ld-part`、`export function mount(root)` も認める。AI に渡す指示文（`copy.post.ai.prompt`）はコードの決まりなので、この決まりの外に置く。1つの箱とリミックスの指示文（docs/tasks/T033.md）に要るものとして、HTML の要素と書き方の名前（`doctype`、`style`、`script`、`script src`、`script type="module"`、`link`、`@import`、`function mount(root)`、`mount(...)`、`root`）も認める。「リミックス」（「13」）に要るものとして、Claude Code、ChatGPT、HTML、Remixed by、Remix、ハッシュタグの LudionRemix も認める。ログインの画面の知らせ（「16」の下のログインの決まり）に要るものとして、Safari も認める。`e2e/spec-sync.spec.ts` が確かめる。

作品のデータ（題名、サブ種類）は作り手が書いたものなので、訳さない。カテゴリ（`category`）だけは決まった語なので、`copy.ts` の表で画面の言葉にする（Components → 部品、Mobile → モバイル、Dashboard → ダッシュボード、Ecommerce → EC）。コピーされるコードのクレジット行は CLAUDE.md の形のままで、訳さない。

## 10. 速さ

- サムネイルはwebp、幅800px、1枚80KB以下。`width` と `height` を必ず付ける。
- 最初の8枚は `loading="eager"`、1枚目だけ `fetchpriority="high"`。残りは `loading="lazy"`。
- 残りの `src` は、ページの `load` が終わってから付ける。`lazy` でも Chrome は画面の遠くまで先読みし、LCP の画像や JS と回線を取り合う。
- 段階1：ホームの HTML はビルド時に作る（プリレンダー。`apps/web/scripts/prerender.mjs`）。LCP のサムネイルが JS の到着を待たないようにするため。
  - カードの位置は、HTML の直後のインラインスクリプト（`src/prerender/beforeApp.ts`）が、`lib/masonry.ts` と同じ計算で決める。React が載っても動かない。
  - 絞り込み付きの URL と別のページはプリレンダーを使わず、ブラウザで描く。
- 段階2：ホームの HTML は Worker で作り、段階1のプリレンダーを置き換える（11/4に決定）。
  - 同じ React のコンポーネントを Worker で描画して返す（`renderToReadableStream`）。作品の一覧は HTML の中に JSON で埋め込み、ブラウザで API を呼び直さない。
  - HTML は人によって変えない。ログイン、いいね済み、しおり済みは、読み込んだ後に `GET /api/me` で足す。
  - だから Workers Cache（Worker 自身のキャッシュ）でキャッシュできる（11/4に決定）。Cache API は使わない。`cache.delete` は Worker が動いたデータセンターの分しか消さず、承認しても他の地域で古い一覧が出続けるため。
  - ホームの HTML には、c、sort、q、type のどの組み合わせでも `Cache-Tag: catalog` を付け、`Cache-Control` は `s-maxage=60` にする。
  - 作品の承認、版の差し替え、取り下げのときに `ctx.cache.purge({ tags: ["catalog"] })` を呼ぶ。タグで消すので、q 付きの URL もキャッシュしてよく、消し残りも出ない。
  - Workers Cache の今の状態（ベータかどうか、料金、purge の回数の上限）は、`docs/reports/T012.md` に出典と一緒に書いた。
  - キャッシュは許したものだけ（`apps/web/worker/cachePolicy.ts`、`apps/web/e2e/cache.spec.ts`）。許すのは、ホーム（URL の値つきを含む）、作品のページ、作り手のページの HTML、作品のコードの文字（`/p/:id/code`。「13」）、作品の地図（`/p/<id>.json`）とファイルの生の文字（`/p/<id>/raw/<file>`。「13」）と `/sitemap.xml`（`public, max-age=0, s-maxage=60`、`Cache-Tag: catalog`）、`/privacy` と `/about` の HTML（同じ指示で、札なし）、サムネイル（`public, max-age=3600, s-maxage=31536000`、札は作品ごと）、アバター、`/assets/` の静的アセット（`public, max-age=31536000, immutable`）の 200 だけ。それ以外は `private, no-store`。`Set-Cookie` を含む応答は、どんな場合もキャッシュしない。枠（`/frame/...`）と OG 画像もキャッシュしない。
  - キャッシュのキーにホストも cookie も入らない。だから人によって変わる応答を一覧に足さない。workers.dev と ludion.ai で同じ項目を使うので、HTML の中の絶対 URL は ludion.ai にする。
  - 同じ理由で、`www.ludion.ai` は `ludion-web` につながず、転送だけをする別の Worker（`apps/web/www-redirect/`）で `https://ludion.ai` へ 301 で送る。
  - 取り下げのときは、作品のサムネイルの札（`work-<id>`）も消す。当たると Worker の「承認済みか」の確かめを通らないため。
  - 消せなかったら 1秒、2秒、4秒でやり直す。3回とも失敗したら、`ld upload` が「一覧の反映に最大60秒かかる」と出す。
  - `/?c=web` などの絞り込み付きの URL も同じ仕組みで返す。
  - 置き換えた後、画面外の画像を後回しにする仕組み（`load` まで `src` を付けない）がまだ要るかを測り直す。LCP は本番の Cloudflare の URL でも測り直す。
- 段階2でホームを開くときのAPIの呼び出しは `GET /api/me` の1本だけ。

## 11. 開発用の見本データ（`seed/`）

- 50作品。サムネイルはスクリプトで作る：無地の色面に題名を1行。縦横比は高さ÷幅＝0.6〜1.25 の間でばらばらにする。
- 参考画像の切り抜き、実在の会社のロゴやブランド名は使わない。
- 作者は `@seed_a`〜`@seed_d`。本番のD1には入れない。

## 12. 受け入れの条件

11/9 に今のホームの形に書き直した。見た目の正解は「2」〜「6」の数字と `docs/reference/pinterest-mobile.png`（形だけ）。`docs/reference/home.png` は最初の版で、比べる相手にしない。

- 1440×900のスクリーンショットを `docs/screens/home-1440.png` に置き、次が「3」のとおりであること：ヘッダーの高さと3つの領域の位置、検索欄が中央、右上は「ログイン」の1つ、サイドバーの3項目（ホーム、探す、保存）とその下の「プライバシー」「運営者」、チップ9個、右端の「人気」「新着」の切り替え、石組みの列の数（1440px で5列）、カードは絵だけ（題名、作者、数、枠線、影を並びに置かない）。カーソルを乗せたときだけ、題名、「@作者」、「保存」を重ねる。
- 390×844 と 768×1024 のスクリーンショットも置く。横スクロールが出ない。幅390は2列で、下のタブが3つ。
- 本番の URL の、本番の作品（今は10作品）で、スマホのLCPが2.5秒以内、CLSが0.05以下。測り方は `apps/web/scripts/lighthouse-prod.mjs`（Lighthouse の mobile、本番の URL、5回の中央値）。手元の `npm run lcp` は開発の目安で、合否には使わない。
- キーボードだけで、検索→チップ→並び→カード→しおりまで操作でき、フォーカスが見える。
- axe-coreで、criticalとseriousが0件。
- ログインせずにしおりを押すと、GitHubのログインへ行き、終わると元のURLに戻る。
- 同じ人がいいねとしおりを2回押すと、取り消しになる。D1に重複した行ができない。
- `next` に外のURL（`https://evil.example` や `//evil.example`）を入れても、自分のサイトの外へは戻らない。
- 段階2：承認の後、キャッシュ済みの URL（q 付きを含む）を取り直すと、新しい一覧が返る。

## 13. 作品のページ（`/p/:id`）

Worker で描く。ヘッダー、サイドバー、下のタブはホームと同じ。色と形は「2」の値だけを使う。文字はすべて `copy.ts`。

### 骨組み

- 上の余白：幅768px以上はヘッダーの下から40px、767px以下は8px。左右の余白は24px（ホームと同じ）。
- リポジトリの形（WS003。11/12）。上から、頭 → 動く作品 → ボタン → 数の行 → タブ → タブの中身。HTML の順と見た目の順は、どの幅でも同じ（キーの Tab と読み上げが、見た目の順で進む）。CSS の `order` で見た目だけを動かさない。
- 本体は、幅1024px以上で2列（左 65fr に動く作品、右 35fr にボタン、数の行、タブ、タブの中身）、間隔32px。動く作品はタブの外にあり、どのタブでも出る。
- 1023px以下は1列で、同じ順のまま縦に並ぶ（頭 → 動く作品 → ボタン → 数の行 → タブ → タブの中身）。
- 動く作品は、どのタブでも出したまま。タブを替えても枠を作り直さない（タブの中身は、選んでいない物を `hidden` で隠すだけ）。

### 頭

- 1行目：アバター32pxの円（767px以下は出さない）、`@handle`（`/c/:handle` へのリンク。`text-subhead`、`site-fg-3`。767px以下は `text-body`）、「/」（767px以下は出さない）、題名（`h1`。`text-title`、太さ700）、札を3つ（状態、版、種類）。767px以下は、`@handle` と札（状態、版）が1行目、題名が次の行で、種類の札は数の行に出す。幅で置き場所が変わる札は2つ描いて、CSS で片方だけ見せる（`order` は使わない）。
  - 札：高さ24px、枠1px `site-line-2`、角丸 `radius-chip`、左右8px、`text-small`、`site-fg-3`。状態（lucide の印12px＋「公開」`globe`／「自分だけ」`lock`／ほかは `clock`。文字は「自分の作品」の状態の札と同じ）、「版 N」（今の版）、種類（「Web · Landing Page」の形）。
  - 状態は、Worker の HTML では「公開」か「自分だけ」。持ち主には、読み込みの後に自分の作品の一覧（`GET /api/post/works`。左のナビと同じ答え）から、審査待ちなどの今の状態に替える。
- 右（幅1024px以上。持ち主だけ）：「新しい版を置く」（`/new?work=<id>` へのリンク。高さ36px、角丸 `radius-control`、左右14px、`text-small`／太さ600、地 `site-primary`、lucide `upload` 16px）。公開の作品では読み込みの後に出るので、出てもほかが動かないよう、頭の行の右の端に置く（頭の行の高さは36px以上にしてある）。
- 数の行（ボタンの下、上に16px。どの幅でも）：`text-small`、`site-fg-3`、間隔12px。作者の名前（`/c/:handle` へのリンク。太さ600、`site-fg`）、レーベルの表示（作者の `kind` が `label` なら「· Ludion Studio label」。`text-meta`、`site-fg-2`）、X のリンク、種類の札（767px以下だけ）、lucide `eye` 16px＋閲覧数、`copy` 16px＋コピー数、`heart` 16px＋いいねの数（自分だけの作品では出さない）。書き方は「数の書き方」。
  - X のリンク：X のロゴ14px＋間隔4px＋lucide `arrow-up-right` 14px を、高さ32px、枠 `site-line-2`、角丸 `radius-chip`、左右の余白10px の枠に入れる（文字 `site-fg`、hover は `site-hover`。別のタブで開く。`aria-label` と `title` は「X を新しいタブで開く」）。`http(s)` の URL だけをリンクにする。
- リミックスの元の帯と、自分だけの作品の知らせ（「自分だけの作品です。…」と「自分の作品へ」）は、数の行の下、タブの上。
- 作り方は出さない（CLAUDE.md 原則9）。`made_with` はデータとして持つが、公開の HTML と API にも入れない。

### タブ

- 「コード｜版 N｜系譜 N｜設定」。数の行の下（1024px以上は右の列の中）。`role="tablist"`（名前は「作品の中身」）と `role="tab"`、中身は `role="tabpanel"`。高さ44px、列の幅を分け合う、`text-body`／太さ600。幅が足りないとき（狭い右の列で、長い言葉のタブ）だけ、列の中で横に送る。lucide の印16px（`code-2`、`history`、`git-fork`、`sliders-horizontal`）は、タブの列が広いときだけ（768〜1023px と、1280px以上）。選んだタブは下に2pxの線（`site-fg`）、ほかは `site-fg-2`。タブの列の下に1pxの線 `site-line`。
- 数は、版の数と、リミックスの数（`site-key` の地の小さな丸。0 なら出さない）。公開の作品では、承認済みの版と、承認済みのリミックスだけを数える。
- 初めに開くのは、だれでも「コード」。URL からは選ばない。矢印の左右で隣のタブ、Home と End で端へ移り、選んだタブだけが Tab の順に入る。
- 「設定」は持ち主だけ。公開の作品では、読み込みの後に足す（Worker の HTML には入れない。人によって HTML を変えないため）。
- コード：上から「この作品について」、「Copy code」、ライセンスの行、問題を報告、コードの箱。
- 版：版の一覧（新しい順）。「版 N」、置いた日（UTC の `YYYY-MM-DD`）、今の版に「今の版」の札。版の違いは WS004。
- 系譜：元の作品（リミックスのとき。公開されていなければ「元の作品は見られません」）と、この作品のリミックスの一覧（公開のものだけ。新しい順に50件まで。題と `@handle`、作品のページへのリンク）。なければ「まだリミックスはありません」。
- 設定：「自分の作品へ」（公開の申請、自分だけにする、取り下げは「自分の作品」でする）、「新しい版を置く」、自分だけの作品には「画像を付ける」（DOC002）。

### この作品について

版を置いたときに、機械がコードを読んで作った地図（`outline.json`。`packages/outline`、WS002）から出す。コードに書いてある物だけで、見つからない物は出さない。推測で埋めない。

- 箱：枠1px `site-line`、角丸 `radius-card`、余白20px（767px以下は16px）。見出し「この作品について」（`text-body`／太さ600）と、1行の説明（`text-small`、`site-fg-2`。767px以下は出さない）。
- 行（名前は `text-small`、`site-fg-2`、幅92px）：描き方（WebGL2、WebGL、WebGPU、Canvas 2D、SVG、DOM + CSS）、シェーダー（「16 本」と GLSL の版）、動き（requestAnimationFrame、CSS のアニメーション、CSS のトランジション、Web Animations）、音（Web Audio。合成だけなら「合成（録音なし）」）、操作（ポインター、キー、ホイール、端末の傾き）、気づかい（動きを減らす設定に従う、見えないと止まる。lucide `check` 14px）、保存（localStorage、sessionStorage、IndexedDB。localStorage か sessionStorage があれば「Ludion の枠の中では読み直すと消える」を添える）、外から読む物（なければ「なし」）、大きさ（全部のバイト数、ファイルの数、行の数。1 KB は 1000 B）。
- キー操作と読み上げ：役目（`role` の値）、状態（`aria-checked`、`aria-selected`、`aria-valuetext` など）、名前（`aria-label`、`aria-labelledby`、`<label>`）、キー（`keydown` で見ているキー：矢印、Home、End、Space、Enter など）、フォーカスの枠（`:focus-visible`）、知らせ（`aria-live`）。値は等幅で、コードに書いてあるとおりに出す。なければ「コードからは見つかりませんでした」。
  - 出すのは、コードから読んだ事実だけ。検査（`ld check`）の結果は出さない（CLAUDE.md 原則3）。
- 印：高さ28px（767px以下は32px）、角丸 `radius-chip`、左右10px、`text-small`／太さ600、地 `site-key`、hover は `site-hover`。行のある印はボタンで、押すと、その行（最初に見つけた所）を箱の中の下に出す（`aria-expanded`、`aria-controls`。選んだ印は地 `site-primary`）。もう一度押すか「閉じる」で閉じる。行のない物（「なし」、大きさ）は、ただの文字。
  - 出す行：「part.js の 204 行目」と、見つけた数（2つ以上なら「全部で N か所」）。その行と前後2行を、本当のファイルの行の番号（コピーされるコードの行ではない）と一緒に、等幅で出す。その行は地 `site-key`。1行は160文字まで。ファイルの全部の本文と、行の住所は、ファイルの木と一緒に作る（WS003 の2つ目）。
  - 767px以下：印を1行に横へ流す（行の名前は読み上げだけ。折り返さず、その行の中で横に送る）。
- 言語の帯：高さ8px、角丸 `radius-chip`、間2px。色は「2」の `site-lang-*`（JavaScript、GLSL、CSS、HTML。シェーダーの文字列は GLSL、文書の中の `<style>` は CSS、`<script>` は JavaScript として数える）。下に、色の丸8pxと「JavaScript 87.8%」の形の一覧（`text-small`、`site-fg-3`）。

### プレビュー（左）

- ボタン（どの幅でも1組。1024px以上は右の列のいちばん上、1023px以下は枠のすぐ下で上に12px）：1行目に「リミックス」（lucide `git-fork`。壁紙の作品は「壁紙にする」〈`monitor`〉と幅を分ける）、その下12pxに、いいね（`heart`＋数。`aria-label="Like, {n} likes"`）、しおり（`bookmark`＋「Save」または「Saved」）、共有（`share-2`）を同じ幅で3つ。どれも高さ44px、白、枠 `site-line-2`、角丸 `radius-control`、`text-body`／太さ600、アイコン18px、hover は `site-hover`。いいねとしおりは `aria-pressed` を付け、押した状態はアイコンを塗る。自分だけの作品では出さず、1023px以下では代わりに「新しい版を置く」（地 `site-primary`）を出す。
- 「リミックス」（幅1023px以下）：枠のすぐ下、上に12px、幅いっぱい。ふつうの流れに置き、浮かせない（浮いているのは下のタブだけ）。スマホでも最初の画面に入れるため、右の列ではなくここに置く（右の「コードをコピー」は最初の画面の外になる）。部品と Web の画面は、幅390×844と390×664で最初の画面に入る。枠が画面より長いスマホの画面は入らないが、作品を小さくして入れることはしない。このときボタンは、送る途中で下のタブの後ろを通る。ページと一緒に流れて留まらなければよい。
- 枠：角丸 `radius-card`、枠1px `site-line`、はみ出しを隠す。地は作品の背景（Worker が `part.css` の根の `--_bg` の作者の値を読む。色として読めない形なら地を付けない）。
- 中身は `<iframe sandbox="allow-scripts allow-forms" src="/frame/<id>/<version>/<desktop|mobile>.html" title="Preview of {title}">`。`allow-same-origin` は付けない（CLAUDE.md「描画」）。枠から親へ来るのは「読み込めた」の知らせ（`postMessage`）だけで、枠が自分で移ったときに親が読み直すために使う。作品の JS を2つ動かさないよう、選んだ幅の iframe だけを作る。
- 部品（component）：切り替えを出さない。枠は縦横比 4:3、最低の高さ420px。iframe は枠いっぱいで `desktop.html` を読み、作品は枠の中央に置く。
- Webの画面（`platform` が `web`）：枠の上に切り替え「Desktop」（lucide `monitor`）と「Mobile」（lucide `smartphone`）。チップと同じ形（「3」の絞り込みの列）で、アイコン付きの左右の余白、間隔13px、枠との間12px、`aria-pressed`。既定は Desktop。
  - Desktop：1280×800 で描き、枠の幅に合わせて倍率を変える（枠が広ければ広げる）。枠の縦横比は 1280:800。
  - Mobile：390×844 で描き、枠の左右の中央に上から置く。縮めるだけで、広げない。枠の高さは `min(844px, 枠の幅 × 844 / 390)`。
- スマホの画面（`platform` が `mobile`）：切り替えを出さない。上の Mobile の形だけ。
- スマホで見るとき（`pointer: coarse` で、画面の幅が767px以下）：Web の画面も切り替えを出さず、Mobile の枠だけを見せる。枠は 390×844 を縮めずに、その大きさのまま描く（CSS の scale を使わない）。枠の幅は本文の幅。高さは「見えている画面の高さ（`100svh`）− 枠の上の端までの高さ − 下に残す72px」で、枠の上の端までの高さは、ヘッダー64px、上の余白8px、作品の頭（`@handle` と題名。題名の長さで変わる）の合計。HTML の直後のスクリプトが、枠を読み始める前に測って入れる（`--frame-top`。測る前の値は72px）。縦÷横が 1.3 から 1.8 の間に収める。開いたとき、枠の下の端が画面に収まり、すぐ下のボタン（「リミックス」「壁紙にする」）が見える。Worker は端末を知らないので Desktop の枠で描き、HTML の直後のスクリプトが、React が載る前に Mobile の枠に替える。PC と、幅が広い端末は、上の形のまま。
- 作品の音：iPhone の消音モードでも鳴るよう、親のページが `navigator.audioSession.type = 'playback'` と宣言する（Safari だけにある。HTML の直後のスクリプトで、どのページでも）。作品の枠の中からは宣言できないため。鳴り始めるのは、今までどおり、見る人が作品を触ってから。鳴っている間は、ほかのアプリの音楽が止まる。
- `motion` の作品：枠の右下（右と下から12px）に「Replay」。高さ38px、角丸999px、白、枠 `site-line-2`、影 `shadow-card`、左右16px、lucide `rotate-ccw` 18px（`site-fg-3`）＋間隔9px＋文字12px／太さ600。押すと iframe を作り直す。
- 知らせ（枠の上、切り替えがあればその下。間12px、地 `site-field`、角丸 `radius-control`、余白 上下10px 左右12px、`text-small`、`site-fg-2`）。全部の作品のページで同じ。
  - 端末が `prefers-reduced-motion: reduce` のとき：「この端末の「動きを減らす」設定に合わせて、動きを止めています。」とボタン「動きを見る」（「もう一度」と同じ形で、影なし）。押すと `?motion=1` の枠に作り直し、文は「この端末は「動きを減らす」設定ですが、作品の動きを見せています。」、ボタンは「動きを止める」になる。選んだことはその端末の `localStorage`（`ld-show-motion`）に覚える。出す出さないは CSS で決めるので、読み込みの後に枠がずれない。
  - WebGL（`webgl2` か `webgl`）が作れないとき：「この端末のブラウザでは3Dの描画（WebGL）が使えないため、一部の作品が動きません。ブラウザの設定で「ハードウェア アクセラレーション」をオンにすると、見られることがあります。」。読み込みの後に確かめる。

### 枠の応答（`GET /frame/<id>/<version>/<desktop|mobile|inline>.html`）

- `inline.html` はヘッダーのスイッチの形（「3」、docs/tasks/T035.md）。違うのは見た目（地は透明、余白は0、根を枠の高さに縮めて中央に置く、作品が自分で敷くページの地を消す）と、スイッチの知らせのスクリプト（`ld-switch-press`、`ld-switch`、`ld-switch-set`）だけ。下の守りと応答の頭は同じ。

- 枠の中の `localStorage` と `sessionStorage` はメモリだけで、読み直すと消える（`document.cookie` も同じ）。枠はオリジンがないので、本物は読んだだけで `SecurityError` を投げる。最初の Ludion のスクリプトが、投げるときだけメモリだけの代わりを置く（`packages/render/src/storage.ts`。`Storage` の形を全部持ち、上限は 5MB の文字数で、超えると `QuotaExceededError`）。親のページには預けない。`ld preview`、`ld check`、`ld add` の枠も同じ（FRAME001）。

- `?motion=1` のときだけ、端末の「動きを減らす」設定を「減らさない」として見せる：`part.css` の `@media` の `prefers-reduced-motion` を書き換え、`matchMedia` を差し替える（`packages/render/src/motion.ts`）。守りとキャッシュの決まりは同じ。

- `Sec-Fetch-Dest` が `iframe` でないとき（見出しがないときも含む）は、D1 も R2 も読まず、作品を返さずに `/p/<id>` へ 302 で戻す。作品の JS は自分のタブを外へ移せるので、URL を直接開かせると、ludion.ai のリンクが外への入口になるため。
- `iframe` のとき：作品と版が承認済みのときだけ返す（前の版も、その版を取り下げるまでは返す）。なければ 404。`Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`、`Vary: Sec-Fetch-Dest`。
- 応答の頭の CSP：`sandbox allow-scripts allow-forms; form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:; frame-ancestors 'self'`。自分のサイトの中でしか枠に入れられない。

### コードのタブ（右）

「この作品について」の下に、上から順に：

- 「Copy code」：上に16px、幅いっぱい、高さ44px、地 `site-primary`、文字白、`text-body`／太さ600、角丸 `radius-control`。
- ライセンスの行：上に8px、「MIT · The author's name stays in the first line of the code.」（`text-meta`、`site-fg-2`）。
- コードの箱：上に16px。コピー用の文字列（CLAUDE.md「コピーされるコード」）。最大の高さ320pxでスクロール、余白12px、角丸 `radius-control`、枠1px `site-line`、地 `site-field`、等幅の書体（Tailwind の `font-mono`）、`text-small`、`site-fg`、折り返す。キーボードでフォーカスでき、`aria-label="Code of {title}"`。開いたときは1行目のクレジット行が見える。
  - 幅767px以下では、はじめはたたむ：1行目のクレジット行を含む3行（高さ74px）だけを見せる。箱の下、上に8px、幅いっぱい、いいねとしおりと同じ形のボタン「コードを全部見る」（`aria-expanded`、`aria-controls`）で開くと、最大の高さ320pxの箱になり、ボタンは「コードをたたむ」になる。幅768px以上では、たたまず、ボタンも出さない。「コードをコピー」は、たたんだままでも全部をコピーする。

### 下

- ほかの承認済みの作品を全部、ホームと同じカードと石組みで並べる（T018。行き止まりをなくす）。ページ送りはない。並びは2つで、それぞれ本体や前の並びの下48px、見出しは `text-subhead`、太さ600、下に20px。なければ見出しごと出さない。
  - 「@{handle} のほかの作品」：同じ作者の作品を Popular の順で。
  - 「ほかの作品」：ほかの作者の作品を Popular の順で。
  - カードの画像は `lazy` で、先に読むもの（`eager`、`fetchpriority`）を持たず、`load` の後に `src` を付ける。作品のページの LCP の画像と回線を取り合わないため。

### 動き

- ホームや一覧のカードからは、読み込み直して移る。データは Worker が HTML の中の JSON（`ld-page`）に入れ、ブラウザで取り直さない。
- 閲覧数：開いたときに1回だけ `POST /api/count`（`type: "view"`）を送る。重複は除かない。
- Copy code：押すと、コピー用の文字列をクリップボードに入れ、ボタンの文字を1.5秒だけ「Copied」にし、画面のコピー数を1増やして `POST /api/count`（`type: "copy"`）を送る。クリップボードに書けないときは、1.5秒だけ「Couldn't copy」にしてコードを選択し、数えない。
- `POST /api/count` が失敗しても、画面には何も出さない。
- リミックス（`components/RemixSheet.tsx`、`lib/remix.ts`）：押すと `<dialog>` のシートを `showModal()` で開く。Esc、後ろを押す、閉じるのボタンで閉じ、フォーカスはボタンへ戻す。閉じて開き直しても、書いた文は残る（再読み込みで消える）。
  - 幅767px以下は画面の下に幅いっぱいで出し、後ろを暗くする（`site-scrim` を半分の濃さで）。入力欄は選ばない（キーボードがチップとコピーのボタンを隠すため）。幅768px以上は幅360pxで押したボタンの近くに出し（下に入らなければ上）、後ろを暗くせず、入力欄を選ぶ。
  - 中身は上から：見出し、入力欄（2行。2000文字まで）、チップ（押すと語を足す。同じ語は足さない。作品ごとに変えない）、指示文の形、「指示文をコピー」（「Copy code」と同じ形）、2つの一言。ハッシュタグは `copy.ts` の `REMIX_HASHTAG` の1か所で変える。
  - 指示文をコピーできたら、ボタンの文字を1.5秒だけ「コピーしました」にし、画面のコピー数を1増やして `POST /api/count`（`type: "copy"`）を送る。クリップボードに書けないときは、1.5秒だけ「コピーできませんでした」にして、指示文を読み取り専用の箱で見せて選択し、数えない。
  - 指示文の形は2つで、選べる（ラジオ。高さはチップと同じ38px、横に並べる。丸は見せず、選んだ方の枠を `site-fg` にする。選んだ方の説明だけを下に `text-meta` で出し、選んでいない方の説明も読み上げには付ける）。選んだ方をその端末に覚える（`localStorage` の `ld-remix-mode`。読めない、書けないときも壊れず、開いている間は選んだとおり）。
    - 「URL で渡す」（既定）：元のコードの代わりに「元のコード：次の URL から取得してください。」と `https://ludion.ai/p/<id>/code` を書く（手元や workers.dev で開いていても本番の URL）。説明は「Claude Code など、URL を開ける AI 向け」。
    - 「コードを全部入れる」：コピーされるコードの全文を入れる。説明は「ChatGPT など、URL を開けないとき」。横にコードの大きさ（UTF-8 のバイト数を KB に丸めたもの）を出す。
    - 守ること（クレジット行を残す、1つの HTML、元のコードの形を保つ〈根の要素1つと data-ld-part、`<style>` 1つ、`<script type="module">` 1つ、`function mount(root)` と最後の `mount(...)`〉、セレクタは根の下、外へ通信しない、触り心地を保つ）は、どちらの形でも同じ。最後に「この HTML を `https://ludion.ai/new?from=<id>` に貼ると、Ludion に載せられます」と使い手に伝える1行（英語のページは `/en/new`。docs/tasks/T033.md B1）。
    - 一言の1つ目の後ろに、同じ段落で「できたら Ludion に載せる」（`/new?from=<id>` へのリンク）。行を足すと、下の高さに収まらない。
    - 入力欄を2行にし、選ぶところを低くしているのは、幅1440×900 で日本語のシートがボタンの下に入る高さ（434px）に収めるため。
  - 入力は form に入れず、どこへも送らず、保存もしない（CLAUDE.md 原則6）。指示文の型は `copy.ts` と `copy.en.ts` の `work.remix.prompt`、`promptUrl`、`promptFull`。英語のページでは指示文も英語。
- コードを文字で返す口 `GET /p/<id>/code`（`worker/pages.ts` の `renderWorkCode`）：承認済みの作品の今の版の「コピーされるコード」を、「Copy code」と1文字も違わない形で返す（リミックスは2行目に元の作品のクレジット行。CLAUDE.md「コピーされるコード」）。`Content-Type: text/plain; charset=utf-8`、`X-Content-Type-Options: nosniff`。ない作品と承認されていない作品は 404（文字で返す）。人で変えない。キャッシュは作品のページと同じ（「10」）。回数の制限は束縛 `LIMIT_COUNT`（キャッシュに当たった分は数えない）。`robots.txt` で止める（`Disallow: /p/*/code`）。開いてもコピー数は数えない。英語の道（`/en/p/<id>/code`）は作らない。
- 作品の地図とファイルの生の文字（WS006。`worker/workSite.ts`）：`GET /p/<id>.json` は、今の版の地図（ファイルと行の数、言語、技術と見つけた行、分け目。`packages/outline`）と、読む先の住所を JSON で返す。`GET /p/<id>/raw/<file>` は、1つのファイル（`part.html`、`part.css`、`part.js`、文書の作品は `index.html`）の生の文字を返す（`text/plain; charset=utf-8`、`nosniff`）。頭にクレジット行を入れる（`/p/<id>/code` と同じ決まり：1行目は作者、リミックスは次の行に元の作品。文書の作品は `<!doctype>` の直後）ので、行の番号は地図とその行の数だけずれる。行で読むのは AI の口（`/api/v1/works/:id/code`）。公開の作品はだれにでも同じ中身で、キャッシュは作品のページと同じ（「10」）。自分だけの作品は、本人の鍵（セッションの cookie、AI の鍵、AI につないだトークン）でだけ読め、残さない（`private, no-store`）。ほかの人には、ない作品と同じ 404。回数の制限は束縛 `LIMIT_COUNT`（鍵の確かめより先）。`robots.txt` で止める。開いても閲覧数とコピー数は数えない。
- 壁紙にする（WALL001。`components/WallpaperSheet.tsx`、`lib/wallpaper.ts`）：種類が壁紙の作品（`subtype` が `Wallpaper`）にだけ、「リミックス」の横に同じ形のボタンを置く（2つで幅を分ける）。ほかの作品では「リミックス」だけで、今までどおり。
  - 押すと、リミックスと同じ形のシート（閉じ方、置き方、幅）。中身は上から：見出し、「静止画で使う（アプリ不要）」（下の「静止画」。静止画のある作品だけ）、「動く壁紙にする（無料のアプリを1回入れる）」の見出しの下に Mac（「Plash に入れる」〈`plash:add?url=<全画面の住所>&title=<題>`。値は URL の形に符号化〉、Plash の入れ方〈App Store のリンク〉、住所の欄と「住所をコピー」）、Windows（「Windows アプリで設定」〈`ludion://wall/<id>`。APP001〉と「Ludion の Windows アプリ（無料）を使います。アプリを入れる」、その下に「Lively Wallpaper で使う」：Lively Wallpaper の入れ方〈Microsoft Store のリンク〉、手順2行〈Lively を開き「＋」（壁紙を追加）を押す → 「URL を入力」に住所を貼る〉、住所の欄と「住所をコピー」）、ほかのアプリ（「HTML を保存」：コピーされるコードと1文字も違わない中身を `<id>.html` で保存）、最後に「動きと音のある壁紙は、電池と GPU を使います。」。
  - 全画面の住所はいつも本番の `https://ludion.ai/p/<id>/wall`。
  - 開いている端末が Windows なら Windows を先に、ほかは Mac を先に。スマホとタブレットでは「PC で開いてください。」と住所の欄と「住所をコピー」だけ。端末の種類は並びを変えるだけで、送らず、保存しない（CLAUDE.md 原則6）。
  - 押した数は GA4 の `wallpaper_open`（「15」）。閲覧数とコピー数は数えない。
  - アプリの名前、配布の場所、画面の文字（Lively の「壁紙を追加」「URL を入力」）は、11/11 に各アプリの公式のページと、アプリの画面の文字の表で確かめた。
  - 静止画（WALL002。アプリを入れない人のため）：大きさを 4K（3840×2160）、2560×1440、1920×1080 から選び（初めは、開いている画面の画素の幅〈幅 × 画素の密度〉に一番近いもの。同じ近さなら大きい方）、「PNG を保存」で `GET /w/<id>/<version>/wall-<幅>x<高さ>.png` を `<id>-<幅>x<高さ>.png` として落とす。その下に1行、開いている端末の手順（Windows は「落とした画像を右クリック →『デスクトップの背景として設定』」、Mac は「画像を右クリック →『デスクトップピクチャを設定』」。どちらでもなければ両方）。
    - 静止画は `ld upload` が、置く人のブラウザで作る（`packages/ld/src/stills.ts`）。全画面の住所と同じ枠（`placement: 'fill'`）をその大きさで開き、ページの時計を作品の公開の日の 21:00（その場所の時計。`--still-time HH:MM` で変えられる）に止め、8秒（`capture.delay_ms` が長ければそれ）進めて写す。WebGL のために本物の GPU を先に試す。サーバーでは作品を描画しない。
    - 管理 API が、壁紙の作品の版と一緒に R2 の `works/<id>/<version>/` に置く。3つ全部で、1枚 12MB まで、PNG で大きさがちょうど合うこと。壁紙でない作品が送ると「形」で落ちる。
    - 道は、承認済みの版だけを返す（`Content-Disposition: attachment`）。キャッシュしない（`og.png` と同じ）。作品のページは、R2 にあるかを見て、ある大きさだけをページのデータ（`stills`）に入れる。投稿の壁紙と自分だけの作品にはないので、節を出さない。
  - 「Windows アプリで設定」（APP001。`apps/windows`）：リンクの移動でアプリを開く。1.5秒の間にページの注意が外れなければ（ブラウザの「開きますか」もアプリも出なかった＝入っていない）、シートの中身を「Windows アプリを入れる」の案内に替える。一度でも外れたブラウザでは、自分からは案内を出さない（印は `localStorage` の `ld-windows-app` だけ。送らない）。「アプリを入れる」からも案内を開ける。
  - 「Windows アプリを入れる」（段階 A：署名のない .exe）：戻るボタン、説明1行、手順3つ（ダウンロード → ブラウザの右上のファイルを開く〈「一般的にダウンロードされていない」なら「保存」〉、「Windows によって PC が保護されました」なら「詳細情報」→「実行」、入ると一覧が開く）、署名がまだないことの1行、「ダウンロード」（`/download/windows`）と大きさ、「もう入っている」（印を残して元の中身へ）、アプリが読むのは ludion.ai だけで数や記録を送らないことの1行。
- Windows アプリのダウンロード `GET /download/windows`（APP001。`worker/download.ts`）：今の配り先へ 302（段階 A は公開のリポジトリの Releases の最新の `LudionSetup.exe`。Store の Web インストーラーに替えるときも、この住所のまま）。数えない。キャッシュしない。
- 全画面の住所 `GET /p/<id>/wall`（WALL001。`worker/wall.ts`）：作品だけを画面いっぱいに出す。PC の壁紙のアプリ（Plash、Lively Wallpaper など）が開く。
  - サイトの頭、ボタン、文は出さない。React も GA4 も読まない。閲覧数とコピー数は数えない。
  - 作品は `<iframe sandbox="allow-scripts allow-forms">` の `/frame/<id>/<version>/wall.html` の中で動かす（作品のページの枠と同じ守り。CLAUDE.md「描画」）。枠は画面いっぱい（`position: fixed; inset: 0`）で、枠の中の作品の入れ物も枠の高さいっぱいにする（`placement: 'fill'`）。端末の「動きを減らす」設定でも動かす（本人が選んで置くもの）。親のページの CSP と枠の見張り（`frameGuard.ts`）も同じ。
  - `<meta name="robots" content="noindex, nofollow">` と `X-Robots-Tag` で検索に出さない。キャッシュは作品のページと同じ（「10」）。英語の道は作らない。
  - ない作品と、公開していない作品は 404（文字だけのページ。GA4 を読まない）。
- 共有：押すと `navigator.share`（題名と `https://ludion.ai/p/<id>`。手元や workers.dev で開いていても本番の URL）。使えないブラウザと、共有の画面を閉じた以外の失敗では、URL をクリップボードに入れ、ボタンの文字を1.5秒だけ「リンクをコピーしました」にする。クリップボードにも書けないときは、1.5秒だけ「コピーできませんでした」にする。
- いいねとしおり：今はブラウザの中の状態だけ（再読み込みで戻る）。本物にするのは T009。

### 共有とエラー

- `<title>` と `og:title` は「{title} by @{handle} · Ludion」。`og:image` は `/w/<id>/<version>/og.png` の絶対 URL。`twitter:card` は `summary_large_image`。
- ない作品、下書き、取り下げた作品は、状態コード 404 で「このページはありません」とホームへ戻るボタン（「ホームに戻る」）を出す。知らない道（アセットにも、どのルートにもない GET と HEAD）も同じ。
- OG 画像の題は、日本語の行頭禁則と文節で折り返す（`line-break: strict`、`word-break: auto-phrase`）。2行に収まらなければ、48px から 24px まで縮める。

## 14. 作り手のページ（`/c/:handle`）

Worker で描く。ヘッダー、サイドバー、下のタブはホームと同じ。色と形は「2」の値だけを使う。文字はすべて `copy.ts`。

- 上の余白は「13」と同じ。左にアバター64pxの円、間隔16px、右に次の順で縦に並べる：
  - 名前：`text-title`、太さ700。長いときは折り返す。
  - `@handle`：上に2px、`text-body`、`site-fg-2`。
  - 作者の `kind` が `label` なら：上に4px、「A Ludion Studio label — made by the Ludion team.」（`text-body`、`site-fg-2`）。
  - リンク：上に8px、X と「Site」、間隔16px。X は作品のページと同じ、ロゴと矢印の枠。「Site」は `text-body`、`site-fg-2`、下線。どちらも別のタブで開く。あるものだけ出す。`http(s)` の URL だけをリンクにする。
  - 数：上に8px、「{n} designs」「{n} views」「{n} copies」、間隔18px（`text-small`、`site-fg-3`）。閲覧数とコピー数は、承認済みの作品全部の合計。
- 作品の一覧：上に32px。承認済みの作品を Popular の順で、ホームと同じカードと石組みで。ここでは作品を動かさない。
- `handle` の URL は大文字と小文字を区別しない。
- 承認済みの作品が1つ以上あるときだけ出す。ない作者も、下書きしかない作者も、状態コード 404（「13」と同じ表示）。
- `<title>` と `og:title` は「{name} (@{handle}) · Ludion」。`og:image` は最初の作品の `og.png` の絶対 URL。`twitter:card` は `summary_large_image`。

## 15. アクセス解析（GA4。11/8にCEOが決定。CLAUDE.md 原則6の例外）

- 測定 ID は `G-91CJFHRK88`。コードは `apps/web/src/lib/analytics.ts`。動かすのは、本番へのデプロイのビルド（`npm run deploy` が流す `vite build --mode deploy`）で、`location.hostname` が `ludion.ai` のときだけ。手元の開発、テスト、`npm run lcp` のビルドには計測のコードが入らない。`e2e/analytics.spec.ts` が、手元のビルドを `ludion.ai` の名前で開いても `gtag.js` を読まないことを確かめる。
- 本番を確かめるスクリプト（`verify-*.mjs`、`lighthouse-prod.mjs` など）は、GA4 の送り先を止めて流す。`gtag.js` を読ませないか、Chromium の名前の解決で届かない宛先に向ける。ふつうの `route` で `collect` だけを止めると、ページを移る直前の要求を見落として Google に届く。
- `gtag.js` はページの `load` の後で読む。
- `page_location` と `page_referrer` から `q` を除く。`utm_*` などは残す。検索語だけが変わったときは数えない。
- `allow_google_signals` と `allow_ad_personalization_signals` は `false`。`user_id` は送らない。
- イベント（`trackEvent`）。ここにない名前と値は送らない。D1 と保存するものは増やさない。

| イベント | 値 | いつ |
| --- | --- | --- |
| `share` | `work_id`、`method`（`native` か `clipboard`） | 作品のページの共有を押したとき。共有の画面で取りやめても1回 |
| `copy_code` | `work_id` | 作品のページでコードをコピーできたとき |
| `save_click` | `work_id` | しおりを押したとき（ホームのカードも含む。保存と取り消しを分けない） |
| `select_work` | `from_work_id`、`to_work_id` | 作品のページの並びのカードを押したとき |
| `remix_open` | `work_id` | 「リミックス」のシートを開いたとき |
| `remix_prompt_copy` | `work_id`、`has_brief`（入力があったか）、`mode`（指示文の形。`url` か `full`） | 指示文をコピーできたとき。入力の中身は送らない |
| `wallpaper_open` | `work_id`、`method`（`plash`、`copy`、`download`、`still`、`app`、`app_download`） | 「壁紙にする」のシートで「Plash に入れる」「住所をコピー」（コピーできたとき）「HTML を保存」（WALL001）、「PNG を保存」（WALL002）、「Windows アプリで設定」、案内の「ダウンロード」（APP001）を押したとき |

- GA4 の管理画面の拡張計測機能で「サイト内検索」と「ブラウザの履歴イベントに基づくページの変更」を切る。切らないと、GA4 が URL の検索語をそのまま送り、ページビューも二重になる。

## 16. プライバシーと運営者のページ（`/privacy`、`/about`）

GA4 の利用規約（Google Analytics Terms of Service の「7. Privacy」）と、電気通信事業法の外部送信規律の「公表」のためのページ。文の正本は `copy.ts`（`privacy`、`about`）。変えるときは、コード、CLAUDE.md 原則6、「15」と合っていることを確かめ、最終更新日を変える。

- Worker で描く。ヘッダー、サイドバー、下のタブはホームと同じ。HTML は人によって変えない。キャッシュは `public, max-age=0, s-maxage=60`、札なし（`worker/cachePolicy.ts`）。
- 上の余白は「13」と同じ（768px 以上はヘッダーの下から40px、767px 以下は8px）。本文の幅は最大640px で左に寄せる。見出しは `text-title`／太さ700、節の見出しは `text-subhead`／太さ600、本文は `text-body`、最終更新日は `text-small` と `site-fg-2`。リンクは下線。外へのリンクは別のタブで開く。
- どのページからも2回の操作以内で行ける。どの幅でも、ヘッダーのメニューを開いて2回（ログインしていなくても開ける。「3」）。`/about` から `/privacy` へのリンクもある。
- `robots.txt` で止めない。`/sitemap.xml` に載せる。`<title>`、説明、`og:image`（サイトの1枚）、canonical を付ける。
- `/privacy` の中身：保存するもの、保存しないもの、外へ送るもの（Google アナリティクス、Cloudflare、GitHub）、第三者に渡すこと、開示と訂正と削除の宛先、このページを変えるとき。Google アナリティクスは、送信先、送る情報、目的、広告の機能、Google の扱い、止め方に分けて書く。
- `/about` の中身：Ludion が何か、運営（個人。本名と住所は書かない）、ライセンス、問い合わせ先（X の @Lattice_Node）。

## 17. 検索に出るための head

- ホーム：`<title>`、`<meta name="description">`、`og:title`、`og:description`、`og:image`（`/og-home.png`。1200×630）、`twitter:card`、`<link rel="canonical" href="https://ludion.ai/">`。絞り込み付きの URL も canonical はホーム。文は `copy.ts` の `home.pageTitle`、`home.description`。
- ホームの JSON-LD：`WebSite`（name、url）と `Organization`（name、url、logo は `/logo.png`、`sameAs` は `https://x.com/Lattice_Node`）。
- 作品のページ、作り手のページ、`/privacy`、`/about` にも canonical。workers.dev で開かれても `https://ludion.ai/...` を指す。作り手のページは、作者の `handle` の正しい大文字と小文字で書く。
- 画像（`apps/web/public/og-home.png`、`logo.png`）は `apps/web/scripts/make-site-images.mjs` が作り、コミットする。作品を入れ替えても自動では変わらない。

## 18. アカウントのページ（`/account`。docs/tasks/T020.md）

- ログインが要る。していなければ Worker がログインへ送る。HTML は人で変えず、中身は `GET /api/account` で読む。キャッシュしない。
- スマホを先に作る。本文の幅は最大640px で左に寄せる（「16」と同じ）。項目は上から：プロフィール、作品（`/account/works`、`/account/saved`、`/account/likes`）、ログインの手段、ログイン中の端末、退会（`/account/delete`）。
- 退会と手段の足し引きは、直近10分以内のログインを求める。もう一度のログインは、今の本人の手段でなければ断る。手段を足すとき、その手段がほかの人に結ばれていれば断る（自動で合わせない）。手段を変えると、ほかの端末のセッションは消える。
- ログインの画面（`/login`）：使える手段を並べる。Google の文言とロゴは Google の決まりどおり。workers.dev では Google とパスキーを出さない。新しい人は `/signup` で handle を選んでから人を作る。
- ログインの途中の状態（`worker/authFlow.ts`、`docs/tasks/FIX-login.md`）：GitHub と Google は、同じブラウザで直近の3つまで持つ。cookie は状態1つに1つで、中身は D1 に置く。戻ってきた state と合うものだけを使って消す。1回だけで、10分で切れる。cookie なしで state だけを見てログインさせることはしない。
- ログインの失敗：人が開く道（GitHub と Google の入口と callback）では JSON を出さず、`/login?error=…` へ戻して文で出す。`login_retry`（state が合わない）、`login_open_browser`（state の行は残っているのに cookie がない。別のブラウザで戻った）、`login_failed`（相手の失敗、設定がない、例外）、`login_limited`（回数の制限）、`signup_limited`。
- アプリの中のブラウザ（X、Instagram、LINE、Facebook、TikTok など）：`/login` の手段の上に知らせとボタン「リンクをコピー」を出す。iPhone には「右上の …」の一言も足す。ブラウザの中で UA を見て決める。UA は送らず、保存しない（原則6）。HTML は人によって変えない。
- パスキー：challenge はサーバーで作り、1回だけ、5分で切れる。`userVerification` と `residentKey` は `required`。`sign_count` は 0 のままの鍵を受け入れ、0 でない鍵で数が戻ったら断る。パスキーだけで始めた人には、作った直後に回復のコード（130ビット）を1回だけ見せる。
- 退会で消すもの：人、手段、セッション、いいね、しおり、前の handle の記録。結ばれた作者の作品は取り下げ（`rejected`、`reject_reason='account_deleted'`）、作者の行は handle だけを残す。

## 19. 作品の投稿と審査（docs/tasks/T021.md。SEC001 A02、A04〜A07、B1）

- 11/10 に全員に開いた（CEO の決定、T032。`wrangler.jsonc` の `POSTING_OPEN` が `"1"`）。閉じるときは `POSTING_OPEN` を `"0"` にして、同じ順（main に入れて push → `npm run deploy` → 本番で確かめる）で出す。閉じても、下書きと作品は残る。開く前は、運営だけが投稿できた（`docs/PHASE0.md` の条件。利用規約と取り下げの窓口ができてから、CEO が開く）。閉じている間は、ほかの人には `/new` が 404 で、入口も出さない。自分の作品の一覧と取り下げは使える。入口はログインした人にだけ出す（ホームの HTML は人で変えないので、`GET /api/me` の `can_post` で足す）。
- 全部の投稿は、公開の前に運営が見る（審査）。自動の検査を通っても、それだけで公開しない。直した版も毎回見る。自分だけの作品（本人だけが見られる）は審査しない。公開するときに審査する。
- 自分だけの作品（docs/tasks/T036.md）：
  - `/new` の最後に「自分だけ」（初めの値）か「公開」を選ぶ。自分だけは審査に出さず、すぐ置く（版は `private`、作品は `private`）。検査と同意の3つと題は公開と同じに要る。サムネイルは無くてよい。置いた後は作品のページへ進む。公開している作品の新しい版は、今までどおり審査する。
  - 本人のほかは、ログインしていない人、ほかの人、運営も、ない作品と同じ 404。作品のページ、`/p/<id>/code`、`/p/<id>.json`、`/p/<id>/raw/<file>`、枠、ファイル、サムネイル、OG 画像、`/api`、一覧、検索、作り手のページ、`sitemap.xml`、数、ほかの作品の並び、リミックスの元の帯。運営は審査に出された版だけを見る。
  - 本人の作品のページは下書きの枠（`/draft-frame/<版の id>/…`）で動かす。応答は `Cache-Control: private, no-store`、`Referrer-Policy: no-referrer`、`X-Robots-Tag: noindex`。閲覧数とコピー数を数えず、GA4 を動かさない（ページの URL に作品の ID が入るため）。いいね、しおり、共有、リミックス、知らせるは出さない。
  - 自分だけ → 公開する：今の版を審査に出す。承認で公開。差し戻されたら自分だけのまま。公開 → 自分だけにする：すぐ。閲覧数とコピー数とほかの人のリミックスは残す。リミックスの作品のページの帯は「元の作品：〈題〉（@作者）」と元へのリンク。元が公開されていなければ「元の作品は見られません」でリンクなし。コピーされるコードの2行目はそのまま。
  - 1人100作品まで。置く回数の上限は保存の上限（`quotas`）と同じ。退会すると、自分だけの作品も取り下げ（`rejected`、版は `revoked`）になり、だれにも見えない。
- 自分の作品（`/account/works`）：自分の全部の作品を、新しく変えた順に並べる。1行（スマホでは1枚）に、サムネイル（無いときは題の頭の1文字）、題、状態の札（「自分だけ」「審査待ち」「公開」「差し戻し」「下書き」。古い取り下げは「取り下げ」）、最後に変えた日、版の数。絞り込みは「すべて」「自分だけ」「公開」。できること：開く、新しい版を置く（下書きは「続ける」）、公開する（自分だけの今の版）、自分だけにする（公開の作品。確かめの一言を出す）。
- 版の状態：`draft`（下書き）→ `submitted`（審査待ち）→ `approved`（公開）／`rejected`（差し戻し。理由つき）→ `revoked`（取り下げ）。公開した版は変えない。直すと新しい版になる。直した版が審査を待つ間は、前の公開の版がそのまま出る。審査中の版は直せない。
- 持ち主はセッションの人から決める。作者がなければ、その人の handle で作って `creators.user_id` で結ぶ（アバターは入れない）。送られてきた作者、状態、`pin_order`、`kind` は受けない。作品の ID は新しく作るときの名前としてだけ受ける（英小文字、数字、ハイフンで3〜60文字。`ludion` を含むものは取れない）。
- 検査（`packages/rules` の `checkSubmission`。ブラウザと Worker で同じものを流す）：
  - 必須：根の `data-ld-part`、セレクタが根の下、外への通信なし（`url()`、`@import`、`src`、`srcset`、`fetch` など。書体は Google Fonts だけ）、ページを移らない、外へのリンクなし、イベント属性なし、埋め込み（`iframe`、`object`、`embed` など）なし、`mount` がある、大きさの上限（1ファイル 256 KiB）。HTML は `parse5` でブラウザと同じように読む。
  - 任意：10個のトークン、動きを減らす設定への対応。合っていなくても出せる。`tokens_ok` に残すだけで、今は印を出さない。
  - 通っても安全という意味ではない（任意の JS の安全は機械では証明できない）ので、審査で見る。
- 投稿の画面（`/new`。docs/tasks/T033.md）：一番上に1つの箱「HTML を貼る、またはファイルを落とす」。箱が空のうちは箱だけを出す。
  - 貼る（ページのどこで貼っても箱に入る。ほかの入力欄にいるときは奪わない。箱に貼ると中身を入れ替える）、またはファイルを落とす、選ぶ（HTML 1つ、または HTML、CSS、JS をそれぞれ1つまで）。
  - ブラウザの中で3つに分ける（`packages/rules` の `splitSnippet`。「コピーされるコード」の逆。`<!doctype>`、`<html>`、`<head>`、`<body>` の包みも外す。書体の `<link>` は `@import` にする）。機械で直すのは、見た目と動きを変えないものだけ（`fixParts`：根の要素が1つで `data-ld-part` がなければ付ける、値を作品の ID に合わせる）。直したことは箱の下に1行で出す。JS は書き換えない。
  - 分けられない、または必須の検査に落ちるときは、何が足りないかを文で出し、「AI で Ludion の形に直す」（指示文は `copy.post.ai.prompt`。出力は1つの HTML）を案内する。
  - 作品の ID は自動で決める（貼ったコードの `data-ld-part` の値、取れなければ後ろに乱数）。「コードを細かく直す」（たたむ）で ID と3つの欄を直せる。一度保存した作品の ID を変えると、新しい ID で保存し直し、前の下書きを消す（`POST /api/post/works/:id/discard`。一度も審査に出していない作品だけ）。
  - 必須の検査が0件なら、自動で下書きを保存し、下書きの枠で動かす。同じ中身は保存し直さない。下書きは題とサムネイルなしで保存できる（題は空、`thumb_w` は 0）。審査に出すには、題とサムネイルが要る（`POST /api/post/revisions/:rid/submit` が `title_required`、`thumb_required` で断る）。
  - 動いた後に残る入力は、題、種類（`category` と `subtype`）、サムネイル、同意（3つ。文と数は変えない）だけ。タグと作り方は「タグと作り方」にたたみ、選んだ状態から始める（作り方は `ai-assisted`）。審査に出すときに、題や画像を変えていれば先に保存し直す。
  - `/new?from=<id>`：元が承認済みの作品なら、箱の上に「〈元の題〉（@作者）のリミックスを載せる」と元の作品へのリンク。種類、タグ、「動きがある」を元から入れ、作り方は `ai-assisted`。承認済みでなければ `from` を捨てる（`GET /api/post/remix-source/:id` が 404）。保存のときにサーバーが元を確かめる（承認済み、自分自身でない。合わなければ `bad_remix_of`）。作品を作った後は `remix_of` を変えない。
- サムネイル：作り手が PNG、JPEG、WebP の静止画で出す。Worker で完全に読み直し（600万画素まで。`@jsquash` の wasm）、WebP（幅800、80KB 以下。高さ÷幅は 0.6〜1.25、はみ出す分は切る）と OG 画像（PNG、1200×630）に作り直す。元の画像は置かない。運営の PC で他人の作品を開いて撮らない。
- 下書きと審査待ちの版は、持ち主と運営だけが見られる（自分だけの作品の版は持ち主だけ。運営は審査に出された版だけ。`/draft-frame/<版の id>/<desktop|mobile>.html`、`/draft-thumb/<版の id>.webp`）。枠の守りは「13」と同じ。ほかの人には 404。キャッシュしない。
- 回数の上限（`worker/quotaLimits.ts`）：1人1日10版、全体で1日200版。保存（下書きの上書きを含む）は1人1日50回、全体で1日1000回。保存は1分に10回（IP の HMAC ごと。束縛 `LIMIT_POST`）。
- 新しい人を作る上限：同じ回線（IP の HMAC）で1日5人、全体で1時間200人。超えるとログインの画面で知らせる。今いる人のログインは止めない。
- 作り手自身の閲覧とコピーは数えない。
- 取り下げ：運営の取り下げ（`/api/admin/...`）と退会で使う。持ち主の画面では「自分だけにする」に置き換えた（T036）。API の `POST /api/post/works/:id/revoke` は残る。公開から消え、`catalog` と作品の札を消す。直している最中の版も止まる。ファイルは R2 に残す（公開の道からは読めない）。
- 退会すると、公開も審査待ちも下書きも自分だけの版も `revoked` になる。

### 審査の画面（`/admin/review`）

- 運営だけ（`users.is_operator`）。ほかの人には、ないページと同じ 404。`/api/me` の `review_pending` で、運営のアカウントのメニューに「審査（数）」を出す。
- リミックス（`remix_of` がある版）には「元の作品：〈題〉（@作者）」と元の作品へのリンクを出す（取り下げられていればリンクにしない）。
- 審査待ちを古い順に、1件ずつ見る。スマホで1件を1分以内で判断できる並びにする：動き（枠。スマホの幅から）→ 気になる書き方の印（`reviewFlags`）→ 承認と差し戻しのボタン（画面の下に残す）。サムネイル、コードの全文、公開中の版との差分はたたむ。
- 承認は、見た中身のハッシュが同じときだけ通る。承認すると公開され、`catalog` の札を消す。差し戻しは理由を選ぶ（`REJECT_CODES`）＋ひとこと。作り手の「自分の作品」に出る。通知は作らない。
