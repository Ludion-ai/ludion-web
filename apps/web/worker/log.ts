// Worker のログ（docs/tasks/T022.md「3」、CLAUDE.md 原則6）。Worker の中で console を使うのはここだけ。
// 決まった短いエラーの名前と、決まった値（道の種類など）だけを出す。
// 例外の中身、要求の URL、見出し、本文、バインドした値は出さない。例外の文に、SQL の値や IP や URL が入ることがあるため。

type LogName = 'internal_error' | 'github_failed' | 'google_failed' | 'rate_limit_failed' | 'rate_key_missing' | 'admin_token_missing' | 'cache_purge_failed' | 'ssr_failed' | 'outline_failed';

const ROUTE_KINDS = new Set(['api', 'auth', 'frame', 'p', 'c', 'w', 'files', 'saved', 'account', 'login', 'signup', 'privacy', 'about', 'assets', 'new', 'admin', 'draft-frame', 'draft-thumb', 'oauth', 'mcp', '.well-known', 's', 'share-frame']);

/** 道の種類。道そのものは出さない（作品の id や、知らない道に入れられた文字が入るため）。 */
export function routeKind(pathname: string): string {
  const [, first = ''] = pathname.split('/');
  if (first === '') return 'home';
  if (first === 'sitemap.xml') return 'sitemap';
  return ROUTE_KINDS.has(first) ? first : 'other';
}

const ERROR_TYPES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'AggregateError', 'EvalError', 'URIError']);

/** 例外の種類。中身は読まない。 */
export function errorType(error: unknown): string {
  return error instanceof Error && ERROR_TYPES.has(error.name) ? error.name : 'Other';
}

export function logError(name: LogName, fields: Record<string, string> = {}): void {
  console.error([name, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join(' '));
}
