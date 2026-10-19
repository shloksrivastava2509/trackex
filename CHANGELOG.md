# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.0.0]: https://github.com/shloksrivastava2509/trackex/releases/tag/v1.0.0
