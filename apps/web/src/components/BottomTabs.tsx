import { Link, useLocation, useSearchParams } from 'react-router';
import { useCopy } from '../hooks/useCopy';
import { activeNav, navItems } from './navItems';

/**
 * 幅1023px以下のサイドバーの代わり（SPEC.md 3、5）。画面の下の中央に浮いた3つのボタン。
 * ボタンの間も中身を押せるよう、帯の方は押せないようにする。
 */
export function BottomTabs() {
  const copy = useCopy();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const active = activeNav(pathname, params);

  return (
    <nav
      aria-label={copy.nav.label}
      className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center gap-2 lg:hidden"
    >
      {navItems(copy).map(({ id, label, to, icon: Icon }) => (
        <Link
          key={id}
          to={to}
          aria-label={label}
          aria-current={active === id ? 'page' : undefined}
          className={`pointer-events-auto flex size-12 items-center justify-center rounded-tab bg-site-tab backdrop-blur-md ${
            active === id ? 'text-site-bg dark:text-site-fg' : 'text-site-bg/65 dark:text-site-fg/65'
          }`}
        >
          <Icon size={22} strokeWidth={active === id ? 2.5 : 1.75} aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}
