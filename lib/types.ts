// Shared types: the contract between extraction, matching, sync, storage and the UI.

export const STATUSES = ['Applied', 'Under Review', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'] as const;
export type Status = (typeof STATUSES)[number];

export const APPLICATION_KINDS = ['Job', 'Internship', 'Fellowship', 'Program', 'Other', ''] as const;
export type ApplicationKind = (typeof APPLICATION_KINDS)[number];

export const PORTAL_KINDS = ['application_status', 'careers_portal', 'job_posting', ''] as const;
export type PortalKind = (typeof PORTAL_KINDS)[number];

export const EVENT_KINDS = [
  'registration_deadline', 'submission_deadline', 'application_deadline',
  'event_start', 'event_end', 'interview', 'assessment_due', 'other'
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** A link found in an email, with the text just before it ("To track your application, click here"). */
export interface EmailLink {
  url: string;
  text: string;
  context: string;
}

/** One Gmail message, decoded. */
export interface Email {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: Date;
  body: string;
  links: EmailLink[];
  /** Deep link to the thread in Gmail. */
  emailLink: string;
}

export interface ExtractedApplication {
  company: string;
  role: string;
  kind: ApplicationKind;
  status: Status | '';
  portal_url: string;
  portal_kind: PortalKind;
}

export interface ExtractedEvent {
  title: string;
  organization: string;
  kind: EventKind;
  /** ISO 8601 with offset; date-only ("2026-11-02") when all_day. */
  start_iso: string;
  end_iso: string;
  all_day: boolean;
  url: string;
}

/** What Claude (or the keyword fallback) extracts from one email. */
export interface Extraction {
  category: 'job_application' | 'hackathon_or_event' | 'other';
  application: ExtractedApplication;
  events: ExtractedEvent[];
}

/** An application row as the matcher works with it (in memory, per user). */
export interface ApplicationDraft {
  id: string;
  company: string;
  role: string;
  type: ApplicationKind;
  status: Status;
  appliedOn: Date;
  lastUpdate: Date;
  portalUrl: string;
  portalKind: PortalKind;
  emailLink: string;
  lastSubject: string;
  notes: string;
  /** Set by the matcher when the row was created or changed and must be saved. */
  dirty?: boolean;
  /** Set by the matcher when the row is new (insert rather than update). */
  isNew?: boolean;
}

export interface MatchMeta {
  date: Date;
  subject: string;
  emailLink: string;
}

// ---- UI contract (serialisable: dates as ISO strings) ----

export interface ApplicationView {
  id: string;
  company: string;
  role: string;
  type: string;
  status: Status;
  appliedOn: string;
  lastUpdate: string;
  portalUrl: string;
  portalKind: PortalKind;
  emailLink: string;
  lastSubject: string;
  notes: string;
}

export interface EventView {
  id: string;
  title: string;
  organization: string;
  kind: EventKind;
  startsAt: string;
  allDay: boolean;
  link: string;
  emailLink: string;
  /** Link to the event in Google Calendar, when it was added. */
  calendarLink: string;
}

export interface DashboardData {
  user: { name: string; email: string; image: string } | null;
  applications: ApplicationView[];
  /** Upcoming (and the last 24 h of) events, soonest first. */
  events: EventView[];
  lastSyncAt: string | null;
  /** 'reauth' when Google access was revoked or expired; other strings are error messages. */
  syncError: string | null;
  /** First-run backfill of the last 180 days is still in progress. */
  backfilling: boolean;
  claude: boolean;
}
