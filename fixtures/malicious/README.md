# 悪意のある見本（docs/tasks/T007.md「4」）

作品のページの枠（`<iframe sandbox="allow-scripts allow-forms">`、CLAUDE.md「描画」）が、他人の JS を閉じ込めていることを確かめるための見本。**開発用のデータにだけ入れる**（`npm run seed:dev`）。本番には入れない。`ld upload` の道も通らない。

| id | やろうとすること | 枠の中で起きること |
| --- | --- | --- |
| `mal-cookie` | `document.cookie` を読み、`fetch`、画像、`sendBeacon` で `https://evil.example` へ送る。サイトの API も叩く | 本物の cookie は `SecurityError` で読めない。作品が読む `document.cookie` はメモリだけの代わりで、空が返る（FRAME001）。送信は CSP で止まる |
| `mal-top` | `window.top` を `https://evil.example` へ遷移させる | `allow-top-navigation` がないので止まる |
| `mal-parent` | 親の DOM を書き換える | オリジンが違うので `SecurityError` |
| `mal-nav` | 押すと枠を `https://evil.example` へ移す。`part.js` の文字列の検査をすり抜ける書き方 | 親のページの `frame-src 'self'` で止まり、外へ届かない（T022） |
| `mal-nav-loop` | 読み込みの途中で枠を移す（元の文書の `load` は起きない） | 同じく外へ届かない。止められた枠を親の見張りが読み直し、続けば枠を空にする（T012） |
| `mal-nav-alias` | 入力を読み、`location` を別名で参照して、枠を外へ移して入力を送る（SEC001 の R1） | 同じく外へ届かない（T022） |
| `mal-nav-fake-ready` | 最初の `load` の前に枠を移す。移った先が `ld-frame-loaded` を真似すると、親の見張りをすり抜ける（SEC001 の R1） | 同じく外へ届かない（T022） |
| `mal-doc` | 文書の作品（DOC001。`index.html` だけで、作品の契約の形ではない）。外を読む `<script src>`、`<link>`、`<img>`、押すと `fetch`、`sendBeacon`、`WebSocket`、`top` の移動、親の DOM、`window.open`、外へのフォームの送信、外へのリンク、枠の移動 | 今の枠と同じ守りで、どれも外へ届かない。`window.open` は `null`。フォームは `form-action` で止まる |

`mal-cookie`、`mal-top`、`mal-parent` は、結果を根の `data-*` に書く。テスト（`apps/web/e2e/pages.spec.ts`）はそれと、外へのリクエストと、親のページを見る。sandbox を外した対照では、この3つの攻撃が成功することも確かめる。`mal-nav*` は `apps/web/e2e/frame-escape.spec.ts` が、Chromium、WebKit、Firefox で確かめる（親の CSP を外した対照では、外へ届く）。`mal-doc` は `apps/web/e2e/frame-document.spec.ts` が、同じ3つのブラウザで確かめる（枠の応答の CSP を外した対照では、外へ届く）。
