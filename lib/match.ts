import { STATUSES } from '@/lib/types';
import type { ApplicationDraft, ExtractedApplication, MatchMeta, Status } from '@/lib/types';
import { portalRank } from '@/lib/extract/heuristics';

export const ROLE_MATCH_THRESHOLD = 0.7;
const ROLE_ALIASES: Record<string, string> = {
  swe: 'software engineer', sde: 'software development engineer', sre: 'site reliability engineer',
  mle: 'machine learning engineer', ml: 'machine learning', fe: 'frontend', be: 'backend', pm: 'product manager'
};
const ROLE_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'at', 'with', 'role', 'position',
  'opening', 'job', 'summer', 'winter', 'spring', 'fall', 'autumn', 'program', 'programme', 'full', 'time', 'fulltime']);

/** "Stripe Recruiting", "Stripe, Inc." and "Stripe Careers" → "stripe". */
export function companyKey(s: string): string {
  return String(s || '').toLowerCase().replace(/&/g, ' and ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|company|co|pvt|private|plc|gmbh|technologies|labs|careers?|jobs?|recruiting|recruitment|talent( acquisition)?|hiring|team|hr|university|campus|the)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Role words with years, seasons and filler removed and crude stemming (engineering → engineer). */
export function roleTokens(s: string): string[] {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ')
    .flatMap(w => (ROLE_ALIASES[w] || w).split(' '))
    .filter(w => w && !ROLE_STOPWORDS.has(w) && !/^(19|20)\d\d$/.test(w))
    .map(w => w.replace(/(ing|s)$/, ''));
}

/** Jaccard similarity of role words (0–1). Deliberately strict. */
export function roleSimilarity(a: string, b: string): number {
  const A = new Set(roleTokens(a)), B = new Set(roleTokens(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

export function isActiveStatus(s: Status): boolean {
  return !['Rejected', 'Withdrawn', 'Offer'].includes(s);
}

const time = (d: Date | string | number) => new Date(d).getTime();

/**
 * Finds the row an email belongs to. Company names are normalised, roles match fuzzily,
 * and a role-less email goes to the most recently active row for that company.
 */
export function findApplication(rows: ApplicationDraft[], app: ExtractedApplication, status: Status): ApplicationDraft | null {
  const ck = companyKey(app.company);
  const same = rows.filter(r => companyKey(r.company) === ck);
  if (!same.length) return null;
  const active = same.filter(r => isActiveStatus(r.status));
  const newest = (list: ApplicationDraft[]) => list.slice().sort((a, b) => time(b.lastUpdate) - time(a.lastUpdate))[0];

  if (!roleTokens(app.role).length) return newest(active.length ? active : same);
  let best: ApplicationDraft | null = null, bestSim = 0;
  for (const r of same) {
    const sim = roleSimilarity(app.role, r.role);
    if (sim > bestSim) { best = r; bestSim = sim; }
  }
  if (best && bestSim >= ROLE_MATCH_THRESHOLD) return best;
  const roleless = same.find(r => !roleTokens(r.role).length);
  if (roleless) return roleless;
  // A rejection/interview/offer naming the role differently from the only open application is about that one.
  const isProgress = !['Applied', 'Under Review'].includes(status);
  return isProgress && active.length === 1 ? active[0] : null;
}

export function upsertApplication(
  rows: ApplicationDraft[], app: ExtractedApplication, meta: MatchMeta, newId: () => string
): ApplicationDraft | null {
  if (!companyKey(app.company)) return null;
  const status: Status = (STATUSES as readonly string[]).includes(app.status) ? (app.status as Status) : 'Applied';
  const row = findApplication(rows, app, status);

  if (!row) {
    const created: ApplicationDraft = {
      id: newId(),
      company: app.company,
      role: app.role || '',
      type: app.kind || '',
      status,
      appliedOn: meta.date,
      lastUpdate: meta.date,
      portalUrl: app.portal_url || '',
      portalKind: app.portal_url ? app.portal_kind || '' : '',
      emailLink: meta.emailLink,
      lastSubject: meta.subject,
      notes: '',
      dirty: true,
      isNew: true
    };
    rows.push(created);
    return created;
  }

  if (app.role && !roleTokens(row.role).length) row.role = app.role;
  if (app.kind && !row.type) row.type = app.kind;
  // A real "track your application" link replaces a careers-site link, never the reverse.
  if (portalRank(app.portal_url, app.portal_kind) > portalRank(row.portalUrl, row.portalKind)) {
    row.portalUrl = app.portal_url;
    row.portalKind = app.portal_kind;
  }
  if (time(meta.date) < time(row.appliedOn)) row.appliedOn = meta.date;
  // Backfill walks newest → oldest, so only a *newer* email may change status.
  if (!row.lastUpdate || time(meta.date) >= time(row.lastUpdate)) {
    // A generic "we received it / still reviewing" note never demotes a later stage.
    const isWeak = status === 'Applied' || status === 'Under Review';
    if (!(isWeak && STATUSES.indexOf(row.status) > STATUSES.indexOf(status))) row.status = status;
    row.lastUpdate = meta.date;
    row.emailLink = meta.emailLink;
    row.lastSubject = meta.subject;
  }
  row.dirty = true;
  return row;
}

/** Folds row b into row a. */
function mergeRowInto(a: ApplicationDraft, b: ApplicationDraft): void {
  const newer = time(b.lastUpdate) > time(a.lastUpdate) ? b : a;
  const applied = [a.appliedOn, b.appliedOn].filter(Boolean).map(time);
  if (applied.length) a.appliedOn = new Date(Math.min(...applied));
  a.status = newer.status;
  a.lastUpdate = newer.lastUpdate;
  a.emailLink = newer.emailLink;
  a.lastSubject = newer.lastSubject;
  if (roleTokens(b.role).length > roleTokens(a.role).length) a.role = b.role;
  if (!a.type) a.type = b.type;
  if (portalRank(b.portalUrl, b.portalKind) > portalRank(a.portalUrl, a.portalKind)) {
    a.portalUrl = b.portalUrl;
    a.portalKind = b.portalKind;
  }
  a.notes = [...new Set([a.notes, b.notes].filter(Boolean))].join(' · ');
}

/**
 * Merges rows for the same application that were split up: same company and a matching or
 * missing role. Keeps the earliest appliedOn, newest status, best portal link and all notes.
 * Removes merged-away rows from `rows` in place and returns them; survivors are marked dirty.
 */
export function mergeDuplicateApplications(rows: ApplicationDraft[]): ApplicationDraft[] {
  const removed: ApplicationDraft[] = [];
  const byCompany = new Map<string, ApplicationDraft[]>();
  for (const r of rows) {
    const ck = companyKey(r.company);
    if (!byCompany.has(ck)) byCompany.set(ck, []);
    byCompany.get(ck)!.push(r);
  }
  for (const group of byCompany.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        const roleless = !roleTokens(a.role).length || !roleTokens(b.role).length;
        if (!roleless && roleSimilarity(a.role, b.role) < ROLE_MATCH_THRESHOLD) continue;
        mergeRowInto(a, b);
        a.dirty = true;
        removed.push(b);
        group.splice(j--, 1);
      }
    }
  }
  if (removed.length) {
    const gone = new Set(removed);
    let w = 0;
    for (const r of rows) if (!gone.has(r)) rows[w++] = r;
    rows.length = w;
  }
  return removed;
}
