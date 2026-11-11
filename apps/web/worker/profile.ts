// プロフィールの値を確かめる（docs/tasks/T020.md「2」）。Worker の束縛に頼らない。e2e がそのまま読むため。

/** 表示の名前の上限。 */
export const DISPLAY_NAME_MAX = 50;
const URL_MAX = 200;
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
/** 制御文字と、文字の向きを変える文字。見た目で名前を偽れるので断る。 */
const BIDI_RANGES = [[0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]];
const isUnsafeChar = (char: string) => {
  const code = char.codePointAt(0)!;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || BIDI_RANGES.some(([from, to]) => code >= from && code <= to);
};
const hasUnsafeText = (text: string) => [...text].some(isUnsafeChar);

const PASSKEY_LABEL_MAX = 40;

/** パスキーの名前（本人が付ける。任意）。空なら null。形が違えば undefined。 */
export function parsePasskeyLabel(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const label = value.trim();
  if ([...label].length > PASSKEY_LABEL_MAX || hasUnsafeText(label)) return undefined;
  return label || null;
}

export type ProfileField = 'display_name' | 'x_url' | 'site_url';

export interface ProfileValues {
  display_name: string | null;
  x_url: string | null;
  site_url: string | null;
}

/** https の URL だけを、直した形で返す。空なら null。形が違えば undefined。 */
function httpsUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return null;
  if (text.length > URL_MAX) return undefined;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return undefined;
  return url.href;
}

/** 送られた値を確かめる。だめなら、どの項目が違うかを返す。 */
export function parseProfile(body: Record<string, unknown>): { ok: true; values: ProfileValues } | { ok: false; field: ProfileField } {
  const rawName = body.display_name;
  if (rawName !== null && rawName !== undefined && typeof rawName !== 'string') return { ok: false, field: 'display_name' };
  const name = (rawName ?? '').trim();
  if ([...name].length > DISPLAY_NAME_MAX || hasUnsafeText(name)) return { ok: false, field: 'display_name' };

  const x = httpsUrl(body.x_url);
  if (x === undefined || (x !== null && !X_HOSTS.has(new URL(x).hostname))) return { ok: false, field: 'x_url' };
  const site = httpsUrl(body.site_url);
  if (site === undefined) return { ok: false, field: 'site_url' };

  return { ok: true, values: { display_name: name || null, x_url: x, site_url: site } };
}
