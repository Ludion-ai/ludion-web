// handle の形の決まり（docs/tasks/T020.md「1」、SEC001 B2-6）。Worker の型に頼らない。e2e がそのまま読むため。
// handle は本人の証明ではない。表示と URL のための名前。
// 小文字だけを入れるので、ふつうの比べ方で大文字と小文字を区別せずに一意になる。

export const HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/** 前の handle をほかの人が取れない長さ。 */
export const HANDLE_HOLD_MS = 90 * 24 * 60 * 60 * 1000;

/** 道の名前と、運営に見える名前。ludion を含むものは下の関数で別に断る。 */
const RESERVED = new Set([
  'about',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'apply',
  'assets',
  'auth',
  'contact',
  'creator',
  'creators',
  'files',
  'frame',
  'help',
  'home',
  'invite',
  'login',
  'logout',
  'mod',
  'moderator',
  'null',
  'official',
  'p',
  'c',
  'w',
  'en',
  'ja',
  'privacy',
  'robots',
  'root',
  'saved',
  'search',
  'security',
  'settings',
  'signin',
  'signup',
  'sitemap',
  'staff',
  'support',
  'system',
  'terms',
  'undefined',
  'user',
  'users',
  'www',
]);

export const isReservedHandle = (handle: string): boolean => RESERVED.has(handle) || handle.includes('ludion');

/** 手段の名前（GitHub の login など）から、形に合う候補を作る。空なら null。 */
export function handleBase(name: string): string | null {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, HANDLE_MAX)
    .replace(/_+$/, '');
  return base.length > 0 ? base : null;
}
