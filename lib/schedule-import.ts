// lib/schedule-import.ts
/**
 * Excel Schedule Import Utility
 *
 * Parses the store schedule Excel format and creates monthly schedules.
 *
 * Excel layout per section (0-indexed rows from section start):
 *   +0  Store name row   (col 0 = "Store Thamrin", "FO DMG", "SUDIRMAN", …)
 *   +1  MONTH row        (col 0 = "MONTH :", col 3 = "Mar-2026")
 *   +2  header labels    (No / PIC / Name / SUN MON … / PAGI FULL SIANG …)
 *   +3  date numbers     (col 3+ = 1, 2, 3, …, 31)
 *   +4+ employee rows    (col 0 = no, col 1 = PIC, col 2 = name, col 3+ = shift codes)
 *   summary rows         (OPENING / MIDDLE / CLOSING / OFF/CUTI — skipped)
 *
 * Shift codes:
 *   E / PAGI  → morning
 *   L / SIANG → evening
 *   F / FULL  → full day (creates both morning + evening entries)
 *   OFF       → day off
 *   AL / CU / SICK → leave
 */

import * as XLSX from 'xlsx';
import { db }    from '@/lib/db';
import { users } from '@/lib/db/schema';
import { sql }   from 'drizzle-orm';
import {
  createOrReplaceMonthlySchedule,
  canManageSchedule,
  dateToYearMonth,
  type DayAssignment,
} from '@/lib/schedule-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ImportShift = 'morning' | 'evening' | 'full' | 'off' | 'leave';

export interface DayEntry {
  date:  Date;
  shift: ImportShift;
}

export interface EmployeeScheduleRow {
  name:    string;
  pic:     string;
  section: string;
  days:    DayEntry[];
}

export interface ParsedScheduleFile {
  month:     Date;
  sheetName: string;
  employees: EmployeeScheduleRow[];
  sections:  string[];
}

export interface ImportResult {
  success:          boolean;
  schedulesCreated: number;
  entriesCreated:   number;
  skipped:          number;
  errors:           string[];
  notFound:         string[];
  month?:           string;
  sheet?:           string;
}

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
  const wb    = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sName = sheetName
    ?? wb.SheetNames.find(n =>
        /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(n),
       )
    ?? wb.SheetNames[0];

  const ws  = wb.Sheets[sName];
  const raw = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: null,
    raw:    false,
  });

  return parseSections(raw, sName);
}

export class ScheduleImportValidationError extends Error {
  public dateErrors: string[];
  constructor(dateErrors: string[]) {
    super('Schedule date validation failed');
    this.name = 'ScheduleImportValidationError';
    this.dateErrors = dateErrors;
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

const SUMMARY_LABELS = /^(opening|middle|closing|off\/cuti|off|cuti)$/i;
const SKIP_HEADER    = /^(month\s*:|no|pic|name)$/i;
const WEEKDAY_MAP: Record<string, number> = {
  SUN: 0, SUNDAY: 0,
  MON: 1, MONDAY: 1,
  TUE: 2, TUES: 2, TUESDAY: 2,
  WED: 3, WEDNESDAY: 3,
  THU: 4, THUR: 4, THURS: 4, THURSDAY: 4,
  FRI: 5, FRIDAY: 5,
  SAT: 6, SATURDAY: 6,
};

function parseSections(raw: any[][], sheetName: string): ParsedScheduleFile {
  const employees: EmployeeScheduleRow[] = [];
  const sections:  string[]              = [];
  let   month: Date                      = new Date();
  const dateErrors: string[]             = [];

  const sectionStarts: number[] = [];
  for (let r = 0; r < raw.length; r++) {
    const row  = raw[r];
    if (!row) continue;
    const col0 = String(row[0] ?? '').trim();
    const col3 = row[3];

    const isStoreLabel =
      col0 &&
      !SKIP_HEADER.test(col0) &&
      !SUMMARY_LABELS.test(col0) &&
      isNaN(Number(col0)) &&
      col3 == null;

    if (isStoreLabel) sectionStarts.push(r);
  }

  for (const start of sectionStarts) {
    const sectionLabel = String(raw[start][0]).trim();
    sections.push(sectionLabel);

    const monthRow = raw[start + 1];
    if (monthRow) {
      const rawDate = monthRow[3];
      if (rawDate) {
        const parsed = parseMonthString(String(rawDate));
        if (parsed) month = parsed;
      }
    }

    const weekdayRow = raw[start + 2] ?? [];
    const dateRow    = raw[start + 3] ?? [];
    const dayDates   = buildDateMap(dateRow, month);

    // ── Validate each day number against its weekday header ────────────────
    for (const [colStr, date] of Object.entries(dayDates)) {
      const col           = Number(colStr);
      const headerRaw     = String(weekdayRow[col] ?? '').trim().toUpperCase();
      if (!headerRaw) continue; // no weekday header — skip
      // Strip trailing punctuation/non-letters (e.g. "MON.", "MON ")
      const headerClean   = headerRaw.replace(/[^A-Z]/g, '');
      const expectedDow   = WEEKDAY_MAP[headerClean];
      if (expectedDow === undefined) continue; // unknown header — skip
      const actualDow     = date.getDay();
      if (expectedDow !== actualDow) {
        const actualName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][actualDow];
        const headerName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][expectedDow];
        dateErrors.push(
          `Section "${sectionLabel}": day ${date.getDate()} is marked as ${headerName} but ${month.toLocaleString('en-US',{month:'long'})} ${date.getDate()}, ${month.getFullYear()} is actually ${actualName}.`,
        );
      }
    }

    const nextSection = sectionStarts.find(s => s > start) ?? raw.length;

    for (let r = start + 4; r < nextSection; r++) {
      const row = raw[r];
      if (!row) continue;

      const no   = row[0];
      const pic  = String(row[1] ?? '').trim();
      const name = String(row[2] ?? '').trim().toUpperCase();

      if (SUMMARY_LABELS.test(pic) || SUMMARY_LABELS.test(name)) break;
      if (!no || !name || name === 'NULL' || name === '') continue;
      if (isNaN(Number(String(no).trim()))) continue;

      const days: DayEntry[] = [];
      for (let col = 3; col <= 33; col++) {
        const d = dayDates[col];
        if (!d) continue;
        const code  = String(row[col] ?? '').trim().toUpperCase();
        const shift = codeToShift(code);
        days.push({ date: d, shift });
      }

      employees.push({ name, pic, section: sectionLabel, days });
    }
  }

  // ── If any date/weekday mismatches found, reject the whole import ─────────
  if (dateErrors.length > 0) {
    // Deduplicate identical errors
    throw new ScheduleImportValidationError([...new Set(dateErrors)]);
  }

  return { month, sheetName, employees, sections: [...new Set(sections)] };
}

function parseMonthString(raw: string): Date | null {
  const match = raw.match(/^([A-Za-z]{3})[-\s](\d{2,4})$/);
  if (match) {
    let year = parseInt(match[2], 10);
    if (year < 100) year += 2000;
    const monthIdx = new Date(`${match[1]} 1, 2000`).getMonth();
    if (!isNaN(monthIdx)) return new Date(year, monthIdx, 1, 0, 0, 0, 0);
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), 1);
}

function buildDateMap(dateRow: any[], month: Date): Record<number, Date> {
  const map: Record<number, Date> = {};
  for (let col = 3; col <= 33; col++) {
    const val    = dateRow[col];
    if (val === null || val === undefined || val === '') continue;
    const dayNum = parseInt(String(val), 10);
    if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) continue;
    const d = new Date(month.getFullYear(), month.getMonth(), dayNum, 0, 0, 0, 0);
    if (!isNaN(d.getTime())) map[col] = d;
  }
  return map;
}

function codeToShift(code: string): ImportShift {
  if (code === 'E' || code === 'PAGI')                    return 'morning';
  if (code === 'L' || code === 'SIANG')                   return 'evening';
  if (code === 'F' || code === 'FULL' || code === 'D')    return 'full';
  if (code === 'AL' || code === 'CU' || code === 'SICK')  return 'leave';
  return 'off';
}

// ─── Importer ─────────────────────────────────────────────────────────────────

/**
 * storeMap maps Excel section labels to store IDs (numbers).
 * Previously accepted strings — now accepts numbers to match serial PK.
 */
export async function importScheduleFromParsed(
  parsed:   ParsedScheduleFile,
  storeMap: Record<string, number>,
  actorId:  string,
): Promise<ImportResult> {
  let schedulesCreated = 0;
  let entriesCreated   = 0;
  let skipped          = 0;
  const errors:   string[] = [];
  const notFound: string[] = [];

  const yearMonth = dateToYearMonth(parsed.month);

  // Group employees by section
  const bySection = new Map<string, EmployeeScheduleRow[]>();
  for (const emp of parsed.employees) {
    if (!bySection.has(emp.section)) bySection.set(emp.section, []);
    bySection.get(emp.section)!.push(emp);
  }

  console.log('[importer] sections to process:', [...bySection.keys()]);
  console.log('[importer] storeMap:', storeMap);

  for (const [section, employees] of bySection) {
    const storeId = storeMap[section];
    if (storeId == null) {
      console.warn(`[importer] no storeId for section "${section}" — skipping ${employees.length} employee(s)`);
      skipped += employees.length;
      errors.push(`Section "${section}" not mapped to any store — skipped.`);
      continue;
    }

    const auth = await canManageSchedule(actorId, storeId);
    if (!auth.allowed) {
      errors.push(`Not authorized for section "${section}" (${storeId}): ${auth.reason}`);
      continue;
    }

    const assignments: DayAssignment[] = [];

    for (const emp of employees) {
      const [dbUser] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(sql`UPPER(TRIM(${users.name})) = ${emp.name.trim()}`)
        .limit(1);

      if (!dbUser) {
        console.warn(`[importer] user not found: "${emp.name}"`);
        if (!notFound.includes(emp.name)) notFound.push(emp.name);
        continue;
      }

      console.log(`[importer] resolved "${emp.name}" → userId ${dbUser.id}`);

      for (const day of emp.days) {
        const base = {
          userId:  dbUser.id,
          storeId,           // number
          date:    day.date,
        };

        if (day.shift === 'full') {
          assignments.push({ ...base, shift: 'morning', isOff: false, isLeave: false });
          assignments.push({ ...base, shift: 'evening', isOff: false, isLeave: false });
          entriesCreated += 2;
        } else if (day.shift === 'morning' || day.shift === 'evening') {
          assignments.push({ ...base, shift: day.shift, isOff: false, isLeave: false });
          entriesCreated++;
        } else if (day.shift === 'leave') {
          assignments.push({ ...base, shift: null, isOff: false, isLeave: true });
          entriesCreated++;
        } else {
          assignments.push({ ...base, shift: null, isOff: true, isLeave: false });
          entriesCreated++;
        }
      }
    }

    if (assignments.length === 0) {
      console.warn(`[importer] no assignments built for section "${section}" — skipping`);
      skipped++;
      continue;
    }

    console.log(
      `[importer] section "${section}" → storeId=${storeId} ` +
      `assignments=${assignments.length} (working=${assignments.filter(a => a.shift).length})`,
    );

    const result = await createOrReplaceMonthlySchedule({
      storeId,
      yearMonth,
      entries:    assignments,
      note:       `Imported from ${parsed.sheetName} — ${section}`,
      importedBy: actorId,
    });

    if (!result.success) {
      errors.push(`${section}: ${result.error}`);
      continue;
    }

    schedulesCreated++;
  }

  return {
    success: errors.length === 0,
    schedulesCreated,
    entriesCreated,
    skipped,
    errors,
    notFound,
    month: yearMonth,
    sheet: parsed.sheetName,
  };
}