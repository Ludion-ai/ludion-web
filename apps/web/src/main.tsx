import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import type { PageData } from './data/pages';
import { LocaleProvider } from './hooks/useCopy';
import { localeOfPath, routerBasename } from './i18n';
import { startAnalytics } from './lib/analytics';
import type { Work } from './data/works';
import { PageDataProvider } from './hooks/usePageData';
import { WorksProvider } from './hooks/useWorks';

declare global {
  interface Window {
    /** index.html のインラインのスクリプトが、別の言語へ移るときに立てる */
    __ldLeaving?: boolean;
  }
}

const locale = localeOfPath(window.location.pathname);

const container = document.getElementById('root')!;

/** Worker が HTML に埋め込んだ JSON（worker/ssr.ts）。ホームには一覧、作品と作り手のページにはページのデータがある。 */
function embedded<T>(id: string): T | null {
  const text = document.getElementById(id)?.textContent;
  return text ? (JSON.parse(text) as T) : null;
}

const pageData = embedded<PageData>('ld-page');

const app = (
  <StrictMode>
    <BrowserRouter basename={routerBasename(locale)}>
      <LocaleProvider locale={locale}>
        <WorksProvider initial={embedded<Work[]>('ld-works')}>
          <PageDataProvider value={pageData}>
            <App />
          </PageDataProvider>
        </WorksProvider>
      </LocaleProvider>
    </BrowserRouter>
  </StrictMode>
);

// Worker が描いた HTML の上に載せる。#root が空のページ（作っていないページ）は、ここで描く。
// 別の言語へ移るところなら動かさない。閲覧数を二重に数えず、GA4 にも送らない
if (!window.__ldLeaving) {
  // 自分だけの作品のページでは GA4 を動かさない。ページの URL に作品の ID が入るため（docs/tasks/T036.md「2」）
  if (!(pageData?.kind === 'work' && pageData.private)) startAnalytics();
  if (container.firstElementChild) hydrateRoot(container, app);
  else createRoot(container).render(app);
}
