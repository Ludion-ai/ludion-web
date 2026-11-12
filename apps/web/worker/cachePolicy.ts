// キャッシュの許可リスト（docs/tasks/T012.md「1」、SPEC.md「10」）。ここに書いた道だけをキャッシュする。
//
// Workers Cache は Worker の前に立つので、当たれば Worker は動かない。キーは道と URL の値だけで、cookie もホストも入らない
// （https://developers.cloudflare.com/workers/cache/cache-keys/）。だから、人によって変わる応答をここに足してはいけない。
//
// この中で Node の API も、Worker の束縛も使わない。e2e/cache.spec.ts がそのまま読むため。

export const DEFAULT_CACHE_CONTROL = 'private, no-store';
/** 共有のキャッシュに60秒。ブラウザには残さない（取り下げがすぐ効くように）。 */
export const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=60';
/** パスに版かハッシュが入り、変わったら別の URL になるもの。 */
export const LONG_CACHE_CONTROL = 'public, max-age=31536000, immutable';
/**
 * サムネイル。共有のキャッシュには長く置き、札で消す。札ではブラウザのキャッシュを消せないので、ブラウザには1時間だけ残す（SEC001 A07）。
 * 取り下げた後も、見たことのある人のブラウザにはこの時間だけ残る。
 */
export const THUMB_CACHE_CONTROL = 'public, max-age=3600, s-maxage=31536000';

/** 一覧を含む HTML の札。作品の承認、取り下げ、版の差し替えのときに消す。 */
export const CATALOG_TAG = 'catalog';
/** サムネイルの札。当たると Worker の「承認済みか」の確かめを通らないので、取り下げのときに作品ごとに消す。 */
export const workTag = (id: string) => `work-${id}`;

const AVATAR_FILE = 'avatar-[0-9a-f]{12}\\.webp';

interface CacheRule {
  /** apps/web/worker/ の Hono のルート。e2e/cache.spec.ts が app.routes と突き合わせる */
  route: string;
  path: RegExp;
  cacheControl: string;
  tag?: (match: RegExpExecArray) => string;
  /** SPA の index.html（知らない道への 200）を混ぜない */
  notHtml?: boolean;
}

export const CACHE_RULES: CacheRule[] = [
  { route: '/', path: /^\/$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/p/:id', path: /^\/p\/[^/]+$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  // 作品のコードの文字（docs/tasks/T031.md「1」）。作品のページと同じ扱いで、取り下げと版の差し替えのときに消える
  { route: '/p/:id/code', path: /^\/p\/[^/]+\/code$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  // 全画面の住所（WALL001）。作品のページと同じ扱い。中の枠（/frame/...）はキャッシュしない
  { route: '/p/:id/wall', path: /^\/p\/[^/]+\/wall$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  // 埋め込みの住所（EMBED001）。全画面の住所と同じ扱い。中の枠（/frame/.../embed.html）はキャッシュしない（そこで数える）
  { route: '/e/:id', path: /^\/e\/[^/]+$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/c/:handle', path: /^\/c\/[^/]+$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  // 一覧を含まないので札は要らない。文を変えるのはデプロイのときだけで、Worker の版が変わればキャッシュも変わる
  { route: '/privacy', path: /^\/privacy$/, cacheControl: PAGE_CACHE_CONTROL },
  { route: '/about', path: /^\/about$/, cacheControl: PAGE_CACHE_CONTROL },
  { route: '/terms', path: /^\/terms$/, cacheControl: PAGE_CACHE_CONTROL },
  // 英語のページ。道が違うので、日本語と混ざらない（SPEC.md 9）
  { route: '/en', path: /^\/en$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/en/p/:id', path: /^\/en\/p\/[^/]+$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/en/c/:handle', path: /^\/en\/c\/[^/]+$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/en/privacy', path: /^\/en\/privacy$/, cacheControl: PAGE_CACHE_CONTROL },
  { route: '/en/about', path: /^\/en\/about$/, cacheControl: PAGE_CACHE_CONTROL },
  { route: '/en/terms', path: /^\/en\/terms$/, cacheControl: PAGE_CACHE_CONTROL },
  // 作品の一覧と同じ札で、承認と取り下げのときに消える
  { route: '/sitemap.xml', path: /^\/sitemap\.xml$/, cacheControl: PAGE_CACHE_CONTROL, tag: () => CATALOG_TAG },
  { route: '/w/:id/:version/thumb.webp', path: /^\/w\/([^/]+)\/[^/]+\/thumb\.webp$/, cacheControl: THUMB_CACHE_CONTROL, tag: (match) => workTag(match[1]) },
  { route: `/files/creators/:creator/:file{${AVATAR_FILE}}`, path: new RegExp(`^/files/creators/[^/]+/${AVATAR_FILE}$`), cacheControl: LONG_CACHE_CONTROL },
  // 静的アセット：Vite がハッシュを付けて /assets/ に置く（ビルドの結果はこの下だけ）
  { route: '/*', path: /^\/assets\/[^/]+$/, cacheControl: LONG_CACHE_CONTROL, notHtml: true },
];

/**
 * 応答にキャッシュの指示を付ける。許可リストの道の GET と HEAD の 200 だけを許し、ほかはすべて private, no-store にする。
 * Set-Cookie を含む応答は、どの道でも許さない。アセットの応答の頭は書き換えられないので、作り直す。
 */
export function applyCachePolicy(response: Response, method: string, pathname: string): Response {
  const copy = new Response(response.body, response);
  copy.headers.delete('Cache-Tag');
  copy.headers.set('Cache-Control', DEFAULT_CACHE_CONTROL);
  if ((method !== 'GET' && method !== 'HEAD') || response.status !== 200 || response.headers.has('Set-Cookie')) return copy;
  // 道が自分で no-store を付けた応答は、許可リストの道でも残さない（自分だけの作品のページ。docs/tasks/T036.md「2」）
  if (response.headers.get('Cache-Control')?.includes('no-store')) return copy;

  for (const rule of CACHE_RULES) {
    const match = rule.path.exec(pathname);
    if (!match) continue;
    if (rule.notHtml && response.headers.get('Content-Type')?.includes('text/html')) return copy;
    copy.headers.set('Cache-Control', rule.cacheControl);
    if (rule.tag) copy.headers.set('Cache-Tag', rule.tag(match));
    return copy;
  }
  return copy;
}

export const CANONICAL_ORIGIN = 'https://ludion.ai';

/** 検索エンジンに見せる本当の URL。workers.dev で開かれても ludion.ai を指す。 */
export const canonicalUrl = (path: string) => `${CANONICAL_ORIGIN}${path}`;

/**
 * 共有の画像の絶対 URL に使うオリジン。キャッシュのキーにホストは入らず、workers.dev と ludion.ai で同じ項目を共有する。
 * workers.dev で先に開かれても、ludion.ai の人に workers.dev の URL を返さない。
 */
export function shareOrigin(requestUrl: string): string {
  const url = new URL(requestUrl);
  return url.hostname.endsWith('.workers.dev') ? CANONICAL_ORIGIN : url.origin;
}
