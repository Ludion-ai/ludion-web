import { Folder, PanelLeftClose, PanelLeftOpen, Plus, type LucideIcon } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { useOwnWorks } from '../hooks/useOwnWorks';
import { loginHref } from '../lib/account';
import { chooseNav, useNavOpen } from '../lib/navOpen';
import { OwnWorksList, OwnWorksSearch } from './OwnWorksList';
import { activeNav, navItems } from './navItems';

const ITEM = 'group relative flex items-center rounded-control text-site-fg';
const SQUARE = `${ITEM} size-[46px] justify-center`;
const TIP =
  'pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-key bg-site-primary px-2 py-1 text-key text-site-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100';

/**
 * アイコン。開いた形でもたたんだ形でも同じ位置（左から11px）。開いた形は 46px の箱に入れて、右に名前を出す。
 * たたんだ形は今までと同じく、項目の中にアイコンとツールチップだけを置く
 */
function IconBox({ icon: Icon, boxed = false }: { icon: LucideIcon; boxed?: boolean }) {
  const icon = <Icon size={22} strokeWidth={1.75} aria-hidden="true" />;
  return boxed ? <span className="flex size-[46px] shrink-0 items-center justify-center">{icon}</span> : icon;
}

/** たたんだ形の右に出るツールチップ。id を付けたものは aria-describedby で読み上げる */
function Tip({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} aria-hidden={id ? undefined : true} className={TIP}>
      {children}
    </span>
  );
}

/**
 * 左のナビ（SPEC.md 3、WS001）。たたんだ形（68px）はアイコンだけ、開いた形（264px）はアイコンに名前と、自分の作品の並び。
 * HTML は人によって変えないので、Worker の描画はたたんだ形。幅は <html data-nav> で決まる（lib/navOpen.ts）。
 */
export function Sidebar() {
  const copy = useCopy();
  const text = copy.ownNav;
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = activeNav(pathname, params);
  const { user, canPost } = useAccount();
  const open = useNavOpen() && user !== null;
  const onWorks = pathname === '/account/works';
  const loggedOutHint = useId();

  return (
    <aside data-nav-form={open ? 'open' : 'closed'} className="hidden w-sidebar shrink-0 lg:block lg:nav-open:w-sidebar-open">
      {/* スクロールしても動かない。サイトの情報は、ヘッダーのメニュー（アカウントと「…」）にある（docs/tasks/T035.md「1」） */}
      <div
        className={`sticky top-5 z-40 mt-5 flex flex-col gap-4 ${
          open ? 'max-h-[calc(100dvh-var(--spacing-header)-40px)] items-stretch px-[11px]' : 'items-start px-[11px]'
        }`}
      >
        <div className={`flex flex-col gap-2 ${open ? 'items-stretch' : 'items-start'}`}>
          <nav aria-label={copy.nav.label} className={`flex flex-col gap-2 ${open ? 'items-stretch' : 'items-start'}`}>
            {navItems(copy).map(({ id, label, to, icon }) => (
              <Link
                key={id}
                to={to}
                aria-label={label}
                aria-current={active === id ? 'page' : undefined}
                className={`${open ? `${ITEM} h-[46px] pr-3` : SQUARE} ${active === id ? 'bg-site-hover' : 'hover:bg-site-hover'}`}
              >
                <IconBox icon={icon} boxed={open} />
                {open ? <span className="truncate text-body font-semibold">{label}</span> : <Tip>{label}</Tip>}
              </Link>
            ))}
          </nav>
          {/* 作品を置く（docs/tasks/T021.md）。読み込み直して移る。開いた形では「自分の作品」の横の「＋ 新しく」 */}
          {canPost && !open && (
            <Link to="/new" reloadDocument aria-label={copy.nav.post} className={`${SQUARE} hover:bg-site-hover`}>
              <IconBox icon={Plus} />
              <Tip>{copy.nav.post}</Tip>
            </Link>
          )}
          {/* 自分の作品（WS001）。ログインしていない人はログインへ。「ログインすると…」の1行はツールチップに出し、読み上げる */}
          {!open &&
            (user ? (
              <Link to="/account/works" aria-label={text.heading} aria-current={onWorks ? 'page' : undefined} className={`${SQUARE} ${onWorks ? 'bg-site-hover' : 'hover:bg-site-hover'}`}>
                <IconBox icon={Folder} />
                <Tip>{text.heading}</Tip>
              </Link>
            ) : (
              <a href={loginHref('/account/works')} aria-label={text.heading} aria-describedby={loggedOutHint} className={`${SQUARE} hover:bg-site-hover`}>
                <IconBox icon={Folder} />
                <Tip id={loggedOutHint}>{text.loggedOut}</Tip>
              </a>
            ))}
          {user && !open && (
            <button type="button" aria-label={text.expandLabel} aria-expanded={false} onClick={() => chooseNav(true)} className={`${SQUARE} hover:bg-site-hover`}>
              <IconBox icon={PanelLeftOpen} />
              <Tip>{text.expandLabel}</Tip>
            </button>
          )}
        </div>
        {open && <OwnWorksPanel canPost={canPost} />}
      </div>
    </aside>
  );
}

/** 開いた形の「自分の作品」：見出しと「＋ 新しく」、題で探す欄、並び、「すべての作品」、「たたむ」 */
function OwnWorksPanel({ canPost }: { canPost: boolean }) {
  const copy = useCopy();
  const text = copy.ownNav;
  const { state } = useOwnWorks();
  const [query, setQuery] = useState('');
  const hasWorks = state.status === 'ready' && state.works.length > 0;

  return (
    <section aria-label={text.heading} data-own-nav="sidebar" className="flex min-h-0 flex-1 flex-col gap-2 border-t border-site-line pt-4">
      <div className="flex items-center justify-between gap-2 pl-2">
        <Link to="/account/works" className="text-small font-semibold text-site-fg-2 hover:text-site-fg">
          {text.heading}
        </Link>
        {canPost && (
          <Link to="/new" reloadDocument aria-label={text.newWorkLabel} className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-small font-semibold text-site-fg hover:bg-site-hover">
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {text.newWork}
          </Link>
        )}
      </div>
      {hasWorks && <OwnWorksSearch value={query} onChange={setQuery} />}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <OwnWorksList state={state} query={query} />
      </div>
      <div className="flex flex-col gap-1 border-t border-site-line pt-2 pb-2">
        {hasWorks && (
          <Link to="/account/works" className="flex min-h-11 items-center rounded-control px-2 text-body font-semibold text-site-fg hover:bg-site-hover">
            {text.all}
          </Link>
        )}
        <button type="button" aria-label={text.collapseLabel} aria-expanded onClick={() => chooseNav(false)} className="flex h-11 items-center rounded-control pr-3 text-body text-site-fg-2 hover:bg-site-hover hover:text-site-fg">
          <span className="flex size-[46px] shrink-0 items-center justify-center">
            <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          {text.collapse}
        </button>
      </div>
    </section>
  );
}
