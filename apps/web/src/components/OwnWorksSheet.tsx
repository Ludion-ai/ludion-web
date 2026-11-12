import { Plus, X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { useOwnWorks } from '../hooks/useOwnWorks';
import { WORK_FILTERS, type WorkFilter } from '../lib/workState';
import { chipClass } from './chip';
import { OwnWorksList, OwnWorksSearch } from './OwnWorksList';

interface OwnWorksSheetProps {
  /** シートを開いたボタン。閉じるとフォーカスを戻す */
  anchor: HTMLElement;
  onClose: () => void;
}

/**
 * スマホの「作品」のシート（WS001「2」）。下から出す。中身は PC の左のナビと同じ並び。
 * Esc、シートの中だけをキーで回る、後ろを押せなくするのは <dialog> に任せる。外（後ろの暗い所）を押すと閉じる。
 */
export function OwnWorksSheet({ anchor, onClose }: OwnWorksSheetProps) {
  const copy = useCopy();
  const text = copy.ownNav;
  const { canPost } = useAccount();
  const { state } = useOwnWorks();
  const sheetRef = useRef<HTMLDialogElement>(null);
  const pressedBackdrop = useRef(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<WorkFilter>('all');
  const headingId = useId();
  const hasWorks = state.status === 'ready' && state.works.length > 0;

  useLayoutEffect(() => {
    const sheet = sheetRef.current!;
    if (!sheet.open) sheet.showModal();
    // 入力欄は選ばない。キーボードが開いて、並びを隠すため
    sheet.focus();
  }, []);

  const close = () => sheetRef.current?.close();

  return (
    <dialog
      ref={sheetRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-own-nav="sheet"
      onClose={() => {
        anchor.focus();
        onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedBackdrop.current && event.target === event.currentTarget) close();
      }}
      className="sheet-in pointer-events-auto fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none bg-transparent outline-none backdrop:bg-site-scrim/50"
    >
      <div className="flex max-h-[85dvh] flex-col gap-3 rounded-t-card border-t border-site-line-2 bg-site-bg px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] shadow-menu">
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="text-subhead font-semibold text-site-fg">
            <Link to="/account/works" onClick={close} className="inline-flex min-h-11 items-center">
              {text.heading}
            </Link>
          </h2>
          <div className="flex items-center gap-1">
            {canPost && (
              <Link to="/new" reloadDocument aria-label={text.newWorkLabel} className="inline-flex h-11 items-center gap-1 rounded-control px-3 text-body font-semibold text-site-fg hover:bg-site-hover">
                <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
                {text.newWork}
              </Link>
            )}
            <button type="button" aria-label={text.close} onClick={close} className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-control text-site-fg hover:bg-site-hover">
              <X size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
        </div>
        {hasWorks && (
          <>
            <OwnWorksSearch value={query} onChange={setQuery} />
            <div role="group" aria-label={copy.account.works.filters.label} className="flex flex-wrap gap-2">
              {WORK_FILTERS.map((value) => (
                <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`${chipClass(filter === value)} min-h-11`}>
                  {copy.account.works.filters[value]}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          <OwnWorksList state={state} query={query} filter={filter} onPick={close} />
        </div>
        {hasWorks && (
          <Link to="/account/works" onClick={close} className="flex min-h-11 items-center justify-center rounded-control border border-site-line-2 text-body font-semibold text-site-fg hover:bg-site-hover">
            {text.all}
          </Link>
        )}
      </div>
    </dialog>
  );
}
