import { Bookmark, Compass, House, type LucideIcon } from 'lucide-react';
import type { Copy } from '../copy';
import { localizedPath, type Locale } from '../i18n';

export type NavId = 'home' | 'explore' | 'saved';

export const navItems = (copy: Copy): { id: NavId; label: string; to: string; icon: LucideIcon }[] => [
  { id: 'home', label: copy.nav.home, to: '/', icon: House },
  { id: 'explore', label: copy.nav.explore, to: '/?sort=new', icon: Compass },
  { id: 'saved', label: copy.nav.saved, to: '/account/saved', icon: Bookmark },
];

/** 利用規約、プライバシー、運営者。ヘッダーのメニュー（アカウントと「…」）と、JS が動かないときのページの下（docs/tasks/T035.md「1」）。 */
export const siteInfoLinks = (copy: Copy, locale: Locale): { label: string; href: string }[] => [
  { label: copy.siteInfo.terms, href: localizedPath(locale, '/terms') },
  { label: copy.siteInfo.privacy, href: localizedPath(locale, '/privacy') },
  { label: copy.siteInfo.about, href: localizedPath(locale, '/about') },
];

/** 今いる項目（SPEC.md 3、4）。どれにも当たらないページでは null。 */
export function activeNav(pathname: string, params: URLSearchParams): NavId | null {
  if (pathname === '/account/saved') return 'saved';
  if (pathname !== '/') return null;
  if (params.get('sort') === 'new') return 'explore';
  return 'home';
}
