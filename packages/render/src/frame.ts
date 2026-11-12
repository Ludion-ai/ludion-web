// 作品を1枚のHTMLにする。sandbox の iframe（FRAME_SANDBOX）に入れて使う（CLAUDE.md「描画」）。
//
// - ホストの要素に Shadow DOM を付け（宣言的 Shadow DOM）、中に part.css と part.html を入れる。
// - part.js があれば、同じ1枚の中で mount(root) を呼ぶ。外のファイルは読まない。
// - CSP の meta で、作品から外への通信を止める（書体だけは通す）。フォームの送信先への送信も止める。
// - localStorage、sessionStorage、document.cookie は、投げるときだけメモリだけの代わりにする（storage.ts）。読み直すと消える。
// - WebRTC は CSP では止まらないので、作品より先に使えなくし、入れ子の枠も作れなくする（guard.ts。FRAME002）。

import { NEUTRAL_PALETTES, tokenDeclarations } from './tokens.ts';
import { escapeRawText, stripExports } from './js.ts';
import { ALLOW_MOTION_SCRIPT, allowMotionCss } from './motion.ts';
import { FRAME_GUARD_SCRIPT } from './guard.ts';
import { STORAGE_SCRIPT } from './storage.ts';
import type { Palette, Work } from './types.ts';

/**
 * 枠の sandbox。allow-forms で submit が届き、作品の JS が preventDefault できる。
 * 送信先への実際の送信は FRAME_CSP の form-action で止まる。allow-same-origin は付けない。
 */
export const FRAME_SANDBOX = 'allow-scripts allow-forms';

export const FRAME_CSP =
  "form-action 'none'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob:";

/**
 * サイトが枠の HTML を返すときの、応答の頭の CSP。
 * sandbox も頭に入れるので、枠の URL を直接開いても、サイトのオリジンでは動かない。
 * frame-ancestors で、自分のサイトの中でしか枠に入れられなくする（meta では効かないので、頭にだけ入れる）。
 */
export const FRAME_RESPONSE_CSP = `sandbox ${FRAME_SANDBOX}; ${FRAME_CSP}; frame-ancestors 'self'`;

/** ホストの要素の id。検査（ld check）とサイトがこの要素を探す。 */
export const HOST_ID = 'ld-host';

/**
 * ホストの `data-ld-mount` に入る値。
 * - `none`：part.js がない
 * - `ok`：mount が片付けの関数を返した
 * - `no-cleanup`：mount は動いたが、関数を返さなかった
 * - `error`：mount がない、または投げた
 * - 属性がない：part.js が構文の誤りなどで動かなかった
 */
export type MountStatus = 'none' | 'ok' | 'no-cleanup' | 'error';

export interface FrameOptions {
  palette: Palette;
  /** 表示する幅（px）。枠の幅を親が決めるので、ここでは印として入れるだけ。 */
  width?: number;
  /**
   * 部品の置き方。既定は枠の中央。'top' は余白なしで枠の上に寄せる（ページの頭にある形）。
   * 幅いっぱいの部品のサムネイルで使う。画面（screen）は、もともと幅いっぱいで上から置く。
   * 'inline' はサイトのヘッダーのスイッチ（docs/tasks/T035.md「3」）。地を透明に、余白を0に、根を枠の高さいっぱいに縮めて中央に置き、
   * 親とスイッチの状態を知らせ合う小さなスクリプト（SWITCH_SCRIPT）を足す。CSP と sandbox は同じ。
   * 'fill' は全画面の住所（/p/<id>/wall。WALL001）。枠の大きさいっぱいに作品を置き、スクロールさせない。CSP と sandbox は同じ。
   */
  placement?: 'center' | 'top' | 'inline' | 'fill';
  /** 端末の「動きを減らす」設定を「減らさない」として見せる。見る人が「動きを見る」を選んだときだけ（motion.ts）。 */
  motion?: boolean;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 作品の外側の形。部品は枠の中央に置き、画面は幅いっぱいに置く。
// 部品の置き場は grid にする。flex だと固定幅の部品が縮み、ふつうのページに貼ったときのはみ出しが隠れるため。
const BASE_CSS = 'html,body{margin:0}body{min-height:100vh}#ld-host{display:block}';
const COMPONENT_CSS =
  'body{display:flex;flex-direction:column;justify-content:safe center;padding:32px 24px;box-sizing:border-box}' +
  '#ld-host{display:grid;grid-template-columns:minmax(0,1fr);justify-items:safe center;align-items:center}';

// ヘッダーのスイッチの形。地は透明にして、親のページの色を見せる。
// 根の大きさは作品の CSS が枠の高さから決める（toggle-* は 100vh から余白を引く）ので、Shadow DOM の中で上書きする。
// 高さを枠いっぱいにし、幅は作品の aspect-ratio に任せる。
const INLINE_CSS =
  'html,body{height:100%;background:transparent}body{min-height:0;overflow:hidden}' +
  '#ld-host{display:grid;height:100%;place-items:center}';
// 全画面の形（WALL001）。作品の入れ物を枠の高さいっぱいにし、作品はその高さに合わせて描く（高さ 100% の根が画面いっぱいになる）。
const FILL_CSS = 'html,body{height:100%;overflow:hidden}body{min-height:0}#ld-host{height:100%}';

const INLINE_ROOT_CSS =
  '[data-ld-part]{width:auto!important;height:100vh!important;max-width:100vw!important;margin:0!important}';

/**
 * ヘッダーのスイッチと親のやりとり（docs/tasks/T035.md「3」と「11/11 9:10 の CTO の答え」の1）。作品の JS ではなく、Ludion のスクリプト。
 * - スイッチが押された（click。Enter と Space で押したときも click が来る）ら、すぐに親へ { type: 'ld-switch-press' } を送る。
 *   作品の aria-checked は、つまみが渡りきってから変わる（toggle-* では約1秒）ので、それを待たずにサイトの色を変えるため。
 *   ドラッグの後の click は送らない（作品もドラッグの後の click を捨てる。ドラッグでどちらの側に止まるかは、aria-checked で知る）。
 * - 作品の [role="switch"] の aria-checked が変わったら、親へ { type: 'ld-switch', checked } を送る。親は、自分のモードと違うときだけ合わせる。
 * - ドラッグを離してから SETTLE_MS 後にも、今の aria-checked を { type: 'ld-switch', checked } で送る。
 *   押した後、渡りきる前につかんで元の側へ戻すと、aria-checked は変わらないまま、親だけが逆になっているため。
 * - 親から { type: 'ld-switch-set', checked } が来たら、スイッチが向かっている側（aim）と違うときだけ、1回押す（作品の動きで変わる）。
 *   aim は、押すたびに逆にし、aria-checked が変わったらその値にする。渡っている途中で親が同じ側を言っても、押し戻さない。
 *   この押したことは、親へ press として送らない（送ると行ったり来たりの元になる）。
 * 受け取るのは、親の窓からで、形が合うものだけ。
 */
/** ドラッグを離してから、つまみが止まるまで待つ時間（toggle-* は離してから1秒かからずに止まる） */
const SETTLE_MS = 1500;
const SWITCH_SCRIPT =
  `(()=>{const h=document.getElementById('${HOST_ID}');` +
  `const s=h&&h.shadowRoot&&h.shadowRoot.querySelector('[role="switch"]');if(!s)return;` +
  `const on=()=>s.getAttribute('aria-checked')==='true';let last=on(),aim=last,self=false,x0=null,moved=false,skipUntil=0,settle;` +
  `const tell=(c)=>parent.postMessage({type:'ld-switch',checked:c},'*');` +
  `const end=()=>{if(moved){skipUntil=performance.now()+300;clearTimeout(settle);settle=setTimeout(()=>{aim=on();tell(aim)},${SETTLE_MS})}x0=null;moved=false};` +
  `s.addEventListener('pointerdown',(e)=>{x0=e.clientX;moved=false;clearTimeout(settle)},true);` +
  `s.addEventListener('pointermove',(e)=>{if(x0!==null&&Math.abs(e.clientX-x0)>3)moved=true},true);` +
  `for(const t of ['pointerup','pointercancel','lostpointercapture'])s.addEventListener(t,end,true);` +
  `s.addEventListener('click',()=>{if(self||performance.now()<skipUntil)return;clearTimeout(settle);aim=!aim;` +
  `parent.postMessage({type:'ld-switch-press'},'*')},true);` +
  `new MutationObserver(()=>{const c=on();if(c===last)return;last=c;aim=c;tell(c)})` +
  `.observe(s,{attributes:true,attributeFilter:['aria-checked']});` +
  `addEventListener('message',(e)=>{const d=e.data;` +
  `if(e.source!==parent||!d||typeof d!=='object'||d.type!=='ld-switch-set'||typeof d.checked!=='boolean')return;` +
  `if(aim!==d.checked){aim=d.checked;self=true;try{s.click()}finally{self=false}}})})();`;

/**
 * ヘッダーの枠では、作品が自分で敷く「ページの地」も消す（地を透明に。docs/tasks/T035.md「3」）。
 * 目印は、画面に固定（position: fixed）で、作品の後ろ（z-index が負）に敷いたもの。要素と ::before、::after を見る。
 * 作品の JS が作るものも消すため、load で動かす（LOADED_SCRIPT の知らせと同じ時。親はその知らせが来るまで枠を見せない）。
 */
const GROUND_SCRIPT =
  `addEventListener('load',()=>{const h=document.getElementById('${HOST_ID}');const r=h&&h.shadowRoot;if(!r)return;` +
  `const ground=(c)=>c.position==='fixed'&&parseInt(c.zIndex,10)<0;const rules=[];` +
  `for(const e of r.querySelectorAll('*')){if(ground(getComputedStyle(e)))e.style.setProperty('display','none','important');` +
  `for(const p of ['::before','::after'])if(ground(getComputedStyle(e,p))){e.setAttribute('data-ld-ground','');rules.push('[data-ld-ground]'+p+'{display:none!important}')}}` +
  `if(rules.length){const st=document.createElement('style');st.textContent=rules.join('');r.append(st)}});`;

// ページの地を、作品の根の --_bg（作者の値、または配色の値）にする。
const BACKGROUND_SCRIPT =
  `(()=>{const h=document.getElementById('${HOST_ID}');` +
  `const r=h&&h.shadowRoot&&h.shadowRoot.querySelector('[data-ld-part]');` +
  `if(!r){h&&h.setAttribute('data-ld-error','no-root');return}` +
  `const bg=getComputedStyle(r).getPropertyValue('--_bg').trim();` +
  `if(bg)document.documentElement.style.backgroundColor=bg})();`;

/**
 * 枠が実際に見えている細かさ（PREVIEW-DPR）。親が iframe の src の # に `ldpr=<値>` で付ける（apps/web/src/lib/frame.ts の withFrameDpr）。
 * 作品のページのプレビューは、枠を 1280×800 などで描いて CSS の scale で縮めるので、作品が devicePixelRatio のまま描くと、
 * 見えない細かさまで描いて重い（DPR 3 の端末で 4K 近く）。そこで、作品の JS より先に、window.devicePixelRatio をその値に置き換える。
 * 上限は実際の DPR（大きくはしない）。値が読めないとき、0 以下のときは、何もしない。作品のファイルは変えない。
 * # は Worker に届かないので、枠の応答（CSP、キャッシュ）は変わらない。# のない枠（ld preview、ld check、全画面の住所）では何もしない。
 */
export const DPR_HASH_KEY = 'ldpr';
export const DPR_SCRIPT =
  `(()=>{const m=/[#&]${DPR_HASH_KEY}=(\\d+(?:\\.\\d+)?)(?=&|$)/.exec(location.hash);if(!m)return;` +
  `const v=Number(m[1]),real=window.devicePixelRatio;if(!(v>0)||!(v<real))return;` +
  `Object.defineProperty(window,'devicePixelRatio',{get:()=>v,set(){},enumerable:true,configurable:false})})();`;

// この文書の load を親に知らせる（apps/web/src/frameGuard.ts）。読み込みの途中に枠が移ると、知らせが来ないので、親が読み直す。
// 作品の JS より先に仕掛ける。
export const LOADED_SCRIPT = `addEventListener('load',()=>parent.postMessage('ld-frame-loaded','*'));`;

function mountScript(js: string): string {
  // 作品のコードと同じモジュールの中で mount を呼ぶ。名前がぶつからないよう、こちらの名前は __ld で始める。
  return (
    `${escapeRawText(stripExports(js), 'script')}\n;{\n` +
    `const __ldHost=document.getElementById('${HOST_ID}');\n` +
    `const __ldRoot=__ldHost.shadowRoot.querySelector('[data-ld-part]');\n` +
    `try{const __ldCleanup=mount(__ldRoot);__ldHost.setAttribute('data-ld-mount',typeof __ldCleanup==='function'?'ok':'no-cleanup')}\n` +
    `catch(__ldError){__ldHost.setAttribute('data-ld-mount','error');throw __ldError}\n}`
  );
}

/**
 * 作者の背景の色（根の --_bg の既定値）を part.css から読む。プレビューの枠の地に使う。
 * 親のページの style に入るので、色として読める形だけを返す（url() や var() は返さない）。
 */
export function authorBackground(css: string): string | null {
  const declared = /--_bg\s*:\s*([^;}]+)/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1].trim();
  if (!declared) return null;
  const value = /^var\(\s*--ld-bg\s*,([\s\S]*)\)$/.exec(declared)?.[1].trim() ?? declared;
  if (!/^[#a-zA-Z0-9%.,/()\s-]+$/.test(value) || /url|var|expression/i.test(value)) return null;
  return value;
}

export function buildFrameHtml(work: Work, options: FrameOptions): string {
  const { meta } = work;
  const palette = options.palette;
  const hostStyle = palette === 'author' ? '' : ` style="${escapeHtml(tokenDeclarations(NEUTRAL_PALETTES[palette]))}"`;
  const hasJs = typeof work.js === 'string' && work.js.trim() !== '';
  const width = options.width ? ` data-ld-width="${Math.round(options.width)}"` : '';
  const inline = options.placement === 'inline';
  const css = (options.motion ? allowMotionCss(work.css) : work.css) + (inline ? `\n${INLINE_ROOT_CSS}` : '');
  const fill = options.placement === 'fill' ? FILL_CSS : '';
  const outerCss = inline ? BASE_CSS + INLINE_CSS : `${BASE_CSS}${fill}${meta.type === 'component' && options.placement !== 'top' ? COMPONENT_CSS : ''}`;

  return [
    '<!doctype html>',
    `<html lang="en" data-ld-palette="${palette}"${width}>`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(meta.title)}</title>`,
    `<style>${outerCss}</style>`,
    // 最初の Ludion のスクリプト。作品の JS より先に、WebRTC を使えなくし、入れ子の枠を作れなくする（guard.ts）
    `<script>${FRAME_GUARD_SCRIPT}</script>`,
    // 次に、投げる storage と cookie をメモリだけの代わりにする（storage.ts）。
    // 別の <script> にして、万一ここで止まっても、次の知らせ（LOADED_SCRIPT）は仕掛ける
    `<script>${STORAGE_SCRIPT}</script>`,
    // 作品の JS が devicePixelRatio を読む前に、見えている細かさに置き換える
    `<script>${DPR_SCRIPT}${LOADED_SCRIPT}</script>`,
    options.motion ? `<script>${ALLOW_MOTION_SCRIPT}</script>` : '',
    '</head>',
    '<body>',
    `<div id="${HOST_ID}" data-ld-id="${escapeHtml(meta.id)}" data-ld-type="${meta.type}"${hasJs ? '' : ' data-ld-mount="none"'}${hostStyle}>` +
      `<template shadowrootmode="open"><style>${escapeRawText(css, 'style')}</style>${work.html}</template></div>`,
    inline ? `<script>${SWITCH_SCRIPT}${GROUND_SCRIPT}</script>` : `<script>${BACKGROUND_SCRIPT}</script>`,
    hasJs ? `<script type="module">\n${mountScript(work.js as string)}\n</script>` : '',
    '</body>',
    '</html>',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}
