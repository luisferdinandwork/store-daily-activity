// lib/email/graph-mail.ts
// ─────────────────────────────────────────────────────────────────────────────
// Outgoing email through Microsoft Graph (Microsoft 365 / Exchange Online),
// sent as the no-reply mailbox. Server-only.
//
// Uses the OAuth2 client-credentials flow of an Entra ID app registration that
// has the *application* permission Mail.Send (admin-consented):
//
//   AZURE_TENANT_ID       Directory (tenant) ID
//   AZURE_CLIENT_ID       Application (client) ID
//   AZURE_CLIENT_SECRET   Client secret *value* (not the secret ID)
//   MAIL_FROM             Sender mailbox, default no-reply@panatradeprestasi.com
//
// Not configured: in development every email is printed to the server console
// instead (so the flow can be tested locally); in production sendMail() fails
// with a clear error, which the callers record and show to IT.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_MAIL_FROM = 'no-reply@panatradeprestasi.com';

const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';
const REQUEST_TIMEOUT_MS = 15_000;

export interface MailMessage {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text version — used for the dev console output. */
  text: string;
}

export type SendMailResult =
  | { success: true; mode: 'graph' | 'console' }
  | { success: false; error: string };

interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  from: string;
}

function readConfig(): GraphConfig | null {
  const tenantId = process.env.AZURE_TENANT_ID?.trim();
  const clientId = process.env.AZURE_CLIENT_ID?.trim();
  const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret, from: mailFromAddress() };
}

export function mailFromAddress(): string {
  return process.env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
}

/** True when real email delivery is configured (otherwise dev prints to the console). */
export function isMailConfigured(): boolean {
  return readConfig() !== null;
}

// ─── Access token (cached per process until shortly before expiry) ───────────

const globalForMail = globalThis as unknown as {
  __graphToken?: { value: string; expiresAt: number; key: string };
};

async function getAccessToken(cfg: GraphConfig): Promise<string> {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  const cached = globalForMail.__graphToken;
  if (cached && cached.key === key && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.value;

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        scope: GRAPH_SCOPE,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    // error_description starts with an AADSTS code that says exactly what is wrong
    // (bad secret, wrong tenant, expired secret …) — keep its first line only.
    const detail = json.error_description?.split('\n')[0] ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`Azure token request failed: ${detail}`);
  }

  globalForMail.__graphToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    key,
  };
  return json.access_token;
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export async function sendMail(message: MailMessage): Promise<SendMailResult> {
  const recipients = (Array.isArray(message.to) ? message.to : [message.to])
    .map((a) => a.trim())
    .filter(Boolean);
  if (recipients.length === 0) return { success: false, error: 'No recipient.' };

  const cfg = readConfig();
  if (!cfg) {
    if (process.env.NODE_ENV === 'production') {
      return {
        success: false,
        error: 'Email is not configured on the server (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET).',
      };
    }
    console.log(
      [
        '',
        '──────── [mail:dev] not sent — Azure mail is not configured ────────',
        `From:    ${mailFromAddress()}`,
        `To:      ${recipients.join(', ')}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '─────────────────────────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
    return { success: true, mode: 'console' };
  }

  try {
    const token = await getAccessToken(cfg);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.from)}/sendMail`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: 'HTML', content: message.html },
            toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          },
          // A no-reply mailbox doesn't need a copy of every reset email.
          saveToSentItems: false,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    );

    if (res.status === 202 || res.ok) return { success: true, mode: 'graph' };

    if (res.status === 401) globalForMail.__graphToken = undefined;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const detail = body.error ? `${body.error.code ?? ''} ${body.error.message ?? ''}`.trim() : `HTTP ${res.status}`;
    return { success: false, error: `Graph sendMail failed: ${detail}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mail] send failed:', msg);
    return { success: false, error: msg };
  }
}
