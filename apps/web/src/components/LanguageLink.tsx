import { useLocation } from 'react-router';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath, type Locale } from '../i18n';

/** 切り替えで選んだ言語を覚える（index.html のインラインのスクリプトが読む）。自動で判定した言語は覚えない。 */
function rememberLanguage(locale: Locale): void {
  const secure = location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `ld_lang=${locale}; path=/; max-age=31536000; samesite=lax${secure}`;
}

/** もう一方の言語の、同じページへのリンク。押すと選んだ言語を覚え、次からはブラウザの言語より優先する。 */
export function LanguageLink({ className, role }: { className: string; role?: 'menuitem' }) {
  const copy = useCopy();
  const other: Locale = useLocale() === 'ja' ? 'en' : 'ja';
  const { pathname, search } = useLocation();

  return (
    <a
      href={localizedPath(other, pathname) + search}
      hrefLang={other}
      lang={other}
      role={role}
      aria-label={copy.language.switchLabel}
      onClick={() => rememberLanguage(other)}
      className={className}
    >
      {copy.language.switchTo}
    </a>
  );
}
