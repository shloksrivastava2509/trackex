import type { Metadata } from 'next';
import DashboardView from '@/components/DashboardView';
import { demoData } from '@/lib/demo';

export const metadata: Metadata = { title: 'Trackex demo' };
export const dynamic = 'force-dynamic';

export default function DemoPage() {
  return <DashboardView data={demoData()} mode="demo" />;
}
