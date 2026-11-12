import { Bookmark, Code, Copy, Eye, GitFork, Heart, Monitor, Share2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { useParams } from 'react-router';
import { FramePreview } from '../components/FramePreview';
import { Masonry } from '../components/Masonry';
import { NoscriptGrid } from '../components/NoscriptGrid';
import { RemixSheet } from '../components/RemixSheet';
import { ThumbCapture } from '../components/ThumbCapture';
import { WallpaperSheet } from '../components/WallpaperSheet';
import { ReportIssue } from '../components/ReportIssue';
import { XLink } from '../components/XLink';
import { useCopy, useLocale } from '../hooks/useCopy';
import { localizedPath } from '../i18n';
import type { PageData } from '../data/pages';
import type { Work } from '../data/works';
import { useAccount } from '../hooks/useAccount';
import { usePageData } from '../hooks/usePageData';
import { useResetTitle } from '../hooks/useResetTitle';
import { trackEvent } from '../lib/analytics';
import { COPIED_MS, postCount } from '../lib/count';
import { embedSnippet } from '../lib/embed';
import { isWallpaper } from '../lib/homeQuery';
import { NotFound } from './NotFound';

/** 共有する URL はいつも本番のもの（workers.dev や手元で開いていても）。 */
const SHARE_ORIGIN = 'https://ludion.ai';

/** 幅767px以下で、たたんだコードの箱：3行（16px × 3）＋上下の余白（12px × 2）＋枠（1px × 2）。text-small の行の高さに合わせる */
const COLLAPSED_CODE = 'max-md:max-h-[74px] max-md:overflow-hidden';

/** 枠の入れ物の直後で、枠を読み始める（関数は #root より前の src/previewStart.ts が置く）。Worker の HTML とブラウザで同じ文字列にする */
const PREVIEW_START_CALL = { __html: 'window.__ldStartPreview&&window.__ldStartPreview()' };

const whiteButton =
  'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-control border border-site-line-2 bg-site-bg text-body font-semibold text-site-fg hover:bg-site-hover';

export function WorkPage() {
  const page = usePageData();
  const { id } = useParams();
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
  // 埋め込む（EMBED001「4」）。押すと1行の <iframe> が出て、コピーできる
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedState, setEmbedState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const embedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const embedRef = useRef<HTMLInputElement>(null);
  const embedId = useId();
  const embedCode = embedSnippet(work, handle);
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
      clearTimeout(embedTimer.current);
    },
    [],
  );

  const showCopyState = (state: 'copied' | 'failed') => {
    setCopyState(state);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState('idle'), COPIED_MS);
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
    if (isPrivate) return;
    setCopies((count) => count + 1);
    postCount(work.id, 'copy');
    trackEvent('copy_code', { work_id: work.id });
  };

  const onCopyEmbed = async () => {
    let state: 'copied' | 'failed' = 'copied';
    try {
      await navigator.clipboard.writeText(embedCode);
    } catch {
      // クリップボードが使えないときは、手で写せるように1行を選んでおく
      embedRef.current?.select();
      state = 'failed';
    }
    setEmbedState(state);
    // 押してコピーできた回数（日ごと。EMBED001「6」）。コピー数とは別の数で、画面のコピー数は増やさない
    if (state === 'copied') postCount(work.id, 'embed_copy');
    clearTimeout(embedTimer.current);
    embedTimer.current = setTimeout(() => setEmbedState('idle'), COPIED_MS);
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
  // 壁紙の作品だけ、「リミックス」の横に「壁紙にする」を置く（WALL001「2」）
  const remixButton = (className: string) =>
    wallpaper ? (
      <div className={`flex gap-3 ${className}`}>
        <button type="button" aria-haspopup="dialog" onClick={openRemix} className={whiteButton}>
          <GitFork size={18} strokeWidth={1.75} aria-hidden="true" />
          {copy.work.remix.open}
        </button>
        <button type="button" aria-haspopup="dialog" onClick={(event) => setWallpaperAnchor(event.currentTarget)} className={whiteButton}>
          <Monitor size={18} strokeWidth={1.75} aria-hidden="true" />
          {copy.work.wallpaper.open}
        </button>
      </div>
    ) : (
      <button type="button" aria-haspopup="dialog" onClick={openRemix} className={`${whiteButton} w-full ${className}`}>
        <GitFork size={18} strokeWidth={1.75} aria-hidden="true" />
        {copy.work.remix.open}
      </button>
    );

  const views = copy.count(work.views);
  const copyCount = copy.count(copies);
  const likes = copy.count(work.likes + likeDelta(work.id));
  const shareMessage = shareState === 'copied' ? copy.work.linkCopied : shareState === 'failed' ? copy.work.copyFailed : '';

  return (
    <>
      <div className="grid grid-cols-1 gap-8 md:mt-[27px] lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
        <div className="min-w-0">
          <FramePreview key={work.id} work={work} background={background} frames={page.private?.frames ?? null} />
          {/* 枠を、HTML が届き終わるのを待たずに読み始める（PERF002「1」）。Worker の HTML でだけ動く（React が後から作った script は動かない） */}
          <script dangerouslySetInnerHTML={PREVIEW_START_CALL} />
          {/* 1023px以下：「コードをコピー」は最初の画面の外なので、プレビューのすぐ下に置く。浮かせない（作品の枠に重なるため。docs/tasks/FIX-remix-button.md） */}
          {!isPrivate && remixButton('mt-3 lg:hidden')}
        </div>

        <div className="min-w-0">
          {isPrivate && (
            <div data-private-notice="" role="note" className="mb-4 rounded-control bg-site-field px-3 py-2.5">
              <p className="font-semibold">{copy.work.privateNotice}</p>
              <a href={localizedPath(locale, '/account/works')} className="mt-0.5 inline-block text-small underline">
                {copy.work.privateToWorks}
              </a>
              {/* 画像を付ける（DOC002「3」）。画像を足した新しい版が今の版になるので、付けたら読み込み直す */}
              <div className="mt-2">
                <button
                  type="button"
                  aria-label={copy.account.works.addThumbLabel(work.title || copy.post.untitled)}
                  onClick={() => setCapturing(true)}
                  className="inline-flex h-11 items-center justify-center rounded-control border border-site-line-2 bg-site-bg px-4 text-body font-semibold text-site-fg hover:bg-site-hover"
                >
                  {work.thumb_w > 0 ? copy.account.works.changeThumb : copy.account.works.addThumb}
                </button>
              </div>
              {capturing && page.private && (
                <ThumbCapture
                  workId={work.id}
                  title={work.title || copy.post.untitled}
                  frameUrl={page.private.frames.desktop}
                  onClose={() => setCapturing(false)}
                  onDone={() => window.location.reload()}
                />
              )}
            </div>
          )}
          <h1 className="text-title font-bold text-site-fg">{work.title}</h1>
          <p className="mt-1 text-body text-site-fg-2">{copy.work.meta(work.category, work.subtype)}</p>
          {source && <SourceBand source={source} />}

          <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <img
              src={creator.avatar_url ?? undefined}
              alt=""
              width={32}
              height={32}
              decoding="async"
              className="size-8 shrink-0 rounded-chip bg-site-field"
            />
            <a href={localizedPath(locale, `/c/${handle}`)} className="rounded-key text-body font-semibold text-site-fg hover:underline">
              {creator.name}
            </a>
            {creator.kind === 'label' && <span className="text-meta text-site-fg-2">{copy.work.label}</span>}
            {creator.x_url && <XLink href={creator.x_url} />}
          </div>

          <p className="mt-4 flex items-center gap-[18px] text-small text-site-fg-3">
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
          </p>

          {!isPrivate && (
            <>
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  aria-pressed={liked}
                  aria-label={copy.work.like(likes)}
                  onClick={() => toggleLike(work.id)}
                  className={whiteButton}
                >
                  <Heart size={18} strokeWidth={1.75} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
                  {likes}
                </button>
                <button type="button" aria-pressed={saved} onClick={() => toggleBookmark(work.id)} className={whiteButton}>
                  <Bookmark size={18} strokeWidth={1.75} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
                  {saved ? copy.work.saved : copy.work.save}
                </button>
              </div>

              <button type="button" onClick={onShare} className={`${whiteButton} mt-3 w-full`}>
                <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />
                {shareMessage || copy.work.share}
              </button>
              <p role="status" className="sr-only">
                {shareMessage}
              </p>

              {remixButton('mt-3 max-lg:hidden')}
            </>
          )}

          <button
            type="button"
            onClick={onCopy}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-control bg-site-primary text-body font-semibold text-site-bg"
          >
            {copyState === 'copied' ? copy.work.copied : copyState === 'failed' ? copy.work.copyFailed : copy.work.copyCode}
          </button>
          <p role="status" className="sr-only">
            {copyState === 'copied' ? copy.work.copied : copyState === 'failed' ? copy.work.copyFailed : ''}
          </p>
          {/* 「コードをコピー」の次（EMBED001「4」）。自分だけの作品は外に出せない（/e/<id> も 404）ので出さない */}
          {!isPrivate && (
            <>
              <button
                type="button"
                aria-expanded={embedOpen}
                aria-controls={embedId}
                onClick={() => setEmbedOpen((open) => !open)}
                className={`${whiteButton} mt-3 w-full`}
              >
                <Code size={18} strokeWidth={1.75} aria-hidden="true" />
                {copy.work.embed.open}
              </button>
              <div id={embedId} data-embed="" hidden={!embedOpen} className="mt-2">
                <input
                  ref={embedRef}
                  type="text"
                  readOnly
                  value={embedCode}
                  aria-label={copy.work.embed.codeLabel(work.title)}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-11 w-full rounded-control border border-site-line bg-site-field px-3 font-mono text-small text-site-fg"
                />
                <button type="button" onClick={onCopyEmbed} className={`${whiteButton} mt-2 w-full`}>
                  {embedState === 'copied' ? copy.work.copied : embedState === 'failed' ? copy.work.copyFailed : copy.work.embed.copy}
                </button>
                <p role="status" className="sr-only">
                  {embedState === 'copied' ? copy.work.copied : embedState === 'failed' ? copy.work.copyFailed : ''}
                </p>
              </div>
            </>
          )}
          <p className="mt-2 text-meta text-site-fg-2">{copy.work.license}</p>
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
      </div>

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
