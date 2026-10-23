# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| 1.x     | No        |

## Reporting a Vulnerability

Please do not open a public issue for security problems.

Report vulnerabilities privately through GitHub Security Advisories:
https://github.com/shloksrivastava2509/trackex/security/advisories/new

Include as much detail as you can: what you found, steps to reproduce, the
affected version, and the potential impact. Please do not include real personal
email content in your report. I will acknowledge your report as soon as I can,
work with you on a fix, and credit you in the release notes if you wish.

## Scope and Security Model

Trackex is a hosted Next.js app that you (or someone you trust) deploy. Things
worth knowing when assessing its security:

- **Minimal Google scopes.** `gmail.readonly` (Trackex never sends, deletes or
  labels mail) and `calendar.app.created` (only the calendar Trackex creates,
  not your others), plus openid/email/profile.
- **Tokens encrypted at rest.** Google refresh tokens are stored with
  AES-256-GCM using the server-only `TOKEN_KEY`.
- **No email bodies stored.** Only application and event metadata is kept in
  the database.
- **Protected cron endpoint.** `/api/cron` requires `Authorization: Bearer
  CRON_SECRET`; the secret is compared in constant time.
- **Email content leaves the server only if a key is set.** Without
  `ANTHROPIC_API_KEY`, Trackex uses keyword rules. With one, email content is
  sent to `api.anthropic.com` for extraction.
- **Your deployment, your secrets.** `AUTH_SECRET`, `TOKEN_KEY`, `CRON_SECRET`,
  OAuth credentials and API keys must live in environment variables or GitHub
  Actions secrets, never in the repository. Rotating `TOKEN_KEY` invalidates
  stored tokens, so users must sign in again.
- **Delete on request.** "Disconnect & delete data" removes the Trackex
  calendar, revokes Google access and deletes the user's rows.

Reports about misconfiguration of your own Google account, or issues in Google
Google, Neon, Vercel, GitHub, or the Claude API themselves, are out of scope for this
project and should be reported to the respective vendor.
