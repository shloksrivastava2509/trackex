import type { Status } from '@/lib/types';

export const STATUS_COLOR: Record<Status, string> = {
  Applied: 'var(--s-applied)',
  'Under Review': 'var(--s-review)',
  Assessment: 'var(--s-assess)',
  Interview: 'var(--s-interview)',
  Offer: 'var(--s-offer)',
  Rejected: 'var(--s-rejected)',
  Withdrawn: 'var(--s-withdrawn)'
};

/** Tinted badge: coloured dot and text on a 12% wash of the status colour. */
export default function StatusChip({ status }: { status: Status }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold"
      style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)` }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {status}
    </span>
  );
}
