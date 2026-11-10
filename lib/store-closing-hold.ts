// lib/store-closing-hold.ts
// Client-safe rule for the Store Closing "On Hold" reason: it becomes the issue sent to
// Ops + IT + Finance, so the employee must say why before the closing can be submitted.

export const HOLD_REASON_MIN = 10;
export const HOLD_REASON_MAX = 1000;

/** Null when the reason is good enough to submit On Hold. */
export function holdReasonProblem(reason: string | null | undefined): string | null {
  const t = (reason ?? '').trim();
  if (t.length === 0) return 'Isi alasan On Hold terlebih dahulu — alasan ini dikirim sebagai issue ke Ops, Finance, dan IT.';
  if (t.length < HOLD_REASON_MIN) return `Alasan On Hold minimal ${HOLD_REASON_MIN} karakter — jelaskan masalahnya.`;
  if (t.length > HOLD_REASON_MAX) return `Alasan On Hold maksimal ${HOLD_REASON_MAX} karakter.`;
  return null;
}
