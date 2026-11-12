// 動画の中のターミナルの文字を、本物の記録から作る（V006「本物で作る」）。
// 文字の出どころは3つだけ：
//   - promo/workspace/records/<名前>/ の transcript.md（Claude Code を実際に流した記録）と、そのとき書かれた HTML
//   - サイトの「AI につなぐ」が案内している、打つ行（apps/web/src/components/AccountAiConnect.tsx）
// 短くするのはよいが、ない文を作らない。最後に、画面に出す文字がすべて出どころの中にそのままあることを確かめ、なければ止める。
// 記録にないのは、窓の飾り（題、3つの丸、欄の頭の >、打つ位置の印、プラグインの行の印）、省略の印 ⋯、速さと経過の表示（記録の時刻から計算する）、
// 打つ行を1文字ずつ打つ動き（記録にあるのは打った文だけ）。どれも stage.js が描く。
// ターミナルは2枚の「面」に分ける（つなぐ、作る）。別々に流した2つの記録なので、続きの1回のやりとりには見せず、面を切り替える。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\r/g, '');

export function parseTranscript(text) {
  const clean = text.replace(/\r\n/g, '\n');
  const promptStart = clean.indexOf('## 指示文');
  const answerStart = clean.indexOf('\n## 答え');
  const fenceOpen = clean.indexOf('```text\n', promptStart);
  const fenceClose = clean.lastIndexOf('\n```', answerStart);
  const prompt = clean.slice(fenceOpen + '```text\n'.length, fenceClose);
  const body = clean.slice(answerStart);
  const heads = [...body.matchAll(/^### \+(\d\d):(\d\d)\.(\d) (.+)$/gm)];
  const sections = heads.map((m, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : body.length;
    return { rec: Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10, head: m[4], text: body.slice(m.index + m[0].length, end).trim() };
  });
  return { prompt, sections };
}
const firstLine = (text) => plain(text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('```'))[0] ?? '';
const fenced = (text) => /```[a-z]*\n([\s\S]*?)\n```/.exec(text)?.[1] ?? '';
function readRecord(recordsDir, name) {
  const dir = resolve(recordsDir, name);
  const transcriptText = readFileSync(resolve(dir, 'transcript.md'), 'utf8').replace(/\r\n/g, '\n');
  const facts = JSON.parse(readFileSync(resolve(dir, 'facts.json'), 'utf8'));
  return { dir, transcriptText, facts, ...parseTranscript(transcriptText) };
}
/** 画面に出す文字が、すべて出どころにそのままあること。 */
function assertFromSource(name, items, source) {
  const pieces = items.flatMap((i) => (i.kind === 'gap' ? [] : i.parts ?? [i.text]));
  const bad = pieces.filter((p) => !source.includes(p) && !source.includes(p.replace(/ {2}/g, '\t')));
  if (bad.length) throw new Error(`${name}: 記録にない文字がある:\n${bad.join('\n')}`);
}

/** 面1「つなぐ」：プラグインを入れる2行 → /ludion:connect → ブラウザで「許可する」→ つながる。 */
function buildConnect(TL, recordsDir, root) {
  const C = TL.terminal.connect;
  const B = TL.browser;
  const r = readRecord(recordsDir, C.record);
  const site = readFileSync(resolve(root, C.installSource), 'utf8');
  const say0 = r.sections.find((s) => s.head === '文');
  const tool = r.sections.find((s) => s.head.startsWith('道具 '));
  const allowed = r.sections.find((s) => s.head === 'ブラウザ');
  const done = r.sections.find((s) => s.head === '終わり');
  if (!say0 || !tool || !allowed || !done) throw new Error(`${C.record} の記録に、文か、道具か、ブラウザか、終わりがない`);
  if (!(say0.rec <= tool.rec && tool.rec <= allowed.rec && allowed.rec <= done.rec)) throw new Error(`${C.record}: 記録の時刻の順が合わない`);
  // 道具の命令は、手元のパスの所を ⋯ にする（記録では <プラグイン> に置き換えてある）
  const command = fenced(tool.text);
  const cut = /^(node ")<[^>]+>(\/[^\n]+)$/.exec(command);
  if (!cut) throw new Error(`道具の命令の形が違う: ${command}`);
  // 終わりの文から2つ：つながったことを言う行（「—」の前まで）と、これから何が起きるかの行（最初の文まで）
  const finalLines = plain(done.text).split('\n').map((l) => l.trim().replace(/^[-・]\s*/, '')).filter(Boolean);
  const connected = finalLines[0].split(' — ')[0].trim();
  const next = finalLines.find((l) => l.includes('Only me'));
  if (!connected || !next) throw new Error('終わりの文に、つながった行か、Only me の行がない');
  const nextShort = next.slice(0, next.indexOf('"Only me".') + '"Only me".'.length);

  const items = [
    ...C.install.map((line, i) => ({ id: `c${i + 1}`, kind: 'cmd', text: line.text, at: line.type[0], typeTo: line.type[1], enter: line.enter })),
    { id: `c${C.install.length + 1}`, kind: 'cmd', text: r.prompt, at: C.type[0], typeTo: C.type[1], enter: C.enter },
    { id: 'say0', kind: 'say', text: firstLine(say0.text), at: C.say },
    { id: 'tool0', kind: 'tool', text: tool.head.replace('道具 ', ''), at: C.tool },
    { id: 'code0', kind: 'code', text: `${cut[1]}⋯${cut[2]}`, parts: [cut[1], cut[2]], at: C.tool + 0.05 },
    { id: 'say1', kind: 'say', text: connected, at: C.done },
    { id: 'say2', kind: 'say', text: nextShort, at: C.next },
  ];
  assertFromSource(C.record, items.slice(0, C.install.length + 1), `${site}\n${r.prompt}`);
  assertFromSource(C.record, items.slice(C.install.length + 1), plain(r.transcriptText));
  if (!site.includes(r.prompt)) throw new Error(`サイトの「AI につなぐ」に ${r.prompt} がない`);
  const speed = done.rec / (C.done - C.enter);
  return {
    id: 'connect',
    record: C.record,
    in: null,
    out: C.out,
    items,
    clock: [
      { at: C.enter, rec: 0 },
      { at: C.say, rec: say0.rec },
      { at: C.tool, rec: tool.rec },
      { at: B.press, rec: allowed.rec },
      { at: C.done, rec: done.rec },
    ],
    badge: [C.enter, ...C.badgeOut],
    recEnd: done.rec,
    speedAverage: Number(speed.toFixed(2)),
    speedLabel: `×${Math.round(speed)}`,
    cut: { connectedFull: finalLines[0], nextFull: next },
    source: `promo/workspace/records/${C.record}/transcript.md, ${C.installSource}`,
    facts: r.facts,
  };
}

/** 面2「作る」：指示を打つ → HTML を書く → プラグインが置いたと返す → Claude が伝える。 */
function buildMake(TL, recordsDir) {
  const M = TL.terminal.make;
  const r = readRecord(recordsDir, M.record);
  const htmlName = r.facts.files[0];
  const html = readFileSync(resolve(r.dir, htmlName), 'utf8').replace(/\r\n/g, '\n');
  if (r.prompt.includes('\n')) throw new Error('指示文が1行ではない');
  const write = r.sections.find((s) => s.head === `道具 Write ${htmlName}`);
  const hook = r.sections.find((s) => s.head.startsWith('フック '));
  const done = r.sections.find((s) => s.head === '終わり');
  if (!write || !hook || !done) throw new Error(`${M.record} の記録に、Write か、フックか、終わりがない`);
  if (!(write.rec <= hook.rec && hook.rec <= done.rec)) throw new Error(`${M.record}: 記録の時刻の順が合わない`);
  // プラグインが画面に出した行。住所の頭（手元のサーバーの名前と、言語の段）は出さず、省いた所に ⋯ を置く
  const shown = /画面に出る行（systemMessage）：\n\n```\n([\s\S]*?)\n```/.exec(hook.text)?.[1];
  if (!shown) throw new Error('フックの記録に、画面に出る行がない');
  const cut = /^(.*? → )https?:\/\/[^/\s]+(?:\/[a-z]{2})?(\/p\/[A-Za-z0-9-]+)$/.exec(shown);
  if (!cut) throw new Error(`プラグインの行の形が違う: ${shown}`);
  // Claude の最後の文から、Ludion に置いたことを伝える行。住所の前まで
  const sayLine = plain(done.text).split('\n').map((l) => l.trim()).find((l) => l.includes('Ludion'));
  if (!sayLine) throw new Error('終わりの文に、Ludion の行がない');
  const say = sayLine.split(/[：:]\s*https?:\/\//)[0].trim();

  const all = html.split('\n');
  const head = all.slice(0, M.headLines);
  const tail = all.slice(-M.tailLines - 1).filter((l, i, arr) => i < arr.length - 1 || l.trim()).slice(-M.tailLines);
  const code = [...head.map((text) => ({ kind: 'code', text: text.replace(/\t/g, '  ') })), { kind: 'gap', text: '⋯' }, ...tail.map((text) => ({ kind: 'code', text: text.replace(/\t/g, '  ') }))];
  const items = [
    { id: 'user', kind: 'user', text: r.prompt, at: M.type[0], typeTo: M.type[1], enter: M.enter },
    { id: 'tool', kind: 'tool', text: write.head.replace('道具 ', ''), at: M.tool },
    ...code.map((c, i) => ({ id: null, ...c, at: M.flow[0] + ((M.flow[1] - M.flow[0]) * i) / (code.length - 1) })),
    { id: 'hook', kind: 'hook', text: `${cut[1]}⋯${cut[2]}`, parts: [cut[1], cut[2]], at: M.hook },
    { id: 'say', kind: 'say', text: say, at: M.say },
  ];
  assertFromSource(M.record, items, `${plain(r.transcriptText)}\n${html}`);
  const speed = done.rec / (M.say - M.enter);
  return {
    id: 'make',
    record: M.record,
    in: M.in,
    out: null,
    items,
    flow: M.flow,
    clock: [
      { at: M.enter, rec: 0 },
      { at: M.flow[1], rec: write.rec },
      { at: M.hook, rec: hook.rec },
      { at: M.say, rec: done.rec },
    ],
    badge: [M.enter, ...M.badgeOut],
    recEnd: done.rec,
    speedAverage: Number(speed.toFixed(2)),
    speedLabel: `×${Math.round(speed)}`,
    codeLinesTotal: all.length,
    codeLinesShown: head.length + tail.length,
    cut: { hookFull: shown, sayFull: sayLine },
    source: `promo/workspace/records/${M.record}/transcript.md, ${htmlName}`,
    facts: r.facts,
  };
}

/**
 * 面3「読む」（2つ目のターミナルの板）：指示を打つ → 手元の MCP の読む道具を順に呼ぶ → 返ったコード（行の番号つき）→ Claude が伝える。
 * 返ったコードは、道具の答え（JSON）の code から、頭の数行と、指定した行の番号から始まる数行と、最後の行だけを出す。間は ⋯。
 */
function buildRead(TL, recordsDir) {
  const R = TL.terminal.read;
  const r = readRecord(recordsDir, R.record);
  if (r.prompt.includes('\n')) throw new Error('指示文が1行ではない');
  const tools = r.sections.filter((s) => s.head.startsWith('道具 mcp__'));
  const answers = r.sections.filter((s) => s.head === '道具の答え');
  const done = r.sections.find((s) => s.head === '終わり');
  if (tools.length === 0 || !done) throw new Error(`${R.record} の記録に、道具か、終わりがない`);
  // コードを返した道具（read_work_code）と、その答え
  const readTool = tools.find((s) => s.head.endsWith('read_work_code'));
  if (!readTool) throw new Error(`${R.record} の記録に、read_work_code がない`);
  const readAnswer = answers.find((s) => s.rec >= readTool.rec);
  const answer = JSON.parse(fenced(readAnswer.text));
  const codeLines = String(answer.code).split('\n');
  const pick = [];
  const credit = codeLines.findIndex((l) => l.startsWith('/* UI by'));
  if (credit >= 0) pick.push(codeLines[credit]);
  const numbered = codeLines.filter((l) => /^\d+\t/.test(l));
  const head = numbered.slice(0, R.headLines);
  pick.push(...head);
  for (const from of R.jumpTo ?? []) {
    const at = numbered.findIndex((l) => l.startsWith(`${from}\t`));
    if (at < 0) throw new Error(`返ったコードに ${from} 行がない`);
    pick.push(null, ...numbered.slice(at, at + R.jumpLines));
  }
  const last = numbered.at(-1);
  if (!pick.includes(last)) pick.push(null, last);
  // 行の番号と本文の間のタブは、空白2つにして出す（出どころの確かめは、元の行で）
  const code = pick.map((line) => (line === null ? { kind: 'gap', text: '⋯' } : { kind: 'code', text: line.replace('\t', '  ').replace(/\t/g, '  '), parts: [line] }));
  // Claude の最後の文の、最初の段落の頭から、文を R.say の数だけ（何を読んで、何を開かなかったか）
  const finalLines = plain(done.text).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('|'));
  const sentences = finalLines[0].split(/(?<=。)/).map((x) => x.trim()).filter(Boolean);
  const sayLines = sentences.slice(0, R.say.length);
  if (sayLines.length < R.say.length) throw new Error('終わりの文の頭に、文が足りない');
  const toolAt = (i) => R.tools[0] + ((R.tools[1] - R.tools[0]) * i) / Math.max(1, tools.length - 1);
  const items = [
    { id: 'ruser', kind: 'user', text: r.prompt, at: R.type[0], typeTo: R.type[1], enter: R.enter },
    ...tools.flatMap((s, i) => {
      const line = { id: `rtool${i + 1}`, kind: 'tool', text: s.head.replace('道具 ', ''), at: toolAt(i) };
      // コードを返した道具には、渡した値（section）の行を添える
      return s === readTool ? [line, { id: null, kind: 'code', text: fenced(s.text), at: toolAt(i) + 0.05 }] : [line];
    }),
    ...code.map((c, i) => ({ id: i === 0 ? 'rcode' : null, ...c, at: R.flow[0] + ((R.flow[1] - R.flow[0]) * i) / Math.max(1, code.length - 1) })),
    ...sayLines.map((text, i) => ({ id: `rsay${i + 1}`, kind: 'say', text, at: R.say[i] })),
  ];
  const source = `${plain(r.transcriptText)}\n${answer.code}`;
  assertFromSource(R.record, items, source);
  const speed = done.rec / (R.say[0] - R.enter);
  return {
    id: 'read',
    board: 'term2',
    record: R.record,
    in: null,
    out: null,
    items,
    flow: R.flow,
    clock: [{ at: R.enter, rec: 0 }, ...tools.map((s, i) => ({ at: toolAt(i), rec: s.rec })), { at: R.say[0], rec: done.rec }],
    badge: [R.enter, ...R.badgeOut],
    recEnd: done.rec,
    speedAverage: Number(speed.toFixed(2)),
    speedLabel: `×${Math.round(speed)}`,
    codeLinesTotal: answer.total_lines,
    codeRange: [answer.start, answer.end],
    section: answer.section,
    cut: { sayFull: finalLines[0] },
    source: `promo/workspace/records/${R.record}/transcript.md`,
    facts: r.facts,
  };
}

export function buildTerminal(TL, recordsDir, root) {
  const pages = [buildConnect(TL, recordsDir, root), buildMake(TL, recordsDir), ...(TL.terminal.read ? [buildRead(TL, recordsDir)] : [])];
  for (const page of pages) page.board ??= 'term1';
  // 出来事の時刻は、コマの頭にそろえる（絵と音を同じコマに置く。表の数字は、いちばん近いコマに丸める）
  const snap = (t) => Math.round(t * TL.fps) / TL.fps;
  for (const page of pages) {
    for (const item of page.items) {
      item.at = snap(item.at);
      if (item.typeTo != null) item.typeTo = snap(item.typeTo);
      if (item.enter != null) item.enter = snap(item.enter);
    }
    for (const key of page.clock) key.at = snap(key.at);
    page.badge = page.badge.map(snap);
    if (page.flow) page.flow = page.flow.map(snap);
    if (page.in) page.in = page.in.map(snap);
    if (page.out) page.out = page.out.map(snap);
  }
  return { pages };
}
