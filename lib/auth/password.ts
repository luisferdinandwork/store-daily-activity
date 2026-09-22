// lib/auth/password.ts
// ─────────────────────────────────────────────────────────────────────────────
// One password policy for every place a password is created or reset.
//
//   • at least 8 characters (was 6 — trivially guessable for a NIK-based login)
//   • at most 72 BYTES — bcrypt silently truncates beyond that, so a longer
//     password would give a false sense of strength (and huge inputs are a
//     cheap CPU-DoS vector against bcrypt)
//   • must not simply equal the user's NIK
//
// The demo seed password ("password123") satisfies this on purpose.
// ─────────────────────────────────────────────────────────────────────────────

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export function validateNewPassword(
  password: unknown,
  opts: { nik?: string | null } = {},
): { ok: true } | { ok: false; error: string } {
  if (typeof password !== 'string' || password.length === 0) {
    return { ok: false, error: 'Password is required.' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return { ok: false, error: `Password is too long (max ${PASSWORD_MAX_BYTES} bytes).` };
  }
  if (opts.nik && password.trim().toLowerCase() === opts.nik.trim().toLowerCase()) {
    return { ok: false, error: 'Password must not be the same as the NIK.' };
  }
  return { ok: true };
}
