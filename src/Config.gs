/**
 * Trackex — configuration.
 *
 * Per-user state (calendar id, scan progress, the optional Anthropic API key) lives in
 * UserProperties, never in code or the sheet. Set the key from the sheet menu:
 *   Trackex → Set Claude API key
 */
const APP_NAME = 'Trackex';

const CONFIG = {
  // How far back the very first scan looks. After the backfill finishes,
  // each run only looks at the last INCREMENTAL_LOOKBACK_DAYS.
  INITIAL_LOOKBACK_DAYS: 180,
  INCREMENTAL_LOOKBACK_DAYS: 7,

  // Apps Script kills a run after 6 minutes; stop early and resume next run.
  MAX_RUNTIME_MS: 4.5 * 60 * 1000,
  MAX_THREADS_PER_RUN: 80,

  SCAN_EVERY_MINUTES: 30, // must be 1, 5, 10, 15 or 30

  // Gmail search: only threads matching at least one of these are inspected.
  SEARCH_TERMS: [
    'application', 'applied', 'applying', 'candidate', 'interview', 'assessment',
    'internship', 'intern', 'offer', 'recruiting', 'recruiter', 'hiring',
    '"coding challenge"', 'hackerrank', 'codesignal', 'codility',
    'hackathon', 'devpost', 'mlh', 'unstop', 'deadline', 'registration',
    'submission', 'fellowship', 'greenhouse', 'lever', 'workday', 'ashby'
  ],
  // Promotions is NOT excluded: Devpost/MLH/Unstop mail often lands there.
  EXCLUDE_QUERY: '-in:chats -in:spam -in:trash',

  TRACKED_LABEL: 'Trackex',                  // applied to threads that produced data
  CALENDAR_NAME: 'Trackex Deadlines',
  GMAIL_THREAD_URL: 'https://mail.google.com/mail/u/0/#all/',

  // Popup reminders (minutes before) added to every calendar event.
  REMINDERS_MIN: [3 * 24 * 60, 24 * 60, 120],

  // Claude (optional — falls back to keyword heuristics without a key).
  CLAUDE_MODEL: 'claude-opus-5-5',
  CLAUDE_EFFORT: 'low',             // classification/extraction doesn't need deep thinking
  CLAUDE_MAX_BODY_CHARS: 12000,     // long newsletters are clipped; the signal is near the top
  CLAUDE_MAX_LINKS: 40
};

// Ordered pipeline stages; a later email can only move status within this
// model if it is newer than the last update (see Store.upsertApplication).
const STATUSES = ['Applied', 'Under Review', 'Assessment', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];

// Domains of applicant-tracking systems — links to these are usually the status portal.
const ATS_DOMAINS = [
  'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com', 'icims.com',
  'smartrecruiters.com', 'ashbyhq.com', 'jobvite.com', 'taleo.net', 'successfactors',
  'oraclecloud.com', 'brassring.com', 'workable.com', 'bamboohr.com', 'recruitee.com',
  'joinhandshake.com', 'linkedin.com/jobs', 'wellfound.com', 'eightfold.ai',
  'hackerrank.com', 'codesignal.com', 'codility.com', 'devpost.com', 'mlh.io',
  'unstop.com', 'hackerearth.com', 'devfolio.co'
];

// UserProperties, not ScriptProperties: Google copies script properties along with
// the sheet, so anything stored there would leak from the template into every copy.
function prop_(name) {
  return PropertiesService.getUserProperties().getProperty(name);
}

function setProp_(name, value) {
  PropertiesService.getUserProperties().setProperty(name, String(value));
}

// The user's real timezone (their primary calendar's), not the script's: copies of the
// template keep whatever timezone the template was created with.
let tzCache_ = null;
function userTimeZone_() {
  if (!tzCache_) tzCache_ = CalendarApp.getDefaultCalendar().getTimeZone() || Session.getScriptTimeZone();
  return tzCache_;
}

function deleteProp_(name) {
  PropertiesService.getUserProperties().deleteProperty(name);
}
