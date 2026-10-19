# Contributing to Trackex

Thanks for your interest in improving Trackex. Bug reports, feature ideas, and
pull requests are all welcome. By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Prerequisites: Node.js 20 or newer and a Google account.

1. Fork and clone the repository.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Enable the Apps Script API for your account at
   https://script.google.com/home/usersettings.
4. Log in to clasp:

   ```sh
   npx clasp login
   ```

5. Copy the example config and set the `scriptId` of **your own copy** of the
   template sheet's script:

   ```sh
   cp .clasp.json.example .clasp.json
   ```

   Never use the scriptId of the public template, and never commit
   `.clasp.json`.
6. Push the code to your copy:

   ```sh
   npm run push
   ```

Test changes in your own copy of the sheet, not in the public template and not
with an account whose email you are not comfortable processing.

## Checks

Before opening a pull request, run:

```sh
npm run check   # lint + tests + bundle + syntax check
```

- `npm run lint` runs ESLint.
- `npm test` runs the unit tests with `node:test`.
- `npm run bundle` builds `dist/Code.gs`.

## Conventions

- Match the existing code style; run the linter and follow `.editorconfig`.
- Keep the code compatible with the Apps Script V8 runtime. Do not use ES
  modules, `import`, or `export` in `src/`.
- Private helper functions end with an underscore (for example `parseDate_`).
- Never commit personal data, real email content, API keys, or script IDs.
- Add or update tests for behavior changes where practical.

## Commit style

Conventional Commits are suggested, for example:

```
feat: detect Teamtailor status portals
fix: avoid duplicate calendar events for rescheduled interviews
docs: clarify setup steps
```

## Pull request process

1. Create a branch from `main`.
2. Make focused changes and keep the pull request small where possible.
3. Run the checks above and test in a copy of the sheet.
4. Update `CHANGELOG.md` under an `Unreleased` heading.
5. Open a pull request and fill in the template. A maintainer will review it,
   and may ask for changes before merging.

## Reporting bugs and requesting features

Use the issue templates. When pasting execution logs, remove any personal email
content first. For security problems, follow [SECURITY.md](SECURITY.md) instead
of opening a public issue.
