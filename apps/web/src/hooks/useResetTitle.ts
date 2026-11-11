import { useEffect } from 'react';
import { copy } from '../copy';

/** Worker が入れたページの題名は、読み込み直さずにホームへ移ると残ってしまうので、ページを離れるときに戻す。 */
export function useResetTitle(): void {
  useEffect(
    () => () => {
      document.title = copy.brand;
    },
    [],
  );
}
