import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { codePath, fileOfSplat, type LineRange } from '../lib/codeAddress';

/** 行の住所へ移るときに、履歴に持たせる印 */
export interface CodeLinkState {
  /** この作品のページの中で本文を開いた（閉じるときは、履歴を1つ戻す）。住所で直接開いたなら false */
  fromPage: boolean;
  /** 行の番号を押して選んだ（本文を送らない） */
  stay?: boolean;
}

/**
 * 行の住所（/p/<id>/code/<file>#L…）へ移る（WS003）。木、目次、行の番号、「この作品について」の印が、同じ移り方をする。
 * 本文を開いている間の移動は、履歴を増やさない（戻るは1回で、開く前の画面に戻る）。同じルートの中なので、ページは読み込み直さない。
 */
/** base：作品の道（言語のない /p/<id>、リンクで見せるページは /s/<合言葉>。SHARE001） */
export function useCodeLink(base: string) {
  const navigate = useNavigate();
  const location = useLocation();
  const openFile = fileOfSplat(useParams()['*']);
  const fromPage = openFile === null ? true : (location.state as CodeLinkState | null)?.fromPage === true;

  const go = useCallback(
    (file: string, range: LineRange | null, options: { stay?: boolean } = {}) => {
      const state: CodeLinkState = { fromPage, ...(options.stay ? { stay: true } : {}) };
      navigate(codePath(base, file, range), { replace: openFile !== null, state });
    },
    [navigate, base, openFile, fromPage],
  );
  /** 本文を閉じる。この画面の中で開いたなら履歴を1つ戻し、住所で直接開いたなら作品のページへ替える */
  const close = useCallback(() => {
    if (openFile !== null && fromPage) navigate(-1);
    else navigate(base, { replace: true });
  }, [navigate, base, openFile, fromPage]);

  return { openFile, go, close, stay: (location.state as CodeLinkState | null)?.stay === true };
}
