# Mission Control

Personal dashboard for Pat. Live market data, Google Calendar two-way sync, tasks, and backlog.

**Live URL:** https://mission-control-umber.vercel.app
**Installed as PWA** on Pat's phone and Mac dock.

---

## Stack

| Layer | Service | Notes |
|-------|---------|-------|
| Hosting | Vercel (Hobby) | Auto-deploys from GitHub on every push to `main` |
| Repo | github.com/ptakaya/mission-control | Push here, Vercel picks it up |
| Market data | Cloudflare Worker | `wispy-butterfly-334c.patricktakaya.workers.dev` |
| Calendar API | Vercel Function (`/api/calendar`) | Proxies Google Calendar API |
| Task/backlog sync | Firebase Firestore | Project: `mission-control-9cf29` |

---

## Market Data (Cloudflare Worker)

**Why Cloudflare and not Vercel:** Stooq blocks Vercel's AWS datacenter IPs. Cloudflare edge IPs are not blocked.

**Worker URL:** `https://wispy-butterfly-334c.patricktakaya.workers.dev`

**Data sources (all free, no API keys):**
- Stooq -- DOW, NASDAQ, S&P 500, WTI Crude, Natural Gas, Gold
- CBOE CDN -- VIX
- US Treasury XML -- 10-Year Yield

**Caching:** Worker caches responses for 5 minutes to stay within Stooq's rate limits.

**To update the Worker:** Log into dash.cloudflare.com > Workers & Pages > wispy-butterfly-334c > Edit code. Paste updated `worker-markets.js`.

**Weekend behavior:** Stooq returns null for closed markets. Dashboard shows last Friday's closing prices and falls back to Simulated for null values. Goes live Monday morning automatically.

---

## Google Calendar (Vercel Function)

**File:** `api/calendar.js`

**How it works:** Vercel function proxies all Calendar API calls. Stores OAuth credentials as environment variables so they never touch the browser.

**OAuth:** Uses a refresh token (never expires unless unused for 6+ months or manually revoked). The function auto-refreshes the access token on every request -- no manual intervention needed.

**Google Cloud project:** Morning Briefing Agent (morning-briefing-agent-491115)
**OAuth client:** "Claude MCP" (Desktop app type) -- shared with Claude's calendar MCP

**Vercel environment variables** (set at vercel.com > mission-control > Settings > Environment Variables):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID` (set to `primary`)

**If the calendar stops working:** The refresh token almost certainly expired or was revoked. Re-run the OAuth script to get a new one:
```
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=xxx node scripts/get-oauth-token.js
```
Then update `GOOGLE_REFRESH_TOKEN` in Vercel environment variables and redeploy.

---

## Firebase / Firestore

Used for: tasks and backlog real-time sync across devices.
**Not used for:** calendar (calendar now comes directly from Google Calendar API).

Firebase project ID: `mission-control-9cf29`
Firebase config is embedded in `index.html` (web API key -- this is intentional and safe for client-side Firebase).
Firestore document: `users/pat`

---

## Deploying Changes

1. Edit files locally in `/Users/patricktakaya/mission-control-repo/`
2. `git add` + `git commit` + `git push`
3. Vercel auto-deploys in ~30 seconds
4. Hard refresh the PWA on phone/Mac to pick up the update (or wait -- service worker checks for updates on load)

**To update the Cloudflare Worker separately:** Edit in the CF dashboard (see Market Data section above). Worker changes are independent of the Vercel deploy.

---

## If Something Breaks

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Markets showing "Simulated" | CF Worker down or Stooq changed their format | Check Worker URL in index.html is correct; open Worker URL directly in browser to see raw response |
| Calendar not loading | OAuth refresh token expired or revoked | Re-run `scripts/get-oauth-token.js`, update Vercel env var |
| Calendar save returns 500 | Vercel env vars missing or malformed | Check all 4 Google env vars in Vercel dashboard -- no line breaks in values |
| Tasks not syncing across devices | Firestore issue | Check Firebase console for quota or auth errors |
| PWA not updating | Service worker serving cached version | Hard refresh: hold Shift and reload, or clear site data in browser settings |
