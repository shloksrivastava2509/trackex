import { auth } from '@/auth';
import { getDashboardData } from '@/lib/data';
import { summarize, syncUser } from '@/lib/sync';

// "Sync now" from the dashboard: one user, a shorter budget so the request stays snappy.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return new Response('Unauthorized', { status: 401 });
  const result = await syncUser(userId, Date.now() + 45_000);
  return Response.json({ summary: summarize(result), data: await getDashboardData(userId) });
}
