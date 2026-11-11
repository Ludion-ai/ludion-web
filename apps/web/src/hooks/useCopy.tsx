import { createContext, useContext, type ReactNode } from 'react';
import type { Copy } from '../copy';
import { copyFor, type Locale } from '../i18n';

const LocaleContext = createContext<Locale>('ja');

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = (): Locale => useContext(LocaleContext);

/** 今の言語の画面の文字。Worker は同時に別の言語を描くので、モジュールの変数にはしない。 */
export const useCopy = (): Copy => copyFor(useLocale());
