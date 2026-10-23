import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';

export const metadata: Metadata = { title: 'Privacy — Trackex' };

const GITHUB = 'https://github.com/shloksrivastava2509/trackex';

export default function Privacy() {
  const h = 'mb-2 mt-8 text-lg font-semibold';
  const p = 'm-0 mb-3 text-[14px] leading-relaxed';
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
      <Link href="/" aria-label="Trackex home"><Logo height={32} /></Link>
      <h1 className="mb-1 mt-8 text-3xl font-bold tracking-tight">Privacy policy</h1>
      <p className="m-0 muted">Trackex is a personal, open-source project. This page explains exactly what it does with your data.</p>

      <h2 className={h}>What Trackex reads</h2>
      <p className={p}>With your permission, Trackex reads your Gmail using the read-only scope. It looks for emails about job, internship, fellowship and hackathon applications and events. It never sends, deletes, archives or labels mail. It also creates and manages a single calendar named “Trackex” in your Google Calendar; it cannot see or change your other calendars.</p>

      <h2 className={h}>What Trackex stores</h2>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-[14px]">
        <li>Your Google account ID, name, email address and profile picture URL.</li>
        <li>Application and event metadata: company, role, status, dates, deadlines, links, and the subject line of the latest related email.</li>
        <li>An encrypted Google refresh token (AES-256-GCM), used so syncing works while you are away.</li>
      </ul>
      <p className={p}><strong>Trackex does not store email bodies.</strong> Message text is processed in memory during a sync and discarded.</p>

      <h2 className={h}>AI processing</h2>
      <p className={p}>When an Anthropic API key is configured, the text of relevant emails is sent to Claude (Anthropic) to extract structured details such as company, role and dates. Anthropic&apos;s API terms apply to that processing. If no key is configured, Trackex uses simple keyword rules locally and nothing is sent to a third party.</p>

      <h2 className={h}>Retention and deletion</h2>
      <p className={p}>Data is kept while your account is connected. Use “Disconnect &amp; delete data” in the dashboard menu at any time: this revokes Trackex&apos;s access with Google and permanently deletes your stored data. You can also revoke access from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google Account permissions</a> page.</p>

      <h2 className={h}>No ads, no selling</h2>
      <p className={p}>Trackex has no advertising or analytics trackers, and your data is never sold or shared for any purpose other than running the features described above.</p>

      <h2 className={h}>Google API usage</h2>
      <p className={p}>Trackex&apos;s use of information received from Google APIs is limited to providing the features above. The app is currently unverified by Google, so you will see a warning screen once when signing in.</p>

      <h2 className={h}>Contact</h2>
      <p className={p}>Questions or concerns? Open an issue on <a href={`${GITHUB}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a>. The source code is available at <a href={GITHUB} target="_blank" rel="noopener noreferrer">github.com/shloksrivastava2509/trackex</a> (MIT).</p>

      <p className="mt-10 text-[13px] muted"><Link href="/">← Back to Trackex</Link></p>
    </main>
  );
}
