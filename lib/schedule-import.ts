// lib/schedule-import.ts
/**
 * Excel schedule import — deliberately forgiving.
 *
 * It accepts every schedule layout this app has ever produced or been fed:
 *
 *   • the app's own downloadable template / export
 *     (app/api/pic/schedule/template, app/api/ops/schedules/export):
 *       row A  store name          (col 0)
 *       row B  "MONTH :" | ... | "Oct-2026"
 *       row C  No | Role | Name | SUN MON TUE …      (weekday labels)
 *       row D             |      |      | 1 2 3 …    (day numbers)
 *       row E+ 1 | PIC 1 | NAME | E E X L …
 *
 *   • the "MRO SEP 2026" break-down sheets:
 *       row A  (blank) | FF DMG
 *       row B  (blank) | MONTH : | <date>
 *       row C  (blank) | (blank) | (blank) | TUE WED …
 *       row D  No | PIC | Name | 1 2 3 … 31          (labels AND day numbers)
 *       row E+ 1 | SC-A PERMANENT | OPIK | L E X …
 *       …then OPENING / MIDDLE / CLOSING / OFF summary rows, then a 2nd block.
 *
 * Anchoring is done off the "MONTH :" row; the store name, header row, day-
 * number row and weekday row are then located by scanning, not by fixed
 * offsets. Employees are resolved by NIK when present, otherwise by name
 * (normalised, matched against the target store's roster — first names like
 * "OPIK" match "Opik Ramdani"). Names that don't resolve are reported, not
 * fatal, so a multi-store sheet imported for one store just fills that store.
 *
 * Shift codes (per day cell, case-insensitive):
 *   E / M / P / PG / PAGI / MORNING       → morning
 *   L / S / SG / SIANG / EVENING          → evening
 *   F / FD / FULL / FULLDAY / D           → full day
 *   AL / A / C / CT / CU / CUTI / I /
 *     S? (only when unambiguous) / SICK / SAKIT / IZIN → leave
 *   X / O / OFF / LIBUR / "-" / (blank)   → day off
 */

import * as XLSX from 'xlsx';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import {
  createOrReplaceMonthlySchedule,
  canManageSchedule,
  dateToYearMonth,
  type DayAssignment,
} from '@/lib/schedule-utils';
import { and, eq } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportShift = 'morning' | 'evening' | 'full' | 'off' | 'leave';

export interface DayEntry {
  date: Date;
  shift: ImportShift;
}

export interface EmployeeScheduleRow {
  nik: string;
  name: string;
  pic: string;
  section: string;
  days: DayEntry[];
}

export interface ParsedScheduleFile {
  month: Date;
  sheetName: string;
  employees: EmployeeScheduleRow[];
  sections: string[];
}

export interface ImportResult {
  success: boolean;
  schedulesCreated: number;
  entriesCreated: number;
  skipped: number;
  errors: string[];
  notFound: string[];
  month?: string;
  sheet?: string;
}

export class ScheduleImportValidationError extends Error {
  public dateErrors: string[];
  constructor(dateErrors: string[]) {
    super('Schedule date validation failed');
    this.name = 'ScheduleImportValidationError';
    this.dateErrors = dateErrors;
  }
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

type Cell = string | number | boolean | Date | null | undefined;
type Row = Cell[];

function cellText(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

/** Uppercase, letters+digits only — "M. Rifal Agustian" → "MRIFALAGUSTIAN". */
function normName(v: string): string {
  return v.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normToken(v: Cell): string {
  return cellText(v).toUpperCase().replace(/[^A-Z]/g, '');
}

const MONTH_MARKER = /^month\s*:?\s*$/i;
const SUMMARY_LABELS =
  /^(opening|middle|closing|off\s*\/?\s*cuti|off|cuti|libur|total(\s+aktif)?|grand\s+total|jumlah|pagi|siang|full|al|fill\s*in.*|keterangan|legend.*)$/i;
const HEADER_WORDS = /^(no|nik|pic|role|jabatan|level|name|nama|employee(\s*name)?|karyawan)$/i;
const NAME_HEADER = /^(name|nama|employee(\s*name)?|karyawan)$/i;
const NIK_HEADER = /^(nik|employee\s*no\.?|emp\s*no\.?|no\.?\s*induk)$/i;
const ROLE_HEADER = /^(pic|role|jabatan|job\s*level|level|status)$/i;

const WEEKDAY_MAP: Record<string, number> = {
  SUN: 0, SUNDAY: 0, MINGGU: 0, MIN: 0, AHAD: 0,
  MON: 1, MONDAY: 1, SENIN: 1, SEN: 1,
  TUE: 2, TUES: 2, TUESDAY: 2, SELASA: 2, SEL: 2,
  WED: 3, WEDNESDAY: 3, RABU: 3, RAB: 3,
  THU: 4, THUR: 4, THURS: 4, THURSDAY: 4, KAMIS: 4, KAM: 4,
  FRI: 5, FRIDAY: 5, JUMAT: 5, JUM: 5,
  SAT: 6, SATURDAY: 6, SABTU: 6, SAB: 6,
};

const MONTH_NAMES: Record<string, number> = {
  JAN: 0, JANUARY: 0, JANUARI: 0,
  FEB: 1, FEBRUARY: 1, FEBRUARI: 1,
  MAR: 2, MARCH: 2, MARET: 2,
  APR: 3, APRIL: 3,
  MAY: 4, MEI: 4,
  JUN: 5, JUNE: 5, JUNI: 5,
  JUL: 6, JULY: 6, JULI: 6,
  AUG: 7, AUGUST: 7, AGUSTUS: 7, AGT: 7, AGU: 7,
  SEP: 8, SEPT: 8, SEPTEMBER: 8,
  OCT: 9, OCTOBER: 9, OKTOBER: 9, OKT: 9,
  NOV: 10, NOVEMBER: 10,
  DEC: 11, DECEMBER: 11, DESEMBER: 11, DES: 11,
};

// ─── Public parsers ───────────────────────────────────────────────────────────

export async function parseScheduleExcel(
  file: File,
  sheetName?: string,
): Promise<ParsedScheduleFile> {
  return parseScheduleBuffer(await file.arrayBuffer(), sheetName);
}

export function parseScheduleBuffer(
  buffer: ArrayBuffer,
  sheetName?: string,
): ParsedScheduleFile {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });

  const toRows = (name: string): Row[] =>
    XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], {
      header: 1,
      defval: null,
      raw: true,
      blankrows: true,
    });

  // Explicit sheet wins. Otherwise parse EVERY sheet and keep whichever
  // yields the most employee rows with day entries — robust against files
  // where a "TARGET" sheet sorts before the "MRO" schedule sheet.
  if (sheetName && wb.Sheets[sheetName]) {
    return parseSections(toRows(sheetName), sheetName);
  }

  let best: ParsedScheduleFile | null = null;
  let bestScore = -1;
  const dateErrorsSeen: string[] = [];

  for (const name of wb.SheetNames) {
    let parsed: ParsedScheduleFile;
    try {
      parsed = parseSections(toRows(name), name);
    } catch (err) {
      if (err instanceof ScheduleImportValidationError) {
        dateErrorsSeen.push(...err.dateErrors);
      }
      continue;
    }
    const score = parsed.employees.reduce((n, e) => n + e.days.length, 0);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  if (best && bestScore > 0) return best;
  if (dateErrorsSeen.length > 0) {
    throw new ScheduleImportValidationError([...new Set(dateErrorsSeen)]);
  }

  // Nothing parsed — fall back to first sheet so the caller gets a clean
  // "no employees" result rather than a crash.
  return parseSections(toRows(wb.SheetNames[0]), wb.SheetNames[0]);
}

// ─── Section-level parsing ────────────────────────────────────────────────────

function parseSections(raw: Row[], sheetName: string): ParsedScheduleFile {
  const employees: EmployeeScheduleRow[] = [];
  const sections: string[] = [];
  const dateErrors: string[] = [];

  const rows = raw.map((r) => (Array.isArray(r) ? r : []));

  // Anchor every section on its "MONTH :" row (marker anywhere in cols 0-4).
  const anchors: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < Math.min(5, rows[r].length); c++) {
      if (MONTH_MARKER.test(cellText(rows[r][c]))) {
        anchors.push(r);
        break;
      }
    }
  }

  // No "MONTH :" row at all — treat the whole sheet as one section and take
  // the month from the sheet name (e.g. "Sep-2026", "OCT 2026").
  if (anchors.length === 0) {
    const monthFromName = parseMonthLoose(sheetName);
    const section = sectionLabelAbove(rows, 0) || sheetName || 'Store';
    parseOneSection(rows, 0, rows.length, section, monthFromName ?? new Date(), employees, dateErrors);
    if (employees.length > 0) sections.push(section);
    finishOrThrow(dateErrors);
    return { month: monthFromName ?? new Date(), sheetName, employees, sections };
  }

  let month = new Date();

  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    const end = i + 1 < anchors.length ? anchors[i + 1] : rows.length;

    const section = sectionLabelAbove(rows, anchor) || sheetName || `Section ${i + 1}`;

    // Month = first parseable value to the right of the "MONTH :" marker.
    const anchorRow = rows[anchor];
    let sectionMonth: Date | null = null;
    for (let c = 0; c < anchorRow.length; c++) {
      if (MONTH_MARKER.test(cellText(anchorRow[c]))) {
        for (let d = c + 1; d < Math.min(c + 8, anchorRow.length); d++) {
          sectionMonth = parseMonthCell(anchorRow[d]);
          if (sectionMonth) break;
        }
        break;
      }
    }
    sectionMonth = sectionMonth ?? parseMonthLoose(sheetName) ?? month;
    month = sectionMonth;

    const before = employees.length;
    parseOneSection(rows, anchor + 1, end, section, sectionMonth, employees, dateErrors);
    if (employees.length > before) sections.push(section);
  }

  finishOrThrow(dateErrors);

  return {
    month,
    sheetName,
    employees,
    sections: [...new Set(sections)],
  };
}

function finishOrThrow(dateErrors: string[]) {
  if (dateErrors.length > 0) {
    throw new ScheduleImportValidationError([...new Set(dateErrors)]);
  }
}

/** First non-empty, non-header text cell scanning upward from `anchor`. */
function sectionLabelAbove(rows: Row[], anchor: number): string {
  for (let r = anchor - 1; r >= 0 && r >= anchor - 4; r--) {
    for (let c = 0; c < Math.min(5, rows[r].length); c++) {
      const t = cellText(rows[r][c]);
      if (!t) continue;
      if (MONTH_MARKER.test(t) || HEADER_WORDS.test(t) || SUMMARY_LABELS.test(t)) continue;
      if (!isNaN(Number(t))) continue;
      return t;
    }
  }
  // Fall back to a label on the anchor row itself, before the "MONTH :" marker.
  return '';
}

interface Layout {
  headerRow: number;
  dayNumberRow: number;
  weekdayRow: number | null;
  nameCol: number;
  nikCol: number;
  roleCol: number;
  firstDayCol: number;
  dayCols: Record<number, number>; // col → day-of-month
}

function detectLayout(rows: Row[], start: number, end: number): Layout | null {
  // Header row: first row in range whose first ~6 cells contain a name header.
  let headerRow = -1;
  let nameCol = 2;
  let nikCol = -1;
  let roleCol = -1;

  for (let r = start; r < end; r++) {
    const row = rows[r];
    let foundName = -1;
    for (let c = 0; c < Math.min(8, row.length); c++) {
      if (NAME_HEADER.test(cellText(row[c]))) { foundName = c; break; }
    }
    if (foundName >= 0) {
      headerRow = r;
      nameCol = foundName;
      for (let c = 0; c < Math.min(8, row.length); c++) {
        if (nikCol < 0 && NIK_HEADER.test(cellText(row[c]))) nikCol = c;
        if (roleCol < 0 && ROLE_HEADER.test(cellText(row[c]))) roleCol = c;
      }
      break;
    }
  }

  // Day-number row: the row (header row or up to 3 rows below/above it) with
  // the longest consecutive run of integers 1,2,3,… ≥ column 1.
  const dayRowSearch: number[] = [];
  if (headerRow >= 0) {
    for (let r = headerRow - 1; r <= headerRow + 3; r++) {
      if (r >= start - 1 && r < end) dayRowSearch.push(r);
    }
  } else {
    for (let r = start; r < end; r++) dayRowSearch.push(r);
  }

  let dayNumberRow = -1;
  let firstDayCol = -1;
  let bestRun = 0;

  for (const r of dayRowSearch) {
    if (r < 0 || r >= rows.length) continue;
    const row = rows[r];
    for (let c = 1; c < row.length; c++) {
      const n = asDayNumber(row[c]);
      if (n !== 1) continue;
      let run = 0;
      for (let k = c; k < row.length; k++) {
        if (asDayNumber(row[k]) === run + 1) run++;
        else break;
      }
      if (run > bestRun) {
        bestRun = run;
        dayNumberRow = r;
        firstDayCol = c;
      }
    }
  }

  if (dayNumberRow < 0 || bestRun < 5) return null;
  if (headerRow < 0) headerRow = dayNumberRow;

  const dayCols: Record<number, number> = {};
  {
    const row = rows[dayNumberRow];
    for (let c = firstDayCol; c < row.length; c++) {
      const n = asDayNumber(row[c]);
      if (n == null || n < 1 || n > 31) break;
      dayCols[c] = n;
    }
  }

  // Weekday row: whichever row between the section start and the day-number
  // row has the most weekday tokens sitting on the day columns.
  let weekdayRow: number | null = null;
  let bestWeekdayHits = 0;
  for (let r = start; r <= dayNumberRow; r++) {
    if (r < 0 || r >= rows.length) continue;
    let hits = 0;
    for (const c of Object.keys(dayCols).map(Number)) {
      const key = normToken(rows[r][c]);
      if (key && WEEKDAY_MAP[key] !== undefined) hits++;
    }
    if (hits > bestWeekdayHits) {
      bestWeekdayHits = hits;
      weekdayRow = r;
    }
  }
  if (bestWeekdayHits < 3) weekdayRow = null;

  return { headerRow, dayNumberRow, weekdayRow, nameCol, nikCol, roleCol, firstDayCol, dayCols };
}

function parseOneSection(
  rows: Row[],
  start: number,
  end: number,
  section: string,
  month: Date,
  out: EmployeeScheduleRow[],
  dateErrors: string[],
): void {
  const layout = detectLayout(rows, start, end);
  if (!layout) return;

  // Cap at the real length of the month — templates often print a "31" column
  // even for 30-day (or February) months.
  const daysInMonth = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const y = month.getUTCFullYear();
  const mi = month.getUTCMonth();

  const dayCols = Object.entries(layout.dayCols)
    .map(([c, day]) => ({
      col: Number(c),
      // LOCAL midnight of the calendar day — matches the rest of the app
      // (parseLocalDate, startOfDay) so createOrReplaceMonthlySchedule's
      // startOfDay() is a no-op instead of shifting the date a day.
      date: new Date(y, mi, day, 0, 0, 0, 0),
      // Timezone-independent weekday for validation.
      dow: new Date(Date.UTC(y, mi, day)).getUTCDay(),
      day,
    }))
    .filter(({ day }) => day >= 1 && day <= daysInMonth);

  // Weekday-vs-actual-day validation (only when a weekday row exists).
  if (layout.weekdayRow != null) {
    const wr = rows[layout.weekdayRow];
    for (const { col, dow: actual, day } of dayCols) {
      const key = normToken(wr[col]);
      const expected = WEEKDAY_MAP[key];
      if (expected === undefined) continue;
      if (expected !== actual) {
        const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dateErrors.push(
          `Section "${section}": day ${day} is labelled ${names[expected]} but ` +
          `${month.toLocaleString('en-US', { month: 'long' })} ${day}, ${y} ` +
          `is actually ${names[actual]}.`,
        );
      }
    }
  }

  const firstDataRow = Math.max(layout.headerRow, layout.dayNumberRow) + 1;

  for (let r = firstDataRow; r < end; r++) {
    const row = rows[r];
    if (!row || row.every((c) => cellText(c) === '')) {
      // A single blank row inside a block is tolerated; keep scanning.
      continue;
    }

    const name = cellText(row[layout.nameCol]);
    const role = layout.roleCol >= 0 ? cellText(row[layout.roleCol]) : '';
    const nik = layout.nikCol >= 0 ? cellText(row[layout.nikCol]) : '';

    // Stop at a summary block (OPENING / CLOSING / TOTAL / legend / …).
    if (SUMMARY_LABELS.test(name) || SUMMARY_LABELS.test(role) || SUMMARY_LABELS.test(cellText(row[0]))) {
      break;
    }
    if (!name || HEADER_WORDS.test(name)) continue;

    const days: DayEntry[] = [];
    let hasAnyCode = false;
    for (const { col, date } of dayCols) {
      const shift = codeToShift(cellText(row[col]));
      if (cellText(row[col]) !== '') hasAnyCode = true;
      days.push({ date, shift });
    }
    if (!hasAnyCode) continue; // a stray text row with no shift cells

    out.push({ nik, name, pic: role, section, days });
  }
}

// ─── Value coercers ──────────────────────────────────────────────────────────

function asDayNumber(v: Cell): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  const t = cellText(v);
  if (!/^\d{1,2}$/.test(t)) return null;
  return parseInt(t, 10);
}

/** Parse a "MONTH :" value: a real Date, "Oct-2026", "September 2026", "2026-09", "1/9/2026". */
function parseMonthCell(v: Cell): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) {
    // SheetJS's `cellDates` conversion applies the *running process's* UTC
    // offset and can land a few seconds off the intended midnight (e.g.
    // 2026-09-01 → 2026-08-31T16:59:48Z on a UTC+7 host). Snap to the nearest
    // UTC day before reading the month.
    const snapped = new Date(Math.round(v.getTime() / 86_400_000) * 86_400_000);
    return new Date(Date.UTC(snapped.getUTCFullYear(), snapped.getUTCMonth(), 1));
  }
  return parseMonthLoose(cellText(v));
}

function parseMonthLoose(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // "Oct-2026" | "Oct 2026" | "October 2026" | "Sep-26"
  let m = s.match(/([A-Za-z]{3,})[-\s/]+(\d{2,4})/);
  if (m) {
    const monIdx = MONTH_NAMES[m[1].toUpperCase()];
    if (monIdx !== undefined) {
      let year = parseInt(m[2], 10);
      if (year < 100) year += 2000;
      return new Date(Date.UTC(year, monIdx, 1));
    }
  }

  // "2026-09" | "2026/09" | "2026-09-01"
  m = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const monIdx = parseInt(m[2], 10) - 1;
    if (monIdx >= 0 && monIdx <= 11) return new Date(Date.UTC(year, monIdx, 1));
  }

  // "09-2026" | "9/2026"
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) {
    const monIdx = parseInt(m[1], 10) - 1;
    const year = parseInt(m[2], 10);
    if (monIdx >= 0 && monIdx <= 11) return new Date(Date.UTC(year, monIdx, 1));
  }

  // "1 September 2026"
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m) {
    const monIdx = MONTH_NAMES[m[2].toUpperCase()];
    if (monIdx !== undefined) return new Date(Date.UTC(parseInt(m[3], 10), monIdx, 1));
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
}

function codeToShift(codeRaw: string): ImportShift {
  const code = codeRaw.trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (code === '') return 'off';
  if (['E', 'M', 'P', 'PG', 'PAGI', 'MORNING', 'MRN'].includes(code)) return 'morning';
  if (['L', 'S', 'SG', 'SIANG', 'EVENING', 'EVE', 'CLOSING'].includes(code)) return 'evening';
  if (['F', 'FD', 'FULL', 'FULLDAY', 'D'].includes(code)) return 'full';
  if (['AL', 'A', 'C', 'CT', 'CU', 'CUTI', 'I', 'IZIN', 'SICK', 'SAKIT', 'CTI'].includes(code)) return 'leave';
  return 'off'; // X / O / OFF / LIBUR / "-" / anything unrecognised
}

// ─── Importer ─────────────────────────────────────────────────────────────────

/** Levenshtein edit distance, capped — cheap enough for a roster of a few dozen. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Resolve one parsed row to a user id. NIK wins; otherwise match the name
 * against the TARGET STORE's roster only (never other stores — this import is
 * scoped to one store). Tolerates the sheet's short/mistyped names ("OPIK" →
 * "Opik Ramdani", "DENIS" → "Dennis Jala Pranada").
 */
async function resolveEmployee(
  emp: EmployeeScheduleRow,
  roster: Array<{ id: string; nik: string; name: string; norm: string; tokens: string[] }>,
): Promise<string | null> {
  const nik = emp.nik.trim();
  if (nik) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.nik, nik)).limit(1);
    if (u) return u.id;
  }

  const target = normName(emp.name);
  if (!target || target.length < 2) return null;

  const uniq = (list: typeof roster) => (list.length === 1 ? list[0].id : null);

  // Exact normalised full name.
  let hit = uniq(roster.filter((u) => u.norm === target));
  if (hit) return hit;

  // Sheet name ⊂ roster name  ("OPIK" ⊂ "OPIKRAMDANI").
  hit = uniq(roster.filter((u) => u.norm.includes(target)));
  if (hit) return hit;

  // Roster name ⊂ sheet name  (sheet spells out the full name, roster is short).
  hit = uniq(roster.filter((u) => u.norm.length >= 3 && target.includes(u.norm)));
  if (hit) return hit;

  // Sheet name ≈ one of the roster's name tokens, allowing ONE typo
  // ("DENIS" ≈ token "DENNIS"). Kept deliberately tight so unrelated short
  // names don't get pulled onto the roster.
  hit = uniq(
    roster.filter((u) =>
      u.tokens.some(
        (tok) =>
          Math.min(tok.length, target.length) >= 4 &&
          (tok === target || editDistance(tok, target) <= 1),
      ),
    ),
  );
  return hit;
}

/**
 * storeMap maps Excel section labels → store IDs. Both callers point every
 * section at a single chosen store, so this also merges all sections that
 * land on the same store into ONE createOrReplaceMonthlySchedule call
 * (calling it twice for the same store/month wipes the first batch).
 */
export async function importScheduleFromParsed(
  parsed: ParsedScheduleFile,
  storeMap: Record<string, number>,
  actorId: string,
): Promise<ImportResult> {
  let schedulesCreated = 0;
  let entriesCreated = 0;
  let skipped = 0;
  const errors: string[] = [];
  const notFound: string[] = [];

  const yearMonth = dateToYearMonth(parsed.month);

  // Group parsed employees by the store their section maps to.
  const byStore = new Map<number, EmployeeScheduleRow[]>();
  const unmappedSections = new Set<string>();

  for (const emp of parsed.employees) {
    const storeId = storeMap[emp.section];
    if (storeId == null) {
      unmappedSections.add(emp.section);
      continue;
    }
    if (!byStore.has(storeId)) byStore.set(storeId, []);
    byStore.get(storeId)!.push(emp);
  }

  for (const section of unmappedSections) {
    errors.push(`Section "${section}" not mapped to any store — skipped.`);
  }

  for (const [storeId, employees] of byStore) {
    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) {
      errors.push(`Not authorized for store ${storeId}: ${auth.reason}`);
      continue;
    }

    const rosterRows = await db
      .select({ id: users.id, nik: users.nik, name: users.name })
      .from(users)
      .where(and(eq(users.homeStoreId, storeId), eq(users.isActive, true)));
    const roster = rosterRows.map((u) => ({
      ...u,
      norm: normName(u.name),
      tokens: u.name.toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length > 0),
    }));

    const assignments: DayAssignment[] = [];
    // One employee can only be filled once per import, and one (user, day)
    // pair can only appear once (a multi-block sheet imported for one store
    // must not produce a row that conflicts with itself).
    const usedUserIds = new Set<string>();
    const seenDayKeys = new Set<string>();

    for (const emp of employees) {
      const userId = await resolveEmployee(emp, roster);
      if (!userId || usedUserIds.has(userId)) {
        const label = `${emp.nik || '(no NIK)'} - ${emp.name}`;
        if (!notFound.includes(label)) notFound.push(label);
        continue;
      }
      usedUserIds.add(userId);

      for (const day of emp.days) {
        const dayKey = `${userId}|${day.date.getFullYear()}-${day.date.getMonth()}-${day.date.getDate()}`;
        if (seenDayKeys.has(dayKey)) continue;
        seenDayKeys.add(dayKey);

        const base = { userId, storeId, date: day.date };
        if (day.shift === 'morning' || day.shift === 'evening') {
          assignments.push({ ...base, shift: day.shift, isOff: false, isLeave: false });
        } else if (day.shift === 'full') {
          assignments.push({ ...base, shift: 'full_day', isOff: false, isLeave: false });
        } else if (day.shift === 'leave') {
          assignments.push({ ...base, shift: null, isOff: false, isLeave: true });
        } else {
          assignments.push({ ...base, shift: null, isOff: true, isLeave: false });
        }
        entriesCreated++;
      }
    }

    if (assignments.length === 0) {
      skipped += employees.length;
      continue;
    }

    const result = await createOrReplaceMonthlySchedule({
      storeId,
      yearMonth,
      entries: assignments,
      note: `Imported from ${parsed.sheetName}`,
      importedBy: actorId,
    });

    if (!result.success) {
      errors.push(`Store ${storeId}: ${result.error}`);
      continue;
    }

    if (result.skippedProtected && result.skippedProtected > 0) {
      skipped += result.skippedProtected;
      entriesCreated = Math.max(0, entriesCreated - result.skippedProtected);
    }

    schedulesCreated++;
  }

  // "Success" as long as at least one schedule landed and there were no hard
  // errors — unresolved names are surfaced via notFound, not as a failure.
  return {
    success: errors.length === 0 && (schedulesCreated > 0 || parsed.employees.length === 0),
    schedulesCreated,
    entriesCreated,
    skipped,
    errors,
    notFound,
    month: yearMonth,
    sheet: parsed.sheetName,
  };
}
