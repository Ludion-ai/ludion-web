# 押すと波紋が広がるボタンを1つの HTML で作って：記録

- 動かした道具：Claude Code 2.1.322（モデル claude-fable-5-2）を `claude -p` で。空のフォルダで動かした。渡した道具は Edit、Read、Write。足したプラグインは ludion（このリポジトリの `plugins/ludion`）だけ
- つないだ先：手元の開発のサーバー（見本のデータ）。本番には送っていない
- 掛かった時間：17.5 秒、ターン数：2、できたファイル：ripple-button.html
- 下の「答え」は stream-json の出力から機械で取り出した。時刻は始まりからの経過。Write の中身はここには行数だけを書く（中身は隣の HTML）。手元のパスは `<作業フォルダ>` に置き換えた。

## 指示文

```text
押すと波紋が広がるボタンを1つの HTML で作って
```

## 答え

### +00:13.9 道具 Write ripple-button.html

101 行、3002 バイト

### +00:14.6 フック PostToolUse:Write

画面に出る行（systemMessage）：

```
Ludion: saved ripple-button.html → http://localhost:5473/en/p/ui-0499c0
```

Claude に渡る文（additionalContext）：

```
Ludion auto-save: ripple-button.html was saved to the person's Ludion as a new work, as "Only me" (only the person can see it): http://localhost:5473/en/p/ui-0499c0
Tell the person this address once (no need to repeat it for every small edit). To publish, they press Publish on the site (it is reviewed first).
```

### +00:17.4 文

`ripple-button.html` を作りました。ブラウザでの動作確認はまだしていません。

- **波紋**：押した位置から白い波紋が広がり、ボタンの端まで届いて消えます。連打すると波紋が重なります。
- **キーボード**：Enter / Space で押すと、中央から広がります。
- **動きを減らす設定**：OS で「視覚効果を減らす」にしている場合は、波紋がほぼ一瞬で消えます。

Ludion にも「自分だけ」の作品として自動保存されました：http://localhost:5473/en/p/ui-0499c0
公開するときは、サイト上で Publish を押してください（公開前に審査があります）。

### +00:17.4 終わり

`ripple-button.html` を作りました。ブラウザでの動作確認はまだしていません。

- **波紋**：押した位置から白い波紋が広がり、ボタンの端まで届いて消えます。連打すると波紋が重なります。
- **キーボード**：Enter / Space で押すと、中央から広がります。
- **動きを減らす設定**：OS で「視覚効果を減らす」にしている場合は、波紋がほぼ一瞬で消えます。

Ludion にも「自分だけ」の作品として自動保存されました：http://localhost:5473/en/p/ui-0499c0
公開するときは、サイト上で Publish を押してください（公開前に審査があります）。
