// パスキーのログインと回復のコード（docs/tasks/T020.md「7」、SEC001 B2-2、B2-4、B2-8）。
// CBOR と署名の確かめは @simplewebauthn/server に任せる。自前で書かない。
// challenge はサーバーで作り、1回だけ、5分で切れる（auth_flows）。RP ID と origin は wrangler.jsonc の値だけを受ける。
// 持つのは公開鍵とその情報だけ。attestation は求めない。

import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type AuthenticatorTransport, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { Hono, type Context } from 'hono';
import { localeOfPath, localizedPath } from '../src/i18n';
import { startFlow, takeFlow, type FlowCookie } from './authFlow';
import type { Env } from './env';
import { checkHandle } from './handle';
import { safeNext } from './loginFlow';
import { isPasskeyAvailable } from './methods';
import { isSameOrigin } from './origin';
import { takeSignupQuota } from './quota';
import { parsePasskeyLabel } from './profile';
import { generateRecoveryCode, hashRecoveryCode } from './recoveryCode';
import { getSessionUser, isRecentAuth, startSession } from './session';

type PasskeyEnv = { Bindings: Env };
type PasskeyContext = Context<PasskeyEnv>;

const CHALLENGE_SECONDS = 5 * 60;
const PASSKEY_FLOW: FlowCookie = { name: 'ld_passkey_flow', path: '/auth/passkey', kind: 'passkey', seconds: CHALLENGE_SECONDS };
const RP_NAME = 'Ludion';
/** 1人のパスキーの上限。 */
const MAX_PASSKEYS = 10;
const MAX_JSON_BYTES = 64 * 1024;

interface RegisterFlow {
  type: 'register';
  challenge: string;
  userId: string;
  /** 新しい人の handle。ログイン中の人が足すときは null */
  handle: string | null;
  next: string;
}

interface LoginFlow {
  type: 'login';
  challenge: string;
  /** もう一度のログインのとき、今の本人 */
  reauthUserId: string | null;
  next: string;
}

interface PasskeyRow {
  credential_id: string;
  user_id: string;
  public_key: string;
  sign_count: number;
  transports: string;
}

async function readJson(c: PasskeyContext): Promise<Record<string, unknown>> {
  if (Number(c.req.header('Content-Length') ?? '0') > MAX_JSON_BYTES) return {};
  const body = (await c.req.json().catch(() => null)) as unknown;
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export const passkey = new Hono<PasskeyEnv>();

// workers.dev では使えない（RP ID が合わない）。状態を変える要求は Origin を確かめる
passkey.use('*', async (c, next) => {
  if (!isPasskeyAvailable(c.env, c.req.url)) return c.json({ error: 'passkey_unavailable' }, 404);
  if (!isSameOrigin(c)) return c.json({ error: 'forbidden_origin' }, 403);
  await next();
});

/** 作り始める。ログイン中の人は自分に足す（直近のログインが要る）。ログインしていない人は handle を選んで新しく作る。 */
passkey.post('/register/options', async (c) => {
  const body = await readJson(c);
  const db = c.env.DB;
  const current = await getSessionUser(c);
  const next = safeNext(typeof body.next === 'string' ? body.next : null);

  let userId: string;
  let handle: string | null = null;
  let excluded: { credential_id: string; transports: string }[] = [];
  if (current) {
    if (!isRecentAuth(current)) return c.json({ error: 'reauth_required' }, 403);
    userId = current.id;
    excluded = (await db.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id = ?').bind(userId).all<{ credential_id: string; transports: string }>()).results;
    if (excluded.length >= MAX_PASSKEYS) return c.json({ error: 'too_many_passkeys' }, 409);
  } else {
    handle = typeof body.handle === 'string' ? body.handle.toLowerCase() : '';
    const status = await checkHandle(db, handle, null);
    if (status !== 'ok') return c.json({ error: 'handle_rejected', status }, 400);
    userId = crypto.randomUUID();
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: c.env.PASSKEY_RP_ID,
    userName: current?.handle ?? handle!,
    userDisplayName: current?.display_name ?? current?.handle ?? handle!,
    userID: new Uint8Array(new TextEncoder().encode(userId)),
    attestationType: 'none',
    excludeCredentials: excluded.map(({ credential_id, transports }) => ({ id: credential_id, transports: JSON.parse(transports) as AuthenticatorTransport[] })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const flow: RegisterFlow = { type: 'register', challenge: options.challenge, userId, handle, next };
  await startFlow(c, PASSKEY_FLOW, flow);
  return c.json(options);
});

/** 作ったパスキーを確かめて置く。新しい人なら人を作り、回復のコードを1回だけ返す。 */
passkey.post('/register/verify', async (c) => {
  const body = await readJson(c);
  const flow = await takeFlow<RegisterFlow | LoginFlow, PasskeyEnv>(c, PASSKEY_FLOW);
  if (!flow || flow.type !== 'register') return c.json({ error: 'bad_challenge' }, 400);

  const label = parsePasskeyLabel(body.label);
  if (label === undefined) return c.json({ error: 'invalid', field: 'label' }, 400);

  let info;
  try {
    const verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: flow.challenge,
      expectedOrigin: c.env.PASSKEY_ORIGIN,
      expectedRPID: c.env.PASSKEY_RP_ID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return c.json({ error: 'verification_failed' }, 400);
    info = verification.registrationInfo;
  } catch {
    return c.json({ error: 'verification_failed' }, 400);
  }

  const db = c.env.DB;
  const now = Date.now();
  const { credential } = info;
  const insertPasskey = db
    .prepare('INSERT INTO passkeys (credential_id, user_id, public_key, sign_count, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(credential.id, flow.userId, isoBase64URL.fromBuffer(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), label, now);

  if (flow.handle === null) {
    // ログイン中の人が足す。作り始めた人と同じ人で、まだ直近のログインがあること
    const current = await getSessionUser(c);
    if (!current || current.id !== flow.userId || !isRecentAuth(current)) return c.json({ error: 'reauth_required' }, 403);
    try {
      await insertPasskey.run();
    } catch {
      return c.json({ error: 'credential_exists' }, 409);
    }
    await startSession(c, current.id, { revokeOthers: true, keepAuthAt: current.authAt });
    return c.json({ next: flow.next });
  }

  // 新しい人を作る回数の上限（docs/tasks/T021.md）
  if (!(await takeSignupQuota(c.env, c.req.header('CF-Connecting-IP')))) return c.json({ error: 'signup_limited' }, 429);

  const recoveryCode = generateRecoveryCode();
  try {
    await db.batch([
      db.prepare('INSERT INTO users (id, handle, display_name, avatar_url, created_at) VALUES (?, ?, NULL, NULL, ?)').bind(flow.userId, flow.handle, now),
      insertPasskey,
      db.prepare('INSERT INTO recovery_codes (code_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await hashRecoveryCode(recoveryCode), flow.userId, now),
    ]);
  } catch {
    // 作っている間に、ほかの人が先に handle を取った
    return c.json({ error: 'handle_rejected', status: 'taken' }, 409);
  }
  await startSession(c, flow.userId);
  return c.json({ next: flow.next, recovery_code: recoveryCode });
});

/** ログインを始める。名前を打たずに選べる形（discoverable credential）。 */
passkey.post('/login/options', async (c) => {
  const body = await readJson(c);
  const reauth = body.intent === 'reauth';
  const current = reauth ? await getSessionUser(c) : null;
  if (reauth && !current) return c.json({ error: 'unauthorized' }, 401);
  const options = await generateAuthenticationOptions({ rpID: c.env.PASSKEY_RP_ID, userVerification: 'required', allowCredentials: [] });
  const flow: LoginFlow = { type: 'login', challenge: options.challenge, reauthUserId: current?.id ?? null, next: safeNext(typeof body.next === 'string' ? body.next : null) };
  await startFlow(c, PASSKEY_FLOW, flow);
  return c.json(options);
});

/** 署名を確かめてログインする。0 でない鍵で数が戻ったら、ライブラリが断る。 */
passkey.post('/login/verify', async (c) => {
  const body = await readJson(c);
  const flow = await takeFlow<RegisterFlow | LoginFlow, PasskeyEnv>(c, PASSKEY_FLOW);
  if (!flow || flow.type !== 'login') return c.json({ error: 'bad_challenge' }, 400);
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (typeof response?.id !== 'string') return c.json({ error: 'verification_failed' }, 400);

  const db = c.env.DB;
  const row = await db.prepare('SELECT credential_id, user_id, public_key, sign_count, transports FROM passkeys WHERE credential_id = ?').bind(response.id).first<PasskeyRow>();
  if (!row) return c.json({ error: 'verification_failed' }, 400);
  // もう一度のログインは、今の本人のパスキーでなければ受けない
  if (flow.reauthUserId && row.user_id !== flow.reauthUserId) return c.json({ error: 'reauth_mismatch' }, 403);

  let newCounter: number;
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: flow.challenge,
      expectedOrigin: c.env.PASSKEY_ORIGIN,
      expectedRPID: c.env.PASSKEY_RP_ID,
      requireUserVerification: true,
      credential: {
        id: row.credential_id,
        publicKey: isoBase64URL.toBuffer(row.public_key),
        counter: row.sign_count,
        transports: JSON.parse(row.transports) as AuthenticatorTransport[],
      },
    });
    if (!verification.verified) return c.json({ error: 'verification_failed' }, 400);
    newCounter = verification.authenticationInfo.newCounter;
  } catch {
    return c.json({ error: 'verification_failed' }, 400);
  }

  await db.prepare('UPDATE passkeys SET sign_count = ?, last_used_at = ? WHERE credential_id = ?').bind(newCounter, Date.now(), row.credential_id).run();
  await startSession(c, row.user_id);
  return c.json({ next: flow.next });
});

/** 回復のコードで入る。1回使ったら消える。ほかのセッションも消す（SEC001 B2-5）。回数の制限は app.ts。 */
passkey.post('/recovery', async (c) => {
  const body = await readJson(c);
  const code = typeof body.code === 'string' ? body.code : '';
  const row = await c.env.DB.prepare('DELETE FROM recovery_codes WHERE code_hash = ? RETURNING user_id').bind(await hashRecoveryCode(code)).first<{ user_id: string }>();
  if (!row) return c.json({ error: 'invalid_code' }, 400);
  await startSession(c, row.user_id, { revokeOthers: true });
  const next = safeNext(typeof body.next === 'string' ? body.next : null);
  return c.json({ next: `${localizedPath(localeOfPath(new URL(next, 'https://next.invalid').pathname), '/account')}?recovered=1` });
});
