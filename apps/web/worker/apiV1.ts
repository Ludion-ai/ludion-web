// AI の口（docs/tasks/T037.md「2」）。AI（Claude Code など）が、本人の AI の鍵で作品を置く、一覧を見る、コードを取る。
//
// - 認証は Authorization: Bearer ld_… だけ。cookie は読まない。ブラウザから呼ぶものではないので、CORS の頭は付けない。
// - 置いたものは本人にしか見えない（下書き）。公開（審査に出す）は、サイトの画面から本人がする。ここからは公開できない。
// - html は /new の1つの箱と同じ受け方：同じ分け方（splitSnippet、fixParts）、同じ検査（checkSubmission）、同じ大きさの上限、
//   同じ保存（post.ts の writeDraft）。投稿の1日の上限（POST_LIMITS）もそのまま効く。
// - 回数の上限：置くのは1人1時間30回、ほかの読み取りは1時間300回（quotas）。超えたら 429 と、次に使える時刻。
// - エラーはどれも { error: <決まった語>, message }。文は Accept-Language で日本語か英語。
// - 鍵の生の値は、ログに出さない（log.ts は道の種類と決まった語だけ）。

import { buildCopySnippet } from '@ludion/render';
import { fixParts, ID_PATTERN, MAX_PART_BYTES, MAX_TITLE_CHARS, partIdOf, splitSnippet, SUBTYPES, type Category, type ProblemText, type SplitError } from '@ludion/rules';
import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { localizedPath, type Locale } from '../src/i18n';
import { keyUser, type KeyUser } from './aiKeys';
import { apiDocs } from './apiDocs';
import type { Env } from './env';
import { checkWorkId, readBody, writeDraft, type PostMeta } from './post';
import { nextDay, nextHour, takeApiQuota } from './quota';
import { canPost, loadRevisionFiles, ownedWork, type RevisionRow } from './revisions';

type ApiEnv = { Bindings: Env; Variables: { user: KeyUser; locale: Locale } };
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
  invalid_work: { ja: 'このままでは置けません。problems の fix のとおりに直して、もう一度送ってください', en: 'The work can’t be put as it is. Fix each item in problems (see fix) and send it again.' },
  not_found: { ja: '作品が見つかりません。自分の作品の ID を入れてください', en: 'Work not found. Use the ID of one of your own works.' },
  in_review: { ja: 'この作品は審査中です。審査が終わるまで、新しい版は置けません', en: 'This work is in review. You can’t put a new version until the review is done.' },
  posting_closed: { ja: 'いまは作品を置けません', en: 'Posting is closed right now.' },
  conflict: { ja: 'ほかの操作とぶつかりました。もう一度送ってください', en: 'Another change got there first. Send it again.' },
  no_id: { ja: '作品の ID を決められませんでした。もう一度送ってください', en: 'Could not pick an ID for the work. Send it again.' },
  unknown_path: { ja: 'この道はありません。GET /api/v1 に使い方があります', en: 'No such endpoint. GET /api/v1 explains the API.' },
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
/** 今の見え方。T036（自分だけ）が入るまでは、公開か下書き（本人だけが見られる）。 */
const visibilityOf = (workStatus: string) => (workStatus === 'approved' ? 'public' : 'draft');

// 説明（docs/tasks/T037.md「4」）。鍵は要らない。AI が読んで使えるように Markdown で返す
apiV1.get('/', (c) => {
  const locale = apiLocale(c.req.header('Accept-Language'));
  return c.body(apiDocs(locale, origin(c as unknown as ApiContext)), 200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Language': locale });
});

apiV1.use('/works', authenticate);
apiV1.use('/works/*', authenticate);

/** 鍵を確かめ、回数を数える。cookie は見ない。 */
async function authenticate(c: ApiContext, next: () => Promise<void>) {
  c.set('locale', apiLocale(c.req.header('Accept-Language')));
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(c.req.header('Authorization') ?? '');
  const user = match ? await keyUser(c.env.DB, match[1]) : null;
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

/** writeDraft の答えを、この口の形にする。 */
async function answer(c: ApiContext, result: Awaited<ReturnType<typeof writeDraft>>) {
  if (result.ok) {
    const work = await ownedWork(c.env.DB, result.body.work_id);
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
  return answer(c, await writeDraft(c.env, user, null, { ...fixed, thumb: null }, meta));
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
  return answer(c, await writeDraft(c.env, user, id, { ...fixed, thumb: null }, meta));
});

// 自分の作品の一覧。状態と版は、いちばん新しい版のもの
apiV1.get('/works', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.status AS work_status, r.title, r.status, r.version, r.updated_at
     FROM works w
     JOIN creators c ON c.id = w.creator_id
     JOIN revisions r ON r.id = (SELECT id FROM revisions WHERE work_id = w.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     WHERE c.user_id = ?
     ORDER BY r.updated_at DESC, w.id`,
  )
    .bind(c.get('user').id)
    .all<{ id: string; work_status: string; title: string; status: string; version: string; updated_at: number }>();
  return c.json({
    works: results.map((row) => ({
      id: row.id,
      title: row.title,
      visibility: visibilityOf(row.work_status),
      status: row.status,
      version: row.version,
      updated_at: new Date(row.updated_at).toISOString(),
      url: workUrl(c, row.id),
    })),
  });
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
