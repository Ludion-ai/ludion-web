// /sitemap.xml（docs/tasks/T016.md「2.6」）。D1 から作り、承認済みの作品と、その作者だけを載せる（CLAUDE.md 原則5）。
// 札 catalog が付くので、作品の承認や取り下げのときにキャッシュから消える（cachePolicy.ts）。

import type { Context } from 'hono';
import { localizedPath } from '../src/i18n';
import { canonicalUrl } from './cachePolicy';
import type { Env } from './env';

const STATIC_PATHS = ['/', '/about', '/privacy', '/terms'];

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export async function renderSitemap(c: Context<{ Bindings: Env }>): Promise<Response> {
  const db = c.env.DB;
  // 一覧の上限（catalog.ts の MAX_WORKS）で切らない。承認済みを全部載せる
  const [works, creators] = await db.batch<{ path: string }>([
    db.prepare(`SELECT id AS path FROM works WHERE status = 'approved' ORDER BY id`),
    db.prepare(
      `SELECT handle AS path FROM creators c
       WHERE EXISTS (SELECT 1 FROM works w WHERE w.creator_id = c.id AND w.status = 'approved')
       ORDER BY handle`,
    ),
  ]);
  const paths = [
    ...STATIC_PATHS,
    ...works.results.map(({ path }) => `/p/${encodeURIComponent(path)}`),
    ...creators.results.map(({ path }) => `/c/${encodeURIComponent(path)}`),
  ];
  const links = (path: string) => {
    const ja = escapeXml(canonicalUrl(path));
    const en = escapeXml(canonicalUrl(localizedPath('en', path)));
    return `<xhtml:link rel="alternate" hreflang="ja" href="${ja}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${en}"/>`;
  };
  const urls = paths
    .flatMap((path) => [path, localizedPath('en', path)].map((loc, _, pair) => `<url><loc>${escapeXml(canonicalUrl(loc))}</loc>${links(pair[0])}</url>`))
    .join('');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`, 200, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}
