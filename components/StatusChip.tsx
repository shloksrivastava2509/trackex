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

export default function StatusChip({ status }: { status: Status }) {
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
      style={{ background: STATUS_COLOR[status] }}
    >
      {status}
    </span>
  );
}
