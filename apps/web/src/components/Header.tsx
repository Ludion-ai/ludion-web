import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath, pathWithoutLocale } from '../i18n';
import { useAccount } from '../hooks/useAccount';
import { loginHref } from '../lib/account';
import { MAX_SEARCH_LENGTH } from '../lib/homeQuery';
import { AccountMenu, GuestMenu } from './AccountMenu';
import { ThemeSwitch } from './ThemeSwitch';

const SEARCH_DEBOUNCE_MS = 150;

export function Header() {
  const copy = useCopy();
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { user } = useAccount();
  const [params] = useSearchParams();
  // 入力の途中の空白を消さないよう、ここでは長さだけを切る。検索に使う語は parseHomeQuery が揃える
  const urlQ = pathname === '/' ? (params.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH) : '';

  const inputRef = useRef<HTMLInputElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(urlQ);
  /** 767px以下で検索欄を開いているか。768px以上では常に見えるので使わない。 */
  const [searchOpen, setSearchOpen] = useState(urlQ !== '');

  // 入力が URL より先に進んでいるあいだは、URL の値で入力を上書きしない。
  const committed = useRef(urlQ);
  useEffect(() => {
    if (urlQ !== committed.current) {
      committed.current = urlQ;
      setValue(urlQ);
      if (urlQ === '') setSearchOpen(false);
    }
  }, [urlQ]);

  const commit = (next: string) => {
    committed.current = next;
    const onHome = pathWithoutLocale(window.location.pathname) === '/';
    const search = new URLSearchParams(onHome ? window.location.search : '');
    if (next) search.set('q', next);
    else search.delete('q');
    navigate({ pathname: '/', search: search.toString() }, { replace: onHome });
  };

  useEffect(() => {
    if (value === committed.current) return;
    const timer = setTimeout(() => commit(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // commit は描画ごとに変わるが、中で最新の URL を読むので value だけで足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const focusSearch = () => {
    flushSync(() => setSearchOpen(true));
    inputRef.current?.focus();
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        focusSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const closeSearch = () => {
    setValue('');
    if (committed.current !== '') commit('');
    flushSync(() => setSearchOpen(false));
    openButtonRef.current?.focus();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return;
    // type="search" は Esc で中身を消すので、止めてフォーカスを外すだけにする。
    event.preventDefault();
    event.currentTarget.blur();
    if (value === '' && searchOpen) {
      flushSync(() => setSearchOpen(false));
      openButtonRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (value !== committed.current) commit(value);
  };

  // 767px以下で検索欄を開いているあいだは、裏に隠れたものへ Tab で入らないようにする。
  const behindSearch = searchOpen ? 'max-md:invisible' : '';

  return (
    <header className="relative flex h-16 items-center bg-site-bg px-4 md:h-header md:px-6 lg:pr-6 lg:pl-[82px]">
      <Link
        to="/"
        className={`inline-flex shrink-0 items-center gap-2 rounded-key text-logo font-extrabold tracking-logo text-site-fg ${behindSearch}`}
      >
        {/* ロゴのマーク「」。キットの kagi-mark-inline.svg と同じ形。縦横比と2つの間隔は変えない */}
        <svg viewBox="8 8 80 80" width="20" height="20" aria-hidden="true" className="shrink-0">
          <path fill="currentColor" d="M8 8H56V24H24V72H8Z" />
          <path fill="var(--color-site-logo)" d="M88 88H40V72H72V24H88Z" />
        </svg>
        {/* 374px 以下は（360〜370px も収まらないため、CTO の答え1の 359px から広げた）、スイッチが増えても1行に収まるよう、文字を隠してマークだけにする。読み上げの名前は残す（docs/tasks/T035.md「11/11 0:50 の CTO の答え」1） */}
        <span className="max-[375px]:sr-only">{copy.brand}</span>
      </Link>

      <form
        role="search"
        onSubmit={onSubmit}
        className={`absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 items-center md:inset-x-auto md:left-1/2 md:flex md:w-[46vw] md:-translate-x-1/2 lg:w-[min(668px,46vw,calc(100vw-568px))] ${
          searchOpen ? 'flex' : 'hidden'
        }`}
      >
        <Search
          size={22}
          aria-hidden="true"
          className="pointer-events-none absolute left-4 text-site-fg"
        />
        <input
          ref={inputRef}
          type="search"
          value={value}
          maxLength={MAX_SEARCH_LENGTH}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={copy.search.placeholder}
          aria-label={copy.search.label}
          enterKeyHint="search"
          className="h-11 w-full min-w-0 truncate rounded-control bg-site-field pr-12 pl-[49px] text-body text-site-fg placeholder:text-site-fg-3 md:pr-[68px]"
        />
        {/* Mac かどうかは index.html が先に決める。React が届く前から正しいキーを見せるため CSS で切り替える */}
        <kbd className="pointer-events-none absolute right-4 hidden rounded-key bg-site-key px-1.5 py-0.5 font-sans text-key text-site-fg-3 md:block">
          <span className="flex items-center gap-[7px] not-mac:hidden">
            {copy.search.keyMac.map((key) => (
              <span key={key}>{key}</span>
            ))}
          </span>
          <span className="flex items-center gap-[7px] mac:hidden">
            {copy.search.keyOther.map((key) => (
              <span key={key}>{key}</span>
            ))}
          </span>
        </kbd>
        <button
          type="button"
          onClick={closeSearch}
          aria-label={copy.header.closeSearch}
          className="absolute right-0 flex size-11 items-center justify-center rounded-control text-site-fg-3 md:hidden"
        >
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </form>

      <div className={`ml-auto flex items-center gap-1 ${behindSearch}`}>
        {/* ライトとダーク（docs/tasks/T035.md「3」）。アバター（または「…」とログイン）の左、767px 以下では検索のボタンの左 */}
        <ThemeSwitch />
        <button
          ref={openButtonRef}
          type="button"
          onClick={focusSearch}
          aria-label={copy.header.openSearch}
          className="flex size-11 items-center justify-center rounded-control text-site-fg md:hidden"
        >
          <Search size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {user ? (
          <AccountMenu user={user} />
        ) : (
          // HTML は人によって変えない。ログインしている人のアバターは、読み込みの後に入れ替わる（SPEC.md 10）
          <>
            <GuestMenu />
            <a
              href={loginHref(pathname === '/login' || pathname === '/signup' ? (params.get('next') ?? localizedPath(locale, '/')) : localizedPath(locale, pathname) + search)}
              className="inline-flex h-11 items-center justify-center rounded-control px-3 text-body font-semibold whitespace-nowrap text-site-fg hover:bg-site-hover"
            >
              {copy.header.login}
            </a>
          </>
        )}
      </div>
    </header>
  );
}
