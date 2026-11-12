import { CircleAlert, Clock, CodeXml, EyeOff, Globe, Lock, PencilLine, Search, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { useCopy, useLocale } from '../hooks/useCopy';
import type { OwnWorksState } from '../hooks/useOwnWorks';
import { localizedPath } from '../i18n';
import type { OwnWork } from '../lib/post';
import { matchesFilter, stateOf, type WorkFilter, type WorkState } from '../lib/workState';

/** 状態の印（WS001「1」）。分け方は自分の作品のページと同じ（lib/workState.ts）。読み上げは札と同じ言葉 */
const STATE_ICONS: Record<WorkState, LucideIcon> = {
  public: Globe,
  private: Lock,
  submitted: Clock,
  draft: PencilLine,
  rejected: CircleAlert,
  revoked: EyeOff,
};

/** 今開いている作品の ID（/p/<id>）。basename があるので、/en は付いていない */
function currentWorkId(pathname: string): string | null {
  const match = /^\/p\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/** 題で絞る。大文字と小文字は分けない */
export function matchesQuery(work: Pick<OwnWork, 'title'>, query: string): boolean {
  const words = query.trim().toLocaleLowerCase();
  return words === '' || work.title.toLocaleLowerCase().includes(words);
}

const ROW = 'flex min-h-11 items-center gap-2.5 rounded-control px-2 py-1.5 text-site-fg';

function Row({ work, current, onPick }: { work: OwnWork; current: boolean; onPick?: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.ownNav;
  const state = stateOf(work);
  const Icon = STATE_ICONS[state];
  const title = work.title || copy.post.untitled;
  const className = `${ROW} ${current ? 'bg-site-hover font-semibold' : 'hover:bg-site-hover'}`;

  const body = (
    <>
      {work.thumb ? (
        <img src={work.thumb} alt="" width={40} height={25} loading="lazy" decoding="async" className="h-[25px] w-10 shrink-0 rounded-key border border-site-line bg-site-field object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-[25px] w-10 shrink-0 items-center justify-center rounded-key border border-site-line bg-site-field text-site-fg-2">
          <CodeXml size={14} strokeWidth={1.75} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body">{title}</span>
        <span className="block text-small text-site-fg-2">{text.version(work.version)}</span>
      </span>
      <span data-own-nav-state={state} title={copy.account.works.state[state]} className="flex size-6 shrink-0 items-center justify-center text-site-fg-2">
        <Icon size={15} strokeWidth={1.75} aria-hidden="true" />
        <span className="sr-only">{copy.account.works.state[state]}</span>
      </span>
    </>
  );

  // 作品のページは Worker が描くので、読み込み直して開く（自分だけの作品も今の開き方のまま。自分の作品のページと同じ）。
  // まだページのない作品（はじめの下書き、はじめて審査に出したもの）は、続きを書く画面か、自分の作品のページへ
  if (work.public || work.private) {
    return (
      <a href={localizedPath(locale, `/p/${encodeURIComponent(work.id)}`)} aria-current={current ? 'page' : undefined} onClick={onPick} className={className}>
        {body}
      </a>
    );
  }
  const to = work.status === 'draft' || work.status === 'rejected' ? `/new?work=${encodeURIComponent(work.id)}` : '/account/works';
  return (
    <Link to={to} reloadDocument={to.startsWith('/new')} onClick={onPick} className={className}>
      {body}
    </Link>
  );
}

interface OwnWorksListProps {
  state: OwnWorksState;
  query: string;
  filter?: WorkFilter;
  /** 行を押した（シートを閉じる） */
  onPick?: () => void;
}

/** 作品の並び（いちばん新しい版の日時の新しい順。GET /api/post/works がその順で返す）。PC の左のナビとスマホのシートで同じもの */
export function OwnWorksList({ state, query, filter = 'all', onPick }: OwnWorksListProps) {
  const copy = useCopy();
  const text = copy.ownNav;
  const { pathname } = useLocation();
  const currentId = currentWorkId(pathname);

  if (state.status === 'error') return <p className="px-2 py-3 text-small text-site-fg-2">{text.loadError}</p>;
  if (state.status !== 'ready') return <div aria-busy="true" className="min-h-11" />;
  if (state.works.length === 0) return <EmptyNote onPick={onPick} />;
  const shown = state.works.filter((work) => matchesFilter(work, filter) && matchesQuery(work, query));
  if (shown.length === 0) return <p className="px-2 py-3 text-small text-site-fg-2">{text.noMatch}</p>;
  return (
    <ul data-own-nav-list="" className="flex flex-col gap-0.5">
      {shown.map((work) => (
        <li key={work.id} data-own-nav-work={work.id}>
          <Row work={work} current={work.id === currentId} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

/** 作品が 0 の人：AI のつなぎ方へ（アカウントのページの「AI につなぐ」） */
function EmptyNote({ onPick }: { onPick?: () => void }) {
  const text = useCopy().ownNav;
  return (
    <div data-own-nav-empty="" className="px-2 py-2 text-small text-site-fg-2">
      <p>{text.empty}</p>
      <Link to="/account#ai-connect" onClick={onPick} className="mt-1 inline-flex min-h-11 items-center font-semibold text-site-fg underline">
        {text.connectAi}
      </Link>
    </div>
  );
}

/** 題で探す欄。form にしない（GA4 の拡張計測がフォームの操作を拾わないように。入力は外へ出さない） */
export function OwnWorksSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const text = useCopy().ownNav;
  return (
    <div className="relative">
      <Search size={16} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-site-fg-2" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={text.search}
        placeholder={text.search}
        autoComplete="off"
        enterKeyHint="search"
        className="h-11 w-full rounded-control bg-site-field pr-3 pl-9 text-input text-site-fg placeholder:text-site-fg-2 lg:text-body"
      />
    </div>
  );
}
