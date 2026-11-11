import { useEffect, useRef, useState } from 'react';
import type { HandleStatus } from '../lib/account';

const HANDLE_DEBOUNCE_MS = 300;

export type HandleCheck = HandleStatus | 'idle' | 'checking' | 'error';

/** 打っている handle を、少し待ってから確かめる（docs/tasks/T020.md「2」）。current と同じなら確かめない。 */
export function useHandleCheck(value: string, current: string, check: (handle: string) => Promise<HandleStatus>): HandleCheck {
  const [status, setStatus] = useState<HandleCheck>('idle');
  /** いちばん新しい確かめの番号。古い答えで上書きしない */
  const latest = useRef(0);

  useEffect(() => {
    const wanted = value.toLowerCase();
    latest.current += 1;
    const asked = latest.current;
    if (wanted === current) {
      setStatus('idle');
      return;
    }
    setStatus('checking');
    const timer = setTimeout(() => {
      check(wanted).then(
        (answer) => {
          if (latest.current === asked) setStatus(answer);
        },
        () => {
          if (latest.current === asked) setStatus('error');
        },
      );
    }, HANDLE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, current, check]);

  return status;
}
