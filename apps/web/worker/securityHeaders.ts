// 応答のヘッダー（docs/tasks/T022.md「1」「2」）。index.ts がすべての応答に付ける。
// キャッシュに入る HTML では、キャッシュの中身にヘッダーごと入る。キャッシュのキーにホストが入らないので（SPEC.md「10」）、ホストを含む値を使わない。
// この中で Worker の束縛を使わない。

/**
 * 親のページの CSP。frame-src で、作品の枠が自分のサイトの外へ移る要求そのものを止める（SEC001 の A01、R1）。
 * script-src などは足さない。GA4、書体、SSR のインラインスクリプトを壊さないため。足すなら別のタスク。
 */
export const PARENT_CSP = "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

/**
 * 埋め込みの住所（/e/<id>。EMBED001、worker/embed.ts）の CSP。PARENT_CSP と違うのは frame-ancestors だけで、どのサイトの枠にも入れる。
 * 中の作品の枠が外へ移るのは、PARENT_CSP と同じ frame-src 'self' で止める。
 */
export const EMBED_PAGE_CSP = "frame-src 'self'; frame-ancestors *; base-uri 'none'; object-src 'none'";

/** 誰にも許さない機能。コードのコピーで使う clipboard-write は入れない。 */
const DENIED_FEATURES = [
  'accelerometer',
  'bluetooth',
  'camera',
  'display-capture',
  'geolocation',
  'gyroscope',
  'hid',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'serial',
  'usb',
  'xr-spatial-tracking',
];

export const PERMISSIONS_POLICY = DENIED_FEATURES.map((feature) => `${feature}=()`).join(', ');

/** 1週間。includeSubDomains と preload は付けない。後から戻しにくいので、短く始める。 */
export const HSTS = 'max-age=604800';

/**
 * 応答にヘッダーを付ける。response の頭は書き換えられること（cachePolicy.ts が作り直した後）。
 * 枠の応答は自分の CSP（FRAME_RESPONSE_CSP）を持つので、上書きしない。
 */
export function applySecurityHeaders(response: Response): Response {
  const { headers } = response;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Strict-Transport-Security', HSTS);
  if (headers.get('Content-Type')?.includes('text/html')) {
    // 自分だけの作品のページは no-referrer を自分で付ける（次のページの参照元に作品の住所を残さない。docs/tasks/T036.md「2」）
    if (!headers.has('Referrer-Policy')) headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', PARENT_CSP);
  }
  return response;
}
