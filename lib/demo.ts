import type { ApplicationView, DashboardData, EventView, Status, PortalKind } from '@/lib/types';

const DAY = 86_400_000;

export function demoData(now = new Date()): DashboardData {
  const t = now.getTime();
  const ago = (d: number) => new Date(t - d * DAY).toISOString();
  const ahead = (d: number, h = 0) => new Date(t + d * DAY + h * 3_600_000).toISOString();

  const app = (
    n: number, company: string, role: string, type: string, status: Status,
    applied: number, updated: number, portalKind: PortalKind, notes = ''
  ): ApplicationView => ({
    id: `demo-app-${n}`, company, role, type, status,
    appliedOn: ago(applied), lastUpdate: ago(updated),
    portalUrl: portalKind ? `https://example.com/${company.toLowerCase().replace(/\s+/g, '-')}/status` : '',
    portalKind, emailLink: `https://example.com/mail/${n}`,
    lastSubject: `${company}: update on your application`, notes
  });

  const applications: ApplicationView[] = [
    app(1, 'Northwind Labs', 'Software Engineer Intern', 'Internship', 'Interview', 21, 2, 'application_status'),
    app(2, 'Contoso', 'Backend Developer', 'Job', 'Assessment', 14, 3, 'application_status'),
    app(3, 'Hooli', 'Machine Learning Engineer', 'Job', 'Under Review', 10, 6, 'careers_portal'),
    app(4, 'Fabrikam', 'Frontend Engineer Intern', 'Internship', 'Applied', 4, 4, 'application_status'),
    app(5, 'Globex', 'Data Analyst', 'Job', 'Offer', 35, 1, 'application_status'),
    app(6, 'Pied Piper', 'Compression Research Fellow', 'Fellowship', 'Rejected', 40, 12, ''),
    app(7, 'Initech', 'QA Engineer', 'Job', 'Withdrawn', 30, 18, 'careers_portal'),
    app(8, 'Umbrella Health', 'Platform Engineer Intern', 'Internship', 'Applied', 2, 2, 'careers_portal')
  ];

  const ev = (
    n: number, title: string, organization: string, kind: EventView['kind'], startsAt: string, allDay: boolean
  ): EventView => ({
    id: `demo-ev-${n}`, title, organization, kind, startsAt, allDay,
    link: `https://example.com/events/${n}`, emailLink: `https://example.com/mail/e${n}`,
    calendarLink: `https://example.com/calendar/${n}`
  });

  const events: EventView[] = [
    ev(1, 'Technical interview (round 2)', 'Northwind Labs', 'interview', ahead(1, 2), false),
    ev(2, 'Online assessment due', 'Contoso', 'assessment_due', ahead(2, 5), false),
    ev(3, 'Hackathon project submission', 'Globex Hack Night', 'submission_deadline', ahead(4, 3), false),
    ev(4, 'Hackathon kickoff', 'Hooli Build Weekend', 'event_start', ahead(9), true),
    ev(5, 'Fellowship application deadline', 'Pied Piper Foundation', 'application_deadline', ahead(16), true)
  ];

  return {
    user: { name: 'Demo user', email: 'demo@example.com', image: '' },
    applications, events,
    lastSyncAt: new Date(t - 7 * 60_000).toISOString(),
    syncError: null, backfilling: false, claude: true
  };
}
