// Cult.fit auto-booking script — same logic already validated in the n8n workflow,
// ported to plain Node.js so it can run as a GitHub Actions scheduled job (free, no server).

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
      return { found: true, classId: classObj.id, slot: classObj.startTime, state: classObj.state };
    }
  }

  return { found: false, debug };
}

async function main() {
  const targetDateStr = getTargetDateIST(DAYS_AHEAD);
  console.log(`Target booking date (IST, +${DAYS_AHEAD}d): ${targetDateStr}`);
  console.log(`Preferences: center=${PREFERRED_CENTER} workout="${PREFERRED_WORKOUT}" slots=${PREFERRED_SLOTS.join(',')} waitlist=${ENABLE_WAITLIST}`);

  const classesResponse = await getClasses();
  const result = findMatch(classesResponse, targetDateStr);

  if (!result.found) {
    if (result.alreadyBooked) {
      console.log('You already have a booking/waitlist entry for this date. Skipping.');
      return;
    }
    console.log('No matching class found.');
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Match found: classId=${result.classId} slot=${result.slot} state=${result.state}. Booking...`);
  const bookingResponse = await bookClass(result.classId);
  console.log('Class booked successfully!');
  console.log(bookingResponse);
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
