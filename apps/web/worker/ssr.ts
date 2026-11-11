// HTML を Worker で作る（SPEC.md「0」「10」）。
// Vite が作った index.html（JS と CSS の URL が入っている）の #root に、React の描画を流し込む。
// ページのデータは HTML の中の JSON に入れ、ブラウザで取り直さない。人によって HTML を変えない。

import type { Context } from 'hono';
import beforeApp from 'virtual:ludion/before-app';
import { renderApp } from 'virtual:ludion/entry-server';
import frameGuard from 'virtual:ludion/frame-guard';
import previewStart from 'virtual:ludion/preview-start';
import type { PageData } from '../src/data/pages';
import { localeOfPath, localizedPath } from '../src/i18n';
import { survivesHtmlText } from '../src/lib/codeText';
import type { Work } from '../src/data/works';
import { canonicalUrl } from './cachePolicy';
import type { Env } from './env';

const ROOT = '<div id="root"></div>';
const ROOT_OPEN = '<div id="root">';
const TITLE = /<title>[^<]*<\/title>/;

const encoder = new TextEncoder();

/** <script> の中に安全に置ける JSON。作品の題名は作り手が書くので、</script> で抜けられないようにする。 */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * HTML に埋め込むページのデータ。作品のページの「コピーされるコード」は、コードの箱（<pre>）に同じ文字があるので入れない。
 * ブラウザが箱の文字から戻す（src/main.tsx。PERF002「2」）。HTML の文字で戻らないコード（CR、NUL など）だけは入れる
 */
function pageJson(page: PageData): unknown {
  if (page.kind !== 'work' || !survivesHtmlText(page.snippet)) return page;
  const { snippet: _inPre, ...rest } = page;
  return rest;
}

/** 前の文字列、React の流れ、後ろの文字列を、1本の流れにする。 */
function surround(before: string, body: ReadableStream<Uint8Array>, after: string): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let stage: 'before' | 'body' | 'done' = 'before';
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'before') {
        stage = 'body';
        controller.enqueue(encoder.encode(before));
        return;
      }
      if (stage === 'done') return;
      const { done, value } = await reader.read();
      if (done) {
        stage = 'done';
        controller.enqueue(encoder.encode(after));
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 共有され、検索に出るページの <title>、説明、OG、canonical（CLAUDE.md「技術の決定」、docs/tasks/T016.md「2.6」）。 */
export interface PageHead {
  title: string;
  /** meta の説明と og:description。なければ付けない */
  description?: string;
  /** og:image の絶対 URL。なければ付けない */
  image?: string;
  /** 言語のない道（/p/x）。rel=canonical と、言語の対応（hreflang）をここから作る */
  path?: string;
  /** JSON-LD（構造化データ） */
  jsonLd?: unknown;
}

function headTags({ title, description, image, path, jsonLd }: PageHead, locale: 'ja' | 'en'): string {
  const text = escapeHtml(title);
  const tags = [`<title>${text}</title>`, `<meta property="og:title" content="${text}">`];
  if (description) {
    const about = escapeHtml(description);
    tags.push(`<meta name="description" content="${about}">`, `<meta property="og:description" content="${about}">`);
  }
  if (image) tags.push(`<meta property="og:image" content="${escapeHtml(image)}">`);
  tags.push('<meta name="twitter:card" content="summary_large_image">');
  tags.push(`<meta property="og:locale" content="${locale === 'ja' ? 'ja_JP' : 'en_US'}">`);
  if (path) {
    const ja = escapeHtml(canonicalUrl(path));
    const en = escapeHtml(canonicalUrl(localizedPath('en', path)));
    tags.push(
      `<link rel="canonical" href="${locale === 'ja' ? ja : en}">`,
      `<link rel="alternate" hreflang="ja" href="${ja}">`,
      `<link rel="alternate" hreflang="en" href="${en}">`,
      `<link rel="alternate" hreflang="x-default" href="${en}">`,
    );
  }
  if (jsonLd) tags.push(`<script type="application/ld+json">${embedJson(jsonLd)}</script>`);
  return tags.join('');
}

export interface DocumentOptions {
  /** ホームの一覧。ほかのページでは null */
  works?: Work[] | null;
  /** 作品のページと作り手のページのデータ。ホームでは null */
  page?: PageData | null;
  head?: PageHead;
  status?: 200 | 404;
  /** 作品の枠があるページ（作品のページのほか、投稿と審査の画面）。今はヘッダーのスイッチがどのページにもあるので、見張りはどのページにも入る */
  frameGuard?: boolean;
}

export async function renderDocument(c: Context<{ Bindings: Env }>, options: DocumentOptions): Promise<Response> {
  const { works = null, page = null, head: pageHead, status = 200 } = options;
  const url = new URL(c.req.url);
  // index.html はビルドの結果（開発では Vite が変換したもの）
  const templateResponse = await c.env.ASSETS.fetch(new Request(new URL('/', url)));
  const template = await templateResponse.text();
  const [head, tail] = template.split(ROOT);
  if (tail === undefined) throw new Error(`index.html に ${ROOT} がない（${templateResponse.status}）`);
  const locale = localeOfPath(url.pathname);
  const withHead = pageHead ? head.replace(TITLE, () => headTags(pageHead, locale)) : head;
  const documentHead = locale === 'en' ? withHead.replace('<html lang="ja">', '<html lang="en">') : withHead;

  const app = await renderApp({ location: url.pathname + url.search, works, page });
  const data = [
    works ? `<script type="application/json" id="ld-works">${embedJson(works)}</script>` : '',
    page ? `<script type="application/json" id="ld-page">${embedJson(pageJson(page))}</script>` : '',
  ].join('');
  // ヘッダーのスイッチ（docs/tasks/T035.md「3」）がどのページにも作品の枠を置くので、どのページにも入れる。枠より先に動くよう、#root の前に置く
  // 作品のページは、枠を読み始める関数も先に置く。呼ぶのは枠の入れ物の直後の台本（WorkPage.tsx。PERF002「1」）
  const guard = `<script>${frameGuard}</script>${page?.kind === 'work' ? `<script>${previewStart}</script>` : ''}`;
  const html = surround(`${documentHead}${guard}${ROOT_OPEN}`, app, `</div>${data}<script>${beforeApp}</script>${tail}`);
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
