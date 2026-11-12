import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { settleNav } from '../lib/navOpen';
import { fetchOwnWorks, type OwnWork } from '../lib/post';
import { useAccount } from './useAccount';

export type OwnWorksState = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ready'; works: OwnWork[] };

type OwnWorks = {
  state: OwnWorksState;
  /** 読み直す（作品を置いた、直した後） */
  reload: () => void;
  /** ほかで読んだ答えに合わせる（自分の作品のページ） */
  replace: (works: OwnWork[]) => void;
};

const OwnWorksContext = createContext<OwnWorks | null>(null);

/**
 * 左のナビとスマホのシートの「自分の作品」（WS001「3」）。GET /api/post/works を使う。
 * 本人の答え（GET /api/me）の後に読むので、最初の描画を待たせない。ページを移っても読み直さない（Shell の中に置く）。
 * 作品が 0 の人とログインしていない人は読みに行かない（ホームの API は GET /api/me の1本だけ。SPEC.md 10）。
 */
export function OwnWorksProvider({ children }: { children: ReactNode }) {
  const { user, ready, worksCount } = useAccount();
  const [state, setState] = useState<OwnWorksState>({ status: 'idle' });
  const loading = useRef(0);

  const load = useCallback(async () => {
    const turn = ++loading.current;
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    try {
      const works = await fetchOwnWorks();
      if (turn !== loading.current) return;
      setState(works === 'unauthorized' ? { status: 'ready', works: [] } : { status: 'ready', works });
    } catch {
      if (turn === loading.current) setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      settleNav(false, 0);
      return;
    }
    settleNav(true, worksCount);
    if (worksCount > 0) void load();
    else setState({ status: 'ready', works: [] });
  }, [ready, user, worksCount, load]);

  const replace = useCallback((works: OwnWork[]) => {
    loading.current += 1;
    setState({ status: 'ready', works });
  }, []);

  const value = useMemo<OwnWorks>(() => ({ state, reload: () => void load(), replace }), [state, load, replace]);
  return <OwnWorksContext value={value}>{children}</OwnWorksContext>;
}

export function useOwnWorks(): OwnWorks {
  const value = useContext(OwnWorksContext);
  if (!value) throw new Error('useOwnWorks must be used inside OwnWorksProvider');
  return value;
}
