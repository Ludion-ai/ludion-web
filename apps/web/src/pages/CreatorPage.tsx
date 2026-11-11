import { useParams } from 'react-router';
import { Masonry } from '../components/Masonry';
import { NoscriptGrid } from '../components/NoscriptGrid';
import { XLink } from '../components/XLink';
import { useCopy } from '../hooks/useCopy';
import type { PageData } from '../data/pages';
import { usePageData } from '../hooks/usePageData';
import { useResetTitle } from '../hooks/useResetTitle';
import { NotFound } from './NotFound';

const linkClass = 'rounded-key text-body text-site-fg-2 underline hover:text-site-fg';

export function CreatorPage() {
  const page = usePageData();
  const { handle } = useParams();
  // handle は大文字と小文字を区別しない（SPEC.md 7）
  if (page?.kind !== 'creator' || page.creator.handle.toLowerCase() !== handle?.toLowerCase()) return <NotFound />;
  return <CreatorDetail page={page} />;
}

function CreatorDetail({ page }: { page: Extract<PageData, { kind: 'creator' }> }) {
  const copy = useCopy();
  const { creator, totals, works } = page;
  useResetTitle();

  return (
    <>
      <div className="flex items-start gap-4 md:mt-[27px]">
        <img
          src={creator.avatar_url ?? undefined}
          alt=""
          width={64}
          height={64}
          decoding="async"
          className="size-16 shrink-0 rounded-chip bg-site-field"
        />
        <div className="min-w-0">
          <h1 className="text-title font-bold wrap-anywhere text-site-fg">{creator.name}</h1>
          <p className="mt-0.5 text-body text-site-fg-2">{copy.creator.handle(creator.handle)}</p>
          {creator.kind === 'label' && <p className="mt-1 text-body text-site-fg-2">{copy.creator.labelNote}</p>}
          {(creator.x_url || creator.site_url) && (
            <p className="mt-2 flex items-center gap-4">
              {creator.x_url && <XLink href={creator.x_url} />}
              {creator.site_url && (
                <a href={creator.site_url} rel="noopener noreferrer" target="_blank" className={linkClass}>
                  {copy.creator.site}
                </a>
              )}
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-x-[18px] gap-y-1 text-small text-site-fg-3">
            <span>{copy.creator.designs(totals.works)}</span>
            <span>{copy.creator.views(copy.count(totals.views))}</span>
            <span>{copy.creator.copies(copy.count(totals.copies))}</span>
          </p>
        </div>
      </div>

      <div className="mt-8">
        <Masonry works={works} />
        <NoscriptGrid works={works} />
      </div>
    </>
  );
}
