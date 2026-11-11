# ローンチ動画の素材（V002）

素材は `promo/launch/assets/` に置く。コミットしない（`promo/.gitignore`）。下の場所から取り直せる。

## 3D モデル

| 項目 | 内容 |
| --- | --- |
| 題名 | Modern Silver Laptop |
| 作者 | Ottto3d（https://sketchfab.com/Ottto3ds） |
| 入手先 | https://sketchfab.com/3d-models/modern-silver-laptop-e641100794e8482d91bea533f26f6ebb |
| ライセンス | CC BY 4.0（http://creativecommons.org/licenses/by/4.0/） |
| 置き場所 | `promo/launch/assets/laptop/`（zip を展開したもの。`scene.gltf`、`scene.bin`、`textures/`、`license.txt`） |
| zip の SHA-256 | `C16C6BD6717CB58474F40A148134BAB35AAF0189BC990BB3C0D9DF6598B4EA93` |

モデルの `license.txt` が求める表記：

> This work is based on "Modern Silver Laptop" (https://sketchfab.com/3d-models/modern-silver-laptop-e641100794e8482d91bea533f26f6ebb) by Ottto3d (https://sketchfab.com/Ottto3ds) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

### 変えたこと

形（頂点）は変えていない。形を足していない。変えたのは材質と光だけ。

1. 画面：画面の4つの三角形を別の物に分け、模様の代わりに Ludion の中の絵を映した。
2. 画面の縁：画面と同じ面にある縁の三角形と、画面のすぐ周りの段差の側面を、銀色から黒い材質に替えた。白い画面が白い部屋に溶けるため。カメラの穴の丸はそのまま。
3. 金属：模様（色、金属度、粗さ、法線）はそのままで、`MeshStandardMaterial` を `MeshPhysicalMaterial` に替えた。透明の設定（BLEND）を外した。

林檎の印、製品名は足していない。

### 知っておくこと

モデルの説明文に、作者が MacBook Pro 15 に似せて作ったと書いている（商標はないとも書いている）。キーの刻印には `command`、`option`、`⌘` がある。

## 書体

| 書体 | 使う場所 | 入手先 | ライセンス | SHA-256 |
| --- | --- | --- | --- | --- |
| Noto Sans JP（可変） | 見出し、作品のページ、`ludion.ai` | https://github.com/google/fonts/tree/main/ofl/notosansjp | OFL 1.1 | `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f` |
| Noto Sans Mono（可変） | コードの板 | https://github.com/google/fonts/tree/main/ofl/notosansmono | OFL 1.1 | `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081` |
| Inter（可変） | ロゴの `Ludion`（サイトのロゴと同じ書体） | `@fontsource-variable/inter`（リポジトリの依存） | OFL 1.1 | |

置き場所は `promo/launch/assets/fonts/`。ファイル名は `NotoSansJP[wght].ttf`、`NotoSansMono[wdth,wght].ttf`。

## 音

すべてコードで作る（`promo/launch/audio.mjs`）。録音の素材、既存の曲は使っていない。

## 3D のライブラリ

`three`（MIT）。環境の光は `stage.js` の中で作る。外の HDRI は読まない。
