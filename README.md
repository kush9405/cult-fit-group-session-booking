# cultfit-booker

Books your preferred Cult.fit class automatically every night at 10:05 PM IST, using GitHub Actions (free, no server needed).

## Setup

1. **Create a new GitHub repository** (private is recommended) and push these files to it (`index.js`, `package.json`, `.github/workflows/book-class.yml`).

2. **Add secrets** — in the repo, go to Settings → Secrets and variables → Actions → New repository secret. Add:
   - `CULT_DEVICE_ID`
   - `CULT_AT_TOKEN`
   - `CULT_ST_TOKEN`

   (Get these from cult.fit's website: log in, open browser DevTools → Network tab, click any request to `cult.fit`, and read the `deviceId`, `at`, and `st` values from the request cookie.)

3. **Edit your preferences** — open `.github/workflows/book-class.yml` and adjust the `env:` block: `PREFERRED_CENTER`, `PREFERRED_WORKOUT`, `PREFERRED_SLOTS`, `DAYS_AHEAD`, `ENABLE_WAITLIST`.

4. **Enable Actions** — go to the Actions tab, enable workflows if prompted.

5. **Test it manually** — Actions tab → "Auto Book Cult Class" → "Run workflow" → check the logs.

6. From then on it runs automatically every night at 10:05 PM IST (cron `35 16 * * *` UTC).

## Token expiry

`at`/`st` cookies typically expire after 7–30 days. When a run fails with an auth error, get a fresh curl/cookie from the browser and update the three secrets.

## Notes

- Logic ported from a working n8n workflow, validated against a real Cult.fit API response.
- Skips booking if you already have a booking/waitlist entry for the target date (won't double-book).
