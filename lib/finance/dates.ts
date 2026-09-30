// lib/finance/dates.ts
// Calendar-day helpers shared by Finance's daily pages (Setoran, Uang Modal,
// Store Closing) — client-safe, no DB imports.
//
// Day-buckets are midnight of the calendar day in the *server's* zone — the same
// `new Date(y, m-1, d)` the schedule / task utils use, which is UTC midnight on
// the prod server but Jakarta midnight on a dev machine. Every date here
// travels as a plain "YYYY-MM-DD" string and is only turned into a Date range
// at the DB edge (see dayBounds), so both conventions resolve to the same day.

/** Today's YYYY-MM-DD in Jakarta — whatever zone the browser / server runs in. */
export function todayJakarta(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

export function shiftDate(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/**
 * "2026-09-29" → [start, end) of that calendar day in the server's zone, or null
 * when it isn't a real date. A range (not equality on midnight) so rows written
 * by a UTC seed script and rows written on a Jakarta machine both land on the day.
 */
export function dayBounds(iso: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const start = new Date(y, mo - 1, d);
  if (start.getFullYear() !== y || start.getMonth() !== mo - 1 || start.getDate() !== d) return null;
  return { start, end: new Date(y, mo - 1, d + 1) };
}

/** [start, end) of a YYYY-MM month in the server's zone. */
export function monthBounds(month: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return { start: new Date(y, mo - 1, 1), end: new Date(y, mo, 1) };
}

/** Calendar day (YYYY-MM-DD, server zone) of a stored day-bucket timestamp. */
export function dayKey(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

/** "2026-09-29" → local-midnight Date, for calendar widgets (inverse of dayKey). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** [start, end) UTC instants of a Jakarta calendar day range (`to` inclusive) — Jakarta is UTC+7 with no DST. */
export function jakartaRangeBounds(from: string, to: string): { start: Date; end: Date } {
  return {
    start: new Date(`${from}T00:00:00+07:00`),
    end: new Date(`${shiftDate(to, 1)}T00:00:00+07:00`),
  };
}

/** True for a real "YYYY-MM-DD" calendar date. */
export function isIsoDay(iso: string): boolean {
  return dayBounds(iso) !== null;
}

export function fmtDateLong(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

export function fmtDateShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', timeZone: 'UTC',
  });
}

/** "1 Sep – 29 Sep 2026" (year shown once when both ends share it); a single day collapses to one date. */
export function fmtRange(from: string, to: string): string {
  const fmt = (iso: string, year: boolean) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('id-ID', {
      day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC',
    });
  if (from === to) return fmt(from, true);
  return `${fmt(from, from.slice(0, 4) !== to.slice(0, 4))} – ${fmt(to, true)}`;
}

export function fmtDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
