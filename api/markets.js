module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const symbols = {
    dow:  '^dji',
    ndx:  '^ndq',
    spx:  '^spx',
    oil:  'cl.f',
    gas:  'ng.f',
    gld:  'gc.f',
  };

  try {
    const results = await Promise.all(
      Object.entries(symbols).map(async ([key, sym]) => {
        const r = await fetch(
          `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcvn&e=json`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        const d = await r.json();
        const q = d?.symbols?.[0];
        return [key, q?.close != null ? { price: q.close, open: q.open, name: q.name } : null];
      })
    );

    const data = Object.fromEntries(results);
    res.status(200).json({ ok: true, data, ts: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
