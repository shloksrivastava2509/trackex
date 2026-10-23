import { and, asc, desc, eq, gt } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { claudeEnabled } from '@/lib/extract/claude';
import type { DashboardData, EventKind, PortalKind, Status } from '@/lib/types';

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  const empty: DashboardData = {
    user: null, applications: [], events: [], lastSyncAt: null, syncError: null, backfilling: false, claude: claudeEnabled()
  };
  if (!user) return empty;

  const [apps, evs] = await Promise.all([
    db().select().from(schema.applications).where(eq(schema.applications.userId, userId))
      .orderBy(desc(schema.applications.lastUpdate)),
    db().select().from(schema.events)
      .where(and(eq(schema.events.userId, userId), gt(schema.events.startsAt, new Date(Date.now() - 24 * 3600 * 1000))))
      .orderBy(asc(schema.events.startsAt)).limit(50)
  ]);

  return {
    user: { name: user.name, email: user.email, image: user.image },
    applications: apps.map(a => ({
      id: a.id, company: a.company, role: a.role, type: a.type, status: a.status as Status,
      appliedOn: a.appliedOn.toISOString(), lastUpdate: a.lastUpdate.toISOString(),
      portalUrl: a.portalUrl, portalKind: a.portalKind as PortalKind, emailLink: a.emailLink,
      lastSubject: a.lastSubject, notes: a.notes
    })),
    events: evs.map(e => ({
      id: e.id, title: e.title, organization: e.organization, kind: e.kind as EventKind,
      startsAt: e.startsAt.toISOString(), allDay: e.allDay, link: e.link, emailLink: e.emailLink,
      calendarLink: e.calendarLink
    })),
    lastSyncAt: user.lastSyncAt?.toISOString() ?? null,
    syncError: user.syncError,
    backfilling: !user.backfillDone,
    claude: claudeEnabled()
  };
}
