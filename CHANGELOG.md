# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-10-24

Trackex is now a hosted web app: sign in with Google, nothing to copy or install.

### Added

- Next.js 16 web app with Sign in with Google (Auth.js v5, offline access, JWT sessions).
- Background sync every 15 minutes via a GitHub Actions workflow calling a `CRON_SECRET`-protected `/api/cron` endpoint; first sync backfills the last 180 days.
- Incremental sync using Gmail's `after:` query and a processed-message table, so no email is extracted twice.
- Dedicated "Trackex" Google Calendar for interviews, assessments and hackathon/registration/submission/application deadlines, at the exact time in the user's time zone, with popup reminders 1 day and 1 hour before (all-day items: 9 AM and 6 PM the day before).
- Neon Postgres storage with Drizzle ORM; Google refresh tokens encrypted with AES-256-GCM (`TOKEN_KEY`).
- Dashboard with stats, search and filters, "Sync now", and "Disconnect & delete data".
- Public `/demo` page with sample data and a `/privacy` page.
- `docs/SETUP.md` owner setup guide.

### Changed

- Permissions are narrower: `gmail.readonly` and `calendar.app.created` (only the calendar Trackex creates), plus openid/email/profile.
- Claude extraction runs up to 8 emails in parallel with structured JSON output; the keyword-rule fallback is kept.
- Email bodies are no longer stored; only application and event metadata.
- Documentation rewritten for v2.

### Removed

- The Google Apps Script version and the Google Sheet template.
- The clasp tooling and bundling scripts.

## [1.2.0] - 2026-10-21

### Fixed

- Status-portal links now use the email's own "track your application" link, even when
  its text is only "click here" (Trackex reads the sentence before each link), falling
  back to the candidate portal and then the careers site. A careers link never replaces
  a tracking link, and links not present in the email are discarded.
- Rejections now update the existing application: companies are normalised ("Stripe
  Recruiting" = "Stripe, Inc."), roles match fuzzily ("SWE Intern" = "Software
  Engineering Intern – Summer 2027"), and many more rejection phrasings are recognised.
- Duplicate rows created by earlier versions are merged automatically on every scan,
  keeping the earliest application date, the newest status and your notes.

### Changed

- Faster scans: Gmail messages are loaded per page in one batched call, and Claude
  extraction runs in parallel batches (`UrlFetchApp.fetchAll`), so each run covers
  ~2× more threads.
- "Reset & rescan" is now **Re-check all emails**: it updates rows in place and keeps
  your notes instead of clearing the Applications tab.
- Gmail search also matches "candidacy", "unfortunately" and "regret".

## [1.1.0] - 2026-10-20

### Added

- Personal one-click dashboard link: setup publishes your copy as a private web app
  (*Only myself*) and shows the link, ready to bookmark or install as an app. Re-running
  setup updates the same deployment, so the link never changes.
- **Trackex → 🔗 Get my Trackex link** menu item and an **Open as app** button on the dashboard.
- Single-file install: the release's `Code.gs` now contains the dashboard HTML, so a manual install is one paste.
- README guide for using a Google account that isn't the browser's default (Apps Script multi-account limitation).

### Changed

- OAuth scopes are now declared explicitly in `appsscript.json`, adding Apps Script
  project/deployment scopes for the link and full Sheets access so the web app can open your sheet.

### Fixed

- The dashboard can load outside the sheet (in the web app) by resolving the spreadsheet from its saved id.

## [1.0.0] - 2026-10-20

### Added

- Gmail scanning every 30 minutes, with a 180-day backfill on first run.
- Application tracking with a forward-only status pipeline: Applied, Under
  Review, Assessment, Interview, Offer, Rejected, Withdrawn.
- Status-portal link detection for common ATS domains such as Greenhouse, Lever,
  Workday, and Ashby.
- In-sheet dashboard with search and filters, including status-portal and email
  links.
- Google Calendar deadlines (hackathons, assessments, interviews) in a "Trackex
  Deadlines" calendar, with reminders at 3 days, 1 day, and 2 hours, and
  de-duplication.
- Optional Claude structured extraction with keyword-heuristic fallback.
- One-click setup from the template sheet menu (Trackex, then Start tracking).

[2.0.0]: https://github.com/shloksrivastava2509/trackex/releases/tag/v2.0.0
[1.2.0]: https://github.com/shloksrivastava2509/trackex/releases/tag/v1.2.0
[1.1.0]: https://github.com/shloksrivastava2509/trackex/releases/tag/v1.1.0
[1.0.0]: https://github.com/shloksrivastava2509/trackex/releases/tag/v1.0.0
