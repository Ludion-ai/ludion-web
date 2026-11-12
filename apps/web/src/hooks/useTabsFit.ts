import { useLayoutEffect, useRef, useState } from 'react';

/** いちばん詰めた段 */
export const MAX_FIT_LEVEL = 4;

/**
 * タブの列が横に入りきらないとき、入るまで1段ずつ詰める（WS004。英語の「Settings」が切れていた）。
 * 列の幅は、画面の幅だけでなく左のナビの開き閉じと言葉で変わるので、幅の決まり（メディアクエリ）ではなく、実際に入るかで決める。
 * 段：0 そのまま、1 印を出さない、2 タブの左右の余白を詰める、3 最後のタブ（設定）を印だけにする（名前は読み上げに残す）、4 文字を一回り小さく。
 * Worker の HTML と載せる最初の描画は 0（同じ形）。載せた後に測って詰める。幅が変わったら 0 から測り直す。
 */
export function useTabsFit<T extends HTMLElement>(key: unknown) {
  const ref = useRef<T>(null);
  const [level, setLevel] = useState(0);

  // 入りきらなければ1段詰める。描き直した後に、もう一度ここで測る（入るか、いちばん詰めた段まで）
  useLayoutEffect(() => {
    const list = ref.current;
    if (list && level < MAX_FIT_LEVEL && list.scrollWidth > list.clientWidth + 1) setLevel(level + 1);
  }, [level, key]);

  // 幅が変わったら、0 から測り直す
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    let width = list.clientWidth;
    const observer = new ResizeObserver(() => {
      if (list.clientWidth === width) return;
      width = list.clientWidth;
      setLevel(0);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  return { ref, level };
}
