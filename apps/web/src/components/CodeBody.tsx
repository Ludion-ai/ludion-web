import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import type { LineRange } from '../lib/codeAddress';
import { firstTokenAt, TOKEN_COMMENT, TOKEN_KEYWORD, TOKEN_NAME, TOKEN_NUMBER, TOKEN_STRING, type Tokens } from '../lib/highlight';

/** 1つの塊の行の数。見えている所の近くの塊だけを描く（234 KB・5,000 行でも、DOM にあるのは数百行） */
export const BLOCK_LINES = 50;
/** 1行の高さ（text-meta の行の高さ）。まだ描いていない塊の高さの見積もりに使う */
const LINE_HEIGHT = 20;
/** これより長い行は色を付けない（1行に詰めたコードで、要素が増えすぎないように） */
const MAX_COLORED_LINE = 4000;
/** 見えている所の上下に、先に描いておく幅 */
const AHEAD = '800px 0px';

const TOKEN_CLASS: Record<number, string> = {
  [TOKEN_COMMENT]: 'text-site-fg-2',
  [TOKEN_STRING]: 'text-site-code-string',
  [TOKEN_KEYWORD]: 'text-site-code-keyword',
  [TOKEN_NUMBER]: 'text-site-code-number',
  [TOKEN_NAME]: 'text-site-code-name',
};

/** 行の数（最後の改行の後の空の行は数えない。地図の行の数と同じ数え方） */
export function countBodyLines(text: string, lineStarts: Int32Array): number {
  return text.endsWith('\n') && lineStarts.length > 1 ? lineStarts.length - 1 : lineStarts.length;
}

interface BlockProps {
  first: number;
  last: number;
  text: string;
  lineStarts: Int32Array;
  tokens: Tokens | null;
  selected: LineRange | null;
  wrap: boolean;
  hrefFor: (line: number) => string;
  onSelect: (line: number, extend: boolean) => void;
}

/** 1行の文字。色は React の文字として描く（作り手のコードを HTML にしない。CLAUDE.md 原則7） */
function lineContent(text: string, start: number, end: number, tokens: Tokens | null, chosen: boolean): ReactNode {
  if (!tokens || end - start > MAX_COLORED_LINE) return text.slice(start, end);
  const parts: ReactNode[] = [];
  let at = start;
  for (let k = firstTokenAt(tokens, start); k < tokens.starts.length && tokens.starts[k] < end; k++) {
    const from = Math.max(tokens.starts[k], start);
    const to = Math.min(tokens.ends[k], end);
    if (to <= from) continue;
    if (from > at) parts.push(text.slice(at, from));
    parts.push(
      // 選んだ行（地が site-key）では、コメントを濃い方の色にする（site-fg-2 は site-key の上で 4.5:1 に足りない）
      <span key={from} className={chosen && tokens.types[k] === TOKEN_COMMENT ? 'text-site-fg-3' : TOKEN_CLASS[tokens.types[k]]}>
        {text.slice(from, to)}
      </span>,
    );
    at = to;
  }
  if (at < end) parts.push(text.slice(at, end));
  return parts;
}

const Block = memo(function Block({ first, last, text, lineStarts, tokens, selected, wrap, hrefFor, onSelect }: BlockProps) {
  const rows: ReactNode[] = [];
  for (let line = first; line <= last; line++) {
    const start = lineStarts[line - 1];
    let end = line < lineStarts.length ? lineStarts[line] - 1 : text.length;
    if (end > start && text.charCodeAt(end - 1) === 13) end--;
    const chosen = selected !== null && line >= selected.start && line <= selected.end;
    rows.push(
      <span key={line} data-line={line} data-selected={chosen ? '' : undefined} className={`flex scroll-mt-16 max-md:scroll-mt-28 ${wrap ? '' : 'w-max min-w-full'} ${chosen ? 'bg-site-key' : ''}`}>
        {/* 行の番号：押すとその行を選ぶ（Shift で範囲）。読み上げとキーの順には入れない（木と目次から同じ所へ行ける） */}
        <a
          href={hrefFor(line)}
          tabIndex={-1}
          aria-hidden="true"
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.metaKey || event.ctrlKey || event.button !== 0) return;
            event.preventDefault();
            onSelect(line, event.shiftKey);
          }}
          className={`sticky left-0 w-14 shrink-0 pr-3 text-right select-none hover:text-site-fg ${chosen ? 'bg-site-key text-site-fg' : 'bg-site-field text-site-fg-2'}`}
        >
          {line}
        </a>
        <span className={wrap ? 'min-w-0 flex-1 pr-3 wrap-anywhere whitespace-pre-wrap' : 'pr-4 whitespace-pre'}>{lineContent(text, start, end, tokens, chosen)}</span>
      </span>,
    );
  }
  return <>{rows}</>;
});

interface CodeBodyProps {
  text: string;
  lineStarts: Int32Array;
  tokens: Tokens | null;
  selected: LineRange | null;
  wrap: boolean;
  /** 送る入れ物（スマホの全画面の本文）。null ならページ */
  root: HTMLElement | null;
  /** 変わるたびに、選んだ範囲の頭の行へ送る（0 のときは送らない） */
  jump: number;
  label: string;
  hrefFor: (line: number) => string;
  onSelect: (line: number, extend: boolean) => void;
}

/**
 * コードの本文（WS003）。行の番号、色付け、折り返し。大きいファイルでも固まらないよう、見えている所の近くの塊だけを描く。
 * 描いていない塊は、高さだけを持つ空の箱（一度描いた塊は、その時の高さを覚える）。
 */
export function CodeBody({ text, lineStarts, tokens, selected, wrap, root, jump, label, hrefFor, onSelect }: CodeBodyProps) {
  const lines = useMemo(() => countBodyLines(text, lineStarts), [text, lineStarts]);
  const blocks = Math.ceil(lines / BLOCK_LINES);
  const blockOf = (line: number) => Math.min(blocks - 1, Math.max(0, Math.floor((line - 1) / BLOCK_LINES)));
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set([0, ...(selected ? [blockOf(selected.start)] : [])]));
  const heights = useRef(new Map<number, number>());
  const container = useRef<HTMLPreElement>(null);

  // 折り返しを替えたら、覚えた高さは使えない
  useLayoutEffect(() => {
    heights.current.clear();
  }, [wrap, text]);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        setShown((current) => {
          let next: Set<number> | null = null;
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.block);
            if (entry.isIntersecting === current.has(index)) continue;
            next ??= new Set(current);
            if (entry.isIntersecting) next.add(index);
            else {
              // 外へ出た塊は、描いた時の高さを覚えて空にする
              if (entry.boundingClientRect.height > 0) heights.current.set(index, entry.boundingClientRect.height);
              next.delete(index);
            }
          }
          return next ?? current;
        });
      },
      { root, rootMargin: AHEAD },
    );
    for (const block of element.querySelectorAll('[data-block]')) observer.observe(block);
    return () => observer.disconnect();
  }, [root, blocks, text]);

  // 行へ送る：その行のある塊を先に描き、行の要素を画面に入れる。まわりの塊が描かれて高さが変わるので、少し後にもう一度合わせる
  const target = selected?.start ?? null;
  useEffect(() => {
    if (jump === 0 || target === null) return;
    setShown((current) => (current.has(blockOf(target)) ? current : new Set(current).add(blockOf(target))));
    const align = () => container.current?.querySelector(`[data-line="${Math.min(target, lines)}"]`)?.scrollIntoView({ block: 'start' });
    const first = requestAnimationFrame(align);
    const timers = [setTimeout(align, 160), setTimeout(align, 480)];
    return () => {
      cancelAnimationFrame(first);
      timers.forEach(clearTimeout);
    };
    // 送るのは jump が変わった時だけ（行を選び直しただけでは送らない）
  }, [jump]);

  const items: ReactNode[] = [];
  for (let index = 0; index < blocks; index++) {
    const first = index * BLOCK_LINES + 1;
    const last = Math.min(lines, first + BLOCK_LINES - 1);
    const drawn = shown.has(index);
    // 選んだ範囲がこの塊に掛からないなら、範囲が変わっても描き直さない
    const blockSelected = selected && selected.start <= last && selected.end >= first ? selected : null;
    items.push(
      <span key={index} data-block={index} className="block" style={drawn ? undefined : { height: heights.current.get(index) ?? (last - first + 1) * LINE_HEIGHT }}>
        {drawn && <Block first={first} last={last} text={text} lineStarts={lineStarts} tokens={tokens} selected={blockSelected} wrap={wrap} hrefFor={hrefFor} onSelect={onSelect} />}
      </span>,
    );
  }

  return (
    <pre ref={container} tabIndex={0} aria-label={label} data-code-body="" data-lines={lines} className={`py-2 font-mono text-meta text-site-fg ${wrap ? '' : 'overflow-x-auto'}`}>
      <code>{items}</code>
    </pre>
  );
}
