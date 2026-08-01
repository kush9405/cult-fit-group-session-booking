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

3. **Edit your preferences** — open `.github/workflows/book-class.yml` and adjust the `env:` block: `PREFERRED_CENTER`, `PREFERRED_WORKOUT`, `PREFERRED_SLOTS`, `DAYS_AHEAD`, `ENABLE_WAITLIST`.

4. **Enable Actions** — go to the Actions tab, enable workflows if prompted.

5. **Test it manually** — Actions tab → "Auto Book Cult Class" → "Run workflow" → check the logs.

6. From then on it runs automatically every night at 10:05 PM IST (cron `35 16 * * *` UTC).

## Token expiry

`at`/`st` cookies typically expire after 7–30 days. When a run fails with an auth error, get a fresh curl/cookie from the browser and update the three secrets.

## Notes

- Logic ported from a working n8n workflow, validated against a real Cult.fit API response.
- Skips booking if you already have a booking/waitlist entry for the target date (won't double-book).
