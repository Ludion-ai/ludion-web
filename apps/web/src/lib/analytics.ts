// GA4（CLAUDE.md 原則6の例外。SPEC.md「15」）。本番へのデプロイのビルド（vite build --mode deploy）の、ludion.ai だけで動かす。
// ほかのビルド（手元の開発、テスト、npm run lcp）には計測のコードが入らない（docs/tasks/T016.md「2.5」）。
// ログインの情報は送らない。検索語は URL から除いて送る。作品の枠の中では動かない（枠は別の HTML で、CSP が外への通信を止める）。

const MEASUREMENT_ID = 'G-91CJFHRK88';
const PRODUCTION_HOST = 'ludion.ai';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * URL から検索語（q）を除く。UTM などのほかの値は、どこから来たかを見るのに要るので残す。
 * ログインの画面の next には、元のページの URL が検索語ごと入るので、これも除く。
 */
export function withoutSearchTerm(href: string): string {
  if (!href) return '';
  try {
    const url = new URL(href);
    url.searchParams.delete('q');
    url.searchParams.delete('next');
    return url.href;
  } catch {
    return '';
  }
}

function config(pageLocation: string, pageReferrer: string): Record<string, unknown> {
  return {
    page_location: pageLocation,
    page_referrer: pageReferrer,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
}

let current = '';

/** ページの読み込みが終わってから gtag.js を読む（SPEC.md「10」。LCP の画像と回線を取り合わない） */
export function startAnalytics(): void {
  // 2つとも要る：ビルドの印だけだと workers.dev で動き、名前の確かめだけだと、手元のビルドを ludion.ai の名前で開くと動く
  if (import.meta.env.MODE !== 'deploy' || location.hostname !== PRODUCTION_HOST) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js は arguments そのものを受け取る決まり
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  current = withoutSearchTerm(location.href);
  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, config(current, withoutSearchTerm(document.referrer)));

  const load = () => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.append(script);
  };
  if (document.readyState === 'complete') load();
  else window.addEventListener('load', load, { once: true });
}

/** 送ってよいイベントと、その値（SPEC.md「15」）。ここにない名前と値は送れない。 */
export type AnalyticsEvents = {
  share: { work_id: string; method: 'native' | 'clipboard' };
  copy_code: { work_id: string };
  save_click: { work_id: string };
  select_work: { from_work_id: string; to_work_id: string };
  remix_open: { work_id: string };
  /** 入力があったかどうかと、指示文の形だけ。入力の中身は送らない（CLAUDE.md 原則6） */
  remix_prompt_copy: { work_id: string; has_brief: boolean; mode: 'url' | 'full' };
  /** 「壁紙にする」のシートで押したもの（WALL001「2」）。plash：Plash に入れる、copy：住所をコピー、download：HTML を保存 */
  wallpaper_open: { work_id: string; method: 'plash' | 'copy' | 'download' };
};

/** GA4 のイベント。startAnalytics が動いていなければ window.gtag がないので、何もしない */
export function trackEvent<Name extends keyof AnalyticsEvents>(name: Name, params: AnalyticsEvents[Name]): void {
  // 直後に別のページへ移っても、gtag.js が移る前に送る（Chromium の NetLog と WebKit で確かめた。scripts/verify-t018.mjs）
  window.gtag?.('event', name, params);
}

/** 同じページの中で URL が変わったとき（絞り込みなど）。検索語だけが変わったときは数えない */
export function trackLocationChange(): void {
  if (!window.gtag) return;
  const next = withoutSearchTerm(location.href);
  if (next === current) return;
  const previous = current;
  current = next;
  window.gtag('event', 'page_view', { page_location: next, page_referrer: previous });
}
