import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/** 描画の前に幅を測る。最初の描画からカードの位置が決まっているので、ずれが出ない。 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  const measure = useCallback(() => {
    if (ref.current) setWidth(ref.current.clientWidth);
  }, [ref]);

  useLayoutEffect(() => {
    measure();
    if (!ref.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [measure, ref]);

  return width;
}
