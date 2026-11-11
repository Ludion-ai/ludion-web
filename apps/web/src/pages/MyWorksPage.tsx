import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { useResetTitle } from '../hooks/useResetTitle';
import { goToLogin } from '../lib/account';
import { fetchOwnWorks, revokeOwnWork, type OwnWork } from '../lib/post';

const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg';

type ListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; works: OwnWork[] };

function WorkRow({ work, reload }: { work: OwnWork; reload: () => Promise<void> }) {
  const copy = useCopy();
  const text = copy.account.works;
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const canEdit = work.status !== 'submitted';
  const canRevoke = work.status !== 'revoked';
  const reason = work.reject_code ? (copy.post.reject[work.reject_code as keyof typeof copy.post.reject] ?? copy.post.reject.other) : null;

  const onRevoke = async () => {
    setFailed(false);
    try {
      await revokeOwnWork(work.id);
      await reload();
    } catch {
      setFailed(true);
    }
  };

  // 題とサムネイルのない下書き（docs/tasks/T033.md A3）は、仮の題と空の枠で出す
  const title = work.title || copy.post.untitled;
  return (
    <li data-own-work={work.id} className="flex flex-col gap-3 border-t border-site-line py-5 sm:flex-row">
      {work.thumb ? (
        <img src={work.thumb} alt="" width={work.thumb_w} height={work.thumb_h} loading="lazy" className="h-auto w-full rounded-control border border-site-line bg-site-field sm:w-40 sm:shrink-0" />
      ) : (
        <div aria-hidden="true" className="flex aspect-[8/5] w-full items-center justify-center rounded-control border border-site-line bg-site-field text-small text-site-fg-3 sm:w-40 sm:shrink-0">
          {copy.post.noThumb}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold wrap-anywhere">{title}</h2>
        <p className="mt-0.5 text-small text-site-fg-2">{copy.work.meta(work.category, work.subtype)}</p>
        <p className="mt-2 font-semibold" data-own-work-status={work.status}>
          {copy.post.status[work.status]}
        </p>
        {work.public && work.status !== 'approved' && <p className="mt-0.5 text-small text-site-fg-2">{text.publicKept(work.public_version)}</p>}
        {work.status === 'rejected' && (
          <div className="mt-2 rounded-control bg-site-field px-3 py-2.5">
            <p className="text-small font-semibold">{text.reasonHeading}</p>
            <p className="mt-0.5">{reason}</p>
            {work.reject_note && <p className="mt-0.5 wrap-anywhere">{work.reject_note}</p>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canEdit && (
            <Link to={`/new?work=${encodeURIComponent(work.id)}`} reloadDocument aria-label={text.editLabel(title)} className={WHITE_BUTTON}>
              {text.edit}
            </Link>
          )}
          {work.public && (
            <Link to={`/p/${encodeURIComponent(work.id)}`} reloadDocument aria-label={text.viewLabel(title)} className={WHITE_BUTTON}>
              {text.view}
            </Link>
          )}
          {canRevoke && !confirming && (
            <button type="button" aria-label={text.revokeLabel(title)} onClick={() => setConfirming(true)} className={WHITE_BUTTON}>
              {text.revoke}
            </button>
          )}
        </div>
        {confirming && canRevoke && (
          <div className="mt-3 rounded-control bg-site-field px-3 py-2.5">
            <p>{text.revokeNote}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={onRevoke} className={PRIMARY_BUTTON}>
                {text.revokeConfirm}
              </button>
              <button type="button" onClick={() => setConfirming(false)} className={WHITE_BUTTON}>
                {text.revokeCancel}
              </button>
            </div>
          </div>
        )}
        <p role="status" className="mt-1 text-small font-semibold">
          {failed && text.revokeFailed}
        </p>
      </div>
    </li>
  );
}

/** 「自分の作品」（docs/tasks/T021.md 段階 B）。状態、差し戻しの理由、直す、取り下げ。人によって変わるので、ブラウザで読む。 */
export function MyWorksPage() {
  const copy = useCopy();
  const text = copy.account.works;
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const { canPost } = useAccount();
  useResetTitle();

  const reload = useCallback(async () => {
    try {
      const works = await fetchOwnWorks();
      if (works === 'unauthorized') goToLogin();
      else setState({ status: 'ready', works });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    document.title = text.pageTitle;
    void reload();
  }, [reload, text.pageTitle]);

  return (
    <div className="max-w-[640px] pb-8 text-body text-site-fg md:pt-[27px]">
      <Link to="/account" className="mb-3 inline-flex h-11 items-center gap-1 rounded-control pr-3 text-site-fg-2 hover:text-site-fg">
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
        {copy.account.heading}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title font-bold">{text.heading}</h1>
        {canPost && (
          <Link to="/new" reloadDocument className={PRIMARY_BUTTON}>
            {copy.nav.post}
          </Link>
        )}
      </div>
      {state.status === 'error' && <p className="py-20 text-center text-site-fg-2">{text.loadError}</p>}
      {state.status === 'ready' && state.works.length === 0 && <p className="py-20 text-center text-site-fg-2">{text.empty}</p>}
      {state.status === 'ready' && state.works.length > 0 && (
        <ul className="mt-4">
          {state.works.map((work) => (
            <WorkRow key={work.id} work={work} reload={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}
