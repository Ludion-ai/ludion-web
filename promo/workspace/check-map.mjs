// 場面3と4の下調べ（V006）：手元のサーバーに置いた作品の「中身の地図」と、要る部分だけを読む口が、どう答えるかを見る。お金はかからない（AI を使わない）。
//   node promo/workspace/check-map.mjs --persist <置き場> wallpaper-rain-window [shader:WINDOW_FRAG]
// 見るもの：サイトの側の地図（/p/<id>.json）、AI の口（/api/v1 の outline と code?section=）、MCP（tools/list と、get_public_work、read_work_code）。
// 手元の開発のサーバーにだけ聞く。鍵は、動画に出す人の名前で作り、終わったら消す。

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDev } from './dev-server.mjs';
import { PERSON, ensurePerson } from './person.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
};
const BASE = (process.env.LD_DEV_URL || 'http://localhost:5473').replace(/\/+$/, '');
const persist = valueOf('--persist');
const [id, section = 'shader:WINDOW_FRAG'] = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--persist');
if (!persist || !id) throw new Error('使い方: node promo/workspace/check-map.mjs --persist <置き場> <作品の id> [<種類>:<名前>]');
{
  const host = new URL(BASE).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') throw new Error(`手元のサーバーではない: ${BASE}`);
}
void dirname(fileURLToPath(import.meta.url));
const cookie = { Cookie: `ld_session=${PERSON.session}`, Origin: BASE };
const say = (step, value) => console.log(JSON.stringify({ step, ...value }));
/** 本文は必ず読み切る（読み残すと、Node の fetch が落ちることがある）。 */
async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Accept-Language': 'ja', ...headers }, redirect: 'manual' });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // JSON でない答えは、頭だけ見せる
  }
  return { status: response.status, body, text: body ? null : text.slice(0, 200) };
}
const count = (list, key) => Object.entries(list.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`);

ensurePerson(resolve(persist));
const dev = await startDev({ persist, base: BASE });
let keyId = null;
try {
  // 1. サイトの側の地図（鍵なし）
  const site = await getJson(`${BASE}/p/${encodeURIComponent(id)}.json`);
  const outline = site.body?.outline ?? site.body;
  say('site-map', {
    status: site.status,
    files: outline?.files?.map((f) => `${f.name} ${f.lines}行`),
    tech: outline?.tech?.map((t) => t.id ?? t.name),
    sections: outline?.sections ? count(outline.sections, 'kind') : null,
    shaders: outline?.sections?.filter((s) => s.kind === 'shader').map((s) => s.name),
    text: site.text,
  });

  // 2. AI の口（鍵あり）
  const made = await fetch(`${BASE}/api/account/ai-keys`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...cookie }, body: JSON.stringify({ name: 'Claude Code', own: true, mit: true, terms: true }) });
  const key = await made.json();
  if (made.status !== 201) throw new Error(`鍵を作れなかった: ${made.status}`);
  keyId = key.key.id;
  const auth = { Authorization: `Bearer ${key.secret}` };
  const map = await getJson(`${BASE}/api/v1/works/${encodeURIComponent(id)}/outline`, auth);
  say('api-outline', { status: map.status, title: map.body?.title, creator: map.body?.creator, own: map.body?.own, version: map.body?.version, bytes: map.body?.bytes, sections: map.body?.outline?.sections?.length, text: map.text });
  const part = await getJson(`${BASE}/api/v1/works/${encodeURIComponent(id)}/code?section=${encodeURIComponent(section)}`, auth);
  say('api-part', { status: part.status, file: part.body?.file, section: part.body?.section, start: part.body?.start, end: part.body?.end, totalLines: part.body?.total_lines, bytes: part.body?.bytes, credit: part.body?.credit, firstLines: part.body?.code?.split('\n').slice(0, 3), error: part.body?.error });

  // 3. MCP（同じ鍵で）
  const rpc = async (method, params, n) => {
    const response = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...auth }, body: JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) });
    const text = await response.text();
    const data = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data:')) ?? '').slice(5);
    try {
      return { status: response.status, ...JSON.parse(data) };
    } catch {
      return { status: response.status, raw: text.slice(0, 200) };
    }
  };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'promo-check', version: '0' } }, 1);
  const tools = await rpc('tools/list', {}, 2);
  say('mcp-tools', { status: tools.status, server: init.result?.serverInfo, tools: tools.result?.tools?.map((t) => ({ name: t.name, args: Object.keys(t.inputSchema?.properties ?? {}) })), raw: tools.raw });
  const textOf = (answer) => (answer.result?.content ?? []).map((c) => c.text ?? '').join('\n');
  const pub = await rpc('tools/call', { name: 'get_public_work', arguments: { work_id: id } }, 3);
  say('mcp-get_public_work', { status: pub.status, isError: pub.result?.isError ?? null, chars: textOf(pub).length, head: textOf(pub).split('\n').slice(0, 24).map((l) => l.slice(0, 160)), error: pub.error });
  const [kind, name] = section.split(':');
  const read = await rpc('tools/call', { name: 'read_work_code', arguments: { work_id: id, section } }, 4);
  say('mcp-read_work_code', { status: read.status, isError: read.result?.isError ?? null, chars: textOf(read).length, lines: textOf(read).split('\n').length, head: textOf(read).split('\n').slice(0, 8), asked: { kind, name }, error: read.error });
} finally {
  if (keyId) await fetch(`${BASE}/api/account/ai-keys/${encodeURIComponent(keyId)}/delete`, { method: 'POST', headers: cookie });
  await dev.stop();
}
