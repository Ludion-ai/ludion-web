/**
 * 作品のページの #root より前で、インラインで動かす（worker/ssr.ts が埋め込む）。PERF002「1」。
 * 枠を読み始める関数を置くだけで、ここでは呼ばない。呼ぶのは、枠の入れ物の直後の台本（WorkPage.tsx の PREVIEW_START_CALL）。
 */
import { startPreview } from './lib/previewStart';

declare global {
  interface Window {
    __ldStartPreview?: () => void;
  }
}

window.__ldStartPreview = startPreview;
