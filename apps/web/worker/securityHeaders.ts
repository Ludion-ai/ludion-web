// 応答のヘッダー（docs/tasks/T022.md「1」「2」）。index.ts がすべての応答に付ける。
// キャッシュに入る HTML では、キャッシュの中身にヘッダーごと入る。キャッシュのキーにホストが入らないので（SPEC.md「10」）、ホストを含む値を使わない。
// この中で Worker の束縛を使わない。

/**
 * 親のページの CSP。frame-src で、作品の枠が自分のサイトの外へ移る要求そのものを止める（SEC001 の A01、R1）。
 * script-src などは足さない。GA4、書体、SSR のインラインスクリプトを壊さないため。足すなら別のタスク。
 */
export const PARENT_CSP = "frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";

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
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('Permissions-Policy', PERMISSIONS_POLICY);
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', PARENT_CSP);
  }
  return response;
}
