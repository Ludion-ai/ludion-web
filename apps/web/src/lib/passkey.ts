// パスキーのブラウザ側（docs/tasks/T020.md「7」）。@simplewebauthn/browser は押したときに読む（ホームの JS を増やさない）。

import type { HandleStatus } from './account';

const postJson = (path: string, body: unknown) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** 本人がブラウザの画面で取り消したか。 */
const isCancelled = (error: unknown) => error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');

/** retry：途中の状態が合わない（切れた、もう使った）。やり直せば通る。 */
export type RegisterAnswer = { next: string; recoveryCode: string | null } | { status: HandleStatus } | 'cancelled' | 'reauth_required' | 'limited' | 'retry' | 'failed';

/** パスキーを作る。handle があれば新しい人を作り、なければログイン中の本人に足す。 */
export async function registerPasskey({ handle, label, next }: { handle?: string; label?: string; next: string }): Promise<RegisterAnswer> {
  const start = await postJson('/auth/passkey/register/options', { handle, next });
  if (start.status === 403) return 'reauth_required';
  if (!start.ok) {
    const body = (await start.json().catch(() => null)) as { status?: HandleStatus } | null;
    return body?.status ? { status: body.status } : 'failed';
  }
  const { startRegistration } = await import('@simplewebauthn/browser');
  let response;
  try {
    response = await startRegistration({ optionsJSON: await start.json() });
  } catch (error) {
    return isCancelled(error) ? 'cancelled' : 'failed';
  }
  const done = await postJson('/auth/passkey/register/verify', { response, label });
  const body = (await done.json().catch(() => null)) as { next?: string; recovery_code?: string; status?: HandleStatus; error?: string } | null;
  if (done.ok && body?.next) return { next: body.next, recoveryCode: body.recovery_code ?? null };
  if (done.status === 403) return 'reauth_required';
  if (done.status === 429) return 'limited';
  if (body?.error === 'bad_challenge') return 'retry';
  return body?.status ? { status: body.status } : 'failed';
}

export type LoginAnswer = { next: string } | 'cancelled' | 'reauth_mismatch' | 'retry' | 'failed';

/** パスキーでログインする。名前は打たない。reauth なら、今の本人のパスキーだけを受ける。 */
export async function loginWithPasskey({ next, reauth = false }: { next: string; reauth?: boolean }): Promise<LoginAnswer> {
  const start = await postJson('/auth/passkey/login/options', { next, intent: reauth ? 'reauth' : 'login' });
  if (!start.ok) return 'failed';
  const { startAuthentication } = await import('@simplewebauthn/browser');
  let response;
  try {
    response = await startAuthentication({ optionsJSON: await start.json() });
  } catch (error) {
    return isCancelled(error) ? 'cancelled' : 'failed';
  }
  const done = await postJson('/auth/passkey/login/verify', { response });
  if (done.ok) return (await done.json()) as { next: string };
  if (done.status === 403) return 'reauth_mismatch';
  const body = (await done.json().catch(() => null)) as { error?: string } | null;
  return body?.error === 'bad_challenge' ? 'retry' : 'failed';
}

/** 回復のコードで入る。答えは行き先か、だめな理由。 */
export async function loginWithRecoveryCode(code: string, next: string): Promise<{ next: string } | 'invalid' | 'limited'> {
  const response = await postJson('/auth/passkey/recovery', { code, next });
  if (response.ok) return (await response.json()) as { next: string };
  return response.status === 429 ? 'limited' : 'invalid';
}
