# cultfit-group-session-booking

Books your preferred Cult.fit class automatically every night at 10:05 PM IST, using GitHub Actions (free, no server needed).

## Setup

1. **Create a new GitHub repository** (private is recommended) and push these files to it (`index.js`, `package.json`, `.github/workflows/book-class.yml`).

2. **Add secrets** — in the repo, go to Settings → Secrets and variables → Actions → New repository secret. Add:
   - `CULT_DEVICE_ID`
   - `CULT_AT_TOKEN`
   - `CULT_ST_TOKEN`
   - `MAIL_APP_PASSWORD` (for email notifications — see below)

   (Get the cult.fit values from the website: log in, open browser DevTools → Network tab, click any request to `cult.fit`, and read the `deviceId`, `at`, and `st` values from the request cookie. Paste values with no surrounding quotes.)

### Email notifications

Every run emails you the result (booked / no match / already booked / error) via Gmail SMTP. To enable it:

1. Turn on 2-Step Verification on your Google account (required for app passwords): https://myaccount.google.com/security
2. Generate an App Password: https://myaccount.google.com/apppasswords → app name "GitHub Actions" → copy the 16-character password it gives you.
3. Add that 16-character value as the `MAIL_APP_PASSWORD` secret (no quotes, no spaces).

Emails send from and to `kushagraagarwal2003@gmail.com` — edit the `to`/`username`/`from` fields in `.github/workflows/book-class.yml` if you want to change that.

### Calendar event

When a class is booked, the result email includes a calendar event for it:
- an **"Add to Google Calendar" link** in the body (one click), and
- a **`class.ics` attachment** that opens in Google Calendar, Apple Calendar or Outlook.

The event uses the class's real date and start time (IST), lasts `CLASS_DURATION_MINUTES` (default 50) unless the API gives an end time, and reminds you 1 hour before. Waitlisted classes are labelled `[Waitlist]`. Set `PREFERRED_CENTER_NAME` in the workflow to show your center's name as the event location.

### Automatically add classes to Google Calendar (optional)

With this set up, every booked class is put straight into your Google Calendar — no clicking. It uses a Google "service account" (a robot account) that you give permission to edit your calendar. One-time setup, ~10 minutes:

1. **Create a Google Cloud project** — go to https://console.cloud.google.com/projectcreate, name it e.g. `cultfit-booker`, click Create. (Free; no billing needed.)
2. **Enable the Calendar API** — open https://console.cloud.google.com/apis/library/calendar-json.googleapis.com, make sure your new project is selected at the top, click **Enable**.
3. **Create the service account** — go to https://console.cloud.google.com/iam-admin/serviceaccounts → **Create service account** → name it `cultfit-booker` → **Create and continue** → skip the optional role/access steps → **Done**.
4. **Download its key** — click the new service account → **Keys** tab → **Add key → Create new key → JSON** → Create. A `.json` file downloads. Keep it private.
   - If you see "Service account key creation is disabled", your Google account is under an organisation policy that blocks keys — use a personal Gmail account for the Cloud project instead.
5. **Copy the service account's email** — it looks like `cultfit-booker@your-project.iam.gserviceaccount.com` (also in the JSON as `client_email`).
6. **Share your calendar with it** — open https://calendar.google.com → ⚙️ Settings → under "Settings for my calendars" click your calendar → **Share with specific people or groups → Add people** → paste the service account email → permission **"Make changes to events"** → Send.
7. **Find your Calendar ID** — on that same settings page, scroll to **Integrate calendar → Calendar ID**. For your main calendar it's just your Gmail address.
8. **Add two GitHub secrets** (Settings → Secrets and variables → Actions):
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — paste the **entire contents** of the downloaded `.json` file.
   - `GOOGLE_CALENDAR_ID` — the Calendar ID from step 7.

That's it. On the next booking, the run log will show `Added to Google Calendar: <link>` and the email will say it was added automatically. Booked classes show in green, waitlisted ones in yellow with a `[Waitlist]` prefix, each with a 1-hour reminder. Re-running for the same class updates the event rather than duplicating it. If these secrets aren't set (or the API call fails), the booking still succeeds and you get the manual link + `.ics` attachment instead.

3. **Edit your preferences** — open `.github/workflows/book-class.yml` and adjust the `env:` block: `PREFERRED_CENTER`, `PREFERRED_WORKOUT`, `PREFERRED_SLOTS`, `DAYS_AHEAD`, `ENABLE_WAITLIST`.

4. **Enable Actions** — go to the Actions tab, enable workflows if prompted.

5. **Test it manually** — Actions tab → "Auto Book Cult Class" → "Run workflow" → check the logs.

6. From then on it runs automatically every night at 10:05 PM IST (cron `35 16 * * *` UTC).

## Token expiry

`at`/`st` cookies typically expire after 7–30 days. When a run fails with an auth error, get a fresh curl/cookie from the browser and update the three secrets.

## Notes

- Logic ported from a working n8n workflow, validated against a real Cult.fit API response.
- Skips booking if you already have a booking/waitlist entry for the target date (won't double-book).
