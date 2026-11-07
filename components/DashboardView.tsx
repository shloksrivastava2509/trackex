'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { STATUSES } from '@/lib/types';
import type { ApplicationView, DashboardData, EventKind, EventView, Status } from '@/lib/types';
import { signInWithGoogle, signOutAction } from '@/app/actions';
import SuiteBar from '@/components/SuiteBar';
import StatusChip, { STATUS_COLOR } from '@/components/StatusChip';
import Toast from '@/components/Toast';
import Modal from '@/components/Modal';
import TimezoneReporter from '@/components/TimezoneReporter';

type Filter = 'Active' | 'Archived' | 'All' | Status;
type SortKey = 'company' | 'status' | 'appliedOn' | 'lastUpdate';
const INACTIVE: Status[] = ['Rejected', 'Withdrawn', 'Offer'];
const WEEK_MS = 7 * 86_400_000;

const EVENT_LABEL: Record<EventKind, string> = {
  registration_deadline: 'Registration deadline', submission_deadline: 'Submission deadline',
  application_deadline: 'Application deadline', event_start: 'Event', event_end: 'Event ends',
  interview: 'Interview', assessment_due: 'Assessment due', other: 'Event'
};

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

// all-day events may arrive as date-only ("2026-11-02"): parse as local date to avoid a day shift
function eventDate(e: EventView): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(e.startsAt) ? new Date(`${e.startsAt}T00:00:00`) : new Date(e.startsAt);
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Stable per-company hue for the initials tile, so a company keeps its colour across visits. */
function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function toCsv(rows: ApplicationView[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const head = ['Company', 'Role', 'Type', 'Status', 'Applied', 'Last update', 'Status link', 'Email link'];
  const body = rows.map((a) => [a.company, a.role, a.type, a.status, a.appliedOn.slice(0, 10), a.lastUpdate.slice(0, 10), a.portalUrl, a.emailLink].map(cell).join(','));
  return [head.join(','), ...body].join('\n');
}

const svg = (d: React.ReactNode, cls?: string) => (
  <svg className={cls} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const Icon = {
  refresh: svg(<><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></>),
  spinner: svg(<path d="M12 3a9 9 0 0 1 9 9" />, 'spin'),
  download: svg(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  mail: svg(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  external: svg(<><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>),
  calendar: svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  info: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>),
  warn: svg(<><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v4M12 17h.01" /></>)
};

function MessageBar({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const c = tone === 'error' ? 'var(--s-rejected)' : tone === 'warn' ? 'var(--s-interview)' : 'var(--accent)';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className="flex flex-wrap items-center gap-3 rounded px-3 py-2 text-[13px]"
         style={{ background: `color-mix(in srgb, ${c} 9%, var(--panel))`, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }}>
      <span style={{ color: c }} className="flex">{tone === 'info' ? Icon.info : Icon.warn}</span>
      {children}
    </div>
  );
}

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
    const by = Object.fromEntries(STATUSES.map((s) => [s, apps.filter((a) => a.status === s).length])) as Record<Status, number>;
    const live = apps.filter((a) => !a.archived);
    return {
      by, total: apps.length, active: live.filter((a) => !INACTIVE.includes(a.status)).length,
      archived: apps.length - live.length,
      interviews: live.filter((a) => a.status === 'Interview').length,
      assessments: live.filter((a) => a.status === 'Assessment').length
    };
  }, [apps]);
  const updatedThisWeek = now === null ? null : apps.filter((a) => now - new Date(a.lastUpdate).getTime() < WEEK_MS).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = apps.filter((a) => {
      if (filter === 'Active' ? INACTIVE.includes(a.status) || a.archived : filter === 'Archived' ? !a.archived : filter !== 'All' && a.status !== filter) return false;
      return !q || `${a.company} ${a.role} ${a.type} ${a.status}`.toLowerCase().includes(q);
    });
    const { key, dir } = sort;
    return list.sort((a, b) => {
      if (key === 'company') return dir * a.company.localeCompare(b.company);
      if (key === 'status') return dir * (STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status));
      return dir * (new Date(a[key]).getTime() - new Date(b[key]).getTime());
    });
  }, [apps, filter, query, sort]);

  function exportCsv() {
    const url = URL.createObjectURL(new Blob([toCsv(visible)], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `trackex-applications-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'company' ? 1 : -1 }));

  const lastSynced = data.lastSyncAt ? (now ? relTime(data.lastSyncAt, now) : '…') : 'never';
  const filterCount = (f: Filter) => (f === 'Active' ? counts.active : f === 'Archived' ? counts.archived : f === 'All' ? counts.total : counts.by[f]);
  const filterTitle = filter === 'Active' ? 'Active applications' : filter === 'All' ? 'All applications' : filter === 'Archived' ? 'Archived applications' : filter;
  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);

  const sortHead = (label: string, key: SortKey, cls = '') => (
    <th scope="col" className={cls} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sort-btn" onClick={() => toggleSort(key)}>
        {label}<span aria-hidden="true" style={{ opacity: sort.key === key ? 1 : 0.3 }}>{sort.key === key && sort.dir === 1 ? '↑' : '↓'}</span>
      </button>
    </th>
  );

  const avatar = (company: string, size = 30) => {
    const h = avatarHue(company);
    return (
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded text-[11px] font-bold"
            style={{ width: size, height: size, color: `hsl(${h} 55% 45%)`, background: `color-mix(in srgb, hsl(${h} 60% 50%) 15%, transparent)` }}>
        {company.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'}
      </span>
    );
  };

  const links = (a: ApplicationView) => (
    <div className="flex items-center gap-1.5">
      {a.portalUrl && (
        <a className={`btn sm ${a.portalKind === 'application_status' ? 'primary' : ''}`} href={a.portalUrl} target="_blank" rel="noopener noreferrer"
           title={a.portalKind === 'application_status' ? 'Open the application status page' : 'Open the careers portal'}>
          {a.portalKind === 'application_status' ? 'Track status' : 'Careers'}{Icon.external}
        </a>
      )}
      {a.emailLink && (
        <a className="btn sm ghost" href={a.emailLink} target="_blank" rel="noopener noreferrer" aria-label={`Open email from ${a.company}`} title="Open the latest email">
          {Icon.mail}
        </a>
      )}
    </div>
  );

  const navButton = (f: Filter, label: string, dot?: string) => (
    <button key={f} type="button" className="nav-item" aria-pressed={filter === f} onClick={() => setFilter(f)}>
      {dot && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />}
      {label}<span className="nav-count">{filterCount(f)}</span>
    </button>
  );

  const initialLetter = (data.user?.name || data.user?.email || '?').trim().charAt(0).toUpperCase();
  const kpis: { label: string; value: number; note: string; color: string }[] = [
    { label: 'Total applications', value: counts.total, note: updatedThisWeek === null ? '…' : `${updatedThisWeek} updated in the last 7 days`, color: 'var(--accent)' },
    { label: 'Active pipeline', value: counts.active, note: counts.archived ? `${counts.archived} archived automatically` : `${pct(counts.active)}% of all applications`, color: 'var(--s-review)' },
    { label: 'Interviews & assessments', value: counts.interviews + counts.assessments, note: `${counts.interviews} interviews · ${counts.assessments} assessments`, color: 'var(--s-interview)' },
    { label: 'Offers', value: counts.by.Offer, note: `${counts.by.Rejected} rejected · ${counts.by.Withdrawn} withdrawn`, color: 'var(--s-offer)' }
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {live && <TimezoneReporter />}

      <SuiteBar section="Application Tracker">
        {live ? (
          <>
            <span className="hidden text-xs suite-muted md:inline">Synced {lastSynced}</span>
            <button type="button" className="btn" onClick={syncNow} disabled={syncing} aria-busy={syncing}>
              {syncing ? Icon.spinner : Icon.refresh}<span className="hidden sm:inline">{syncing ? 'Syncing…' : 'Sync now'}</span>
            </button>
            <div className="relative" ref={menuRef}>
              <button type="button" className="flex cursor-pointer items-center rounded-full border-0 bg-transparent p-0.5" aria-haspopup="menu"
                      aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen((o) => !o)}>
                {data.user?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.user.image} alt="" width={30} height={30} referrerPolicy="no-referrer" className="rounded-full" style={{ boxShadow: '0 0 0 2px rgba(255,255,255,.3)' }} />
                ) : (
                  <span aria-hidden="true" className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-full text-xs font-semibold"
                        style={{ background: 'var(--accent)', color: '#fff' }}>{initialLetter}</span>
                )}
              </button>
              {menuOpen && (
                <div role="menu" className="card absolute right-0 z-50 mt-2 w-72 overflow-hidden p-0 shadow-lg" style={{ color: 'var(--text)' }}>
                  <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="truncate text-[13px] font-semibold">{data.user?.name || 'Signed in'}</div>
                    <div className="truncate text-xs muted">{data.user?.email}</div>
                  </div>
                  <div className="p-1">
                    <form action={signOutAction}>
                      <button type="submit" role="menuitem" className="nav-item">Sign out</button>
                    </form>
                    <button type="button" role="menuitem" className="nav-item" style={{ color: 'var(--danger)' }}
                            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>
                      Disconnect &amp; delete data
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <Link href="/" className="btn primary">Sign in with Google</Link>
        )}
      </SuiteBar>

      <form ref={signOutForm} action={signOutAction} hidden />

      <div className="flex flex-1">
        {/* Navigation pane: status "folders" double as filters */}
        <nav aria-label="Filter by status" className="sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col overflow-y-auto px-3 py-4 lg:flex"
             style={{ background: 'var(--panel)', borderRight: '1px solid var(--line)' }}>
          <div className="eyebrow px-2.5 pb-1.5">Views</div>
          {navButton('Active', 'Active')}
          {navButton('Archived', 'Archived')}
          {navButton('All', 'All applications')}
          <div className="eyebrow mt-5 px-2.5 pb-1.5">By status</div>
          {STATUSES.map((s) => navButton(s, s, STATUS_COLOR[s]))}
          <div className="eyebrow mt-5 px-2.5 pb-1.5">Schedule</div>
          <a href="#agenda" className="nav-item">{Icon.calendar}Upcoming<span className="nav-count">{data.events.length}</span></a>
          <div className="mt-auto px-2.5 pt-6 text-xs muted">
            <div>{live ? 'Auto-sync every 15 minutes' : 'Demo workspace'}</div>
            <div>{data.claude ? 'Extraction: Claude' : 'Extraction: keyword rules'}</div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-8">
          <div className="text-xs muted">
            Workspace <span aria-hidden="true">›</span> Applications{filter !== 'Active' && <> <span aria-hidden="true">›</span> {filterTitle}</>}
          </div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="m-0 text-2xl font-semibold tracking-tight">Applications</h1>
              <p className="m-0 mt-0.5 text-[13px] muted">
                {live ? <>Tracked automatically from <strong className="font-medium" style={{ color: 'var(--text)' }}>{data.user?.email}</strong></> : 'Sample data — nothing here is real'}
              </p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn" onClick={exportCsv} disabled={visible.length === 0}>{Icon.download}Export CSV</button>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {!live && (
              <MessageBar tone="info">
                <span className="min-w-[12rem] flex-1">You&apos;re viewing a demo workspace with sample data.</span>
                <Link href="/" className="font-semibold">Sign in to track your own inbox</Link>
              </MessageBar>
            )}
            {live && data.syncError === 'reauth' && (
              <MessageBar tone="error">
                <span className="flex-1">Google access expired. Sign in again to resume syncing.</span>
                <form action={signInWithGoogle}><button type="submit" className="btn sm primary">Sign in again</button></form>
              </MessageBar>
            )}
            {live && data.syncError && data.syncError !== 'reauth' && (
              <MessageBar tone="warn"><span>Last sync had a problem: {data.syncError}</span></MessageBar>
            )}
            {live && data.backfilling && (
              <MessageBar tone="info"><span>Reading the last 180 days of email. This can take a few sync runs.</span></MessageBar>
            )}
          </div>

          <section aria-label="Summary" className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="card relative overflow-hidden px-4 py-3.5">
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: k.color }} />
                <div className="eyebrow">{k.label}</div>
                <div className="num mt-1 text-[28px] font-semibold leading-tight">{k.value}</div>
                <div className="text-xs muted">{k.note}</div>
              </div>
            ))}
          </section>

          {counts.total > 0 && (
            <section aria-label="Pipeline by status" className="card mt-3 px-4 py-3.5">
              <div className="flex items-center justify-between">
                <div className="eyebrow">Pipeline by status</div>
                <div className="num text-xs muted">{counts.total} total</div>
              </div>
              <div className="mt-2.5 flex h-2.5 overflow-hidden rounded-sm" style={{ background: 'var(--line)' }}>
                {STATUSES.filter((s) => counts.by[s]).map((s) => (
                  <div key={s} title={`${s}: ${counts.by[s]}`} style={{ width: `${pct(counts.by[s])}%`, minWidth: 4, background: STATUS_COLOR[s] }} />
                ))}
              </div>
              <ul className="m-0 mt-2.5 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-xs">
                {STATUSES.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
                    <span className="muted">{s}</span><span className="num font-semibold">{counts.by[s]}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section aria-label="Applications" className="card h-fit min-w-0 overflow-hidden">
              <div className="panel-head flex-wrap">
                <span>{filterTitle} <span className="num font-normal muted">({visible.length})</span></span>
                <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
                  <select aria-label="Filter by status" className="input lg:hidden" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                    {(['Active', 'Archived', 'All', ...STATUSES] as Filter[]).map((f) => <option key={f} value={f}>{f} ({filterCount(f)})</option>)}
                  </select>
                  <label className="relative block w-full sm:w-64">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 flex -translate-y-1/2 muted">{Icon.search}</span>
                    <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company or role"
                           aria-label="Search applications" className="input w-full pl-8 font-normal" />
                  </label>
                </div>
              </div>

              {apps.length === 0 ? (
                <div className="px-6 py-14 text-center">
                  <p className="m-0 font-semibold">No applications yet</p>
                  <p className="mx-auto mb-0 mt-1 max-w-sm text-[13px] muted">Your first sync is running. Applications appear here as Trackex finds them in your inbox.</p>
                </div>
              ) : visible.length === 0 ? (
                <div className="px-6 py-14 text-center text-[13px] muted">No applications match this view.</div>
              ) : (
                <>
                  {/* mobile list */}
                  <ul className="m-0 list-none p-0 md:hidden">
                    {visible.map((a) => (
                      <li key={a.id} className="px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="flex items-start gap-3">
                          {avatar(a.company, 34)}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="truncate font-semibold">{a.company}</div>
                              <StatusChip status={a.status} archived={a.archived} />
                            </div>
                            <div className="truncate text-[13px] muted">{a.role || 'Role not detected'}{a.type ? ` · ${a.type}` : ''}</div>
                            <div className="mt-1 text-xs muted">Applied {shortDate(a.appliedOn)} · updated {now ? relTime(a.lastUpdate, now) : '…'}</div>
                            <div className="mt-2">{links(a)}</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* desktop grid */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="grid-table">
                      <thead>
                        <tr>
                          {sortHead('Company', 'company')}
                          {sortHead('Status', 'status')}
                          {sortHead('Applied', 'appliedOn')}
                          {sortHead('Last update', 'lastUpdate')}
                          <th scope="col">Links</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <div className="flex items-center gap-3">
                                {avatar(a.company)}
                                <div className="min-w-0">
                                  <div className="font-semibold">{a.company}</div>
                                  <div className="text-xs muted" title={a.lastSubject || undefined}>{a.role || 'Role not detected'}{a.type ? ` · ${a.type}` : ''}</div>
                                </div>
                              </div>
                            </td>
                            <td><StatusChip status={a.status} archived={a.archived} /></td>
                            <td className="num whitespace-nowrap">{shortDate(a.appliedOn)}</td>
                            <td className="whitespace-nowrap muted" title={shortDate(a.lastUpdate)}>{now ? relTime(a.lastUpdate, now) : '…'}</td>
                            <td>{links(a)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="num px-4 py-2 text-xs muted" style={{ borderTop: '1px solid var(--line)', background: 'var(--panel-2)' }}>
                    Showing {visible.length} of {counts.total} applications
                  </div>
                </>
              )}
            </section>

            <aside id="agenda" aria-label="Upcoming deadlines and events" className="card h-fit min-w-0 scroll-mt-16 overflow-hidden">
              <div className="panel-head">
                <span>Upcoming</span>
                <span className="text-xs font-normal muted">Reminders 1 day &amp; 1 hour before</span>
              </div>
              {data.events.length === 0 ? (
                <p className="m-0 px-4 py-8 text-center text-[13px] muted">No upcoming deadlines or events.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {data.events.map((e) => {
                    const d = eventDate(e);
                    const soon = now !== null && d.getTime() - now < 3 * 86_400_000;
                    const when = e.allDay ? 'All day' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    return (
                      <li key={e.id} className="flex gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--line)' }}>
                        <div className="w-12 shrink-0 overflow-hidden rounded text-center" style={{ border: '1px solid var(--line)' }}>
                          <div className="py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: soon ? 'var(--s-rejected)' : 'var(--accent)' }}>
                            {d.toLocaleDateString('en-US', { month: 'short' })}
                          </div>
                          <div className="num py-0.5 text-lg font-semibold leading-tight">{d.getDate()}</div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold leading-snug">{e.title}</div>
                          <div className="mt-0.5 text-xs muted">
                            {d.toLocaleDateString('en-US', { weekday: 'short' })} · {when}{e.organization ? ` · ${e.organization}` : ''}
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded px-1.5 py-px text-[11px] font-medium" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>{EVENT_LABEL[e.kind]}</span>
                            {soon && <span className="rounded px-1.5 py-px text-[11px] font-semibold" style={{ color: 'var(--s-rejected)', background: 'color-mix(in srgb, var(--s-rejected) 12%, transparent)' }}>Due soon</span>}
                            <span className="ml-auto flex gap-0.5">
                              {e.link && <a className="btn sm ghost" href={e.link} target="_blank" rel="noopener noreferrer" aria-label={`Open link for ${e.title}`} title="Open link">{Icon.external}</a>}
                              {e.emailLink && <a className="btn sm ghost" href={e.emailLink} target="_blank" rel="noopener noreferrer" aria-label={`Open email for ${e.title}`} title="Open email">{Icon.mail}</a>}
                              {e.calendarLink && <a className="btn sm ghost" href={e.calendarLink} target="_blank" rel="noopener noreferrer" aria-label={`Open ${e.title} in Google Calendar`} title="Open in Google Calendar">{Icon.calendar}</a>}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>
          </div>

          <footer className="mt-8 flex flex-wrap gap-x-4 gap-y-1 pb-2 text-xs muted lg:hidden">
            <span>{live ? `Synced ${lastSynced} · auto-sync every 15 minutes` : 'Demo workspace'}</span>
            <span>{data.claude ? 'Extraction: Claude' : 'Extraction: keyword rules'}</span>
          </footer>
        </main>
      </div>

      {toast && <Toast message={toast} onClose={closeToast} />}

      {confirmDelete && (
        <Modal title="Disconnect & delete data?" onClose={() => !deleting && setConfirmDelete(false)}>
          <p className="m-0 text-[13px] muted">
            This revokes Trackex&apos;s access to your Google account and permanently deletes your applications, events and stored token. The Trackex calendar it created in Google Calendar is deleted too. This can&apos;t be undone.
          </p>
          {deleteError && <p role="alert" className="mb-0 mt-3 text-[13px]" style={{ color: 'var(--danger)' }}>{deleteError}</p>}
          <div className="mt-5 flex justify-end gap-2">
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
