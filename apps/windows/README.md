# Ludion for Windows（動く壁紙）

Ludion の壁紙（`https://ludion.ai/p/<id>/wall`）を、デスクトップのアイコンの後ろに出すアプリ。.NET 10（WinForms）と WebView2。

## すること

- 画面ごとに、アイコンの後ろで壁紙を動かす（`src/Desktop.cs`。Windows 11 24H2 からの形と、それより前の形の両方）。
- 初めて開くと、壁紙の一覧（`/api/works` の中の種類が `Wallpaper` のもの）を出す。押すとその壁紙になる。
- `ludion://wall/<id>` を開くと、その壁紙に切り替える（サイトの「壁紙にする」→「Windows アプリで設定」）。ない作品なら前の壁紙に戻す。
- 止める：通知領域から止めたとき、電池で動いている間（設定。初めは止める）、画面に鍵がかかっている間、全画面のアプリやゲームの間、その画面が窓で全部隠れている間。止めるときは今の絵を残し、ページを隠して眠らせる。
- 音は初めは消してある。通知領域の「音を出す」で入れる。
- 通知領域：壁紙を変える、止める、音、電池、Windows の起動で始める（初めは始める）、Ludion を開く、終わる。

## 守り

- 開くのは `https://ludion.ai/p/<その id>/wall` だけ。ほかへの移動、新しい窓、ダウンロード、許可（カメラなど）は止める。作品の JS は、そのページの中の守りの枠（sandbox、CSP）で動く。
- `ludion://` の住所は、書かれたままの文字を `^ludion://wall/[a-z0-9-]+/?$` で確かめる。
- 送るものはない。読むのは ludion.ai のページと API だけ。設定は `%LOCALAPPDATA%\Ludion\settings.json`（この PC の中だけ）。
- 2つ目に開いたアプリは、頼みを名前つきパイプで1つ目に渡して終わる。パイプはこの人だけがつなげる（`PipeOptions.CurrentUserOnly`）。

## 作る

```powershell
dotnet test apps/windows/tests
pwsh apps/windows/scripts/build.ps1 -Target exe    # 段階 A：out/LudionSetup.exe（署名なし、約 47 MB）
pwsh apps/windows/scripts/build.ps1 -Target msix   # Store：out/Ludion.msix（署名は Store がする）
```

MSIX の `Identity` は、Partner Center でアプリの名前を取った後に出る値を `-IdentityName`、`-Publisher`、`-PublisherDisplayName` で渡す。

Actions（`.github/workflows/windows.yml`）が、pull request ごとに試験と2つのファイルを作る。手で動かして `release` を選ぶと、Releases に下書きを作る（公開は手で）。

## 段階 A の入れ方

ダウンロードした `LudionSetup.exe` を開くと、自分を `%LOCALAPPDATA%\Programs\Ludion\Ludion.exe` に写し、`ludion://`、Windows の起動、スタートメニュー、「アプリ」の一覧（消すため）を、この人の場所（HKCU）に登録して開く。管理者の権限は要らない。消すときは「設定」→「アプリ」から。

## 開発の確かめ

環境の変数（どれも開発のときだけ）：

| 変数 | すること |
| --- | --- |
| `LUDION_ORIGIN` | 読むサイトを手元に替える（`http://localhost:…` と `http://127.0.0.1:…` だけ） |
| `LUDION_NO_INSTALL=1` | 入れずにその場で動かす |
| `LUDION_LOG=1` | `%LOCALAPPDATA%\Ludion\log.txt` に、止めた・動かしたなどを書く（この PC の中だけ） |
| `LUDION_DEVTOOLS=1` | WebView2 の開発ツールを使えるようにする |

`pwsh apps/windows/scripts/make-icons.ps1` で、絵（`.ico` と MSIX のタイル）を Ludion の印から作り直す。
