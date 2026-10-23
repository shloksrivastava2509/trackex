# Setting up your own Trackex

This guide is for the person **deploying** Trackex. People who use your deployment only click **Sign in with Google**.
Budget about 15 minutes. You need accounts on GitHub, Neon, Google Cloud and Vercel (all have free tiers).

## 1. Fork and clone

```bash
# Fork shloksrivastava2509/trackex on GitHub first, then:
git clone https://github.com/<you>/trackex.git && cd trackex
npm ci
cp .env.example .env.local
```

## 2. Create the database (Neon)

1. In [Neon](https://neon.tech), choose **New project** and create it.
2. On the project dashboard, open **Connect** and copy the **pooled** connection string.
3. Put it in `.env.local` as `DATABASE_URL`.
4. Create the tables:

   ```bash
   npm run db:push
   ```

## 3. Configure Google Cloud

1. In the [Google Cloud console](https://console.cloud.google.com), create a new project.
2. Go to **APIs & Services → Library** and enable both **Gmail API** and **Google Calendar API**.
3. Go to **Google Auth Platform** (the OAuth consent screen) and set it up:
   - **Branding:** app name `Trackex`, a support email, **App home page** = your deployed URL, **Application privacy policy link** = `<your URL>/privacy`, and add your Vercel domain (for example `trackex.vercel.app`) under **Authorized domains**.
   - **Audience:** user type **External**.
   - **Data access → Add or remove scopes:** add `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.app.created`.
   - **Audience → Publish app**, so the status is **In production**. Do not leave it in Testing: refresh tokens issued in Testing mode expire after 7 days, which breaks background sync.
4. Go to **Clients → Create client**, choose **Web application**, and add these **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://<your-app>.vercel.app/api/auth/callback/google`
5. Copy the **Client ID** and **Client secret** into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

You will not know the Vercel URL until step 5. Create the client now with the localhost URI, then come back and add the production URI and the consent-screen fields.

## 4. Generate secrets

Run `openssl rand -base64 32` three times and set:

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Signs Auth.js sessions |
| `TOKEN_KEY` | Encrypts Google refresh tokens at rest (must be 32 bytes, base64) |
| `CRON_SECRET` | Protects `/api/cron`; shared with GitHub Actions |

Optional:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables Claude extraction. Without it Trackex uses keyword rules. |
| `CLAUDE_MODEL` | Defaults to `claude-opus-5-5` |

## 5. Deploy to Vercel

1. In [Vercel](https://vercel.com): **Add New → Project** and import your GitHub fork.
2. Open **Environment Variables** and add everything from `.env.example`: `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `DATABASE_URL`, `TOKEN_KEY`, `CRON_SECRET`, and optionally `ANTHROPIC_API_KEY` and `CLAUDE_MODEL`.
3. Click **Deploy** and note the URL.
4. Go back to Google Cloud and make sure the production redirect URI, the app home page, the privacy policy link and the authorized domain all use that URL (step 3).

## 6. Turn on the 15-minute sync (GitHub Actions)

Vercel's free plan only runs cron jobs daily, so `.github/workflows/sync.yml` calls `POST /api/cron` every 15 minutes.

1. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `APP_URL` (for example `https://trackex.vercel.app`, no trailing slash).
3. Add `CRON_SECRET` (the same value as on Vercel).
4. Open the **Actions** tab, choose **Sync inboxes**, then **Run workflow** to test it.

## 7. Sign in

1. Open your app and click **Sign in with Google**.
2. Google shows "Google hasn't verified this app". Click **Advanced → Go to Trackex**.
3. Allow both permissions. Keep both boxes ticked.
4. On the dashboard, click **Sync now** to start the first sync, which backfills the last 180 days.

## Local development

```bash
cp .env.example .env.local   # fill in the values above
npm run db:push
npm run dev
```

Open http://localhost:3000. Using a separate Neon branch for development is recommended.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Access blocked" or `redirect_uri_mismatch` | The redirect URI in your OAuth client does not exactly match `<origin>/api/auth/callback/google`. Add it (step 3.4). |
| "Trackex needs both Gmail read and Calendar access" | A permission box was unticked on Google's screen. Sign in again and keep both ticked. |
| "Google access expired" banner | Sign in again. If it keeps happening, check that the consent screen is **In production**, not Testing. |
| Sync not running | Check the `APP_URL` and `CRON_SECRET` secrets and the **Actions** tab. Scheduled workflows pause after 60 days of repo inactivity: re-enable the workflow there. |
| Everything is keyword-based | No `ANTHROPIC_API_KEY` is configured, so Trackex is in keyword mode. Add a key on Vercel and redeploy. |
