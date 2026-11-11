// Ludion の MCP サーバー（MCP001「1」）。https://ludion.ai/mcp。AI（Claude、ChatGPT、Cursor、Claude Code など）がコネクタとして足す。
//
// - 運び方は Streamable HTTP（https://modelcontextprotocol.io/specification/2025-06-18/basic/transports）。POST に JSON-RPC を受け、
//   JSON で答える（SSE の流れは開かない。GET は 405）。セッションは持たない（どの要求も、トークンだけで本人が決まる）。
// - 認証は OAuth のアクセスのトークン（worker/oauth.ts）。AI の鍵（ld_…）も受ける。なければ 401 と、守る資源のメタデータの住所。
// - 道具の中身は、AI の口（worker/apiV1.ts、T037）をそのまま中から呼ぶ：同じ検査、同じ上限、同じクレジット行、同じ「自分だけ」。
//   新しい保存の仕組みは作らない。
// - 道具の説明に「いつ呼ぶか」を書く。AI はこれを読んで、作り終えるたびに自分から保存する。
// - cookie は読まない。応答はキャッシュしない（cachePolicy.ts の既定）。

import { ID_PATTERN } from '@ludion/rules';
import { Hono, type Context } from 'hono';
import { apiUser, apiV1 } from './apiV1';
import type { Env } from './env';
import { CORS_HEADERS, resourceMetadataUrl } from './oauth';
import { approvedSnippet } from './pages';
import { takeApiQuota } from './quota';

type McpContext = Context<{ Bindings: Env }>;

/** 受ける版。知らない版を求められたら、いちばん新しいものを返す（クライアントが合わせるか切る）。 */
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = '2025-06-18';
/** 1回の本文の上限。HTML、CSS、JS の各 256KB を JSON の文字に入れても足りる大きさ（AI の口の上限と同じ）。 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const SERVER_INFO = { name: 'ludion', title: 'Ludion', version: '1.0.0' };

const INSTRUCTIONS = `Ludion (ludion.ai) keeps the UI works a person makes with AI — like an automatic backup for what you build together.

Whenever you finish making a working HTML (a UI, an animation, a wallpaper, a game, something with sound) as one file, call save_work every time, without being asked, to save it to the person's Ludion as "Only me". After saving, tell the person the address. When you change the same work later in the conversation, call save_work again with its work_id so it becomes a new version of the same work.

Saved works are visible only to the person. They can publish a work themselves from the site (it is reviewed first); you cannot publish.`;

const FORMAT = `The html must be one self-contained HTML in Ludion's form:
- One root element with data-ld-part="<id>" (lowercase letters, digits, hyphens); everything goes inside it. A full document (<!doctype html>, <html>, <head>, <body>) is fine: the root inside <body> is used, and <title> becomes the title.
- One <style> where every selector is under [data-ld-part="<id>"].
- If it moves: one <script type="module"> that defines function mount(root) { …; return () => { /* remove listeners, cancel animation frames */ }; } and ends with mount(document.querySelector('[data-ld-part="<id>"]')); — the JS touches only root.
- Nothing from outside (only Google Fonts may be loaded): put images, sounds and fonts inside the file (inline <svg>, data: URLs, CSS drawing, Web Audio). No page navigation (location, window.open, top, parent) and no outside links (use href="#"). No inline event attributes (onclick=…).
- Each of the HTML, CSS and JS parts up to 256KB. No real company logos, trademarks or product names.
If the response lists problems, fix each one as its "fix" says and call save_work again.`;

const LANGUAGE = {
  type: 'string',
  enum: ['ja', 'en'],
  description: 'Language of the conversation. ja gives Japanese messages and a Japanese page address; en (default) gives English.',
};

const WORK_ID = { type: 'string', pattern: '^[a-z0-9-]{1,60}$', description: 'The work ID that save_work returned (or one from list_my_works).' };

export const TOOLS = [
  {
    name: 'save_work',
    title: 'Save to Ludion',
    description: `Save one HTML work to the person's Ludion as "Only me" (only they can see it), and get its address.

When to call: every time you finish making a working HTML as one file — a UI, an animation, a wallpaper, a game, something with sound — call save_work without being asked, to save it to the person's Ludion as "Only me". After saving, tell the person the address (url). When you change the same work later in this conversation (for example "change the color"), call save_work again with the work_id you got, so it becomes a new version of the same work instead of a new work.

${FORMAT}

Publishing is done by the person on the site (with review); this tool never publishes.`,
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'The whole work as one HTML (see the form above).' },
        title: { type: 'string', maxLength: 80, description: 'Short title of the work. Without it, the HTML <title> is used.' },
        work_id: { ...WORK_ID, description: 'To save a new version of a work saved earlier (in this conversation or before), pass its work_id. Leave it out for a new work.' },
        from: { ...WORK_ID, description: 'When this new work remixes a public Ludion work (see get_public_work), its work ID. Keep the credit lines at the top of that code.' },
        language: LANGUAGE,
      },
      required: ['html'],
      additionalProperties: false,
    },
    annotations: { title: 'Save to Ludion', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'list_my_works',
    title: 'List my Ludion works',
    description: 'List the person\'s own works on Ludion (newest first): work_id, title, visibility (private = Only me, public, draft), version and address. Use it to find a work to continue, or to use past works as material for a new one.',
    inputSchema: { type: 'object', properties: { language: LANGUAGE }, additionalProperties: false },
    annotations: { title: 'List my Ludion works', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_work',
    title: 'Get one of my Ludion works',
    description: 'Get the code of one of the person\'s own works (its latest version), to continue it or use it as material. Saving edited code with save_work and this work_id makes a new version. Keep the credit lines at the top.',
    inputSchema: { type: 'object', properties: { work_id: WORK_ID, language: LANGUAGE }, required: ['work_id'], additionalProperties: false },
    annotations: { title: 'Get one of my Ludion works', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_public_work',
    title: 'Get a public Ludion work',
    description: 'Get the code of a public work on Ludion (anyone\'s), as material for a remix. Keep its credit lines (<!-- UI by @… -->) at the top, and pass its work_id as "from" when you save the remix with save_work.',
    inputSchema: { type: 'object', properties: { work_id: WORK_ID, language: LANGUAGE }, required: ['work_id'], additionalProperties: false },
    annotations: { title: 'Get a public Ludion work', readOnlyHint: true, openWorldHint: true },
  },
];

// ---------- JSON-RPC ----------

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });

type ToolResult = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const text = (value: string, structured?: Record<string, unknown>, isError = false): ToolResult => ({
  content: [{ type: 'text', text: value }],
  ...(structured ? { structuredContent: structured } : {}),
  ...(isError ? { isError: true } : {}),
});

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------- 道具 ----------

interface Call {
  c: McpContext;
  authorization: string;
  viaKey: boolean;
  args: Record<string, unknown>;
}

const languageOf = (args: Record<string, unknown>) => (args.language === 'ja' ? 'ja' : 'en');

/** AI の口を中から呼ぶ。答えの状態と JSON。 */
async function callApi(call: Call, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const origin = new URL(call.c.req.url).origin;
  const response = await apiV1.request(
    `${origin}${path}`,
    {
      method,
      headers: {
        Authorization: call.authorization,
        'Accept-Language': languageOf(call.args),
        // AI の鍵でつないだときは、置き場の印を「MCP」にする（トークンでつないだときは、その AI の名前）
        ...(call.viaKey ? { 'X-Ludion-Client': 'MCP' } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    call.c.env,
  );
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}

/** AI の口のエラーを、AI が次にすることの分かる文にする。 */
function apiFailure(status: number, data: Record<string, unknown>, extra = ''): ToolResult {
  const lines = [`Ludion answered ${status} ${String(data.error ?? 'error')}: ${String(data.message ?? '')}`.trim()];
  const problems = Array.isArray(data.problems) ? (data.problems as { message?: string; fix?: string }[]) : [];
  for (const problem of problems) lines.push(`- ${problem.message ?? ''}${problem.fix ? ` → fix: ${problem.fix}` : ''}`);
  if (problems.length > 0) lines.push('Fix each problem and call save_work again with the fixed html.');
  if (status === 429 && data.retry_at) lines.push(`Try again after ${String(data.retry_at)}.`);
  if (extra) lines.push(extra);
  return text(lines.join('\n'), { error: data.error ?? 'error', status, ...(problems.length ? { problems } : {}), ...(data.retry_at ? { retry_at: data.retry_at } : {}) }, true);
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined | null {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' ? value : null;
}

async function saveWork(call: Call): Promise<ToolResult> {
  const { args } = call;
  if (typeof args.html !== 'string' || args.html.trim() === '') return text('html is required: the whole work as one HTML string.', { error: 'bad_html' }, true);
  const title = optionalString(args, 'title');
  const workId = optionalString(args, 'work_id');
  const from = optionalString(args, 'from');
  if (title === null || workId === null || from === null) return text('title, work_id and from must be strings when given.', { error: 'bad_request' }, true);
  if (workId !== undefined && !ID_PATTERN.test(workId)) return text(`work_id "${workId}" is not a Ludion work ID. Leave it out to save a new work.`, { error: 'not_found' }, true);

  const body = { html: args.html, ...(title ? { title } : {}) };
  const { status, data } = workId
    ? await callApi(call, 'POST', `/works/${encodeURIComponent(workId)}/versions`, body)
    : await callApi(call, 'POST', '/works', { ...body, ...(from ? { from } : {}) });
  if (status !== 201) {
    const hint = status === 404 && workId ? `Work "${workId}" is not one of the person's works. Call save_work without work_id to save it as a new work.` : '';
    return apiFailure(status, data, hint);
  }
  const isPublic = data.visibility === 'public';
  const lines = [
    isPublic
      ? `Saved as a new draft version (version ${data.version}) of the person's public work. The public version stays as it is until the person sends this version for review on the site.`
      : `Saved to the person's Ludion as "Only me" (only they can see it)${workId ? `, as version ${data.version} of the same work` : ''}.`,
    `Address: ${data.url}`,
    `work_id: ${data.id} · version ${data.version}`,
    'Tell the person this address. To publish it, they open it on the site and press Publish (it is reviewed first).',
    `When you change this work later in this conversation, call save_work again with work_id "${data.id}" so it becomes a new version.`,
  ];
  if (workId && from) lines.push('from was ignored: it only applies to a new work.');
  return text(lines.join('\n'), { work_id: data.id, version: data.version, url: data.url, visibility: data.visibility });
}

async function listMyWorks(call: Call): Promise<ToolResult> {
  const { status, data } = await callApi(call, 'GET', '/works');
  if (status !== 200) return apiFailure(status, data);
  const works = (data.works as { id: string; title: string; visibility: string; status: string; version: string; updated_at: string; url: string }[]) ?? [];
  if (works.length === 0) return text('The person has no works on Ludion yet.', { works: [] });
  const lines = works.map((work) => `- ${work.title} — work_id: ${work.id}, ${work.visibility === 'private' ? 'Only me' : work.visibility}, version ${work.version}, updated ${work.updated_at.slice(0, 10)}, ${work.url}`);
  return text(`${works.length} work(s), newest first:\n${lines.join('\n')}`, { works });
}

async function getWork(call: Call): Promise<ToolResult> {
  const workId = call.args.work_id;
  if (typeof workId !== 'string' || !ID_PATTERN.test(workId)) return text('work_id is required (see list_my_works).', { error: 'bad_request' }, true);
  const { status, data } = await callApi(call, 'GET', `/works/${encodeURIComponent(workId)}`);
  if (status !== 200) return apiFailure(status, data, status === 404 ? 'Use list_my_works to see the person\'s work IDs, or get_public_work for a public work.' : '');
  const { code, ...rest } = data;
  return {
    content: [
      { type: 'text', text: `${String(rest.title)} — work_id: ${String(rest.id)}, version ${String(rest.version)}, ${rest.visibility === 'private' ? 'Only me' : String(rest.visibility)}, ${String(rest.url)}\nTo save changes as a new version, call save_work with work_id "${String(rest.id)}". Keep the credit lines at the top.` },
      { type: 'text', text: String(code ?? '') },
    ],
    structuredContent: { ...rest, code },
  };
}

async function getPublicWork(call: Call, userId: string): Promise<ToolResult> {
  const workId = call.args.work_id;
  if (typeof workId !== 'string' || !ID_PATTERN.test(workId)) return text('work_id is required: the ID in a ludion.ai/p/<work_id> address.', { error: 'bad_request' }, true);
  if (!(await takeApiQuota(call.c.env.DB, userId, 'read'))) return text('Too many reads this hour. Try again later.', { error: 'rate_limited' }, true);
  const found = await approvedSnippet(call.c.env, workId);
  if (!found) return text(`No public work "${workId}" on Ludion. Only public works can be read with this tool (for the person's own works, use get_work).`, { error: 'not_found' }, true);
  const origin = new URL(call.c.req.url).origin;
  const url = `${origin}${languageOf(call.args) === 'ja' ? '' : '/en'}/p/${encodeURIComponent(found.work.id)}`;
  return {
    content: [
      { type: 'text', text: `${found.work.title} by @${found.creator.handle} — work_id: ${found.work.id}, ${url} (MIT)\nTo remix: change only what needs to change, keep the credit lines at the top, and call save_work with from "${found.work.id}".` },
      { type: 'text', text: found.snippet },
    ],
    structuredContent: { work_id: found.work.id, title: found.work.title, creator: found.creator.handle, url, code: found.snippet },
  };
}

// ---------- 道 ----------

export const mcp = new Hono<{ Bindings: Env }>();

/** 401：トークンがない、違う、切れた、切られた。AI はこの見出しから、つなぎ方（OAuth）を見つける。 */
function unauthorized(c: McpContext, presented: boolean) {
  const challenge = `Bearer resource_metadata="${resourceMetadataUrl(c)}"${presented ? ', error="invalid_token", error_description="The token is missing, expired, or revoked"' : ''}`;
  return c.json({ error: 'unauthorized', message: 'Connect to Ludion first (OAuth).' }, 401, { ...CORS_HEADERS, 'WWW-Authenticate': challenge });
}

mcp.options('/', () => new Response(null, { status: 204, headers: CORS_HEADERS }));

mcp.all('/', async (c) => {
  const authorization = c.req.header('Authorization') ?? '';
  const user = await apiUser(c.env.DB, authorization, undefined);
  if (!user) return unauthorized(c, authorization !== '');
  if (c.req.method !== 'POST') return c.json({ error: 'method_not_allowed', message: 'Send JSON-RPC with POST.' }, 405, { ...CORS_HEADERS, Allow: 'POST, OPTIONS' });

  if (Number(c.req.header('Content-Length') ?? '0') > MAX_BODY_BYTES) return c.json(rpcError(null, INVALID_REQUEST, 'The request is too large.'), 413, CORS_HEADERS);
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return c.json(rpcError(null, INVALID_REQUEST, 'The request is too large.'), 413, CORS_HEADERS);
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return c.json(rpcError(null, PARSE_ERROR, 'Parse error'), 400, CORS_HEADERS);
  }

  const viaKey = !authorization.replace(/^Bearer\s+/i, '').startsWith('ldo_');
  const batch = Array.isArray(message);
  const messages = batch ? (message as unknown[]) : [message];
  if (messages.length === 0) return c.json(rpcError(null, INVALID_REQUEST, 'Empty batch'), 400, CORS_HEADERS);
  const answers = [];
  for (const one of messages) {
    const answer = await handle(c, one, { authorization, viaKey, userId: user.id });
    if (answer) answers.push(answer);
  }
  // 知らせと答えだけなら、本文なしの 202
  if (answers.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
  return c.json(batch ? answers : answers[0], 200, CORS_HEADERS);
});

async function handle(c: McpContext, message: unknown, who: { authorization: string; viaKey: boolean; userId: string }) {
  if (!isObject(message) || message.jsonrpc !== '2.0') return rpcError(null, INVALID_REQUEST, 'Invalid Request');
  // 答え（クライアントからの result、error）は受け取るだけ
  if (!('method' in message)) return null;
  const request = message as unknown as JsonRpcRequest;
  const isNotification = !('id' in message) || request.id === undefined;
  const id = (request.id ?? null) as JsonRpcId;
  if (typeof request.method !== 'string') return isNotification ? null : rpcError(id, INVALID_REQUEST, 'Invalid Request');
  if (isNotification) return null;
  const params = isObject(request.params) ? request.params : {};

  switch (request.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : LATEST;
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'resources/templates/list':
      return rpcResult(id, { resourceTemplates: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    case 'tools/call': {
      const name = params.name;
      const args = isObject(params.arguments) ? params.arguments : {};
      const call: Call = { c, authorization: who.authorization, viaKey: who.viaKey, args };
      if (name === 'save_work') return rpcResult(id, await saveWork(call));
      if (name === 'list_my_works') return rpcResult(id, await listMyWorks(call));
      if (name === 'get_work') return rpcResult(id, await getWork(call));
      if (name === 'get_public_work') return rpcResult(id, await getPublicWork(call, who.userId));
      return rpcError(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    }
    default:
      return rpcError(id, METHOD_NOT_FOUND, `Method not found: ${request.method}`);
  }
}
