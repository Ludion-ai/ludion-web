/**
 * 作品のページの「コピーされるコード」は、ページの JSON に入れず、コードの箱（<pre>）の文字から戻す（PERF002「2」）。
 * 同じコードを HTML に2回入れないため。コードの箱は SPEC の「コードの箱」で、画面に出す物なので残す。
 */

/** コードの箱の <code> の印。ブラウザは、ここの textContent を「コピーされるコード」にする */
export const CODE_ATTRIBUTE = 'data-ld-code';

/**
 * HTML の文字として置いたとき、ブラウザが読んだ後の textContent が同じ文字に戻るか。
 * HTML を読むと、CR は LF になり（CRLF も）、NUL は消える。対になっていないサロゲートは UTF-8 にできず U+FFFD になる。
 * 戻らないコードは、今までどおりページの JSON に入れる（1文字でも違うものをコピーさせない）。
 */
export function survivesHtmlText(text: string): boolean {
  return !/[\r\0]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text);
}
