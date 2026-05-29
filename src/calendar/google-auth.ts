import fs from 'fs';
import http from 'http';
import path from 'path';
import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];
const DEFAULT_REDIRECT_URI = 'http://localhost:3000/oauth2callback';

function tokenPath(): string {
  return path.join(process.cwd(), '.campbrain', 'google-token.json');
}

function printSetupInstructions(): void {
  console.log(`
📅 Google Calendar Setup Required
══════════════════════════════════════════════════════════════

CampBrain needs Google Calendar credentials to sync reminders.

Steps:
  1. Go to https://console.cloud.google.com/
  2. Create a project (or use an existing one)
  3. Enable the Google Calendar API
  4. Create OAuth 2.0 credentials (Desktop app type)
  5. Set these environment variables:

     GOOGLE_CLIENT_ID=<your client ID>
     GOOGLE_CLIENT_SECRET=<your client secret>
     GOOGLE_REDIRECT_URI=${DEFAULT_REDIRECT_URI}   (optional)

  6. In Google Cloud Console, add this to your OAuth 2.0 app's
     authorized redirect URIs:
     http://localhost:3000/oauth2callback

  7. Run: campbrain sync-calendar
     CampBrain will open an auth URL for you to visit.

══════════════════════════════════════════════════════════════
`);
}

async function waitForCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const code = url.searchParams.get('code');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <html><body style="font-family:sans-serif;padding:2rem">
          <h2>✅ CampBrain authorized!</h2>
          <p>You can close this tab and return to the terminal.</p>
        </body></html>
      `);

      server.close(() => {
        if (code) resolve(code);
        else reject(new Error('No authorization code in callback'));
      });
    });

    server.on('error', reject);
    server.listen(port, () => {
      console.log(`  Listening for OAuth callback on port ${port}…`);
    });
  });
}

async function runAuthFlow(oauth2Client: OAuth2Client, redirectUri: string): Promise<void> {
  const port = parseInt(new URL(redirectUri).port || '3000', 10);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n📅 Google Calendar authorization required.\n');
  console.log('  Open this URL in your browser:\n');
  console.log(`  ${authUrl}\n`);

  const code = await waitForCode(port);
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const tokenDir = path.dirname(tokenPath());
  if (!fs.existsSync(tokenDir)) fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(tokenPath(), JSON.stringify(tokens, null, 2) + '\n', 'utf-8');
  console.log(`  ✅ Token saved to ${tokenPath()}`);
}

export async function getAuthClient(): Promise<OAuth2Client | null> {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  const redirectUri = process.env['GOOGLE_REDIRECT_URI'] ?? DEFAULT_REDIRECT_URI;

  if (!clientId || !clientSecret) {
    printSetupInstructions();
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Load existing token
  if (fs.existsSync(tokenPath())) {
    try {
      const tokens = JSON.parse(fs.readFileSync(tokenPath(), 'utf-8')) as Record<string, unknown>;
      oauth2Client.setCredentials(tokens);

      // Refresh if expired
      const expiry = tokens['expiry_date'];
      if (typeof expiry === 'number' && expiry < Date.now() + 60_000) {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        fs.writeFileSync(tokenPath(), JSON.stringify(credentials, null, 2) + '\n', 'utf-8');
      }

      return oauth2Client;
    } catch {
      console.warn('  ⚠️  Failed to load saved token — re-authenticating…');
    }
  }

  // No token → run auth flow
  await runAuthFlow(oauth2Client, redirectUri);
  return oauth2Client;
}

export function hasCredentials(): boolean {
  return Boolean(process.env['GOOGLE_CLIENT_ID'] && process.env['GOOGLE_CLIENT_SECRET']);
}
