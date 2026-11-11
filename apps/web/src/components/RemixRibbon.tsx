import { useCopy } from '../hooks/useCopy';

/** メルカリの SOLD の帯と同じ位置の、青い「Remix」。影は付けない（SPEC.md 3）。 */
export function RemixRibbon({ show }: { show: boolean }) {
  const copy = useCopy();
  if (!show) return null;
  return <span className="remix-ribbon">{copy.card.remix}</span>;
}
