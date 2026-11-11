/**
 * ヘッダーのスイッチに出す作品（docs/tasks/T035.md「3」）。ページを開くたびに、ブラウザがこの中から1つを選ぶ（HTML は人で変えない）。
 * どれも <button role="switch" aria-checked> を持ち、aria-checked="true" が夜であることを確かめたもの。
 * toggle-snow-cabin は外した：true は「灯りがともる」で、どちらの側も夜（docs/reports/T035.md）。
 */
import { useSyncExternalStore } from 'react';
import { fetchWorks, type Work } from '../data/works';

export const THEME_SWITCH_IDS = [
  'toggle-daylight',
  'toggle-deep-sea',
  'toggle-lighthouse',
  'toggle-oasis',
  'toggle-rainy-cafe',
  'toggle-sakura-shrine',
  'toggle-station',
  'toggle-tokyo-alley',
  'toggle-volcano-island',
] as const;

export interface ThemeSwitchWork {
  id: string;
  version: string;
  title: string;
  handle: string;
}

declare global {
  interface Window {
    /**
     * テストと本番の確かめで、選ぶ作品を固定する（Playwright の addInitScript で入れる）。
     * 承認済みで公開中の作品の id。'none' なら枠を読まない。公開中の一覧にない id なら、太陽と月のボタンのまま。
     */
    __ldThemeSwitch?: string;
  }
}

/** 公開中の一覧から選ぶ。版は一覧の今の版。取り下げた作品は一覧にないので選ばれない。 */
export function pickThemeSwitch(works: (Pick<Work, 'id' | 'version' | 'title'> & { creator: Pick<Work['creator'], 'handle'> })[], forced?: string, random = Math.random): ThemeSwitchWork | null {
  if (forced === 'none') return null;
  const candidates = forced
    ? works.filter((work) => work.id === forced)
    : works.filter((work) => (THEME_SWITCH_IDS as readonly string[]).includes(work.id));
  if (candidates.length === 0) return null;
  const work = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  return { id: work.id, version: work.version, title: work.title, handle: work.creator.handle };
}

// 選んだものは、読み込み直すまで変えない。サイトの中で別のページへ移っても（React Router）選び直さない
let chosen: ThemeSwitchWork | null = null;
let started = false;
const listeners = new Set<() => void>();

/** ホームの HTML に埋め込まれた一覧（worker/ssr.ts）。あれば取り直さない。 */
function embeddedWorks(): Work[] | null {
  const text = document.getElementById('ld-works')?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as Work[];
  } catch {
    return null;
  }
}

/** 1回だけ選ぶ。読めなかったときは null のまま（太陽と月のボタン）。 */
export function startThemeSwitch(): void {
  if (started) return;
  started = true;
  const forced = window.__ldThemeSwitch;
  if (forced === 'none') return;
  const embedded = embeddedWorks();
  (embedded ? Promise.resolve(embedded) : fetchWorks())
    .then((works) => {
      chosen = pickThemeSwitch(works, forced);
      for (const listener of listeners) listener();
    })
    .catch(() => {});
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 今ヘッダーに出している作品。まだ選んでいない、または出せないときは null。 */
export function useThemeSwitchWork(): ThemeSwitchWork | null {
  return useSyncExternalStore(subscribe, () => chosen, () => null);
}
