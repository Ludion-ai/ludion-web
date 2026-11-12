// リンクで見せる（SHARE001）。持ち主がサイトで押すときだけの口（worker/share.ts）。AI の口からは変えられない。

export type ShareState = 'off' | 'on' | 'blocked' | 'unavailable';
export interface ShareInfo {
  state: ShareState;
  /** オンのときだけ。本番は https://ludion.ai/s/<合言葉>（workers.dev で開いても ludion.ai） */
  url: string | null;
}

const isShareInfo = (value: unknown): value is ShareInfo =>
  typeof value === 'object' && value !== null && typeof (value as ShareInfo).state === 'string' && ((value as ShareInfo).url === null || typeof (value as ShareInfo).url === 'string');

const sharePath = (id: string) => `/api/post/works/${encodeURIComponent(id)}/share`;

/** 今の見せ方。読めなければ null。 */
export async function fetchShare(id: string): Promise<ShareInfo | null> {
  try {
    const response = await fetch(sharePath(id));
    const body = (await response.json().catch(() => null)) as unknown;
    return response.ok && isShareInfo(body) ? body : null;
  } catch {
    return null;
  }
}

/** オンかオフにする。止められている（blocked）ときも、今の形を返す。変えられなければ null。 */
export async function setShare(id: string, on: boolean): Promise<ShareInfo | null> {
  try {
    const response = await fetch(sharePath(id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
    const body = (await response.json().catch(() => null)) as unknown;
    return isShareInfo(body) && (response.ok || response.status === 403 || response.status === 409) ? body : null;
  } catch {
    return null;
  }
}
