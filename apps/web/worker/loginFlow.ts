// 手段（GitHub、Google）で本人を確かめた後の行き先（docs/tasks/T020.md「3」「6」、SEC001 B2-3、B2-5）。
// 人を引く鍵は (provider, subject) だけ。名前やメールの一致で、別の手段を同じ人にしない。

import type { Context } from 'hono';
import { localeOfPath, localizedPath } from '../src/i18n';
import type { Env } from './env';
import { addIdentity, findIdentityUser, listIdentities, refreshIdentity, type Provider } from './identities';
import { getSessionUser, isRecentAuth, startSession } from './session';

type AppBindings = { Bindings: Env };

/** login：ふつうのログイン。reauth：今の本人の確かめ直し。link：今の本人に手段を足す。 */
export type LoginIntent = 'login' | 'reauth' | 'link';

export const parseIntent = (value: string | null | undefined): LoginIntent => (value === 'reauth' || value === 'link' ? value : 'login');

const SAFE_NEXT_BASE = 'https://next.invalid';

/**
 * 戻り先は自分のサイトのパスだけ。それ以外は「/」。
 * ブラウザは「\」を「/」として読み、タブと改行を捨てるので、`/\evil.example` や `/<TAB>/evil.example` も外へ出る。
 * URL に直してから、もう一度確かめる（`/.//evil.example` は直すと `//evil.example` になる）。
 */
const MAX_NEXT_LENGTH = 1024;

export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > MAX_NEXT_LENGTH || !next.startsWith('/')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(next) || next.startsWith('//')) return '/';
  const url = new URL(next, SAFE_NEXT_BASE);
  if (url.origin !== SAFE_NEXT_BASE || url.pathname.startsWith('//')) return '/';
  return url.pathname + url.search + url.hash;
}

/** 戻り先に、画面が読むエラーの名前を足す。 */
export function withError(next: string, error: string): string {
  const url = new URL(next, SAFE_NEXT_BASE);
  url.searchParams.set('error', error);
  return url.pathname + url.search + url.hash;
}

/** ログインの画面が文にするエラーの名前（src/pages/LoginPage.tsx）。 */
export type LoginPageError = 'login_retry' | 'login_open_browser' | 'login_failed' | 'login_limited' | 'signup_limited';

/**
 * ログインの画面へ戻す道（docs/tasks/FIX-login.md「2」）。人が見る道では JSON を出さずに、ここへ戻して文で出す。
 * 戻り先が分からなければ付けない。言語は戻り先の道で決まり、戻り先がなければ画面の側で決まる（index.html）。
 */
export function loginPageWithError(next: string | null | undefined, error: LoginPageError): string {
  if (!next) return `/login?error=${error}`;
  const safe = safeNext(next);
  return withError(`${localizedPath(localeOfPath(safe.split(/[?#]/)[0]), '/login')}?next=${encodeURIComponent(safe)}`, error);
}

/** 手段で確かめる途中で失敗したときの行き先。ふつうのログインはログインの画面へ、確かめ直しと足すのは元の画面へ戻す。 */
export const loginFailedPage = (intent: LoginIntent, next: string) => (intent === 'login' ? loginPageWithError(next, 'login_failed') : withError(next, 'login_failed'));

/** ブラウザが画面として開く道（GitHub と Google の入口と戻り先）。ここで JSON を返すと、黒い画面に JSON だけが出る。 */
export const isLoginNavigation = (method: string, path: string) => method === 'GET' && /^\/auth\/(github|google)(\/callback)?$/.test(path);

export interface ProviderProfile {
  provider: Provider;
  subject: string;
  /** 手段の一覧に出す名前（GitHub は login、Google は名前） */
  label: string | null;
  avatarUrl: string | null;
}

/**
 * 手段で確かめた人を、intent に合わせて進める。
 * reauth と link は、今のセッションの本人と合わせる。新しい人の作り方だけ手段で違うので onNewUser に任せる。
 */
export async function finishProviderLogin<E extends AppBindings>(
  c: Context<E>,
  profile: ProviderProfile,
  intent: LoginIntent,
  next: string,
  onNewUser: () => Promise<Response>,
): Promise<Response> {
  const { provider, subject, label, avatarUrl } = profile;
  const db = c.env.DB;
  const owner = await findIdentityUser(db, provider, subject);

  if (intent === 'reauth') {
    // 今の本人の手段でなければ受けない。別の人に入れ替わったまま退会などへ進ませない
    const current = await getSessionUser(c);
    if (!current || owner !== current.id) return c.redirect(withError(next, 'reauth_mismatch'));
    await refreshIdentity(db, current.id, provider, subject, label, avatarUrl);
    await startSession(c, current.id);
    return c.redirect(next);
  }

  if (intent === 'link') {
    const current = await getSessionUser(c);
    if (!current || !isRecentAuth(current)) return c.redirect(withError(next, 'reauth_required'));
    // ほかの人に結ばれた手段は断る。自動で合わせない
    if (owner && owner !== current.id) return c.redirect(withError(next, 'identity_taken'));
    if (owner) {
      await refreshIdentity(db, current.id, provider, subject, label, avatarUrl);
    } else {
      if ((await listIdentities(db, current.id)).some((identity) => identity.provider === provider)) return c.redirect(withError(next, 'already_linked'));
      try {
        await addIdentity(db, current.id, provider, subject, label, avatarUrl);
      } catch {
        // 確かめた後に、ほかの人が先に結んだ
        return c.redirect(withError(next, 'identity_taken'));
      }
    }
    // 手段が変わったら、ほかの端末のセッションを消し、今のセッションも作り直す
    await startSession(c, current.id, { revokeOthers: true, keepAuthAt: current.authAt });
    return c.redirect(next);
  }

  if (!owner) return onNewUser();
  await refreshIdentity(db, owner, provider, subject, label, avatarUrl);
  await startSession(c, owner);
  return c.redirect(next);
}
