import { describe, test, expect } from 'vitest';
import type { ApplicationDraft, ExtractedApplication, MatchMeta } from '@/lib/types';
import { upsertApplication, mergeDuplicateApplications, companyKey, roleSimilarity, roleTokens } from '@/lib/match';

let n = 0;
const newId = () => `id${++n}`;
const meta = (iso: string, subject = 's'): MatchMeta => ({ date: new Date(iso), subject, emailLink: 'l' });
const app = (p: Partial<ExtractedApplication>): ExtractedApplication =>
  ({ company: '', role: '', kind: '', status: '', portal_url: '', portal_kind: '', ...p });
const day = (d: Date) => d.toISOString().slice(0, 10);

describe('helpers', () => {
  test('companyKey unifies recruiting/inc variants', () => {
    expect(companyKey('Stripe Recruiting')).toBe('stripe');
    expect(companyKey('Stripe, Inc.')).toBe('stripe');
  });
  test('role similarity', () => {
    expect(roleTokens('SWE Intern')).toEqual(['software', 'engineer', 'intern']);
    expect(roleSimilarity('Data Engineer Intern', 'Software Engineer Intern')).toBe(0.5);
  });
});

describe('upsertApplication', () => {
  test('creates a dirty, new row', () => {
    const rows: ApplicationDraft[] = [];
    const r = upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Applied' }), meta('2026-09-01'), newId)!;
    expect(rows).toEqual([r]);
    expect(r.isNew).toBe(true);
    expect(r.dirty).toBe(true);
  });

  test('older email (backfill order) never overwrites a newer status', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Rejected' }), meta('2026-10-10'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Applied' }), meta('2026-09-01'), newId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Rejected');
    expect(day(rows[0].appliedOn)).toBe('2026-09-01');
  });

  test('a later generic "under review" note does not demote Interview', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Interview' }), meta('2026-10-01'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Under Review' }), meta('2026-10-05'), newId);
    expect(rows[0].status).toBe('Interview');
  });

  test('rejection naming the role differently updates the same row', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Stripe Recruiting', role: 'Software Engineering Intern', status: 'Applied' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Stripe, Inc.', role: 'Software Engineer Intern - Summer 2027', status: 'Rejected' }), meta('2026-10-01'), newId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Rejected');
  });

  test('"SWE Intern" matches "Software Engineer Intern"', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'Software Engineer Intern', status: 'Applied' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE Intern', status: 'Interview' }), meta('2026-10-01'), newId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Interview');
  });

  test('different roles at one company stay separate', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'Software Engineer Intern', status: 'Applied' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'Data Engineer Intern', status: 'Applied' }), meta('2026-09-02'), newId);
    expect(rows).toHaveLength(2);
  });

  test('a tracking link is not replaced by a later careers link', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Applied', portal_url: 'https://acme.ats.io/s/1', portal_kind: 'application_status' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Rejected', portal_url: 'https://careers.acme.com/', portal_kind: 'careers_portal' }), meta('2026-10-01'), newId);
    expect(rows[0].portalUrl).toBe('https://acme.ats.io/s/1');
    expect(rows[0].portalKind).toBe('application_status');
  });

  test('a tracking link replaces an earlier careers link (url and kind)', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Applied', portal_url: 'https://careers.acme.com/', portal_kind: 'careers_portal' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Assessment', portal_url: 'https://acme.ats.io/s/1', portal_kind: 'application_status' }), meta('2026-10-01'), newId);
    expect(rows[0].portalUrl).toBe('https://acme.ats.io/s/1');
    expect(rows[0].portalKind).toBe('application_status');
  });

  test('role-less update attaches to the existing row for that company', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Google', role: 'STEP Intern', status: 'Applied' }), meta('2026-09-01'), newId);
    upsertApplication(rows, app({ company: 'Google LLC', role: '', status: 'Rejected' }), meta('2026-10-01'), newId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Rejected');
  });

  test('changed existing row is marked dirty but not new', () => {
    const rows: ApplicationDraft[] = [];
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Applied' }), meta('2026-09-01'), newId);
    rows[0].dirty = false; rows[0].isNew = false;
    upsertApplication(rows, app({ company: 'Acme', role: 'SWE', status: 'Interview' }), meta('2026-10-01'), newId);
    expect(rows[0].dirty).toBe(true);
    expect(rows[0].isNew).toBe(false);
  });

  test('empty company is ignored', () => {
    const rows: ApplicationDraft[] = [];
    expect(upsertApplication(rows, app({ company: '' }), meta('2026-09-01'), newId)).toBeNull();
    expect(rows).toHaveLength(0);
  });
});

describe('mergeDuplicateApplications', () => {
  const row = (company: string, role: string, status: ApplicationDraft['status'], d: string, notes = ''): ApplicationDraft => ({
    id: newId(), company, role, type: '', status, appliedOn: new Date(d), lastUpdate: new Date(d),
    portalUrl: '', portalKind: '', emailLink: '', lastSubject: '', notes
  });

  test('folds split rows, removes them in place, keeps distinct roles', () => {
    const rows = [
      row('Stripe', 'Software Engineering Intern', 'Applied', '2026-09-01', 'referral'),
      row('Stripe Recruiting', 'Software Engineer Intern - Summer 2027', 'Rejected', '2026-10-01'),
      row('Stripe', 'Data Engineer Intern', 'Applied', '2026-09-05')
    ];
    const removed = mergeDuplicateApplications(rows);
    expect(removed).toHaveLength(1);
    expect(removed[0].company).toBe('Stripe Recruiting');
    expect(rows).toHaveLength(2);
    const swe = rows.find(r => /Software/.test(r.role))!;
    expect(swe.status).toBe('Rejected');
    expect(swe.notes).toBe('referral');
    expect(day(swe.appliedOn)).toBe('2026-09-01');
    expect(swe.dirty).toBe(true);
  });

  test('merges three duplicates (splice while iterating stays correct)', () => {
    const rows = [
      row('Acme', 'SWE Intern', 'Applied', '2026-09-01'),
      row('Acme', 'Software Engineer Intern', 'Interview', '2026-09-10'),
      row('Acme Careers', '', 'Rejected', '2026-10-01')
    ];
    const removed = mergeDuplicateApplications(rows);
    expect(removed).toHaveLength(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('Rejected');
  });

  test('carries the better portal link and its kind', () => {
    const a = row('Acme', 'SWE', 'Applied', '2026-09-01');
    a.portalUrl = 'https://careers.acme.com/'; a.portalKind = 'careers_portal';
    const b = row('Acme', 'SWE', 'Applied', '2026-09-02');
    b.portalUrl = 'https://acme.ats.io/s/1'; b.portalKind = 'application_status';
    const rows = [a, b];
    mergeDuplicateApplications(rows);
    expect(rows).toEqual([a]);
    expect(a.portalUrl).toBe('https://acme.ats.io/s/1');
    expect(a.portalKind).toBe('application_status');
  });
});
