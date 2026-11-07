import type { ArchiveReason, Status } from '@/lib/types';

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
const ARCHIVE_LABEL: Record<ArchiveReason, [string, string]> = {
  expired: ['Expired', 'The assessment or interview date has passed and nothing new has arrived.'],
  quiet: ['Quiet', 'No news for 60 days.']
};

export default function StatusChip({ status, archived }: { status: Status; archived?: ArchiveReason | null }) {
  const c = STATUS_COLOR[status];
  const chip = (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold"
      style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)` }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {status}
    </span>
  );
  if (!archived) return chip;
  const [label, why] = ARCHIVE_LABEL[archived];
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {chip}
      <span title={`Archived automatically. ${why}`} className="rounded px-1.5 py-0.5 text-[11px] font-medium"
            style={{ color: 'var(--muted)', background: 'var(--panel-2)', border: '1px solid var(--line)' }}>{label}</span>
    </span>
  );
}
