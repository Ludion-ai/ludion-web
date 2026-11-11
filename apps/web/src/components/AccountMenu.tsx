import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAccount } from '../hooks/useAccount';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localeOfPath, localizedPath, pathWithoutLocale } from '../i18n';
import { postLogout, type AccountUser } from '../lib/account';
import { useThemeSwitchWork } from '../lib/themeSwitches';
import { Avatar } from './Avatar';
import { LanguageLink } from './LanguageLink';
import { siteInfoLinks } from './navItems';

const ITEM =
  'flex h-9 w-full items-center rounded-key px-2.5 text-left text-small text-site-fg hover:bg-site-hover';

interface HeaderMenuProps {
  label: string;
  /** 1024px 以上で隠すなどの指定 */
  className?: string;
  buttonClassName: string;
  button: ReactNode;
  /** close はメニューを閉じて、フォーカスをボタンへ戻す */
  children: (close: () => void) => ReactNode;
}

/** ヘッダーのメニュー。キーボードの動きは並びのメニューと同じ（docs/tasks/T009.md「3」）。 */
function HeaderMenu({ label, className = '', buttonClassName, button, children }: HeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = items();
    const focused = all.indexOf(document.activeElement as HTMLElement);
    const last = all.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: focused === last ? 0 : focused + 1,
      ArrowUp: focused <= 0 ? last : focused - 1,
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      all[moves[event.key]]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
        className={buttonClassName}
      >
        {button}
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-50 mt-2 flex w-52 flex-col rounded-control border border-site-line-2 bg-site-bg p-1 shadow-menu"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

/** ヘッダーのスイッチの作品のページへ（docs/tasks/T035.md「3」、CLAUDE.md 原則4）。スイッチが出ていないときは出さない。 */
function ThemeSwitchItem({ close }: { close: () => void }) {
  const copy = useCopy();
  const work = useThemeSwitchWork();
  if (!work) return null;
  return (
    // 作品のページは Worker が描くので、読み込み直して開く（WorkCard と同じ）
    <Link to={`/p/${work.id}`} reloadDocument role="menuitem" onClick={close} className={ITEM}>
      {copy.themeSwitch.viewWork}
    </Link>
  );
}

/** サイトの情報。読み込み直して移る（<title> と canonical は Worker が入れる）。 */
function SiteInfoItems() {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <>
      {siteInfoLinks(copy, locale).map(({ label, href }) => (
        <a key={href} href={href} role="menuitem" className={ITEM}>
          {label}
        </a>
      ))}
      <LanguageLink role="menuitem" className={ITEM} />
    </>
  );
}

/**
 * ログインしていない人のメニュー（SPEC.md 3）。どの幅でも出す。中身はアカウントのメニューのうち、ログインしていなくても使うもので、並びも同じ。
 * JS が動かないときは、同じリンクを <noscript> でページの下に置く（App.tsx）。
 */
export function GuestMenu() {
  const copy = useCopy();
  return (
    <HeaderMenu
      label={copy.header.menu}
      buttonClassName="flex size-11 items-center justify-center rounded-control text-site-fg"
      button={<Ellipsis size={22} strokeWidth={1.75} aria-hidden="true" />}
    >
      {(close) => (
        <>
          <ThemeSwitchItem close={close} />
          <SiteInfoItems />
        </>
      )}
    </HeaderMenu>
  );
}

/** ログイン中のヘッダーのアバターとメニュー（docs/tasks/T009.md「3」）。 */
export function AccountMenu({ user }: { user: AccountUser }) {
  const copy = useCopy();
  const { canPost } = useAccount();
  return (
    <HeaderMenu
      label={copy.header.accountMenu}
      buttonClassName="flex size-11 items-center justify-center rounded-chip"
      button={<Avatar url={user.avatar_url} handle={user.handle} size={36} />}
    >
      {(close) => (
        <>
          <Link to="/account" role="menuitem" onClick={close} className={ITEM}>
            {copy.header.account}
          </Link>
          <Link to="/account/saved" role="menuitem" onClick={close} className={ITEM}>
            {copy.header.saved}
          </Link>
          {canPost && (
            <Link to="/new" reloadDocument role="menuitem" onClick={close} className={ITEM}>
              {copy.header.post}
            </Link>
          )}
          {user.review_pending !== undefined && (
            <Link to="/admin/review" reloadDocument role="menuitem" onClick={close} className={ITEM}>
              {copy.review.menu(user.review_pending)}
            </Link>
          )}
          <ThemeSwitchItem close={close} />
          <SiteInfoItems />
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              try {
                await postLogout();
              } catch {
                // ログアウトできていないので、今の画面のままにする
                close();
                return;
              }
              // アカウントのページはログインが要るので、ホームへ。ほかのページはそのまま読み込み直す
              if (pathWithoutLocale(window.location.pathname).startsWith('/account')) window.location.assign(localizedPath(localeOfPath(window.location.pathname), '/'));
              else window.location.reload();
            }}
            className={ITEM}
          >
            {copy.header.logout}
          </button>
        </>
      )}
    </HeaderMenu>
  );
}
