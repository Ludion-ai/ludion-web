import { PanelLeftClose, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCopy } from '../hooks/useCopy';
import { useOwnWorks } from '../hooks/useOwnWorks';
import { chooseNav } from '../lib/navOpen';
import { OwnWorksList, OwnWorksSearch } from './OwnWorksList';

/** 開いた形の「自分の作品」：見出しと「＋ 新しく」、題で探す欄、並び、「すべての作品」、「たたむ」 */
export function OwnWorksPanel({ canPost }: { canPost: boolean }) {
  const copy = useCopy();
  const text = copy.ownNav;
  const { state } = useOwnWorks();
  const [query, setQuery] = useState('');
  const hasWorks = state.status === 'ready' && state.works.length > 0;

  return (
    <section aria-label={text.heading} data-own-nav="sidebar" className="flex min-h-0 flex-1 flex-col gap-2 border-t border-site-line pt-4">
      <div className="flex items-center justify-between gap-2 pl-2">
        <Link to="/account/works" className="text-small font-semibold text-site-fg-2 hover:text-site-fg">
          {text.heading}
        </Link>
        {canPost && (
          <Link to="/new" reloadDocument aria-label={text.newWorkLabel} className="inline-flex h-8 items-center gap-1 rounded-control px-2 text-small font-semibold text-site-fg hover:bg-site-hover">
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
            {text.newWork}
          </Link>
        )}
      </div>
      {hasWorks && <OwnWorksSearch value={query} onChange={setQuery} />}
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <OwnWorksList state={state} query={query} />
      </div>
      <div className="flex flex-col gap-1 border-t border-site-line pt-2 pb-2">
        {hasWorks && (
          <Link to="/account/works" className="flex min-h-11 items-center rounded-control px-2 text-body font-semibold text-site-fg hover:bg-site-hover">
            {text.all}
          </Link>
        )}
        <button type="button" aria-label={text.collapseLabel} aria-expanded onClick={() => chooseNav(false)} className="flex h-11 items-center rounded-control pr-3 text-body text-site-fg-2 hover:bg-site-hover hover:text-site-fg">
          <span className="flex size-[46px] shrink-0 items-center justify-center">
            <PanelLeftClose size={20} strokeWidth={1.75} aria-hidden="true" />
          </span>
          {text.collapse}
        </button>
      </div>
    </section>
  );
}
