# /ludion:connect：記録

- 動かした道具：Claude Code 2.1.322（モデル claude-fable-5-2）を `claude -p` で。空のフォルダで動かした。渡した道具は Bash、Read。足したプラグインは ludion（このリポジトリの `plugins/ludion`）だけ
- つないだ先：手元の開発のサーバー（見本のデータ）。本番には送っていない。つながっていない所（鍵もつながりもない）から始めた
- ブラウザ：道具が開くはずだった住所を、記録を取るスクリプトが自分のブラウザ（動画に出す人でログイン済み）で開き、「許可する」を押した。この PC の本物のブラウザは開いていない
- 掛かった時間：13.1 秒、ターン数：2
- 下の「答え」は stream-json の出力から機械で取り出した。時刻は始まりからの経過。手元のパスは `<プラグイン>` などに、許可の住所の中の1回きりの値は `<1回きりの値>` に置き換えた。

## 指示文

```text
/ludion:connect
```

## 答え

### +00:02.4 文

A browser tab will open. Log in to Ludion and press Allow (許可する).

### +00:03.4 道具 Bash

```
node "<プラグイン>/skills/ludion/ludion.mjs" login
```

### +00:10.7 道具の答え

```
Opened your browser. Log in to Ludion and choose "Allow":
http://localhost:5473/oauth/authorize?<1回きりの値>
{
  "ok": true,
  "connected": true,
  "server": "http://localhost:5473",
  "note": "Connected. From now on, HTML files you write are saved to Ludion as \"Only me\" automatically (the Claude Code plugin). Disconnect any time on the account page."
}
```

### +00:10.8 ブラウザ

「許可する」を押した（住所を開いてから 0.5 秒）

### +00:13.0 文

Connected. This computer's Claude Code is now linked to your Ludion — note that it connected to the local server at `http://localhost:5473`, not ludion.ai.

- **What happens now:** every HTML file Claude Code writes is saved to your Ludion as "Only me". Only you can see them; you publish from the site yourself.
- **To stop it:** run `/ludion:auto off` in a folder, or `/ludion:auto off --all` to stop it everywhere.
- **To disconnect:** use your Ludion account page.

### +00:13.0 終わり

Connected. This computer's Claude Code is now linked to your Ludion — note that it connected to the local server at `http://localhost:5473`, not ludion.ai.

- **What happens now:** every HTML file Claude Code writes is saved to your Ludion as "Only me". Only you can see them; you publish from the site yourself.
- **To stop it:** run `/ludion:auto off` in a folder, or `/ludion:auto off --all` to stop it everywhere.
- **To disconnect:** use your Ludion account page.
