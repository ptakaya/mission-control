// Cloudflare Worker -- Mission Control Market Data
// Deploy this at: dash.cloudflare.com > Workers > Create Worker
// Paste this code, deploy, copy the worker URL, and paste it into
// the MARKETS_WORKER_URL constant in index.html.

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // Cache responses for 5 minutes to stay well within Stooq's limits
    const cache = caches.default;
    const cacheKey = new Request('https://mc-markets-cache/v1', { method: 'GET' });
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const stooqSymbols = {
      dow: '^dji',
      ndx: '^ndq',
      spx: '^spx',
      oil: 'cl.f',
      gas: 'ng.f',
      gld: 'gc.f'
    };

    try {
      const [stooqResults, vixRes, treasuryRes] = await Promise.all([
        Promise.all(
          Object.entries(stooqSymbols).map(async ([key, sym]) => {
            const r = await fetch(
              `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcvn&e=json`,
              { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }
            );
            const d = await r.json();
            const q = d?.symbols?.[0];
            return [key, q?.close != null ? { price: parseFloat(q.close), open: parseFloat(q.open) } : null];
          })
        ),
        fetch('https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json'),
        fetch(
          'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml' +
          '?data=daily_treasury_yield_curve&field_tdr_date_value_month=' +
          new Date().toISOString().slice(0, 7).replace('-', '')
        )
      ]);

      const data = Object.fromEntries(stooqResults);

      try {
        const vixJson = await vixRes.json();
        const vixPrice = vixJson?.data?.close ?? vixJson?.data?.last_sale_price;
        if (vixPrice != null) data.vix = { price: parseFloat(vixPrice), open: null };
      } catch (_) {}

      try {
        const xml = await treasuryRes.text();
        const yields = [...xml.matchAll(/<d:BC_10YEAR[^>]*>([^<]+)<\/d:BC_10YEAR>/g)].map(m => parseFloat(m[1]));
        const tny = yields[yields.length - 1];
        if (tny != null) data.tny = { price: tny, open: null };
      } catch (_) {}

      const body = JSON.stringify({ ok: true, data, ts: new Date().toISOString() });
      const response = new Response(body, {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60'
        }
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
};
