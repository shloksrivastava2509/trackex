import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getDashboardData } from '@/lib/data';
import DashboardView from '@/components/DashboardView';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect('/');
  const data = await getDashboardData(id);
  return <DashboardView data={data} mode="live" />;
}
