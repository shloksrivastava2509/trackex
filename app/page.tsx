import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { signInWithGoogle } from '@/app/actions';
import SuiteBar from '@/components/SuiteBar';

export const dynamic = 'force-dynamic';

const GITHUB = 'https://github.com/shloksrivastava2509/trackex';

const FEATURES = [
  ['Automatic tracking', 'Confirmation, status and rejection emails keep every application up to date. No manual entry.'],
  ['Direct status links', 'Each application links to its own "track your application" page, falling back to the careers portal.'],
  ['Calendar integration', 'Interviews, assessments and hackathon deadlines land on a dedicated Trackex calendar.'],
  ['Reminders built in', 'Every event gets reminders 1 day and 1 hour before, at the exact time in your time zone.']
];

const PERMISSIONS = [
  ['Gmail', 'Read only', 'Reads job and hackathon mail. Never sends, deletes or labels anything.'],
  ['Google Calendar', 'Trackex calendar only', 'Manages only the calendar it creates. Your other calendars stay untouched.'],
  ['Profile', 'Name and email', 'Identifies your workspace.']
];

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  if (session?.user?.id) redirect('/dashboard');
  const { error } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col">
      <SuiteBar section="Application Tracker">
        <Link href="/demo" className="btn hidden sm:inline-flex">View demo</Link>
        <form action={signInWithGoogle}><button type="submit" className="btn primary">Sign in</button></form>
      </SuiteBar>

      <section style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="mx-auto w-full max-w-5xl px-4 py-12 sm:py-16">
          {error && (
            <div role="alert" className="mb-6 rounded px-3 py-2 text-[13px]"
                 style={{ background: 'color-mix(in srgb, var(--s-rejected) 9%, var(--panel))', border: '1px solid color-mix(in srgb, var(--s-rejected) 30%, transparent)' }}>
              {error === 'scopes'
                ? 'Trackex needs both Gmail read and Calendar access. Sign in again and leave both boxes ticked.'
                : 'Sign-in failed. Please try again.'}
            </div>
          )}
          <div className="eyebrow" style={{ color: 'var(--accent)' }}>Application tracking, automated</div>
          <h1 className="m-0 mt-2 max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-[44px]">
            Every job application in your inbox, tracked in one workspace.
          </h1>
          <p className="mt-4 max-w-2xl text-base muted sm:text-lg">
            Trackex reads your job and internship email, keeps each application&apos;s status current, and schedules interviews and deadlines on Google Calendar with reminders.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <form action={signInWithGoogle}>
              <button type="submit" className="btn primary lg">Sign in with Google</button>
            </form>
            <Link href="/demo" className="btn lg">Explore the demo workspace</Link>
          </div>
          <p className="mb-0 mt-3 text-xs muted">Free and open source. Setup is a single Google sign-in.</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
        <section aria-label="Features" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(([t, d], i) => (
            <div key={t} className="card p-4">
              <div className="num text-xs font-semibold" style={{ color: 'var(--accent)' }}>0{i + 1}</div>
              <h2 className="m-0 mt-1 text-sm font-semibold">{t}</h2>
              <p className="mb-0 mt-1 text-[13px] muted">{d}</p>
            </div>
          ))}
        </section>

        <section className="card mt-6 overflow-hidden" aria-labelledby="perms">
          <div className="panel-head"><h2 id="perms" className="m-0 text-[13px] font-semibold">Permissions requested</h2></div>
          <div className="overflow-x-auto">
            <table className="grid-table">
              <thead><tr><th scope="col">Service</th><th scope="col">Access</th><th scope="col">Purpose</th></tr></thead>
              <tbody>
                {PERMISSIONS.map(([s, a, p]) => (
                  <tr key={s}><td className="font-semibold">{s}</td><td className="whitespace-nowrap">{a}</td><td className="muted">{p}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-[13px] muted" style={{ borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
            Trackex is a personal project, so Google shows a <em>&ldquo;Google hasn&apos;t verified this app&rdquo;</em> screen once. Choose <strong style={{ color: 'var(--text)' }}>Advanced → Go to Trackex</strong>.
            Sync runs every 15 minutes; the first run reads the last 180 days. You can disconnect and delete your data at any time.
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid var(--line)', background: 'var(--panel)' }}>
        <div className="mx-auto flex w-full max-w-5xl flex-wrap gap-x-5 gap-y-2 px-4 py-4 text-xs muted">
          <span>© 2026 Trackex</span>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>
          <Link href="/privacy">Privacy</Link>
          <span>MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}
