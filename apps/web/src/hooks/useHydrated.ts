import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * Worker の HTML の上に載せ終えたか。載せる最初の描画では false（Worker の描画と同じ形で載せる）、その直後から true。
 * URL の # の後ろ（行の住所の #L204）のように、Worker から見えない物で描き分けるときに使う。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}
