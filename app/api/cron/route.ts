import { timingSafeEqual } from 'node:crypto';
import { asc, isNull, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { summarize, syncUser } from '@/lib/sync';

// Called every 15 minutes by .github/workflows/sync.yml (Vercel's free plan only allows
// daily cron jobs). Syncs users longest-waiting first until the time budget is spent.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const BUDGET_MS = 250_000;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  const deadline = Date.now() + BUDGET_MS;
  const users = await db().select({ id: schema.users.id }).from(schema.users)
    // Users who must sign in again are skipped until they do.
    .where(or(isNull(schema.users.syncError), ne(schema.users.syncError, 'reauth')))
    .orderBy(sql`${schema.users.lastSyncAt} asc nulls first`, asc(schema.users.createdAt));

  const results: { user: string; summary: string }[] = [];
  for (const u of users) {
    if (Date.now() > deadline - 20_000) break; // leave room to finish the current user cleanly
    const r = await syncUser(u.id, deadline);
    results.push({ user: u.id.slice(-6), summary: summarize(r) });
  }
  return Response.json({ synced: results.length, of: users.length, results });
}
