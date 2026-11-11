import { useSyncExternalStore } from 'react';

/**
 * 「動きを見る」を選んだことを、その端末に覚える（docs/tasks/FIX-motion.md「1」）。
 * localStorage が使えない端末でも、開いている間は選んだとおりに動く。
 */
const STORAGE_KEY = 'ld-show-motion';

let choice: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (choice === null) {
    try {
      choice = window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      choice = false;
    }
  }
  return choice;
}

export function setShowMotion(next: boolean) {
  choice = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 覚えられないだけで、今の画面では効く
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Worker の描画と、その上に載せる最初の描画では false。枠の URL をサーバーの HTML と揃えるため。 */
export function useShowMotion(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
