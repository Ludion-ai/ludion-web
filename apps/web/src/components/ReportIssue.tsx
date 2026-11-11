import { useEffect, useId, useRef, useState } from 'react';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import { COPIED_MS } from '../lib/count';
import { SUPPORT_EMAIL } from '../lib/support';

const SHARE_ORIGIN = 'https://ludion.ai';

/** mailto が開かない環境でも使える、作品の問題を報告するための窓口。 */
export function ReportIssue({ workId }: { workId: string }) {
  const copy = useCopy();
  const locale = useLocale();
  const contentId = useId();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const workUrl = `${SHARE_ORIGIN}${localizedPath(locale, `/p/${encodeURIComponent(workId)}`)}`;

  useEffect(() => () => clearTimeout(timer.current), []);

  const copyEmail = async () => {
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
    } catch {
      state = 'failed';
    }
    setCopyState(state);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState('idle'), COPIED_MS);
  };

  return (
    <div className="mt-4 text-meta">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="rounded-key text-site-fg-2 underline hover:text-site-fg"
      >
        {copy.work.report.open}
      </button>

      {open && (
        <section id={contentId} className="mt-3 rounded-control border border-site-line bg-site-field p-3 text-small text-site-fg">
          <h2 className="font-semibold">{copy.work.report.heading}</h2>
          <p className="mt-2">{copy.work.report.intro}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="break-all font-semibold">{SUPPORT_EMAIL}</span>
            <button
              type="button"
              onClick={copyEmail}
              className="inline-flex h-9 items-center rounded-key border border-site-line-2 bg-site-bg px-3 font-semibold hover:bg-site-hover"
            >
              {copyState === 'copied' ? copy.work.report.copied : copyState === 'failed' ? copy.work.report.copyFailed : copy.work.report.copy}
            </button>
          </div>
          <p role="status" className="sr-only">
            {copyState === 'copied' ? copy.work.report.copied : copyState === 'failed' ? copy.work.report.copyFailed : ''}
          </p>
          <p className="mt-3">{copy.work.report.include}</p>
          <ul className="mt-1 list-disc pl-5">
            <li>
              {copy.work.report.urlLabel} <span className="break-all">{workUrl}</span>
            </li>
            <li>{copy.work.report.reason}</li>
          </ul>
        </section>
      )}
    </div>
  );
}
