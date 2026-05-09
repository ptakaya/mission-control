#!/usr/bin/env node
// One-time script to get a Google OAuth refresh token for Calendar API.
//
// SETUP (do this once):
//   1. Go to console.cloud.google.com
//   2. Create a new project (or use an existing one)
//   3. Enable the Google Calendar API
//   4. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID
//   5. Choose "Desktop app" as the application type
//   6. Download or copy the Client ID and Client Secret
//
// RUN:
//   GOOGLE_CLIENT_ID=your_id GOOGLE_CLIENT_SECRET=your_secret node scripts/get-oauth-token.js
//
// Then add the printed values to Vercel:
//   vercel.com > your project > Settings > Environment Variables

const http = require('http');
const { exec } = require('child_process');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nMissing credentials. Run as:\n');
  console.error('GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=xxx node scripts/get-oauth-token.js\n');
  process.exit(1);
}

const REDIRECT = 'http://localhost:3000/callback';
const SCOPES = 'https://www.googleapis.com/auth/calendar';

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth' +
  '?client_id=' + encodeURIComponent(CLIENT_ID) +
  '&redirect_uri=' + encodeURIComponent(REDIRECT) +
  '&response_type=code' +
  '&scope=' + encodeURIComponent(SCOPES) +
  '&access_type=offline' +
  '&prompt=consent';

console.log('\nOpening browser for Google authorization...');
console.log('\nIf it does not open, visit this URL:\n\n' + authUrl + '\n');

exec('open "' + authUrl + '"');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');
  if (url.pathname !== '/callback') { res.end(); return; }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.end('Authorization denied: ' + error + '. Check your terminal.');
    server.close();
    console.error('\nAuthorization denied:', error);
    return;
  }

  if (!code) { res.end('No authorization code received.'); return; }

  res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#eee"><h2>Authorization received.</h2><p>Check your terminal for the credentials.</p></body></html>');
  server.close();

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code'
    }).toString()
  });

  const tokens = await tokenRes.json();

  if (tokens.refresh_token) {
    console.log('\n✓ Success! Add these to Vercel Environment Variables:\n');
    console.log('  GOOGLE_CLIENT_ID=' + CLIENT_ID);
    console.log('  GOOGLE_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('  GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token);
    console.log('  GOOGLE_CALENDAR_ID=primary\n');
    console.log('Vercel: vercel.com > mission-control project > Settings > Environment Variables\n');
  } else {
    console.error('\nFailed to get refresh token:');
    console.error(JSON.stringify(tokens, null, 2));
    if (tokens.error === 'invalid_client') {
      console.error('\nHint: Check that your Client ID and Secret are correct.');
    }
  }
});

server.listen(3000, () => {
  console.log('Waiting for Google authorization on http://localhost:3000...\n');
});
