// 動画の中のターミナルの文字を、本物の記録から作る（V006「本物で作る」）。
// 文字の出どころは promo/workspace/records/<名前>/ の transcript.md と、そのとき書かれた HTML だけ。短くするのはよいが、ない文を作らない。
// 最後に、画面に出す文字がすべて出どころの中にそのままあることを確かめ、なければ止める。
// 記録にないのは、窓の飾り（題、3つの丸、欄の頭の >、打つ位置の印、プラグインの行の印）、省略の印 ⋯、速さと経過の表示（記録の時刻から計算する）、
// 指示を1文字ずつ打つ動き（記録にあるのは指示文だけ）。どれも stage.js が描く。

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

/** 場面1：指示を打つ → HTML を書く → プラグインが置いたと返す → Claude が伝える。 */
export function buildTerminal(TL, recordsDir) {
  const T = TL.terminal;
  const dir = resolve(recordsDir, T.record);
  const transcriptText = readFileSync(resolve(dir, 'transcript.md'), 'utf8').replace(/\r\n/g, '\n');
  const facts = JSON.parse(readFileSync(resolve(dir, 'facts.json'), 'utf8'));
  const htmlName = facts.files[0];
  const html = readFileSync(resolve(dir, htmlName), 'utf8').replace(/\r\n/g, '\n');
  const { prompt, sections } = parseTranscript(transcriptText);
  if (prompt.includes('\n')) throw new Error('指示文が1行ではない');

  const write = sections.find((s) => s.head === `道具 Write ${htmlName}`);
  const hook = sections.find((s) => s.head.startsWith('フック '));
  const done = sections.find((s) => s.head === '終わり');
  if (!write || !hook || !done) throw new Error(`${T.record} の記録に、Write か、フックか、終わりがない`);
  if (!(write.rec <= hook.rec && hook.rec <= done.rec)) throw new Error(`${T.record}: 記録の時刻の順が合わない`);

  // プラグインが画面に出した行。住所の頭（手元のサーバーの名前と、言語の段）は出さず、省いた所に ⋯ を置く
  const shown = /画面に出る行（systemMessage）：\n\n```\n([\s\S]*?)\n```/.exec(hook.text)?.[1];
  if (!shown) throw new Error('フックの記録に、画面に出る行がない');
  const cut = /^(.*? → )https?:\/\/[^/\s]+(?:\/[a-z]{2})?(\/p\/[A-Za-z0-9-]+)$/.exec(shown);
  if (!cut) throw new Error(`プラグインの行の形が違う: ${shown}`);
  const hookParts = [cut[1], cut[2]];

  // Claude の最後の文から、Ludion に置いたことを伝える行。住所の前まで
  const sayLine = plain(done.text).split('\n').map((l) => l.trim()).find((l) => l.includes('Ludion'));
  if (!sayLine) throw new Error('終わりの文に、Ludion の行がない');
  const say = sayLine.split(/[：:]\s*https?:\/\//)[0].trim();

  const all = html.split('\n');
  const head = all.slice(0, T.headLines);
  const tail = all.slice(-T.tailLines - 1).filter((l, i, arr) => i < arr.length - 1 || l.trim()).slice(-T.tailLines);
  const code = [...head.map((text) => ({ kind: 'code', text: text.replace(/\t/g, '  ') })), { kind: 'gap', text: '⋯' }, ...tail.map((text) => ({ kind: 'code', text: text.replace(/\t/g, '  ') }))];

  const items = [
    { kind: 'user', text: prompt, at: T.type[0], typeTo: T.type[1], enter: T.enter },
    { kind: 'tool', text: write.head.replace('道具 ', ''), at: T.tool },
    ...code.map((c, i) => ({ ...c, at: T.flow[0] + ((T.flow[1] - T.flow[0]) * i) / (code.length - 1) })),
    { kind: 'hook', text: `${hookParts[0]}⋯${hookParts[1]}`, parts: hookParts, at: T.hook },
    { kind: 'say', text: say, at: T.say },
  ];

  // 出どころの確かめ
  const source = `${plain(transcriptText)}\n${html}`;
  const pieces = items.flatMap((i) => (i.kind === 'gap' ? [] : i.parts ?? [i.text]));
  const bad = pieces.filter((p) => !source.includes(p) && !source.includes(p.replace(/ {2}/g, '\t')));
  if (bad.length) throw new Error(`${T.record}: 記録にない文字がある:\n${bad.join('\n')}`);

  // 記録の時刻と、動画の時刻の対応（経過の表示に使う）
  const clock = [
    { at: T.enter, rec: 0 },
    { at: T.flow[1], rec: write.rec },
    { at: T.hook, rec: hook.rec },
    { at: T.say, rec: done.rec },
  ];
  const speed = done.rec / (T.say - T.enter);
  return {
    name: T.record,
    items,
    clock,
    recEnd: done.rec,
    speedAverage: Number(speed.toFixed(2)),
    speedLabel: `×${Math.round(speed)}`,
    promptChars: [...prompt].length,
    codeLinesTotal: all.length,
    codeLinesShown: head.length + tail.length,
    hookFull: shown,
    sayFull: sayLine,
    source: `promo/workspace/records/${T.record}/transcript.md, ${htmlName}`,
    facts,
  };
}
