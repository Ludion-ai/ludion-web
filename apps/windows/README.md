# Ludion for Windows（動く壁紙）

Ludion の壁紙（`https://ludion.ai/p/<id>/wall`）を、デスクトップのアイコンの後ろに出すアプリ。.NET 10（WinForms）と WebView2。

## すること

- 画面ごとに、アイコンの後ろで壁紙を動かす（`src/Desktop.cs`。Windows 11 24H2 からの形と、それより前の形の両方）。
- 初めて開くと、壁紙の一覧（`/api/works` の中の種類が `Wallpaper` のもの）を出す。押すとその壁紙になる。
- `ludion://wall/<id>` を開くと、その壁紙に切り替える（サイトの「壁紙にする」→「Windows アプリで設定」）。ない作品なら前の壁紙に戻す。
- 止める：通知領域から止めたとき、電池で動いている間（設定。初めは止める）、画面に鍵がかかっている間、全画面のアプリやゲームの間、その画面が窓で全部隠れている間。止めるときは今の絵を残し、ページを隠して眠らせる。
- 音は初めは消してある。通知領域の「音を出す」で入れる。
- デスクトップの何もない所での左のクリックとマウスの動きを、壁紙に本物の操作として渡す（`src/DesktopInput.cs`）。Raw Input で見るだけで横取りしないので、デスクトップにもそのまま届く。アイコンの上、ほかの窓の上、右クリック、ダブルクリックでアイコンを開く、は今までどおり。通知領域の「クリックを壁紙に渡す」で切り替える（初めは渡す）。
- 3つの違い：「Ludion の壁紙：オン／オフ」（オフで元の Windows の壁紙に戻る。アプリは通知領域に残り、オンで選んでいた壁紙に戻る）、「一時停止」（絵は残したまま動きと音を止める）、「Ludion を終わる」（アプリを閉じる。壁紙も元に戻る）。
- 「壁紙を選ぶ」の窓の上に、オンとオフ、「Windows の起動で始める」の切り替え。通知領域のアイコンを左クリックすると、この窓が開く。
- 通知領域の右クリック：壁紙を選ぶ、オンとオフ、一時停止、音、クリックを壁紙に渡す、電池のときは一時停止、Windows の起動で始める、ludion.ai を開く、Ludion を終わる。

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
| `LUDION_DATA_DIR` | 設定、WebView2 の置き場、記録を、この場所（絶対の道）に置く。入れたアプリとは別の1つとして動く |
| `LUDION_NO_DESKTOP=1` | デスクトップに付けず、画面の外の窓のまま動かす（使っている人のデスクトップを変えずに確かめる） |
| `LUDION_DEV_CLICK=x,y` | 読み込みの後、壁紙の窓のこの点を、デスクトップのクリックと同じ道で押す。作品の枠の中で `isTrusted` とユーザーの操作の印を記録に書く |

`pwsh apps/windows/scripts/make-icons.ps1` で、絵（`.ico` と MSIX のタイル）を Ludion の印から作り直す。
