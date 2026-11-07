import { companyKey } from '@/lib/match';
import type { ApplicationView, ArchiveReason, EventView } from '@/lib/types';

const DAY = 86_400_000;

/** How long an application may sit without news before it leaves the Active view. */
export const ARCHIVE_AFTER_DAYS = { scheduled: 7, quiet: 60 } as const;

const SCHEDULED = new Set(['Assessment', 'Interview']);
const EARLY = new Set(['Applied', 'Under Review']);

/**
 * Why an application should be archived, or null if it is still live. Pure and derived on read,
 * so nothing is deleted and an application comes back on its own if a new email arrives.
 *  - expired: an assessment or interview whose date has passed (no upcoming event, no news for a week)
 *  - quiet:   applied or under review with no news for 60 days
 * Offer, Rejected and Withdrawn are already outside Active, so they are never archived here.
 */
export function archiveReason(app: ApplicationView, upcoming: EventView[], now: number): ArchiveReason | null {
  const idle = (now - new Date(app.lastUpdate).getTime()) / DAY;
  if (SCHEDULED.has(app.status)) {
    const key = companyKey(app.company);
    const hasUpcoming = key.length >= 3 && upcoming.some(e => {
      const k = companyKey(e.organization);
      return new Date(e.startsAt).getTime() > now && k.length >= 3 && (k.includes(key) || key.includes(k));
    });
    return !hasUpcoming && idle > ARCHIVE_AFTER_DAYS.scheduled ? 'expired' : null;
  }
  return EARLY.has(app.status) && idle > ARCHIVE_AFTER_DAYS.quiet ? 'quiet' : null;
}

export function markArchived(apps: ApplicationView[], events: EventView[], now = Date.now()): ApplicationView[] {
  return apps.map(a => ({ ...a, archived: archiveReason(a, events, now) }));
}
