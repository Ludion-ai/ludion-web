import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import { RemixRibbon } from './RemixRibbon';
import { thumbUrl, type Work } from '../data/works';

/**
 * JS を止めたときの並び（SPEC.md 0）。等幅のグリッドに、同じ縦横比のサムネイル。
 * 石組みの位置は JS が決めるので、JS がないときは石組みを隠してこちらを出す。
 * JS が動くブラウザでは、<noscript> の中身は要素にならない。
 */
export function NoscriptGrid({ works }: { works: Work[] }) {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <noscript>
      <style>{'[data-masonry]{display:none}'}</style>
      <ul className="grid grid-cols-2 gap-2 max-md:-mx-4 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {works.map((work) => (
          <li key={work.id}>
            <a href={localizedPath(locale, `/p/${work.id}`)} className="relative block overflow-hidden rounded-card">
              <img
                src={thumbUrl(work)}
                alt=""
                width={work.thumb_w}
                height={work.thumb_h}
                loading="lazy"
                className="block aspect-[4/3] w-full bg-site-field object-cover object-top"
              />
              <RemixRibbon show={work.remix} />
              <span className="sr-only">
                {work.title} {copy.card.author(work.creator.handle)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </noscript>
  );
}
