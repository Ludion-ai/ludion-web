import { ChevronLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Masonry } from '../components/Masonry';
import { useCopy } from '../hooks/useCopy';
import type { Work } from '../data/works';
import { useResetTitle } from '../hooks/useResetTitle';
import { fetchBookmarks, fetchLikedWorks, goToLogin } from '../lib/account';

type ListState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; works: Work[] };

interface WorkListProps {
  load: () => Promise<Work[] | 'unauthorized'>;
  text: { pageTitle: string; heading: string; empty: string; loadError: string };
}

/**
 * 本人の作品の一覧（docs/tasks/T009.md「3」、T020「2」）。人によって変わるので、HTML には入れずブラウザで読む。
 * しおりやいいねを外したカードは、開いている間は残す（押し間違いをその場で戻せるように。次に開くと消える）。
 */
function WorkList({ load, text }: WorkListProps) {
  const copy = useCopy();
  const [state, setState] = useState<ListState>({ status: 'loading' });
  useResetTitle();

  useEffect(() => {
    document.title = text.pageTitle;
    let current = true;
    load().then(
      (works) => {
        if (!current) return;
        if (works === 'unauthorized') goToLogin();
        else setState({ status: 'ready', works });
      },
      () => {
        if (current) setState({ status: 'error' });
      },
    );
    return () => {
      current = false;
    };
  }, [load, text.pageTitle]);

  return (
    <>
      <h1 className="sr-only">{text.heading}</h1>
      <div className="md:mt-[27px]">
        <Link to="/account" className="mb-3 inline-flex h-11 items-center gap-1 rounded-control pr-3 text-body text-site-fg-2 hover:text-site-fg">
          <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
          {copy.account.heading}
        </Link>
        {state.status === 'error' && <p className="py-20 text-center text-body text-site-fg-2">{text.loadError}</p>}
        {state.status === 'ready' && state.works.length === 0 && <p className="py-20 text-center text-body text-site-fg-2">{text.empty}</p>}
        {state.status === 'ready' && state.works.length > 0 && <Masonry works={state.works} />}
      </div>
    </>
  );
}

export function SavedPage() {
  return <WorkList load={fetchBookmarks} text={useCopy().saved} />;
}

export function LikedPage() {
  return <WorkList load={fetchLikedWorks} text={useCopy().account.likes} />;
}
