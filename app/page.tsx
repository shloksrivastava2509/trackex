import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { signInWithGoogle } from '@/app/actions';
import Logo from '@/components/Logo';

export const dynamic = 'force-dynamic';

const GITHUB = 'https://github.com/shloksrivastava2509/trackex';

const FEATURES = [
  ['Every application, one list', 'Reads confirmation, status and rejection emails and keeps each application up to date automatically.'],
  ['Deadlines on your calendar', 'Interviews, assessments and hackathon deadlines land on a dedicated Trackex calendar.'],
  ['Reminders 1 day and 1 hour before', 'Never miss a submission or an interview slot again.'],
  ['Private and open source', 'No email bodies stored, no ads, delete everything with one click. MIT licensed.']
];

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-8 sm:py-14">
      <header><Logo height={36} /></header>

      {error && (
        <div role="alert" className="card mt-8 px-4 py-3 text-[13px]" style={{ borderColor: 'var(--s-rejected)' }}>
          {error === 'scopes'
            ? 'Trackex needs both Gmail read and Calendar access — please sign in again and leave both boxes ticked.'
            : 'Sign-in failed — please try again.'}
        </div>
      )}

      <section className="mt-10">
        <h1 className="m-0 text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          Never lose track of an application again.
        </h1>
        <p className="mt-4 max-w-xl text-base muted sm:text-lg">
          Trackex reads your job and internship emails, keeps a live dashboard of every application, and puts your interviews and deadlines on Google Calendar.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <form action={signInWithGoogle}>
            <button type="submit" className="btn primary lg">Sign in with Google</button>
          </form>
          <a href="/demo" className="btn lg">View live demo →</a>
        </div>
      </section>

      <section className="mt-12 grid gap-3 sm:grid-cols-2" aria-label="Features">
        {FEATURES.map(([t, d]) => (
          <div key={t} className="card p-4">
            <h2 className="m-0 text-sm font-semibold">{t}</h2>
            <p className="mb-0 mt-1 text-[13px] muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="card mt-10 p-5" aria-labelledby="signin-info">
        <h2 id="signin-info" className="m-0 text-base font-semibold">What happens when you sign in</h2>
        <ul className="mb-0 mt-3 list-disc space-y-2 pl-5 text-[13px] muted">
          <li><strong style={{ color: 'var(--text)' }}>Gmail read-only.</strong> Trackex can read mail but never sends, deletes or labels anything.</li>
          <li><strong style={{ color: 'var(--text)' }}>Calendar access limited to Trackex.</strong> It can only manage the calendar it creates, not your other calendars.</li>
          <li>It syncs every 15 minutes. The first sync backfills the last 180 days.</li>
          <li>Google will show a <em>“Google hasn&apos;t verified this app”</em> screen once, because this is a personal project. Click <strong>Advanced → Go to Trackex</strong>.</li>
          <li>You can disconnect and delete all your data at any time.</li>
        </ul>
      </section>

      <footer className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-12 text-[13px] muted">
        <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="/privacy">Privacy</a>
        <span>MIT licensed</span>
      </footer>
    </main>
  );
}
