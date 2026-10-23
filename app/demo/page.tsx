import type { Metadata } from 'next';
import Link from 'next/link';
import DashboardView from '@/components/DashboardView';
import { demoData } from '@/lib/demo';

export const metadata: Metadata = { title: 'Trackex demo' };
export const dynamic = 'force-dynamic';

export default function DemoPage() {
  return (
    <>
      <div className="px-4 py-2 text-center text-[13px]" style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>
        Live demo with sample data —{' '}
        <Link href="/" style={{ color: 'inherit', fontWeight: 600, textDecoration: 'underline' }}>Sign in to track your own</Link>
      </div>
      <DashboardView data={demoData()} mode="demo" />
    </>
  );
}
