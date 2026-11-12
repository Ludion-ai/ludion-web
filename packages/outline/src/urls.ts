// 外から読む物の住所を分ける。

const GOOGLE_FONTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const CDN = new Set([
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'esm.run',
  'cdn.skypack.dev',
  'ga.jspm.io',
  'jspm.dev',
  'code.jquery.com',
  'cdn.tailwindcss.com',
  'ajax.googleapis.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'use.fontawesome.com',
  'kit.fontawesome.com',
  'cdn.babylonjs.com',
  'threejs.org',
]);

/** 名前空間などの住所（読みに行かない） */
const NOT_LOADED = new Set(['www.w3.org']);

/**
 * 住所を分ける。loads：読みに行く場所に書いてある（src、href、import、fetch、url()）。
 * Google Fonts と CDN は、どこに書いてあっても外から読む物として数える。それ以外の住所は、読みに行く場所だけ。
 */
export function classifyUrl(value: string, loads: boolean): { id: 'google-fonts' | 'cdn' | 'external'; host: string } | null {
  const m = /^(?:https?:)?\/\/([^/\s?#'"`<>\\]+)/i.exec(value.trim());
  if (!m) return null;
  const host = m[1].toLowerCase().replace(/:\d+$/, '');
  if (NOT_LOADED.has(host)) return null;
  if (GOOGLE_FONTS.has(host)) return { id: 'google-fonts', host };
  if (CDN.has(host)) return { id: 'cdn', host };
  return loads ? { id: 'external', host } : null;
}
