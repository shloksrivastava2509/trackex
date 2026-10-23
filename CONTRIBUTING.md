# Contributing to Trackex

Thanks for your interest in improving Trackex. Bug reports, feature ideas, and
pull requests are all welcome. By participating you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Prerequisites: Node.js 20 or newer, and a free Neon database. For sign-in you
also need a Google Cloud OAuth client; see [docs/SETUP.md](docs/SETUP.md).

1. Fork and clone the repository.
2. Install dependencies:

   ```sh
   npm ci
   ```

3. Copy the example environment file and fill it in:

   ```sh
   cp .env.example .env.local
   ```

   A separate Neon branch for development is recommended. Never use
   production credentials locally.
4. Create the tables and start the app:

   ```sh
   npm run db:push
   npm run dev
   ```

Test with an account whose email you are comfortable processing.

## Checks

Before opening a pull request, run:

```sh
npm run check   # lint + typecheck + tests
npm run build   # production build
```

## Conventions

- TypeScript strict mode; match the existing code style and the ESLint config.
- Keep pure logic in `lib/` so it can be tested with Vitest (`test/v2/`).
- Do not add new runtime dependencies without discussing it in an issue first.
- Never commit secrets, API keys, personal data or real email content.
- Add or update tests for behavior changes where practical.

## Commit style

Conventional Commits are used, for example:

```
feat: detect Teamtailor status portals
fix: avoid duplicate calendar events for rescheduled interviews
docs: clarify setup steps
```

## Pull request process

1. Create a branch from `main`.
2. Make focused changes and keep the pull request small where possible.
3. Run the checks above and try the change locally.
4. Update `CHANGELOG.md` under an `Unreleased` heading.
5. Open a pull request and fill in the template. A maintainer will review it,
   and may ask for changes before merging.

## Reporting bugs and requesting features

Use the issue templates. When pasting logs, remove any personal email
content first. For security problems, follow [SECURITY.md](SECURITY.md) instead
of opening a public issue.
