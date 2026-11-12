import { Monitor, RotateCcw, Smartphone } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Copy } from '../copy';
import { useCopy } from '../hooks/useCopy';
import type { Work } from '../data/works';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { BOX_CLASS, FRAME_CLASS, fitFrameTop, frameScale, frameUrl, isPhone, PHONE_QUERY, previewScale, startFrame, type FrameSize } from '../lib/frame';
import { setShowMotion, useShowMotion } from '../lib/motionChoice';
import { webglAvailable } from '../lib/webgl';
import { chipClass } from './chip';

/** 枠の sandbox（CLAUDE.md「描画」）。allow-same-origin は付けない。packages/render の FRAME_SANDBOX と同じ値 */
export const SANDBOX = 'allow-scripts allow-forms';

const sizeChoices = (copy: Copy) => [
  { size: 'desktop', label: copy.work.desktop, icon: Monitor },
  { size: 'mobile', label: copy.work.mobile, icon: Smartphone },
] as const;

export { BOX_CLASS, FRAME_CLASS };

const watchPhone = (onChange: () => void) => {
  const list = window.matchMedia(PHONE_QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
};

/**
 * スマホか（lib/frame.ts の PHONE_QUERY）。Worker の描画では false。
 * 載せる最初の描画から本当の値を使う：スマホでは beforeApp が先に枠を Mobile に替えているので、同じ形で載る。
 * 後から値を替えると、枠を作り直して、作品を2回読み込むことになる。
 */
function usePhone(): boolean {
  return useSyncExternalStore(watchPhone, isPhone, isPhone);
}

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
 * その色は、枠の文書から「読み込めた」の知らせが来てから出す（frameGuard.ts の data-ld-loaded と index.css）。それまではページの地のまま。
 * 枠が自分で移ったときに読み直すのは src/frameGuard.ts（data-ld-frame を目印にする）。
 */
export function FramePreview({ work, background, frames = null }: { work: Work; background: string | null; frames?: { desktop: string; mobile: string } | null }) {
  const copy = useCopy();
  const isComponent = work.type === 'component';
  const webScreen = !isComponent && work.platform !== 'mobile';
  const [size, setSize] = useState<FrameSize>(webScreen ? 'desktop' : 'mobile');
  /** 「もう一度」のたびに iframe を作り直す（sandbox の中身は親から読み直せない） */
  const [replays, setReplays] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  // スマホでは Mobile だけ。切り替えは CSS で隠す（phone:hidden）。size は PC で選んだ幅のまま持つ
  const phone = usePhone();
  const shown: FrameSize = webScreen && phone ? 'mobile' : size;
  const shape = isComponent ? 'component' : shown;
  /** Worker の HTML と形が合わなかったときに、入れ物ごと作り直す回数 */
  const [repairs, setRepairs] = useState(0);
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
    const fit = () => box.style.setProperty('--frame-scale', String(frameScale(shown, box.clientWidth)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [shown, isComponent, repairs]);

  // 狭い画面の枠の高さは、枠の上の端の位置から決める（lib/frame.ts の fitFrameTop）。beforeApp が先に入れている。
  // ここでは、入れ物を作り直した後と、画面の向きや幅が変わった後に入れ直す
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => fitFrameTop(box);
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [repairs]);

  // 載せた時に、Worker の HTML（と beforeApp が替えた後）の枠が、ここで描く形と違っていたら、入れ物ごと作り直す。
  // React は、載せるときに違っていた属性を直さないため（例：beforeApp と載せる間に画面の幅が変わった）
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && !isComponent && box.dataset.frameSize !== shown) setRepairs((count) => count + 1);
    // 載せた時に1回だけ確かめる
  }, []);

  const srcOf = (frameSize: FrameSize) => (frames ? `${frames[frameSize]}${motion ? '?motion=1' : ''}` : frameUrl(work, frameSize, motion));

  // 枠を、見えている細かさを付けた URL で読み始める（PREVIEW-DPR）。Worker が描いた枠は beforeApp が先に入れている。
  // スマホの Mobile の枠は縮めずに描くので、割合は 1（previewScale）。入れ物ごと作り直した枠（repairs）にも入れる
  const frameKey = `${shown}-${replays}-${motion}`;
  const frameRef = useRef<HTMLIFrameElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const box = boxRef.current;
    if (frame && box) startFrame(frame, isComponent ? 1 : previewScale(shown, box.clientWidth, phone));
  }, [frameKey, isComponent, repairs]);

  return (
    <div>
      {webScreen && (
        <div role="group" aria-label={copy.work.previewSize} className="mb-3 flex gap-[13px] phone:hidden">
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
      <div key={repairs} className="@container">
        <div
          ref={boxRef}
          data-frame-box=""
          data-frame-size={isComponent ? undefined : shown}
          // スマホで beforeApp が読み始める Mobile の枠（Worker は Desktop で描く）
          data-phone-src={webScreen ? srcOf('mobile') : undefined}
          // 作者の地の色は、枠が読み込めてから出す（index.css の [data-frame-bg]）
          data-frame-bg={background ? '' : undefined}
          style={background ? ({ '--frame-bg': background } as CSSProperties) : undefined}
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
            data-src={srcOf(isComponent ? 'desktop' : shown)}
            suppressHydrationWarning
            className={FRAME_CLASS[shape]}
          />
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
