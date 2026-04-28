module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const stooqSymbols = { dow: '^dji', ndx: '^ndq', spx: '^spx', oil: 'cl.f', gas: 'ng.f', gld: 'gc.f' };

  try {
    // Fetch Stooq, VIX (CBOE), and 10Y yield (US Treasury) in parallel
    const [stooqResults, vixRes, treasuryRes] = await Promise.all([
      Promise.all(
        Object.entries(stooqSymbols).map(async ([key, sym]) => {
          const r = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcvn&e=json`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const d = await r.json();
          const q = d?.symbols?.[0];
          return [key, q?.close != null ? { price: q.close, open: q.open } : null];
        })
      ),
      fetch('https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VIX.json'),
      fetch('https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=' + new Date().toISOString().slice(0,7).replace('-',''))
    ]);

    const data = Object.fromEntries(stooqResults);

    // VIX
    const vixJson = await vixRes.json();
    const vixPrice = vixJson?.data?.close ?? vixJson?.data?.last_sale_price;
    if (vixPrice != null) data.vix = { price: vixPrice, open: null };

    // 10Y Yield
    const xml = await treasuryRes.text();
    const yields = [...xml.matchAll(/<d:BC_10YEAR[^>]*>([^<]+)<\/d:BC_10YEAR>/g)].map(m => parseFloat(m[1]));
    const tny = yields[yields.length - 1];
    if (tny != null) data.tny = { price: tny, open: null };

    res.status(200).json({ ok: true, data, ts: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
