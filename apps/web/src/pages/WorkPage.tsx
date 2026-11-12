import { Bookmark, Clock, Code2, Copy, Eye, GitFork, Globe, Heart, History, Lock, Monitor, Share2, SlidersHorizontal, Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useParams } from 'react-router';
import { FramePreview } from '../components/FramePreview';
import { Masonry } from '../components/Masonry';
import { NoscriptGrid } from '../components/NoscriptGrid';
import { RemixSheet } from '../components/RemixSheet';
import { ThumbCapture } from '../components/ThumbCapture';
import { WallpaperSheet } from '../components/WallpaperSheet';
import { WorkAbout } from '../components/WorkAbout';
import { WorkFiles } from '../components/WorkFiles';
import { useVersions, VersionCompare, VersionList } from '../components/WorkVersions';
import { ReportIssue } from '../components/ReportIssue';
import { XLink } from '../components/XLink';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import type { PageData } from '../data/pages';
import type { Work } from '../data/works';
import { useAccount } from '../hooks/useAccount';
import { useOwnWorks } from '../hooks/useOwnWorks';
import { usePageData } from '../hooks/usePageData';
import { useResetTitle } from '../hooks/useResetTitle';
import { useTabsFit } from '../hooks/useTabsFit';
import { trackEvent } from '../lib/analytics';
import { COPIED_MS, postCount } from '../lib/count';
import { fileOfSplat } from '../lib/codeAddress';
import { isWallpaper } from '../lib/homeQuery';
import { stateOf, type WorkState } from '../lib/workState';
import { NotFound } from './NotFound';

/** 共有する URL はいつも本番のもの（workers.dev や手元で開いていても）。 */
const SHARE_ORIGIN = 'https://ludion.ai';

/** 幅767px以下で、たたんだコードの箱：3行（16px × 3）＋上下の余白（12px × 2）＋枠（1px × 2）。text-small の行の高さに合わせる */
const COLLAPSED_CODE = 'max-md:max-h-[74px] max-md:overflow-hidden';

/** 枠の入れ物の直後で、枠を読み始める（関数は #root より前の src/previewStart.ts が置く）。Worker の HTML とブラウザで同じ文字列にする */
const PREVIEW_START_CALL = { __html: 'window.__ldStartPreview&&window.__ldStartPreview()' };

const whiteButton =
  'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-site-line-2 bg-site-bg text-body font-semibold text-site-fg hover:bg-site-hover';

/** 頭の右の「新しい版を置く」（持ち主だけ。1024px以上）。高さ36px */
const HEAD_BUTTON = 'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-control border px-3.5 text-small font-semibold';

/** 頭の札（状態、版、種類） */
const BADGE = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-chip border border-site-line-2 px-2 text-small text-site-fg-3';

/** タブ（WS003「2」）。設定は持ち主だけ */
type TabId = 'code' | 'versions' | 'lineage' | 'settings';

export function WorkPage() {
  const page = usePageData();
  const { id, '*': rest } = useParams();
  // 道の残りは、空か、行の住所（code/<file>）だけ。ほかは、ないページ（Worker も 404 を返す）
  if (rest && fileOfSplat(rest) === null) return <NotFound />;
  // 作品のページは、どのリンクからでも読み込み直して開く（Worker が描く）。データが違うのは、Worker を通らなかったときだけ
  if (page?.kind !== 'work' || page.work.id !== id) return <NotFound />;
  return <WorkDetail key={page.work.id} page={page} />;
}

function WorkDetail({ page }: { page: Extract<PageData, { kind: 'work' }> }) {
  const copy = useCopy();
  const locale = useLocale();
  const { work, creator, more, others, snippet, background, source } = page;
  // 自分だけの作品（docs/tasks/T036.md）。数えない、GA4 に送らない、いいねと共有とリミックスを出さない
  const isPrivate = page.private !== null;
  const { handle } = creator;
  const { isBookmarked, isLiked, likeDelta, toggleBookmark, toggleLike } = useAccount();
  const ownWorks = useOwnWorks();
  /** 開いているファイル（道の /code/<file>）。なければ null */
  const openFile = fileOfSplat(useParams()['*']);
  // 初めはいつも「コード」。URL からは選ばない（Worker の HTML と同じ形で載せる）
  const [tab, setTab] = useState<TabId>('code');
  const tabsId = useId();
  const saved = isBookmarked(work.id);
  const liked = isLiked(work.id);

  const [copies, setCopies] = useState(work.copies);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const codeRef = useRef<HTMLPreElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [codeOpen, setCodeOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const codeId = useId();
  const [shareState, setShareState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const shareTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const viewSent = useRef(false);
  const [remixAnchor, setRemixAnchor] = useState<HTMLElement | null>(null);
  const [wallpaperAnchor, setWallpaperAnchor] = useState<HTMLElement | null>(null);
  const wallpaper = isWallpaper(work);
  // 閉じても、開き直せば書いた文が残る
  const [remixBrief, setRemixBrief] = useState('');

  useResetTitle();

  // 開いたときに1回だけ送る（重複は除かない）。StrictMode で effect が2回動いても1回にする
  useEffect(() => {
    if (viewSent.current || isPrivate) return;
    viewSent.current = true;
    postCount(work.id, 'view');
  }, [work.id, isPrivate]);

  useEffect(
    () => () => {
      clearTimeout(copyTimer.current);
      clearTimeout(shareTimer.current);
    },
    [],
  );

  const showCopyState = (state: 'copied' | 'failed') => {
    setCopyState(state);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), COPIED_MS);
  };

  // コピーできた時に数える（「全部をコピー」と、本文の「ファイルをコピー」）。自分だけの作品では数えない
  const countCopy = () => {
    if (isPrivate) return;
    setCopies((count) => count + 1);
    postCount(work.id, 'copy');
    trackEvent('copy_code', { work_id: work.id });
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      // クリップボードが使えないときは、手で写せるようにコードを開いて選んでおく。コピーしていないので数えない
      setCodeOpen(true);
      if (codeRef.current) window.getSelection()?.selectAllChildren(codeRef.current);
      showCopyState('failed');
      return;
    }
    showCopyState('copied');
    countCopy();
  };

  const toggleCode = () => {
    // 開くときも、たたむときも、1行目のクレジット行から見せる
    if (codeRef.current) codeRef.current.scrollTop = 0;
    setCodeOpen((open) => !open);
  };

  const copyLink = async (url: string) => {
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      state = 'failed';
    }
    setShareState(state);
    clearTimeout(shareTimer.current);
    shareTimer.current = setTimeout(() => setShareState('idle'), COPIED_MS);
  };

  // イベントは押した数を数える（docs/tasks/T018.md の合否）。共有の画面で取りやめても1回
  const onShare = async () => {
    const url = `${SHARE_ORIGIN}/p/${work.id}`;
    if (typeof navigator.share !== 'function') {
      trackEvent('share', { work_id: work.id, method: 'clipboard' });
      await copyLink(url);
      return;
    }
    trackEvent('share', { work_id: work.id, method: 'native' });
    try {
      await navigator.share({ title: work.title, url });
    } catch (error) {
      // AbortError は、人が共有の画面を閉じただけ
      if (!(error instanceof DOMException && error.name === 'AbortError')) await copyLink(url);
    }
  };

  const onSelectWork = (to: Work) => trackEvent('select_work', { from_work_id: work.id, to_work_id: to.id });

  const openRemix = (event: MouseEvent<HTMLButtonElement>) => {
    setRemixAnchor(event.currentTarget);
    trackEvent('remix_open', { work_id: work.id });
  };

  // 幅で置き場所が変わるので、2つ描いて CSS で片方だけ見せる（読み込みの後にずれないように）。
  // 壁紙の作品だけ、「リミックス」の横に「壁紙にする」を置く（WALL001「2」）。
  // 2つを横に並べて幅を分ける
  const remixButton = (buttonClass: string, wrapClass: string) => {
    const buttons = (
      <>
        <button type="button" aria-haspopup="dialog" onClick={openRemix} className={buttonClass}>
          <GitFork size={18} strokeWidth={1.75} aria-hidden="true" />
          {copy.work.remix.open}
        </button>
        {wallpaper && (
          <button type="button" aria-haspopup="dialog" onClick={(event) => setWallpaperAnchor(event.currentTarget)} className={buttonClass}>
            <Monitor size={18} strokeWidth={1.75} aria-hidden="true" />
            {copy.work.wallpaper.open}
          </button>
        )}
      </>
    );
    return <div className={`flex gap-3 ${wrapClass}`}>{buttons}</div>;
  };

  const views = copy.count(work.views);
  const copyCount = copy.count(copies);
  const likes = copy.count(work.likes + likeDelta(work.id));
  const shareMessage = shareState === 'copied' ? copy.work.linkCopied : shareState === 'failed' ? copy.work.copyFailed : '';

  // 持ち主か。HTML は人によって変えないので、公開の作品では、読み込みの後に自分の作品の一覧（左のナビと同じ答え）から決める。
  // 自分だけの作品のページは持ち主にだけ描くので、Worker の HTML から持ち主の形
  const own = ownWorks.state.status === 'ready' ? ownWorks.state.works.find((item) => item.id === work.id) : undefined;
  const isOwner = isPrivate || own !== undefined;
  const state: WorkState = own ? stateOf(own) : isPrivate ? 'private' : 'public';
  const StateIcon = state === 'public' ? Globe : state === 'private' ? Lock : Clock;
  const newVersionPath = localizedPath(locale, `/new?work=${encodeURIComponent(work.id)}`);
  // 版のタブ（WS004）：一覧は右の列、2つの版の違いは下の幅いっぱい。状態はここで1つ持つ
  const versions = useVersions(work, page.versions, page.tree?.files.some((file) => file.name === 'index.html') ?? false);

  const tabs: { id: TabId; label: string; icon: typeof Code2; count?: number }[] = [
    { id: 'code', label: copy.work.tabs.code, icon: Code2 },
    { id: 'versions', label: copy.work.tabs.versions, icon: History, count: page.versions.length },
    { id: 'lineage', label: copy.work.tabs.lineage, icon: GitFork, count: page.lineage.count },
    ...(isOwner ? [{ id: 'settings' as const, label: copy.work.tabs.settings, icon: SlidersHorizontal }] : []),
  ];
  const shownTab = tabs.some((item) => item.id === tab) ? tab : 'code';
  // タブが増えたら（持ち主とわかって設定が出たら）、入るかを測り直す
  const tabsFit = useTabsFit<HTMLDivElement>(tabs.map((item) => `${item.id}${item.count ?? ''}`).join());

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((item) => item.id === shownTab);
    const next =
      event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
    if (next === -1) return;
    event.preventDefault();
    setTab(tabs[next].id);
    document.getElementById(`${tabsId}-tab-${tabs[next].id}`)?.focus();
  };

  const likeButton = (className: string) => (
    <button type="button" aria-pressed={liked} aria-label={copy.work.like(likes)} onClick={() => toggleLike(work.id)} className={className}>
      <Heart size={18} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
      {likes}
    </button>
  );
  const saveButton = (className: string) => (
    <button type="button" aria-pressed={saved} onClick={() => toggleBookmark(work.id)} className={className}>
      <Bookmark size={18} strokeWidth={1.75} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
      {saved ? copy.work.saved : copy.work.save}
    </button>
  );
  const shareButton = (className: string) => (
    <button type="button" onClick={onShare} className={className}>
      <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />
      {shareMessage || copy.work.share}
    </button>
  );
  /** 状態と版の札 */
  const stateBadges = (className: string) => (
    <>
      <span data-work-state={state} className={`${BADGE} ${className}`}>
        <StateIcon size={12} strokeWidth={2} aria-hidden="true" />
        {copy.account.works.state[state]}
      </span>
      <span className={`${BADGE} ${className}`}>{copy.work.version(work.version)}</span>
    </>
  );
  const panelProps = (id: TabId) => ({
    id: `${tabsId}-panel-${id}`,
    role: 'tabpanel' as const,
    'aria-labelledby': `${tabsId}-tab-${id}`,
    'data-work-panel': id,
    hidden: shownTab !== id,
  });

  return (
    <>
      {/* 頭：@作者 / 題、状態、版、種類。右に今のボタン。数は下に小さく1行（WS003「1」） */}
      <header data-work-head="" className="md:mt-[27px]">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 lg:min-h-9">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <img
              src={creator.avatar_url ?? undefined}
              alt=""
              width={32}
              height={32}
              decoding="async"
              className="size-8 shrink-0 rounded-chip bg-site-field max-md:hidden"
            />
            <a href={localizedPath(locale, `/c/${handle}`)} className="rounded-key text-subhead text-site-fg-3 hover:underline max-md:text-body">
              {copy.work.by(handle)}
            </a>
            <span aria-hidden="true" className="text-subhead text-site-fg-2 max-md:hidden">
              /
            </span>
            {/* 767px以下：1行目に @作者 と札、題は次の行（枠を最初の画面に収めるため、頭を低くする）。
                札は幅ごとに描き分ける（CSS の order で動かさない。HTML の順と見た目の順を同じにする） */}
            {stateBadges('md:hidden')}
            <h1 className="min-w-0 text-title font-bold text-site-fg wrap-anywhere max-md:basis-full">{work.title}</h1>
            {stateBadges('max-md:hidden')}
            {/* 種類の札は、767px以下では数の行に出す（頭を2行に収めて、枠を最初の画面に入れるため） */}
            <span className={`${BADGE} max-md:hidden`}>{copy.work.meta(work.category, work.subtype)}</span>
          </div>
          {/* 持ち主の「新しい版を置く」（1024px以上）。公開の作品では読み込みの後に出るので、出てもほかが動かない、頭の行の右の端に置く */}
          {isOwner && (
            <a href={newVersionPath} data-work-new-version="" className={`${HEAD_BUTTON} border-site-primary bg-site-primary text-site-bg max-lg:hidden`}>
              <Upload size={16} strokeWidth={2} aria-hidden="true" />
              {copy.work.newVersion}
            </a>
          )}
        </div>
      </header>

      {/*
        本体。HTML の順と見た目の順は、どの幅でも同じ：頭 → 動く作品 → ボタン → 数の行 → タブ → タブの中身（キーの Tab と読み上げの順が、見た目の順になる）。
        1024px以上は2列で、左に動く作品、右にボタンから下。1023px以下は1列（WORKSPACE「8」）。CSS の order で見た目だけを動かさない。
        動く作品はタブの外にあり、どのタブでも出したまま（タブを替えても枠を作り直さない）。タブの中身は、選んでいない物を隠すだけ（コードの箱は、いつも HTML にある）
      */}
      <div className="mt-3 grid grid-cols-1 gap-x-8 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <div data-work-stage="" className="min-w-0">
          <FramePreview key={work.id} work={work} background={background} frames={page.private?.frames ?? null} />
          {/* 枠を、HTML が届き終わるのを待たずに読み始める（PERF002「1」）。Worker の HTML でだけ動く（React が後から作った script は動かない） */}
          <script dangerouslySetInnerHTML={PREVIEW_START_CALL} />
        </div>

        <div data-work-side="" className="min-w-0">
          {/* ボタン。1023px以下では枠のすぐ下。浮かせない（作品の枠に重なるため。docs/tasks/FIX-remix-button.md）。「リミックス」を1行目に（スマホでも最初の画面に入れるため） */}
          {!isPrivate && (
            <div data-work-actions="" className="max-lg:mt-3">
              {remixButton(whiteButton, '')}
              <div className="mt-3 flex gap-3">
                {likeButton(whiteButton)}
                {saveButton(whiteButton)}
                {shareButton(whiteButton)}
              </div>
            </div>
          )}
          {/* 持ち主の「新しい版を置く」（1023px以下）。公開の作品では、後から出すと下がずれるので、ここには出さない（設定のタブにある） */}
          {isPrivate && (
            <a href={newVersionPath} className="mt-3 flex h-11 items-center justify-center gap-2 rounded-control bg-site-primary text-body font-semibold text-site-bg lg:hidden">
              <Upload size={18} strokeWidth={2} aria-hidden="true" />
              {copy.work.newVersion}
            </a>
          )}
          <p role="status" className="sr-only">
            {shareMessage}
          </p>

          {/* 数は小さく1行 */}
          <div data-work-counts="" className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-site-fg-3 ${isPrivate ? 'max-lg:mt-4' : 'mt-4'}`}>
            <a href={localizedPath(locale, `/c/${handle}`)} className="rounded-key font-semibold text-site-fg hover:underline">
              {creator.name}
            </a>
            {creator.kind === 'label' && <span className="text-meta text-site-fg-2">{copy.work.label}</span>}
            {creator.x_url && <XLink href={creator.x_url} />}
            <span className={`${BADGE} md:hidden`}>{copy.work.meta(work.category, work.subtype)}</span>
            <span className="flex items-center gap-1">
              <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
              <span aria-hidden="true">{views}</span>
              <span className="sr-only">{copy.work.views(views)}</span>
            </span>
            <span className="flex items-center gap-1">
              <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
              <span aria-hidden="true" data-testid="copy-count">
                {copyCount}
              </span>
              <span className="sr-only">{copy.work.copies(copyCount)}</span>
            </span>
            {!isPrivate && (
              <span className="flex items-center gap-1">
                <Heart size={16} strokeWidth={1.75} aria-hidden="true" />
                <span aria-hidden="true">{likes}</span>
                <span className="sr-only">{copy.work.likes(likes)}</span>
              </span>
            )}
          </div>
          {source && <SourceBand source={source} />}
          {isPrivate && (
            <p data-private-notice="" role="note" className="mt-3 rounded-control bg-site-field px-3 py-2.5 text-small">
              <span className="font-semibold">{copy.work.privateNotice}</span>{' '}
              <a href={localizedPath(locale, '/account/works')} className="underline">
                {copy.work.privateToWorks}
              </a>
            </p>
          )}

          {/* 幅が足りないとき（狭い右の列で、長い言葉のタブ）だけ、列の中で横に送る。縦には送らない（送れる入れ物は、Firefox が Tab で止まるため） */}
          {/* 入りきらないときは、入るまで詰める（hooks/useTabsFit.ts。印を消す → 余白を詰める → 設定を印だけ → 文字を小さく） */}
          <div
            ref={tabsFit.ref}
            role="tablist"
            aria-label={copy.work.tabs.label}
            onKeyDown={onTabKey}
            data-tabs-fit={tabsFit.level}
            className={`mt-3 flex overflow-x-auto overflow-y-hidden border-b border-site-line ${tabsFit.level >= 2 ? '' : 'gap-1'}`}
          >
            {tabs.map(({ id: tabId, label, icon: Icon, count }) => {
              // 設定のタブは、いちばん詰めた段では印だけにする（名前は読み上げに残す）
              const iconOnly = tabId === 'settings' && tabsFit.level >= 3;
              return (
                <button
                  key={tabId}
                  id={`${tabsId}-tab-${tabId}`}
                  type="button"
                  role="tab"
                  aria-selected={shownTab === tabId}
                  aria-controls={`${tabsId}-panel-${tabId}`}
                  tabIndex={shownTab === tabId ? 0 : -1}
                  onClick={() => setTab(tabId)}
                  className={`inline-flex h-11 flex-auto shrink-0 items-center justify-center border-b-2 font-semibold whitespace-nowrap ${tabsFit.level >= 2 ? 'gap-1.5 px-1.5' : 'gap-2 px-2.5'} ${
                    tabsFit.level >= 4 ? 'text-meta' : 'text-body'
                  } ${shownTab === tabId ? 'border-site-fg text-site-fg' : 'border-transparent text-site-fg-2 hover:text-site-fg'}`}
                >
                  {/* 印は、タブの列が広いときだけ（768〜1023px の1列と、1280px以上の右の列）。入りきらなければ消す */}
                  <Icon
                    size={16}
                    strokeWidth={1.75}
                    aria-hidden="true"
                    className={iconOnly ? 'block' : tabsFit.level >= 1 ? 'hidden' : 'hidden md:max-lg:block xl:block'}
                  />
                  {iconOnly ? <span className="sr-only">{label}</span> : label}
                  {count !== undefined && count > 0 && <span className="rounded-chip bg-site-key px-1.5 text-small font-normal text-site-fg-3">{count}</span>}
                </button>
              );
            })}
          </div>

        <div className="mt-4 min-w-0">
          <div {...panelProps('code')}>
            {/* 「コードをコピー」は、コードのタブのいちばん上（いちばん使われる操作で、コピー数もここから出る。最初の画面に入れる） */}
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex h-11 w-full items-center justify-center rounded-control bg-site-primary text-body font-semibold text-site-bg"
            >
              {copyState === 'copied' ? copy.work.copied : copyState === 'failed' ? copy.work.copyFailed : copy.work.copyCode}
            </button>
            <p role="status" className="sr-only">
              {copyState === 'copied' ? copy.work.copied : copyState === 'failed' ? copy.work.copyFailed : ''}
            </p>
            <p className="mt-2 text-meta text-site-fg-2">{copy.work.license}</p>
            {page.about && (
              <div className="mt-4">
                <WorkAbout about={page.about} workId={work.id} />
              </div>
            )}
            {!isPrivate && <ReportIssue workId={work.id} />}

            <pre
              id={codeId}
              ref={codeRef}
              tabIndex={0}
              aria-label={copy.work.codeLabel(work.title)}
              className={`mt-4 max-h-[320px] overflow-auto rounded-control border border-site-line bg-site-field p-3 font-mono text-small wrap-anywhere whitespace-pre-wrap text-site-fg ${
                codeOpen ? '' : COLLAPSED_CODE
              }`}
            >
              {/* この文字が「コピーされるコード」になる（ページの JSON には入れない。lib/codeText.ts の CODE_ATTRIBUTE） */}
              <code data-ld-code="">{snippet}</code>
            </pre>
            <button
              type="button"
              aria-expanded={codeOpen}
              aria-controls={codeId}
              onClick={toggleCode}
              className={`${whiteButton} mt-2 w-full md:hidden`}
            >
              {codeOpen ? copy.work.hideCode : copy.work.showCode}
            </button>
          </div>

          {/* 版：一覧（2つを選ぶと、下に違いと2つの動く作品。持ち主には「この版に戻す」。WS004） */}
          <div {...panelProps('versions')} tabIndex={0}>
            <VersionList work={work} title={work.title || copy.post.untitled} versions={page.versions} state={versions} canRevert={isOwner} />
          </div>

          {/* 系譜：元の作品と、この作品のリミックス（公開のものだけ） */}
          <div {...panelProps('lineage')} tabIndex={0}>
            {source && (
              <section className="mb-5">
                <h2 className="text-small font-semibold text-site-fg-2">{copy.work.lineage.source}</h2>
                <p className="mt-1.5 text-body wrap-anywhere">
                  {'hidden' in source ? (
                    <span className="text-site-fg-2">{copy.work.source.hidden}</span>
                  ) : (
                    <a href={localizedPath(locale, `/p/${encodeURIComponent(source.id)}`)} className="font-semibold text-site-fg underline">
                      {copy.work.source.work(source.title, source.handle)}
                    </a>
                  )}
                </p>
              </section>
            )}
            <section>
              <h2 className="text-small font-semibold text-site-fg-2">{copy.work.lineage.remixes}</h2>
              {page.lineage.remixes.length === 0 ? (
                <p className="mt-1.5 text-body text-site-fg-2">{copy.work.lineage.none}</p>
              ) : (
                <ul data-work-remixes="" className="mt-2 divide-y divide-site-line rounded-card border border-site-line">
                  {page.lineage.remixes.map((remix) => (
                    <li key={remix.id}>
                      <a href={localizedPath(locale, `/p/${encodeURIComponent(remix.id)}`)} className="flex min-h-11 items-center px-4 py-2 text-body font-semibold text-site-fg wrap-anywhere hover:bg-site-hover">
                        {copy.work.source.work(remix.title, remix.handle)}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {page.lineage.count > page.lineage.remixes.length && (
                <p className="mt-2 text-small text-site-fg-2">{copy.work.lineage.more(String(page.lineage.count - page.lineage.remixes.length))}</p>
              )}
            </section>
          </div>

          {/* 設定（持ち主だけ）：今ある操作を、ここへ移した。公開の申請や取り下げは「自分の作品」 */}
          {isOwner && (
            <div {...panelProps('settings')}>
              <p className="text-body text-site-fg-2">{copy.work.settings.note}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a href={localizedPath(locale, '/account/works')} className={`${whiteButton} px-4`}>
                  {copy.work.privateToWorks}
                </a>
                <a href={newVersionPath} className={`${whiteButton} px-4`}>
                  {copy.work.newVersion}
                </a>
              </div>
              {/* 画像を付ける（DOC002「3」）。画像を足した新しい版が今の版になるので、付けたら読み込み直す。自分だけの作品だけ */}
              {page.private && (
                <section className="mt-5">
                  <h2 className="text-small font-semibold text-site-fg-2">{copy.work.settings.thumb}</h2>
                  <button
                    type="button"
                    aria-label={copy.account.works.addThumbLabel(work.title || copy.post.untitled)}
                    onClick={() => setCapturing(true)}
                    className="mt-2 inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover"
                  >
                    {work.thumb_w > 0 ? copy.account.works.changeThumb : copy.account.works.addThumb}
                  </button>
                  {capturing && (
                    <ThumbCapture
                      workId={work.id}
                      title={work.title || copy.post.untitled}
                      frameUrl={page.private.frames.desktop}
                      onClose={() => setCapturing(false)}
                      onDone={() => window.location.reload()}
                    />
                  )}
                </section>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ファイルの木と本文（コードのタブの続き。2列の下に、幅いっぱい）。木がなければ（地図が作れない）出さない */}
      {page.tree && (
        <div data-work-files-panel="" hidden={shownTab !== 'code'}>
          <WorkFiles workId={work.id} version={work.version} tree={page.tree} credit={page.credit} snippet={snippet} file={openFile} onCopied={countCopy} />
        </div>
      )}
      {/* 2つの版の違い（版のタブの続き。幅いっぱい）。版のタブを開いている間だけ作る（2つの版の枠も、そのときだけ動かす） */}
      {shownTab === 'versions' && (
        <VersionCompare
          work={work}
          title={work.title || copy.post.untitled}
          versions={page.versions}
          state={versions}
          frameSize={work.type === 'component' || work.platform === 'mobile' ? 'mobile' : 'desktop'}
        />
      )}

      <WorkList heading={copy.work.moreFrom(handle)} works={more} onSelect={onSelectWork} />
      <WorkList heading={copy.work.moreOthers} works={others} onSelect={onSelectWork} />

      {remixAnchor && (
        <RemixSheet
          workId={work.id}
          snippet={snippet}
          anchor={remixAnchor}
          brief={remixBrief}
          onBriefChange={setRemixBrief}
          onCopied={() => setCopies((count) => count + 1)}
          onClose={() => setRemixAnchor(null)}
        />
      )}
      {wallpaperAnchor && (
        <WallpaperSheet workId={work.id} title={work.title} snippet={snippet} stills={page.stills} anchor={wallpaperAnchor} onClose={() => setWallpaperAnchor(null)} />
      )}
    </>
  );
}

/** 作品のページの下の並び。作品がなければ見出しごと出さない。 */
function WorkList({ heading, works, onSelect }: { heading: string; works: Work[]; onSelect: (work: Work) => void }) {
  if (works.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="mb-5 text-subhead font-semibold text-site-fg">{heading}</h2>
      <Masonry works={works} belowFold onSelect={onSelect} />
      <NoscriptGrid works={works} />
    </section>
  );
}

/**
 * リミックスの元の帯（docs/tasks/T036.md「4」）。元が公開されていれば題と作者と元へのリンク。
 * 公開されていなければ（自分だけ、取り下げ）「元の作品は見られません」だけで、リンクを付けない。
 */
function SourceBand({ source }: { source: NonNullable<Extract<PageData, { kind: 'work' }>['source']> }) {
  const copy = useCopy();
  const locale = useLocale();
  return (
    <p data-remix-source="" className="mt-2 text-small text-site-fg-2 wrap-anywhere">
      {'hidden' in source ? (
        copy.work.source.hidden
      ) : (
        <>
          {copy.work.source.heading}
          <a href={localizedPath(locale, `/p/${encodeURIComponent(source.id)}`)} className="font-semibold text-site-fg underline">
            {copy.work.source.work(source.title, source.handle)}
          </a>
        </>
      )}
    </p>
  );
}
