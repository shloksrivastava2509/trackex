import { describe, test, expect } from 'vitest';
import type { Email, Extraction } from '@/lib/types';
import { extractLinks } from '@/lib/extract/links';
import { extractWithHeuristics, pickPortalLink, norm } from '@/lib/extract/heuristics';
import { refinePortal } from '@/lib/extract/refine';

const SENT = new Date('2026-10-10T10:00:00Z');
const email = (from: string, subject: string, body: string, html = ''): Email => ({
  id: 'm1', threadId: 't1', from, subject, body, date: SENT, links: extractLinks(html), emailLink: 'https://mail.google.com/x'
});

describe('extractWithHeuristics', () => {
  test('application confirmation from an ATS -> Applied, company from display name, portal link', () => {
    const r = extractWithHeuristics(email(
      '"Stripe Recruiting" <no-reply@greenhouse.io>', 'Thank you for applying to Stripe',
      'Hi, thank you for applying to the Software Engineering Intern role. We have received your application.',
      '<a href="https://example.com/unsubscribe">Unsubscribe</a><a href="https://my.greenhouse.io/applications/123">View your application status</a>'));
    expect(r.category).toBe('job_application');
    expect(r.application.company).toBe('Stripe');
    expect(r.application.role).toBe('Software Engineering Intern');
    expect(r.application.kind).toBe('Internship');
    expect(r.application.status).toBe('Applied');
    expect(r.application.portal_url).toBe('https://my.greenhouse.io/applications/123');
  });

  test('rejection without a role -> Rejected, role not confused with company', () => {
    const r = extractWithHeuristics(email('"Google Careers" <careers@google.com>', 'Your application to Google',
      'Unfortunately, we have decided to move forward with other candidates.'));
    expect(r.application.status).toBe('Rejected');
    expect(r.application.company).toBe('Google');
    expect(r.application.role).toBe('');
  });

  test('online assessment with a dated deadline -> Assessment + a timed calendar event', () => {
    const r = extractWithHeuristics(email('"Acme Talent" <talent@acme.io>', 'Online assessment: Backend Engineer',
      'Please complete the HackerRank coding challenge. The assessment is due by October 15, 2026 11:59 pm.',
      '<a href="https://www.hackerrank.com/test/abc">Start assessment</a>'));
    expect(r.application.status).toBe('Assessment');
    expect(r.events).toHaveLength(1);
    expect(r.events[0].all_day).toBe(false);
    expect(r.events[0].start_iso).toBe('2026-10-15T23:59:00');
    expect(r.events[0].url).toBe('https://www.hackerrank.com/test/abc');
  });

  test('hackathon email -> event category with submission deadline and start date', () => {
    const r = extractWithHeuristics(email('"Devpost" <support@devpost.com>', 'HackHarvard 2026: submissions close soon',
      'Reminder: the submission deadline is Oct 24 at 5:00 PM. Hacking begins 18 October 2026.',
      '<a href="https://hackharvard.devpost.com/">Submit project</a>'));
    expect(r.category).toBe('hackathon_or_event');
    expect(r.events.map(e => e.kind).sort()).toEqual(['event_start', 'submission_deadline']);
    expect(r.events.some(e => e.start_iso.startsWith('2026-10-20'))).toBe(false); // year is not a day
    const deadline = r.events.find(e => e.kind === 'submission_deadline')!;
    expect(deadline.start_iso).toBe('2026-10-24T17:00:00');
    expect(deadline.all_day).toBe(false);
    const start = r.events.find(e => e.kind === 'event_start')!;
    expect(start.start_iso).toBe('2026-10-18');
    expect(start.all_day).toBe(true);
  });

  for (const phrase of [
    "We won't be moving forward with your application.",
    'We have chosen to proceed with other applicants whose experience more closely matches.',
    'After careful consideration, we will not be progressing your application.',
    'You are no longer being considered for this role.'
  ]) {
    test(`rejection phrasing -> Rejected: "${phrase.slice(0, 40)}..."`, () => {
      const r = extractWithHeuristics(email('"Acme Careers" <jobs@acme.com>', 'Update on your Acme application', `Hi, thanks for applying. ${phrase}`));
      expect(r.application.status).toBe('Rejected');
    });
  }

  test('job alert newsletter -> ignored', () => {
    const r = extractWithHeuristics(email('"LinkedIn" <jobs-noreply@linkedin.com>', '10 new jobs for you',
      'Software Engineer at X. Apply now.'));
    expect(r.category).toBe('other');
    expect(r.events).toHaveLength(0);
  });

  test('date without a year that already passed rolls into next year', () => {
    const r = extractWithHeuristics(email('"MLH" <hi@mlh.io>', 'MLH Fellowship applications',
      'Applications close Jan 5. Apply early!'));
    expect(r.events[0].start_iso).toBe('2027-01-05');
    expect(r.events[0].all_day).toBe(true);
  });

  test('date without a year that is still ahead stays in the email year', () => {
    const r = extractWithHeuristics(email('"MLH" <hi@mlh.io>', 'MLH Fellowship applications',
      'Applications close Nov 5. Apply early!'));
    expect(r.events[0].start_iso).toBe('2026-11-05');
  });
});

describe('helpers', () => {
  test('norm strips legal suffixes and punctuation', () => {
    expect(norm('Stripe, Inc.')).toBe('stripe');
    expect(norm('Acme Technologies Pvt Ltd')).toBe('acme');
  });

  test('extractLinks keeps http(s) links once, decodes &amp;, drops mailto, records context', () => {
    const links = extractLinks('<p>To see where things stand, <a href="https://a.com/x?y=1&amp;z=2">Go <b>now</b></a></p>' +
      '<a href="https://a.com/x?y=1&amp;z=2">dup</a><a href="mailto:x@y.z">mail</a>');
    expect(links).toEqual([{ url: 'https://a.com/x?y=1&z=2', text: 'Go now', context: 'To see where things stand,' }]);
  });
});

describe('pickPortalLink (status portal link)', () => {
  test('"To track your application, click here" beats the careers site', () => {
    const pick = pickPortalLink(extractLinks(
      '<p>Visit our <a href="https://careers.acme.com/">careers site</a> for more roles.</p>' +
      '<p>To track your application, <a href="https://acme.example-ats.com/r/abc123">click here</a>.</p>'));
    expect(pick.url).toBe('https://acme.example-ats.com/r/abc123');
    expect(pick.kind).toBe('application_status');
  });

  test('explicit "Track your application" link text wins', () => {
    const pick = pickPortalLink(extractLinks(
      '<a href="https://careers.globex.com/jobs">Careers</a><a href="https://globex.com/u/9f">Track your application</a>'));
    expect(pick.url).toBe('https://globex.com/u/9f');
    expect(pick.kind).toBe('application_status');
  });

  test('no tracking link -> falls back to the careers portal', () => {
    const pick = pickPortalLink(extractLinks('<a href="https://twitter.com/acme">Twitter</a><a href="https://careers.acme.com/">Acme Careers</a>'));
    expect(pick.url).toBe('https://careers.acme.com/');
    expect(pick.kind).toBe('careers_portal');
  });

  test('job-alert and "similar jobs" links are never picked', () => {
    const pick = pickPortalLink(extractLinks('<a href="https://careers.acme.com/search">See similar jobs</a>'));
    expect(pick.url).toBe('');
  });
});

describe('refinePortal', () => {
  const e = {
    ...email('"Acme" <a@acme.com>', 's', 'b'),
    links: extractLinks('<a href="https://careers.acme.com/">Careers</a>' +
      '<p>You can check your application status <a href="https://acme.ats.io/s/1">here</a>.</p>')
  };
  const data = (url: string, kind: 'application_status' | 'careers_portal' | ''): Extraction => ({
    category: 'job_application',
    application: { company: 'Acme', role: '', kind: '', status: 'Applied', portal_url: url, portal_kind: kind },
    events: []
  });

  test('a careers link from Claude is upgraded to the tracking link', () => {
    expect(refinePortal(data('https://careers.acme.com/', 'careers_portal'), e).application.portal_url).toBe('https://acme.ats.io/s/1');
  });

  test('a URL that is not in the email is never kept', () => {
    expect(refinePortal(data('https://made-up.example.com/', 'application_status'), e).application.portal_url).toBe('https://acme.ats.io/s/1');
  });
});
