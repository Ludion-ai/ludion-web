import { useCopy, useLocale } from '../hooks/useCopy';
import { LanguageLink } from './LanguageLink';
import { siteInfoLinks } from './navItems';

const LINK = 'whitespace-nowrap rounded-key py-1 text-small text-site-fg-2 hover:text-site-fg hover:underline';

/**
 * JS が動かないときのサイトの情報（docs/tasks/T035.md「1」）。ふだんはヘッダーのメニューにあるが、メニューは JS で開くので、ページの下に文字のリンクで置く。
 * JS が動くブラウザでは、<noscript> の中身は要素にならない。
 */
export function NoscriptSiteInfo() {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <noscript>
      <nav aria-label={copy.siteInfo.label} className="flex flex-wrap gap-x-4 px-6 pb-28 lg:pb-10 lg:pl-[82px]">
        {siteInfoLinks(copy, locale).map(({ label, href }) => (
          <a key={href} href={href} className={LINK}>
            {label}
          </a>
        ))}
        <LanguageLink className={LINK} />
      </nav>
    </noscript>
  );
}
