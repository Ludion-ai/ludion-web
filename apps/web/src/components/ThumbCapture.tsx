import { X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { canAutoCapture } from '../lib/autoThumb';
import { BOX_CLASS, FRAME_CLASS, FRAME_SIZES, frameScale } from '../lib/frame';
import { CAPTURE_READY, CAPTURE_REQUEST, CAPTURE_RESULT, captureToBlob, normalizeThumb, uploadThumb } from '../lib/post';
import { SANDBOX } from './FramePreview';

const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';

/** 枠の load の後、撮る仕掛けの「ある」の知らせを待つ時間。来なければ、ファイルを選ぶ道だけを出す（契約の形の作品など）。 */
const READY_WAIT_MS = 2500;
/** 「この絵にする」を押してから、絵が届くまで待つ時間。 */
const RESULT_WAIT_MS = 20_000;
/** 撮った絵の大きさの許し（枠は 1280×800。CSS の px の丸めの分だけ） */
const SIZE_SLACK = 2;

type Phase = 'loading' | 'ready' | 'taking' | 'preview' | 'fallback' | 'sending';
type Fallback = 'unavailable' | 'shadow' | 'blank' | 'other';

interface Picked {
  blob: Blob;
  url: string;
}

/**
 * 「画像を付ける」（DOC002「3」）。自分だけの作品の枠を 1280×800 で見せ、「この絵にする」で枠の中から絵を撮る。撮った絵を見せて、よければ送る。
 * 撮れないとき（白紙、汚れた、Shadow DOM の中がある、撮る仕掛けがない）は、ファイルを選ぶ道を出す。
 * 枠は今の守りのまま（sandbox、親の CSP、見張り）。撮る仕掛けは、持ち主の下書きの枠に ?capture=1 を付けたときだけ Worker が差し込む。
 * 枠から届く知らせは作品の JS も作れるので、送り元（この枠）、形、大きさを確かめ、絵はサーバーがもう一度全部を読み直す。
 */
export function ThumbCapture({ workId, title, frameUrl, onDone, onClose }: { workId: string; title: string; frameUrl: string; onDone: () => void; onClose: () => void }) {
  const copy = useCopy();
  const text = copy.account.works.capture;
  const errors = copy.post.save.errors;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resultTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [phase, setPhase] = useState<Phase>('loading');
  // 知らせとタイマーは、今の段階を読んでから動く（React の更新を待たない）
  const phaseRef = useRef<Phase>('loading');
  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };
  const [fallback, setFallback] = useState<Fallback | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const headingId = useId();
  const fileId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
  }, []);

  // 枠を入れ物の幅に縮めて見せる（中身は 1280×800 のまま。作品のページのプレビューと同じ）
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => box.style.setProperty('--frame-scale', String(frameScale('desktop', box.clientWidth)));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    clearTimeout(readyTimer.current);
    clearTimeout(resultTimer.current);
  }, []);

  useEffect(() => () => {
    if (picked) URL.revokeObjectURL(picked.url);
  }, [picked]);

  const showFallback = (reason: Fallback) => {
    clearTimeout(resultTimer.current);
    setFallback(reason);
    go('fallback');
  };

  const show = async (source: Blob, onBad: () => void) => {
    const normalized = await normalizeThumb(source);
    if (!normalized) {
      onBad();
      return;
    }
    setPicked({ blob: normalized, url: URL.createObjectURL(normalized) });
    setMessage(null);
    go('preview');
  };

  // 枠からの知らせ。送り元がこの枠で（sandbox の枠のオリジンは null）、形が合うものだけ
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
      const data = event.data as { type?: unknown; ok?: unknown; url?: unknown; reason?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === CAPTURE_READY) {
        clearTimeout(readyTimer.current);
        if (phaseRef.current === 'loading') go('ready');
        return;
      }
      if (data.type !== CAPTURE_RESULT || phaseRef.current !== 'taking') return;
      clearTimeout(resultTimer.current);
      if (data.ok !== true) {
        showFallback(data.reason === 'shadow' || data.reason === 'blank' ? data.reason : 'other');
        return;
      }
      const blob = captureToBlob(data.url);
      if (!blob) {
        showFallback('other');
        return;
      }
      void (async () => {
        // 大きさを確かめる（枠と同じ 1280×800）
        const bitmap = await createImageBitmap(blob).catch(() => null);
        const fits = bitmap !== null && Math.abs(bitmap.width - FRAME_SIZES.desktop.width) <= SIZE_SLACK && Math.abs(bitmap.height - FRAME_SIZES.desktop.height) <= SIZE_SLACK;
        bitmap?.close();
        if (!fits) showFallback('other');
        else await show(blob, () => showFallback('other'));
      })();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const onFrameLoad = () => {
    clearTimeout(readyTimer.current);
    readyTimer.current = setTimeout(() => {
      if (phaseRef.current === 'loading') showFallback('unavailable');
    }, READY_WAIT_MS);
  };

  const take = () => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    setMessage(null);
    go('taking');
    clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => {
      if (phaseRef.current === 'taking') showFallback('other');
    }, RESULT_WAIT_MS);
    // canvas が絵に写らないことがあるブラウザ（WebKit。THUMB001）では、写っていない絵を見せずに、ファイルを選ぶ道を出す
    target.postMessage({ type: CAPTURE_REQUEST, strict: !canAutoCapture() }, '*');
  };

  const retake = () => {
    setPicked(null);
    setMessage(null);
    go(fallback ? 'fallback' : 'ready');
  };

  const send = async () => {
    if (!picked) return;
    go('sending');
    setMessage(null);
    try {
      const answer = await uploadThumb(workId, picked.blob);
      if (answer.ok) {
        onDone();
        return;
      }
      const code = answer.error === 'rate_limited' && answer.limit ? `limit_${answer.limit}` : answer.error;
      setMessage(code === 'has_draft' ? text.hasDraft : ((errors as Record<string, string>)[code] ?? text.sendFailed));
    } catch {
      setMessage(text.sendFailed);
    }
    go('preview');
  };

  const close = () => {
    dialogRef.current?.close();
  };

  const fallbackText = fallback === 'unavailable' ? text.unavailable : fallback ? text.failed[fallback] : null;
  const busy = phase === 'taking' || phase === 'sending';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      data-thumb-capture={phase}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(960px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-card border border-site-line-2 bg-site-bg p-4 text-body text-site-fg shadow-menu backdrop:bg-site-scrim/50"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="text-subhead font-semibold">
          {text.heading}
        </h2>
        <button type="button" aria-label={text.close} onClick={close} className="inline-flex size-11 items-center justify-center rounded-control text-site-fg-2 hover:bg-site-hover">
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-small text-site-fg-2">{text.note}</p>
      <div className="@container mt-3">
        <div ref={boxRef} className={`relative overflow-hidden rounded-card border border-site-line ${BOX_CLASS.desktop}`}>
          <iframe
            ref={frameRef}
            data-ld-frame=""
            title={text.frameTitle(title)}
            sandbox={SANDBOX}
            // 撮る絵は見えている細かさに下げない（# の ldpr を付けない）。枠の中の絵は 1280×800 のまま
            src={`${frameUrl}?capture=1`}
            onLoad={onFrameLoad}
            className={FRAME_CLASS.desktop}
          />
          {picked && (
            <img data-thumb-preview="" src={picked.url} alt={text.previewAlt} className="absolute inset-0 size-full bg-site-bg object-contain" />
          )}
        </div>
      </div>
      {phase === 'preview' || (phase === 'sending' && picked) ? <p className="mt-3">{text.previewNote}</p> : null}
      {phase === 'fallback' && fallbackText && (
        <div data-thumb-fallback={fallback ?? ''} className="mt-3 rounded-control bg-site-field px-3 py-2.5">
          <p>{fallbackText}</p>
          <label htmlFor={fileId} className="mt-2 block font-semibold">
            {text.chooseFile}
          </label>
          <input
            id={fileId}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="mt-1 block max-w-full text-small"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void show(file, () => setMessage(text.fileBad));
            }}
          />
          <p className="mt-1 text-small text-site-fg-2">{text.fileNote}</p>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(phase === 'loading' || phase === 'ready' || phase === 'taking') && (
          <button type="button" disabled={phase !== 'ready'} onClick={take} className={PRIMARY_BUTTON}>
            {phase === 'taking' ? text.taking : text.take}
          </button>
        )}
        {picked && (phase === 'preview' || phase === 'sending') && (
          <>
            <button type="button" disabled={busy} onClick={() => void send()} className={PRIMARY_BUTTON}>
              {text.send}
            </button>
            <button type="button" disabled={busy} onClick={retake} className={WHITE_BUTTON}>
              {text.retake}
            </button>
          </>
        )}
      </div>
      <p role="status" className="mt-1 text-small font-semibold">
        {message}
      </p>
    </dialog>
  );
}
