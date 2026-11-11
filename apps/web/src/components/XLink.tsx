import { ArrowUpRight } from 'lucide-react';
import { useCopy } from '../hooks/useCopy';

/** 作者の X へのリンク。ロゴと矢印で、別のタブへ飛ぶと分かるようにする（SPEC.md「情報」）。 */
export function XLink({ href }: { href: string }) {
  const copy = useCopy();
  return (
    <a
      href={href}
      rel="noopener noreferrer"
      target="_blank"
      aria-label={copy.creator.x}
      title={copy.creator.x}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-chip border border-site-line-2 px-2.5 text-site-fg hover:bg-site-hover"
    >
      {/* X のロゴ。lucide にないので、ヘッダーのロゴと同じように SVG を直接書く */}
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" className="shrink-0">
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </svg>
      <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
    </a>
  );
}
