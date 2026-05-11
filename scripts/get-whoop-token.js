#!/usr/bin/env node
// One-time script to get a WHOOP OAuth refresh token.
//
// RUN:
//   WHOOP_CLIENT_ID=your_id WHOOP_CLIENT_SECRET=your_secret node scripts/get-whoop-token.js
//
// Then add the printed values to Vercel:
//   vercel.com > mission-control project > Settings > Environment Variables

const http = require('http');
const { exec } = require('child_process');

const CLIENT_ID     = process.env.WHOOP_CLIENT_ID;
const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nMissing credentials. Run as:\n');
  console.error('WHOOP_CLIENT_ID=xxx WHOOP_CLIENT_SECRET=xxx node scripts/get-whoop-token.js\n');
  process.exit(1);
}

const REDIRECT = 'http://localhost:3000/callback';
const SCOPES   = 'read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement offline';
const STATE    = require('crypto').randomBytes(16).toString('hex');

const authUrl =
  'https://api.prod.whoop.com/oauth/oauth2/auth' +
  '?client_id='     + encodeURIComponent(CLIENT_ID) +
  '&redirect_uri='  + encodeURIComponent(REDIRECT) +
  '&response_type=code' +
  '&scope='         + encodeURIComponent(SCOPES) +
  '&state='         + STATE;

console.log('\nOpening browser for WHOOP authorization...');
console.log('\nIf it does not open, visit:\n\n' + authUrl + '\n');

exec('open "' + authUrl + '"');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname !== '/callback') { res.end(); return; }

  const code        = url.searchParams.get('code');
  const error       = url.searchParams.get('error');
  const returnState = url.searchParams.get('state');

  if (error) {
    res.end('Authorization denied: ' + error);
    server.close();
    console.error('\nAuthorization denied:', error);
    return;
  }

  if (returnState !== STATE) {
    res.end('State mismatch -- possible CSRF. Try again.');
    server.close();
    console.error('\nState mismatch. Try running the script again.');
    return;
  }

  if (!code) { res.end('No authorization code received.'); return; }

  res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2>WHOOP authorized.</h2><p>Check your terminal for the credentials.</p></body></html>');
  server.close();

  const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT,
      grant_type:    'authorization_code'
    }).toString()
  });

  const tokens = await tokenRes.json();

  if (tokens.refresh_token) {
    console.log('\n✓ Success! Add these to Vercel Environment Variables:\n');
    console.log('  WHOOP_CLIENT_ID='     + CLIENT_ID);
    console.log('  WHOOP_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('  WHOOP_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('\nVercel: vercel.com > mission-control project > Settings > Environment Variables\n');
  } else {
    console.error('\nFailed to get refresh token:');
    console.error(JSON.stringify(tokens, null, 2));
  }
});

server.listen(3000, () => {
  console.log('Waiting for WHOOP authorization on http://localhost:3000...\n');
});
