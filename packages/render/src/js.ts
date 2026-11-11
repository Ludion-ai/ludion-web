// part.js（ESモジュール）を、1枚のHTMLの中の <script type="module"> に入れられる形にする。
// 外のファイルを読まないので import はできない。export を外し、同じモジュールの中で mount を呼ぶ。

const EXPORT_DEFAULT_DECL = /^([ \t]*)export[ \t]+default[ \t]+(?=(?:async[ \t]+)?function\b|class\b)/gm;
const EXPORT_DECL = /^([ \t]*)export[ \t]+(?=(?:async[ \t]+)?function\b|class\b|const\b|let\b|var\b)/gm;
const EXPORT_LIST = /^[ \t]*export[ \t]*\{[^}]*\}[ \t]*;?[ \t]*$/gm;

/** `export function mount` などから export を外す。宣言はモジュールの中に残るので、グローバルにはならない。 */
export function stripExports(js: string): string {
  return js.replace(EXPORT_DEFAULT_DECL, '$1').replace(EXPORT_DECL, '$1').replace(EXPORT_LIST, '');
}

/** part.js が `mount` を export しているか。 */
export function exportsMount(js: string): boolean {
  return (
    /^[ \t]*export[ \t]+(?:async[ \t]+)?function[ \t]*\*?[ \t]*mount\b/m.test(js) ||
    /^[ \t]*export[ \t]+(?:const|let|var)[ \t]+mount\b/m.test(js) ||
    /^[ \t]*export[ \t]*\{[^}]*\bmount\b[^}]*\}/m.test(js)
  );
}

/** <script> と <style> の中で、閉じタグとして読まれないようにする。 */
export function escapeRawText(text: string, tag: 'script' | 'style'): string {
  return text.replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
}
