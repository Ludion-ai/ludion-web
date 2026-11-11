// アプリの中のブラウザか（docs/tasks/FIX-login.md「追加でやること」）。
// Google はアプリの中のブラウザでのログインを嫌い、別のブラウザで開くことがある。そうなると戻り先に cookie がなく、ログインできない。
// UA はこの画面の中で見るだけで、送らない、保存しない（CLAUDE.md 原則6）。HTML は人によって変えないので、ブラウザで決める。

import { useSyncExternalStore } from 'react';

/** iphone：右上の … から開き直せる。 */
export type InAppBrowser = 'iphone' | 'other' | null;

/** 名前を出しているアプリ（X、Facebook、Instagram、LINE、TikTok など）。 */
const NAMED_APP = /\b(?:Twitter(?!bot)|FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|musical_ly|trill_|TikTok|BytedanceWebview|MicroMessenger|Snapchat|Pinterest|LinkedInApp)/i;

/**
 * 名前を出さないアプリも、WebView の形で見分ける。iOS の WebView の UA には、Safari と iOS の Chrome、Firefox などが持つ「Safari/」がない。
 * Android の WebView の UA には「; wv)」がある。
 */
export function inAppBrowser(userAgent: string): InAppBrowser {
  const iPhone = /\b(?:iPhone|iPod)\b/.test(userAgent);
  const iosWebView = (iPhone || /\biPad\b/.test(userAgent)) && !/\bSafari\//.test(userAgent);
  const androidWebView = /\bAndroid\b/.test(userAgent) && /;\s*wv\)/.test(userAgent);
  if (!NAMED_APP.test(userAgent) && !iosWebView && !androidWebView) return null;
  return iPhone ? 'iphone' : 'other';
}

const neverChanges = () => () => {};

/** 描画の最初は null（Worker の HTML と同じ）で、ブラウザで決まる。 */
export const useInAppBrowser = (): InAppBrowser =>
  useSyncExternalStore(
    neverChanges,
    () => inAppBrowser(navigator.userAgent),
    () => null,
  );
