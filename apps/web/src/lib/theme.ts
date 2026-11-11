/**
 * ライトとダーク（docs/tasks/T035.md「2」）。
 * 最初の値は index.html のインラインのスクリプトが、最初の描画の前に <html data-theme> に付ける。ここはその後を受け持つ。
 * 選んだものは、その端末の localStorage（ld-theme）にだけ残す。サーバーには送らない、保存しない（CLAUDE.md 原則6）。GA4 にも送らない。
 */
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ld-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

const listeners = new Set<() => void>();

function readChoice(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (root.getAttribute('data-theme') === theme) return;
  root.setAttribute('data-theme', theme);
  // アドレスバーの色を、サイトの地の色（index.css）に合わせる
  const bg = getComputedStyle(root).getPropertyValue('--color-site-bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  for (const listener of listeners) listener();
}

/** 見る人が選んだ。その端末に覚える。 */
export function chooseTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 覚えられなくても、このページでは切り替える
  }
  applyTheme(theme);
}

let watchingSystem = false;

/** 選んでいない人は、端末の設定が変わったらそれに従う。 */
function watchSystem(): void {
  if (watchingSystem || typeof window.matchMedia !== 'function') return;
  watchingSystem = true;
  window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
    if (readChoice() === null) applyTheme(event.matches ? 'dark' : 'light');
  });
}

function subscribe(listener: () => void): () => void {
  watchSystem();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 今のモード。Worker の描画と、その上に載せる最初の描画では 'light'（HTML は人で変えない）。 */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}
