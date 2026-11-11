import { useId, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { useCopy } from '../hooks/useCopy';
import { RemixRibbon } from './RemixRibbon';
import { thumbUrl, type Work } from '../data/works';
import { useAccount } from '../hooks/useAccount';
import { thumbRatio } from '../lib/masonry';

const EAGER_THUMBS = 8;

/** 広い画面で、カーソルかフォーカスがカードに来たときだけ出すもの。hover の方は Tailwind が (hover: hover) に限る */
const REVEAL = 'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100';

type WorkCardProps = {
  work: Work;
  index: number;
  style?: CSSProperties;
  pageLoaded: boolean;
  belowFold?: boolean;
  onSelect?: (work: Work) => void;
};

/**
 * カードは絵だけ（SPEC.md 3）。題名と作者はリンクの中に持ち、スマホでは読み上げだけに残す。
 * 保存のボタンはリンクの外に置く（リンクの中にボタンを入れない）。スマホでは出さない。
 */
export function WorkCard({ work, index, style, pageLoaded, belowFold = false, onSelect }: WorkCardProps) {
  const copy = useCopy();
  const titleId = useId();
  const { isBookmarked, toggleBookmark } = useAccount();
  const saved = isBookmarked(work.id);
  const eager = !belowFold && index < EAGER_THUMBS;

  return (
    <article aria-labelledby={titleId} style={style} className="group absolute">
      {/* 作品のページは Worker が描くので、読み込み直して開く（reloadDocument） */}
      <Link to={`/p/${work.id}`} reloadDocument onClick={() => onSelect?.(work)} className="relative block overflow-hidden rounded-card">
        <img
          // lazy でも Chrome は画面の遠くまで先読みし、LCP の画像や JS と回線を取り合う。
          // 先頭8枚の読み込みが終わるまでは、残りの src を付けない（SPEC.md 10）。
          // Worker の描画で測り直しても要る（T005：Lighthouse mobile の LCP は、あり 2.4秒、なし 3.4秒）。
          src={eager || pageLoaded ? thumbUrl(work) : undefined}
          alt=""
          width={work.thumb_w}
          height={work.thumb_h}
          loading={eager ? 'eager' : 'lazy'}
          fetchPriority={eager && index === 0 ? 'high' : undefined}
          decoding="async"
          style={{ aspectRatio: `1 / ${thumbRatio(work)}` }}
          className="block w-full bg-site-field object-cover object-top"
        />
        <RemixRibbon show={work.remix} />
        <div className={`card-scrim absolute inset-x-0 bottom-0 h-28 max-md:hidden ${REVEAL}`} />
        <div className={`absolute inset-x-0 bottom-0 px-3 pb-3 text-site-bg max-md:sr-only dark:text-site-fg ${REVEAL}`}>
          <h2 id={titleId} className="truncate text-body font-semibold">
            {work.title}
          </h2>
          <p className="truncate text-small">{copy.card.author(work.creator.handle)}</p>
        </div>
      </Link>

      {/* 触る画面ではカーソルが乗らず、見えないボタンを押してしまうので、押せないようにする */}
      <button
        type="button"
        aria-pressed={saved}
        aria-label={copy.card.saveLabel(work.title)}
        onClick={() => toggleBookmark(work.id)}
        className={`absolute top-2 right-2 inline-flex h-9 items-center rounded-chip px-3.5 text-small font-semibold max-md:hidden [@media(hover:none)]:pointer-events-none ${REVEAL} ${
          saved ? 'bg-site-bg text-site-fg' : 'bg-site-primary text-site-bg'
        }`}
      >
        {saved ? copy.card.saved : copy.card.save}
      </button>
    </article>
  );
}
