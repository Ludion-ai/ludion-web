import { Folder, PanelLeftOpen, Plus, type LucideIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { loginHref } from '../lib/account';
import { chooseNav, useNavOpen } from '../lib/navOpen';
import { loadOwnWorksPanel } from './ownWorksChunks';
import { activeNav, navItems } from './navItems';

// 開いた形の並びは、ログインしている人にしか要らないので、ホームの最初の JS に入れない（ログインの答えの後に読む）
const OwnWorksPanel = lazy(loadOwnWorksPanel);

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
  useEffect(() => {
    if (user) void loadOwnWorksPanel();
  }, [user]);

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
        {open && (
          <Suspense fallback={<div className="min-h-0 flex-1 border-t border-site-line" />}>
            <OwnWorksPanel canPost={canPost} />
          </Suspense>
        )}
      </div>
    </aside>
  );
}
