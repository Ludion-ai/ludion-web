import type { Work } from '../data/works';
import { localeOfPath, localizedPath } from '../i18n';

export type AccountUser = {
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  /** 審査待ちの数。運営にだけ来る */
  review_pending?: number;
};

/** GET /api/me の形（docs/tasks/T009.md「2」）。 */
export type MeResponse = { user: AccountUser; liked: string[]; bookmarked: string[]; can_post: boolean } | { user: null };

export type ToggleKind = 'like' | 'bookmark';

export type LoginProvider = 'github' | 'google';

/** ログインの画面へ。終わったら next へ戻る（Worker が自分のサイトのパスだけを受ける）。next の言語の画面を開く。 */
export const loginHref = (next: string) =>
  `${localizedPath(localeOfPath(next.split(/[?#]/)[0]), '/login')}?next=${encodeURIComponent(next)}`;

/** その手段のログインへ。 */
export const providerLoginHref = (provider: LoginProvider, next: string) => `/auth/${provider}?next=${encodeURIComponent(next)}`;

/** もう一度のログイン。今の本人の手段でなければ断られる（worker/loginFlow.ts）。 */
export const reauthHref = (provider: LoginProvider, next: string) => `/auth/${provider}?intent=reauth&next=${encodeURIComponent(next)}`;

/** 今の本人に手段を足す。直近のログインが要る。 */
export const linkHref = (provider: LoginProvider, next: string) => `/auth/${provider}?intent=link&next=${encodeURIComponent(next)}`;

export function goToLogin(): void {
  window.location.assign(loginHref(window.location.pathname + window.location.search));
}

export async function fetchMe(): Promise<MeResponse> {
  const response = await fetch('/api/me');
  if (!response.ok) throw new Error(`GET /api/me: ${response.status}`);
  return (await response.json()) as MeResponse;
}

/** いいねかしおりを切り替え、切り替えた後の状態を返す。ログインが切れていれば 'unauthorized'。 */
export async function postToggle(kind: ToggleKind, workId: string): Promise<boolean | 'unauthorized'> {
  const response = await fetch(`/api/works/${encodeURIComponent(workId)}/${kind}`, { method: 'POST' });
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) throw new Error(`POST ${kind}: ${response.status}`);
  const body = (await response.json()) as { liked?: boolean; bookmarked?: boolean };
  return (kind === 'like' ? body.liked : body.bookmarked) === true;
}

/** 本人のしおりの作品。ログインしていなければ 'unauthorized'。 */
export async function fetchBookmarks(): Promise<Work[] | 'unauthorized'> {
  const response = await fetch('/api/me/bookmarks');
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) throw new Error(`GET /api/me/bookmarks: ${response.status}`);
  return ((await response.json()) as { works: Work[] }).works;
}

/** 本人のいいねの作品。ログインしていなければ 'unauthorized'。 */
export async function fetchLikedWorks(): Promise<Work[] | 'unauthorized'> {
  return fetchWorks('/api/me/likes');
}

async function fetchWorks(path: string): Promise<Work[] | 'unauthorized'> {
  const response = await fetch(path);
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) throw new Error(`GET ${path}: ${response.status}`);
  return ((await response.json()) as { works: Work[] }).works;
}

export type AccountProfile = AccountUser & { x_url: string | null; site_url: string | null };
export type AccountIdentity = { provider: LoginProvider; label: string | null; created_at: number; last_used_at: number };
export type AccountSession = { id: string; created_at: number; last_used_at: number; current: boolean };
export type AccountPasskey = { id: string; label: string | null; created_at: number; last_used_at: number | null };
export type AccountAiKey = { id: string; name: string; created_at: number; last_used_at: number | null };
/** つないでいる AI（MCP001「3」）。name は AI のアプリが名乗った名前。 */
export type AccountAiConnection = { id: string; name: string; created_at: number; last_used_at: number | null };
export type AccountOverview = {
  profile: AccountProfile;
  identities: AccountIdentity[];
  sessions: AccountSession[];
  passkeys: AccountPasskey[];
  has_recovery_code: boolean;
  ai_keys: AccountAiKey[];
  ai_connections: AccountAiConnection[];
  works_count: number;
  recent_auth: boolean;
  available: { google: boolean; passkey: boolean };
};

export type HandleStatus = 'ok' | 'same' | 'format' | 'reserved' | 'taken' | 'held';
export type ProfileField = 'display_name' | 'x_url' | 'site_url';

/** GET /api/account。ログインしていなければ 'unauthorized'。 */
export async function fetchAccount(): Promise<AccountOverview | 'unauthorized'> {
  const response = await fetch('/api/account');
  if (response.status === 401) return 'unauthorized';
  if (!response.ok) throw new Error(`GET /api/account: ${response.status}`);
  return (await response.json()) as AccountOverview;
}

const postJson = (path: string, body?: unknown) =>
  fetch(path, { method: 'POST', ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });

/** プロフィールを変える。だめなら違う項目の名前を返す。 */
export async function postProfile(values: { display_name: string; x_url: string; site_url: string }): Promise<'ok' | ProfileField> {
  const response = await postJson('/api/account/profile', values);
  if (response.ok) return 'ok';
  const body = (await response.json().catch(() => null)) as { field?: ProfileField } | null;
  if (body?.field) return body.field;
  throw new Error(`POST /api/account/profile: ${response.status}`);
}

export async function fetchHandleStatus(handle: string): Promise<HandleStatus> {
  const response = await fetch(`/api/account/handle-check?handle=${encodeURIComponent(handle)}`);
  if (!response.ok) throw new Error(`GET /api/account/handle-check: ${response.status}`);
  return ((await response.json()) as { status: HandleStatus }).status;
}

/** handle を変える。だめなら理由を返す。 */
export async function postHandle(handle: string): Promise<'ok' | HandleStatus> {
  const response = await postJson('/api/account/handle', { handle });
  if (response.ok) return 'ok';
  const body = (await response.json().catch(() => null)) as { status?: HandleStatus } | null;
  if (body?.status) return body.status;
  throw new Error(`POST /api/account/handle: ${response.status}`);
}

export async function postRevokeSession(id: string): Promise<void> {
  const response = await postJson(`/api/account/sessions/${encodeURIComponent(id)}/revoke`);
  if (!response.ok) throw new Error(`POST revoke: ${response.status}`);
}

export async function postRevokeOtherSessions(): Promise<void> {
  const response = await postJson('/api/account/sessions/revoke-others');
  if (!response.ok) throw new Error(`POST revoke-others: ${response.status}`);
}

/** 手段を外す。 */
export async function postRemoveIdentity(provider: LoginProvider): Promise<'ok' | 'reauth_required' | 'last_method'> {
  const response = await postJson(`/api/account/identities/${provider}/remove`);
  if (response.ok) return 'ok';
  if (response.status === 403) return 'reauth_required';
  if (response.status === 409) return 'last_method';
  throw new Error(`POST remove: ${response.status}`);
}

export async function postRemovePasskey(id: string): Promise<void> {
  const response = await postJson(`/api/account/passkeys/${encodeURIComponent(id)}/remove`);
  if (!response.ok) throw new Error(`POST remove passkey: ${response.status}`);
}

/** 回復のコードを作り直す。コードはこの答えでしか見られない。 */
export async function postRegenerateRecoveryCode(): Promise<string> {
  const response = await postJson('/api/account/recovery-code');
  if (!response.ok) throw new Error(`POST recovery-code: ${response.status}`);
  return ((await response.json()) as { recovery_code: string }).recovery_code;
}

/** AI の鍵を作る（docs/tasks/T037.md「1」）。鍵の生の値は、この答えでしか見られない。 */
export async function postCreateAiKey(name: string, confirm: { own: boolean; mit: boolean; terms: boolean }): Promise<{ key: AccountAiKey; secret: string } | 'bad_name' | 'too_many'> {
  const response = await postJson('/api/account/ai-keys', { name, ...confirm });
  if (response.status === 201) return (await response.json()) as { key: AccountAiKey; secret: string };
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (body?.error === 'bad_name' || body?.error === 'too_many') return body.error;
  throw new Error(`POST /api/account/ai-keys: ${response.status}`);
}

export async function postDeleteAiKey(id: string): Promise<void> {
  const response = await postJson(`/api/account/ai-keys/${encodeURIComponent(id)}/delete`);
  if (!response.ok) throw new Error(`POST delete ai key: ${response.status}`);
}

/** つないだ AI を切る。 */
export async function postRevokeAiConnection(id: string): Promise<void> {
  const response = await postJson(`/api/account/ai-connections/${encodeURIComponent(id)}/revoke`);
  if (!response.ok) throw new Error(`POST revoke ai connection: ${response.status}`);
}

export type PendingSignup ={ provider: LoginProvider; name: string | null; suggestions: string[] };

/** 手段で確かめた新しい人の、handle を選ぶ前の情報。なければ null。 */
export async function fetchPendingSignup(): Promise<PendingSignup | null> {
  const response = await fetch('/auth/signup/pending');
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GET /auth/signup/pending: ${response.status}`);
  return (await response.json()) as PendingSignup;
}

/** ログインしていない人の handle の確かめ。 */
export async function fetchPublicHandleStatus(handle: string): Promise<HandleStatus> {
  const response = await fetch(`/api/signup/handle-check?handle=${encodeURIComponent(handle)}`);
  if (!response.ok) throw new Error(`GET /api/signup/handle-check: ${response.status}`);
  return ((await response.json()) as { status: HandleStatus }).status;
}

/** handle を決めて人を作る。答えは戻り先か、だめな理由。 */
export async function postSignup(handle: string): Promise<{ next: string } | { status: HandleStatus } | 'expired' | 'limited'> {
  const response = await postJson('/auth/signup/complete', { handle });
  if (response.ok) return (await response.json()) as { next: string };
  if (response.status === 404) return 'expired';
  if (response.status === 429) return 'limited';
  const body = (await response.json().catch(() => null)) as { status?: HandleStatus } | null;
  if (body?.status) return { status: body.status };
  throw new Error(`POST /auth/signup/complete: ${response.status}`);
}

/** 退会。直近のログインがなければ 'reauth_required'。 */
export async function postDeleteAccount(): Promise<'ok' | 'reauth_required'> {
  const response = await postJson('/api/account/delete');
  if (response.ok) return 'ok';
  if (response.status === 403) return 'reauth_required';
  throw new Error(`POST /api/account/delete: ${response.status}`);
}

export async function postLogout(): Promise<void> {
  const response = await fetch('/auth/logout', { method: 'POST' });
  if (!response.ok) throw new Error(`POST /auth/logout: ${response.status}`);
}
