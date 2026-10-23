// lib/email-address.ts
//
// users.email is optional for every account. Client-safe (no DB).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blank → `{ ok: true, value: null }` (no email); otherwise a trimmed, lower-cased address. */
export function parseOptionalEmail(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: 'Email is not valid.' };

  const value = raw.trim().toLowerCase();
  if (!value) return { ok: true, value: null };
  if (value.length > 254 || !EMAIL_RE.test(value)) return { ok: false, error: 'Email is not valid.' };
  return { ok: true, value };
}
