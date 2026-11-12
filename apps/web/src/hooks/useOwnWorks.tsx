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

/** 画面に戻ったときの読み直しは、前に読んでからこの時間（ミリ秒）がたってから。要求の数を抑える */
const BACK_GAP = 15_000;

/**
 * 左のナビとスマホのシートの「自分の作品」（WS001「3」）。GET /api/post/works を使う。
 * 本人の答え（GET /api/me）の後に読むので、最初の描画を待たせない。ページを移っても読み直さない（Shell の中に置く）。
 * 開いたとき、作品が 0 の人とログインしていない人は読みに行かない（ホームの API は GET /api/me の1本だけ。SPEC.md 10）。
 * ログインしている人は、画面に戻ったときに読み直す（ほかの所で置いた作品を拾う。開いたときに 0 だった人も）。定期的には読まない。
 */
export function OwnWorksProvider({ children }: { children: ReactNode }) {
  const { user, ready, worksCount } = useAccount();
  const [state, setState] = useState<OwnWorksState>({ status: 'idle' });
  const loading = useRef(0);
  /** 読んでいる途中の数。戻ったときの読み直しを重ねないため */
  const inFlight = useRef(0);
  /** 前に読んだ時刻。開いたときに「読まない」と決めた時刻も入れる（開いてすぐの focus で読まないように） */
  const readAt = useRef(0);

  /**
   * back：画面に戻ったときの読み直し。今の行を残したまま、答えに合わせる。
   * 行は作品の ID を key にしているので、順が変わっても同じ要素のままで、キーボードのフォーカスは React が同じ行に残す
   */
  const load = useCallback(async (back: boolean) => {
    const turn = ++loading.current;
    inFlight.current += 1;
    readAt.current = Date.now();
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    try {
      const works = await fetchOwnWorks();
      if (turn !== loading.current) return;
      if (!back) {
        setState({ status: 'ready', works: works === 'unauthorized' ? [] : works });
        return;
      }
      // ログインが切れていたら、今の並びのままにする（このページは、まだログインしている形）
      if (works === 'unauthorized') {
        setState((current) => (current.status === 'ready' ? current : { status: 'ready', works: [] }));
        return;
      }
      setState({ status: 'ready', works });
      // 0 → 1（と、その逆）で、ナビの形を開いたときと同じ決め方で決め直す
      settleNav(true, works.length);
    } catch {
      if (turn === loading.current) setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
    } finally {
      inFlight.current -= 1;
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      settleNav(false, 0);
      return;
    }
    settleNav(true, worksCount);
    if (worksCount > 0) void load(false);
    else {
      readAt.current = Date.now();
      setState({ status: 'ready', works: [] });
    }
  }, [ready, user, worksCount, load]);

  // 画面に戻ったとき：タブが見えるようになった、ウィンドウが選ばれた、戻るで前のページが出た（bfcache）
  useEffect(() => {
    if (!ready || !user) return;
    const back = () => {
      if (document.visibilityState !== 'visible' || inFlight.current > 0) return;
      const since = Date.now() - readAt.current;
      // 端末の時計が戻っていたら（負の値）、読む
      if (since >= 0 && since < BACK_GAP) return;
      void load(true);
    };
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) back();
    };
    document.addEventListener('visibilitychange', back);
    window.addEventListener('focus', back);
    window.addEventListener('pageshow', shown);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('focus', back);
      window.removeEventListener('pageshow', shown);
    };
  }, [ready, user, load]);

  const replace = useCallback((works: OwnWork[]) => {
    loading.current += 1;
    readAt.current = Date.now();
    setState({ status: 'ready', works });
  }, []);

  const value = useMemo<OwnWorks>(() => ({ state, reload: () => void load(false), replace }), [state, load, replace]);
  return <OwnWorksContext value={value}>{children}</OwnWorksContext>;
}

export function useOwnWorks(): OwnWorks {
  const value = useContext(OwnWorksContext);
  if (!value) throw new Error('useOwnWorks must be used inside OwnWorksProvider');
  return value;
}
