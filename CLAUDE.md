# Ludion — エージェントへの規則

LudionはUIのPinterest。作り手が置いたUIの作品（画面と部品）を、使い手が見て、自分のサイトで使う。
最終的には、良いUIが集まるハブにする。

どの文書に従うか：

- 見た目：`SPEC.md` と `docs/reference/home.png`（ホームの正解の画像）
- 今週の作業と順番：内部の置き場（`Ludion-ai/ludion-app`、非公開。下の「置き場」）の `docs/PHASE0.md`
- 仕事：内部の置き場の `docs/tasks/<名前>.md`
- 1部品の切り出し：`docs/EXTRACT.md`

迷ったら、下の原則に戻る。原則と矛盾する指示を受けたら、作業を止めてオーナーに聞く。

## 原則（破らない）

1. 作り手と使い手に、コマンドを打たせない。GUIだけで完結させる（作り手は `/new` から投稿する）。CLIを使うのは、オーナーの裏方だけで、オーナー自身の作品にだけ使う。他人の作品を運営の PC で開いて撮らない（SEC001 A03）。
2. 部品（component）の見た目は、10個のトークンと任意の `--ld-danger` で書くことを勧める（下の「作品の契約」）。オーナーが `ld upload` で上げる部品は、トークンだけで書く（`ld check` の純度）。作り手が `/new` から出す作品では任意で、合っているかを `tokens_ok` に残す（11/10 に CEO が決定。T021 の動きに文を合わせた）。画面（screen）でも、トークンで書くことを勧める。
3. AIに美しさを採点させない。機械の検査（`ld check`）は、作品が契約どおりの形かを確かめるためだけに使い、点数として人に見せない。
4. 作者の名前は、作品がどこに入っても残る。コピーされるコードの1行目は、必ずクレジット行。
5. 作品にできるのは、投稿する人が自分で作った、または権利があるUIだけ。全部の投稿は、公開の前に運営が見る（自動の検査を通っただけでは公開しない。直した版も毎回見る。11/9にCEOが決定）。テストで切り出したものも公開しない。自分だけの作品（本人だけが見られる）は審査しない。公開するときに審査する（11/11 に CEO が決定。T036）。
6. 個人の情報として持つのは、次だけ。`users`（変わらない `id`、`handle`、`display_name`、アバターのURL、本人が入れた X とサイトのURL）、`identities`（手段の中の変わらない番号。GitHub は id、Google は sub。手段の中の名前。GitHub は login、Google は名前。アバターのURL）、パスキーの公開鍵とその情報（credential ID、使った回数、transports、本人が付けた名前、日時）、回復のコードのハッシュ、変える前の `handle`（90日）、セッションのハッシュとログインした時刻、AI の鍵（`ai_keys`。鍵の SHA-256 のハッシュ、本人が付けた名前、持ち主、作った日時、最後に使った日（UTC の日）、消した日時。生の値は持たない。退会したら消す。T037）、AI につないだつながり（`oauth_grants`。トークンの SHA-256 のハッシュと切れる時刻、つないだ AI の名前、持ち主、つないだ日時、最後に使った日（UTC の日）。生の値は持たない。切ったら、退会したら消す。許可の後の10分の証も、ハッシュだけ。MCP001）。IP、UA、メールアドレスは保存しない。作品を見に来た人や、コードをコピーした人のソースコードは保存しない。作り手が自分で置いたもの（サイト、AI の鍵、AI につないだもの）は、作品として保存する（11/11 に CEO が決定。MCP001）。閲覧数とコピー数は、日ごとの数だけを持つ。IP は、回数の制限の鍵を作るために、その場でだけ使うことがある。保存はしない。回数の制限の束縛に渡すのは、秘密の値と日付（UTC の日）で作った HMAC で、生の IP は渡さない。
   - 例外：アクセス解析に GA4 を使う（11/8にCEOが決定）。本番の ludion.ai だけで動かし、作品の枠の中では動かさない。Google には GA4 の cookie の識別子、見たページの URL、参照元、機器の情報が渡り、通信の仕組み上 IP と UA も届く。ログインの情報と検索語は送らない。Google シグナルと広告の個人化は切る。
7. 作品のJSは、ludion.aiのオリジンで実行しない（下の「描画」）。
8. 並び順の「Popular」は、いいねの数ではなく、使われた数で決める（SPEC.md「並び」）。
9. すべての作品に `made_with`（`human` か `ai-assisted`）をデータとして持たせる。サイトには表示せず、公開の HTML と API にも出さない（11/9にCEOが決定。11/8の「作品のページに表示する」を変えた。他の人の作品は作り方を判別できないため）。`ai-assisted` は、AIを使い、人が方向を決めて選んだもの。
10. 架空の個人を作らない。運営が作る作家名は「レーベル」（作者の `kind` が `label`）として作り、作り手のページと作品のページで、運営のレーベルだと必ず表示する。閲覧数、コピー数、いいねを運営が水増ししない（11/8にCEOが決定）。

## 技術の決定

- npm workspaces のモノレポ。
  - `apps/web`：1つのCloudflare Worker。Hono（API）＋静的アセット（Vite＋React＋TypeScript＋Tailwind CSS＋React Router）。`@cloudflare/vite-plugin` で開発する。
  - `packages/ld`：オーナーの裏方の道具（`ld new`、`preview`、`check`、`upload`、`capture`）。Node＋Playwright。
  - `fixtures/`：検査器のための見本。`seed/`：開発用の見本データ。
- アイコンは `lucide-react`。書体は Inter を自前で配信する（`@fontsource-variable/inter`）。日本語はシステムの書体に任せる。
- Cloudflareのリソース：Worker `ludion-web`、D1 `ludion-app`、R2 `ludion-parts`。
  - 旧Ludion（セキュリティ）の `ludion` という名前のWorker・D1・R2がまだ残っている。削除はオーナーが作業中。**`ludion` で始まる既存のリソースには触らない。**
  - ludion.aiへの付け替えは、旧Workerの経路をオーナーが外してから。それまでは workers.dev で動かす。
- ログインはGitHubとGoogle（OAuth）とパスキー。Google のスコープは `openid` と `profile` だけで、メールは求めない。パスキーの RP ID は `ludion.ai`、origin は `https://ludion.ai` だけで、workers.dev では使わない。人の鍵は `users.id` で、手段は `identities` に分ける。名前やメールの一致で、別の手段を同じ人にしない（T020）。セッションは HttpOnly・Secure・SameSite=Lax のcookie。D1にはトークンのハッシュだけを置く。状態を変えるPOSTは、Originヘッダーが自分のサイトであることを確かめる。
- 秘密の値（GitHubのclient secret、管理トークン）は `wrangler secret` に置く。リポジトリに書かない。
- 共有されるページ（`/p/:id`、`/c/:handle`）は、WorkerがOGのmetaを差し込んで返す。

## 描画（後から変えると高くつく決定）

- ホームのカードは、サムネイルの画像だけを出す。ホームのカードでは作品のコードを動かさない（ヘッダーのスイッチは T035 の枠で動かす）。
- 作品のページ（`/p/:id`）で作品を動かすときは、必ず `<iframe sandbox="allow-scripts allow-forms">` の中で描画する。`allow-same-origin` は付けない。
  - 理由：Shadow DOMはCSSを分けるだけで、JSは分けない。他人のJSをludion.aiのオリジンで動かすと、ログインのcookieやDOMに届く。
- 枠のCSPに `form-action 'none'` を入れる。`allow-forms` でフォームの submit は届き、作品のJSが `preventDefault` できる。送信先への実際の送信はCSPで止まる。`ld preview` と `ld check` の枠も同じにする。
- 枠の URL（`/frame/...`）は、`Sec-Fetch-Dest: iframe` のときだけ作品を返す。それ以外は作品のページへ 302 で戻す。作品の JS は自分のタブを外へ移せるので、URL を直接開かせると、ludion.ai のリンクが外への入口になるため。見出しで返すものが変わるので、枠はキャッシュしない。
- 枠の応答の頭の CSP に `frame-ancestors 'self'` を入れる。ほかのサイトの枠に入らないようにするため（meta では効かない）。
  - 例外は埋め込みの住所（`/e/<id>`。EMBED001）だけ。`/e/<id>` と、その中の枠（`/frame/<id>/<version>/embed.html`）の応答だけ `frame-ancestors *` にする。開けるのは「誰の枠に入れるか」だけで、sandbox、`form-action 'none'`、通信を止める CSP、`Sec-Fetch-Dest` の確かめ、親の `frame-src 'self'` と見張りは同じ。埋め込みの枠は `Sec-Fetch-Site: same-origin` のときだけ返す（外のサイトが枠を直に置いて、`/e/<id>` の印を飛ばせないように）。
- 枠が外へ移るのは、親のページの CSP `frame-src 'self'` で止める。
- 親の見張りは2枚目の守り。枠が自分で移ったら、親が元の URL で読み直す。目印は、枠の `load` が2回目に起きたこと（読み込みの後の移動）と、`load` が起きたのに枠の文書から「読み込めた」の `postMessage` が来ないこと（読み込みの途中の移動）。3回読み直しても移るなら、枠を空にする（`apps/web/src/frameGuard.ts`）。
- `frame-src 'self'` は同じサイトの中の移動を通すので、公開前の審査でも見る。作品の配信を別のドメインに分けることは T028 で決める。
- 公開前の版（下書き、審査待ち）の枠（`/draft-frame/...`）も同じ守りにする。持ち主と運営だけが見られ、ほかの人には 404。
- iframeの中では、作品をShadow DOMに入れる。文書の作品（下の「文書の作品」）は、文書をそのまま枠にし、Shadow DOM には入れない（Shadow DOM は CSS を分けるだけで、守りではない。守りは sandbox と CSP）。
- 幅を見せる枠（1280pxと390px）は、それぞれ別のiframeにする。メディアクエリを効かせるため。
- 親とiframeのやりとりは `postMessage` だけ。受け取る側は、送り元と形を必ず確かめる。

## 作品の契約

### 種類

- `screen`：画面全体（Webのページ、スマホの画面、ダッシュボードなど）
- `component`：部品（ボタン、トグル、入力欄、カード、ナビ、ヒーロー、UIキット）

### ファイル

`part.html`、`part.css`、`part.js`（動きがあるときだけ）、`meta.json`、`thumb.webp`（オーナーの作品は `ld upload` が作る。投稿の作品は、作り手が出した画像を Worker が読み直して作る）。

### トークン

| トークン | 意味 |
| --- | --- |
| `--ld-bg` | ページの背景 |
| `--ld-surface` | カードなど、面の色 |
| `--ld-fg` | 文字色 |
| `--ld-muted` | 弱い文字と線 |
| `--ld-accent` | 強調色 |
| `--ld-radius` | 角丸 |
| `--ld-font` | 書体 |
| `--ld-space` | 基本の余白 |
| `--ld-shadow` | 影 |
| `--ld-motion` | 動きの速さ |
| `--ld-danger`（任意） | エラー、危険な操作、失敗の状態の色。使う作品だけが根で `--_danger: var(--ld-danger, <作者の値>)` と宣言する。宣言せずに `var(--_danger)` を使うと「形」で落ちる |

### HTML

根の要素に `data-ld-part="<id>"` を付ける。すべての中身は、その中に入れる。

### CSS

すべてのセレクタを `[data-ld-part="<id>"]` の下に置く。こうすると、Shadow DOMの中でも、ふつうのページに貼っても、同じCSSが効く。

根で10個の内部変数 `--_*` を宣言し、本体では内部変数だけを使う。`--_danger` は任意で、使う作品だけが根で宣言する。

```css
[data-ld-part="toggle-aurora"] {
  /* 固定しないトークン：使い手の値を受け、なければ作者の値 */
  --_bg: var(--ld-bg, #0b0b0c);
  --_fg: var(--ld-fg, #f4f4f5);
  --_radius: var(--ld-radius, 10px);
  --_motion: var(--ld-motion, 200ms);
  /* 固定したトークン：使い手の値を受けない */
  --_accent: #ff6a3d;
}
[data-ld-part="toggle-aurora"] .knob {
  background: var(--_accent);
  border-radius: var(--_radius);
  transition: transform var(--_motion) ease;
}
[data-ld-part="toggle-aurora"] .knob:hover {
  background: color-mix(in oklab, var(--_accent) 85%, black);
}
```

- 部品（component）では、色は `--_*` か、それを `color-mix()` で変えた値だけ。色のリテラルを置いてよいのは、根の既定値だけ。画面（screen）では、守れていなくても警告だけにする。
- 余白は `calc(var(--_space) * n)`。角丸は `var(--_radius)` か、それを含む `calc()`、または `0`、`50%`、`9999px`。動きの時間は `var(--_motion)` か、その `calc()`。
- 固定（locked）するかどうかは、作り手が招待ページで選ぶ。選ばれたトークンは、根の宣言を `var(--ld-x, 既定値)` から既定値そのものに書き換える。
- 外への通信をしない。例外は書体の読み込みだけ。
- 実在の会社のロゴ、商標、製品名を作品に入れない。作品は MIT で配るので、他人の商標を MIT で配ることになる。ロゴの場所は空の枠か、架空の名前にする。外部ログインのボタンは文字だけにする。

### JS

```js
// part.js — ESモジュール。rootの中だけを触る
export function mount(root) {
  const knob = root.querySelector('.knob');
  const onClick = () => root.toggleAttribute('data-on');
  knob.addEventListener('click', onClick);
  return () => knob.removeEventListener('click', onClick);
}
```

- `document` を直接探さない。グローバル変数を作らない。外へ通信しない。
- 片付けの関数を返す。
- ページを移らない。`location` への代入、`location.assign`、`location.replace`、`window.open`、`document.location`、`top.`、`parent.` は「形」で落ちる。`part.html` の `<a href>` と `<area href>` も、枠の外へ移るもの（`http:`、`https:`、`//`、`javascript:` など）は「形」で落ちる。外への導線を見せたいときは `href="#"` にする（`mailto:` と `tel:` はよい）。
- `rgb(${r} ${g} ${b})` のように値が全部式の色は、トークンから計算した色として認める（色のリテラルに数えない）。
- 枠の中の `localStorage` と `sessionStorage` はメモリだけで、読み直すと消える（`document.cookie` も同じ）。枠はオリジンのない sandbox なので本物は投げるため、作品のスクリプトより先に代わりを置く（`packages/render/src/storage.ts`。FRAME001）。

### 動きの決まり

- 見えていないとき（`visibilitychange`、`IntersectionObserver`）は描画を止める。
- `devicePixelRatio` は2まで。
- reduced motion では止めるか最小限にする。`tags` に `motion` がある作品は、`prefers-reduced-motion: reduce` に対応していなければ「形」で落ちる（CSS の `@media (prefers-reduced-motion: reduce)` か、JS の `matchMedia('(prefers-reduced-motion: reduce)')`）。
- 片付けの関数で `requestAnimationFrame` と listener を止める。
- 色は JS に書かず `--_*` から読む（`getComputedStyle(root).getPropertyValue('--_accent')`）。`part.js` の色のリテラルは、部品では落ち、画面では警告になる。

### コピーされるコード

1つのHTMLの断片にまとめる。1行目と、`<style>` の1行目に、必ずクレジット行を入れる。

```html
<!-- UI by @creator — ludion.ai/p/toggle-aurora (MIT) -->
<div data-ld-part="toggle-aurora">…</div>
<style>
/* UI by @creator — ludion.ai/p/toggle-aurora (MIT) */
…
</style>
<script type="module">
/* UI by @creator — ludion.ai/p/toggle-aurora (MIT) */
…
mount(document.querySelector('[data-ld-part="toggle-aurora"]'));
</script>
```

リミックス（作品の `remix_of` がある）は、1行目がリミックスした人のクレジット行、2行目が元の作品のクレジット行。`<style>` と `<script>` の頭も同じ2行。`remix_of` から作るので、作り手がコードから消しても残る。元の作品が取り下げられていても、2行目は残す。リミックスのリミックスは、直接の元だけを書く（11/10、T033）。

```html
<!-- UI by @remixer — ludion.ai/p/toggle-snow-cabin (MIT) -->
<!-- Remix of UI by @creator — ludion.ai/p/toggle-aurora (MIT) -->
<div data-ld-part="toggle-snow-cabin">…</div>
<style>
/* UI by @remixer — ludion.ai/p/toggle-snow-cabin (MIT) */
/* Remix of UI by @creator — ludion.ai/p/toggle-aurora (MIT) */
…
</style>
```

投稿の箱（`/new`）は、この形の逆で分ける（`packages/rules` の `splitSnippet`）。頭のクレジット行と「Remixed by」の行は外し、載せるときにサーバーが作り直す。

### 文書の作品（11/12、DOC001）

AI がふつうに書いた1つの HTML 文書を、そのまま置き、そのまま動かす形。上の契約（根、トークン、セレクタ、mount）は、部品にしたいときの任意の形として残す。

- 受けるのは AI の口（`/api/v1` の `POST /works`、`POST /works/:id/versions`、MCP の `save_work`）だけ。`/new` の箱は、まだ契約の形だけ。
- 分け方（`packages/rules` の `htmlForm`）：`<!doctype` か `<html` で始まる文書は、文書の作品。ただし、`<body>` の一番外の要素が1つで作者が `data-ld-part` を書き、JS がないか `mount` を export している文書は、今までどおり契約の形。断片は、いつも契約の形。
- 検査は、大きさ（768KB まで。今の3つの上限の合計）と、読める文字（NUL と壊れたサロゲートがない）だけ（`checkDocument`）。契約の検査はしない。外への通信も検査では落とさない（枠の CSP が止める）。人をだます作りかは、公開の前に運営が見る。
- 種類は画面（`screen`）。部品の種類（`Components`）の作品やリミックスの元から来ても、文書の版は `Web` にする（中央寄せだと背景が縮むため）。ID は題（`<title>`）の英数字から作る。
- 持ち方：R2 の版の置き場に `meta.json`（`"format": "document"`）と `index.html` だけ。D1 は変えない（migration なし）。`loadRevisionFiles` は `part.html` がないときだけ `index.html` を読むので、今ある作品の読み方は変わらない。
- 枠（`/frame/...`、`/draft-frame/...`）は、文書を1文字も変えずに返し、`<!doctype>` の直後（なければ頭）に、サイトの小さなスクリプト（CSP の meta、storage の代わり、DPR、「読み込めた」の知らせ、「動きを見る」のときの matchMedia）だけを差し込む（`packages/render/src/document.ts`）。応答の頭、`Sec-Fetch-Dest` の確かめ、sandbox、`frame-ancestors` は今の枠と同じ。文書の CSS の `@media (prefers-reduced-motion)` は書き換えない。
- 画像を付ける（11/12、DOC002）：自分だけの作品は、「自分の作品」と作品のページの「画像を付ける」で、画像だけを足した新しい版を今の版にできる（`POST /api/post/works/:id/thumb`。今の版のファイルを写す。今の版は書き換えない）。文書の作品は、持ち主の下書きの枠（`/draft-frame/...?capture=1`）にだけ撮る仕掛け（`packages/render/src/capture.ts`）を差し込み、枠の中で DOM を SVG の foreignObject（data:）で絵にする。公開の枠と、`capture` のない枠の HTML は変えない。撮れないとき（白紙、汚れた、Shadow DOM の中がある）は、ファイルを選ぶ。
- コピーされるコードは、その文書。クレジット行は `<!doctype html>` の直後に入れる（前に入れると互換モードになるため。だから文書の作品では、クレジット行は2行目になる）。リミックスの2行目も同じ場所。置くときは、その場所にあるクレジット行を外す（取ったコードを送り直しても重ならない）。

```html
<!doctype html>
<!-- UI by @creator — ludion.ai/p/glass-counter (MIT) -->
<!-- Remix of UI by @someone — ludion.ai/p/first-counter (MIT) -->
<html lang="en">…</html>
```

## 置き場（11/11 に CEO が決定。PUB002）

| 置き場 | 見える人 | 中身 |
| --- | --- | --- |
| `Ludion-ai/ludion-web`（このリポジトリ） | 誰でも | サイトのコード、作品（`works/`）、`SPEC.md`、この規則 |
| `Ludion-ai/ludion-app`（内部の置き場） | 運営だけ | タスク（`docs/tasks/`）、報告（`docs/reports/`）、`docs/PHASE0.md`、画面のスクリーンショット（`docs/screens/`）、SEC001、調べもの、作業中の作品 |

- コードの変更は、このリポジトリの pull request でだけ main に入れる。`ludion-app` の main には、コードの変更を入れない。
- このリポジトリは誰でも読める。コード、コミットの文、pull request の文、Issue に、タスクと報告の中身、PC の場所、秘密の値の置き場の場所、まだ直していない弱さ、個人の情報を書かない。pull request の本文は、何を変えたかを短く書き、タスクの名前（例：`T040`）を添える。
- コミットの作者は、セッションのアカウントの GitHub の noreply のアドレス（`<番号>+<名前>@users.noreply.github.com`）。個人のメールアドレスを使わない。

## 完了の定義（11/11 に CI001 で書き換えた。PUB002 で置き場を分けた）

- 終わりの条件は、タスクに書いてあるものだけを満たす。満たしたことを、コマンドの出力か、Actions の結果で示す。「動くはず」は完了ではない。
- 画面のスクリーンショットは、見た目を変えたタスクで、変えた画面だけを内部の置き場の `docs/screens/` に置く（1440 と 390 の2枚ずつ。ライトとダークは、色を変えたときだけ）。このリポジトリには置かない。ホームを変えたときは `docs/reference/home.png` と並べて確かめる。
- 重さの測定は、タスクが求めたときだけ。
- 測る写しや試しの作品は `ld upload --private` で置き、住所を報告に書く（LD002）。
- 基準を満たせないときは、基準を下げずに止めて、理由と次の案を報告に書く。
- 内部の置き場の `docs/PHASE0.md` の「作らないもの」に入っているものを、頼まれずに作らない。

## タスクと報告（11/5に決定。11/11 に CI001 で書き換えた。PUB002 で置き場を分けた）

- 仕事は、内部の置き場の `docs/tasks/<名前>.md` で渡される。1タスク＝1セッション＝1ブランチ＝このリポジトリの1つの pull request。大きいときは、タスクの中で段階ごとに pull request を分けてよい。
- タスクファイルに書かれていないことは、指示ではない。会話で渡された指示とタスクファイルが食い違ったら、タスクファイルを正とする。
- **決めてよいこと**：[CTO] にあたること（作り方、テストの書き方、文の細かい言い方、小さな見た目）は、自分で決めて進める。止まって聞かない。決めたことを報告に1行ずつ書く。
- **止まって聞くこと**：[CEO] にあたること（決まっていることを変える、お金、外に出す文、個人の情報、取り消せない操作）と、守りに関わること（SEC001 の観点、秘密の値、本番のデータを消す）だけ。
- 終わったら、または止めたら、必ず内部の置き場の `docs/reports/<名前>.md` を下の形で書く。報告とタスクファイルは内部の置き場に入れ、このリポジトリには入れない。
  - 完了したとき：pull request のテストが通るのを待ち、通ったら main に入れる（下の「並べて作るときの決まり」）。
  - 止めたとき：途中の変更を枝にコミットして push し、pull request は draft のまま残す。
  - PC で動かしたときは、最後に worktree を片付け、`git status` を空にして終える。
- 報告は、端末に出すのではなくファイルに書く。短く書く。表は終わりの条件の一覧だけでよく、Markdown の表で書く（罫線文字の表は使わない）。
- 作業ツリーの `works/`、`creators/`、`ld.config.json` にある未コミットの変更は、CEO が作業中の作品。タスクでは触らない、コミットしない、stash しない、消さない（タスクファイルが名前を挙げたものを除く）。`git status` に残っているのがそれだけなら、空でなくても終えてよい。

報告の形：

```
# <名前> 報告

- 状態：完了／止めた
- pull request：ludion-web #<番号>
- 終わりの条件：

| 条件 | 結果 | 証拠 |
| --- | --- | --- |

- 決めたこと：1行ずつ
- CEO がやること：1件ずつ、選択肢とおすすめ
- 残ったこと：
```

## 並べて作るときの決まり（11/9 に CEO が決定。11/11 に CI001 と PUB002 で書き換えた：テストと本番に出す作業は、このリポジトリの GitHub Actions）

- **どこで動かすか**：PC の Claude Code でも、クラウドの Claude Code（Web）でもよい。PC で動かすときは、このリポジトリの clone から自分の worktree と枝を切り、clone の作業ツリー（main）では作業しない。クラウドで動かすときは、自分の枝を切るだけでよい。PC にしかないもの（作業中の作品、`ld upload`、動画の書き出し、秘密の値）に触るタスクは、PC で動かす。
- 枝は `git fetch origin` の後に `origin/main` から切る。
- **PC で流すテストは、触ったところだけ**（ファイルや `-g` で絞る。例：`npx playwright test e2e/home.spec.ts -g "並び"`、`npm test -w @ludion/rules`）。全部の `npm test` は PC で流さない。全部のテストは GitHub Actions（`.github/workflows/test.yml`）が、main への pull request（作った時と、その枝に push するたび）と main への push のたびに流す。pull request のない枝への push では流れない。
- **main に直接 push しない。** 枝を push して、main への pull request を作る（`gh pr create`）。main の守りで、pull request と「テストの全部」の通過が必須になっている。
- pull request のテスト（「テストの全部」）が通るのを待つ（`gh pr checks <番号> --watch`）。落ちたら、Actions の成果物（Playwright の報告、7日）を見て直し、同じ枝に push する。
- 通ったら main に入れる（`gh pr merge <番号> --merge --auto` でよい）。main が先に進んでいて取り込みが要るときは、`origin/main` を枝に取り込んで push し、テストを待ち直す。
- **pull request を main に入れる（merge）のと、auto-merge を付けるのは、その pull request を作った持ち主のセッションだけ**（11/12 に CTO が決定）。ほかのセッションとほかの AI の道具は、人の pull request を merge しない。auto-merge も付けない。段階ごとに分けた pull request は、持ち主が順に入れて本番で確かめるため。
- 同じファイルを触るタスクが並ぶときは、後から main に入れる方が取り込みで解く。
- 外の人の pull request の workflow は、運営が承認してから流れる。`pull_request_target` は使わない。秘密の値は、environment `production`（承認あり）と `production-auto`（承認なし。main の枝だけが使える）にだけ置き、リポジトリの Secrets には置かない。使ってよい Action は、GitHub のものと、認証済みの作者のものだけ。
- **本番に出す**（11/11 の CEO の決定、DEPLOY002）：main に入ったものは、ふだんは承認なしで自動で本番に出る。D1 の migration を含むときだけ、CEO が承認する。タスクの側で出す作業はしない。
  - `.github/workflows/deploy.yml` が、main への push のテストが通ると動く。中身は `npm run deploy` と同じ（確かめ → ビルド → D1 の migration → Worker）で、同時に1本だけ走る。
  - 最初の job（`apps/web/scripts/deploy-gate.mjs`）が、今の本番の版（GitHub の deploy の記録の、いちばん新しい成功したもの）から出す commit までに `apps/web/migrations/` の変更があるかを見る。
    - ない：environment `production-auto`（承認者なし。main だけ）で、承認なしで出す。
    - ある、または今の本番の版が読めない：environment `production` で CEO の承認を待つ。当たる migration は、実行の Summary の頭に出る。
  - だから、migration を足すタスクは、main に入れた後に CEO の承認が要ることを報告に書く。migration と、ほかの急ぐ変更が続けて入ると、急ぐ方も承認を待つ。
  - 手で流す道（Actions の Run workflow）もある。決め方は同じ。
  - 形はリポジトリの変数 `DEPLOY_MODE` で選ぶ（CEO）：`auto`（上の形）、`approval`（いつも承認を待つ。自動を止めたいときに戻す）、`manual`。
  - 決め方を手で試す（何も出さない）：`node apps/web/scripts/deploy-gate.mjs --mode auto --base <今の本番の commit> --head <出す commit>`
  - 手元の `npm run deploy` と `npm run deploy:www` は、このリポジトリの main と同じ中身のときだけ進む（`apps/web/scripts/deploy-guard.mjs`：origin が `Ludion-ai/ludion-web` で、HEAD が `origin/main` と同じコミットで、コミットしていない変更がない。`works/`、`creators/`、`ld.config.json` は除く）。飛ばす道は作らない。`wrangler deploy` を直に打たない。
- **本番の確かめ**：共通の確かめ（`/` が 200、作品のページ、ログインの画面）で足りる。deploy の workflow はこれを自分で流す。手元の `npm run deploy` のときは、出した人が同じ3つを見る。使い捨ての人を作る確かめは、タスクが求めたときだけ。
- 壊れていたら、直したものを同じ道で出すか、前の版に戻す（`wrangler rollback`。CEO の許可を得て）。
- D1 の migration は、その日に決めた1つのタスクだけが足す（11/9〜：T020）。ほかのタスクが足すときは、番号がぶつからないことを確かめてから。
