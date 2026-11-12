import { ArrowLeft, Braces, ChevronDown, ChevronRight, File, Hash, Image, SlidersHorizontal, Triangle } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import type { WorkTree } from '../data/pages';
import { useCodeLink } from '../hooks/useCodeLink';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useHydrated } from '../hooks/useHydrated';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { codePath, fileCopyText, fileTextUrl, parseLineHash, type LineRange } from '../lib/codeAddress';
import { COPIED_MS } from '../lib/count';
import { buildFileTree, functionsOf, pathTo, sectionAt, shaderRanges, type TreeNode } from '../lib/fileTree';
import { formatBytes } from '../lib/format';
import type { Tokens } from '../lib/highlight';
import { localizedPath } from '../i18n';
import { lineStartsOf } from '../lib/lines';

// 本文の部品と色付けは、ファイルを開いた時にだけ読む（どのページにも入る最初の JS を増やさない。SPEC.md 10）
const CodeBody = lazy(() => import('./CodeBody').then((module) => ({ default: module.CodeBody })));

/** 共有する住所はいつも本番のもの（workers.dev や手元で開いていても） */
const SHARE_ORIGIN = 'https://ludion.ai';
/** スマホ（本文を全画面で出す幅）。Tailwind の max-md と同じ */
const NARROW_QUERY = '(max-width: 767px)';

const ICONS = { file: File, group: Triangle, settings: SlidersHorizontal, heading: Hash, shader: Triangle, style: Braces, script: Braces, asset: Image } as const;

const SMALL_BUTTON = 'inline-flex h-8 shrink-0 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-2.5 text-small font-semibold text-site-fg hover:bg-site-hover max-md:h-10 max-md:flex-1';

type Loaded = { file: string; text: string; lineStarts: Int32Array };
type Flash = { key: 'file' | 'address'; state: 'copied' | 'failed' } | null;

/** 手の空いた時に動かす（色付けは、本文を出した後に） */
function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 500 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 60);
  return () => clearTimeout(id);
}

interface WorkFilesProps {
  workId: string;
  version: string;
  tree: WorkTree;
  /** クレジット行の文字（ファイルをコピーした文字の頭に入れる） */
  credit: string[];
  /** 「全部をコピー」の文字。文書の作品の index.html をコピーするときは、これと同じ文字 */
  snippet: string;
  /** 開いているファイル（道の /code/<file>）。なければ null */
  file: string | null;
  /** コピーできた時（数えるのは親。自分だけの作品では数えない） */
  onCopied: () => void;
}

/**
 * ファイルの木と本文（WS003）。本当のファイルと、1つのファイルの中の分け目を同じ木に出す。押すと、本文のその行へ飛ぶ。
 * 住所（/p/<id>/code/<file>#L204-L760）が1つの正：木、目次、行の番号、「この作品について」の印は、どれも住所を替えるだけ。
 * 幅767px以下では、本文を全画面で出す（上に道しるべ、左上に戻る）。
 */
export function WorkFiles({ workId, version, tree, credit, snippet, file, onCopied }: WorkFilesProps) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.work.files;
  const location = useLocation();
  const { go, close, stay } = useCodeLink(workId);
  const narrow = useMediaQuery(NARROW_QUERY, false);
  // # の後ろ（どの行か）は Worker から見えない。載せる最初の描画では使わず、載った後に当てる
  const hydrated = useHydrated();
  const range = file && hydrated ? parseLineHash(location.hash) : null;

  const nodes = useMemo(() => buildFileTree(tree), [tree]);
  const openFile = file !== null && tree.files.some((item) => item.name === file) ? file : null;
  const section = openFile ? sectionAt(tree, openFile, range) : null;
  const sectionKey = section && section.kind !== 'function' ? `${section.file}:${section.kind}:${section.start}-${section.end}:${section.name}` : null;
  const trail = useMemo(() => (sectionKey ? pathTo(nodes, sectionKey) : openFile ? pathTo(nodes, openFile) : []), [nodes, sectionKey, openFile]);

  // ---- 木の開け閉め。初めは、いちばん大きいファイルを開く（767px以下は、初めは全部たたむ）。開いている所への道は、いつも開く
  const biggest = useMemo(() => tree.files.reduce((best, item) => (item.bytes > best.bytes ? item : best), tree.files[0])?.name, [tree]);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const onTrail = (key: string) => trail.some((node) => node.key === key);
  const isOpen = (node: TreeNode) => toggled[node.key] ?? (onTrail(node.key) || (node.key === biggest && !narrow));

  // ---- 本文の文字。ページ用の読み口から、開いたファイルだけを読む（一度読んだファイルは持っておく）
  const texts = useRef(new Map<string, Loaded>());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!openFile) return;
    const known = texts.current.get(openFile);
    if (known) {
      setLoaded(known);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setFailed(false);
    fetch(fileTextUrl(workId, version, openFile), { signal: controller.signal })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((body) => {
        const next = { file: openFile, text: body, lineStarts: lineStartsOf(body) };
        texts.current.set(openFile, next);
        setLoaded(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [workId, version, openFile, attempt]);
  const current = loaded && loaded.file === openFile ? loaded : null;

  // ---- 色付け。本文を地の色で出した後、手の空いた時に付ける
  const [colored, setColored] = useState<{ file: string; tokens: Tokens } | null>(null);
  useEffect(() => {
    if (!current || colored?.file === current.file) return;
    const language = tree.files.find((item) => item.name === current.file)?.language ?? 'html';
    let live = true;
    const cancel = whenIdle(() => {
      void import('../lib/highlight').then(({ tokenize }) => {
        if (live) setColored({ file: current.file, tokens: tokenize(current.text, language, shaderRanges(tree, current.file), current.lineStarts) });
      });
    });
    return () => {
      live = false;
      cancel();
    };
  }, [current, colored, tree]);
  const tokens = current && colored?.file === current.file ? colored.tokens : null;

  // ---- 折り返し。767px以下は初めから折り返す
  const [wrapChoice, setWrapChoice] = useState<boolean | null>(null);
  const wrap = wrapChoice ?? narrow;

  // ---- 住所が替わったら、その行へ送る。行の番号を押して選んだ時（stay）は送らない
  const [jump, setJump] = useState(0);
  // 入れ物は state で持つ（スマホの全画面では、これが「送る入れ物」になる。載った後に本文へ渡すため）
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!openFile || stay) return;
    setJump((count) => count + 1);
    // 行の指定がなければ、本文の頭を見える所へ（スマホは全画面なので、送らない）
    if (!parseLineHash(location.hash) && !window.matchMedia(NARROW_QUERY).matches) panel?.scrollIntoView({ block: 'start' });
  }, [openFile, location.hash, location.key, stay, panel]);

  // ---- スマホの全画面：開いたらフォーカスを中へ、閉じたら押した所へ。Esc でも閉じる
  const backLink = useRef<HTMLAnchorElement>(null);
  /** 本文を開いた時にフォーカスがあった物（木のリンク、「この作品について」の印）。閉じたら、そこへ戻す */
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!window.matchMedia(NARROW_QUERY).matches) {
      wasOpen.current = openFile !== null;
      return;
    }
    if (openFile && !wasOpen.current) {
      opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      backLink.current?.focus();
    }
    if (!openFile && wasOpen.current && opener.current?.isConnected) opener.current.focus();
    wasOpen.current = openFile !== null;
  }, [openFile]);
  // 全画面の間は、後ろのページ（頭、動く作品、木、下の並び、サイトの頭と下のタブ）を、キーの Tab と読み上げから外す。
  // 見えていない物にフォーカスが入らないように（Tab と読み上げの順は、見えている順）
  useEffect(() => {
    if (!openFile || !narrow || !panel) return;
    const hidden: Element[] = [];
    for (let node: Element = panel; node.parentElement && node !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node && !sibling.hasAttribute('inert') && sibling.tagName !== 'SCRIPT' && sibling.tagName !== 'STYLE') {
          sibling.setAttribute('inert', '');
          hidden.push(sibling);
        }
      }
    }
    return () => {
      for (const element of hidden) element.removeAttribute('inert');
    };
  }, [openFile, narrow, panel]);
  useEffect(() => {
    if (!openFile || !narrow) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFile, narrow, close]);

  // ---- 住所を替える（hooks/useCodeLink.ts）。開いている間の移動は、履歴を増やさない（戻るは1回で閉じる）
  const onLink = (event: MouseEvent<HTMLAnchorElement>, toFile: string, toRange: LineRange | null) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    go(toFile, toRange);
  };
  const selectLine = useCallback(
    (line: number, extend: boolean) => {
      if (!openFile) return;
      const anchor = parseLineHash(window.location.hash);
      // Shift を押しながら：前に選んだ範囲の頭から、押した行まで
      const next = extend && anchor ? { start: Math.min(anchor.start, line), end: Math.max(anchor.start, line) } : { start: line, end: line };
      go(openFile, next, { stay: true });
    },
    [openFile, go],
  );
  const hrefFor = useCallback((line: number) => `#L${line}`, []);

  // ---- コピー
  const [flash, setFlash] = useState<Flash>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const write = async (key: 'file' | 'address', value: string) => {
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      state = 'failed';
    }
    setFlash({ key, state });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), COPIED_MS);
    return state === 'copied';
  };
  const address = openFile ? `${SHARE_ORIGIN}${codePath(workId, openFile, range)}` : '';
  const copyFile = async () => {
    if (!current) return;
    // 文書の作品は、その文書が「全部をコピー」の文字（クレジット行は <!doctype> の直後）。ほかは、頭にクレジット行（原則4）
    const value = current.file === 'index.html' ? snippet : fileCopyText(current.file, current.text, credit);
    if (await write('file', value)) onCopied();
  };
  const label = (key: 'file' | 'address', idle: string) => (flash?.key === key ? (flash.state === 'copied' ? text.copied : text.copyFailed) : idle);

  // ---- 木
  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const Icon = ICONS[node.kind];
    const open = isOpen(node);
    const name = node.kind === 'group' ? text.shaders(String(node.children.length)) : node.name;
    const selected = node.kind === 'file' ? openFile === node.file && !sectionKey : node.key === sectionKey;
    const real = node.kind === 'file';
    return (
      <li key={node.key}>
        <div className={`flex items-center rounded-control ${selected ? 'bg-site-hover' : ''}`} style={{ paddingLeft: depth * 14 }}>
          {node.children.length > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={text.inside(name)}
              onClick={() => setToggled((state) => ({ ...state, [node.key]: !open }))}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-site-fg-2 hover:bg-site-hover max-md:size-11"
            >
              {open ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
            </button>
          ) : (
            <span className="size-8 shrink-0 max-md:size-11" />
          )}
          <Link
            to={codePath(workId, node.file, node.range)}
            data-tree-key={node.key}
            data-tree-kind={node.kind}
            aria-current={selected ? 'true' : undefined}
            onClick={(event) => onLink(event, node.file, node.range)}
            className={`flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-control py-1 pr-2 text-small max-md:min-h-11 ${real ? 'font-semibold text-site-fg' : 'text-site-fg-3'} hover:text-site-fg`}
          >
            <Icon size={14} strokeWidth={real ? 1.75 : 2} aria-hidden="true" className={`shrink-0 ${real ? 'text-site-fg-3' : node.kind === 'shader' || node.kind === 'group' ? 'text-site-code-name' : 'text-site-fg-2'}`} />
            <span className="sr-only">{text.kinds[node.kind]}：</span>
            <span className={`line-clamp-2 min-w-0 flex-1 wrap-anywhere ${node.kind === 'shader' || node.kind === 'settings' ? 'font-mono' : ''}`}>{name}</span>
            {real && (
              <span className="shrink-0 font-normal text-site-fg-2">
                {formatBytes(node.bytes ?? 0)}
                {(node.lines ?? 0) >= 100 && ` · ${text.lines((node.lines ?? 0).toLocaleString('en-US'))}`}
              </span>
            )}
            {!real && node.children.length > 0 && node.kind !== 'group' && <span className="shrink-0 text-site-fg-2">{node.children.length}</span>}
          </Link>
        </div>
        {node.children.length > 0 && open && <ul>{node.children.map((child) => renderNode(child, depth + 1))}</ul>}
      </li>
    );
  };

  const functions = openFile ? functionsOf(tree, openFile) : [];
  const language = section?.kind === 'shader' ? 'GLSL' : null;

  return (
    <section data-work-files="" aria-label={text.heading} className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-[280px_minmax(0,1fr)] md:items-start">
      {/* ファイルの木 */}
      <div className="rounded-card border border-site-line md:sticky md:top-4 md:max-h-[calc(100vh-2rem)] md:overflow-y-auto">
        <h2 className="border-b border-site-line px-4 py-3 text-body font-semibold text-site-fg">{text.heading}</h2>
        <ul data-file-tree="" className="p-1.5">
          {nodes.map((node) => renderNode(node, 0))}
        </ul>
        {tree.dropped > 0 && <p className="px-4 pb-2 text-small text-site-fg-2">{text.dropped(String(tree.dropped))}</p>}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-site-line px-4 py-2.5 text-small text-site-fg-2">
          <span className="inline-flex items-center gap-1.5">
            <File size={12} strokeWidth={1.75} aria-hidden="true" className="text-site-fg-3" />
            {text.legendFile}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Hash size={12} strokeWidth={2} aria-hidden="true" />
            {text.legendPart}
          </span>
        </p>
      </div>

      {/* 本文。767px以下は、開いたら全画面 */}
      <div
        ref={setPanel}
        data-code-panel=""
        data-open={openFile ? '' : undefined}
        className={`min-w-0 scroll-mt-4 rounded-card border border-site-line bg-site-field ${
          openFile ? 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:overflow-y-auto max-md:overscroll-contain max-md:rounded-none max-md:border-0' : 'max-md:hidden'
        }`}
      >
        {!openFile ? (
          <p className="px-4 py-10 text-center text-body text-site-fg-2">{text.empty}</p>
        ) : (
          <>
            {/* 上の帯（道しるべとボタン）は、本文を送っても上に残す */}
            <div data-code-bar="" className="sticky top-0 z-10 border-b border-site-line bg-site-field px-3 py-2 md:flex md:flex-wrap md:items-center md:justify-between md:gap-x-3 md:rounded-t-card">
              <div className="flex min-w-0 items-center gap-1 md:min-h-8">
                <a
                  ref={backLink}
                  href={localizedPath(locale, `/p/${encodeURIComponent(workId)}`)}
                  aria-label={text.back}
                  onClick={(event) => {
                    event.preventDefault();
                    close();
                  }}
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-control text-site-fg hover:bg-site-hover md:hidden"
                >
                  <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
                </a>
                {/* 道しるべ：ファイル名 › 分け目 */}
                <p data-code-trail="" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 text-small text-site-fg-3">
                  {trail.map((node, index) => (
                    <span key={node.key} className="inline-flex min-w-0 items-center gap-1.5">
                      {index > 0 && <ChevronRight size={12} strokeWidth={2} aria-hidden="true" className="shrink-0 text-site-fg-2" />}
                      <span className={`wrap-anywhere ${index === trail.length - 1 ? 'font-semibold text-site-fg' : ''} ${node.kind === 'shader' ? 'font-mono' : ''}`}>
                        {node.kind === 'group' ? text.kinds.shader : node.name}
                      </span>
                    </span>
                  ))}
                  {language && <span className="rounded-chip bg-site-key px-1.5 text-site-fg-3">{language}</span>}
                </p>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-2 md:mt-0 md:justify-end">
                <button type="button" onClick={() => void write('address', address)} className={SMALL_BUTTON}>
                  {label('address', text.copyAddress)}
                </button>
                <button type="button" aria-label={text.copyFileLabel(openFile)} disabled={!current} onClick={() => void copyFile()} className={`${SMALL_BUTTON} disabled:opacity-60`}>
                  {label('file', text.copyFile)}
                </button>
                {/* 生の文字（WS006）。言語のない道 */}
                <a href={`/p/${encodeURIComponent(workId)}/raw/${openFile}`} target="_blank" rel="noopener" className={`${SMALL_BUTTON} max-md:hidden`}>
                  {text.raw}
                </a>
                <button type="button" aria-pressed={wrap} onClick={() => setWrapChoice(!wrap)} className={`${SMALL_BUTTON} ${wrap ? 'bg-site-key' : ''}`}>
                  {text.wrap}
                </button>
              </div>
              <p role="status" className="sr-only">
                {flash ? (flash.state === 'copied' ? text.copied : text.copyFailed) : ''}
              </p>
            </div>

            <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_200px]">
              <div className="min-w-0">
                {current ? (
                  <Suspense
                    fallback={
                      <p role="status" className="px-4 py-10 text-center text-body text-site-fg-2">
                        {text.loading}
                      </p>
                    }
                  >
                    <CodeBody
                      key={current.file}
                      text={current.text}
                      lineStarts={current.lineStarts}
                      tokens={tokens}
                      selected={range}
                      wrap={wrap}
                      root={narrow ? panel : null}
                      jump={jump}
                      label={text.body(current.file)}
                      hrefFor={hrefFor}
                      onSelect={selectLine}
                    />
                  </Suspense>
                ) : failed ? (
                  <p role="alert" className="px-4 py-10 text-center text-body text-site-fg-2">
                    {text.loadError}
                    <button type="button" onClick={() => setAttempt((count) => count + 1)} className={`${SMALL_BUTTON} ml-3 max-md:flex-none`}>
                      {text.retry}
                    </button>
                  </p>
                ) : (
                  <p role="status" className="px-4 py-10 text-center text-body text-site-fg-2">
                    {text.loading}
                  </p>
                )}
              </div>
              {/* 目次：関数の名前と行 */}
              {functions.length > 0 && (
                <nav aria-label={text.toc} data-code-toc="" className="border-l border-site-line max-xl:hidden xl:sticky xl:top-14 xl:max-h-[calc(100vh-4.5rem)] xl:self-start xl:overflow-y-auto">
                  <h3 className="px-3 pt-3 text-small font-semibold text-site-fg-2">{text.toc}</h3>
                  <ul className="p-1.5">
                    {functions.map((item) => (
                      <li key={`${item.start}-${item.name}`}>
                        <Link
                          to={codePath(workId, item.file, { start: item.start, end: item.end })}
                          onClick={(event) => onLink(event, item.file, { start: item.start, end: item.end })}
                          aria-current={range?.start === item.start && range.end === item.end ? 'true' : undefined}
                          className={`flex items-baseline gap-2 rounded-control px-2 py-1 font-mono text-small text-site-fg-3 hover:bg-site-hover hover:text-site-fg ${
                            range?.start === item.start && range.end === item.end ? 'bg-site-hover text-site-fg' : ''
                          }`}
                        >
                          <span className="min-w-0 flex-1 wrap-anywhere">{item.name}</span>
                          <span className="shrink-0 text-site-fg-2">{item.start}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}
            </div>

            <p data-code-address="" className="border-t border-site-line px-4 py-2.5 text-small text-site-fg-2 wrap-anywhere">
              {text.address}：<span className="font-mono text-site-fg-3">{address.replace('https://', '')}</span>
              <span className="max-md:hidden"> · {text.hint}</span>
            </p>
          </>
        )}
      </div>
    </section>
  );
}
