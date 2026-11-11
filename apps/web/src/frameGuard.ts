/**
 * 作品の枠の見張り（docs/tasks/T012.md「3」）。作品のページの #root より前で、インラインで動かす（worker/ssr.ts が埋め込む）。
 * React を待つと、最初の load を見逃して、1回目の移動を数え損なう。
 *
 * sandbox の中は親から見えないので、次の2つで「枠が自分で移った」と見なし、元の URL で読み直す。
 * - 枠の load が2回起きた（読み込みの後に移った）
 * - load が起きたのに、Ludion の枠の文書から「読み込めた」の知らせが来ない（読み込みの途中に移った。元の文書の load は起きず、親には移った先の load が1回だけ見える）
 *   知らせは packages/render の buildFrameHtml が、作品の JS より先に仕掛ける。枠が別のプロセスのときは load より遅れて届くことがあるので、少し待つ。
 *
 * 外への移動そのものは、親のページの応答の CSP（frame-src 'self'。worker/securityHeaders.ts）が止める（docs/tasks/T022.md「1」）。
 * ここは2枚目の守りで、止められた枠（ブラウザのエラーの画面）や、同じサイトの中で移った枠を、元の作品へ戻す。
 * 知らせは真似できるので、これだけでは守りにならない（SEC001 の R1）。
 * 読み込むたびに移る作品は、MAX_RESTORES 回で読み直しをやめて空にする。もう一度（Replay）で作り直せば、また数える。
 * ヘッダーのスイッチの枠（data-ld-switch-frame。docs/tasks/T035.md「3」）も、作品の枠と同じに見張る。
 */
const MAX_RESTORES = 3;
const LOADED_MESSAGE = 'ld-frame-loaded';
const CONFIRM_WAIT_MS = 2000;
const FRAMES = 'iframe[data-ld-frame], iframe[data-ld-switch-frame]';
const isWatched = (frame: HTMLIFrameElement) => frame.hasAttribute('data-ld-frame') || frame.hasAttribute('data-ld-switch-frame');

interface FrameState {
  url: string;
  loads: number;
  restores: number;
  /** 今の読み込みで、Ludion の枠の文書から知らせが来た */
  confirmed: boolean;
  timer?: ReturnType<typeof setTimeout>;
  /** 読み直しをやめて空にした */
  gaveUp: boolean;
}

const states = new WeakMap<HTMLIFrameElement, FrameState>();

function stateOf(frame: HTMLIFrameElement): FrameState {
  let state = states.get(frame);
  if (!state) {
    state = { url: frame.getAttribute('src') ?? 'about:blank', loads: 0, restores: 0, confirmed: false, gaveUp: false };
    states.set(frame, state);
  }
  return state;
}

function restore(frame: HTMLIFrameElement, state: FrameState) {
  clearTimeout(state.timer);
  state.loads = 0;
  state.confirmed = false;
  state.restores += 1;
  state.gaveUp = state.restores > MAX_RESTORES;
  frame.src = state.gaveUp ? 'about:blank' : state.url;
}

// 送り元と形を確かめる（CLAUDE.md「描画」）。sandbox の枠のオリジンは null
window.addEventListener('message', (event) => {
  if (event.origin !== 'null' || event.data !== LOADED_MESSAGE) return;
  for (const frame of document.querySelectorAll<HTMLIFrameElement>(FRAMES)) {
    if (frame.contentWindow !== event.source) continue;
    const state = stateOf(frame);
    state.confirmed = true;
    clearTimeout(state.timer);
  }
});

// load は親へ伝わらないが、捕獲の段階では document を通る。あとから React が作る枠（幅の切り替え、もう一度）もここで見える
document.addEventListener(
  'load',
  (event) => {
    const frame = event.target;
    if (!(frame instanceof HTMLIFrameElement) || !isWatched(frame)) return;
    const state = stateOf(frame);
    if (state.gaveUp) return;
    state.loads += 1;
    if (state.loads >= 2) {
      restore(frame, state);
    } else if (!state.confirmed) {
      state.timer = setTimeout(() => {
        if (frame.isConnected && !state.confirmed) restore(frame, state);
      }, CONFIRM_WAIT_MS);
    }
  },
  true,
);
