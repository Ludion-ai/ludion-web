import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCopy } from '../hooks/useCopy';
import {
  AUTO_LOAD_WAIT_MS,
  AUTO_READY_WAIT_MS,
  AUTO_RESULT_WAIT_MS,
  AUTO_SETTLE_MS,
  autoShot,
  canAutoCapture,
  haltTurns,
  isSkipped,
  rememberSkip,
  requestTurn,
  sendAutoThumb,
} from '../lib/autoThumb';
import { FRAME_SIZES } from '../lib/frame';
import { CAPTURE_READY, CAPTURE_REQUEST, CAPTURE_RESULT } from '../lib/post';
import { SANDBOX } from './FramePreview';

/**
 * idle：番を待っている（見えていないときは待たない）。running：枠を置いて撮っている。done：付いた（一覧が読み直されるまで、撮った絵を出す）。
 * stopped：この版は撮らない（前に撮れなかった、今回撮れなかった）。
 */
type Phase = 'idle' | 'running' | 'done' | 'stopped';

/** 見えている割合がこれより多いときだけ撮る（作品は、見えていないと描画を止める。CLAUDE.md「動きの決まり」）。 */
const VISIBLE_RATIO = 0.6;

/**
 * サムネイルを自動で撮る（THUMB001）。「自分の作品」の、画像のない自分だけの作品の、サムネイルの場所に置く。
 * 行が見えていて、タブが表に出ているときに、1つずつ：持ち主の下書きの枠（?capture=1）を 1280×800 で置き（場所に合わせて縮めて見せる）、
 * 撮る仕掛けの「ある」の知らせ → 少し待つ → 絵を頼む → 確かめる → 今の版に画像がないときだけ足す口に送る。
 * 撮れないとき（白紙、canvas が写らない、Shadow DOM の中がある、枠が自分で移った）は、頭文字のままにして、その版はもう試さない。
 * WebKit では撮らない（lib/autoThumb.ts の canAutoCapture）。
 * 人が自分で付ける道（「画像を付ける」）は、そのまま残る。
 * 枠から届く知らせは作品の JS も作れるので、送り元（この枠）と形と大きさを確かめ、絵はサーバーがもう一度全部を読み直す。
 */
export function AutoThumb({ workId, revisionId, title, onDone, children }: { workId: string; revisionId: string; title: string; onDone: () => void; children: ReactNode }) {
  const copy = useCopy();
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  /** 絵を頼んだ後は、見えなくなってもやめない */
  const askedRef = useRef(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [phase, setPhase] = useState<Phase>(() => (!canAutoCapture() || isSkipped(revisionId) ? 'stopped' : 'idle'));
  const [watching, setWatching] = useState(false);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [shot, setShot] = useState<string | null>(null);
  /** 撮らなかった理由（確かめと調べもののための印。画面には出さない） */
  const whyRef = useRef(phase !== 'stopped' ? '' : canAutoCapture() ? 'remembered' : 'browser');

  /** 番を返して、次の段階へ（撮り終えた、やめた） */
  const leave = useCallback((next: Phase) => {
    releaseRef.current?.();
    releaseRef.current = null;
    setPhase(next);
  }, []);
  // 行が消えたら、番を返す
  useEffect(() => () => releaseRef.current?.(), []);

  // 場所の大きさに合わせて、枠を縮めて見せる（中身は 1280×800 のまま。場所をおおう大きさにして、中央に置く）
  useLayoutEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const fit = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(box.width / FRAME_SIZES.desktop.width, box.height / FRAME_SIZES.desktop.height);

  // 行が見えていて、タブが表に出ているか
  useEffect(() => {
    const element = boxRef.current;
    if (!element || typeof IntersectionObserver !== 'function') return;
    let inView = false;
    const update = () => setWatching(inView && document.visibilityState === 'visible');
    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO);
        update();
      },
      { threshold: [0, VISIBLE_RATIO, 1] },
    );
    observer.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  // 番を待つ。見えなくなったら、待つのをやめる
  useEffect(() => {
    if (phase !== 'idle' || !watching) return;
    const release = requestTurn(() => {
      releaseRef.current = release;
      askedRef.current = false;
      setPhase('running');
    });
    return () => {
      if (releaseRef.current !== release) release();
    };
  }, [phase, watching]);

  // 撮っている途中で見えなくなったら、やめて番を返す（絵を頼む前だけ）。見えたら、また番を待つ
  useEffect(() => {
    if (phase === 'running' && !watching && !askedRef.current) leave('idle');
  }, [phase, watching, leave]);

  // 撮る
  useEffect(() => {
    if (phase !== 'running') return;
    const frame = frameRef.current;
    let alive = true;
    let loads = 0;
    let ready = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const wait = (ms: number, run: () => void) => timers.push(setTimeout(() => alive && run(), ms));
    const clear = () => {
      for (const timer of timers.splice(0)) clearTimeout(timer);
    };
    const stop = (remember: boolean, why: string) => {
      if (!alive) return;
      whyRef.current = why;
      if (remember) rememberSkip(revisionId);
      leave('stopped');
    };

    const onLoad = () => {
      loads += 1;
      // 2回目の load は、枠が自分で移った印。撮らない
      if (loads > 1) {
        stop(true, 'moved');
        return;
      }
      if (!ready) wait(AUTO_READY_WAIT_MS, () => !ready && stop(true, 'unavailable'));
    };
    const onMessage = (event: MessageEvent) => {
      // 送り元がこの枠で（sandbox の枠のオリジンは null）、形が合うものだけ
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
      const data = event.data as { type?: unknown; ok?: unknown; url?: unknown; reason?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === CAPTURE_READY && !ready) {
        ready = true;
        clear();
        wait(AUTO_SETTLE_MS, () => {
          askedRef.current = true;
          wait(AUTO_RESULT_WAIT_MS, () => stop(true, 'timeout'));
          frame.contentWindow?.postMessage({ type: CAPTURE_REQUEST, strict: true, fit: true }, '*');
        });
        return;
      }
      if (data.type !== CAPTURE_RESULT || !askedRef.current) return;
      clear();
      window.removeEventListener('message', onMessage);
      if (data.ok !== true) {
        stop(true, typeof data.reason === 'string' && /^[a-z]{1,16}$/.test(data.reason) ? data.reason : 'error');
        return;
      }
      void (async () => {
        const blob = await autoShot(data.url);
        if (!alive) return;
        if (!blob) {
          stop(true, 'picture');
          return;
        }
        const answer = await sendAutoThumb(workId, blob);
        if (!alive) return;
        if (answer === 'ok') {
          setShot(URL.createObjectURL(blob));
          leave('done');
          doneRef.current();
          return;
        }
        if (answer === 'halt') haltTurns();
        stop(answer === 'skip', answer);
      })();
    };

    window.addEventListener('message', onMessage);
    frame?.addEventListener('load', onLoad);
    wait(AUTO_LOAD_WAIT_MS, () => !ready && stop(false, 'load'));
    return () => {
      alive = false;
      clear();
      window.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', onLoad);
    };
  }, [phase, revisionId, workId, leave]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot);
    },
    [shot],
  );

  return (
    <div ref={boxRef} data-auto-thumb={phase} data-auto-thumb-why={phase === 'stopped' ? whyRef.current : undefined} className="relative flex w-full sm:w-40 sm:shrink-0">
      {children}
      {phase === 'running' && scale > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-control border border-site-line bg-site-field">
          <iframe
            ref={frameRef}
            data-auto-thumb-frame=""
            title={copy.account.works.capture.frameTitle(title)}
            tabIndex={-1}
            sandbox={SANDBOX}
            // 撮る絵は見えている細かさに下げない（# の ldpr を付けない）。枠の中の絵は 1280×800 のまま
            src={`/draft-frame/${revisionId}/desktop.html?capture=1`}
            className="absolute h-[800px] w-[1280px] max-w-none origin-top-left border-0"
            style={{ left: (box.width - FRAME_SIZES.desktop.width * scale) / 2, top: (box.height - FRAME_SIZES.desktop.height * scale) / 2, transform: `scale(${scale})` }}
          />
        </div>
      )}
      {shot && <img data-auto-thumb-shot="" src={shot} alt="" className="absolute inset-0 size-full rounded-control border border-site-line bg-site-field object-cover" />}
    </div>
  );
}
