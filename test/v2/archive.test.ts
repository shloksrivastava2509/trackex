import { describe, test, expect } from 'vitest';
import { archiveReason, markArchived } from '@/lib/archive';
import { companyFromSubject, guessCompany } from '@/lib/extract/heuristics';
import type { ApplicationView, EventView, Status } from '@/lib/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-07T12:00:00Z');
const app = (company: string, status: Status, idleDays: number): ApplicationView => ({
  id: company, company, role: '', type: '', status, appliedOn: new Date(NOW - 40 * DAY).toISOString(),
  lastUpdate: new Date(NOW - idleDays * DAY).toISOString(), portalUrl: '', portalKind: '', emailLink: '', lastSubject: '', notes: ''
});
const event = (organization: string, inDays: number): EventView => ({
  id: organization, title: 'x', organization, kind: 'assessment_due', startsAt: new Date(NOW + inDays * DAY).toISOString(),
  allDay: false, link: '', emailLink: '', calendarLink: ''
});

describe('auto-archive', () => {
  test('an assessment with no upcoming date and a week of silence expires', () => {
    expect(archiveReason(app('Accenture', 'Assessment', 30), [], NOW)).toBe('expired');
    expect(archiveReason(app('Accenture', 'Interview', 8), [], NOW)).toBe('expired');
  });

  test('a recent update, or an upcoming event for the company, keeps it live', () => {
    expect(archiveReason(app('Accenture', 'Assessment', 3), [], NOW)).toBeNull();
    expect(archiveReason(app('Accenture', 'Assessment', 30), [event('Accenture', 2)], NOW)).toBeNull();
    expect(archiveReason(app('Northwind Labs', 'Interview', 30), [event('Northwind', 1)], NOW)).toBeNull();
  });

  test('a past event does not keep it live; another company\'s event does not either', () => {
    expect(archiveReason(app('Accenture', 'Assessment', 30), [event('Accenture', -2)], NOW)).toBe('expired');
    expect(archiveReason(app('Accenture', 'Assessment', 30), [event('Contoso', 2)], NOW)).toBe('expired');
  });

  test('applied / under review go quiet after 60 days; closed outcomes are never archived', () => {
    expect(archiveReason(app('Hooli', 'Applied', 61), [], NOW)).toBe('quiet');
    expect(archiveReason(app('Hooli', 'Under Review', 59), [], NOW)).toBeNull();
    for (const s of ['Offer', 'Rejected', 'Withdrawn'] as Status[]) expect(archiveReason(app('X Corp', s, 400), [], NOW)).toBeNull();
  });

  test('markArchived annotates every row', () => {
    const out = markArchived([app('Accenture', 'Assessment', 30), app('Hooli', 'Applied', 2)], [], NOW);
    expect(out.map(a => a.archived)).toEqual(['expired', null]);
  });
});

describe('forwarded placement-cell mail', () => {
  const from = '"Dr. Sandeep Chaurasia [MU - Jaipur]" <sandeep.chaurasia@jaipur.manipal.edu>';
  const subject = 'FW: Urgent: Accenture \\\\ Important Guidelines for Accenture Assessment Process';

  test('the employer comes from the subject, not the forwarding professor', () => {
    expect(companyFromSubject(subject)).toBe('Accenture');
    expect(guessCompany({ from, subject })).toBe('Accenture');
  });

  test('ordinary employer mail is unchanged', () => {
    expect(guessCompany({ from: '"Stripe Recruiting" <jobs@stripe.com>', subject: 'Thanks for applying' })).toBe('Stripe');
    expect(guessCompany({ from })).not.toBe('');
  });
});
