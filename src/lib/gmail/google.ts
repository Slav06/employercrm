// Minimal Google OAuth + Gmail REST client (read-only). Plain fetch keeps the bundle small.

export const STATE_COOKIE = 'gmail_oauth_state';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export function gmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_TOKEN_KEY);
}

export const workspaceDomain = () => process.env.GOOGLE_WORKSPACE_DOMAIN?.trim().toLowerCase() || null;

export function authUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `openid email ${GMAIL_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token
    include_granted_scopes: 'true',
    state,
  });
  const hd = workspaceDomain();
  if (hd) params.set('hd', hd);
  return `${AUTH_URL}?${params}`;
}

export class GoogleAuthError extends Error {}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    // invalid_grant = revoked/expired refresh token → user must reconnect.
    throw new GoogleAuthError(`${json.error ?? res.status}: ${json.error_description ?? ''}`.trim());
  }
  return json;
}

export const exchangeCode = (code: string, redirectUri: string) =>
  tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });

export const refreshAccessToken = (refreshToken: string) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });

export async function revoke(token: string) {
  await fetch(`${REVOKE_URL}?${new URLSearchParams({ token })}`, { method: 'POST' }).catch(() => {});
}

// id_token comes straight from Google's token endpoint over TLS, so reading the payload is enough.
export function idTokenClaims(idToken?: string): { email?: string; hd?: string } {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export class GmailApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export class Gmail {
  constructor(private accessToken: string) {}

  private async get<T>(path: string, params: Record<string, string | string[] | undefined> = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) qs.append(k, item);
    }
    const res = await fetch(`${API}${path}${qs.size ? `?${qs}` : ''}`, {
      headers: { authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) throw new GmailApiError(res.status, `Gmail ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  profile() {
    return this.get<{ emailAddress: string; historyId: string }>('/profile');
  }

  async listMessageIds(q: string, max = 500) {
    const ids: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.get<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>('/messages', {
        q,
        maxResults: '100',
        pageToken,
      });
      ids.push(...(page.messages ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids;
  }

  message(id: string, format: 'metadata' | 'full' = 'metadata') {
    return this.get<GmailMessage>(`/messages/${id}`, {
      format,
      metadataHeaders: format === 'metadata' ? ['From', 'To', 'Cc', 'Subject', 'Date'] : undefined,
    });
  }

  thread(id: string) {
    return this.get<{ id: string; messages?: GmailMessage[] }>(`/threads/${id}`, {
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
    });
  }

  // Throws GmailApiError(404) when startHistoryId is too old → caller rescans.
  async historySince(startHistoryId: string) {
    const added: { id: string; threadId: string; labelIds: string[] }[] = [];
    let pageToken: string | undefined;
    let historyId = startHistoryId;
    do {
      const page = await this.get<{
        history?: { messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
        historyId: string;
        nextPageToken?: string;
      }>('/history', { startHistoryId, historyTypes: 'messageAdded', maxResults: '500', pageToken });
      for (const h of page.history ?? []) {
        for (const m of h.messagesAdded ?? []) {
          added.push({ id: m.message.id, threadId: m.message.threadId, labelIds: m.message.labelIds ?? [] });
        }
      }
      historyId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
    return { added, historyId };
  }
}

// ---- message helpers ----

export function header(m: GmailMessage, name: string) {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

export function addresses(value: string) {
  return [...value.matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
}

export function messageDate(m: GmailMessage) {
  return m.internalDate ? new Date(Number(m.internalDate)) : new Date(header(m, 'Date') || Date.now());
}

// Text + raw HTML of the body (HTML kept raw so link hrefs survive). Only used to match sent pitches.
export function bodyForMatching(m: GmailMessage) {
  const out: string[] = [];
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.body?.data && (p.mimeType === 'text/plain' || p.mimeType === 'text/html')) {
      out.push(Buffer.from(p.body.data, 'base64url').toString('utf8'));
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  return out.join('\n');
}
