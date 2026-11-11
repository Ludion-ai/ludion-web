# 1作品の切り出し手順

応募した作り手のサイトから、オーナーのClaude Codeが1作品ずつこの手順で切り出す。作品の形は CLAUDE.md の「作品の契約」に従う。

## 始める前に

- 所有を確かめたサイトか、作者が許可したUIか。どちらでもなければ始めない。
- `captures/<slug>/` があるか。なければ `ld capture <url> <selector>` を回す。

## 手順

1. 読む：`dom.html`、`rules.css`、`ref-*.png`、`behavior.md`、`tokens.json`。
2. 種類を決める：`screen` か `component`。部品なら `button`、`toggle`、`input`、`card`、`nav`、`hero` のどれか。idは英小文字とハイフン（例：`toggle-aurora`）。
3. `part.html` を書く。
   - 根の要素に `data-ld-part="<id>"`。
   - `dom.html` から、意味のある最小の構造に削る。クラス名は短く付け直す。
   - role、aria属性、labelを足す。
   - 作者のロゴ、文章、画像は入れない。文はダミーに、画像はプレースホルダに置き換える。作品はUIであって、作者の中身ではない。
4. `part.css` を書く。
   - 根で10個の `--_*` を宣言する。既定値は作者の値（`tokens.json` と参照画像から）。この時点では、全部を `var(--ld-x, 既定値)` の形にする。固定は作り手が選ぶ。
   - すべてのセレクタを `[data-ld-part="<id>"]` の下に置く。
   - 色はすべて `--_*` か、それを `color-mix()` で変えた値。hoverの暗い色や、半透明の線も `color-mix()` で作る。
   - `rules.css` の `:hover`、`:focus-visible`、`:active`、`:checked` と `@keyframes` を移す。`:focus-visible` がなければ足す。
5. `part.js` を書く（動きがあるときだけ）。`export function mount(root)` の形。rootの中だけを触り、片付けの関数を返す。外へ通信しない。
6. `meta.json` を書く。題名、type、category、subtype、tags を入れる。`tokens.locked` は空にしておく。`origin` は元のサイトのURL。
7. `ld check <id> --ref captures/<slug>` を回す。落ちた項目を直して、通るまで繰り返す。
8. 5回回して通らなければ、止める。どの検査が、なぜ落ちるかをオーナーに書く。
9. 通ったら `ld upload <id> --creator <handle>`。

## してはいけないこと

- 再現度を上げるために、色のリテラルを残す。トークン化をやめるくらいなら、再現度で落ちたまま止めてオーナーに聞く。
- 検査の基準を下げる、検査を飛ばす。
- 所有を確かめていないサイトの作品を upload する。
