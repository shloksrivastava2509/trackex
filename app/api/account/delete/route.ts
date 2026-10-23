import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, schema } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { getAccessToken, revokeToken } from '@/lib/google';
import { deleteCalendar } from '@/lib/calendar';

/**
 * "Disconnect & delete my data": removes the Trackex calendar this app created, revokes
 * Google access, and deletes every row (applications/events cascade from users).
 */
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (user?.refreshTokenEnc) {
    const refresh = decrypt(user.refreshTokenEnc);
    try {
      const token = await getAccessToken(refresh);
      if (user.calendarId) await deleteCalendar(token, user.calendarId);
    } catch {
      // Access already revoked: nothing to clean up on Google's side.
    }
    await revokeToken(refresh);
  }
  await db().delete(schema.users).where(eq(schema.users.id, userId));
  return new Response(null, { status: 204 });
}
