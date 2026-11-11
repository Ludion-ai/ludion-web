// このサイトで使えるログインの手段（docs/tasks/T020.md「6」「7」）。Worker の型に頼らない。e2e がそのまま読むため。

const onWorkersDev = (requestUrl: string) => new URL(requestUrl).hostname.endsWith('.workers.dev');

/** パスキーを使えるか。wrangler.jsonc の origin と同じときだけ。workers.dev では RP ID が合わないので使わない。 */
export function isPasskeyAvailable(env: { PASSKEY_ORIGIN?: string }, requestUrl: string): boolean {
  return Boolean(env.PASSKEY_ORIGIN) && new URL(requestUrl).origin === env.PASSKEY_ORIGIN;
}

/**
 * Google のログインを使えるか。
 * 値がないときと、workers.dev では使わない（Google に登録したリダイレクト URI に入っていないので、Google の画面でエラーになる）。
 */
export function isGoogleAvailable(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string }, requestUrl: string): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && !onWorkersDev(requestUrl);
}
