import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AutoThumb } from '../components/AutoThumb';
import { chipClass } from '../components/chip';
import { ThumbCapture } from '../components/ThumbCapture';
import { useAccount } from '../hooks/useAccount';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useResetTitle } from '../hooks/useResetTitle';
import { localizedPath } from '../i18n';
import { goToLogin } from '../lib/account';
import { fetchOwnWorks, makeWorkPrivate, publishWork, type OwnWork } from '../lib/post';

const WHITE_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
const PRIMARY_BUTTON = 'inline-flex h-11 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';

type ListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; works: OwnWork[] };

/** 状態の札（docs/tasks/T036.md「3」）。直している版があればその状態、なければ作品の状態。 */
export type WorkState = 'private' | 'submitted' | 'public' | 'rejected' | 'draft' | 'revoked';

export function stateOf(work: Pick<OwnWork, 'status' | 'public' | 'private'>): WorkState {
  if (work.status === 'submitted' || work.status === 'rejected' || work.status === 'draft') return work.status;
  if (work.public) return 'public';
  if (work.private) return 'private';
  return 'revoked';
}

type Filter = 'all' | 'private' | 'public';
const FILTERS: Filter[] = ['all', 'private', 'public'];
const matches = (work: OwnWork, filter: Filter) => filter === 'all' || (filter === 'private' ? work.private : work.public);

type Pending = 'publish' | 'private' | null;

/** サムネイルのないとき：題の頭の1文字を、サイトの色で（docs/tasks/T036.md「1」）。題もなければ「画像なし」。 */
function NoThumb({ title }: { title: string }) {
  const copy = useCopy();
  const initial = [...title.trim()][0];
  return (
    <div aria-hidden="true" data-no-thumb="" className="flex aspect-[8/5] w-full items-center justify-center rounded-control border border-site-line bg-site-field text-site-fg-3 sm:w-40 sm:shrink-0">
      {initial ? <span className="text-title font-bold uppercase">{initial}</span> : <span className="text-small">{copy.post.noThumb}</span>}
    </div>
  );
}

function WorkRow({ work, reload }: { work: OwnWork; reload: () => Promise<void> }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.account.works;
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const state = stateOf(work);
  const reason = work.reject_code ? (copy.post.reject[work.reject_code as keyof typeof copy.post.reject] ?? copy.post.reject.other) : null;
  // 題とサムネイルのない下書き（docs/tasks/T033.md A3）は、仮の題で出す
  const title = work.title || copy.post.untitled;
  const day = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(work.updated_at);

  const canOpen = work.public || work.private;
  const canEdit = work.status !== 'submitted';
  const firstDraft = state === 'draft' && !work.public && !work.private;
  // 公開できるのは、自分だけの作品の今の版（直している途中の版がないとき）
  const canPublish = work.private && (work.status === 'private' || work.status === 'approved');
  const canMakePrivate = work.public;
  // 画像を足せるのも、自分だけの作品の今の版（DOC002「3」）。いちばん新しい版が今の版なので、その下書きの枠で撮る
  const canAddThumb = canPublish;

  const act = async (kind: Exclude<Pending, null>) => {
    setBusy(true);
    setMessage(null);
    try {
      if (kind === 'publish') {
        const answer = await publishWork(work.id);
        if (answer !== 'ok') {
          setMessage(answer === 'thumb_required' ? text.publishThumb : answer === 'has_draft' ? text.publishHasDraft : text.publishFailed);
          return;
        }
      } else {
        const answer = await makeWorkPrivate(work.id);
        if (answer !== 'ok') {
          setMessage(answer === 'private_limit' ? text.privateLimit : text.makePrivateFailed);
          return;
        }
      }
      setPending(null);
      await reload();
    } catch {
      setMessage(kind === 'publish' ? text.publishFailed : text.makePrivateFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-own-work={work.id} data-own-work-state={state} className="flex flex-col gap-3 border-t border-site-line py-5 sm:flex-row">
      {work.thumb ? (
        <img src={work.thumb} alt="" width={work.thumb_w} height={work.thumb_h} loading="lazy" className="h-auto w-full rounded-control border border-site-line bg-site-field sm:w-40 sm:shrink-0" />
      ) : canAddThumb ? (
        // 画像のない自分だけの作品は、枠から自動で撮って付ける（THUMB001）。撮れるまで、撮れないときは、頭文字
        <AutoThumb key={work.revision_id} workId={work.id} revisionId={work.revision_id} title={title} onDone={() => void reload()}>
          <NoThumb title={work.title} />
        </AutoThumb>
      ) : (
        <NoThumb title={work.title} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="min-w-0 font-semibold wrap-anywhere">{title}</h2>
          <span data-own-work-status={work.status} className="inline-flex h-6 items-center rounded-chip border border-site-line-2 px-2.5 text-small font-semibold">
            {text.state[state]}
          </span>
          {work.via && (
            <span data-own-work-via={work.via} title={text.viaLabel(work.via)} className="text-small text-site-fg-2 wrap-anywhere">
              {text.via(work.via)}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-small text-site-fg-2">{copy.work.meta(work.category, work.subtype)}</p>
        <p className="mt-0.5 text-small text-site-fg-2">
          {text.updated(day)} · {text.versions(work.versions)}
        </p>
        {work.public && state !== 'public' && <p className="mt-1 text-small text-site-fg-2">{text.publicKept(work.public_version)}</p>}
        {work.private && state !== 'private' && <p className="mt-1 text-small text-site-fg-2">{text.privateKept(work.public_version)}</p>}
        {work.status === 'rejected' && (
          <div className="mt-2 rounded-control bg-site-field px-3 py-2.5">
            <p className="text-small font-semibold">{text.reasonHeading}</p>
            <p className="mt-0.5">{reason}</p>
            {work.reject_note && <p className="mt-0.5 wrap-anywhere">{work.reject_note}</p>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canOpen && (
            <a href={localizedPath(locale, `/p/${encodeURIComponent(work.id)}`)} aria-label={text.openLabel(title)} className={WHITE_BUTTON}>
              {text.open}
            </a>
          )}
          {canEdit && (
            <Link to={`/new?work=${encodeURIComponent(work.id)}`} reloadDocument aria-label={firstDraft ? text.resumeLabel(title) : text.editLabel(title)} className={WHITE_BUTTON}>
              {firstDraft ? text.resume : text.edit}
            </Link>
          )}
          {canAddThumb && (
            <button type="button" aria-label={text.addThumbLabel(title)} onClick={() => setCapturing(true)} className={WHITE_BUTTON}>
              {work.thumb ? text.changeThumb : text.addThumb}
            </button>
          )}
          {canPublish && pending !== 'publish' && (
            <button type="button" aria-label={text.publishLabel(title)} onClick={() => setPending('publish')} className={WHITE_BUTTON}>
              {text.publish}
            </button>
          )}
          {canMakePrivate && pending !== 'private' && (
            <button type="button" aria-label={text.makePrivateLabel(title)} onClick={() => setPending('private')} className={WHITE_BUTTON}>
              {text.makePrivate}
            </button>
          )}
        </div>
        {pending && (
          <div data-own-work-confirm={pending} className="mt-3 rounded-control bg-site-field px-3 py-2.5">
            <p>{pending === 'publish' ? text.publishNote : text.makePrivateNote}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void act(pending)} className={PRIMARY_BUTTON}>
                {pending === 'publish' ? text.publishConfirm : text.makePrivateConfirm}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setMessage(null);
                }}
                className={WHITE_BUTTON}
              >
                {text.cancel}
              </button>
            </div>
          </div>
        )}
        <p role="status" className="mt-1 text-small font-semibold">
          {message}
        </p>
      </div>
      {capturing && (
        <ThumbCapture
          workId={work.id}
          title={title}
          frameUrl={`/draft-frame/${work.revision_id}/desktop.html`}
          onClose={() => setCapturing(false)}
          onDone={() => {
            setCapturing(false);
            setMessage(text.capture.sent);
            void reload();
          }}
        />
      )}
    </li>
  );
}

/**
 * 「自分の作品」（docs/tasks/T021.md 段階 B、T036.md「3」）。自分の全部の作品を、新しく変えた順に並べる。
 * 状態の札、絞り込み、開く、新しい版を置く、公開する、自分だけにする。人によって変わるので、ブラウザで読む。
 */
export function MyWorksPage() {
  const copy = useCopy();
  const text = copy.account.works;
  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
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

  const shown = state.status === 'ready' ? state.works.filter((work) => matches(work, filter)) : [];

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
        <>
          <div role="group" aria-label={text.filters.label} className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((value) => (
              <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={chipClass(filter === value)}>
                {text.filters[value]}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="py-12 text-center text-site-fg-2">{text.emptyFiltered}</p>
          ) : (
            <ul className="mt-4">
              {shown.map((work) => (
                <WorkRow key={work.id} work={work} reload={reload} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
