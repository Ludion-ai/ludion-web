import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchWorks, type Work } from '../data/works';

type WorksState = { status: 'loading' | 'ready' | 'error'; works: Work[] };

const WorksContext = createContext<{ state: WorksState; load: () => void } | null>(null);

/**
 * 展示の一覧。Worker が HTML に埋め込んだ一覧（initial）から始め、ブラウザで取り直さない（SPEC.md 10）。
 * 一覧のないページ（initial が null）からホームへ移ったときだけ、1回取りに行く。
 */
export function WorksProvider({ initial, children }: { initial: Work[] | null; children: ReactNode }) {
  const [state, setState] = useState<WorksState>(() =>
    initial ? { status: 'ready', works: initial } : { status: 'loading', works: [] },
  );
  const started = useRef(initial !== null);

  const load = useCallback(() => {
    if (started.current) return;
    started.current = true;
    fetchWorks().then(
      (works) => setState({ status: 'ready', works }),
      () => setState({ status: 'error', works: [] }),
    );
  }, []);

  return <WorksContext value={{ state, load }}>{children}</WorksContext>;
}

export function useWorks(): WorksState {
  const value = useContext(WorksContext);
  if (!value) throw new Error('useWorks must be used inside WorksProvider');
  const { state, load } = value;
  useEffect(load, [load]);
  return state;
}
