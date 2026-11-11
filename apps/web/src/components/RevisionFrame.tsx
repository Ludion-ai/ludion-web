import { Monitor, Smartphone } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { frameScale, startFrame, type FrameSize } from '../lib/frame';
import type { FrameUrls } from '../lib/post';
import { chipClass } from './chip';
import { BOX_CLASS, FRAME_CLASS, SANDBOX } from './FramePreview';

/**
 * 公開前の版を、公開の枠と同じ守りで動かす（docs/tasks/T021.md「下書きの見え方」、CLAUDE.md「描画」）。
 * 作品の JS を2つ動かさないよう、選んだ幅の iframe だけを作る。枠が自分で移ったら frameGuard.ts が読み直す（Worker がページに入れる）。
 * stamp：中身が変わったら枠を作り直すための印。URL に付けるだけで、Worker は読まない。
 */
export function RevisionFrame({ frames, title, stamp, initial = 'desktop' }: { frames: FrameUrls; title: string; stamp: string; initial?: FrameSize }) {
  const copy = useCopy();
  const [size, setSize] = useState<FrameSize>(initial);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => box.style.setProperty('--frame-scale', String(frameScale(size, box.clientWidth)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [size]);

  // 見えている細かさを付けた URL で読み始める（PREVIEW-DPR。lib/frame.ts の startFrame）
  const frameKey = `${size}-${stamp}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (frame && box) startFrame(frame, frameScale(size, box.clientWidth));
  }, [frameKey]);

  const choices = [
    { size: 'desktop', label: copy.work.desktop, icon: Monitor },
    { size: 'mobile', label: copy.work.mobile, icon: Smartphone },
  ] as const;

  return (
    <div>
      <div role="group" aria-label={copy.work.previewSize} className="mb-3 flex gap-[13px]">
        {choices.map(({ size: choice, label, icon: Icon }) => (
          <button key={choice} type="button" aria-pressed={size === choice} onClick={() => setSize(choice)} className={chipClass(size === choice)}>
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={size === choice ? undefined : 'text-site-fg-3'} />
            {label}
          </button>
        ))}
      </div>
      <div className="@container">
        <div ref={boxRef} data-frame-size={size} className={`relative overflow-hidden rounded-card border border-site-line ${BOX_CLASS[size]}`}>
          <iframe
            key={frameKey}
            ref={frameRef}
            data-ld-frame=""
            title={copy.work.frameTitle(title)}
            sandbox={SANDBOX}
            data-src={`${frames[size]}?h=${encodeURIComponent(stamp)}`}
            suppressHydrationWarning
            className={FRAME_CLASS[size]}
          />
        </div>
      </div>
    </div>
  );
}
