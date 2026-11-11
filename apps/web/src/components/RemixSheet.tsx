import { Plus, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { trackEvent } from '../lib/analytics';
import { COPIED_MS, postCount } from '../lib/count';
import { addToBrief, buildRemixPrompt, readRemixMode, REMIX_BRIEF_MAX, REMIX_MODES, remixPostPath, saveRemixMode, snippetKilobytes, type RemixMode } from '../lib/remix';

/** スマホは下から出す。これ以上の幅は、押したボタンの近くに置く（docs/tasks/T030.md「1」）。 */
const NEAR_BUTTON = '(min-width: 768px)';
const GAP = 8;
const EDGE = 16;

/** ページの座標で置く。ページをスクロールしても、シートはボタンの近くのまま（top layer の absolute はページが基準）。 */
function placeNear(sheet: HTMLElement, anchor: HTMLElement) {
  const button = anchor.getBoundingClientRect();
  const { width, height } = sheet.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(button.right - width, document.documentElement.clientWidth - width - EDGE));
  const below = button.bottom + GAP;
  const top = below + height <= window.innerHeight - EDGE ? below : Math.max(EDGE, button.top - GAP - height);
  sheet.style.left = `${left + window.scrollX}px`;
  sheet.style.top = `${top + window.scrollY}px`;
}

interface RemixSheetProps {
  workId: string;
  snippet: string;
  /** シートを開いたボタン。閉じるとフォーカスを戻す */
  anchor: HTMLElement;
  brief: string;
  onBriefChange: (brief: string) => void;
  onCopied: () => void;
  onClose: () => void;
}

/** 「リミックス」のシート。Esc、フォーカスの閉じ込め、後ろを押せなくするのは、<dialog> に任せる。 */
export function RemixSheet({ workId, snippet, anchor, brief, onBriefChange, onCopied, onClose }: RemixSheetProps) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.work.remix;
  const sheetRef = useRef<HTMLDialogElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressedBackdrop = useRef(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [manual, setManual] = useState<string | null>(null);
  // 指示文の形。選んだ方をその端末に覚える（docs/tasks/T031.md「2」）。シートは押した後にブラウザでだけ描くので、ここで読んでよい
  const [mode, setMode] = useState<RemixMode>(readRemixMode);
  const kilobytes = useMemo(() => snippetKilobytes(snippet), [snippet]);
  const headingId = useId();
  const briefId = useId();
  const modeName = useId();

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
    // スマホでは入力欄を選ばない。キーボードが開いて、チップとコピーのボタンを隠すため（入力は任意）
    if (near.matches) briefRef.current!.focus();
    else sheet.focus();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // 手で写すための箱が出たら、全部を選んでおく
  useEffect(() => {
    if (manual !== null) manualRef.current?.select();
  }, [manual]);

  const showCopyState = (state: 'copied' | 'failed') => {
    setCopyState(state);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), COPIED_MS);
  };

  const close = () => sheetRef.current?.close();

  const onDialogClose = () => {
    anchor.focus();
    onClose();
  };

  const onCopy = async () => {
    const prompt = buildRemixPrompt(copy, brief, snippet, mode, workId, locale);
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // クリップボードが使えないときは、手で写せるように指示文を見せて選んでおく。コピーしていないので数えない
      setManual(prompt);
      showCopyState('failed');
      return;
    }
    setManual(null);
    showCopyState('copied');
    onCopied();
    postCount(workId, 'copy');
    // 入力の中身は送らない（CLAUDE.md 原則6）
    trackEvent('remix_prompt_copy', { work_id: workId, has_brief: brief.trim() !== '', mode });
  };

  const chooseMode = (next: RemixMode) => {
    setManual(null);
    setMode(next);
    saveRemixMode(next);
  };

  const changeBrief = (next: string) => {
    setManual(null);
    onBriefChange(next);
  };

  const copyMessage = copyState === 'copied' ? copy.work.copied : copyState === 'failed' ? copy.work.copyFailed : '';

  return (
    // 後ろの黒い部分（::backdrop）を押すと閉じる。入力欄で押して外で離したときは閉じない（書いた文を選んでいるとき）
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
          <h2 id={headingId} className="text-subhead font-semibold text-site-fg">
            {text.heading}
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

        {/* form にしない：GA4 の拡張計測がフォームの操作を拾わないように（入力は外へ出さない） */}
        <label htmlFor={briefId} className="mt-1 block text-body font-semibold text-site-fg">
          {text.briefLabel}
        </label>
        <textarea
          id={briefId}
          ref={briefRef}
          rows={2}
          value={brief}
          maxLength={REMIX_BRIEF_MAX}
          onChange={(event) => changeBrief(event.target.value)}
          placeholder={text.briefPlaceholder}
          className="mt-2 block w-full resize-none rounded-control bg-site-field p-3 text-body text-site-fg placeholder:text-site-fg-3 max-md:text-input"
        />

        <div role="group" aria-label={text.chipsLabel} className="mt-2 flex flex-wrap gap-2">
          {text.chips.map(({ label, phrase }) => (
            <button
              key={label}
              type="button"
              onClick={() => changeBrief(addToBrief(brief, phrase, text.chipJoiner))}
              className="inline-flex h-chip items-center gap-1 rounded-chip border border-site-line-2 pr-3.5 pl-2.5 text-body font-semibold text-site-fg hover:bg-site-hover"
            >
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" className="text-site-fg-3" />
              {label}
            </button>
          ))}
        </div>

        {/* 指示文の形。2つを横に並べ、選んだ方の説明だけを下に出す。入力欄も2行にして、シートを高くしない（幅1440×900 で、日本語のシートがボタンの下に入る高さ） */}
        <fieldset className="mt-2">
          <legend className="sr-only">{text.modeLabel}</legend>
          <div className="flex flex-wrap gap-2">
            {REMIX_MODES.map((option) => (
              <label
                key={option}
                className={`flex h-chip cursor-pointer items-center gap-2 rounded-control border border-site-line-2 px-3 text-body font-semibold text-site-fg-2 hover:bg-site-hover has-[:checked]:border-site-fg has-[:checked]:text-site-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-site-primary ${option === 'full' ? 'flex-1' : ''}`}
              >
                <input
                  type="radio"
                  name={modeName}
                  value={option}
                  checked={mode === option}
                  onChange={() => chooseMode(option)}
                  aria-describedby={`${modeName}-${option}`}
                  className="sr-only"
                />
                <span className="whitespace-nowrap">{text.modes[option].label}</span>
                {option === 'full' && <span className="ml-auto whitespace-nowrap text-meta font-normal text-site-fg-2">{text.codeSize(kilobytes)}</span>}
              </label>
            ))}
          </div>
          {REMIX_MODES.map((option) => (
            <p key={option} id={`${modeName}-${option}`} className={mode === option ? 'mt-1 text-meta text-site-fg-2' : 'sr-only'}>
              {text.modes[option].note}
            </p>
          ))}
        </fieldset>

        <button
          type="button"
          onClick={onCopy}
          className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-control bg-site-primary text-body font-semibold text-site-bg"
        >
          {copyMessage || text.copyPrompt}
        </button>
        <p role="status" className="sr-only">
          {copyMessage}
        </p>

        {manual !== null && (
          <textarea
            ref={manualRef}
            readOnly
            rows={5}
            value={manual}
            aria-label={text.manualLabel}
            className="mt-2 block w-full resize-none rounded-control border border-site-line bg-site-field p-3 font-mono text-small text-site-fg"
          />
        )}

        {/* できたら Ludion に載せる（docs/tasks/T033.md B1）。ログインしていなければ、ログインの後にここへ戻る。
            同じ段落に入れる：行を足すと、幅1440×900 でシートがボタンの下に入らない */}
        <p className="mt-3 text-meta text-site-fg-2">
          {text.pasteNote}
          {text.postJoiner}
          {text.postNote}
          <a href={remixPostPath(locale, workId)} className="font-semibold text-site-fg underline">
            {text.postLink}
          </a>
        </p>
        <p className="mt-1 text-meta text-site-fg-2">{text.shareNote}</p>
      </div>
    </dialog>
  );
}
