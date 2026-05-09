// Vercel Serverless Function -- Google Calendar API proxy
// Environment variables required (set in Vercel dashboard):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID  (optional, defaults to 'primary')

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const TZ = 'America/Los_Angeles';

async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token'
    }).toString()
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('OAuth failed: ' + JSON.stringify(d));
  return d.access_token;
}

function formatTime(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ
    });
  } catch (_) { return null; }
}

const chipToColorId = { sky: '1', emerald: '2', violet: '3', rose: '6', amber: '5' };
const colorIdToChip = { '1':'sky','2':'emerald','3':'violet','4':'rose','5':'amber','6':'rose','7':'emerald','8':'sky','9':'violet','10':'emerald','11':'rose' };

function buildEvent(title, date, startTime, endTime, allDay, color) {
  const colorId = chipToColorId[color] || '1';
  if (allDay) {
    return { summary: title, colorId, start: { date }, end: { date } };
  }
  const parse12 = (t) => {
    if (!t) return null;
    const m = t.trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!m) return t; // already HH:MM
    let h = parseInt(m[1]);
    const min = m[2], period = m[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2,'0')}:${min}`;
  };
  const start24 = parse12(startTime) || '09:00';
  let end24 = parse12(endTime);
  if (!end24) {
    const [h, min] = start24.split(':').map(Number);
    end24 = `${String(h + 1).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
  }
  return {
    summary: title,
    colorId,
    start: { dateTime: `${date}T${start24}:00`, timeZone: TZ },
    end:   { dateTime: `${date}T${end24}:00`,   timeZone: TZ }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getAccessToken();
    const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;

    if (req.method === 'GET') {
      const now = new Date();
      const threeMonths = new Date();
      threeMonths.setMonth(threeMonths.getMonth() + 3);
      const params = new URLSearchParams({
        timeMin: now.toISOString(),
        timeMax: threeMonths.toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250'
      });
      const r = await fetch(`${base}?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.error) return res.status(400).json({ ok: false, error: d.error.message });
      const events = (d.items || []).map(ev => ({
        id: ev.id,
        title: ev.summary || 'Untitled',
        date: (ev.start.date || ev.start.dateTime || '').slice(0, 10),
        time: formatTime(ev.start.dateTime),
        endTime: formatTime(ev.end.dateTime),
        allDay: !!ev.start.date,
        color: colorIdToChip[ev.colorId] || 'sky'
      }));
      return res.status(200).json({ ok: true, events });
    }

    if (req.method === 'POST') {
      const { title, date, startTime, endTime, allDay, color } = req.body;
      if (!title || !date) return res.status(400).json({ ok: false, error: 'Missing title or date' });
      const r = await fetch(base, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEvent(title, date, startTime, endTime, allDay, color))
      });
      const created = await r.json();
      if (created.error) return res.status(400).json({ ok: false, error: created.error.message });
      return res.status(201).json({ ok: true, id: created.id });
    }

    if (req.method === 'PATCH') {
      const { id, title, date, startTime, endTime, allDay, color } = req.body;
      if (!id) return res.status(400).json({ ok: false, error: 'Missing event id' });
      const r = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEvent(title, date, startTime, endTime, allDay, color))
      });
      const updated = await r.json();
      if (updated.error) return res.status(400).json({ ok: false, error: updated.error.message });
      return res.status(200).json({ ok: true, id: updated.id });
    }

    if (req.method === 'DELETE') {
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ ok: false, error: 'Missing event id' });
      const r = await fetch(`${base}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (r.status === 204 || r.ok) return res.status(200).json({ ok: true });
      return res.status(400).json({ ok: false, error: 'Delete failed' });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
