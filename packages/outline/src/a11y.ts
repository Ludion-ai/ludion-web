// キー操作と読み上げ（WS003）：役目、状態、名前、キー、フォーカスの枠、知らせ。コードに書いてある物だけを見つける。
// 見つからない物は出さない。「使える」とは言わない（書いてある所を見せるだけ）。

import type { TechId } from './collect.ts';

/** 状態と値を伝える属性（aria-checked、aria-selected、aria-valuetext など） */
const STATES = new Set(['checked', 'selected', 'pressed', 'expanded', 'current', 'disabled', 'invalid', 'busy', 'valuenow', 'valuemin', 'valuemax', 'valuetext']);
/** 名前を付ける属性 */
const NAMES = new Set(['label', 'labelledby']);

/** 属性の名前（小文字）が、どの印にあたるか。あたらなければ null */
export function ariaTech(name: string): TechId | null {
  if (name === 'role') return 'aria-role';
  if (!name.startsWith('aria-')) return null;
  const rest = name.slice(5);
  if (rest === 'live') return 'aria-live';
  if (STATES.has(rest)) return 'aria-state';
  if (NAMES.has(rest)) return 'aria-name';
  return null;
}

/** JS の書き方（el.ariaChecked = …）を属性の名前に戻す。ariaChecked → aria-checked。あたらなければ null */
export function reflectedAria(ident: string): string | null {
  if (!/^aria[A-Z][A-Za-z]*$/.test(ident)) return null;
  const name = `aria-${ident.slice(4).toLowerCase()}`;
  return ariaTech(name) ? name : null;
}

/** el.role = '…' を役目と見るのは、値が役目の名前のときだけ（user.role = 'admin' を数えない） */
export const ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'button', 'cell', 'checkbox', 'combobox', 'complementary', 'contentinfo', 'dialog', 'figure', 'form', 'grid', 'gridcell',
  'group', 'heading', 'img', 'link', 'list', 'listbox', 'listitem', 'log', 'main', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'meter', 'navigation', 'none',
  'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab',
  'table', 'tablist', 'tabpanel', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treeitem',
]);

/** 役目の値（空白で区切る。作り手の入れた文字なので、短い英字だけ） */
export function roleValues(value: string): string[] {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter((role) => /^[a-z]{1,30}$/.test(role));
}

/** keydown で見ているキーの名前（event.key と event.code）。見せる名前にそろえる */
const KEYS = new Map<string, string>([
  ['ArrowLeft', 'ArrowLeft'],
  ['ArrowRight', 'ArrowRight'],
  ['ArrowUp', 'ArrowUp'],
  ['ArrowDown', 'ArrowDown'],
  ['Home', 'Home'],
  ['End', 'End'],
  ['PageUp', 'PageUp'],
  ['PageDown', 'PageDown'],
  ['Enter', 'Enter'],
  ['NumpadEnter', 'Enter'],
  ['Escape', 'Escape'],
  ['Esc', 'Escape'],
  ['Tab', 'Tab'],
  ['Space', 'Space'],
  ['Spacebar', 'Space'],
  ['Backspace', 'Backspace'],
  ['Delete', 'Delete'],
]);
/** 文字列の値がキーの名前なら、見せる名前。' '（Space の event.key）は、相手が .key のときだけ呼ぶ側で認める */
export const keyName = (value: string): string | null => KEYS.get(value) ?? null;
/** { ArrowLeft: -1, ArrowRight: 1 } の形で認める名前（ほかの名前は、ふつうの鍵と区別できない） */
export const isArrowKey = (value: string) => value.startsWith('Arrow') && KEYS.has(value);

/** 文字列の中のマークアップ（innerHTML に入れる文字など）の、役目、状態、名前、知らせ。後戻りしない形 */
export const MARKUP_ATTR = /[\s"'](role|aria-[a-z]{2,20})\s*=\s*(?:"([^"<>]{0,80})"|'([^'<>]{0,80})')?/g;
export const MARKUP_LABEL = /<label[\s>]/g;
/** マークアップを探す文字列の長さの上限 */
export const MAX_MARKUP = 200_000;
