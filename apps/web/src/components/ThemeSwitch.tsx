import { Moon, Sun } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useCopy } from '../hooks/useCopy';
import { startFrame } from '../lib/frame';
import { chooseTheme, currentTheme, useTheme } from '../lib/theme';
import { startThemeSwitch, useThemeSwitchWork } from '../lib/themeSwitches';
import { SANDBOX } from './FramePreview';

/** 「読み込めた」の知らせ（packages/render の LOADED_SCRIPT、src/frameGuard.ts）。 */
const LOADED_MESSAGE = 'ld-frame-loaded';
/** 枠の load の前後で知らせを待つ時間。frameGuard.ts の CONFIRM_WAIT_MS より少し長く */
const CONFIRM_WAIT_MS = 2500;
/**
 * モードを変える知らせが1秒にこれより多く来たら、その1秒が静かになるまで無視する（作品の JS も知らせを真似られるため）。
 * 数えるのは、モードを変える知らせ（押した知らせと、今のモードと違う aria-checked）だけ。
 * 押した知らせの後に来る、同じ側の aria-checked は何も変えないので数えない（1回押すと2つ来るため）。
 */
const MAX_MESSAGES_PER_SECOND = 2;
/** 無視した後、静かになってから、親のモードを枠に言い直す。作品の状態とサイトの色を最後に合わせるため */
const RESYNC_AFTER_MS = 1000;
/** load の後、手が空くのを待つ上限 */
const IDLE_TIMEOUT_MS = 2000;

type SwitchMessage = { kind: 'press' } | { kind: 'checked'; checked: boolean };

/**
 * 形が合う知らせだけ。余計な鍵があるものも受けない。
 * - { type: 'ld-switch-press' }：スイッチが押された（packages/render の SWITCH_SCRIPT）。
 * - { type: 'ld-switch', checked }：作品の aria-checked が変わった。
 */
function switchMessage(data: unknown): SwitchMessage | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const keys = Object.keys(data);
  const { type, checked } = data as { type: unknown; checked: unknown };
  if (keys.length === 1 && keys[0] === 'type' && type === 'ld-switch-press') return { kind: 'press' };
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('checked')) return null;
  return type === 'ld-switch' && typeof checked === 'boolean' ? { kind: 'checked', checked } : null;
}

/** ページの load の後、手が空いたとき。作品のページの主の枠や LCP の画像と取り合わない（docs/tasks/T035.md「3」「重さ」）。 */
function afterLoadAndIdle(run: () => void): () => void {
  let cancelled = false;
  let idleId: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (cancelled) return;
    if (typeof window.requestIdleCallback === 'function') idleId = window.requestIdleCallback(() => !cancelled && run(), { timeout: IDLE_TIMEOUT_MS });
    else timer = setTimeout(() => !cancelled && run(), 200);
  };
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', schedule);
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
    clearTimeout(timer);
  };
}

/**
 * ヘッダーのライトとダークの切り替え（docs/tasks/T035.md「3」）。
 * 作品のスイッチを、作品のページと同じ守りの枠（sandbox、/frame/<id>/<version>/inline.html）で動かす。CLAUDE.md 原則7。
 * 枠が読めるまでと、読めなかったときは、太陽と月のボタンで切り替える。
 * 枠と親のやりとりは postMessage だけ。受け取るのは自分の枠の contentWindow からで、形が合うものだけ。
 */
export function ThemeSwitch() {
  const copy = useCopy();
  const theme = useTheme();
  const work = useThemeSwitchWork();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => afterLoadAndIdle(startThemeSwitch), []);

  // 枠を読み始める。縮めない枠なので、細かさは実際の DPR のまま（PREVIEW-DPR。作品のページの枠と同じ形で URL に付ける）
  useLayoutEffect(() => {
    if (frameRef.current) startFrame(frameRef.current, 1);
  }, [work]);

  // 親のモードが正。枠が読めたら、今のモードを伝える。枠は違うときだけスイッチを押す
  const sendTheme = () => {
    frameRef.current?.contentWindow?.postMessage({ type: 'ld-switch-set', checked: currentTheme() === 'dark' }, '*');
  };

  useEffect(() => {
    if (ready) sendTheme();
  }, [ready, theme]);

  useEffect(() => {
    if (!work) return;
    let lastLoadedAt = -Infinity;
    let recent: number[] = [];
    let confirmTimer: ReturnType<typeof setTimeout> | undefined;
    let resyncTimer: ReturnType<typeof setTimeout> | undefined;

    const fromOwnFrame = (event: MessageEvent) => {
      const frame = frameRef.current;
      return !!frame && event.origin === 'null' && event.source !== null && event.source === frame.contentWindow;
    };

    const onMessage = (event: MessageEvent) => {
      if (!fromOwnFrame(event)) return;
      if (event.data === LOADED_MESSAGE) {
        lastLoadedAt = performance.now();
        clearTimeout(confirmTimer);
        setReady(true);
        sendTheme();
        return;
      }
      const message = switchMessage(event.data);
      if (message === null) return;
      // 押した知らせ：すぐに今のモードの逆にする。aria-checked の知らせ：今のモードと違うときだけ合わせる（ドラッグで渡したときなど）
      const now = currentTheme();
      const next = message.kind === 'press' ? (now === 'dark' ? 'light' : 'dark') : message.checked ? 'dark' : 'light';
      if (next === now) return;
      const at = performance.now();
      recent = [...recent.filter((t) => at - t < 1000), at];
      if (recent.length > MAX_MESSAGES_PER_SECOND) {
        clearTimeout(resyncTimer);
        resyncTimer = setTimeout(sendTheme, RESYNC_AFTER_MS);
        return;
      }
      chooseTheme(next);
    };

    // 枠が読み直された（見張りが戻した、または空にした）ときは、知らせが来るまで太陽と月のボタンに戻す
    const frame = frameRef.current;
    const onLoad = () => {
      clearTimeout(confirmTimer);
      if (performance.now() - lastLoadedAt < 1000) return;
      confirmTimer = setTimeout(() => {
        if (performance.now() - lastLoadedAt > CONFIRM_WAIT_MS) setReady(false);
      }, CONFIRM_WAIT_MS);
    };

    window.addEventListener('message', onMessage);
    frame?.addEventListener('load', onLoad);
    return () => {
      window.removeEventListener('message', onMessage);
      frame?.removeEventListener('load', onLoad);
      clearTimeout(confirmTimer);
      clearTimeout(resyncTimer);
    };
  }, [work]);

  const dark = theme === 'dark';

  return (
    // 枠の大きさ：767px 以下は 69×42（横長の丸の高さ 32px）、768px 以上は 87×53（40px）
    <div data-theme-switch="" className="relative flex h-[42px] w-[69px] shrink-0 items-center justify-center md:h-[53px] md:w-[87px]">
      {/* 太陽と月のボタン。どちらの絵を出すかは CSS（data-theme）で決めるので、React が載る前から正しい */}
      <button
        type="button"
        role="switch"
        aria-checked={dark}
        aria-label={copy.themeSwitch.label}
        onClick={() => chooseTheme(dark ? 'light' : 'dark')}
        className={`flex size-11 items-center justify-center rounded-control text-site-fg hover:bg-site-hover ${ready ? 'invisible' : ''}`}
      >
        <Moon size={22} strokeWidth={1.75} aria-hidden="true" className="dark:hidden" />
        <Sun size={22} strokeWidth={1.75} aria-hidden="true" className="hidden dark:block" />
      </button>
      {work && (
        // 作者を示すのは「…」とアカウントのメニューの「このスイッチの作品を見る」（docs/tasks/T039.md）。読み上げでは枠の title が題と作者を言う
        <iframe
          ref={frameRef}
          data-ld-switch-frame=""
          // src は startFrame が入れる（# に細かさを付ける。PREVIEW-DPR）。この枠は縮めないので、割合は 1
          data-src={`/frame/${work.id}/${work.version}/inline.html`}
          sandbox={SANDBOX}
          title={copy.themeSwitch.frameTitle(work.title, work.handle)}
          inert={!ready}
          // 親がダークのときも、枠の地が不透明に塗られないよう、枠の文書（ライト）と同じにする
          style={{ colorScheme: 'light' }}
          className={`absolute inset-0 size-full border-0 ${ready ? '' : 'pointer-events-none opacity-0'}`}
        />
      )}
    </div>
  );
}
