import { googleFetch, GoogleApiError } from '@/lib/google';
import { companyKey } from '@/lib/match';
import type { EventKind, ExtractedEvent } from '@/lib/types';

const API = 'https://www.googleapis.com/calendar/v3';

/** Popup reminders on timed events: 1 day before and 1 hour before. */
export const TIMED_REMINDERS_MIN = [24 * 60, 60];
/** All-day events start at midnight, so "an hour before" would fire at 11 PM: use 9 AM and 6 PM the day before. */
export const ALL_DAY_REMINDERS_MIN = [15 * 60, 6 * 60];

const KIND_PREFIX: Record<EventKind, string> = {
  registration_deadline: '⏰ Register',
  submission_deadline: '⏰ Submit',
  application_deadline: '⏰ Apply',
  assessment_due: '📝 Assessment due',
  interview: '🎤 Interview',
  event_start: '🏁 Starts',
  event_end: '🏁 Ends',
  other: '📌'
};
const DEADLINE_KINDS: EventKind[] = ['registration_deadline', 'submission_deadline', 'application_deadline', 'assessment_due'];

// ---------- time zone helpers (no date library: Intl does the zone math) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

type When =
  | { kind: 'date'; date: string } // all-day
  | { kind: 'local'; local: string }; // wall-clock time in the user's zone, "YYYY-MM-DDTHH:mm:ss"

/** Wall-clock "YYYY-MM-DDTHH:mm:ss" of an instant in `tz`. */
export function instantToLocal(d: Date, tz: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(d).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** The instant at which the wall clock in `tz` shows `local` (DST-safe to within the usual gap/overlap). */
export function localToInstant(local: string, tz: string): Date {
  const asUtc = Date.parse(local + 'Z');
  const offsetAt = (t: number) => Date.parse(instantToLocal(new Date(t), tz) + 'Z') - t;
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t); // second pass corrects across a DST change
  return new Date(t);
}

function addMinutesLocal(local: string, minutes: number): string {
  return new Date(Date.parse(local + 'Z') + minutes * 60_000).toISOString().slice(0, 19);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

/** Parses an extracted time. Times with an offset are converted to the user's wall clock. */
export function parseWhen(s: string, allDay: boolean, tz: string): When | null {
  const v = (s || '').trim();
  if (!v) return null;
  if (DATE_RE.test(v)) return { kind: 'date', date: v };
  const naive = v.match(NAIVE_RE);
  if (naive) {
    if (allDay) return { kind: 'date', date: naive[1] };
    return { kind: 'local', local: `${naive[1]}T${naive[2]}:${naive[3]}:${naive[4] ?? '00'}` };
  }
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const local = instantToLocal(new Date(t), tz);
  return allDay ? { kind: 'date', date: local.slice(0, 10) } : { kind: 'local', local };
}

// ---------- event building (pure) ----------

export interface BuiltEvent {
  resource: Record<string, unknown>;
  /** The moment that matters: the deadline itself, or the event start. */
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  dedupKey: string;
}

export function buildEvent(ev: ExtractedEvent, tz: string, source: { emailLink: string; subject: string }): BuiltEvent | null {
  const start = parseWhen(ev.start_iso, ev.all_day, tz);
  if (!start || !ev.title) return null;
  const end = ev.end_iso ? parseWhen(ev.end_iso, start.kind === 'date', tz) : null;

  const description = [
    ev.url && `Link: ${ev.url}`,
    `Source email: ${source.emailLink}`,
    `Subject: ${source.subject}`,
    '',
    'Added by Trackex — https://github.com/shloksrivastava2509/trackex'
  ].filter(x => x !== '' && x !== undefined && x !== null).join('\n');

  const base = {
    summary: `${KIND_PREFIX[ev.kind] ?? '📌'}: ${ev.title}`,
    description,
    source: { title: 'Trackex', url: source.emailLink }
  };
  const reminders = (mins: number[]) => ({
    useDefault: false,
    overrides: mins.map(minutes => ({ method: 'popup', minutes }))
  });
  const org = companyKey(ev.organization) || companyKey(ev.title);

  if (start.kind === 'date') {
    const endDate = end?.kind === 'date' && end.date >= start.date ? addDays(end.date, 1) : addDays(start.date, 1);
    return {
      resource: { ...base, start: { date: start.date }, end: { date: endDate }, reminders: reminders(ALL_DAY_REMINDERS_MIN) },
      startsAt: localToInstant(`${start.date}T00:00:00`, tz),
      endsAt: null,
      allDay: true,
      dedupKey: `${org}|${ev.kind}|${start.date}`
    };
  }

  let from = start.local;
  let to: string;
  if (DEADLINE_KINDS.includes(ev.kind)) {
    // A deadline is a moment: show it as the 30 minutes leading up to it.
    to = start.local;
    from = addMinutesLocal(start.local, -30);
  } else {
    to = end?.kind === 'local' && end.local > start.local ? end.local : addMinutesLocal(start.local, 60);
  }
  return {
    resource: {
      ...base,
      start: { dateTime: from, timeZone: tz },
      end: { dateTime: to, timeZone: tz },
      reminders: reminders(TIMED_REMINDERS_MIN)
    },
    startsAt: localToInstant(start.local, tz),
    endsAt: DEADLINE_KINDS.includes(ev.kind) ? null : localToInstant(to, tz),
    allDay: false,
    dedupKey: `${org}|${ev.kind}|${start.local.slice(0, 10)}`
  };
}

// ---------- Google Calendar calls ----------

/**
 * Returns the id of the user's "Trackex" calendar, creating it if needed. With the
 * calendar.app.created scope this app can only see and change calendars it created.
 */
export async function ensureCalendar(token: string, existingId: string | null, tz: string): Promise<string> {
  if (existingId) {
    try {
      await googleFetch(token, `${API}/calendars/${encodeURIComponent(existingId)}`);
      return existingId;
    } catch (e) {
      if (!(e instanceof GoogleApiError) || ![403, 404, 410].includes(e.status)) throw e;
      // Deleted by the user: make a new one.
    }
  }
  const cal = await googleFetch<{ id: string }>(token, `${API}/calendars`, {
    method: 'POST',
    body: JSON.stringify({
      summary: 'Trackex',
      description: 'Interviews, assessments and deadlines found in your email by Trackex.',
      timeZone: tz
    })
  });
  return cal.id;
}

export async function insertEvent(token: string, calendarId: string, resource: Record<string, unknown>) {
  return googleFetch<{ id: string; htmlLink: string }>(token, `${API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify(resource)
  });
}

export async function deleteCalendar(token: string, calendarId: string): Promise<void> {
  await googleFetch(token, `${API}/calendars/${encodeURIComponent(calendarId)}`, { method: 'DELETE' }).catch(() => {});
}
