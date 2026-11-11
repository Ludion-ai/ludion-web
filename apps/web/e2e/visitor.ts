// ブラウザではない訪問者（アカウントのテストで共通）。cookie の見出しを自分で持つ。

import { expect, test } from '@playwright/test';

export const ownOrigin = () => new URL(test.info().project.use.baseURL!).origin;

/** ログインの途中の cookie（worker/authFlow.ts の state で見分けるもの）の名前と値。古い順。 */
export const flowCookies = (cookies: Map<string, string>, prefix: 'ld_google_flow' | 'ld_github_flow') =>
  [...cookies].filter(([name]) => name.startsWith(`${prefix}_`)).sort(([a], [b]) => (a < b ? -1 : 1));

export class Visitor {
  cookies = new Map<string, string>();
  /** いちばん新しい応答の Set-Cookie の生の行 */
  lastSetCookie: string[] = [];

  constructor(sessionToken?: string) {
    if (sessionToken) this.cookies.set('ld_session', sessionToken);
  }

  async fetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('Cookie', [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '));
    const response = await fetch(new URL(path, ownOrigin()), { redirect: 'manual', ...init, headers });
    this.lastSetCookie = response.headers.getSetCookie();
    for (const line of this.lastSetCookie) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }

  post(path: string, body?: unknown, origin: string | null = ownOrigin()) {
    return this.fetch(path, {
      method: 'POST',
      headers: { ...(origin === null ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  /** GitHub のログインを最後まで通す。query はログインの最初の道に足す。 */
  async login(login: string, query = '') {
    const start = await this.fetch(`/auth/github?next=/${query}`);
    const authorize = new URL(start.headers.get('location')!);
    authorize.searchParams.set('login_as', login);
    const back = await fetch(authorize, { redirect: 'manual' });
    return this.fetch(back.headers.get('location')!);
  }

  /** Google のログインの最初の一歩。Google へ送られる URL を返す。 */
  async startGoogle(query = '') {
    const response = await this.fetch(`/auth/google${query}`);
    expect(response.status).toBe(302);
    return new URL(response.headers.get('location')!);
  }

  /** Google のログインを最後まで通す。callback の応答を返す。 */
  async googleLogin(login: string, { query = '?next=/', tamper, name }: { query?: string; tamper?: string; name?: string } = {}) {
    const authorize = await this.startGoogle(query);
    authorize.searchParams.set('login_as', login);
    if (tamper) authorize.searchParams.set('tamper', tamper);
    if (name) authorize.searchParams.set('name_as', name);
    const back = await fetch(authorize, { redirect: 'manual' });
    return this.fetch(back.headers.get('location')!);
  }

  async me() {
    return (await this.fetch('/api/me')).json();
  }

  async account() {
    return (await this.fetch('/api/account')).json();
  }
}
