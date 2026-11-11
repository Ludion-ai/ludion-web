import { StrictMode } from 'react';
import { renderToReadableStream } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { errorType, logError } from '../worker/log';
import { LocaleProvider } from './hooks/useCopy';
import { localeOfPath, routerBasename } from './i18n';
import { App } from './App';
import type { PageData } from './data/pages';
import type { Work } from './data/works';
import { PageDataProvider } from './hooks/usePageData';
import { WorksProvider } from './hooks/useWorks';

type RenderOptions = { location: string; works: Work[] | null; page: PageData | null };

/** Worker が HTML を作る（worker/ssr.ts）。main.tsx と同じ木にする。 */
export function renderApp({ location, works, page }: RenderOptions): Promise<ReadableStream<Uint8Array>> {
  const locale = localeOfPath(new URL(location, 'https://ludion.ai').pathname);
  return renderToReadableStream(
    <StrictMode>
      <StaticRouter location={location} basename={routerBasename(locale)}>
        <LocaleProvider locale={locale}>
          <WorksProvider initial={works}>
            <PageDataProvider value={page}>
              <App />
            </PageDataProvider>
          </WorksProvider>
        </LocaleProvider>
      </StaticRouter>
    </StrictMode>,
    { onError: (error) => logError('ssr_failed', { type: errorType(error) }) },
  );
}
