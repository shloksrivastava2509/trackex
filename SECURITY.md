# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

Please do not open a public issue for security problems.

Report vulnerabilities privately through GitHub Security Advisories:
https://github.com/shloksrivastava2509/trackex/security/advisories/new

Include as much detail as you can: what you found, steps to reproduce, the
affected version, and the potential impact. Please do not include real personal
email content in your report. I will acknowledge your report as soon as I can,
work with you on a fix, and credit you in the release notes if you wish.

## Scope and Security Model

Trackex is a Google Apps Script bound to a Google Sheet. Things worth knowing
when assessing its security:

- **Runs entirely in your Google account.** The script runs under the account
  that owns the copy of the sheet. There is no Trackex server and no data is
  sent to the maintainer.
- **API key storage.** If you choose to set a Claude API key, it is stored in
  Apps Script `UserProperties`, which is per-user. It is never written to the
  sheet or to the source code.
- **Email content leaves your account only if you set a key.** Without an API
  key, Trackex uses local keyword heuristics and sends nothing to third
  parties. With a key set, relevant email content is sent to `api.anthropic.com`
  for structured extraction.
- **Web app deployment.** If you deploy the script as a web app, the access
  setting must be **"Only myself"**. Deploying with broader access is
  unsupported and may expose your data.
- **Never share your script ID or API key.** Do not commit `.clasp.json` or any
  key to a public repository.

Reports about misconfiguration of your own Google account, or issues in Google
Apps Script, Gmail, or the Claude API themselves, are out of scope for this
project and should be reported to the respective vendor.
