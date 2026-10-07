// lib/store-email.ts
//
// stores.email — the store's shared mailbox. "Lupa password" matches it
// against what staff type and sends every reset email there
// (lib/db/utils/password-reset.ts). Stored trimmed + lowercase. Several stores
// may share one mailbox, so it isn't unique.

import { isValidEmail, normalizeEmail } from '@/lib/password-reset';

export function parseStoreEmail(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || !isValidEmail(raw)) {
    return { ok: false, error: 'Invalid store email address.' };
  }
  return { ok: true, value: normalizeEmail(raw) };
}
