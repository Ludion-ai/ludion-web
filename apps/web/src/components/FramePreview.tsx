import { Monitor, RotateCcw, Smartphone } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Copy } from '../copy';
import { useCopy } from '../hooks/useCopy';
import type { Work } from '../data/works';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { WallStill } from '../data/pages';
import { COVER_FADE_MS, COVER_MS, FRAME_SIZES, frameScale, frameStartedAt, frameUrl, startFrame, type FrameSize } from '../lib/frame';
import { isWallpaper } from '../lib/homeQuery';
import { setShowMotion, useShowMotion } from '../lib/motionChoice';
import { webglAvailable } from '../lib/webgl';
import { chipClass } from './chip';

/** 枠の sandbox（CLAUDE.md「描画」）。allow-same-origin は付けない。packages/render の FRAME_SANDBOX と同じ値 */
export const SANDBOX = 'allow-scripts allow-forms';

const sizeChoices = (copy: Copy) => [
  { size: 'desktop', label: copy.work.desktop, icon: Monitor },
  { size: 'mobile', label: copy.work.mobile, icon: Smartphone },
] as const;

export const BOX_CLASS = {
  // 部品：枠の幅のままの iframe の中央に置く（置くのは buildFrameHtml）
  component: 'aspect-[4/3] min-h-[420px] w-full',
  desktop: 'aspect-[1280/800]',
  // 幅が390に足りないときは、枠の高さも同じ割合で縮める
  mobile: 'h-[min(844px,calc(100cqw*844/390))]',
};

export const FRAME_CLASS = {
  component: 'absolute inset-0 size-full',
  desktop: 'absolute top-0 left-0 h-[800px] w-[1280px] origin-top-left [transform:scale(var(--frame-scale,1))]',
  mobile: 'absolute top-0 left-1/2 h-[844px] w-[390px] origin-top [transform:translateX(-50%)_scale(var(--frame-scale,1))]',
};

const NOTICE_CLASS = 'mb-3 rounded-control bg-site-field px-3 py-2.5 text-small text-site-fg-2';

/**
 * 「動きを減らす」設定の端末で、動きが止まっている理由と、動きを見るボタンを出す（docs/tasks/FIX-motion.md「1」）。
 * 出す出さないは CSS で決める。Worker の HTML に入れておけば、その端末でも読み込みの後に枠がずれない。
 */
function MotionNotice({ shown }: { shown: boolean }) {
  const copy = useCopy();
  return (
    <div data-motion-notice="" className={`${NOTICE_CLASS} hidden flex-wrap items-center justify-between gap-x-3 gap-y-2 motion-reduce:flex`}>
      <p role="status">{shown ? copy.work.motionShown : copy.work.motionStopped}</p>
      <button
        type="button"
        onClick={() => setShowMotion(!shown)}
        className="inline-flex h-chip shrink-0 items-center rounded-chip border border-site-line-2 bg-site-bg px-4 text-small font-semibold text-site-fg hover:bg-site-hover"
      >
        {shown ? copy.work.motionStop : copy.work.motionShow}
      </button>
    </div>
  );
}

/**
 * 作品のプレビュー。作品はこの iframe の中でだけ動く。枠から親へ来るのは「読み込めた」の知らせだけ（frameGuard.ts）。
 * 親から枠の中は見えないので、地の色は Worker が part.css から読んで渡す。
 * 枠が自分で移ったときに読み直すのは src/frameGuard.ts（data-ld-frame を目印にする）。
 */
export function FramePreview({
  work,
  background,
  frames = null,
  stills = [],
}: {
  work: Work;
  background: string | null;
  frames?: { desktop: string; mobile: string } | null;
  /** 壁紙の静止画（WALL002）。大きい順 */
  stills?: WallStill[];
}) {
  const copy = useCopy();
  const isComponent = work.type === 'component';
  const webScreen = !isComponent && work.platform !== 'mobile';
  const [size, setSize] = useState<FrameSize>(webScreen ? 'desktop' : 'mobile');
  /** 「もう一度」のたびに iframe を作り直す（sandbox の中身は親から読み直せない） */
  const [replays, setReplays] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const shape = isComponent ? 'component' : size;
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)', false);
  const showMotion = useShowMotion();
  // 「減らす」設定でない端末では、選んだことが残っていても、ふつうの枠を読む
  const motion = reducedMotion && showMotion;
  const [noWebgl, setNoWebgl] = useState(false);

  // どの作品が WebGL を使うかは持っていないので、全部の作品のページで出す。読み込みの後に確かめる（重いので、最初の描画を止めない）
  useEffect(() => setNoWebgl(!webglAvailable()), []);

  // 倍率は beforeApp が先に決めている。ここから先は、幅が変わったときに React が受け持つ
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || isComponent) return;
    const fit = () => box.style.setProperty('--frame-scale', String(frameScale(size, box.clientWidth)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [size, isComponent]);

  // 枠を、見えている細かさを付けた URL で読み始める（PREVIEW-DPR）。Worker が描いた枠は beforeApp が先に入れている
  const frameKey = `${size}-${replays}-${motion}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (frame && box) startFrame(frame, isComponent ? 1 : frameScale(size, box.clientWidth));
  }, [frameKey, isComponent]);

  // 壁紙の作品：絵を組み立てる途中が見えないよう、枠を読み始めてから COVER_MS の間、静止画（WALL002）を重ねる（CEO の指示、11/11）。
  // 枠を作り直すたび（もう一度、幅の切り替え）に、また重ねる。静止画がない壁紙（投稿の作品、自分だけの作品）では重ねない
  const cover = !isComponent && isWallpaper(work) && stills.length > 0 ? stills : null;
  const [covered, setCovered] = useState(true);
  useLayoutEffect(() => {
    if (!cover) return;
    setCovered(true);
    const frame = frameRef.current;
    const wait = window.matchMedia('(pointer: coarse)').matches ? COVER_MS.coarse : COVER_MS.fine;
    // Worker が描いた枠は、ページを開いたとき（beforeApp）から数える
    const started = (frame && frameStartedAt(frame)) ?? performance.now();
    const timer = setTimeout(() => setCovered(false), Math.max(0, wait - (performance.now() - started)));
    return () => clearTimeout(timer);
  }, [frameKey, cover !== null]);

  return (
    <div>
      {webScreen && (
        <div role="group" aria-label={copy.work.previewSize} className="mb-3 flex gap-[13px]">
          {sizeChoices(copy).map(({ size: choice, label, icon: Icon }) => (
            <button
              key={choice}
              type="button"
              aria-pressed={size === choice}
              onClick={() => setSize(choice)}
              className={chipClass(size === choice)}
            >
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" className={size === choice ? undefined : 'text-site-fg-3'} />
              {label}
            </button>
          ))}
        </div>
      )}
      <MotionNotice shown={motion} />
      {noWebgl && (
        <p data-webgl-notice="" role="status" className={NOTICE_CLASS}>
          {copy.work.noWebgl}
        </p>
      )}
      {/* 枠の高さを枠の幅から決めるための入れ物（cqw） */}
      <div className="@container">
        <div
          ref={boxRef}
          data-frame-size={isComponent ? undefined : size}
          style={background ? { backgroundColor: background } : undefined}
          className={`relative overflow-hidden rounded-card border border-site-line ${BOX_CLASS[shape]}`}
        >
          <iframe
            key={frameKey}
            ref={frameRef}
            data-ld-frame=""
            title={copy.work.frameTitle(work.title)}
            sandbox={SANDBOX}
            // src は startFrame が入れる（# に見えている細かさを付ける。PREVIEW-DPR）。Worker が描いた枠には beforeApp が React より先に入れる
            // 自分だけの作品は下書きの枠（持ち主だけに返す。docs/tasks/T036.md「2」）。守りは公開の枠と同じ
            data-src={frames ? `${frames[isComponent ? 'desktop' : size]}${motion ? '?motion=1' : ''}` : frameUrl(work, isComponent ? 'desktop' : size, motion)}
            suppressHydrationWarning
            className={FRAME_CLASS[shape]}
          />
          {cover && (
            // 枠と同じ大きさと置き方で、枠の上に重ねる。大きさは、見えている幅 × DPR に合うものをブラウザが選ぶ（srcset）。
            // Worker の HTML に入るので、最初の描画から出る。消えた後も外さない（もう一度で、読み直さずにすぐ出すため）
            <img
              data-wall-cover=""
              alt=""
              aria-hidden="true"
              decoding="async"
              src={cover[cover.length - 1].url}
              srcSet={cover.map((still) => `${still.url} ${still.width}w`).join(', ')}
              sizes={shape === 'mobile' ? `${FRAME_SIZES.mobile.width}px` : '(min-width: 1024px) 65vw, 100vw'}
              style={{ opacity: covered ? 1 : 0, transition: covered ? 'none' : `opacity ${COVER_FADE_MS}ms ease-out` }}
              className={`${FRAME_CLASS[shape]} pointer-events-none object-cover`}
            />
          )}
          {work.tags.includes('motion') && (
            <button
              type="button"
              onClick={() => setReplays((count) => count + 1)}
              className="absolute right-3 bottom-3 inline-flex h-chip items-center gap-[9px] rounded-chip border border-site-line-2 bg-site-bg px-4 text-small font-semibold text-site-fg shadow-card hover:bg-site-hover"
            >
              <RotateCcw size={18} strokeWidth={1.75} aria-hidden="true" className="text-site-fg-3" />
              {copy.work.replay}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
