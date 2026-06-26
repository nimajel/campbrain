const SCOPE = "https://www.googleapis.com/auth/calendar.events";

export function buildConsentUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string | null;
}

export async function exchangeCode(
  opts: {
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token exchange failed: ${res.status} ${detail}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in,
    scope: json.scope ?? null,
  };
}

// ─── CSRF state (HMAC-SHA256, Web Crypto, base64url) ─────────────────────────
// Format: `${base64url(userId)}.${base64url(hmac(userId))}`

function toBase64Url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeTextBase64Url(text: string): string {
  return toBase64Url(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

function decodeBase64UrlToText(b64: string): string | null {
  try {
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function decodeBase64UrlToBuffer(b64: string): ArrayBuffer | null {
  try {
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return bytes.buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const keyBytes = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signState(userId: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const data = new TextEncoder().encode(userId);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  return `${encodeTextBase64Url(userId)}.${toBase64Url(sig)}`;
}

export async function verifyState(state: string, secret: string): Promise<string | null> {
  const dot = state.indexOf(".");
  if (dot === -1) return null;

  const userIdB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);

  const userId = decodeBase64UrlToText(userIdB64);
  if (!userId) return null;

  const providedSig = decodeBase64UrlToBuffer(sigB64);
  if (!providedSig) return null;

  const key = await importHmacKey(secret);
  const data = new TextEncoder().encode(userId);
  const expectedSig = await crypto.subtle.sign("HMAC", key, data);

  // Constant-time comparison via subtle.verify
  const valid = await crypto.subtle.verify("HMAC", key, providedSig, data);
  // Double-check: re-sign and compare lengths to guard against subtleties
  const expectedBytes = new Uint8Array(expectedSig);
  const providedBytes = new Uint8Array(providedSig);
  if (expectedBytes.length !== providedBytes.length) return null;

  return valid ? userId : null;
}
