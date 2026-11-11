# 検査器の見本（fixtures）

`ld check` と、T003 以降の開発用のデータにだけ使う。本番のサイトには出さない。作者は `@fixture`（`creators/fixture/`、`kind: person`）。

| id | 種類 | 狙い |
| --- | --- | --- |
| `fx-toggle` | 部品（part.js あり） | 全部通る |
| `fx-button` | 部品 | 全部通る |
| `fx-landing` | Webの画面 | 全部通る |
| `fx-habits` | スマホの画面 | 全部通る |
| `fx-nav` | 部品（幅いっぱいのナビ） | 全部通る。サムネイルは幅1280で描いて枠の上に寄せ、800×480 に縮める（T005） |
| `fx-bad-color` | 部品 | 「トークンの純度」だけで落ちる（本体に色のリテラル） |
| `fx-bad-overflow` | 部品 | 「崩れ」だけで落ちる（幅390ではみ出す） |
| `fx-bad-contrast` | 部品 | 「アクセシビリティ」だけで落ちる（作者の配色でコントラスト不足） |
| `fx-bad-radius` | 部品 | 「形」だけで落ちる（角丸が `var(--_radius)` を使わず、6px のリテラル） |
| `fx-form` | 部品（part.js あり） | 全部通る。submit を受けて `preventDefault` し、エラーを `--_danger` で出す（T006） |
| `fx-motion` | 部品（part.js あり、tags に `motion`） | 全部通る。canvas の色を `--_*` から読み、reduced motion で止まる（T006） |
| `fx-wallpaper` | Webの画面（壁紙、tags に `motion`） | 全部通る。全画面の住所（`/p/<id>/wall`）と「壁紙にする」の試験に使う（WALL001） |
| `fx-bad-danger` | 部品 | 「形」だけで落ちる（`--_danger` を根で宣言せずに使う） |
| `fx-bad-motion` | 部品（tags に `motion`） | 「形」だけで落ちる（`prefers-reduced-motion: reduce` に対応していない） |
| `fx-bad-nav` | 部品（part.js あり） | 「形」だけで落ちる（押すと `location.href` に外の URL を入れる。T008） |
| `fx-bad-link` | 部品 | 「形」だけで落ちる（`part.html` の `<a href>` が外の URL。T012） |

確かめる：`npx ld check --all --fixtures`。一覧：`npx ld list --fixtures`。

`malicious/` は枠の閉じ込めを確かめる見本（T007）。`ld` からは見えない。`npm run seed:dev` が開発用のデータにだけ入れる（`malicious/README.md`）。`npm run seed:dev` は、上の「全部通る」見本も開発用のデータに入れる。

`t033-real/` は、1つの箱と指示文の本物の確かめ（docs/tasks/T033.md）。文脈を渡していない別の AI のセッションに、指示文だけを渡して作らせた HTML を、手を入れずに置いた。`remix-*.html` はリミックスの指示文（`remix-prompt.txt`。住人のいるスイッチ、URL の形、「雪の夜の山小屋に」）、`naive-*.html` は「押すと波紋が広がるボタンを、1つの HTML で作って」とだけ頼んだもの、`fixed-*.html` はそれを「AI で Ludion の形に直す」の指示文（`fix-prompt.txt`）で直させたもの。`packages/ld/tests/real-ai.spec.ts` が箱と同じ処理に通す。`ld` からは見えない。本番のサイトには出さない。
