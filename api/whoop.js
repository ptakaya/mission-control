// Vercel Serverless Function -- WHOOP API proxy
//
// Architecture note: WHOOP uses rotating refresh tokens that expire quickly.
// The simplest robust approach: store the access token directly.
// Access tokens last ~60 minutes. When expired, re-run scripts/get-whoop-token.js
// and update WHOOP_ACCESS_TOKEN in Vercel. A proper long-term solution (Firestore
// token persistence) can be built when back at base.
//
// Environment variables required (set in Vercel dashboard):
//   WHOOP_ACCESS_TOKEN   (from scripts/get-whoop-token.js -- expires in ~60 min)

const ACCESS_TOKEN = (process.env.WHOOP_ACCESS_TOKEN || '').trim();
const V1 = 'https://api.prod.whoop.com/developer/v1';
const V2 = 'https://api.prod.whoop.com/developer/v2';

function msToHM(ms) {
  if (!ms) return '0h 0m';
  const totalMin = Math.round(ms / 60000);
  return `${Math.floor(totalMin / 60)}h ${totalMin % 60}m`;
}

async function safeJson(res, label) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch(e) { throw new Error(`${label} (${res.status}): ${text.slice(0,150)}`); }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  if (!ACCESS_TOKEN) {
    return res.status(500).json({ ok: false, error: 'WHOOP_ACCESS_TOKEN not set in Vercel env vars' });
  }

  const h = { Authorization: `Bearer ${ACCESS_TOKEN}` };

  try {
    // Confirmed working endpoints: v2/recovery, v1/cycle
    const [recRes, cycleRes, weekRes] = await Promise.all([
      fetch(`${V2}/recovery?limit=1`, { headers: h }),
      fetch(`${V1}/cycle?limit=1`,    { headers: h }),
      fetch(`${V2}/recovery?limit=7`, { headers: h })
    ]);

    const [recData, cycleData, weekData] = await Promise.all([
      safeJson(recRes,   'recovery'),
      safeJson(cycleRes, 'cycle'),
      safeJson(weekRes,  'weeklyRecovery')
    ]);

    const rec   = recData.records?.[0];
    const cycle = cycleData.records?.[0];
    const week  = (weekData.records || []).reverse();

    // Field names confirmed from live API response
    const recovery = rec?.score ? {
      score: Math.round(rec.score.recovery_score    ?? 0),
      hrv:   Math.round(rec.score.hrv_rmssd_milli   ?? 0),
      rhr:   Math.round(rec.score.resting_heart_rate ?? 0),
      spo2:  (rec.score.spo2_percentage              ?? 0).toFixed(1)
    } : null;

    const strain = cycle?.score ? {
      score:  parseFloat((cycle.score.strain          ?? 0).toFixed(1)),
      avg_hr: Math.round(cycle.score.average_heart_rate ?? 0),
      max_hr: Math.round(cycle.score.max_heart_rate     ?? 0)
    } : null;

    const weeklyRecovery = week.map(r => ({
      date:  (r.created_at || '').slice(0, 10),
      score: r.score ? Math.round(r.score.recovery_score ?? 0) : null
    }));

    return res.status(200).json({ ok: true, recovery, strain, sleep: null, weeklyRecovery });

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
