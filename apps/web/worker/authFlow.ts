// ログインの途中の状態（docs/tasks/T020.md「6」「7」、SEC001 B2-7、docs/tasks/FIX-login.md）。
// ブラウザの cookie には乱数だけを渡し、中身は D1 に置く。取り出しは1回だけで、短い時間で切れる。

import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Env } from './env';
import { hashToken, randomHex, SECURE_COOKIE } from './session';

type AppBindings = { Bindings: Env };

/** randomHex(FLOW_BYTES) の形。ほかの形の cookie では D1 を読まない。 */
const FLOW_TOKEN = /^[0-9a-f]{64}$/;
const FLOW_BYTES = 32;
/** 作るたびに消す、切れた行の上限。行は作るときにしか増えないので、これで溜まらない。 */
const EXPIRED_BATCH = 50;
/** 同じブラウザで同時に持てる、state で見分ける途中の状態の数（2回押し、2つのタブ）。 */
const MAX_STATE_FLOWS = 3;

export interface FlowCookie {
  name: string;
  path: string;
  kind: string;
  seconds: number;
}

const cookieOptions = (flow: FlowCookie) => ({ ...SECURE_COOKIE, path: flow.path });

const DELETE_EXPIRED = 'DELETE FROM auth_flows WHERE token_hash IN (SELECT token_hash FROM auth_flows WHERE expires_at <= ? LIMIT ?)';
const INSERT_FLOW = 'INSERT INTO auth_flows (token_hash, kind, data, expires_at) VALUES (?, ?, ?, ?)';
const DELETE_FLOW = 'DELETE FROM auth_flows WHERE token_hash = ?';
const TAKE_FLOW = 'DELETE FROM auth_flows WHERE token_hash = ? AND kind = ? AND expires_at > ? RETURNING data';

/** 途中の状態を置き、cookie に乱数を入れる。同じ cookie の前の状態は消す。 */
export async function startFlow<E extends AppBindings>(c: Context<E>, flow: FlowCookie, data: object): Promise<void> {
  const token = randomHex(FLOW_BYTES);
  const now = Date.now();
  const previous = getCookie(c, flow.name);
  const db = c.env.DB;
  await db.batch([
    db.prepare(DELETE_FLOW).bind(previous ? await hashToken(previous) : ''),
    db.prepare(DELETE_EXPIRED).bind(now, EXPIRED_BATCH),
    db.prepare(INSERT_FLOW).bind(await hashToken(token), flow.kind, JSON.stringify(data), now + flow.seconds * 1000),
  ]);
  setCookie(c, flow.name, token, { ...cookieOptions(flow), maxAge: flow.seconds });
}

/** 取り出さずに読む。なければ、切れていれば、null。 */
export async function readFlow<T, E extends AppBindings>(c: Context<E>, flow: FlowCookie): Promise<T | null> {
  const token = getCookie(c, flow.name);
  if (!token || !FLOW_TOKEN.test(token)) return null;
  const row = await c.env.DB.prepare('SELECT data FROM auth_flows WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .bind(await hashToken(token), flow.kind, Date.now())
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as T) : null;
}

/** 取り出す。1回だけ。同時に2つ来ても、片方にしか渡さない。cookie も消す。 */
export async function takeFlow<T, E extends AppBindings>(c: Context<E>, flow: FlowCookie): Promise<T | null> {
  const token = getCookie(c, flow.name);
  deleteCookie(c, flow.name, cookieOptions(flow));
  if (!token || !FLOW_TOKEN.test(token)) return null;
  const row = await c.env.DB.prepare(TAKE_FLOW)
    .bind(await hashToken(token), flow.kind, Date.now())
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as T) : null;
}

// ---------------------------------------------------------------- state で見分ける途中の状態（GitHub、Google）
// 2回押しや2つのタブで、同じブラウザが同時に別の state を持つ。戻ってきた state と合うものだけを使い、ほかには触らない。
// cookie は状態1つに1つで、書き換えない。1つの cookie に並べると、2つのタブが同時に動いたときに、後の書き込みが前の状態を消すため。
// 名前の後ろは「作った時刻＋乱数」で、並べると古い順になる（時刻は36進の8桁。2059年まで桁が変わらない）。

export interface StateFlowData {
  state: string;
  next: string;
}

/**
 * 戻ってきた state の結果。合わないときは、ログインの画面の戻り先と、出す文の名前を返す。
 * login_open_browser：state の行は残っているのに、このブラウザに cookie がない。別のブラウザで始めた（アプリの中のブラウザから Safari へ移ったなど）。
 * login_retry：それ以外（使った、切れた、知らない state）。
 */
export type TakenStateFlow<T> = { taken: T } | { taken: null; retryNext: string | null; retryError: 'login_retry' | 'login_open_browser' };

const stateCookieName = (flow: FlowCookie) => `${flow.name}_${Date.now().toString(36)}${randomHex(2)}`;

/** このブラウザが持つ状態の cookie。古い順。形の違うものは数えない。 */
function heldStateCookies<E extends AppBindings>(c: Context<E>, flow: FlowCookie): [name: string, token: string][] {
  return Object.entries(getCookie(c))
    .filter(([name, token]) => name.startsWith(`${flow.name}_`) && FLOW_TOKEN.test(token))
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

/** 途中の状態を足す。上限を超える分は、古いものから消す。 */
export async function startStateFlow<T extends StateFlowData, E extends AppBindings>(c: Context<E>, flow: FlowCookie, data: T): Promise<void> {
  const token = randomHex(FLOW_BYTES);
  const now = Date.now();
  const held = heldStateCookies(c, flow);
  const dropped = held.slice(0, Math.max(0, held.length - (MAX_STATE_FLOWS - 1)));
  const db = c.env.DB;
  await db.batch([
    ...(await Promise.all(dropped.map(async ([, old]) => db.prepare(DELETE_FLOW).bind(await hashToken(old))))),
    db.prepare(DELETE_EXPIRED).bind(now, EXPIRED_BATCH),
    db.prepare(INSERT_FLOW).bind(await hashToken(token), flow.kind, JSON.stringify(data), now + flow.seconds * 1000),
  ]);
  for (const [name] of dropped) deleteCookie(c, name, cookieOptions(flow));
  setCookie(c, stateCookieName(flow), token, { ...cookieOptions(flow), maxAge: flow.seconds });
}

/**
 * このブラウザの cookie と合わなかった state の行き先。別のブラウザの状態なら、それを読むだけで、取り出さない。
 * cookie なしで state だけを見てログインさせない（相手が自分の state と code を開かせると、相手のアカウントに入れられるため）。
 */
async function missedStateFlow<T extends StateFlowData, E extends AppBindings>(c: Context<E>, flow: FlowCookie, state: string | undefined, fallbackNext: string | null): Promise<TakenStateFlow<T>> {
  if (state && FLOW_TOKEN.test(state)) {
    // JSON.stringify の結果なので、この形は state の値のところにしか現れない（文字列の中の " は \" になる）
    const row = await c.env.DB.prepare('SELECT data FROM auth_flows WHERE kind = ? AND expires_at > ? AND instr(data, ?) > 0 LIMIT 1')
      .bind(flow.kind, Date.now(), `"state":"${state}"`)
      .first<{ data: string }>();
    if (row) return { taken: null, retryNext: (JSON.parse(row.data) as T).next, retryError: 'login_open_browser' };
  }
  return { taken: null, retryNext: fallbackNext, retryError: 'login_retry' };
}

/**
 * 戻ってきた state と合う状態を取り出す。1回だけ。同時に2つ来ても、片方にしか渡さない。使った cookie と切れた cookie を消す。
 * 合わなければ何も消さない。読み直しや戻るで古い state が来ても、ほかのタブのログインを壊さないため（state は256ビットで、数を打っても当たらない）。
 */
export async function takeStateFlow<T extends StateFlowData, E extends AppBindings>(c: Context<E>, flow: FlowCookie, state: string | undefined): Promise<TakenStateFlow<T>> {
  const held = heldStateCookies(c, flow).slice(-MAX_STATE_FLOWS);
  if (held.length === 0) return missedStateFlow<T, E>(c, flow, state, null);

  const hashes = await Promise.all(held.map(([, token]) => hashToken(token)));
  const db = c.env.DB;
  const now = Date.now();
  const { results } = await db
    .prepare(`SELECT token_hash, data FROM auth_flows WHERE token_hash IN (${hashes.map(() => '?').join(', ')}) AND kind = ? AND expires_at > ?`)
    .bind(...hashes, flow.kind, now)
    .all<{ token_hash: string; data: string }>();
  const live = new Map(results.map((row) => [row.token_hash, JSON.parse(row.data) as T]));
  held.forEach(([name], index) => {
    if (!live.has(hashes[index])) deleteCookie(c, name, cookieOptions(flow));
  });

  const index = state ? hashes.findIndex((hash) => live.get(hash)?.state === state) : -1;
  if (index < 0) {
    const newest = hashes.findLast((hash) => live.has(hash));
    return missedStateFlow<T, E>(c, flow, state, newest ? live.get(newest)!.next : null);
  }
  deleteCookie(c, held[index][0], cookieOptions(flow));
  const row = await db.prepare(TAKE_FLOW).bind(hashes[index], flow.kind, now).first<{ data: string }>();
  return row ? { taken: JSON.parse(row.data) as T } : { taken: null, retryNext: null, retryError: 'login_retry' };
}
