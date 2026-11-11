import { Link } from 'react-router';
import type { Copy } from '../copy';
import { useCopy } from '../hooks/useCopy';
import { categoryHref, sortHref, type Category, type Sort } from '../lib/homeQuery';
import { chipClass } from './chip';

const chips = (copy: Copy): { value: Category | null; label: string }[] => [
  { value: null, label: copy.filters.all },
  { value: 'web', label: copy.filters.web },
  { value: 'mobile', label: copy.filters.mobile },
  { value: 'dashboard', label: copy.filters.dashboard },
  { value: 'ecommerce', label: copy.filters.ecommerce },
  { value: 'minimal', label: copy.filters.minimal },
  { value: 'experimental', label: copy.filters.experimental },
  { value: 'motion', label: copy.filters.motion },
  { value: 'wallpaper', label: copy.filters.wallpaper },
];

const sorts = (copy: Copy): { value: Sort; label: string }[] => [
  { value: 'popular', label: copy.sort.popular },
  { value: 'new', label: copy.sort.newest },
];

type FilterBarProps = {
  category: Category | null;
  sort: Sort;
  params: URLSearchParams;
};

/** チップと並びはリンク。JS が届く前でも押せば移れて、URL を人に送れる（SPEC.md 3）。 */
export function FilterBar({ category, sort, params }: FilterBarProps) {
  const copy = useCopy();
  return (
    <div className="flex items-center gap-4">
      {/*
        フォーカスの枠が切れないよう、はみ出す分だけ余白をとって打ち消す。スマホでは本文の余白も打ち消して端まで流す。
        Tab の移動は scroll-padding を見ないので、フォーカスのときに余白ごと画面に入れる。
      */}
      <div
        role="group"
        aria-label={copy.filters.label}
        onFocus={(event) => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
        className="no-scrollbar -my-1 flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 max-md:-mx-4 max-md:scroll-px-2 max-md:px-2 md:-mx-1 md:scroll-px-1 md:px-1"
      >
        {chips(copy).map(({ value, label }) => (
          <Link
            key={label}
            to={categoryHref(params, value)}
            aria-current={category === value ? 'true' : undefined}
            className={chipClass(category === value)}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* スマホには置かない。新着は下のタブの「探す」から見る */}
      <div role="group" aria-label={copy.sort.label} className="flex shrink-0 gap-1 max-md:hidden">
        {sorts(copy).map(({ value, label }) => (
          <Link
            key={value}
            to={sortHref(params, value)}
            aria-current={sort === value ? 'true' : undefined}
            className={`inline-flex h-8 items-center rounded-chip px-3 text-small font-semibold ${
              sort === value ? 'bg-site-hover text-site-fg' : 'text-site-fg-2 hover:text-site-fg'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
