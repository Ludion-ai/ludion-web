import { Folder } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy } from '../hooks/useCopy';
import { activeNav, navItems } from './navItems';
import { loadOwnWorksSheet } from './ownWorksChunks';

// シートはログインしている人にしか要らないので、ホームの最初の JS に入れない（ログインの答えの後に読み始める）
const OwnWorksSheet = lazy(loadOwnWorksSheet);

const TAB = 'pointer-events-auto flex size-12 items-center justify-center rounded-tab bg-site-tab backdrop-blur-md';
const tone = (current: boolean) => (current ? 'text-site-bg dark:text-site-fg' : 'text-site-bg/65 dark:text-site-fg/65');

/**
 * 幅1023px以下のサイドバーの代わり（SPEC.md 3、5）。画面の下の中央に浮いたボタン。
 * ログインしている人だけ、3つ目に「作品」を足して4つ（ホーム、探す、作品、保存。WS001「2」）。押すと下からシート。
 * ボタンの間も中身を押せるよう、帯の方は押せないようにする。
 */
export function BottomTabs() {
  const copy = useCopy();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = activeNav(pathname, params);
  const { user } = useAccount();
  const [sheetAnchor, setSheetAnchor] = useState<HTMLElement | null>(null);
  const items = navItems(copy);
  const onWorks = pathname === '/account/works';
  useEffect(() => {
    if (user && window.matchMedia('(max-width: 1023px)').matches) void loadOwnWorksSheet();
  }, [user]);

  const tab = ({ id, label, to, icon: Icon }: (typeof items)[number]) => (
    <Link key={id} to={to} aria-label={label} aria-current={active === id ? 'page' : undefined} className={`${TAB} ${tone(active === id)}`}>
      <Icon size={22} strokeWidth={active === id ? 2.5 : 1.75} aria-hidden="true" />
    </Link>
  );

  return (
    <nav aria-label={copy.nav.label} className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center gap-2 lg:hidden">
      {items.slice(0, 2).map(tab)}
      {user && (
        <button
          type="button"
          aria-label={copy.ownNav.tab}
          aria-haspopup="dialog"
          aria-expanded={sheetAnchor !== null}
          onClick={(event) => setSheetAnchor(event.currentTarget)}
          className={`${TAB} ${tone(onWorks)}`}
        >
          <Folder size={22} strokeWidth={onWorks ? 2.5 : 1.75} aria-hidden="true" />
        </button>
      )}
      {items.slice(2).map(tab)}
      {sheetAnchor && (
        <Suspense fallback={null}>
          <OwnWorksSheet anchor={sheetAnchor} onClose={() => setSheetAnchor(null)} />
        </Suspense>
      )}
    </nav>
  );
}
