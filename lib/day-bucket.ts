// lib/day-bucket.ts
//
// Day buckets — the `date` column of schedules, monthly schedule entries,
// attendance and task rows — mean a calendar day in the store's timezone
// (Asia/Jakarta: UTC+7, no DST). Pure + client-safe (no DB imports).
//
// The DB holds two encodings of the same day D:
//   • `D-1 17:00:00` — Jakarta midnight; what the app writes (its server runs on
//     Jakarta time, so `new Date(y, m-1, d)` lands there). ~95% of the rows.
//   • `D 00:00:00`   — UTC midnight; what the seed scripts write (Date.UTC).
// Both instants fall inside Jakarta day D. So READ a bucket with
// jakartaDateKey() and QUERY a day with jakartaDayRange() — never
// getUTCDate(), toISOString().slice(0, 10) or an exact timestamp match, which
// split the two encodings onto different days (the schedule export did exactly
// that and shifted most days one day early).

export const STORE_TIME_ZONE = 'Asia/Jakarta';

const OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" of the Jakarta calendar day an instant falls on ('' if invalid). */
export function jakartaDateKey(input: Date | string | number): string {
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's "YYYY-MM-DD" in Jakarta, whatever zone the browser / server runs in. */
export function jakartaTodayKey(): string {
  return jakartaDateKey(Date.now());
}

/** "YYYY-MM" of the Jakarta calendar day an instant falls on. */
export function jakartaYearMonth(input: Date | string | number): string {
  return jakartaDateKey(input).slice(0, 7);
}

/** True for a real "YYYY-MM-DD" calendar date. */
export function isDayKey(value: string): boolean {
  const m = DAY_KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** The instant Jakarta day `ymd` starts — the app's own bucket encoding. */
export function jakartaDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
}

/** [start, end) instants of Jakarta day `ymd` — matches both stored encodings. */
export function jakartaDayRange(ymd: string): { start: Date; end: Date } {
  const start = jakartaDayStart(ymd);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** [start, end) from Jakarta day `from` through `to`, both inclusive. */
export function jakartaDaysRange(from: string, to: string): { start: Date; end: Date } {
  return { start: jakartaDayStart(from), end: jakartaDayRange(to).end };
}

/** [start, end) of the Jakarta month "YYYY-MM". */
export function jakartaMonthRange(yearMonth: string): { start: Date; end: Date } {
  const [y, m] = yearMonth.split('-').map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start: jakartaDayStart(`${yearMonth}-01`), end: jakartaDayStart(next) };
}

/** "YYYY-MM-DD" shifted by `days` calendar days. */
export function addDaysKey(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Number of days in the month "YYYY-MM". */
export function daysInMonthKey(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** The real instant of Jakarta wall-clock `time` ("HH:MM[:SS]") on day `ymd`. */
export function jakartaWallClock(ymd: string, time: string): Date {
  const [h, m, s] = time.split(':').map(Number);
  return new Date(jakartaDayStart(ymd).getTime() + ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000);
}

/** "HH:MM" Jakarta wall clock of an instant ('' if missing / invalid). */
export function jakartaTime(input: Date | string | null | undefined): string {
  if (!input) return '';
  const t = input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (Number.isNaN(t)) return '';
  return new Date(t + OFFSET_MS).toISOString().slice(11, 16);
}
