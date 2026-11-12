import { Link2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { COPIED_MS } from '../lib/count';
import { fetchShare, setShare, type ShareInfo } from '../lib/share';

/**
 * 設定のタブの「リンクで見せる」（SHARE001「1」）。自分だけの作品の持ち主だけに出す。初めはオフ。
 * オンにすると住所が出て、コピーできる。オフにすると住所は使えなくなり、次にオンにすると新しい住所になる。
 * 運営が止めた作品は、スイッチを押せない。
 */
export function ShareSettings({ workId, onChange }: { workId: string; onChange?: (state: ShareInfo['state']) => void }) {
  const text = useCopy().share.settings;
  const labelId = useId();
  const noteId = useId();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let live = true;
    void fetchShare(workId).then((answer) => {
      if (!live) return;
      if (answer) setInfo(answer);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [workId]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // ページの札と知らせを、スイッチと同じ状態にする
  useEffect(() => {
    if (info) onChange?.(info.state);
  }, [info, onChange]);

  const on = info?.state === 'on';
  const blocked = info?.state === 'blocked';

  const toggle = async () => {
    if (!info || busy || blocked) return;
    setBusy(true);
    setFailed(false);
    const answer = await setShare(workId, !on);
    setBusy(false);
    if (answer) setInfo(answer);
    else setFailed(true);
  };

  const copyAddress = async () => {
    if (!info?.url) return;
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(info.url);
    } catch {
      state = 'failed';
    }
    setCopyState(state);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('idle'), COPIED_MS);
  };

  const status = busy ? text.saving : copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : '';

  return (
    <section data-share-settings="" className="mt-5">
      <h2 className="text-small font-semibold text-site-fg-2">{text.heading}</h2>
      <div className="mt-2 flex min-h-11 items-center justify-between gap-4 rounded-control border border-site-line px-4 py-2">
        <span id={labelId} className="flex items-center gap-2 text-body font-semibold text-site-fg">
          <Link2 size={18} strokeWidth={1.75} aria-hidden="true" />
          {text.label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={noteId}
          disabled={!info || busy || blocked}
          onClick={() => void toggle()}
          data-share-switch=""
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-chip border transition-colors disabled:opacity-60 ${
            on ? 'border-site-primary bg-site-primary' : 'border-site-line-2 bg-site-field'
          }`}
        >
          <span aria-hidden="true" className={`absolute top-[3px] size-5 rounded-chip bg-site-bg shadow transition-[left] ${on ? 'left-[23px]' : 'left-[3px] bg-site-fg-3'}`} />
        </button>
      </div>
      <p id={noteId} className="mt-2 text-small text-site-fg-2">
        {info === null && !failed ? text.loading : blocked ? text.blocked : text.note}
      </p>
      {on && info.url && (
        <div data-share-address="" className="mt-3">
          <label className="text-small font-semibold text-site-fg-2" htmlFor={`${labelId}-url`}>
            {text.address}
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <input
              id={`${labelId}-url`}
              readOnly
              value={info.url}
              onFocus={(event) => event.currentTarget.select()}
              className="h-11 min-w-0 flex-1 basis-60 rounded-control border border-site-line-2 bg-site-field px-3 font-mono text-small text-site-fg"
            />
            <button
              type="button"
              onClick={() => void copyAddress()}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg"
            >
              {copyState === 'copied' ? text.copied : copyState === 'failed' ? text.copyFailed : text.copy}
            </button>
          </div>
        </div>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      {failed && !busy && (
        <p className="mt-2 text-small text-site-fg" role="alert">
          {text.failed}
        </p>
      )}
    </section>
  );
}
