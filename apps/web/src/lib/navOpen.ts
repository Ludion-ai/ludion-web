/**
 * 左のナビの開いた形（幅 264px）とたたんだ形（68px）。WS001。
 * 最初の値は index.html のインラインのスクリプトが、最初の描画の前に <html data-nav="open"> に付ける（ld-nav-open）。
 * ここはその後を受け持つ。どちらも、その端末の localStorage にだけ覚える。サーバーには送らない。
 *
 * - ld-nav：本人が選んだ形（'open' か 'closed'）。選んでいなければ、ログインしていて作品がある人は開いた形。
 * - ld-nav-open：最後に決まった形が開いた形なら '1'。最初の描画の前に幅を決めるためだけに使う（ログインを待たずに、中身の幅を動かさない）。
 * 読めない端末では、開いている間だけ選んだとおりにする。
 */
import { useSyncExternalStore } from 'react';

const CHOICE_KEY = 'ld-nav';
const SHOWN_KEY = 'ld-nav-open';
const ATTRIBUTE = 'data-nav';

type Choice = 'open' | 'closed';

const listeners = new Set<() => void>();
let choiceInMemory: Choice | null = null;

function readChoice(): Choice | null {
  try {
    const value = localStorage.getItem(CHOICE_KEY);
    if (value === 'open' || value === 'closed') return value;
  } catch {
    // 読めなければ、開いている間に選んだもの
  }
  return choiceInMemory;
}

function remember(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 覚えられなくても、このページでは切り替える
  }
}

export function isNavOpen(): boolean {
  return document.documentElement.getAttribute(ATTRIBUTE) === 'open';
}

function applyNavOpen(open: boolean): void {
  remember(SHOWN_KEY, open ? '1' : null);
  if (isNavOpen() === open) return;
  if (open) document.documentElement.setAttribute(ATTRIBUTE, 'open');
  else document.documentElement.removeAttribute(ATTRIBUTE);
  for (const listener of listeners) listener();
}

/** 本人の答え（GET /api/me）が来たら決める。ログインしていない人は、いつもたたんだ形。 */
export function settleNav(loggedIn: boolean, worksCount: number): void {
  const choice = readChoice();
  applyNavOpen(loggedIn && (choice === 'open' || (choice !== 'closed' && worksCount > 0)));
}

/** 本人が「たたむ」「ひらく」を押した。 */
export function chooseNav(open: boolean): void {
  choiceInMemory = open ? 'open' : 'closed';
  remember(CHOICE_KEY, choiceInMemory);
  applyNavOpen(open);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Worker の描画と、その上に載せる最初の描画は、たたんだ形（HTML は人によって変えない）。 */
export function useNavOpen(): boolean {
  return useSyncExternalStore(subscribe, isNavOpen, () => false);
}
