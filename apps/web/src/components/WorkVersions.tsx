// 作品のページの「版」のタブ（WS004）：版の一覧、2つの版の違い、2つの版の動く作品、「この版に戻す」。
//
// - 一覧はページのデータ（worker/workAbout.ts の loadHistory）の版だけ。違いの中身も、今の版の読み口（/p/<id>/file/<版>/<ファイル>）だけから読む。
//   どの版を読めるかは Worker が1か所（revisions.ts の historyStatuses）で決める。ここでは版を足さない。
// - 一覧の数（増えた行、減った行、変わったファイル、変わったまとまり）は、一覧の1つ下の版（ひとつ前に見えている版）と比べる。
//   見えない版（審査中、差し戻し、自分だけ）を飛ばして比べるので、見えない版の中身は数にも出ない。
// - 違いの計算は Web Worker（lib/versionCompare.ts）。一覧の行は、見えたものから1つずつ数える。
// - 動く作品は今の枠（公開の版は /frame/、自分だけの作品の版は /draft-frame/）。守り（sandbox、CSP、frameGuard）は今のまま。
//   版のタブで2つを比べている間だけ枠を作る（ほかのタブでは作品の JS を動かさない）。

import { Columns2, ChevronDown, ChevronRight, Rows3, RotateCcw, WrapText, X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { WorkVersion } from '../data/pages';
import type { Work } from '../data/works';
import { useCopy, useLocale } from '../hooks/useCopy';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { localizedPath } from '../i18n';
import { frameUrl } from '../lib/frame';
import { diffRows, splitLines, type DiffRow } from '../lib/lineDiff';
import { loadVersionFiles, requestDiff } from '../lib/versionCompare';
import type { ChangedSection, FileDiff, VersionDiff } from '../lib/versionDiff';
import { namedFiles, type VersionFiles } from '../lib/versionFiles';
import { chipClass } from './chip';
import { RevisionFrame } from './RevisionFrame';

/** 一覧の1行に出す、変わったまとまりの数 */
const SHOWN_SECTIONS = 3;
/** 1つのファイルの違いで、初めに描く行の数（全部を書き換えた 5,000 行でも、DOM を大きくしない） */
const ROW_STEP = 400;
/** 幅がこれより狭いときは、上下の1列だけ（スマホ 390） */
const NARROW_QUERY = '(max-width: 767px)';

type RowStats = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; diff: VersionDiff; first: boolean };

const BADGE = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-chip border border-site-line-2 px-2 text-small text-site-fg-3';
const SMALL_BUTTON = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border border-site-line-2 bg-site-bg px-3 text-small font-semibold text-site-fg hover:bg-site-hover';
/** 増えた行と減った行の地。色は今の色の名前から作る（新しい色の名前を作らない） */
const ADD_BG = 'bg-[color-mix(in_oklab,var(--color-site-code-string)_14%,transparent)]';
const DEL_BG = 'bg-[color-mix(in_oklab,var(--color-site-lang-html)_14%,transparent)]';
const ADD_TEXT = 'text-site-code-string';
const DEL_TEXT = 'text-site-lang-html';

/** 置いた時刻（UTC）。Worker の HTML とブラウザで同じ文字にするため、Intl を使わず ISO の形から作る */
const formatTime = (at: number) => {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
};

/**
 * 版のタブの状態。WorkPage が持ち、一覧（右の列）と違い（下の幅いっぱい）に渡す。
 * documentFirst：今の版が文書の作品（index.html）。版の中身を index.html から読む（部品のファイルを試して 404 を重ねない）
 */
export function useVersions(work: Pick<Work, 'id' | 'version'>, versions: WorkVersion[], documentFirst = false) {
  const load = useCallback((version: string) => loadVersionFiles(work.id, version, documentFirst), [work.id, documentFirst]);
  // 初めは「今の版」と「その1つ前」（一覧で今の版のすぐ下の版）。新しい方を後に置く
  const initial = useMemo((): [string, string] | null => {
    if (versions.length < 2) return null;
    const at = Math.max(0, versions.findIndex((item) => item.version === work.version));
    const after = Math.min(at, versions.length - 2);
    return [versions[after + 1].version, versions[after].version];
  }, [versions, work.version]);
  const [picked, setPicked] = useState<string[]>(initial ? [...initial] : []);
  const [stats, setStats] = useState<Record<string, RowStats>>({});
  const queue = useRef<string[]>([]);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 一覧で、その版の1つ下（ひとつ前に見えている版）。いちばん下は null */
  const previousOf = useCallback((version: string) => {
    const index = versions.findIndex((item) => item.version === version);
    return index >= 0 && index + 1 < versions.length ? versions[index + 1].version : null;
  }, [versions]);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (queue.current.length > 0 && alive.current) {
      const version = queue.current.shift()!;
      const before = previousOf(version);
      try {
        const [a, b] = await Promise.all([before === null ? Promise.resolve(EMPTY) : load(before), load(version)]);
        if (!a || !b) throw new Error('unreadable');
        // 最初の版は、空と比べて行を数えるだけ（まとまりは全部が「増えた」になるので出さない）
        const diff = await requestDiff(a, b, before !== null);
        if (alive.current) setStats((old) => ({ ...old, [version]: { state: 'ready', diff, first: before === null } }));
      } catch {
        if (alive.current) setStats((old) => ({ ...old, [version]: { state: 'failed' } }));
      }
    }
    running.current = false;
  }, [previousOf, load]);

  /** 行が見えたら数える（1つずつ）。数え始めた版は覚えておき、2回は頼まない */
  const requested = useRef(new Set<string>());
  const countRow = useCallback(
    (version: string) => {
      if (requested.current.has(version)) return;
      requested.current.add(version);
      setStats((old) => ({ ...old, [version]: { state: 'loading' } }));
      queue.current.push(version);
      void pump();
    },
    [pump],
  );

  /** 比べる版を選ぶ。3つ目を選ぶと、先に選んだ方を外す */
  const toggle = useCallback((version: string) => {
    setPicked((old) => (old.includes(version) ? old.filter((item) => item !== version) : [...old, version].slice(-2)));
  }, []);

  // 比べる2つ：一覧で下（古い）方が前の版
  const pair = useMemo((): [string, string] | null => {
    if (picked.length !== 2) return null;
    const order = (version: string) => versions.findIndex((item) => item.version === version);
    const [x, y] = picked;
    return order(x) > order(y) ? [x, y] : [y, x];
  }, [picked, versions]);

  return { picked, pair, toggle, stats, countRow, previousOf, load };
}

export type VersionsState = ReturnType<typeof useVersions>;

const EMPTY: VersionFiles = { html: null, css: null, js: null, document: null };

/** 変わったまとまりの名前（例「シェーダー：WINDOW_FRAG」、「関数：step」） */
function SectionName({ section }: { section: ChangedSection }) {
  const text = useCopy().work.versions;
  return (
    <span data-version-section={`${section.kind}:${section.name}`} className="inline-flex min-w-0 items-baseline gap-1">
      <span className="text-site-fg-2">{text.kinds[section.kind] ?? section.kind}：</span>
      <span className={`wrap-anywhere ${section.kind === 'shader' || section.kind === 'function' || section.kind === 'settings' ? 'font-mono' : ''}`}>{section.name}</span>
      {section.change !== 'changed' && <span className="text-site-fg-2">（{text.change[section.change]}）</span>}
    </span>
  );
}

function LineCounts({ added, removed }: { added: number; removed: number }) {
  const text = useCopy().work.versions;
  return (
    <span data-version-lines="" className="inline-flex items-center gap-1.5 font-mono text-small">
      <span aria-hidden="true" className={`font-semibold ${ADD_TEXT}`}>
        +{added}
      </span>
      <span aria-hidden="true" className={`font-semibold ${DEL_TEXT}`}>
        −{removed}
      </span>
      <span className="sr-only">{text.lines(String(added), String(removed))}</span>
    </span>
  );
}

/** 一覧の1行。見えたら数え始める */
function VersionRow({
  item,
  current,
  oldest,
  picked,
  stats,
  canRevert,
  onToggle,
  onVisible,
  onRevert,
}: {
  item: WorkVersion;
  current: boolean;
  /** 一覧のいちばん下（最初に見えている版）。前の版と比べないので、まとまりを出さない */
  oldest: boolean;
  picked: boolean;
  stats: RowStats | undefined;
  canRevert: boolean;
  onToggle: () => void;
  onVisible: () => void;
  onRevert: () => void;
}) {
  const copy = useCopy();
  const text = copy.work.versions;
  const ref = useRef<HTMLLIElement>(null);
  const checkId = useId();

  // 見えたら1回だけ知らせる。知らせる関数は描くたびに変わるので、最後のものを持っておく
  const visible = useRef(onVisible);
  visible.current = onVisible;
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof IntersectionObserver === 'undefined') {
      visible.current();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        visible.current();
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  const diff = stats?.state === 'ready' ? stats.diff : null;
  const changedFiles = diff ? diff.files.filter((file) => file.status !== 'same') : [];
  const sections = diff && stats?.state === 'ready' && !stats.first ? diff.sections : [];

  return (
    <li ref={ref} data-version-row={item.version} data-version-picked={picked ? '' : undefined} className={`flex gap-3 px-4 py-3 ${picked ? 'bg-site-field' : ''}`}>
      <input id={checkId} type="checkbox" checked={picked} onChange={onToggle} aria-label={text.compare(item.version)} className="mt-0.5 size-[18px] shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label htmlFor={checkId} className="text-body font-semibold text-site-fg">
            {copy.work.version(item.version)}
          </label>
          <time dateTime={new Date(item.at).toISOString()} className="text-small text-site-fg-2">
            {formatTime(item.at)}
          </time>
          {current && <span className={BADGE}>{text.current}</span>}
        </div>
        {/* 数え終えると行が高くなって、下の違いが動かないように、数の行とまとまりの行の高さを先に取っておく（最初の版は、まとまりを出さないので2行） */}
        <div className={oldest ? 'min-h-10' : 'min-h-14'}>
        <div data-version-stats={stats?.state ?? 'idle'} className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-site-fg-3">
          {!stats || stats.state === 'loading' ? (
            <span className="text-site-fg-2">{text.counting}</span>
          ) : stats.state === 'failed' ? (
            <span className="text-site-fg-2">{text.countFailed}</span>
          ) : (
            <>
              {stats.first && <span className="text-site-fg-2">{text.first}</span>}
              {diff!.added + diff!.removed === 0 ? <span className="text-site-fg-2">{text.noChange}</span> : <LineCounts added={diff!.added} removed={diff!.removed} />}
              {changedFiles.length > 0 && (
                <span data-version-files="" className="font-mono">
                  <span className="sr-only">{text.files}：</span>
                  {changedFiles.map((file) => file.name).join(', ')}
                </span>
              )}
            </>
          )}
        </div>
        {sections.length > 0 && (
          <p data-version-sections="" className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-small text-site-fg-3">
            <span className="sr-only">{text.sections}：</span>
            {sections.slice(0, SHOWN_SECTIONS).map((section, index) => (
              <SectionName key={index} section={section} />
            ))}
            {sections.length > SHOWN_SECTIONS && <span className="text-site-fg-2">{text.moreSections(String(sections.length - SHOWN_SECTIONS))}</span>}
          </p>
        )}
        </div>
      </div>
      {canRevert && !current && (
        <button type="button" data-version-revert={item.version} aria-label={text.revert.openLabel(item.version)} onClick={onRevert} className={`${SMALL_BUTTON} self-start`}>
          <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
          <span className="max-sm:sr-only">{text.revert.open}</span>
        </button>
      )}
    </li>
  );
}

/** 版のタブの中身（一覧）。右の列に入る */
export function VersionList({
  work,
  title,
  versions,
  state,
  canRevert,
}: {
  work: Pick<Work, 'id' | 'version'>;
  title: string;
  versions: WorkVersion[];
  state: VersionsState;
  canRevert: boolean;
}) {
  const copy = useCopy();
  const text = copy.work.versions;
  const [reverting, setReverting] = useState<string | null>(null);
  if (versions.length === 0) return <p className="text-body text-site-fg-2">{text.none}</p>;
  return (
    <>
      {versions.length > 1 && <p className="mb-2 text-small text-site-fg-2">{text.pick}</p>}
      <ol aria-label={text.listLabel} data-version-list="" className="divide-y divide-site-line rounded-card border border-site-line">
        {versions.map((item, index) => (
          <VersionRow
            key={item.version}
            item={item}
            current={item.version === work.version}
            oldest={index === versions.length - 1}
            picked={state.picked.includes(item.version)}
            stats={state.stats[item.version]}
            canRevert={canRevert}
            onToggle={() => state.toggle(item.version)}
            onVisible={() => state.countRow(item.version)}
            onRevert={() => setReverting(item.version)}
          />
        ))}
      </ol>
      {reverting && <RevertDialog workId={work.id} title={title} current={work.version} version={reverting} onClose={() => setReverting(null)} />}
    </>
  );
}

/** 1つの版の動く作品の枠の URL。公開の版は /frame/、自分だけの作品の版は下書きの枠（持ち主だけに返る） */
function framesOf(workId: string, item: WorkVersion) {
  if (item.rid) return { desktop: `/draft-frame/${item.rid}/desktop.html`, mobile: `/draft-frame/${item.rid}/mobile.html` };
  const target = { id: workId, version: item.version };
  return { desktop: frameUrl(target, 'desktop'), mobile: frameUrl(target, 'mobile') };
}

/** 2つの版の動く作品。PC は横に並べ、スマホは切り替え（作品の JS は見せている1つだけ動かす） */
function VersionFrames({ workId, title, before, after, narrow, initialSize }: { workId: string; title: string; before: WorkVersion; after: WorkVersion; narrow: boolean; initialSize: 'desktop' | 'mobile' }) {
  const text = useCopy().work.versions;
  const [shown, setShown] = useState<'before' | 'after'>('after');
  const sides = [
    { side: 'before' as const, item: before, label: text.before(before.version) },
    { side: 'after' as const, item: after, label: text.after(after.version) },
  ];
  const frame = (item: WorkVersion) => (
    <RevisionFrame key={item.version} frames={framesOf(workId, item)} title={text.frameName(title, item.version)} stamp={item.version} initial={initialSize} />
  );
  return (
    <section aria-label={text.frames} data-version-frames="" className="mt-4">
      {narrow ? (
        <>
          <div role="group" aria-label={text.frames} className="mb-3 flex gap-2">
            {sides.map(({ side, label }) => (
              <button key={side} type="button" aria-pressed={shown === side} onClick={() => setShown(side)} className={chipClass(shown === side)}>
                {label}
              </button>
            ))}
          </div>
          <div data-version-frame={shown}>{frame(shown === 'before' ? before : after)}</div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {sides.map(({ side, item, label }) => (
            <div key={side} data-version-frame={side} className="min-w-0">
              <h3 className="mb-2 text-small font-semibold text-site-fg-2">{label}</h3>
              {frame(item)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; diff: VersionDiff; before: VersionFiles; after: VersionFiles };

/** 2つの版の違い（幅いっぱい。一覧の下）。版のタブで2つを選んでいるときだけ出す */
export function VersionCompare({ work, title, versions, state, frameSize }: { work: Pick<Work, 'id' | 'version'>; title: string; versions: WorkVersion[]; state: VersionsState; frameSize: 'desktop' | 'mobile' }) {
  const copy = useCopy();
  const text = copy.work.versions;
  const narrow = useMediaQuery(NARROW_QUERY, false);
  const [layout, setLayout] = useState<'split' | 'unified'>('split');
  const [wrap, setWrap] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const headingId = useId();
  const pair = state.pair;
  const before = pair && versions.find((item) => item.version === pair[0]);
  const after = pair && versions.find((item) => item.version === pair[1]);
  // スマホ（390）は上下の1列だけ
  const shownLayout = narrow ? 'unified' : layout;
  // 一覧の行の数を数えた結果が同じ2つなら、それを使う（まとまりは要らない）
  const known = pair && state.previousOf(pair[1]) === pair[0] ? state.stats[pair[1]] : undefined;

  useEffect(() => {
    if (!pair) return;
    let live = true;
    setLoaded({ state: 'loading' });
    (async () => {
      const [a, b] = await Promise.all([state.load(pair[0]), state.load(pair[1])]);
      if (!a || !b) throw new Error('unreadable');
      const diff = known?.state === 'ready' ? known.diff : await requestDiff(a, b, false);
      if (live) setLoaded({ state: 'ready', diff, before: a, after: b });
    })().catch(() => {
      if (live) setLoaded({ state: 'failed' });
    });
    return () => {
      live = false;
    };
    // 数え終わった結果が後から来ても、計算し直さない（同じ答え）
  }, [pair?.[0], pair?.[1], work.id, attempt]);

  if (!pair || !before || !after) return null;

  return (
    <section data-version-compare={`${pair[0]}..${pair[1]}`} aria-labelledby={headingId} className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-subhead font-semibold text-site-fg">
          {text.heading(pair[0], pair[1])}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {loaded.state === 'ready' && <LineCounts added={loaded.diff.added} removed={loaded.diff.removed} />}
          {!narrow && (
            <div role="group" aria-label={text.layout} className="flex gap-1">
              <button type="button" aria-pressed={layout === 'split'} onClick={() => setLayout('split')} className={chipClass(layout === 'split')}>
                <Columns2 size={16} strokeWidth={1.75} aria-hidden="true" />
                {text.split}
              </button>
              <button type="button" aria-pressed={layout === 'unified'} onClick={() => setLayout('unified')} className={chipClass(layout === 'unified')}>
                <Rows3 size={16} strokeWidth={1.75} aria-hidden="true" />
                {text.unified}
              </button>
            </div>
          )}
          <button type="button" aria-pressed={wrap} onClick={() => setWrap((value) => !value)} className={chipClass(wrap)}>
            <WrapText size={16} strokeWidth={1.75} aria-hidden="true" />
            {text.wrap}
          </button>
        </div>
      </div>

      <VersionFrames workId={work.id} title={title} before={before} after={after} narrow={narrow} initialSize={narrow ? 'mobile' : frameSize} />

      <div className="mt-6" data-version-diff={loaded.state}>
        {loaded.state === 'loading' && (
          <p role="status" className="text-body text-site-fg-2">
            {text.computing}
          </p>
        )}
        {loaded.state === 'failed' && (
          <p role="status" className="flex items-center gap-3 text-body text-site-fg-2">
            {text.failed}
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className={SMALL_BUTTON}>
              {text.retry}
            </button>
          </p>
        )}
        {loaded.state === 'ready' && <DiffFiles diff={loaded.diff} before={loaded.before} after={loaded.after} layout={shownLayout} wrap={wrap} />}
      </div>
    </section>
  );
}

function DiffFiles({ diff, before, after, layout, wrap }: { diff: VersionDiff; before: VersionFiles; after: VersionFiles; layout: 'split' | 'unified'; wrap: boolean }) {
  const text = useCopy().work.versions;
  const lines = useMemo(() => {
    const of = (files: VersionFiles) => new Map(namedFiles(files).map((file) => [file.name, splitLines(file.text)]));
    return { before: of(before), after: of(after) };
  }, [before, after]);
  const changed = diff.files.filter((file) => file.status !== 'same');
  const same = diff.files.filter((file) => file.status === 'same');
  return (
    <div className="flex flex-col gap-4">
      {changed.map((file) => (
        <FileBlock key={file.name} file={file} before={lines.before.get(file.name) ?? []} after={lines.after.get(file.name) ?? []} layout={layout} wrap={wrap} />
      ))}
      {same.length > 0 && <p className="text-small text-site-fg-2">{text.sameFiles(same.map((file) => file.name).join(', '))}</p>}
    </div>
  );
}

/** 1つのファイルの違い。たためる。行の番号、折り返し、左右か上下 */
const FileBlock = memo(function FileBlock({ file, before, after, layout, wrap }: { file: FileDiff; before: string[]; after: string[]; layout: 'split' | 'unified'; wrap: boolean }) {
  const text = useCopy().work.versions;
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const [limit, setLimit] = useState(ROW_STEP);
  const bodyId = useId();
  const rows = useMemo(() => diffRows(file.runs, 3, opened), [file.runs, opened]);
  const shown = rows.slice(0, limit);
  const Chevron = open ? ChevronDown : ChevronRight;
  const lineClass = wrap ? 'whitespace-pre-wrap wrap-anywhere' : 'whitespace-pre';
  const unfold = (row: Extract<DiffRow, { kind: 'fold' }>) => setOpened((old) => new Set(old).add(row.a));

  return (
    <section data-version-file={file.name} data-file-status={file.status} className="overflow-hidden rounded-card border border-site-line">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          className="flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 bg-site-field px-3 py-2 text-left text-body hover:bg-site-hover"
        >
          <Chevron size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-site-fg-2" />
          <span className="font-mono font-semibold text-site-fg">{file.name}</span>
          <span className="sr-only">{text.toggleFile(file.name)}</span>
          {file.status !== 'changed' && <span className={BADGE}>{text.fileState[file.status]}</span>}
          <LineCounts added={file.added} removed={file.removed} />
        </button>
      </h3>
      <div id={bodyId} hidden={!open}>
        {file.replaced && <p className="border-t border-site-line px-3 py-2 text-small text-site-fg-2">{text.replaced}</p>}
        <div className={`border-t border-site-line font-mono text-small ${layout === 'unified' ? 'overflow-x-auto' : ''}`}>
          {layout === 'unified' ? (
            <UnifiedRows rows={shown} before={before} after={after} lineClass={lineClass} onUnfold={unfold} />
          ) : (
            <SplitRows rows={shown} before={before} after={after} lineClass={lineClass} wrap={wrap} onUnfold={unfold} />
          )}
        </div>
        {rows.length > limit && (
          <div className="border-t border-site-line p-2">
            <button type="button" onClick={() => setLimit((value) => value + ROW_STEP)} className={SMALL_BUTTON}>
              {text.moreRows(String(rows.length - limit))}
            </button>
          </div>
        )}
      </div>
    </section>
  );
});

const NUMBER = 'w-12 shrink-0 select-none px-2 text-right text-site-fg-2';

function FoldRow({ row, onUnfold, wide }: { row: Extract<DiffRow, { kind: 'fold' }>; onUnfold: (row: Extract<DiffRow, { kind: 'fold' }>) => void; wide?: boolean }) {
  const text = useCopy().work.versions;
  return (
    <div data-diff-row="fold" className={`flex bg-site-field text-site-fg-2 ${wide ? 'col-span-2' : ''}`}>
      <button type="button" onClick={() => onUnfold(row)} className="h-8 w-full truncate px-3 text-left text-small hover:bg-site-hover hover:text-site-fg">
        {text.fold(String(row.count))}
      </button>
    </div>
  );
}

/** 上下の1列：前の版の行の番号、後の版の行の番号、印、行 */
function UnifiedRows({ rows, before, after, lineClass, onUnfold }: { rows: DiffRow[]; before: string[]; after: string[]; lineClass: string; onUnfold: (row: Extract<DiffRow, { kind: 'fold' }>) => void }) {
  return (
    <div data-diff-layout="unified" className="min-w-full w-max">
      {rows.map((row, index) => {
        if (row.kind === 'fold') return <FoldRow key={`f${row.a}`} row={row} onUnfold={onUnfold} />;
        const [sign, bg, a, b, line] =
          row.kind === 'del' ? ['−', DEL_BG, row.a + 1, '', before[row.a]] : row.kind === 'add' ? ['+', ADD_BG, '', row.b + 1, after[row.b]] : [' ', '', row.a + 1, row.b + 1, before[row.a]];
        return (
          <div key={index} data-diff-row={row.kind} className={`flex leading-5 ${bg}`}>
            <span className={NUMBER}>{a}</span>
            <span className={NUMBER}>{b}</span>
            <span aria-hidden="true" className={`w-4 shrink-0 select-none text-center ${row.kind === 'add' ? ADD_TEXT : row.kind === 'del' ? DEL_TEXT : ''}`}>
              {sign}
            </span>
            <span className={`min-w-0 flex-1 pr-3 text-site-fg ${lineClass}`}>{line}</span>
          </div>
        );
      })}
    </div>
  );
}

type SplitCell = { line: number | null; kind: 'same' | 'del' | 'add' | 'empty' };
type SplitPair = { fold: Extract<DiffRow, { kind: 'fold' }> } | { a: SplitCell; b: SplitCell };

/** 左右の組を作る。変わった所では、消えた行の並びと、続く増えた行の並びを、上から組にする */
function splitPairs(rows: DiffRow[]): SplitPair[] {
  const pairs: SplitPair[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row.kind === 'fold') {
      pairs.push({ fold: row });
      index++;
    } else if (row.kind === 'same') {
      pairs.push({ a: { line: row.a, kind: 'same' }, b: { line: row.b, kind: 'same' } });
      index++;
    } else {
      const dels: number[] = [];
      const adds: number[] = [];
      while (index < rows.length && rows[index].kind === 'del') dels.push((rows[index++] as { a: number }).a);
      while (index < rows.length && rows[index].kind === 'add') adds.push((rows[index++] as { b: number }).b);
      for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
        pairs.push({
          a: k < dels.length ? { line: dels[k], kind: 'del' } : { line: null, kind: 'empty' },
          b: k < adds.length ? { line: adds[k], kind: 'add' } : { line: null, kind: 'empty' },
        });
      }
    }
  }
  return pairs;
}

/**
 * 左右。折り返すときは、組ごとに1つの行（左右の高さをそろえる）。折り返さないときは、左と右をそれぞれ横に送れる2つの列にする
 * （どの行も1行の高さなので、2つの列の行は横にそろう）。
 */
function SplitRows({
  rows,
  before,
  after,
  lineClass,
  wrap,
  onUnfold,
}: {
  rows: DiffRow[];
  before: string[];
  after: string[];
  lineClass: string;
  wrap: boolean;
  onUnfold: (row: Extract<DiffRow, { kind: 'fold' }>) => void;
}) {
  const pairs = useMemo(() => splitPairs(rows), [rows]);
  const cell = (side: 'a' | 'b', { line, kind }: SplitCell, key: string): ReactNode => (
    <div
      key={key}
      data-diff-cell={kind}
      className={`flex min-w-0 leading-5 ${wrap ? '' : 'h-5'} ${kind === 'del' ? DEL_BG : kind === 'add' ? ADD_BG : kind === 'empty' ? 'bg-site-field' : ''} ${wrap && side === 'a' ? 'border-r border-site-line' : ''}`}
    >
      <span className={NUMBER}>{line === null ? '' : line + 1}</span>
      <span aria-hidden="true" className={`w-4 shrink-0 select-none text-center ${kind === 'add' ? ADD_TEXT : kind === 'del' ? DEL_TEXT : ''}`}>
        {kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}
      </span>
      <span className={`min-w-0 flex-1 pr-3 text-site-fg ${lineClass}`}>{line === null ? '' : side === 'a' ? before[line] : after[line]}</span>
    </div>
  );
  if (wrap) {
    return (
      <div data-diff-layout="split" className="grid grid-cols-2">
        {pairs.map((pair, index) =>
          'fold' in pair ? <FoldRow key={`f${pair.fold.a}`} row={pair.fold} onUnfold={onUnfold} wide /> : [cell('a', pair.a, `a${index}`), cell('b', pair.b, `b${index}`)],
        )}
      </div>
    );
  }
  const column = (side: 'a' | 'b') => (
    <div className={`min-w-0 overflow-x-auto ${side === 'a' ? 'border-r border-site-line' : ''}`}>
      <div className="w-max min-w-full">
        {pairs.map((pair, index) => ('fold' in pair ? <FoldRow key={`f${pair.fold.a}`} row={pair.fold} onUnfold={onUnfold} /> : cell(side, pair[side], `${side}${index}`)))}
      </div>
    </div>
  );
  return (
    <div data-diff-layout="split" className="grid grid-cols-2">
      {column('a')}
      {column('b')}
    </div>
  );
}

type Plan = { state: 'loading' } | { state: 'ready'; from: string; version: string; mode: 'private' | 'review' } | { state: 'error'; error: string };
type Sent = { state: 'idle' } | { state: 'sending' } | { state: 'done'; version: string; mode: 'private' | 'review' } | { state: 'error'; error: string };

const errorOf = (body: { error?: string } | null, status: number) => {
  const error = body?.error ?? 'failed';
  if (status === 422 && error === 'invalid') return 'invalid';
  return error;
};

/** 「この版に戻す」の確かめの窓。何版の中身で何版を作るかと、自分だけの版になるか審査に回るかを出す。同意の3つは「新しい版を置く」と同じ */
function RevertDialog({ workId, title, current, version, onClose }: { workId: string; title: string; current: string; version: string; onClose: () => void }) {
  const copy = useCopy();
  const locale = useLocale();
  const text = copy.work.versions.revert;
  const submit = copy.post.submit;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [plan, setPlan] = useState<Plan>({ state: 'loading' });
  const [sent, setSent] = useState<Sent>({ state: 'idle' });
  const [confirm, setConfirm] = useState({ own: false, mit: false, terms: false });

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    if (!dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      const response = await fetch(`/api/post/works/${encodeURIComponent(workId)}/revert?version=${encodeURIComponent(version)}`, { credentials: 'same-origin' });
      const body = (await response.json().catch(() => null)) as { from?: string; version?: string; mode?: 'private' | 'review'; error?: string } | null;
      if (!live) return;
      if (response.ok && body?.from && body.version && body.mode) setPlan({ state: 'ready', from: body.from, version: body.version, mode: body.mode });
      else setPlan({ state: 'error', error: errorOf(body, response.status) });
    })().catch(() => live && setPlan({ state: 'error', error: 'failed' }));
    return () => {
      live = false;
    };
  }, [workId, version]);

  const close = () => dialogRef.current?.close();
  const confirmed = confirm.own && confirm.mit && confirm.terms;

  const onRevert = async () => {
    if (plan.state !== 'ready' || !confirmed || sent.state === 'sending') return;
    setSent({ state: 'sending' });
    try {
      const response = await fetch(`/api/post/works/${encodeURIComponent(workId)}/revert`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, ...confirm }),
      });
      const body = (await response.json().catch(() => null)) as { version?: string; status?: string; error?: string } | null;
      if (response.ok && body?.version) {
        const mode = body.status === 'private' ? 'private' : 'review';
        setSent({ state: 'done', version: body.version, mode });
        // 自分だけの作品は、新しい版がすぐ今の版になる。ページを読み込み直して、一覧と動く作品を新しくする
        if (mode === 'private') window.setTimeout(() => window.location.reload(), 600);
      } else {
        setSent({ state: 'error', error: errorOf(body, response.status) });
      }
    } catch {
      setSent({ state: 'error', error: 'failed' });
    }
  };

  const message =
    sent.state === 'done'
      ? sent.mode === 'private'
        ? text.donePrivate(sent.version)
        : text.doneReview(sent.version)
      : sent.state === 'error'
        ? (text.errors[sent.error] ?? text.errors.failed)
        : plan.state === 'error'
          ? (text.errors[plan.error] ?? text.errors.failed)
          : '';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={headingId}
      data-revert-dialog={sent.state === 'idle' ? plan.state : sent.state}
      onClose={onClose}
      className="m-auto max-h-[calc(100dvh-32px)] w-[min(520px,calc(100vw-32px))] max-w-none overflow-y-auto rounded-card border border-site-line-2 bg-site-bg p-5 text-body text-site-fg shadow-menu backdrop:bg-site-scrim/50"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-subhead font-semibold">
          {text.heading(version)}
        </h2>
        <button type="button" aria-label={text.close} onClick={close} className="-mt-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-control text-site-fg-2 hover:bg-site-hover">
          <X size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p className="mt-1 text-small text-site-fg-2 wrap-anywhere">{title}</p>
      {plan.state === 'loading' && <p className="mt-4 text-site-fg-2">{text.loading}</p>}
      {plan.state === 'ready' && (
        <>
          <p data-revert-lead="" className="mt-4">
            {text.lead(plan.from, plan.version)}
          </p>
          <p data-revert-mode={plan.mode} className="mt-2 rounded-control bg-site-field px-3 py-2.5 text-small">
            {plan.mode === 'private' ? text.private : text.review(current)}
          </p>
          {sent.state !== 'done' && (
            <fieldset className="mt-4 flex flex-col gap-2.5 text-small">
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={confirm.own} onChange={(event) => setConfirm({ ...confirm, own: event.target.checked })} className="mt-px size-[18px] shrink-0" />
                {submit.own}
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={confirm.mit} onChange={(event) => setConfirm({ ...confirm, mit: event.target.checked })} className="mt-px size-[18px] shrink-0" />
                {submit.mit}
              </label>
              <label className="flex items-start gap-2.5">
                <input type="checkbox" checked={confirm.terms} onChange={(event) => setConfirm({ ...confirm, terms: event.target.checked })} className="mt-px size-[18px] shrink-0" />
                <span>
                  {submit.termsBefore}
                  <a href={localizedPath(locale, '/terms')} target="_blank" rel="noopener" className="underline">
                    {submit.termsLink}
                  </a>
                  {submit.termsAfter}
                </span>
              </label>
            </fieldset>
          )}
        </>
      )}
      <p role="status" data-revert-message="" className="mt-4 text-small font-semibold empty:hidden">
        {message}
      </p>
      {sent.state === 'done' && sent.mode === 'review' && (
        <a href={localizedPath(locale, '/account/works')} className={`${SMALL_BUTTON} mt-3`}>
          {submit.toWorks}
        </a>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={close} className="inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 font-semibold hover:bg-site-hover">
          {sent.state === 'done' ? text.close : text.cancel}
        </button>
        {sent.state !== 'done' && (
          <button
            type="button"
            data-revert-confirm=""
            disabled={plan.state !== 'ready' || !confirmed || sent.state === 'sending'}
            onClick={onRevert}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-site-primary px-4 font-semibold text-site-bg disabled:opacity-40"
          >
            <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
            {sent.state === 'sending' ? text.sending : text.confirm}
          </button>
        )}
      </div>
    </dialog>
  );
}
