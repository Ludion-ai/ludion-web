import { Plus } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { activeNav, navItems } from './navItems';

export function Sidebar() {
  const copy = useCopy();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = activeNav(pathname, params);
  const { canPost } = useAccount();

  return (
    <aside className="hidden w-sidebar shrink-0 lg:block">
      {/* スクロールしても動かない。サイトの情報は、ヘッダーのメニュー（アカウントと「…」）にある（docs/tasks/T035.md「1」） */}
      <div className="sticky top-5 z-40 mt-5 flex flex-col items-center gap-4">
        <div className="flex flex-col items-center gap-2">
        <nav aria-label={copy.nav.label} className="flex flex-col items-center gap-2">
          {navItems(copy).map(({ id, label, to, icon: Icon }) => (
            <Link
              key={id}
              to={to}
              aria-label={label}
              aria-current={active === id ? 'page' : undefined}
              className={`group relative flex size-[46px] items-center justify-center rounded-control text-site-fg ${
                active === id ? 'bg-site-hover' : 'hover:bg-site-hover'
              }`}
            >
              <Icon size={22} strokeWidth={1.75} aria-hidden="true" />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-key bg-site-primary px-2 py-1 text-key text-site-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
              >
                {label}
              </span>
            </Link>
          ))}
        </nav>
        {/* 作品を置く（docs/tasks/T021.md）。読み込み直して移る。ログインの確かめと枠の見張りは Worker が入れる */}
        {canPost && (
          <Link
            to="/new"
            reloadDocument
            aria-label={copy.nav.post}
            className="group relative flex size-[46px] items-center justify-center rounded-control text-site-fg hover:bg-site-hover"
          >
            <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-key bg-site-primary px-2 py-1 text-key text-site-bg opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {copy.nav.post}
            </span>
          </Link>
        )}
        </div>
      </div>
    </aside>
  );
}
