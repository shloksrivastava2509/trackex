import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, schema } from '@/lib/db';

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const { timeZone } = (await req.json().catch(() => ({}))) as { timeZone?: unknown };
  if (typeof timeZone !== 'string' || !isValidZone(timeZone)) return new Response('Invalid time zone', { status: 400 });
  await db().update(schema.users).set({ timeZone }).where(eq(schema.users.id, userId));
  return new Response(null, { status: 204 });
}

function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
