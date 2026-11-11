# Ludion

[ludion.ai](https://ludion.ai) のソースコード。Ludion は、作り手が置いた UI の作品（画面と部品）を、使い手が見て、コードをコピーして自分のサイトで使うためのサイトです。

The source code of [ludion.ai](https://ludion.ai): a place where creators post UI works (screens and components) and anyone can copy the code into their own site.

## ライセンス / License

- **作品**（`works/` と、サイトから投稿された作品）：MIT（[works/LICENSE.md](works/LICENSE.md)）。コピーしたコードの1行目に、作者のクレジット行が残ります。
  Works are MIT-licensed. The first line of copied code always credits the creator.
- **サイトのコード**（上の作品を除く全部。`apps/`、`packages/` など）：[FSL-1.1-MIT](LICENSE.md)。読む、直す、自分で使うのは自由です。Ludion と競合するサービスに使うことだけを禁じ、各版は公開から2年で MIT になります。
  The site code (everything except the works above) is licensed under [FSL-1.1-MIT](LICENSE.md): you may read, modify and use it for any purpose other than a competing service, and each version becomes MIT two years after release.

## 動かし方 / Development

Node.js 24 と npm を使います。

```sh
npm install
npm run seed:dev   # 開発用の見本データを入れる
npm run dev        # http://localhost:5173
```

テストは Playwright で流します（初回はブラウザを入れる）。

```sh
npx playwright install --with-deps chromium webkit firefox
npm test
```

ログインを手元で試すときは、`apps/web/.dev.vars` に OAuth の値を書きます。このファイルはコミットしません。

## 構成 / Layout

| 場所 | 中身 |
| --- | --- |
| `apps/web` | サイト本体。1つの Cloudflare Worker（Hono の API と、Vite + React の画面） |
| `packages/` | 作品の検査（`rules`）、描画（`render`）、運営の道具（`ld`） |
| `works/` | 運営が置いた作品 |
| `skills/` | AI のエージェントから作品を置くためのスキル（`skills/ludion`） |
| `fixtures/`、`seed/` | 検査とテストのための見本 |
| `SPEC.md` | サイトの仕様 |

弱い所を見つけたときは、Issue に書かずに [SECURITY.md](SECURITY.md) の手順で知らせてください。
