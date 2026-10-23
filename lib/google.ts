// Minimal Google REST client: token refresh + JSON fetch with retries. Plain fetch keeps
// serverless bundles small (the official googleapis package is ~80 MB).

/** The user revoked access or the refresh token expired: they must sign in again. */
export class GoogleAuthError extends Error {}

export class GoogleApiError extends Error {
  constructor(readonly status: number, readonly body: string, url: string) {
    super(`Google API ${status} for ${url.split('?')[0]}: ${body.slice(0, 300)}`);
  }
}

export async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? '',
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (res.ok && body.access_token) return body.access_token;
  if (body.error === 'invalid_grant' || res.status === 401) throw new GoogleAuthError('Google access was revoked or expired');
  throw new GoogleApiError(res.status, JSON.stringify(body), 'oauth2/token');
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

/** JSON request with bearer auth; retries 429/5xx with backoff. Returns null for 204. */
export async function googleFetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers }
    });
    if (res.ok) return (res.status === 204 ? null : await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (res.status === 401) throw new GoogleAuthError('Google rejected the access token');
    throw new GoogleApiError(res.status, await res.text(), url);
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
