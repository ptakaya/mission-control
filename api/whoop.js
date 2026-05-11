// Vercel Serverless Function -- WHOOP API proxy
// Handles WHOOP's rotating refresh tokens by returning the new token to the client,
// which stores it in localStorage and sends it back on subsequent requests.
//
// Environment variables required (set in Vercel dashboard):
//   WHOOP_CLIENT_ID
//   WHOOP_CLIENT_SECRET
//   WHOOP_REFRESH_TOKEN  (seed token -- replaced by localStorage on client after first use)

const CLIENT_ID     = (process.env.WHOOP_CLIENT_ID     || '').trim();
const CLIENT_SECRET = (process.env.WHOOP_CLIENT_SECRET || '').trim();
const ENV_TOKEN     = (process.env.WHOOP_REFRESH_TOKEN || '').trim();
const BASE          = 'https://api.prod.whoop.com/developer/v1';

async function getAccessToken(refreshToken) {
  const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET
    }).toString()
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('WHOOP OAuth failed: ' + JSON.stringify(d));
  return { accessToken: d.access_token, newRefreshToken: d.refresh_token || null };
}

function msToHM(ms) {
  if (!ms) return '0h 0m';
  const totalMin = Math.round(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

async function safeJson(res, label) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error(`${label} returned ${res.status}: ${text.slice(0,200)}`); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Whoop-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!CLIENT_ID || !CLIENT_SECRET || !ENV_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Missing env vars', debug: {
      hasClientId: !!CLIENT_ID, hasClientSecret: !!CLIENT_SECRET, hasEnvToken: !!ENV_TOKEN
    }});
  }

  // Use client-supplied token (from localStorage) if present, else fall back to env var
  const refreshToken = (req.headers['x-whoop-token'] || '').trim() || ENV_TOKEN;

  try {
    const { accessToken, newRefreshToken } = await getAccessToken(refreshToken);
    const h = { Authorization: `Bearer ${accessToken}` };

    // Fetch latest recovery, cycle, sleep, and last 7 recoveries in parallel
    const [recRes, cycleRes, sleepRes, weekRes] = await Promise.all([
      fetch(`${BASE}/recovery/collection?limit=1`, { headers: h }),
      fetch(`${BASE}/cycle/collection?limit=1`,    { headers: h }),
      fetch(`${BASE}/sleep/collection?limit=1`,    { headers: h }),
      fetch(`${BASE}/recovery/collection?limit=7`, { headers: h })
    ]);

    const [recData, cycleData, sleepData, weekData] = await Promise.all([
      safeJson(recRes,   'recovery'),
      safeJson(cycleRes, 'cycle'),
      safeJson(sleepRes, 'sleep'),
      safeJson(weekRes,  'weeklyRecovery')
    ]);

    const rec   = recData.records?.[0];
    const cycle = cycleData.records?.[0];
    const sleep = sleepData.records?.[0];
    const week  = (weekData.records || []).reverse();

    const recovery = rec?.score ? {
      score: Math.round(rec.score.recovery_score ?? 0),
      hrv:   Math.round(rec.score.hrv_rms_sd ?? 0),
      rhr:   Math.round(rec.score.resting_heart_rate ?? 0),
      spo2:  (rec.score.spo2_percentage ?? 0).toFixed(1)
    } : null;

    const strain = cycle?.score ? {
      score:  parseFloat((cycle.score.strain ?? 0).toFixed(1)),
      avg_hr: Math.round(cycle.score.average_heart_rate ?? 0),
      max_hr: Math.round(cycle.score.max_heart_rate ?? 0)
    } : null;

    const sleepOut = sleep?.score ? {
      performance: Math.round(sleep.score.sleep_performance_percentage ?? 0),
      stages: {
        light: msToHM(sleep.score.stage_summary?.total_light_sleep_time_milli),
        deep:  msToHM(sleep.score.stage_summary?.total_slow_wave_sleep_time_milli),
        rem:   msToHM(sleep.score.stage_summary?.total_rem_sleep_time_milli),
        awake: msToHM(sleep.score.stage_summary?.total_awake_time_milli),
        total: msToHM(
          (sleep.score.stage_summary?.total_light_sleep_time_milli  ?? 0) +
          (sleep.score.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) +
          (sleep.score.stage_summary?.total_rem_sleep_time_milli ?? 0)
        )
      }
    } : null;

    const weeklyRecovery = week.map(r => ({
      date:  (r.created_at || '').slice(0, 10),
      score: r.score ? Math.round(r.score.recovery_score ?? 0) : null
    }));

    return res.status(200).json({
      ok: true,
      recovery,
      strain,
      sleep: sleepOut,
      weeklyRecovery,
      // Return new refresh token so client can persist it for next call
      newRefreshToken: newRefreshToken || null
    });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
