// AI の口（docs/tasks/T037.md「2」）。AI（Claude Code など）が、本人の AI の鍵で作品を置く、一覧を見る、コードを取る。
//
// - 認証は Authorization: Bearer ld_…（AI の鍵）か ldo_…（AI につないだトークン。MCP001）だけ。cookie は読まない。
//   ブラウザから呼ぶものではないので、CORS の頭は付けない。MCP サーバー（mcp.ts）は、この口を中から呼ぶ。
// - 置いたものは「自分だけ」（docs/tasks/T036.md）。本人にしか見えない。公開（審査に出す）は、サイトの画面から本人がする。ここからは公開できない。
//   公開している作品に置いた新しい版だけは、今までどおり下書き（審査に出すまで公開の版は変わらない）。
// - html がふつうの HTML 文書（<!doctype か <html で始まる）なら、文書のまま置く（DOC001）。作品の契約の検査をせず、見るのは大きさと読める文字だけ。
//   種類は画面（screen）。枠は文書をそのまま返す（frames.ts）。作者が書いた契約の形（根と mount）の文書は、下の今までの受け方（htmlForm）。
// - html は /new の1つの箱と同じ受け方：同じ分け方（splitSnippet、fixParts）、同じ検査（checkSubmission）、同じ大きさの上限、
//   同じ保存（post.ts の writeDraft）。投稿の1日の上限（POST_LIMITS）もそのまま効く。
// - 回数の上限：置くのは1人1時間30回、ほかの読み取りは1時間300回（quotas）。超えたら 429 と、次に使える時刻。
// - エラーはどれも { error: <決まった語>, message }。文は Accept-Language で日本語か英語。
// - 鍵の生の値は、ログに出さない（log.ts は道の種類と決まった語だけ）。
// - 読み方は「まず地図、次に要る部分」（WS006）。GET /works/:id/outline が地図、GET /works/:id/code が行の範囲か分け目の1つ。
//   この2つだけは、公開の作品の公開の版なら鍵なしでも読める（/p/:id/code と同じく、だれでも読めるもの）。
//   鍵があれば、自分の作品はいちばん新しい版、ほかの人の作品は公開の版。読めないものは、ない作品と同じ 404（worker/workRead.ts）。

import { MAX_PART_READ_BYTES, TECH_LIST, techQuery } from '@ludion/outline';
import { buildCopySnippet, stripDocumentCredits } from '@ludion/render';
import {
  checkDocument,
  fixParts,
  htmlForm,
  ID_PATTERN,
  MAX_DOCUMENT_BYTES,
  MAX_PART_BYTES,
  MAX_TITLE_CHARS,
  partIdOf,
  splitSnippet,
  SUBTYPES,
  workShape,
  type Category,
  type ProblemText,
  type SplitError,
} from '@ludion/rules';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { localizedPath, type Locale } from '../src/i18n';
import { keyUser } from './aiKeys';
import { apiDocs } from './apiDocs';
import type { Env } from './env';
import { cleanClientName, grantUser } from './oauth';
import { loadOutline } from './outline';
import { checkWorkId, placePrivate, readBody, writeDraft, type PostMeta } from './post';
import { nextDay, nextHour, takeApiQuota } from './quota';
import { canPost, countPrivateWorks, loadRevisionFiles, ownedRevision, ownedWork, PRIVATE_WORKS_LIMIT, type RevisionRow } from './revisions';
import { creditTexts, fullCode, loadFiles, loadMap, readPart, readableWork, type ReadableWork } from './workRead';

/**
 * 置く人。AI の鍵（ld_…）か、AI につないだときのアクセスのトークン（ldo_…。worker/oauth.ts、MCP001）の持ち主。
 * via：その版をどの AI から置いたか（自分の置き場の小さな印）。X-Ludion-Client の見出しがあればそれ（鍵でも、つないだトークンでも）。
 * なければ、つないだトークンはつないだときの名前、鍵は API。
 */
export interface ApiUser {
  id: string;
  handle: string;
  isOperator: boolean;
  via: string;
}

type ApiEnv = { Bindings: Env; Variables: { user: ApiUser; locale: Locale } };

const MAX_VIA_CHARS = 40;

/** Authorization の見出しから、置く人を決める。鍵もトークンも違えば null。 */
export async function apiUser(db: D1Database, authorization: string | undefined, client: string | undefined): Promise<ApiUser | null> {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(authorization ?? '');
  if (!match) return null;
  const token = match[1];
  // 見出しの印は、鍵でもつないだトークンでも同じ整え方（同じつながりを分け合うプラグイン、ld、デスクトップアプリを分けるため。VIA001）
  const mark = client ? [...cleanClientName(client)].slice(0, MAX_VIA_CHARS).join('').trim() : null;
  if (token.startsWith('ldo_')) {
    const user = await grantUser(db, token);
    return user && { id: user.id, handle: user.handle, isOperator: user.isOperator, via: mark ?? user.clientName };
  }
  const user = await keyUser(db, token);
  return user && { id: user.id, handle: user.handle, isOperator: user.isOperator, via: mark ?? 'API' };
}
type ApiContext = Context<ApiEnv>;

export const apiV1 = new Hono<ApiEnv>();

const UNTITLED: Record<Locale, string> = { ja: '無題', en: 'Untitled' };
const CREATE_KEYS = new Set(['html', 'title', 'from']);
const VERSION_KEYS = new Set(['html', 'title']);

/** Accept-Language のいちばん重いものが日本語なら日本語。ほかは英語（AI の既定）。 */
export function apiLocale(header: string | undefined): Locale {
  if (!header) return 'en';
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param)?.[1]).find(Boolean);
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((item) => item.tag !== '' && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.tag.startsWith('ja') ? 'ja' : 'en';
}

type Message = Record<Locale, string>;

const MESSAGES = {
  unauthorized: { ja: 'AI の鍵がない、違う、または消されています。Authorization: Bearer ld_… を付けてください', en: 'The AI key is missing, wrong, or deleted. Send Authorization: Bearer ld_…' },
  rate_limited_put: { ja: '置けるのは1時間に30回までです。retry_at の後にもう一度送ってください', en: 'You can put 30 times an hour. Try again after retry_at.' },
  rate_limited_read: { ja: '読めるのは1時間に300回までです。retry_at の後にもう一度送ってください', en: 'You can read 300 times an hour. Try again after retry_at.' },
  rate_limited_saves: { ja: '今日保存できる回数の上限に達しました。retry_at の後にもう一度送ってください', en: 'You reached today’s limit for saves. Try again after retry_at.' },
  rate_limited_revisions: { ja: '今日作れる版の上限に達しました。retry_at の後にもう一度送ってください', en: 'You reached today’s limit for new versions. Try again after retry_at.' },
  bad_request: { ja: '本文は JSON のオブジェクトにしてください（Content-Type: application/json）', en: 'Send a JSON object as the body (Content-Type: application/json).' },
  unknown_field: { ja: '知らない項目があります。使えるのは html、title、from（新しい作品のときだけ）です', en: 'Unknown field. Allowed: html, title, and from (new works only).' },
  bad_html: { ja: 'html に、作品の HTML を文字で入れてください', en: 'Put the work’s HTML as a string in html.' },
  bad_title: { ja: `title は ${MAX_TITLE_CHARS} 文字までの文字にしてください（改行なし）`, en: `title must be a string of up to ${MAX_TITLE_CHARS} characters, without line breaks.` },
  bad_from: { ja: 'from の作品がない、公開されていない、または自分自身です。公開されている作品の ID を入れてください', en: 'The from work does not exist, is not public, or is the work itself. Use the ID of a public work.' },
  too_large: { ja: `HTML、CSS、JS は、それぞれ ${MAX_PART_BYTES / 1024}KB までです`, en: `The HTML, CSS and JS can each be up to ${MAX_PART_BYTES / 1024}KB.` },
  too_large_document: { ja: `HTML の文書は ${MAX_DOCUMENT_BYTES / 1024}KB までです`, en: `An HTML document can be up to ${MAX_DOCUMENT_BYTES / 1024}KB.` },
  invalid_work: { ja: 'このままでは置けません。problems の fix のとおりに直して、もう一度送ってください', en: 'The work can’t be put as it is. Fix each item in problems (see fix) and send it again.' },
  not_found: { ja: '作品が見つかりません。自分の作品の ID を入れてください', en: 'Work not found. Use the ID of one of your own works.' },
  in_review: { ja: 'この作品は審査中です。審査が終わるまで、新しい版は置けません', en: 'This work is in review. You can’t put a new version until the review is done.' },
  posting_closed: { ja: 'いまは作品を置けません', en: 'Posting is closed right now.' },
  conflict: { ja: 'ほかの操作とぶつかりました。もう一度送ってください', en: 'Another change got there first. Send it again.' },
  private_limit: {
    ja: `自分だけの作品は ${PRIVATE_WORKS_LIMIT} 作品までです。今の作品に新しい版を置くことはできます`,
    en: `You can have up to ${PRIVATE_WORKS_LIMIT} “Only me” works. You can still put new versions of the works you have.`,
  },
  no_id: { ja: '作品の ID を決められませんでした。もう一度送ってください', en: 'Could not pick an ID for the work. Send it again.' },
  unknown_path: { ja: 'この道はありません。GET /api/v1 に使い方があります', en: 'No such endpoint. GET /api/v1 explains the API.' },
  not_readable: { ja: '作品が見つかりません。自分の作品か、公開されている作品の ID を入れてください', en: 'Work not found. Use the ID of one of your own works or of a public work.' },
  version_changed: { ja: '作品の版が変わりました。地図を取り直してください（current_version が今の版）', en: 'The work has a different version now. Get the map again (current_version is the version now).' },
  bad_part: {
    ja: 'section（分け目の呼び名。例 shader:WINDOW_FRAG）か、file と lines（行の範囲。例 200-760）のどちらかを入れてください',
    en: 'Give either section (a selector from the map, e.g. shader:WINDOW_FRAG) or file and lines (a line range, e.g. 200-760).',
  },
  file_required: { ja: 'file を入れてください（files のどれか）', en: 'Give file (one of files).' },
  file_not_found: { ja: 'その名前のファイルはありません（files のどれか）', en: 'No file with that name (use one of files).' },
  section_not_found: { ja: 'その分け目はありません。地図の呼び名をそのまま入れてください（candidates は近いもの）', en: 'No such section. Use a selector exactly as the map gives it (candidates are close ones).' },
  ambiguous_section: { ja: '同じ名前の分け目が2つ以上あります。candidates のどれかをそのまま入れてください', en: 'More than one section has that name. Use one of candidates exactly.' },
  out_of_range: { ja: '行の範囲がファイルの外です（total がファイルの行の数）', en: 'The line range is outside the file (total is the number of lines in the file).' },
  part_too_large: {
    ja: `1回に読めるのは ${MAX_PART_READ_BYTES / 1024}KB までです。範囲を狭めてください（inside は、その中の分け目）`,
    en: `One read can be up to ${MAX_PART_READ_BYTES / 1024}KB. Narrow the range (inside lists the sections in it).`,
  },
  bad_tech: { ja: '知らない技術の名前です（allowed のどれか。, で区切ると、全部を使う作品）', en: 'Unknown tech name (use ones from allowed; separate with , for works that use all of them).' },
} satisfies Record<string, Message>;

type MessageName = keyof typeof MESSAGES;

/** 分けられなかったときの、問題と直し方。 */
const SPLIT_PROBLEMS: Record<SplitError, { ja: { message: string; fix: string }; en: { message: string; fix: string } }> = {
  empty: { ja: { message: 'HTML が空です', fix: '作品の HTML を html に入れる' }, en: { message: 'The HTML is empty', fix: 'Put the work’s HTML in html' } },
  external_script: {
    ja: { message: '外のファイルを読む <script src> があります', fix: 'JS は <script type="module"> の中に書く。外へ通信しない' },
    en: { message: 'It has a <script src> that loads an outside file', fix: 'Write the JS inside <script type="module">. Do not make external requests' },
  },
  many_scripts: {
    ja: { message: '<script> が2つ以上あります', fix: '<script type="module"> を1つにまとめる' },
    en: { message: 'It has more than one <script>', fix: 'Combine them into one <script type="module">' },
  },
  unknown_script: {
    ja: { message: 'JS ではない種類の <script> があります', fix: '<script type="module"> だけを使う' },
    en: { message: 'It has a <script> that isn’t JavaScript', fix: 'Use only <script type="module">' },
  },
};

function fail(c: ApiContext, status: ContentfulStatusCode, error: string, name: MessageName = error as MessageName, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return c.json({ error, message: MESSAGES[name][c.get('locale')], ...extra }, status, headers);
}

function limited(c: ApiContext, name: MessageName, retryAt: number, extra: Record<string, unknown> = {}) {
  const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
  return fail(c, 429, 'rate_limited', name, { retry_at: new Date(retryAt).toISOString(), ...extra }, { 'Retry-After': String(seconds) });
}

/** IP の束縛（app.ts）で止めたときの本文。エラーの形をこの口に揃える。 */
export const apiLimitedBody = (c: Context<{ Bindings: Env }>, retryAfterSeconds: number) => ({
  message: { ja: '要求が多すぎます。retry_at の後にもう一度送ってください', en: 'Too many requests. Try again after retry_at.' }[apiLocale(c.req.header('Accept-Language'))],
  retry_at: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
});

const problemsOf =(problems: ProblemText[], locale: Locale) => problems.map((p) => (locale === 'en' && p.en ? { message: p.en.message, fix: p.en.fix } : { message: p.message, fix: p.fix }));

const origin = (c: ApiContext) => new URL(c.req.url).origin;
const workUrl = (c: ApiContext, id: string) => `${origin(c)}${localizedPath(c.get('locale'), `/p/${encodeURIComponent(id)}`)}`;
const codeUrl = (c: ApiContext, id: string) => `${origin(c)}/p/${encodeURIComponent(id)}/code`;
/** 今の見え方。公開、自分だけ（docs/tasks/T036.md）、下書き（T036 の前に置いたもの。本人だけが見られる）。 */
const visibilityOf = (workStatus: string) => (workStatus === 'approved' ? 'public' : workStatus === 'private' ? 'private' : 'draft');

// 説明（docs/tasks/T037.md「4」）。鍵は要らない。AI が読んで使えるように Markdown で返す
apiV1.get('/', (c) => {
  const locale = apiLocale(c.req.header('Accept-Language'));
  return c.body(apiDocs(locale, origin(c as unknown as ApiContext)), 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Language': locale });
});

// '/works/*' は '/works' にも当たる（Hono）。'/works' にも付けると、1回の要求で2回数える
apiV1.use('/works/*', authenticate);

/** 鍵なしでも読める道：地図と、要る部分（WS006）。鍵なしで読めるのは、公開の作品の公開の版だけ。 */
const OPEN_READ = /\/works\/[^/]+\/(?:outline|code)$/;

/** 鍵を確かめ、回数を数える。cookie は見ない。 */
async function authenticate(c: ApiContext, next: () => Promise<void>) {
  c.set('locale', apiLocale(c.req.header('Accept-Language')));
  // 鍵なしの読み取り。IP の束縛（app.ts）だけで数える。Authorization があれば、違う鍵は今までどおり 401
  if (c.req.method === 'GET' && c.req.header('Authorization') === undefined && OPEN_READ.test(c.req.path)) return next();
  const user = await apiUser(c.env.DB, c.req.header('Authorization'), c.req.header('X-Ludion-Client'));
  if (!user) return fail(c, 401, 'unauthorized', 'unauthorized', {}, { 'WWW-Authenticate': 'Bearer' });
  c.set('user', user);
  const now = Date.now();
  const put = c.req.method === 'POST';
  if (!(await takeApiQuota(c.env.DB, user.id, put ? 'put' : 'read', now))) return limited(c, put ? 'rate_limited_put' : 'rate_limited_read', nextHour(now));
  await next();
}

/** 本文の JSON を読む。だめなら応答。 */
async function readInput(c: ApiContext, allowed: Set<string>): Promise<{ html: string; title: string | null; from: string | null } | Response> {
  if (!/^application\/json\b/i.test(c.req.header('Content-Type') ?? '')) return fail(c, 400, 'bad_request');
  const bytes = await readBody(c.req.raw);
  if (!bytes) return fail(c, 413, 'too_large');
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
  } catch {
    return fail(c, 400, 'bad_request');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail(c, 400, 'bad_request');
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.has(key))) return fail(c, 400, 'unknown_field');
  if (typeof body.html !== 'string') return fail(c, 400, 'bad_html');
  if (body.title !== undefined && body.title !== null && typeof body.title !== 'string') return fail(c, 400, 'bad_title');
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  // eslint-disable-next-line no-control-regex
  if ([...title].length > MAX_TITLE_CHARS || /[\u0000-\u001f\u007f]/.test(title)) return fail(c, 400, 'bad_title');
  if (body.from !== undefined && body.from !== null && typeof body.from !== 'string') return fail(c, 422, 'bad_from');
  return { html: body.html, title: title === '' ? null : title, from: typeof body.from === 'string' ? body.from : null };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML の <title> の文字。なければ null。 */
export function titleOfHtml(html: string): string | null {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (!match) return null;
  const text = match[1]
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\s]+/g, ' ')
    .trim();
  return text === '' ? null : [...text].slice(0, MAX_TITLE_CHARS).join('').trim();
}

/** 新しい作品の ID。貼ったコードの data-ld-part の値を先に試し、取れなければ後ろに乱数（/new の pickWorkId と同じ形）。 */
async function pickId(db: D1Database, preferred: string | null): Promise<string | null> {
  const random = () => Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const base = preferred && ID_PATTERN.test(preferred) && !preferred.includes('ludion') ? preferred.slice(0, 50).replace(/-+$/, '') : null;
  const usable = base !== null && base.length >= 3;
  const candidates = [...(usable ? [base] : []), ...Array.from({ length: 4 }, () => (usable ? `${base}-${random()}` : `ui-${random()}${random().slice(0, 2)}`))];
  for (const candidate of candidates) {
    if ((await checkWorkId(db, candidate)) === 'ok') return candidate;
  }
  return null;
}

/** 1つの HTML を3つに分け、ID に合わせる。だめなら応答。 */
function splitWork(c: ApiContext, html: string) {
  const split = splitSnippet(html);
  if (!split.ok) return fail(c, 422, 'invalid_work', 'invalid_work', { problems: [SPLIT_PROBLEMS[split.error][c.get('locale')]] });
  const { parts } = split;
  const encoder = new TextEncoder();
  if ([parts.html, parts.css, parts.js ?? ''].some((part) => encoder.encode(part).length > MAX_PART_BYTES)) return fail(c, 413, 'too_large');
  return parts;
}

/**
 * 文書の作品（DOC001）の文書。大きさと読める文字だけを見る。だめなら応答。
 * 頭のクレジット行は外す（載せるときにサーバーが作り直す。get_work で取ったコードを送り直しても重ならない）。ほかは1文字も変えない。
 */
function documentWork(c: ApiContext, html: string): string | Response {
  if (new TextEncoder().encode(html).length > MAX_DOCUMENT_BYTES) return fail(c, 413, 'too_large', 'too_large_document');
  const problems = checkDocument(html);
  if (problems.length > 0) return fail(c, 422, 'invalid_work', 'invalid_work', { problems: problemsOf(problems, c.get('locale')) });
  return stripDocumentCredits(html);
}

/** 文書の作品の種類。画面（screen）の種類だけ。部品の種類（中央寄せで背景が縮む。MCP002「7」）なら Web にする。 */
function documentCategory(preferred: { category: string; subtype: string } | null): { category: Category; subtype: string } {
  const known = preferred && (SUBTYPES as Record<string, readonly string[]>)[preferred.category] ? (preferred.category as Category) : null;
  const category: Category = known && workShape(known).type === 'screen' ? known : 'Web';
  const subtype = preferred && SUBTYPES[category].includes(preferred.subtype) ? preferred.subtype : SUBTYPES[category][0];
  return { category, subtype };
}

/** 題から作る ID の案（英数字だけ。ほかの文字は - にする）。作れなければ null（pickId が乱数で決める）。 */
export function idFromTitle(title: string | null): string | null {
  const slug = (title ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : null;
}

/** writeDraft の答えを、この口の形にする。 */
async function answer(c: ApiContext, result: Awaited<ReturnType<typeof writeDraft>>) {
  if (result.ok) {
    const db = c.env.DB;
    // 公開していない作品なら、そのまま「自分だけ」の今の版にする（docs/tasks/T036.md、MCP001「1」）。
    // 公開している作品の新しい版は、下書きのまま（審査に出すまで、公開の版は変わらない。原則5）
    const revision = await ownedRevision(db, result.body.revision.id);
    if (revision && revision.work_status !== 'approved') {
      const placed = await placePrivate(db, c.get('user').id, revision);
      if (!placed.ok && placed.body.error === 'private_limit') return fail(c, 409, 'private_limit', 'private_limit', { limit: PRIVATE_WORKS_LIMIT });
      if (!placed.ok) return fail(c, 409, 'conflict');
    }
    const work = await ownedWork(db, result.body.work_id);
    return c.json(
      { id: result.body.work_id, version: result.body.revision.version, url: workUrl(c, result.body.work_id), code_url: codeUrl(c, result.body.work_id), visibility: visibilityOf(work?.status ?? 'draft') },
      201,
    );
  }
  const { error } = result.body;
  if (error === 'invalid') return fail(c, 422, 'invalid_work', 'invalid_work', { problems: problemsOf((result.body.problems as ProblemText[]) ?? [], c.get('locale')) });
  if (error === 'rate_limited') return limited(c, result.body.limit === 'revisions' ? 'rate_limited_revisions' : 'rate_limited_saves', nextDay(Date.now()), { limit: result.body.limit });
  if (error === 'in_review') return fail(c, 409, 'in_review');
  if (error === 'bad_remix_of') return fail(c, 422, 'bad_from');
  if (error === 'not_found' || error === 'forbidden') return fail(c, 404, 'not_found');
  return fail(c, 409, 'conflict');
}

// 新しい作品を置く
apiV1.post('/works', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  if (!canPost(c.env, user)) return fail(c, 403, 'posting_closed');
  const input = await readInput(c, CREATE_KEYS);
  if (input instanceof Response) return input;

  // リミックスの元（/new?from= と同じ確かめ）：公開されている作品だけ。種類とタグは元の作品から入れる
  let source: { category: Category; subtype: string; tags: string } | null = null;
  if (input.from !== null) {
    if (!ID_PATTERN.test(input.from)) return fail(c, 422, 'bad_from');
    source = await db.prepare(`SELECT category, subtype, tags FROM works WHERE id = ? AND status = 'approved'`).bind(input.from).first<{ category: Category; subtype: string; tags: string }>();
    if (!source) return fail(c, 422, 'bad_from');
  }

  // 文書の作品（DOC001）：文書のまま置く。種類は画面
  if (htmlForm(input.html) === 'document') {
    const document = documentWork(c, input.html);
    if (document instanceof Response) return document;
    const title = input.title ?? titleOfHtml(document) ?? UNTITLED[c.get('locale')];
    const id = await pickId(db, idFromTitle(input.title ?? titleOfHtml(document)));
    if (id === null) return fail(c, 409, 'conflict', 'no_id');
    if (id === input.from) return fail(c, 422, 'bad_from');
    const { category, subtype } = documentCategory(source);
    const meta: PostMeta = { id, title, remix_of: input.from, category, subtype, tags: [...new Set(source ? (JSON.parse(source.tags) as string[]) : [])], made_with: 'ai-assisted' };
    if ((await countPrivateWorks(db, user.id)) >= PRIVATE_WORKS_LIMIT) return fail(c, 409, 'private_limit', 'private_limit', { limit: PRIVATE_WORKS_LIMIT });
    return answer(c, await writeDraft(c.env, user, null, { html: '', css: '', js: null, thumb: null, document }, meta, { via: user.via, privateBound: true }));
  }

  const parts = splitWork(c, input.html);
  if (parts instanceof Response) return parts;
  const id = await pickId(db, partIdOf(parts));
  if (id === null) return fail(c, 409, 'conflict', 'no_id');
  if (id === input.from) return fail(c, 422, 'bad_from');
  const fixed = fixParts(parts, id).parts;

  const category: Category = source && (SUBTYPES as Record<string, string[]>)[source.category] ? source.category : 'Components';
  const subtype = source && SUBTYPES[category].includes(source.subtype) ? source.subtype : SUBTYPES[category][0];
  const sourceTags = source ? (JSON.parse(source.tags) as string[]) : [];
  const meta: PostMeta = {
    id,
    title: input.title ?? titleOfHtml(input.html) ?? UNTITLED[c.get('locale')],
    remix_of: input.from,
    category,
    subtype,
    tags: [...new Set(sourceTags)],
    made_with: 'ai-assisted',
  };
  // 自分だけの作品の上限（docs/tasks/T036.md「5」）。書く前に数える（下書きを残さない）
  if ((await countPrivateWorks(db, user.id)) >= PRIVATE_WORKS_LIMIT) return fail(c, 409, 'private_limit', 'private_limit', { limit: PRIVATE_WORKS_LIMIT });
  // 新しい作品は、置くと自分だけになる（版の数え方は自分だけの方。1日100）
  return answer(c, await writeDraft(c.env, user, null, { ...fixed, thumb: null }, meta, { via: user.via, privateBound: true }));
});

// 自分の作品に新しい版を置く。公開している作品なら、その作品の下書きの版になる（公開の版は変わらない）
apiV1.post('/works/:id/versions', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  if (!canPost(c.env, user)) return fail(c, 403, 'posting_closed');
  const id = c.req.param('id');
  // ほかの人の作品は、ないのと同じ 404（あることを教えない）。本文は読まない
  const work = ID_PATTERN.test(id) ? await ownedWork(db, id) : null;
  if (!work || work.owner_id !== user.id) return fail(c, 404, 'not_found');
  const input = await readInput(c, VERSION_KEYS);
  if (input instanceof Response) return input;
  const latest = await db.prepare('SELECT title, category, subtype, tags FROM revisions WHERE work_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(id).first<Pick<RevisionRow, 'title' | 'category' | 'subtype' | 'tags'>>();
  if (!latest) return fail(c, 404, 'not_found');
  // まだ自分だけでも公開でもない作品（T036 の前に置いた下書き）は、置くと自分だけになるので、上限を先に数える
  const overLimit = async () => work.status !== 'approved' && work.status !== 'private' && (await countPrivateWorks(db, user.id, id)) >= PRIVATE_WORKS_LIMIT;

  // 文書の作品（DOC001）：文書のまま置く。今までの版が部品の種類でも、文書の版は画面にする
  if (htmlForm(input.html) === 'document') {
    const document = documentWork(c, input.html);
    if (document instanceof Response) return document;
    const { category, subtype } = documentCategory(latest);
    const meta: PostMeta = {
      id,
      title: input.title ?? titleOfHtml(document) ?? (latest.title.trim() || UNTITLED[c.get('locale')]),
      remix_of: undefined,
      category,
      subtype,
      tags: JSON.parse(latest.tags) as string[],
      made_with: 'ai-assisted',
    };
    if (await overLimit()) return fail(c, 409, 'private_limit', 'private_limit', { limit: PRIVATE_WORKS_LIMIT });
    return answer(c, await writeDraft(c.env, user, id, { html: '', css: '', js: null, thumb: null, document }, meta, { via: user.via, privateBound: work.status !== 'approved' }));
  }

  const parts = splitWork(c, input.html);
  if (parts instanceof Response) return parts;
  const fixed = fixParts(parts, id).parts;
  const category = latest.category as Category;
  const meta: PostMeta = {
    id,
    title: input.title ?? titleOfHtml(input.html) ?? (latest.title.trim() || UNTITLED[c.get('locale')]),
    remix_of: undefined,
    category,
    subtype: latest.subtype,
    tags: JSON.parse(latest.tags) as string[],
    made_with: 'ai-assisted',
  };
  if (await overLimit()) return fail(c, 409, 'private_limit', 'private_limit', { limit: PRIVATE_WORKS_LIMIT });
  // 公開していない作品の版は自分だけになる（1日100）。公開の作品の版は審査に回るので、公開の数え方（1日10）
  return answer(c, await writeDraft(c.env, user, id, { ...fixed, thumb: null }, meta, { via: user.via, privateBound: work.status !== 'approved' }));
});

/** 一覧で地図を読む作品の数の上限（新しい順）。超えた分の tech は null */
const TECH_SCAN_MAX = 150;
/** 一覧の1回で、地図のない版（WS002 より前に置いた版）から地図を作って置く数の上限。残りは次に読むとき */
const TECH_BUILD_MAX = 8;
const TECH_SCAN_BATCH = 20;

/** tech の値（, で区切る）を、技術の id の集まりの並びにする。知らない言葉があれば null。 */
function techFilter(value: string): string[][] | null {
  const terms = value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '');
  const groups = terms.map((term) => techQuery(term));
  return terms.length > 0 && groups.every((group) => group !== null) ? (groups as string[][]) : null;
}

// 自分の作品の一覧。状態と版は、いちばん新しい版のもの。
// ?tech=webgl2,webaudio で、その技術を全部使う作品だけ。?with=tech で、絞らずに技術の印だけを足す（どちらも地図を読むので、ふだんの一覧より重い）
apiV1.get('/works', async (c) => {
  const techParam = c.req.query('tech');
  const filter = techParam === undefined ? null : techFilter(techParam);
  if (techParam !== undefined && filter === null) return fail(c, 400, 'bad_tech', 'bad_tech', { allowed: TECH_LIST.map((tech) => tech.id) });
  const withTech = filter !== null || c.req.query('with') === 'tech';
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.status AS work_status, r.title, r.status, r.version, r.updated_at, r.r2_prefix
     FROM works w
     JOIN creators c ON c.id = w.creator_id
     JOIN revisions r ON r.id = (SELECT id FROM revisions WHERE work_id = w.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     WHERE c.user_id = ?
     ORDER BY r.updated_at DESC, w.id`,
  )
    .bind(c.get('user').id)
    .all<{ id: string; work_status: string; title: string; status: string; version: string; updated_at: number; r2_prefix: string }>();

  // 技術の印：いちばん新しい版の地図から。地図のない版は、1回に TECH_BUILD_MAX 個まで作って置く
  const tech = new Map<string, string[] | null>();
  if (withTech) {
    let builds = TECH_BUILD_MAX;
    const scanned = results.slice(0, TECH_SCAN_MAX);
    for (let at = 0; at < scanned.length; at += TECH_SCAN_BATCH) {
      await Promise.all(
        scanned.slice(at, at + TECH_SCAN_BATCH).map(async (row) => {
          const outline = await loadOutline(c.env.PARTS, row.r2_prefix, async () => (builds-- > 0 ? loadRevisionFiles(c.env.PARTS, row.r2_prefix) : null)).catch(() => null);
          tech.set(row.id, outline ? outline.tech.map((item) => item.id) : null);
        }),
      );
    }
  }
  const matches = (ids: string[] | null) => filter === null || (ids !== null && filter.every((group) => group.some((id) => ids.includes(id))));
  const rows = withTech ? results.filter((row) => matches(tech.get(row.id) ?? null)) : results;
  // 地図を読めなかった作品の数（絞ったときは、当たるか分からないので結果に入れない）
  const unknown = withTech ? results.filter((row) => (tech.get(row.id) ?? null) === null).length : 0;
  return c.json({
    works: rows.map((row) => ({
      id: row.id,
      title: row.title,
      visibility: visibilityOf(row.work_status),
      status: row.status,
      version: row.version,
      updated_at: new Date(row.updated_at).toISOString(),
      url: workUrl(c, row.id),
      ...(withTech ? { tech: tech.get(row.id) ?? null } : {}),
    })),
    ...(unknown > 0 ? { tech_unknown: unknown } : {}),
  });
});

/** 1回の答えにコードの全部も入れる大きさ（code=auto）。これより大きい作品は、地図だけを返す。 */
export const INLINE_CODE_BYTES = 16 * 1024;

/** 読む人（鍵なしなら null）と作品 id から、読む版を決める。だめなら応答。 */
async function readTarget(c: ApiContext): Promise<ReadableWork | Response> {
  const reader = (c.get('user') as ApiUser | undefined) ?? null;
  const id = c.req.param('id') ?? '';
  const version = c.req.query('version') || undefined;
  const target = await readableWork(c.env.DB, id, reader?.id ?? null, 'mine', version);
  if (target === null) return fail(c, 404, 'not_found', 'not_readable');
  if (target === 'version_changed') {
    const current = await readableWork(c.env.DB, id, reader?.id ?? null, 'mine');
    return fail(c, 409, 'version_changed', 'version_changed', current && current !== 'version_changed' ? { current_version: current.version } : {});
  }
  return target;
}

const workInfo = (c: ApiContext, target: ReadableWork) => ({
  id: target.id,
  title: target.title,
  creator: target.creator.handle,
  own: target.own,
  visibility: visibilityOf(target.workStatus),
  status: target.status,
  version: target.version,
  from: target.remixOf?.id ?? null,
  url: workUrl(c, target.id),
});

// 作品の地図（WS006）：ファイル、行の数、技術とその行、分け目、言語。コードは入れない。
// ?code=1 でコードの全部も、?code=auto で小さい作品（INLINE_CODE_BYTES まで）だけコードも入れる（MCP の get_work が使う）
apiV1.get('/works/:id/outline', async (c) => {
  const target = await readTarget(c);
  if (target instanceof Response) return target;
  const want = c.req.query('code');
  const outline = await loadMap(c.env, target);
  if (!outline) return fail(c, 404, 'not_found', 'not_readable');
  const bytes = outline.files.reduce((sum, file) => sum + file.bytes, 0);
  const include = want === '1' || want === 'true' || (want === 'auto' && bytes <= INLINE_CODE_BYTES);
  const files = include ? await loadFiles(c.env, target) : null;
  return c.json({
    ...workInfo(c, target),
    bytes,
    max_read_bytes: MAX_PART_READ_BYTES,
    outline,
    ...(files ? { code: fullCode(target, files) } : {}),
  });
});

// 作品の一部（WS006）：?section=shader:WINDOW_FRAG（地図の呼び名）か、?file=part.js&lines=200-760。?file= だけなら、そのファイルの全部。
// code は、置いてあるファイルのその行の文字そのまま（start 行から end 行。行の番号は地図と同じ）。上限を超える部分は断る
apiV1.get('/works/:id/code', async (c) => {
  const target = await readTarget(c);
  if (target instanceof Response) return target;
  const query = { file: c.req.query('file') || undefined, lines: c.req.query('lines') || undefined, section: c.req.query('section') || undefined };
  if (query.file === undefined && query.lines === undefined && query.section === undefined) return fail(c, 400, 'bad_part');
  const part = await readPart(c.env, target, query);
  if (part.ok) return c.json({ id: target.id, version: target.version, file: part.file, section: part.section, start: part.start, end: part.end, total_lines: part.total, bytes: part.bytes, credit: creditTexts(target), code: part.code });
  const { ok: _ok, error, ...extra } = part;
  if (error === 'not_found') return fail(c, 404, 'not_found', 'not_readable');
  if (error === 'part_too_large') return fail(c, 413, error, error, extra);
  if (error === 'file_not_found' || error === 'section_not_found') return fail(c, 404, error, error, extra);
  return fail(c, 400, error, error, extra);
});

// 自分の作品の、いちばん新しい版のコード（コピーされるコードと同じ形。1行目にクレジット行）
apiV1.get('/works/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const work = ID_PATTERN.test(id) ? await ownedWork(db, id) : null;
  if (!work || work.owner_id !== c.get('user').id) return fail(c, 404, 'not_found');
  const revision = await db.prepare('SELECT * FROM revisions WHERE work_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').bind(id).first<RevisionRow>();
  const files = revision && (await loadRevisionFiles(c.env.PARTS, revision.r2_prefix));
  const creator = await db.prepare('SELECT handle, name, kind, x_url, site_url FROM creators WHERE id = ?').bind(work.creator_id).first<{ handle: string; name: string | null; kind: 'person' | 'label'; x_url: string | null; site_url: string | null }>();
  if (!revision || !files || !creator) return fail(c, 404, 'not_found');
  const source = work.remix_of
    ? await db.prepare('SELECT w.id, c.handle FROM works w JOIN creators c ON c.id = w.creator_id WHERE w.id = ?').bind(work.remix_of).first<{ id: string; handle: string }>()
    : null;
  const code = buildCopySnippet({ ...files, meta: { ...files.meta, creator: creator.handle } }, { ...creator, name: creator.name ?? `@${creator.handle}` }, source);
  return c.json({ id, title: revision.title, visibility: visibilityOf(work.status), status: revision.status, version: revision.version, from: work.remix_of, url: workUrl(c, id), code });
});

apiV1.all('*', (c) => {
  c.set('locale', apiLocale(c.req.header('Accept-Language')));
  return fail(c, 404, 'not_found', 'unknown_path');
});
