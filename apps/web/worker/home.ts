// ホームの HTML を Worker で作る（SPEC.md「0」「10」）。作品の一覧は HTML の中の JSON に入る（ssr.ts）。
// 検索に出るための説明、OG、canonical、構造化データもここで入れる（docs/tasks/T016.md「2.6」）。

import type { Context } from 'hono';
import { copy } from '../src/copy';
import { copyFor, localeOfPath } from '../src/i18n';
import { CANONICAL_ORIGIN, canonicalUrl } from './cachePolicy';
import { listApprovedWorks } from './catalog';
import type { Env } from './env';
import { siteImage } from './pages';
import { renderDocument } from './ssr';

const HOME_URL = canonicalUrl('/');

/** 検索エンジンに、サイトの名前と運営を伝える。 */
const STRUCTURED_DATA = [
  { '@context': 'https://schema.org', '@type': 'WebSite', name: copy.brand, url: HOME_URL },
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: copy.brand,
    url: HOME_URL,
    logo: `${CANONICAL_ORIGIN}/logo.png`,
    sameAs: ['https://x.com/Lattice_Node'],
  },
];

export async function renderHome(c: Context<{ Bindings: Env }>): Promise<Response> {
  const { home } = copyFor(localeOfPath(c.req.path));
  return renderDocument(c, {
    works: await listApprovedWorks(c.env.DB),
    head: {
      title: home.pageTitle,
      description: home.description,
      image: siteImage(c),
      path: '/',
      jsonLd: STRUCTURED_DATA,
    },
  });
}
