// Vercel Serverless Function -- WHOOP API proxy
// Environment variables required (set in Vercel dashboard):
//   WHOOP_CLIENT_ID
//   WHOOP_CLIENT_SECRET
//   WHOOP_REFRESH_TOKEN

const CLIENT_ID     = (process.env.WHOOP_CLIENT_ID     || '').trim();
const CLIENT_SECRET = (process.env.WHOOP_CLIENT_SECRET || '').trim();
const REFRESH_TOKEN = (process.env.WHOOP_REFRESH_TOKEN || '').trim();
const BASE          = 'https://api.prod.whoop.com/developer/v1';

async function getAccessToken() {
  const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: REFRESH_TOKEN,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET
    }).toString()
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('WHOOP OAuth failed: ' + JSON.stringify(d));
  return d.access_token;
}

function msToHM(ms) {
  if (!ms) return '0h 0m';
  const totalMin = Math.round(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing env vars', debug: {
      hasClientId: !!CLIENT_ID, hasClientSecret: !!CLIENT_SECRET, hasRefreshToken: !!REFRESH_TOKEN
    }});
  }

  try {
    const token = await getAccessToken();
    const h = { Authorization: `Bearer ${token}` };

    // Diagnostic: test which endpoints are reachable
    const profileRes = await fetch(`${BASE}/user/profile/basic`, { headers: h });
    const profileText = await profileRes.text();
    return res.status(200).json({ ok: true, debug: true, profileStatus: profileRes.status, profileBody: profileText.slice(0, 500) });

    // Fetch latest recovery, cycle, sleep, and last 7 recoveries in parallel
    const [recRes, cycleRes, sleepRes, weekRes] = await Promise.all([
      fetch(`${BASE}/recovery/collection?limit=1`, { headers: h }),
      fetch(`${BASE}/cycle/collection?limit=1`,    { headers: h }),
      fetch(`${BASE}/sleep/collection?limit=1`,    { headers: h }),
      fetch(`${BASE}/recovery/collection?limit=7`, { headers: h })
    ]);

    // Parse each response safely, returning status info on failure
    async function safeJson(res, label) {
      const text = await res.text();
      try { return JSON.parse(text); }
      catch(e) { throw new Error(`${label} returned ${res.status}: ${text.slice(0,200)}`); }
    }

    const [recData, cycleData, sleepData, weekData] = await Promise.all([
      safeJson(recRes,   'recovery'),
      safeJson(cycleRes, 'cycle'),
      safeJson(sleepRes, 'sleep'),
      safeJson(weekRes,  'weeklyRecovery')
    ]);

    const rec   = recData.records?.[0];
    const cycle = cycleData.records?.[0];
    const sleep = sleepData.records?.[0];
    const week  = (weekData.records || []).reverse(); // oldest first for chart

    const recovery = rec?.score ? {
      score:        Math.round(rec.score.recovery_score ?? 0),
      hrv:          Math.round(rec.score.hrv_rms_sd ?? 0),
      rhr:          Math.round(rec.score.resting_heart_rate ?? 0),
      spo2:         (rec.score.spo2_percentage ?? 0).toFixed(1),
      skin_temp_c:  (rec.score.skin_temp_celsius ?? 0).toFixed(1)
    } : null;

    const strain = cycle?.score ? {
      score: parseFloat((cycle.score.strain ?? 0).toFixed(1)),
      avg_hr: Math.round(cycle.score.average_heart_rate ?? 0),
      max_hr: Math.round(cycle.score.max_heart_rate ?? 0)
    } : null;

    const sleepOut = sleep?.score ? {
      performance:  Math.round(sleep.score.sleep_performance_percentage ?? 0),
      efficiency:   Math.round(sleep.score.sleep_efficiency_percentage ?? 0),
      respiratory:  (sleep.score.respiratory_rate ?? 0).toFixed(1),
      stages: {
        light: msToHM(sleep.score.stage_summary?.total_light_sleep_time_milli),
        deep:  msToHM(sleep.score.stage_summary?.total_slow_wave_sleep_time_milli),
        rem:   msToHM(sleep.score.stage_summary?.total_rem_sleep_time_milli),
        awake: msToHM(sleep.score.stage_summary?.total_awake_time_milli),
        total: msToHM(
          (sleep.score.stage_summary?.total_light_sleep_time_milli ?? 0) +
          (sleep.score.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) +
          (sleep.score.stage_summary?.total_rem_sleep_time_milli ?? 0)
        )
      }
    } : null;

    const weeklyRecovery = week.map(r => ({
      date:  (r.created_at || '').slice(0, 10),
      score: r.score ? Math.round(r.score.recovery_score ?? 0) : null
    }));

    return res.status(200).json({ ok: true, recovery, strain, sleep: sleepOut, weeklyRecovery });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
