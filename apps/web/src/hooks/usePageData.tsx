import { createContext, useContext } from 'react';
import type { PageData } from '../data/pages';

const PageDataContext = createContext<PageData | null>(null);

export const PageDataProvider = PageDataContext.Provider;

/** Worker が HTML に埋め込んだページのデータ（worker/ssr.ts）。埋め込まれていないページでは null。 */
export function usePageData(): PageData | null {
  return useContext(PageDataContext);
}
