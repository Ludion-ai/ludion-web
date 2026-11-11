import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { FilterBar } from '../components/FilterBar';
import { Masonry } from '../components/Masonry';
import { NoscriptGrid } from '../components/NoscriptGrid';
import { useCopy } from '../hooks/useCopy';
import { useWorks } from '../hooks/useWorks';
import { parseHomeQuery, selectWorks } from '../lib/homeQuery';

export function Home() {
  const copy = useCopy();
  const { status, works } = useWorks();
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => parseHomeQuery(params), [params]);
  const visible = useMemo(() => selectWorks(works, query), [works, query]);

  const clearFilters = () =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('q');
      next.delete('c');
      next.delete('type');
      return next;
    });

  const isEmpty = status === 'ready' && visible.length === 0;
  const searchText = query.q.trim();

  return (
    <>
      <h1 className="sr-only">{copy.home.heading}</h1>
      <FilterBar category={query.category} sort={query.sort} params={params} />
      <p role="status" className="sr-only">
        {status === 'ready' ? copy.home.resultCount(visible.length) : ''}
      </p>

      <div className="mt-2 md:mt-4">
        {status === 'error' && <p className="py-20 text-center text-body text-site-fg-2">{copy.home.loadError}</p>}
        {isEmpty && (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <p className="text-body text-site-fg-2">
              {searchText ? copy.empty.noMatch(searchText) : copy.empty.noMatchFilters}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex h-11 items-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover"
            >
              {copy.empty.clear}
            </button>
          </div>
        )}
        {!isEmpty && status !== 'error' && (
          <>
            <Masonry works={visible} />
            <NoscriptGrid works={visible} />
          </>
        )}
      </div>
    </>
  );
}
