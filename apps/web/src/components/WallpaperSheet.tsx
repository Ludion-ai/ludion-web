import { ArrowLeft, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { trackEvent } from '../lib/analytics';
import { COPIED_MS } from '../lib/count';
import { NEAR_BUTTON, placeNear } from '../lib/sheet';
import {
  LIVELY_STORE_URL,
  PLASH_STORE_URL,
  WINDOWS_DOWNLOAD_PATH,
  appUrl,
  currentWallpaperDevice,
  downloadWallpaperHtml,
  plashUrl,
  rememberApp,
  wallUrl,
  wallpaperOrder,
  watchAppLaunch,
  type WallpaperDevice,
} from '../lib/wallpaper';

interface WallpaperSheetProps {
  workId: string;
  title: string;
  /** コピーされるコード。「HTML を保存」はこれをそのまま保存する */
  snippet: string;
  /** シートを開いたボタン。閉じるとフォーカスを戻す */
  anchor: HTMLElement;
  onClose: () => void;
}

const primaryButton =
  'inline-flex h-11 w-full items-center justify-center rounded-control bg-site-primary text-body font-semibold text-site-bg';
const whiteButton =
  'inline-flex h-11 w-full items-center justify-center rounded-control border border-site-line-2 bg-site-bg text-body font-semibold text-site-fg hover:bg-site-hover';
const sectionClass = 'mt-4 border-t border-site-line pt-4';
const headingClass = 'text-body font-semibold text-site-fg';
const noteClass = 'mt-2 text-meta text-site-fg-2';
const storeLink = 'font-semibold text-site-fg underline';

/**
 * 「壁紙にする」のシート（WALL001「2」）。形は「リミックス」のシートと同じ（RemixSheet.tsx）。
 * 開いている端末に合わせて、Mac か Windows の方を先に出す。端末の種類は並びを変えるだけで、送らず、保存しない。
 */
export function WallpaperSheet({ workId, title, snippet, anchor, onClose }: WallpaperSheetProps) {
  const copy = useCopy();
  const text = copy.work.wallpaper;
  const sheetRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  // シートは押した後にブラウザでだけ描くので、ここで端末を読んでよい
  const [device] = useState<WallpaperDevice>(currentWallpaperDevice);
  const headingId = useId();
  const url = wallUrl(workId);
  // 「Windows アプリを入れる」の案内（APP001）。シートの中で中身を替える（モーダルを重ねない）
  const [view, setView] = useState<'main' | 'install'>('main');
  const stopWatching = useRef<() => void>(undefined);

  useEffect(() => () => stopWatching.current?.(), []);

  useLayoutEffect(() => {
    sheetRef.current?.focus();
  }, [view]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current!;
    if (!sheet.open) sheet.showModal();
    const near = window.matchMedia(NEAR_BUTTON);
    const place = () => {
      if (near.matches) {
        placeNear(sheet, anchor);
      } else {
        sheet.style.removeProperty('left');
        sheet.style.removeProperty('top');
      }
    };
    place();
    sheet.focus();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  const close = () => sheetRef.current?.close();

  const onDialogClose = () => {
    anchor.focus();
    onClose();
  };

  const onDownload = () => {
    downloadWallpaperHtml(workId, snippet, sheetRef.current!);
    trackEvent('wallpaper_open', { work_id: workId, method: 'download' });
  };

  const onApp = () => {
    trackEvent('wallpaper_open', { work_id: workId, method: 'app' });
    stopWatching.current?.();
    stopWatching.current = watchAppLaunch(() => setView('install'));
  };

  const onAppDownload = () => trackEvent('wallpaper_open', { work_id: workId, method: 'app_download' });

  const onHaveApp = () => {
    rememberApp();
    setView('main');
  };

  const sections = {
    mac: (
      <section key="mac" aria-label={text.mac} data-wallpaper="mac" className={sectionClass}>
        <h3 className={headingClass}>{text.mac}</h3>
        <a href={plashUrl(workId, title)} onClick={() => trackEvent('wallpaper_open', { work_id: workId, method: 'plash' })} className={`${primaryButton} mt-2`}>
          {text.plash}
        </a>
        <p className={noteClass}>
          {text.plashGet}
          <a href={PLASH_STORE_URL} target="_blank" rel="noopener noreferrer" className={storeLink}>
            {text.plashStore}
          </a>
          {text.plashGetAfter}
        </p>
        <UrlCopy workId={workId} url={url} />
      </section>
    ),
    windows: (
      <section key="windows" aria-label={text.windows} data-wallpaper="windows" className={sectionClass}>
        <h3 className={headingClass}>{text.windows}</h3>
        <a href={appUrl(workId)} onClick={onApp} className={`${primaryButton} mt-2`}>
          {text.app}
        </a>
        <p className={noteClass}>
          {text.appNote}
          <button type="button" onClick={() => setView('install')} className={`${storeLink} ml-1`}>
            {text.appInstall}
          </button>
        </p>
        <h4 className={`${headingClass} mt-4`}>{text.lively}</h4>
        <p className={noteClass}>
          {text.livelyGet}
          <a href={LIVELY_STORE_URL} target="_blank" rel="noopener noreferrer" className={storeLink}>
            {text.livelyStore}
          </a>
          {text.livelyGetAfter}
        </p>
        <ol className="mt-1 list-decimal pl-5 text-meta text-site-fg-2">
          {text.livelySteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <UrlCopy workId={workId} url={url} />
      </section>
    ),
  };

  return (
    // 後ろの黒い部分（::backdrop）を押すと閉じる。住所の欄で押して外で離したときは閉じない（住所を選んでいるとき）
    <dialog
      ref={sheetRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      onClose={onDialogClose}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) close();
      }}
      className="sheet-in m-0 max-h-[calc(100dvh-32px)] w-full max-w-none overflow-y-auto bg-transparent outline-none max-md:fixed max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:backdrop:bg-site-scrim/50 md:absolute md:right-auto md:bottom-auto md:w-[360px] md:backdrop:bg-transparent"
    >
      <div className="rounded-card border border-site-line-2 bg-site-bg p-4 shadow-menu max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0">
        <div className="flex items-center justify-between gap-3">
          {view === 'install' && (
            <button
              type="button"
              aria-label={text.install.back}
              onClick={() => setView('main')}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-control text-site-fg hover:bg-site-hover"
            >
              <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <h2 id={headingId} className="mr-auto text-subhead font-semibold text-site-fg">
            {view === 'install' ? text.install.heading : text.heading}
          </h2>
          <button
            type="button"
            aria-label={text.close}
            onClick={close}
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-control text-site-fg hover:bg-site-hover"
          >
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {view === 'install' ? (
          <InstallGuide onDownload={onAppDownload} onHave={onHaveApp} />
        ) : device === 'mobile' ? (
          <>
            <p className="mt-1 text-body text-site-fg">{text.mobile}</p>
            <UrlCopy workId={workId} url={url} />
          </>
        ) : (
          <>
            {wallpaperOrder(device).map((name) => sections[name])}
            <section aria-label={text.other} data-wallpaper="other" className={sectionClass}>
              <h3 className={headingClass}>{text.other}</h3>
              <p className={noteClass}>{text.otherNote}</p>
              <button type="button" onClick={onDownload} className={`${whiteButton} mt-2`}>
                {text.download}
              </button>
            </section>
            <p className="mt-4 text-meta text-site-fg-2">{text.power}</p>
          </>
        )}
      </div>
    </dialog>
  );
}

/**
 * Windows アプリを入れる前の案内（APP001、段階 A）。署名のない .exe なので、Windows の「PC が保護されました」を先に伝える。
 * ダウンロードは /download/windows（worker/download.ts）から。
 */
function InstallGuide({ onDownload, onHave }: { onDownload: () => void; onHave: () => void }) {
  const text = useCopy().work.wallpaper.install;
  return (
    <div data-wallpaper="install">
      <p className="mt-1 text-body text-site-fg">{text.lead}</p>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-meta text-site-fg">
        {text.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className={noteClass}>{text.why}</p>
      <a href={WINDOWS_DOWNLOAD_PATH} onClick={onDownload} className={`${primaryButton} mt-4`}>
        {text.download}
      </a>
      <p className="mt-2 text-center text-meta text-site-fg-2">{text.size}</p>
      <button type="button" onClick={onHave} className={`${whiteButton} mt-3`}>
        {text.have}
      </button>
      <p className={`${noteClass} mt-4`}>{text.privacy}</p>
    </div>
  );
}

/** 住所の欄と「住所をコピー」。クリップボードが使えないときは、欄の住所を選んでおく。 */
function UrlCopy({ workId, url }: { workId: string; url: string }) {
  const text = useCopy().work.wallpaper;
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (next: 'copied' | 'failed') => {
    setState(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), COPIED_MS);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inputRef.current?.select();
      show('failed');
      return;
    }
    show('copied');
    trackEvent('wallpaper_open', { work_id: workId, method: 'copy' });
  };

  const message = state === 'copied' ? text.copied : state === 'failed' ? text.copyFailed : '';

  return (
    <>
    <div className="mt-2 flex gap-2">
      <input
        ref={inputRef}
        readOnly
        value={url}
        aria-label={text.urlLabel}
        onFocus={(event) => event.currentTarget.select()}
        className="h-11 min-w-0 flex-1 rounded-control bg-site-field px-3 font-mono text-small text-site-fg max-md:text-input"
      />
      <button type="button" onClick={onCopy} className="inline-flex h-11 shrink-0 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-3 text-body font-semibold text-site-fg hover:bg-site-hover">
        {state === 'copied' ? text.copied : text.copyUrl}
      </button>
    </div>
    <p role="status" className={state === 'failed' ? 'mt-1 text-meta text-site-fg-2' : 'sr-only'}>
      {message}
    </p>
    </>
  );
}
