'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { STATUSES } from '@/lib/types';
import type { ApplicationView, DashboardData, EventView, Status } from '@/lib/types';
import { signInWithGoogle, signOutAction } from '@/app/actions';
import Logo from '@/components/Logo';
import StatusChip from '@/components/StatusChip';
import Toast from '@/components/Toast';
import Modal from '@/components/Modal';
import TimezoneReporter from '@/components/TimezoneReporter';

type Filter = 'Active' | 'All' | Status;
type SortKey = 'company' | 'status' | 'appliedOn' | 'lastUpdate';
const INACTIVE: Status[] = ['Rejected', 'Withdrawn', 'Offer'];

function relTime(iso: string, nowMs: number): string {
  const diff = new Date(iso).getTime() - nowMs;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'just now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), 'day');
  return rtf.format(Math.round(diff / (30 * 86_400_000)), 'month');
}

function eventWhen(e: EventView): string {
  // all-day events may arrive as date-only ("2026-11-02"): parse as local date to avoid a day shift
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e.startsAt);
  const d = dateOnly ? new Date(`${e.startsAt}T00:00:00`) : new Date(e.startsAt);
  if (e.allDay) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const Icon = {
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" />
    </svg>
  ),
  spinner: (
    <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3a9 9 0 0 1 9 9" />
    </svg>
  )
};

export default function DashboardView({ data: initial, mode }: { data: DashboardData; mode: 'live' | 'demo' }) {
  const live = mode === 'live';
  const [data, setData] = useState(initial);
  const [now, setNow] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('Active');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'lastUpdate', dir: -1 });
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const signOutForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    // Relative times ("3 days ago") are client-only to avoid hydration mismatches;
    // the first tick is scheduled rather than set synchronously inside the effect.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const closeToast = useCallback(() => setToast(null), []);

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      if (!res.ok) throw new Error(`Sync failed (${res.status})`);
      const json = (await res.json()) as { summary: string; data: DashboardData };
      setData(json.data);
      setToast(json.summary || 'Sync complete');
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Sync failed — please try again');
    } finally {
      setSyncing(false);
    }
  }

  async function deleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      if (!res.ok) throw new Error(`Deletion failed (${res.status})`);
      signOutForm.current?.requestSubmit();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Deletion failed — please try again');
      setDeleting(false);
    }
  }

  const apps = data.applications;
  const counts = useMemo(() => {
    const c = (s: Status) => apps.filter((a) => a.status === s).length;
    return {
      total: apps.length,
      active: apps.filter((a) => !INACTIVE.includes(a.status)).length,
      interviews: c('Interview'), assessments: c('Assessment'), offers: c('Offer'), rejected: c('Rejected')
    };
  }, [apps]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = apps.filter((a) => {
      if (filter === 'Active' ? INACTIVE.includes(a.status) : filter !== 'All' && a.status !== filter) return false;
      return !q || `${a.company} ${a.role} ${a.type} ${a.status}`.toLowerCase().includes(q);
    });
    const { key, dir } = sort;
    return list.sort((a, b) => {
      if (key === 'company') return dir * a.company.localeCompare(b.company);
      if (key === 'status') return dir * (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
      return dir * (new Date(a[key]).getTime() - new Date(b[key]).getTime());
    });
  }, [apps, filter, query, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'company' ? 1 : -1 }));

  const lastSynced = !live ? null : data.lastSyncAt ? (now ? relTime(data.lastSyncAt, now) : '…') : 'never';

  const stat = (label: string, n: number) => (
    <div className="card px-4 py-3" key={label}>
      <div className="text-2xl font-semibold leading-none">{n}</div>
      <div className="mt-1 text-xs muted">{label}</div>
    </div>
  );

  const portalLabel = (a: ApplicationView) => (a.portalKind === 'application_status' ? 'Track application ↗' : 'Careers portal ↗');
  const links = (a: ApplicationView) => (
    <div className="flex flex-wrap gap-1.5">
      {a.portalUrl && (
        <a className="btn sm primary" href={a.portalUrl} target="_blank" rel="noopener noreferrer">{portalLabel(a)}</a>
      )}
      {a.emailLink && (
        <a className="btn sm" href={a.emailLink} target="_blank" rel="noopener noreferrer" aria-label={`Open email for ${a.company}`}>Email ↗</a>
      )}
    </div>
  );

  const sortHead = (label: string, key: SortKey) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className="px-3 py-2 text-left text-xs font-medium muted">
      <button type="button" onClick={() => toggleSort(key)} className="cursor-pointer border-0 bg-transparent p-0 font-medium" style={{ color: 'inherit', font: 'inherit' }}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  const initialLetter = (data.user?.name || data.user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5">
      {live && <TimezoneReporter />}

      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link href="/" aria-label="Trackex home"><Logo height={30} /></Link>
        <div className="min-w-0 flex-1 text-xs muted">
          {live ? <>Last synced {lastSynced} · syncs every 15 min</> : 'Sample data · nothing here is real'}
        </div>
        {live ? (
          <>
            <button type="button" className="btn" onClick={syncNow} disabled={syncing} aria-busy={syncing}>
              {syncing ? Icon.spinner : Icon.refresh}{syncing ? 'Syncing…' : 'Sync now'}
            </button>
            <div className="relative" ref={menuRef}>
              <button type="button" className="btn" aria-haspopup="menu" aria-expanded={menuOpen}
                      aria-label="Account menu" onClick={() => setMenuOpen((o) => !o)}>
                {data.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.user.image} alt="" width={22} height={22} referrerPolicy="no-referrer" className="rounded-full" />
                ) : (
                  <span aria-hidden="true" className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-xs font-semibold"
                        style={{ background: 'var(--accent)', color: 'var(--accent-text)' }}>{initialLetter}</span>
                )}
                <span className="hidden max-w-[10rem] truncate sm:inline">{data.user?.name || data.user?.email}</span>
              </button>
              {menuOpen && (
                <div role="menu" className="card absolute right-0 z-30 mt-2 w-64 p-1 shadow-lg">
                  <div className="truncate px-3 py-2 text-xs muted">{data.user?.email}</div>
                  <form action={signOutAction}>
                    <button type="submit" role="menuitem" className="w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[13px] hover:bg-black/5 dark:hover:bg-white/10" style={{ color: 'var(--text)' }}>Sign out</button>
                  </form>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                          className="w-full cursor-pointer rounded-md border-0 bg-transparent px-3 py-2 text-left text-[13px]" style={{ color: 'var(--danger)' }}>
                    Disconnect &amp; delete data
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/" className="btn primary">Sign in to use with your Gmail</Link>
        )}
      </header>

      <form ref={signOutForm} action={signOutAction} hidden />

      <div className="mt-4 space-y-2">
        {live && data.syncError === 'reauth' && (
          <div role="alert" className="card flex flex-wrap items-center gap-3 px-4 py-3 text-[13px]" style={{ borderColor: 'var(--s-rejected)' }}>
            <span className="flex-1">Google access expired — sign in again to resume syncing.</span>
            <form action={signInWithGoogle}><button type="submit" className="btn sm primary">Sign in again</button></form>
          </div>
        )}
        {live && data.syncError && data.syncError !== 'reauth' && (
          <div role="status" className="card px-4 py-2 text-[13px]" style={{ borderColor: 'var(--s-interview)' }}>
            Last sync had a problem: {data.syncError}
          </div>
        )}
        {live && data.backfilling && (
          <div role="status" className="card px-4 py-2 text-[13px]">
            Reading the last 180 days of email — this can take a few sync runs.
          </div>
        )}
        {!data.claude && (
          <div className="px-1 text-xs muted">Keyword mode: Claude extraction isn&apos;t configured, so emails are matched with simple rules.</div>
        )}
      </div>

      <section aria-label="Summary" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat('Total', counts.total)}
        {stat('Active', counts.active)}
        {stat('Interviews', counts.interviews)}
        {stat('Assessments', counts.assessments)}
        {stat('Offers', counts.offers)}
        {stat('Rejected', counts.rejected)}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-label="Applications" className="min-w-0">
          <div className="mb-3 flex flex-col gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, role…"
                   aria-label="Search applications"
                   className="w-full rounded-lg border px-3 py-2 text-[14px]"
                   style={{ background: 'var(--panel)', color: 'var(--text)', borderColor: 'var(--line)' }} />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
              {(['Active', 'All', ...STATUSES] as Filter[]).map((s) => (
                <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}
                        className="cursor-pointer rounded-full border px-2.5 py-1 text-xs"
                        style={filter === s
                          ? { background: 'var(--text)', color: 'var(--panel)', borderColor: 'var(--text)' }
                          : { background: 'transparent', color: 'var(--muted)', borderColor: 'var(--line)' }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {apps.length === 0 ? (
            <div className="card p-8 text-center muted">
              <p className="m-0 font-medium" style={{ color: 'var(--text)' }}>No applications yet</p>
              <p className="mb-0 mt-1 text-[13px]">Your first sync is running… applications will appear here as Trackex finds them in your inbox.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="card p-8 text-center text-[13px] muted">No applications match this filter.</div>
          ) : (
            <>
              {/* mobile cards */}
              <ul className="m-0 list-none space-y-3 p-0 md:hidden">
                {visible.map((a) => (
                  <li key={a.id} className="card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{a.company}</div>
                        <div className="text-[13px] muted">{a.role || 'Role not detected'}{a.type ? ` · ${a.type}` : ''}</div>
                      </div>
                      <StatusChip status={a.status} />
                    </div>
                    <div className="mt-2 text-xs muted">
                      Applied {shortDate(a.appliedOn)} · updated {now ? relTime(a.lastUpdate, now) : '…'}
                    </div>
                    <div className="mt-3">{links(a)}</div>
                  </li>
                ))}
              </ul>

              {/* desktop table */}
              <div className="card hidden overflow-hidden md:block">
                <table className="w-full border-collapse text-[13px]">
                  <thead style={{ borderBottom: '1px solid var(--line)' }}>
                    <tr>
                      {sortHead('Company / role', 'company')}
                      {sortHead('Status', 'status')}
                      {sortHead('Applied', 'appliedOn')}
                      {sortHead('Updated', 'lastUpdate')}
                      <th scope="col" className="px-3 py-2 text-left text-xs font-medium muted">Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((a) => (
                      <tr key={a.id} style={{ borderTop: '1px solid var(--line)' }}>
                        <td className="px-3 py-2.5">
                          <div className="font-semibold">{a.company}</div>
                          <div className="text-xs muted">{a.role || 'Role not detected'}{a.type ? ` · ${a.type}` : ''}</div>
                        </td>
                        <td className="px-3 py-2.5"><StatusChip status={a.status} /></td>
                        <td className="whitespace-nowrap px-3 py-2.5 muted">{shortDate(a.appliedOn)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 muted">{now ? relTime(a.lastUpdate, now) : '…'}</td>
                        <td className="px-3 py-2.5">{links(a)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <aside aria-label="Upcoming deadlines and events" className="min-w-0">
          <div className="card p-4">
            <h2 className="m-0 mb-3 text-sm font-semibold">Upcoming deadlines &amp; events</h2>
            {data.events.length === 0 ? (
              <p className="m-0 text-[13px] muted">Nothing upcoming.</p>
            ) : (
              <ul className="m-0 list-none space-y-3 p-0">
                {data.events.map((e) => {
                  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(e.startsAt);
                  const t = (dateOnly ? new Date(`${e.startsAt}T00:00:00`) : new Date(e.startsAt)).getTime();
                  const soon = now !== null && t - now < 3 * 86_400_000;
                  return (
                    <li key={e.id} className="pb-3" style={{ borderBottom: '1px solid var(--line)' }}>
                      <div className="text-[13px] font-semibold" style={soon ? { color: 'var(--s-rejected)' } : undefined}>
                        {eventWhen(e)}{soon ? ' · soon' : ''}
                      </div>
                      <div className="mt-0.5 text-[13px]">{e.title}</div>
                      {e.organization && <div className="text-xs muted">{e.organization}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.link && <a className="btn sm" href={e.link} target="_blank" rel="noopener noreferrer">Open ↗</a>}
                        {e.emailLink && <a className="btn sm" href={e.emailLink} target="_blank" rel="noopener noreferrer">Email ↗</a>}
                        {e.calendarLink && <a className="btn sm" href={e.calendarLink} target="_blank" rel="noopener noreferrer">Calendar ↗</a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>

      {toast && <Toast message={toast} onClose={closeToast} />}

      {confirmDelete && (
        <Modal title="Disconnect & delete data?" onClose={() => !deleting && setConfirmDelete(false)}>
          <p className="m-0 text-[13px] muted">
            This revokes Trackex&apos;s access to your Google account and permanently deletes your applications, events and stored token. The Trackex calendar it created in Google Calendar is deleted too. This can&apos;t be undone.
          </p>
          {deleteError && <p role="alert" className="mb-0 mt-3 text-[13px]" style={{ color: 'var(--danger)' }}>{deleteError}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn danger" onClick={deleteAccount} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete everything'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
