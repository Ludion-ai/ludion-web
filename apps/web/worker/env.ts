/** Worker の束縛（apps/web/wrangler.jsonc）。 */
export interface Env {
  /** D1 ludion-app（SPEC.md「7」） */
  DB: D1Database;
  /** R2 ludion-parts。作品のファイルは works/<id>/<version>/ */
  PARTS: R2Bucket;
  /** Vite で作った静的アセット */
  ASSETS: Fetcher;
  /** 回数の制限（worker/rateLimit.ts）。POST /api/count */
  LIMIT_COUNT: RateLimit;
  /** POST /api/works/:id/like と bookmark */
  LIMIT_TOGGLE: RateLimit;
  /** /auth/* */
  LIMIT_AUTH: RateLimit;
  /** /api/account/* */
  LIMIT_ACCOUNT: RateLimit;
  /** 回復のコードを試す */
  LIMIT_RECOVERY: RateLimit;
  /** 作品の投稿の保存 */
  LIMIT_POST: RateLimit;
  /** パスキーの RP ID と origin（wrangler.jsonc の vars）。手元は .dev.vars で localhost に差し替える */
  PASSKEY_RP_ID: string;
  PASSKEY_ORIGIN: string;
  /** Google の OAuth クライアント（開発は .dev.vars、本番は wrangler secret）。ないと Google のログインは 503 で、ボタンも出さない */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Google の URL と iss（wrangler.jsonc の vars）。テストでは手元の偽の Google に差し替える */
  GOOGLE_AUTH_URL: string;
  GOOGLE_TOKEN_URL: string;
  GOOGLE_JWKS_URL: string;
  GOOGLE_ISSUER: string;
  /** 回数の制限の鍵を作る秘密の値（worker/limitKey.ts。開発は .dev.vars、本番は wrangler secret）。ないと数えずに通す */
  RATE_KEY_SECRET?: string;
  /** 投稿を全員に開いたか。"1" で開く（wrangler.jsonc の vars。テストは .dev.vars で開く） */
  POSTING_OPEN: string;
  /** 管理トークン（開発は .dev.vars、本番は wrangler secret） */
  ADMIN_TOKEN?: string;
  /** GitHub の OAuth App（開発は .dev.vars、本番は wrangler secret）。ないとログインは 503 */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** ログインの画面とトークンの URL（wrangler.jsonc の vars）。テストでは手元の偽の GitHub に差し替える */
  GITHUB_WEB_URL: string;
  /** GitHub の API の URL（同じ） */
  GITHUB_API_URL: string;
}
