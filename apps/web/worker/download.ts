// Windows アプリのダウンロード（docs/tasks/APP001.md、ludion-app）。サイトのボタンはいつもこの住所を指し、配り先はここで決める。
//
// 段階 A：署名のない .exe を、公開のリポジトリ（Ludion-ai/ludion-web）の Releases の最新から配る。
//   ファイルは .github/workflows/windows.yml が作る。「最新」は下書きを含まないので、CEO が公開するまでは 404 になる。
// 段階 B：Microsoft Store の Web インストーラーに替える（CEO の Store の登録の後）。
// 数を数えない、何も残さない（CLAUDE.md 原則6）。行き先を替えてすぐ効くように、キャッシュしない（cachePolicy.ts の既定）。

import type { Context } from 'hono';
import type { Env } from './env';

export const WINDOWS_DOWNLOAD_URL = 'https://github.com/Ludion-ai/ludion-web/releases/latest/download/LudionSetup.exe';

export function redirectWindowsDownload(c: Context<{ Bindings: Env }>): Response {
  return c.redirect(WINDOWS_DOWNLOAD_URL, 302);
}
