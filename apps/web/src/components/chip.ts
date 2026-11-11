/** チップの形（SPEC.md 3）。ホームの絞り込みと、作品のページのデスクトップ／モバイルで同じものを使う。 */
export function chipClass(selected: boolean): string {
  return `inline-flex h-chip shrink-0 items-center gap-2 rounded-chip px-3.5 text-body font-semibold ${
    selected ? 'bg-site-primary text-site-bg' : 'text-site-fg hover:bg-site-hover'
  }`;
}
