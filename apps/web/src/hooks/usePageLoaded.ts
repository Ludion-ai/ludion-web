import { useSyncExternalStore } from 'react';

/** 先頭8枚のどれかの通信が止まっても、残りのサムネイルが出ないままにならないようにする。 */
const MAX_WAIT_MS = 5000;

let timedOut = false;

function subscribe(onChange: () => void): () => void {
  const timer = setTimeout(() => {
    timedOut = true;
    onChange();
  }, MAX_WAIT_MS);
  window.addEventListener('load', onChange);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('load', onChange);
  };
}

/** ページの load が終わったか。Worker の描画と、その上に載せる最初の描画では、まだ終わっていない扱い。 */
export function usePageLoaded(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => timedOut || document.readyState === 'complete',
    () => false,
  );
}
