// Cult.fit auto-booking script — same logic already validated in the n8n workflow,
// ported to plain Node.js so it can run as a GitHub Actions scheduled job (free, no server).

const fs = require('fs');

// Writes a value to GITHUB_OUTPUT so the workflow's email-notification step can read it
// (e.g. steps.book.outputs.summary). No-op if run outside GitHub Actions.
function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    const delimiter = 'EOF_' + Math.random().toString(36).slice(2);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
  }
}

function getTargetDateIST(daysAhead) {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(istNow.getDate() + daysAhead);
  return istNow.toISOString().split('T')[0];
}

// NEW: returns e.g. "Wednesday, 2026-09-16"
function formatDayAndDateIST(dateStr) {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  const day = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  return `${day}, ${dateStr}`;
}

const API_KEY = process.env.CULT_API_KEY || '9d153009-e961-4718-a343-2a36b0a1d1fd';
const DEVICE_ID = process.env.CULT_DEVICE_ID;
const AT_TOKEN = process.env.CULT_AT_TOKEN;
const ST_TOKEN = process.env.CULT_ST_TOKEN;

const PREFERRED_CENTER = process.env.PREFERRED_CENTER || '1515';
const PREFERRED_WORKOUT = (process.env.PREFERRED_WORKOUT || 'HRX WORKOUT').trim().toUpperCase();
const PREFERRED_SLOTS = (process.env.PREFERRED_SLOTS || '07:00:00,08:00:00,09:00:00')
  .split(',')
  .map((s) => s.trim());
const DAYS_AHEAD = Number(process.env.DAYS_AHEAD || 4);
const ENABLE_WAITLIST = (process.env.ENABLE_WAITLIST || 'true').toLowerCase() === 'true';
const CLASS_DURATION_MINUTES = Number(process.env.CLASS_DURATION_MINUTES || 50);
const PREFERRED_CENTER_NAME = process.env.PREFERRED_CENTER_NAME || '';
const ICS_PATH = 'class.ics';
// Google Calendar API (optional — skipped if not set). Key = full JSON of a service-account key.
const GOOGLE_SERVICE_ACCOUNT_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '';
const GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || '';

// ---------- Calendar helpers ----------

// "2026-11-28" + "07:00:00" (IST) -> Date
function istDateTime(dateStr, timeStr) {
  const t = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateStr}T${t}+05:30`);
}

// Date -> "20261128T013000Z" (UTC, as used by iCalendar and Google Calendar links)
function toCalUTC(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsEscape(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function buildCalendarEvent({ dateStr, startTime, endTime, classId, state, location }) {
  const start = istDateTime(dateStr, startTime);
  const end = endTime
    ? istDateTime(dateStr, endTime)
    : new Date(start.getTime() + CLASS_DURATION_MINUTES * 60 * 1000);
  const waitlisted = state === 'WAITLIST_AVAILABLE';
  const title = `${waitlisted ? '[Waitlist] ' : ''}Cult.fit — ${PREFERRED_WORKOUT}`;
  const description = waitlisted
    ? `You are on the WAITLIST for this class (classId ${classId}). Check the Cult.fit app to see if it got confirmed.`
    : `Booked automatically by Cult.fit Booker (classId ${classId}).`;

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//cultfit-booker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable UID per class, so re-importing updates the same event instead of duplicating it.
    `UID:cultfit-${classId}@cultfit-booker`,
    `DTSTAMP:${toCalUTC(new Date())}`,
    `DTSTART:${toCalUTC(start)}`,
    `DTEND:${toCalUTC(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(location)}`,
    `STATUS:${waitlisted ? 'TENTATIVE' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Cult.fit class in 1 hour',
    'TRIGGER:-PT60M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const googleLink =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(title)}` +
    `&dates=${toCalUTC(start)}/${toCalUTC(end)}` +
    `&details=${encodeURIComponent(description)}` +
    `&location=${encodeURIComponent(location)}` +
    '&ctz=Asia/Kolkata';

  return { ics, googleLink, start, end, title, description, location, waitlisted };
}

// ---------- Google Calendar API (service account, no npm dependencies) ----------

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Exchanges a signed JWT for a short-lived OAuth access token (standard service-account flow).
async function getGoogleAccessToken(serviceAccount) {
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${res.status} — ${JSON.stringify(data)}`);
  return data.access_token;
}

// Adds the class to Google Calendar. The event ID is derived from the classId, so re-running
// for the same class updates the existing event instead of creating a duplicate.
async function addToGoogleCalendar(event, classId) {
  const serviceAccount = JSON.parse(GOOGLE_SERVICE_ACCOUNT_KEY);
  const token = await getGoogleAccessToken(serviceAccount);

  // Google event IDs may only use lowercase a-v and 0-9.
  const eventId = `cultfit${String(classId).toLowerCase().replace(/[^a-v0-9]/g, '')}`;
  const body = {
    id: eventId,
    summary: event.title,
    description: event.description,
    location: event.location,
    start: { dateTime: event.start.toISOString(), timeZone: 'Asia/Kolkata' },
    end: { dateTime: event.end.toISOString(), timeZone: 'Asia/Kolkata' },
    status: event.waitlisted ? 'tentative' : 'confirmed',
    colorId: event.waitlisted ? '5' : '10', // yellow for waitlist, green for booked
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 60 }] },
  };

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  let res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status === 409) {
    // Event for this class already exists — update it instead.
    res = await fetch(`${base}/${eventId}`, { method: 'PUT', headers, body: JSON.stringify(body) });
  }
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Calendar API failed: ${res.status} — ${JSON.stringify(data)}`);
  return data.htmlLink;
}

function commonHeaders() {
  if (!DEVICE_ID || !AT_TOKEN || !ST_TOKEN) {
    throw new Error('Missing CULT_DEVICE_ID / CULT_AT_TOKEN / CULT_ST_TOKEN env vars (set as GitHub Actions secrets).');
  }
  return {
    accept: 'application/json',
    apikey: API_KEY,
    appversion: '7',
    browsername: 'Chrome',
    osname: 'browser',
    timezone: 'Asia/Kolkata',
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    referer: 'https://www.cult.fit/me/profile',
    cookie: `deviceId=${DEVICE_ID}; at=${AT_TOKEN}; st=${ST_TOKEN}`,
  };
}

function getTargetDateIST(daysAhead) {
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  istNow.setDate(istNow.getDate() + daysAhead);
  return istNow.toISOString().split('T')[0];
}

async function getClasses() {
  const res = await fetch('https://www.cult.fit/api/cult/classes/v2?productType=FITNESS', {
    method: 'GET',
    headers: commonHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Get classes failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const data = await res.json();
  // API returns an array with one object (matches what we captured from a real n8n run).
  return Array.isArray(data) ? data[0] : data;
}

async function bookClass(classId) {
  const res = await fetch(`https://www.cult.fit/api/cult/class/${classId}/book`, {
    method: 'POST',
    headers: commonHeaders(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Book class failed: ${res.status} ${res.statusText} — ${text}`);
  }
  return text;
}

function findMatch(response, targetDateStr) {
  const dateEntry = response.classByDateMap && response.classByDateMap[targetDateStr];
  if (!dateEntry) {
    return { found: false, reason: `Booking window for ${targetDateStr} is not open yet.` };
  }

  // Safety net: don't double-book if we already have something on this date.
  for (const slotEntry of dateEntry.classByTimeList) {
    for (const centerEntry of slotEntry.centerWiseClasses) {
      for (const cl of centerEntry.classes) {
        if (cl.action || cl.state === 'WAITLISTED' || cl.state === 'BOOKED') {
          return { found: false, alreadyBooked: true };
        }
      }
    }
  }

  const debug = [];
  for (const slot of PREFERRED_SLOTS) {
    const slotEntry = dateEntry.classByTimeList.find((t) => t.id === slot);
    if (!slotEntry) {
      debug.push({ slot, status: 'no classes scheduled at this slot at all' });
      continue;
    }

    const centerEntry = slotEntry.centerWiseClasses.find(
      (c) => String(c.centerId) === String(PREFERRED_CENTER)
    );
    if (!centerEntry) {
      debug.push({
        slot,
        status: 'your PREFERRED_CENTER has no classes at this slot',
        centersThatDoHaveClasses: slotEntry.centerWiseClasses.map((c) => c.centerId),
      });
      continue;
    }

    const workoutsHere = centerEntry.classes.map((cl) => ({
      workoutName: cl.workoutName.trim(),
      state: cl.state,
    }));
    debug.push({ slot, workoutsAtYourCenter: workoutsHere });

    const classObj = centerEntry.classes.find(
      (cl) =>
        cl.workoutName.trim().toUpperCase() === PREFERRED_WORKOUT &&
        (cl.state === 'AVAILABLE' || (ENABLE_WAITLIST && cl.state === 'WAITLIST_AVAILABLE'))
    );

    if (classObj) {
      const location =
        PREFERRED_CENTER_NAME ||
        classObj.centerName ||
        centerEntry.centerName ||
        centerEntry.name ||
        `Cult.fit center ${PREFERRED_CENTER}`;
      return {
        found: true,
        classId: classObj.id,
        slot: classObj.startTime,
        endTime: classObj.endTime,
        state: classObj.state,
        location,
      };
    }
  }

  return { found: false, debug };
}

async function main() {
  const targetDateStr = getTargetDateIST(DAYS_AHEAD);
  const targetDayDate = formatDayAndDateIST(targetDateStr);
  console.log(`Target booking date (IST, +${DAYS_AHEAD}d): ${targetDateStr}`);
  console.log(`Preferences: center=${PREFERRED_CENTER} workout="${PREFERRED_WORKOUT}" slots=${PREFERRED_SLOTS.join(',')} waitlist=${ENABLE_WAITLIST}`);

  const classesResponse = await getClasses();
  const result = findMatch(classesResponse, targetDateStr);

  if (!result.found) {
    if (result.alreadyBooked) {
      console.log('You already have a booking/waitlist entry for this date. Skipping.');
      setOutput('outcome', 'already-booked');
      setOutput('summary', `Already had a booking/waitlist for ${targetDayDate} — skipped, nothing new booked.`);
      return;
    }
    console.log('No matching class found.');
    console.log(JSON.stringify(result, null, 2));
    setOutput('outcome', 'no-match');
    setOutput(
      'summary',
      `No matching class found for ${targetDayDate}.\nLooking for "${PREFERRED_WORKOUT}" at ${PREFERRED_SLOTS.join(', ')} (center ${PREFERRED_CENTER}).\n\nDebug:\n${JSON.stringify(result, null, 2)}`
    );
    return;
  }

  console.log(`Match found: classId=${result.classId} slot=${result.slot} state=${result.state}. Booking...`);
  const bookingResponse = await bookClass(result.classId);
  console.log('Class booked successfully!');
  console.log(bookingResponse);
  setOutput('outcome', 'booked');

  // Build a calendar event for the booked class: an .ics file (attached to the email — opens in
  // Google Calendar / Apple Calendar / Outlook) plus a one-click "Add to Google Calendar" link.
  let calendarText = '';
  let event;
  try {
    event = buildCalendarEvent({
      dateStr: targetDateStr,
      startTime: result.slot,
      endTime: result.endTime,
      classId: result.classId,
      state: result.state,
      location: result.location,
    });
    fs.writeFileSync(ICS_PATH, event.ics);
    setOutput('ics_path', ICS_PATH);
    console.log(`Calendar event written to ${ICS_PATH}`);
  } catch (err) {
    console.error('Could not create calendar event (booking itself succeeded):', err.message);
  }

  if (event) {
    // Automatically add to Google Calendar if the API secrets are configured.
    let autoAdded = false;
    if (GOOGLE_SERVICE_ACCOUNT_KEY && GOOGLE_CALENDAR_ID) {
      try {
        const link = await addToGoogleCalendar(event, result.classId);
        autoAdded = true;
        console.log(`Added to Google Calendar: ${link}`);
        calendarText += `\n\n📅 Added to your Google Calendar automatically: ${link}`;
      } catch (err) {
        console.error('Could not add to Google Calendar (booking itself succeeded):', err.message);
        calendarText += `\n\n⚠️ Could not add to Google Calendar automatically: ${err.message}`;
      }
    } else {
      console.log('GOOGLE_SERVICE_ACCOUNT_KEY / GOOGLE_CALENDAR_ID not set — skipping automatic calendar add.');
    }
    if (!autoAdded) {
      calendarText += `\n\nAdd to Google Calendar: ${event.googleLink}\n(An .ics calendar file is also attached to this email.)`;
    }
  }

  setOutput(
    'summary',
    `Booked "${PREFERRED_WORKOUT}" at ${result.slot} on ${targetDayDate} (state: ${result.state}).${calendarText}`
  );
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  setOutput('outcome', 'error');
  setOutput('summary', `Booking run failed with an error: ${err.message}`);
  process.exit(1);
});
