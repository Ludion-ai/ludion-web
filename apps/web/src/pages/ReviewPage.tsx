import type { RejectCode } from '@ludion/rules';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { RevisionFrame } from '../components/RevisionFrame';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useResetTitle } from '../hooks/useResetTitle';
import { localizedPath } from '../i18n';
import { problemText } from '../lib/post';
import { fetchQueue, fetchReviewDetail, lineDiff, postApprove, postReject, type DiffLine, type QueueItem, type ReviewDetail } from '../lib/review';

const PRIMARY_BUTTON = 'inline-flex h-11 flex-1 items-center justify-center rounded-control bg-site-primary px-4 text-body font-semibold text-site-bg disabled:opacity-60';
const WHITE_BUTTON = 'inline-flex h-11 flex-1 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover disabled:opacity-60';
const FIELD = 'mt-1 h-11 w-full rounded-control border border-site-line-2 bg-site-bg px-3 text-body text-site-fg focus-visible:border-site-primary';
const CODE_BOX = 'mt-2 max-h-96 overflow-auto rounded-control border border-site-line bg-site-field p-3 font-mono text-small whitespace-pre-wrap wrap-anywhere';
const REJECT_CODES: RejectCode[] = ['dangerous', 'deceptive', 'rights', 'quality', 'broken', 'other'];

type QueueState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: QueueItem[] };
type DetailState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; detail: ReviewDetail };

function Fold({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="mt-3 border-t border-site-line pt-3">
      <summary className="flex min-h-11 cursor-pointer items-center font-semibold">{summary}</summary>
      {children}
    </details>
  );
}

function DiffBlock({ name, before, after }: { name: string; before: string; after: string }) {
  const text = useCopy().review;
  const lines = useMemo<DiffLine[]>(() => lineDiff(before, after), [before, after]);
  const changed = lines.filter((line) => line.kind !== 'same');
  return (
    <div className="mt-3">
      <h4 className="text-small font-semibold">{name}</h4>
      {changed.length === 0 ? (
        <p className="mt-1 text-small text-site-fg-2">{text.noChange}</p>
      ) : (
        <pre tabIndex={0} className={CODE_BOX}>
          {changed.map((line, index) => (
            <span key={index} className={`block ${line.kind === 'added' ? 'bg-site-hover font-semibold' : 'text-site-fg-2 line-through'}`}>
              {line.kind === 'added' ? '+ ' : '- '}
              {line.text}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

/** 1件の審査。上から、動き → 気になる書き方の印 → 承認と差し戻し。コードと差分はたたむ（スマホで1分以内に判断できるように）。 */
function ReviewItem({ id, onDone }: { id: string; onDone: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.review;
  const baseId = useId();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectCode | ''>('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setState({ status: 'loading' });
    setRejecting(false);
    setReason('');
    setNote('');
    setMessage(null);
    fetchReviewDetail(id).then(
      (detail) => {
        if (current) setState({ status: 'ready', detail });
      },
      () => {
        if (current) setState({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  if (state.status === 'error') return <p className="py-10 text-center text-site-fg-2">{text.loadError}</p>;
  if (state.status === 'loading') return <p className="py-10 text-center text-site-fg-2">{text.loading}</p>;

  const { revision, creator, remix_of: remixOf, code, previous, check, flags } = state.detail;

  const finish = (answer: 'ok' | 'changed' | 'failed') => {
    setSending(false);
    if (answer === 'ok') onDone();
    else setMessage(answer === 'changed' ? text.changed : text.failed);
  };

  const onApprove = async () => {
    setSending(true);
    setMessage(null);
    finish(await postApprove(revision.id, revision.content_hash).catch(() => 'failed' as const));
  };

  const onReject = async () => {
    if (!reason) return;
    setSending(true);
    setMessage(null);
    finish(await postReject(revision.id, reason, note).catch(() => 'failed' as const));
  };

  return (
    <article data-review-item={revision.id}>
      <h2 className="text-subhead font-semibold wrap-anywhere">{revision.title}</h2>
      <p className="mt-0.5 text-small text-site-fg-2 wrap-anywhere">
        {copy.work.meta(revision.category, revision.subtype)} · @{creator?.handle} · {text.version(revision.version)}
      </p>
      {remixOf && (
        <p data-review-remix-of={remixOf.id} className="mt-1 text-small wrap-anywhere">
          {text.remixOf}
          {remixOf.public ? (
            <a href={localizedPath(locale, `/p/${encodeURIComponent(remixOf.id)}`)} target="_blank" rel="noopener" className="font-semibold underline">
              {text.remixOfWork(remixOf.title, remixOf.handle)}
            </a>
          ) : (
            <span className="font-semibold">{text.remixOfWork(remixOf.title, remixOf.handle)}</span>
          )}
        </p>
      )}

      {/* 動き。枠は公開と同じ守り。審査の相手のコードなので、ここでも親には何も届かない */}
      <div className="mt-3">
        <RevisionFrame frames={revision.frames} title={revision.title} stamp={revision.content_hash} initial="mobile" />
      </div>

      {/* 気になる書き方の印 */}
      <section className="mt-4">
        <h3 className="font-semibold">{text.flagsHeading(flags.length)}</h3>
        {flags.length === 0 ? (
          <p className="mt-1 text-small text-site-fg-2">{text.noFlags}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5" data-review-flags="">
            {flags.map((flag, index) => (
              <li key={`${index}-${flag.name}`} className="rounded-control bg-site-field px-3 py-2 text-small wrap-anywhere">
                <span className="font-semibold">{flag.name}</span>
                <span className="text-site-fg-2">
                  {' '}
                  {flag.file}:{flag.line}
                </span>
                <code className="mt-0.5 block font-mono text-site-fg-2">{flag.excerpt}</code>
              </li>
            ))}
          </ul>
        )}
        {check.required.length > 0 && (
          <div className="mt-2 rounded-control bg-site-field px-3 py-2 text-small">
            <p className="font-semibold">{text.requiredHeading(check.required.length)}</p>
            <ul className="mt-1 list-disc pl-4">
              {check.required.map((problem, index) => (
                <li key={index} className="wrap-anywhere">
                  {problemText(problem, locale).message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-small text-site-fg-2">{revision.tokens_ok ? text.tokensOk : text.tokensNo(check.optional.length)}</p>
      </section>

      {/* 承認と差し戻し。スマホでも親指の届く下に残す */}
      <div className="sticky bottom-20 z-30 mt-4 rounded-card border border-site-line bg-site-bg p-3 shadow-menu lg:bottom-3">
        {rejecting ? (
          <div>
            <label htmlFor={`${baseId}-reason`} className="block font-semibold">
              {text.reason}
            </label>
            <select id={`${baseId}-reason`} value={reason} onChange={(event) => setReason(event.target.value as RejectCode)} className={FIELD}>
              <option value="">{text.reasonChoose}</option>
              {REJECT_CODES.map((code) => (
                <option key={code} value={code}>
                  {copy.post.reject[code]}
                </option>
              ))}
            </select>
            <label htmlFor={`${baseId}-note`} className="mt-2 block font-semibold">
              {text.note}
            </label>
            <input id={`${baseId}-note`} type="text" value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} className={FIELD} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={onReject} disabled={!reason || sending} className={PRIMARY_BUTTON}>
                {text.rejectConfirm}
              </button>
              <button type="button" onClick={() => setRejecting(false)} className={WHITE_BUTTON}>
                {text.cancel}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={onApprove} disabled={sending} className={PRIMARY_BUTTON}>
              {text.approve}
            </button>
            <button type="button" onClick={() => setRejecting(true)} disabled={sending} className={WHITE_BUTTON}>
              {text.reject}
            </button>
          </div>
        )}
        {message && (
          <p role="alert" className="mt-2 text-small font-semibold">
            {message}
          </p>
        )}
      </div>

      {/* サムネイル、コード、差分。たたんでおく */}
      <Fold summary={text.thumbHeading}>
        <img src={revision.thumb} alt="" width={revision.thumb_w} height={revision.thumb_h} loading="lazy" className="mt-1 h-auto w-full max-w-sm rounded-control border border-site-line" />
      </Fold>
      <Fold summary={text.codeHeading}>
        <div className="mt-1">
          {(
            [
              ['part.html', code.html],
              ['part.css', code.css],
              ['part.js', code.js],
            ] as const
          ).map(
            ([name, source]) =>
              source !== null && (
                <div key={name} className="mt-3">
                  <h4 className="text-small font-semibold">{name}</h4>
                  <pre tabIndex={0} className={CODE_BOX}>
                    {source}
                  </pre>
                </div>
              ),
          )}
        </div>
      </Fold>
      {previous && (
        <Fold summary={text.diffHeading(previous.version)}>
          <DiffBlock name="part.html" before={previous.html} after={code.html} />
          <DiffBlock name="part.css" before={previous.css} after={code.css} />
          <DiffBlock name="part.js" before={previous.js ?? ''} after={code.js ?? ''} />
        </Fold>
      )}
    </article>
  );
}

/** 審査の画面（docs/tasks/T021.md 段階 C）。運営だけ（Worker が 404 にする）。古いものから順に、1件ずつ見る。 */
export function ReviewPage() {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.review;
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  useResetTitle();

  const load = useCallback(async (keep: string | null) => {
    try {
      const items = await fetchQueue();
      setQueue({ status: 'ready', items });
      setSelected(keep && items.some((item) => item.id === keep) ? keep : (items[0]?.id ?? null));
    } catch {
      setQueue({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    document.title = text.pageTitle;
    void load(null);
  }, [load, text.pageTitle]);

  const when = (time: number) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(time);

  return (
    <div className="max-w-[760px] pb-8 text-body text-site-fg md:pt-[27px]">
      <h1 className="text-title font-bold">{text.heading}</h1>
      {queue.status === 'error' && <p className="py-20 text-center text-site-fg-2">{text.loadError}</p>}
      {queue.status === 'ready' && queue.items.length === 0 && <p className="py-20 text-center text-site-fg-2">{text.empty}</p>}
      {queue.status === 'ready' && queue.items.length > 0 && (
        <>
          <p className="mt-1 text-site-fg-2">{text.count(queue.items.length)}</p>
          {selected && (
            <div className="mt-4">
              <ReviewItem key={selected} id={selected} onDone={() => void load(null)} />
            </div>
          )}
          <section className="mt-8 border-t border-site-line pt-5">
            <h2 className="font-semibold">{text.listHeading}</h2>
            <ol className="mt-2 flex flex-col gap-1" data-review-queue="">
              {queue.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={item.id === selected ? 'true' : undefined}
                    onClick={() => {
                      setSelected(item.id);
                      window.scrollTo(0, 0);
                    }}
                    className={`flex min-h-11 w-full flex-col items-start justify-center rounded-control px-3 py-1.5 text-left ${item.id === selected ? 'bg-site-hover' : 'hover:bg-site-hover'}`}
                  >
                    <span className="font-semibold wrap-anywhere">{item.title}</span>
                    <span className="text-small text-site-fg-2">
                      @{item.handle} · {text.version(item.version)}
                      {item.public ? ` · ${text.update}` : ''} · {when(item.submitted_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <ShareBlock />
    </div>
  );
}

/**
 * リンクで見せる作品を止める（SHARE001「7」）。報告で届いた /s/ の住所か、作品の ID を入れる。
 * 運営はここから作品の中身を読まない（T036）。返るのは ID と作者だけ。
 */
function ShareBlock() {
  const text = useCopy().share.review;
  const inputId = useId();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const send = async (action: 'block' | 'unblock') => {
    if (!address.trim() || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/review/shares/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) });
      const body = (await response.json().catch(() => null)) as { work_id?: string; handle?: string | null } | null;
      if (response.status === 404) setMessage(text.notFound);
      else if (!response.ok || typeof body?.work_id !== 'string') setMessage(text.failed);
      else setMessage(action === 'block' ? text.blocked(body.work_id, body.handle ?? null) : text.unblocked(body.work_id));
    } catch {
      setMessage(text.failed);
    }
    setBusy(false);
  };

  return (
    <section data-share-block="" className="mt-10 border-t border-site-line pt-5">
      <h2 className="font-semibold">{text.heading}</h2>
      <p className="mt-1 text-small text-site-fg-2">{text.intro}</p>
      <label htmlFor={inputId} className="mt-3 block text-small font-semibold">
        {text.address}
      </label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          id={inputId}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          className="h-11 min-w-0 flex-1 basis-64 rounded-control border border-site-line-2 bg-site-bg px-3 font-mono text-small"
        />
        <button type="button" disabled={busy} onClick={() => void send('block')} className="inline-flex h-11 items-center rounded-control bg-site-primary px-4 font-semibold text-site-bg disabled:opacity-60">
          {text.block}
        </button>
        <button type="button" disabled={busy} onClick={() => void send('unblock')} className="inline-flex h-11 items-center rounded-control border border-site-line-2 bg-site-bg px-4 font-semibold hover:bg-site-hover disabled:opacity-60">
          {text.unblock}
        </button>
      </div>
      <p role="status" className="mt-2 text-small empty:hidden">
        {message}
      </p>
    </section>
  );
}
