import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getAccessToken, GoogleAuthError } from '@/lib/google';
import { backfillQuery, getMessages, incrementalQuery, listMessageIds } from '@/lib/gmail';
import { buildEvent, ensureCalendar, insertEvent } from '@/lib/calendar';
import { extractWithClaude } from '@/lib/extract/claude';
import { extractWithHeuristics } from '@/lib/extract/heuristics';
import { refinePortal } from '@/lib/extract/refine';
import { mergeDuplicateApplications, upsertApplication } from '@/lib/match';
import type { ApplicationDraft, ApplicationKind, Email, Extraction, PortalKind, Status } from '@/lib/types';

export const BACKFILL_DAYS = 180;
const BATCH = 8; // emails extracted concurrently
const OVERLAP_MS = 60 * 60 * 1000; // re-list the last hour each run; processed ids are skipped

export interface SyncResult {
  processed: number;
  newApps: number;
  newEvents: number;
  merged: number;
  /** false when the time budget ran out; the next run continues where this one stopped. */
  complete: boolean;
  /** Another run (cron or "Sync now") was already syncing this user. */
  busy?: boolean;
  error?: string;
}

export function summarize(r: SyncResult): string {
  if (r.busy) return 'A sync is already running — results will appear shortly.';
  if (r.error === 'reauth') return 'Google access expired — please sign in again.';
  if (r.error) return `Sync failed: ${r.error}`;
  const parts = [`Read ${r.processed} new email(s)`, `+${r.newApps} application(s)`, `+${r.newEvents} calendar event(s)`];
  if (r.merged) parts.push(`merged ${r.merged} duplicate(s)`);
  return parts.join(' · ') + (r.complete ? '' : ' — more to read, continuing automatically');
}

/**
 * One user's sync: new mail first (incremental), then — until finished — the first-run
 * backfill of the last 180 days, one Gmail page at a time. Stops cleanly at `deadline`
 * (epoch ms) and resumes on the next run; message ids already processed are never
 * re-extracted, so overlapping windows cost nothing.
 */
export async function syncUser(userId: string, deadline: number): Promise<SyncResult> {
  const result: SyncResult = { processed: 0, newApps: 0, newEvents: 0, merged: 0, complete: true };
  // Atomic lease: only one run per user at a time. It expires on its own if a run crashes.
  const lease = new Date(Math.max(deadline, Date.now()) + 60_000);
  const [user] = await db().update(schema.users).set({ syncLockUntil: lease })
    .where(and(eq(schema.users.id, userId),
      or(isNull(schema.users.syncLockUntil), lt(schema.users.syncLockUntil, new Date()))))
    .returning();
  if (!user) return { ...result, complete: false, busy: true };
  if (!user.refreshTokenEnc) {
    await releaseLock(userId);
    return { ...result, error: 'reauth' };
  }

  try {
    const token = await getAccessToken(decrypt(user.refreshTokenEnc));
    const tz = user.timeZone || 'UTC';
    const runStarted = new Date();
    const rows = await loadApplications(userId);
    const appsBefore = rows.length;
    const eventKeys = new Set(
      (await db().select({ k: schema.events.dedupKey }).from(schema.events).where(eq(schema.events.userId, userId))).map(r => r.k)
    );

    let calendarId: string | null = null;
    const calendar = async () => (calendarId ??= await ensureCalendar(token, user.calendarId, tz));

    const handle = async (email: Email, data: Extraction) => {
      if (data.category === 'job_application' && data.application.company) {
        upsertApplication(rows, data.application, { date: email.date, subject: email.subject, emailLink: email.emailLink }, randomUUID);
      }
      for (const ev of data.events) {
        const built = buildEvent(ev, tz, email);
        if (!built || eventKeys.has(built.dedupKey)) continue;
        eventKeys.add(built.dedupKey);
        let added: { id: string; htmlLink: string } | null = null;
        // Past items are recorded for the dashboard but not added to the calendar.
        if (built.startsAt.getTime() > Date.now() - 24 * 3600 * 1000) {
          added = await insertEvent(token, await calendar(), built.resource).catch(e => {
            if (e instanceof GoogleAuthError) throw e;
            console.error(`Calendar insert failed for "${ev.title}":`, e);
            return null;
          });
          if (added) result.newEvents++;
        }
        await db().insert(schema.events).values({
          userId, dedupKey: built.dedupKey, title: ev.title, organization: ev.organization, kind: ev.kind,
          startsAt: built.startsAt, endsAt: built.endsAt, allDay: built.allDay, link: ev.url,
          emailLink: email.emailLink, calendarEventId: added?.id ?? null, calendarLink: added?.htmlLink ?? ''
        }).onConflictDoNothing();
      }
    };

    /** Extracts every not-yet-processed id; false if the deadline stopped it part-way. */
    const processIds = async (ids: string[]): Promise<boolean> => {
      const todo = await unprocessed(userId, ids);
      for (let i = 0; i < todo.length; i += BATCH) {
        if (Date.now() > deadline) return false;
        const chunk = todo.slice(i, i + BATCH);
        const emails = await getMessages(token, chunk, user.email);
        const extracted = await Promise.all(emails.map(async e =>
          refinePortal((await extractWithClaude(e, tz)) ?? extractWithHeuristics(e), e)));
        for (let k = 0; k < emails.length; k++) await handle(emails[k], extracted[k]);
        await saveApplications(userId, rows);
        await db().insert(schema.processedMessages).values(chunk.map(messageId => ({ userId, messageId }))).onConflictDoNothing();
        result.processed += chunk.length;
      }
      return true;
    };

    // 1. New mail since the last run (skipped on the very first run: the backfill covers it).
    let incrementalDone = true;
    if (user.syncedThrough) {
      const q = incrementalQuery(new Date(user.syncedThrough.getTime() - OVERLAP_MS));
      let pageToken: string | null = null;
      do {
        const page = await listMessageIds(token, q, pageToken);
        if (!(await processIds(page.ids))) { incrementalDone = false; break; }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    // 2. First-run backfill, newest first, resumable through the saved page token.
    let backfillDone = user.backfillDone;
    let pageToken = user.backfillPageToken;
    while (!backfillDone && incrementalDone && Date.now() < deadline) {
      const page = await listMessageIds(token, backfillQuery(BACKFILL_DAYS), pageToken);
      if (!(await processIds(page.ids))) break; // same page next run; done ids are skipped
      pageToken = page.nextPageToken;
      backfillDone = !pageToken;
    }

    const removed = mergeDuplicateApplications(rows);
    result.merged = removed.length;
    if (removed.length) await db().delete(schema.applications).where(inArray(schema.applications.id, removed.map(r => r.id)));
    await saveApplications(userId, rows);
    result.newApps = rows.length - appsBefore;
    result.complete = incrementalDone && backfillDone;

    await db().update(schema.users).set({
      calendarId: calendarId ?? user.calendarId,
      backfillDone,
      backfillPageToken: backfillDone ? null : pageToken,
      syncedThrough: incrementalDone ? runStarted : (user.syncedThrough ?? runStarted),
      lastSyncAt: new Date(),
      syncError: null,
      syncLockUntil: null
    }).where(eq(schema.users.id, userId));
    return result;
  } catch (e) {
    const reauth = e instanceof GoogleAuthError;
    const message = reauth ? 'reauth' : e instanceof Error ? e.message.slice(0, 300) : String(e);
    if (!reauth) console.error(`Sync failed for user ${userId}:`, e);
    await db().update(schema.users).set({ syncError: message, lastSyncAt: new Date(), syncLockUntil: null })
      .where(eq(schema.users.id, userId));
    return { ...result, complete: false, error: message };
  }
}

async function releaseLock(userId: string): Promise<void> {
  await db().update(schema.users).set({ syncLockUntil: null }).where(eq(schema.users.id, userId));
}

async function unprocessed(userId: string, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const done = await db().select({ id: schema.processedMessages.messageId }).from(schema.processedMessages)
    .where(and(eq(schema.processedMessages.userId, userId), inArray(schema.processedMessages.messageId, ids)));
  const seen = new Set(done.map(d => d.id));
  return ids.filter(id => !seen.has(id));
}

async function loadApplications(userId: string): Promise<ApplicationDraft[]> {
  const found = await db().select().from(schema.applications).where(eq(schema.applications.userId, userId));
  return found.map(r => ({
    id: r.id, company: r.company, role: r.role, type: r.type as ApplicationKind, status: r.status as Status,
    appliedOn: r.appliedOn, lastUpdate: r.lastUpdate, portalUrl: r.portalUrl, portalKind: r.portalKind as PortalKind,
    emailLink: r.emailLink, lastSubject: r.lastSubject, notes: r.notes
  }));
}

/** Upserts every row the matcher marked dirty in one statement, then clears the flags. */
async function saveApplications(userId: string, rows: ApplicationDraft[]): Promise<void> {
  const dirty = rows.filter(r => r.dirty);
  if (!dirty.length) return;
  const t = schema.applications;
  await db().insert(t).values(dirty.map(r => ({
    id: r.id, userId, company: r.company, role: r.role, type: r.type, status: r.status,
    appliedOn: r.appliedOn, lastUpdate: r.lastUpdate, portalUrl: r.portalUrl, portalKind: r.portalKind,
    emailLink: r.emailLink, lastSubject: r.lastSubject, notes: r.notes
  }))).onConflictDoUpdate({
    target: t.id,
    set: Object.fromEntries(
      (['company', 'role', 'type', 'status', 'applied_on', 'last_update', 'portal_url', 'portal_kind', 'email_link', 'last_subject', 'notes'] as const)
        .map(col => [toCamel(col), sql.raw(`excluded.${col}`)])
    )
  });
  for (const r of dirty) { r.dirty = false; r.isNew = false; }
}

function toCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
