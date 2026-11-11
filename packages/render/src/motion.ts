// 「動きを見る」を選んだ人の枠で、端末の「動きを減らす」設定を「減らさない」として見せる（docs/tasks/FIX-motion.md「1」）。
//
// sandbox の枠の中から端末の設定は変えられないので、作品が設定を聞く2つの道を、枠の HTML を作るところで書き換える。
// - CSS：@media の条件の中の prefers-reduced-motion を、いつも当たる条件か、決して当たらない条件にする。
// - JS：matchMedia を、同じ書き換えをしてから本物に渡す形に差し替える。
//
// 書き換えられない書き方は motionLeftovers が返す。works/ と fixtures/ の全部を tests/motion.spec.ts が確かめる。

/** 決して当たらない条件。どのブラウザでも正しい式で、not (…) で包まれても意味が反対になるだけ。 */
export const MOTION_NEVER = '(min-width:99999999px)';
/** いつも当たる条件。 */
export const MOTION_ALWAYS = '(min-width:0)';

const FEATURE_SOURCE = String.raw`\(\s*prefers-reduced-motion\s*(?::\s*([a-z-]+)\s*)?\)`;
const COMMENT_SOURCE = String.raw`/\*[\s\S]*?\*/`;

/**
 * 1つのメディアクエリを、「減らさない」端末の答えになるように書き換える。
 * - `(prefers-reduced-motion: reduce)` と `(prefers-reduced-motion)`：当たらない
 * - `(prefers-reduced-motion: no-preference)`：当たる
 * - `not`、`or`、`and`、`,` はそのまま残すので、組み合わせの意味はブラウザが正しく計算する
 * - 知らない値は変えない（ブラウザが無効な式として扱う）
 */
export function allowMotionQuery(query: string): string {
  return query
    .replace(new RegExp(COMMENT_SOURCE, 'g'), '')
    .replace(new RegExp(FEATURE_SOURCE, 'gi'), (match, value?: string) => {
      const answer = value?.toLowerCase();
      if (answer === undefined || answer === 'reduce') return MOTION_NEVER;
      return answer === 'no-preference' ? MOTION_ALWAYS : match;
    });
}

/** css[start] が文字列の始まりのとき、閉じた後の位置を返す。 */
function skipString(css: string, start: number): number {
  const quote = css[start];
  for (let at = start + 1; at < css.length; at += 1) {
    if (css[at] === '\\') at += 1;
    else if (css[at] === quote) return at + 1;
    else if (css[at] === '\n') return at; // 閉じていない文字列は、行の終わりで終わる（CSS の決まり）
  }
  return css.length;
}

function skipComment(css: string, start: number): number {
  const end = css.indexOf('*/', start + 2);
  return end === -1 ? css.length : end + 2;
}

/** css[start] が `url(` の始まりで、中が引用符なしのときだけ、閉じた後の位置を返す。data: の中の ' や /* で読み違えないため。 */
function skipBareUrl(css: string, start: number): number | null {
  if (css.slice(start, start + 4).toLowerCase() !== 'url(') return null;
  const open = /^\s*/.exec(css.slice(start + 4))![0].length + start + 4;
  if (css[open] === '"' || css[open] === "'") return null;
  const end = css.indexOf(')', open);
  return end === -1 ? css.length : end + 1;
}

/** コメント、文字列、引用符なしの url() を飛ばしながら、css を頭から見る。visit が次の位置を返せば、そこへ進む。 */
function walkCss(css: string, visit: (at: number) => number | null, onSkipped?: (from: number, to: number) => void): void {
  let at = 0;
  while (at < css.length) {
    const char = css[at];
    // エスケープは飛ばすだけで、コードの一部として残す（motionLeftovers がエスケープした名前を見つけるため）
    if (char === '\\') {
      at += 2;
      continue;
    }
    let next: number | null = null;
    if (char === '/' && css[at + 1] === '*') next = skipComment(css, at);
    else if (char === '"' || char === "'") next = skipString(css, at);
    else if (char === 'u' || char === 'U') next = skipBareUrl(css, at);
    if (next !== null) {
      onSkipped?.(at, next);
      at = next;
      continue;
    }
    at = visit(at) ?? at + 1;
  }
}

/** css[start] からの at ルールの条件の終わり（`{` か `;` の位置）を返す。 */
function preludeEnd(css: string, start: number): number {
  let end = css.length;
  let found = false;
  let at = start;
  while (at < css.length && !found) {
    if (css[at] === '/' && css[at + 1] === '*') at = skipComment(css, at);
    else if (css[at] === '"' || css[at] === "'") at = skipString(css, at);
    else if (css[at] === '{' || css[at] === ';') {
      end = at;
      found = true;
    } else at += 1;
  }
  return end;
}

const NAME_CHAR = /[\w-]/;

/** 作品の CSS の @media を書き換える。コメント、文字列、@media の外は1文字も変えない。 */
export function allowMotionCss(css: string): string {
  let out = '';
  let copied = 0;
  walkCss(css, (at) => {
    if (css[at] !== '@' || css.slice(at + 1, at + 6).toLowerCase() !== 'media' || NAME_CHAR.test(css[at + 6] ?? '')) return null;
    const start = at + 6;
    const end = preludeEnd(css, start);
    const prelude = css.slice(start, end);
    if (/prefers-reduced-motion/i.test(prelude)) {
      out += css.slice(copied, start) + allowMotionQuery(prelude);
      copied = end;
    }
    return end;
  });
  return out + css.slice(copied);
}

/**
 * 枠の中で作品の JS より先に動かす。matchMedia が聞かれたら、allowMotionQuery と同じ書き換えをして本物に渡す。
 * 返すのは本物の MediaQueryList なので、addEventListener、addListener、onchange は壊れない。
 * 幅と組み合わせた式は、幅が変われば change も届く。`media` だけは、作品が渡した文字列のまま見せる。
 */
export const ALLOW_MOTION_SCRIPT =
  `(()=>{const f=window.matchMedia;const c=new RegExp(${JSON.stringify(COMMENT_SOURCE)},'g');const r=new RegExp(${JSON.stringify(FEATURE_SOURCE)},'gi');` +
  `window.matchMedia=function matchMedia(...a){if(!a.length)return f.apply(window,a);const s=String(a[0]);` +
  `if(!/prefers-reduced-motion/i.test(s))return f.call(window,s);` +
  `const m=f.call(window,s.replace(c,'').replace(r,(x,v)=>{const w=v&&v.toLowerCase();return w===undefined||w==='reduce'?${JSON.stringify(MOTION_NEVER)}:w==='no-preference'?${JSON.stringify(MOTION_ALWAYS)}:x}));` +
  `Object.defineProperty(m,'media',{value:s,enumerable:true,configurable:true});return m}})();`;

/**
 * 書き換えた後にも prefers-reduced-motion が残っている箇所を返す。空なら、CSS と HTML の道は全部扱えている。
 * 残るのは、@import の条件、@custom-media、知らない値、エスケープした名前など。part.html の中の media 属性と <style> も数える
 * （<style> は「形」で落ちるので、ふつうは来ない）。JS は実行のときに答えるので、ここでは見ない。
 */
export function motionLeftovers(work: { css: string; html: string }): string[] {
  const rewritten = allowMotionCss(work.css);
  let code = '';
  let copied = 0;
  walkCss(
    rewritten,
    () => null,
    (from, to) => {
      code += rewritten.slice(copied, from);
      copied = to;
    },
  );
  code += rewritten.slice(copied);

  const found = (text: string) => [...text.replace(/\\/g, '').matchAll(/[^\n;{}]*prefers-reduced-motion[^\n;{}]*/gi)].map((match) => match[0].trim());
  return [...found(code), ...found(work.html)];
}
