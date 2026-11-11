import { useMemo, useRef } from 'react';
import type { Work } from '../data/works';
import { useElementWidth } from '../hooks/useElementWidth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { usePageLoaded } from '../hooks/usePageLoaded';
import { gridShape, WIDE_QUERY } from '../lib/gridShape';
import { layoutMasonry } from '../lib/masonry';
import { WorkCard } from './WorkCard';

/**
 * カードは絶対配置。DOM は Popular の順のままなので、Tab の順も読み上げの順も左上から右へ進む。
 * CSS の columns は使わない（SPEC.md 6）。
 *
 * スマホでは本文の余白（24px）を打ち消して、左右の余白を 8px にする（SPEC.md 3）。
 *
 * 幅が分からない最初の描画（Worker の描画とその上に載せる描画）では位置を持たない。
 * Worker が描いた HTML では beforeApp が、同じ計算で先に位置を決めている。
 * data-placed は、React が位置を受け持ったしるし。
 */
export function Masonry({
  works,
  belowFold = false,
  onSelect,
}: {
  works: Work[];
  /** 最初の画面の外の並び（作品のページ）。先に読む画像を持たない（WorkCard） */
  belowFold?: boolean;
  /** カードを押したとき。ページを移る前に呼ぶ */
  onSelect?: (work: Work) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const wide = useMediaQuery(WIDE_QUERY, true);
  const pageLoaded = usePageLoaded();

  const placed = useMemo(() => {
    if (width <= 0) return null;
    const shape = gridShape(width, wide);
    return { columnWidth: shape.columnWidth, ...layoutMasonry(works, shape) };
  }, [works, width, wide]);

  return (
    <div
      ref={containerRef}
      data-masonry=""
      data-placed={placed ? '' : undefined}
      className="relative max-md:-mx-4"
      style={placed ? { height: placed.height } : undefined}
    >
      {works.map((work, index) => {
        const position = placed?.positions[index];
        return (
          <WorkCard
            key={work.id}
            work={work}
            index={index}
            pageLoaded={pageLoaded}
            belowFold={belowFold}
            onSelect={onSelect}
            style={position && { left: position.x, top: position.y, width: placed!.columnWidth }}
          />
        );
      })}
    </div>
  );
}
