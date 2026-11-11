# ld：1作品を置くまで

リポジトリの根で打つ。作者 `@Lattice_Node` と根の `ld.config.json`（`{ "creator": "Lattice_Node", "made_with": "ai-assisted" }`）は置いてある。ほかの作者は `npx ld creator add <handle> --name <名前> --x <URL> --avatar <画像>` で作る（handle は X と同じ形：英数字と `_`、15文字まで。大文字と小文字は区別しない）。

作者には種類（`creator.json` の `kind`）がある：実在の人は `person`、運営のレーベルは `label`（CLAUDE.md 原則10）。レーベルは `npx ld creator add <handle> --name <名前> --label` で作る（X と画像は任意。画像がなければ名前の頭文字で作る）。`kind` のない作者の作品は `ld check` の「形」で落ちる。

1. `npx ld new <id> --type component`（画面なら `--type screen --platform web` か `--platform mobile`）
   → `works/<id>/` に雛形ができる。id は英小文字・数字・ハイフン。手で作ったものは `--made-with human` を付ける。
2. 編集する：`meta.json` の title と subtype、`part.html`、`part.css`、動きがあれば `part.js`。
   色は根で宣言した `--_*` だけを使う（濃さを変えるなら `color-mix(in oklab, var(--_accent) 85%, black)`）。
3. `npx ld preview <id>` → ブラウザに 3つの配色 × 3つの幅（390、768、1280）が出る。保存するとすぐ描き直す。
4. `npx ld check <id>` → ✗ の行に、落ちた理由と直し方が1行ずつ出る。全部 ✓ になるまで 2〜4 を繰り返す。
5. `npx ld add <id>` → サムネイル（`thumb.webp`）と OG 画像（`og.png`）を作り、`git add` まで済ませる。
   部品は、幅が 800px の6割になる倍率で撮る。ナビのように幅いっぱいに広がる部品（幅800の枠で9割を超える）は、画面と同じく幅1280で描いて縮める。
   登場の演出がある作品は、`meta.json` に任意の `"capture": { "delay_ms": <0〜8000> }` を足す。サムネイルと OG 画像、`ld check` の崩れとアクセシビリティを、読み込みからこの時間だけ待ってから撮る・測る（既定は0）。作品のコードには撮影の都合を入れない。
6. コミットする：`git commit -m "<id> を置く"`。

## サイトに送る（`ld upload`）

`npx ld upload <id> [<id> …] [--publish] [--env dev|prod]` → check が通ったものだけを、Worker の管理API（`POST /api/admin/works`）に送る。D1 に作品と作者（`kind` ごと）が入り、R2 の `works/<id>/<version>/` にファイルが置かれる。

- `--publish` を付けると承認済み（`approved`）で置く。付けなければ、新しい作品は下書き（`draft`）、今ある作品は状態を変えずに版を差し替える（承認済みなら承認済みのまま）。
- 同じ id と version をもう一度送ると 409。中身を変えたら `meta.json` の version を上げて送る（新しい版に差し替わる）。
- `--env dev`（既定）：`apps/web` で `npm run dev` を動かしておく。送り先は `LD_DEV_URL`（なければ `http://localhost:5173`）、管理トークンは `LD_DEV_TOKEN`（なければ `apps/web/.dev.vars` の `ADMIN_TOKEN`）。`.dev.vars` はコミットしない。
- `--env prod`：送り先は `https://ludion.ai`、管理トークンは `apps/web/.prod.vars` の `ADMIN_TOKEN`。`.prod.vars` はコミットしない。

全作品の check とサムネイルの有無は `npx ld list` で見られる。中身を変えたら `meta.json` の version を上げて、4〜6 をやり直す。
