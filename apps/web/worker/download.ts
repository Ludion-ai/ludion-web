// Windows アプリのダウンロード（docs/tasks/APP001.md、ludion-app）。サイトのボタンはいつも /download/windows を指し、配り先はここで決める（app.ts が 302 で送る）。
//
// 段階 A：署名のない .exe を、公開のリポジトリ（Ludion-ai/ludion-web）の Releases の最新から配る。
//   ファイルは .github/workflows/windows.yml が作る。「最新」は下書きを含まないので、CEO が公開するまでは 404 になる。
// 段階 B：Microsoft Store の Web インストーラーに替える（CEO の Store の登録の後）。
// 数を数えない、何も残さない（CLAUDE.md 原則6）。行き先を替えてすぐ効くように、キャッシュしない（cachePolicy.ts の既定）。
// e2e からも読むので、Worker の型（Env、Hono）をここで読まない。

export const WINDOWS_DOWNLOAD_URL = 'https://github.com/Ludion-ai/ludion-web/releases/latest/download/LudionSetup.exe';
