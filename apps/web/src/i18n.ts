// サイトの言語（SPEC.md 9）。日本語は今の URL、英語は /en の下。
// キャッシュのキーは道と URL の値だけなので（worker/cachePolicy.ts）、言語は必ず URL で分ける。

import { copy, type Copy } from './copy';
import { copyEn } from './copy.en';

export type Locale = 'ja' | 'en';

export const EN_BASE = '/en';
const COPIES: Record<Locale, Copy> = { ja: copy, en: copyEn };

export const copyFor = (locale: Locale): Copy => COPIES[locale];

export const localeOfPath = (pathname: string): Locale =>
  pathname === EN_BASE || pathname.startsWith(`${EN_BASE}/`) ? 'en' : 'ja';

/** 言語のない道（/p/x）を、その言語の道（/en/p/x）にする。 */
export function localizedPath(locale: Locale, path: string): string {
  if (locale === 'ja') return path;
  return path === '/' ? EN_BASE : `${EN_BASE}${path}`;
}

/** React Router の basename */
export const routerBasename = (locale: Locale): string | undefined => (locale === 'en' ? EN_BASE : undefined);

/** 言語の道（/en/p/x）から、言語のない道（/p/x）を取り出す。 */
export function pathWithoutLocale(pathname: string): string {
  return localeOfPath(pathname) === 'en' ? pathname.slice(EN_BASE.length) || '/' : pathname;
}

