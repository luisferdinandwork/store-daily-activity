// scripts/seed/roster-demo.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dummy schedule + attendance + task progress for stores that have NO activity
// yet — "user socialization" data for stores/users that were registered later
// (e.g. through the IT Users Excel import), so their dashboards aren't empty.
//
//   npm run db:seed -- --only=roster-demo
//   ROSTER_DEMO_DRY=1 npm run db:seed -- --only=roster-demo     # plan only, no writes
//   ROSTER_DEMO_ONLY=FF002,FS001 npm run db:seed -- --only=roster-demo   # just these stores
//
// What it does, for the CURRENT month (Asia/Jakarta calendar):
//   • schedule    — the whole month for every active employee of an eligible
//                   store (monthly_schedules + entries + materialised schedules)
//   • attendance  — for the days BEFORE today only: present / late / a few
//                   absences, with check-in/out and break sessions
//   • task rows   — for those same past days, following the live shift_tasks
//                   config (morning 10 / evening 4 / full_day 11), mostly
//                   completed, some in-progress / not started
// Today and future days get a schedule but no attendance/tasks, so people can
// use the app live (e.g. during the training).
//
// Eligibility — a store is touched only if it has NO schedules, attendance or
// monthly_schedules at all, and an employee only if they have none either.
// FF001 and FO001 are additionally refused by code, whatever their state, and
// nothing here ever updates or deletes rows for a store that had data.
//
// Not seeded: store_cash_counts (needs a co-scheduled witness, and these stores
// have a single employee) and serah_terima_entries (the handover board).
//
// Dates follow the repo convention: day buckets are UTC midnight of the
// calendar day; real timestamps are true instants built from Asia/Jakarta
// wall-clock times (UTC+7, no DST) — independent of the machine's timezone.
// Random choices come from a PRNG seeded by store code, so a dry run and the
// real run produce the same plan.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import {
  attendance,
  breakSessions,
  briefingTasks,
  cekBinTasks,
  cekUangModalDenominations,
  cekUangModalTasks,
  groomingTasks,
  marketingCheckTasks,
  monthlyScheduleEntries,
  monthlySchedules,
  schedules,
  serahTerimaTasks,
  setoranMoneyStorage,
  setoranTasks,
  shifts,
  storeClosingTasks,
  storeFrontTasks,
  storeOpeningTasks,
  stores,
  userRoles,
  users,
  vmChecklistTasks,
} from '@/lib/db/schema';

// ─── Config ──────────────────────────────────────────────────────────────────

export const PROTECTED_STORE_NOS = new Set(['FF001', 'FO001']);
const DRY = process.env.ROSTER_DEMO_DRY === '1';
const ONLY = process.env.ROSTER_DEMO_ONLY
  ? new Set(process.env.ROSTER_DEMO_ONLY.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))
  : null;
const BATCH = 400;
const WIB_OFFSET_MIN = 7 * 60;

/** 23 Sep 2026 PIC 1 training — everyone is scheduled (morning) that day, and never off the day either side. */
const TRAINING_DAY = 23;
const TRAINING_YEAR = 2026;
const TRAINING_MONTH_INDEX = 8;
const LATE_AFTER_MINUTES = 30;
const DENOMINATIONS = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000] as const;

type ShiftCode = 'morning' | 'evening' | 'full_day';
type Half = 'morning' | 'evening';
type GridCode = 'E' | 'L' | 'F' | 'X' | 'A';
type TaskStatus = 'completed' | 'in_progress' | 'not_started';

export const CODE_TO_SHIFT: Record<'E' | 'L' | 'F', ShiftCode> = { E: 'morning', L: 'evening', F: 'full_day' };

const BREAKS: Record<ShiftCode, Array<{ type: 'lunch' | 'dinner' | 'full_day_lunch' | 'full_day_dinner'; hour: number; durMin: number; durMax: number }>> = {
  morning: [{ type: 'lunch', hour: 12, durMin: 25, durMax: 45 }],
  evening: [{ type: 'dinner', hour: 18, durMin: 25, durMax: 45 }],
  full_day: [
    { type: 'full_day_lunch', hour: 12, durMin: 30, durMax: 45 },
    { type: 'full_day_dinner', hour: 18, durMin: 30, durMax: 45 },
  ],
};

/** When in a shift (fraction of check-in → check-out) each task typically gets done. */
const MORNING_WINDOW = {
  grooming: [0.01, 0.05], store_front: [0.03, 0.08], store_opening: [0.06, 0.16], cek_uang_modal: [0.09, 0.18],
  briefing: [0.14, 0.24], setoran: [0.3, 0.5], cek_bin: [0.3, 0.42], vm_checklist: [0.4, 0.52],
  marketing_check: [0.5, 0.62], serah_terima: [0.86, 0.96],
} as const;
const EVENING_WINDOW = { briefing: [0.05, 0.15], serah_terima: [0.8, 0.9], store_closing: [0.9, 0.98] } as const;

// ─── Small helpers ───────────────────────────────────────────────────────────

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seedText: string) {
  let a = hashString(seedText);
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
  };
}
type Rng = ReturnType<typeof makeRng>;

/** Today's calendar date in Asia/Jakarta. */
function jakartaToday() {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date()).split('-').map(Number);
  return { year: y, monthIndex: m - 1, day: d };
}

export const CAL = (() => {
  const t = jakartaToday();
  return {
    ...t,
    daysInMonth: new Date(Date.UTC(t.year, t.monthIndex + 1, 0)).getUTCDate(),
    yearMonth: `${t.year}-${String(t.monthIndex + 1).padStart(2, '0')}`,
  };
})();

/** UTC midnight of a calendar day — the app's day-bucket convention. */
const dayBucket = (day: number) => new Date(Date.UTC(CAL.year, CAL.monthIndex, day));
/** The instant a given Jakarta wall-clock time (minutes from midnight) falls on. */
const wib = (day: number, minutes: number) => new Date(Date.UTC(CAL.year, CAL.monthIndex, day, 0, minutes - WIB_OFFSET_MIN, 0));
export const hhmmToMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const addMin = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ─── Writers (no-ops in dry-run) ─────────────────────────────────────────────

let fakeId = 9_000_000;

async function insertMany<T extends Record<string, unknown>>(table: PgTable, rows: T[]): Promise<number> {
  if (!rows.length || DRY) return rows.length;
  for (const part of chunk(rows, BATCH)) await db.insert(table).values(part as never);
  return rows.length;
}

async function insertManyReturning<T extends Record<string, unknown>>(table: PgTable, rows: T[]): Promise<Array<T & { id: number }>> {
  if (!rows.length) return [];
  if (DRY) return rows.map((r) => ({ ...r, id: ++fakeId }));
  const out: Array<T & { id: number }> = [];
  for (const part of chunk(rows, BATCH)) {
    const res = await db.insert(table).values(part as never).returning();
    out.push(...(res as Array<T & { id: number }>));
  }
  return out;
}

// ─── Discovery ───────────────────────────────────────────────────────────────

interface Target {
  store: { id: number; storeNo: string; name: string; lat: number | null; lng: number | null };
  employees: Array<{ id: string; nik: string; name: string }>;
}

async function findTargets(): Promise<{ targets: Target[]; skipped: string[] }> {
  const [busyA, busyB, busyC, busyUsersA, busyUsersB, storeRows, employeeRows] = await Promise.all([
    db.selectDistinct({ v: schedules.storeId }).from(schedules),
    db.selectDistinct({ v: attendance.storeId }).from(attendance),
    db.selectDistinct({ v: monthlySchedules.storeId }).from(monthlySchedules),
    db.selectDistinct({ v: schedules.userId }).from(schedules),
    db.selectDistinct({ v: attendance.userId }).from(attendance),
    db.select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, lat: stores.latitude, lng: stores.longitude }).from(stores),
    db
      .select({ id: users.id, nik: users.nik, name: users.name, storeId: users.homeStoreId })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.id, users.roleId))
      .where(and(eq(userRoles.code, 'employee'), eq(users.isActive, true), isNotNull(users.homeStoreId))),
  ]);

  const busyStoreIds = new Set<number>([...busyA, ...busyB, ...busyC].map((r) => r.v));
  const busyUserIds = new Set<string>([...busyUsersA, ...busyUsersB].map((r) => r.v));

  const targets: Target[] = [];
  const skipped: string[] = [];
  for (const s of storeRows.sort((a, b) => a.storeNo.localeCompare(b.storeNo))) {
    const staff = employeeRows.filter((e) => e.storeId === s.id);
    if (staff.length === 0) continue;
    if (ONLY && !ONLY.has(s.storeNo.toUpperCase())) continue;
    if (PROTECTED_STORE_NOS.has(s.storeNo)) { skipped.push(`${s.storeNo} (protected)`); continue; }
    if (busyStoreIds.has(s.id)) { skipped.push(`${s.storeNo} (already has data)`); continue; }
    const employees = staff.filter((e) => !busyUserIds.has(e.id)).map((e) => ({ id: e.id, nik: e.nik, name: e.name }));
    if (employees.length === 0) { skipped.push(`${s.storeNo} (employees already have data)`); continue; }
    targets.push({
      store: { id: s.id, storeNo: s.storeNo, name: s.name, lat: s.lat != null ? Number(s.lat) : null, lng: s.lng != null ? Number(s.lng) : null },
      employees,
    });
  }
  return { targets, skipped };
}

async function loadPhotoPools() {
  const spec: Record<string, [string, string]> = {
    groomingSelfie: ['grooming_tasks', 'selfie_photos'],
    storefront: ['store_front_tasks', 'storefront_photos'],
    rollingDoor: ['store_front_tasks', 'rolling_door_closed_photo'],
    fiveRKasir: ['store_opening_tasks', 'five_r_area_kasir_photos'],
    fiveRDepan: ['store_opening_tasks', 'five_r_area_depan_photos'],
    fiveRKanan: ['store_opening_tasks', 'five_r_area_kanan_photos'],
    fiveRKiri: ['store_opening_tasks', 'five_r_area_kiri_photos'],
    fiveRGudang: ['store_opening_tasks', 'five_r_area_gudang_photos'],
    cashDrawer: ['store_opening_tasks', 'cash_drawer_photos'],
    resi: ['setoran_tasks', 'resi_photo'],
    atmSelfie: ['setoran_tasks', 'atm_card_selfie_photo'],
    zReport: ['store_closing_tasks', 'eod_edc_settlement_photo'],
    storeLocked: ['store_closing_tasks', 'storefront_locked_photo'],
  };
  // Existing completed rows reference real uploaded images (full NOS URLs); reuse
  // them so the demo rows render real pictures instead of broken placeholder paths.
  const pools: Record<string, string[]> = {};
  for (const [key, [table, col]] of Object.entries(spec)) {
    const res = await db.execute(
      sql`select distinct ${sql.identifier(col)} as v from ${sql.identifier(table)} where ${sql.identifier(col)} like '%https://%' limit 60`,
    );
    pools[key] = (res.rows as Array<{ v: string }>).map((r) => r.v);
  }
  return pools;
}

// ─── Schedule grid ───────────────────────────────────────────────────────────

export function buildGrid(rng: Rng): GridCode[] {
  const offset = rng.int(0, 6);
  const leaveDay = CAL.day > 4 && rng.chance(0.35) ? rng.int(3, Math.min(15, CAL.day - 1)) : null;
  const grid: GridCode[] = [];
  for (let day = 1; day <= CAL.daysInMonth; day++) {
    const trainingMonth = CAL.year === TRAINING_YEAR && CAL.monthIndex === TRAINING_MONTH_INDEX;
    const inTrainingWindow = trainingMonth && Math.abs(day - TRAINING_DAY) <= 1;
    if (trainingMonth && day === TRAINING_DAY) { rng.next(); grid.push('E'); continue; }
    if (!inTrainingWindow && (day + offset) % 7 === 0) { grid.push('X'); continue; }
    if (day === leaveDay) { grid.push('A'); continue; }
    const r = rng.next();
    grid.push(r < 0.55 ? 'E' : r < 0.85 ? 'L' : 'F');
  }
  return grid;
}

// ─── Per-store seeding ───────────────────────────────────────────────────────

interface Counts {
  employees: number; workDays: number; offDays: number; leaveDays: number;
  attendance: number; present: number; late: number; absent: number; breaks: number;
  tasks: number; completed: number; denominations: number; setoranLedger: number;
}
const emptyCounts = (): Counts => ({
  employees: 0, workDays: 0, offDays: 0, leaveDays: 0, attendance: 0, present: 0, late: 0, absent: 0,
  breaks: 0, tasks: 0, completed: 0, denominations: 0, setoranLedger: 0,
});

interface Ctx {
  shiftByCode: Record<ShiftCode, { id: number; startMin: number; endMin: number }>;
  pools: Record<string, string[]>;
  missingPools: Set<string>;
}

interface Attended {
  schedId: number; userId: string; day: number; code: ShiftCode; shiftId: number; checkIn: Date; checkOut: Date;
}

async function rollbackStore(storeId: number, storeNo: string) {
  if (PROTECTED_STORE_NOS.has(storeNo)) throw new Error(`Refusing to touch protected store ${storeNo}.`);
  // Children before parents. Only ever reached for a store that had no data when
  // we started, so deleting by store_id removes exactly what this run wrote.
  const byStore: Array<[PgTable, PgColumn]> = [
    [cekUangModalTasks, cekUangModalTasks.storeId], [setoranTasks, setoranTasks.storeId], [cekBinTasks, cekBinTasks.storeId],
    [storeOpeningTasks, storeOpeningTasks.storeId], [storeFrontTasks, storeFrontTasks.storeId], [vmChecklistTasks, vmChecklistTasks.storeId],
    [marketingCheckTasks, marketingCheckTasks.storeId], [briefingTasks, briefingTasks.storeId], [serahTerimaTasks, serahTerimaTasks.storeId],
    [storeClosingTasks, storeClosingTasks.storeId], [groomingTasks, groomingTasks.storeId], [breakSessions, breakSessions.storeId],
    [attendance, attendance.storeId], [schedules, schedules.storeId],
  ];
  for (const [table, storeCol] of byStore) await db.delete(table).where(eq(storeCol, storeId));
  await db.delete(monthlySchedules).where(eq(monthlySchedules.storeId, storeId)); // entries cascade
}

async function seedStore(target: Target, ctx: Ctx): Promise<Counts> {
  const { store, employees } = target;
  if (PROTECTED_STORE_NOS.has(store.storeNo)) throw new Error(`Refusing to seed protected store ${store.storeNo}.`);

  const rng = makeRng(`roster-demo|${CAL.yearMonth}|${store.storeNo}`);
  const counts = emptyCounts();
  counts.employees = employees.length;

  const grids = employees.map((e) => ({ emp: e, codes: buildGrid(rng) }));
  const completionRate = rng.range(0.78, 0.97); // per-store "diligence", so Ops sees variety
  const status = (): TaskStatus => {
    if (rng.next() < completionRate) return 'completed';
    return rng.chance(0.5) ? 'in_progress' : 'not_started';
  };
  const pick = (key: string): string | null => {
    const pool = ctx.pools[key] ?? [];
    if (pool.length === 0) { ctx.missingPools.add(key); return null; }
    return rng.pick(pool);
  };
  const geo = () =>
    store.lat != null && store.lng != null
      ? { submittedLat: (store.lat + rng.range(-0.00015, 0.00015)).toFixed(7), submittedLng: (store.lng + rng.range(-0.00015, 0.00015)).toFixed(7) }
      : {};

  // ── 1. schedule: master → entries → materialised working days ─────────────
  const [master] = await insertManyReturning(monthlySchedules, [{
    storeId: store.id, yearMonth: CAL.yearMonth, importedBy: employees[0].id,
    note: 'Dummy schedule for user socialization (seeded).',
  }]);

  const entryRows: Array<typeof monthlyScheduleEntries.$inferInsert> = [];
  for (const { emp, codes } of grids) {
    codes.forEach((code, i) => {
      const day = i + 1;
      const shiftCode = code === 'E' || code === 'L' || code === 'F' ? CODE_TO_SHIFT[code] : null;
      entryRows.push({
        monthlyScheduleId: master.id, userId: emp.id, storeId: store.id, date: dayBucket(day),
        shiftId: shiftCode ? ctx.shiftByCode[shiftCode].id : null, isOff: code === 'X', isLeave: code === 'A',
      });
      if (code === 'X') counts.offDays++;
      else if (code === 'A') counts.leaveDays++;
      else counts.workDays++;
    });
  }
  const entries = await insertManyReturning(monthlyScheduleEntries, entryRows);
  const entryIdByKey = new Map(entries.map((e) => [`${e.userId}|${(e.date as Date).getUTCDate()}`, e.id]));

  const scheduleRows: Array<typeof schedules.$inferInsert> = [];
  for (const { emp, codes } of grids) {
    codes.forEach((code, i) => {
      if (code !== 'E' && code !== 'L' && code !== 'F') return;
      const day = i + 1;
      scheduleRows.push({
        userId: emp.id, storeId: store.id, shiftId: ctx.shiftByCode[CODE_TO_SHIFT[code]].id, date: dayBucket(day),
        monthlyScheduleEntryId: entryIdByKey.get(`${emp.id}|${day}`) ?? null, isHoliday: false,
      });
    });
  }
  const scheduleInserted = await insertManyReturning(schedules, scheduleRows);

  // ── 2. attendance for past days only ──────────────────────────────────────
  const shiftCodeById = new Map(Object.entries(ctx.shiftByCode).map(([code, s]) => [s.id, code as ShiftCode]));
  const attRows: Array<typeof attendance.$inferInsert> = [];
  const attended: Attended[] = [];
  const breakPlans: Array<{ scheduleId: number; userId: string; type: (typeof BREAKS)[ShiftCode][number]['type']; out: Date; ret: Date; cashOut: number; cashIn: number }> = [];

  for (const s of scheduleInserted) {
    const day = (s.date as Date).getUTCDate();
    if (day >= CAL.day) continue;
    const code = shiftCodeById.get(s.shiftId)!;
    const shift = ctx.shiftByCode[code];

    const roll = rng.next();
    if (roll < 0.05) {
      attRows.push({ scheduleId: s.id, userId: s.userId, storeId: store.id, date: dayBucket(day), shiftId: s.shiftId, status: 'absent', onBreak: false, recordedBy: s.userId });
      counts.absent++;
      continue;
    }
    const late = roll < 0.17;
    const checkIn = wib(day, late ? shift.startMin + rng.int(LATE_AFTER_MINUTES + 1, LATE_AFTER_MINUTES + 30) : shift.startMin - rng.int(0, 15));
    const checkOut = wib(day, shift.endMin + rng.int(0, 20));
    attRows.push({
      scheduleId: s.id, userId: s.userId, storeId: store.id, date: dayBucket(day), shiftId: s.shiftId,
      status: late ? 'late' : 'present', checkInTime: checkIn, checkOutTime: checkOut, onBreak: false, recordedBy: s.userId,
    });
    attended.push({ schedId: s.id, userId: s.userId, day, code, shiftId: s.shiftId, checkIn, checkOut });
    if (late) counts.late++; else counts.present++;

    for (const b of BREAKS[code]) {
      if (!rng.chance(code === 'full_day' ? 0.75 : 0.8)) continue;
      const out = wib(day, b.hour * 60 + rng.int(0, 30));
      const ret = addMin(out, rng.int(b.durMin, b.durMax));
      if (out <= checkIn || ret >= checkOut) continue;
      const cashOut = rng.int(1, 6) * 50_000;
      breakPlans.push({ scheduleId: s.id, userId: s.userId, type: b.type, out, ret, cashOut, cashIn: rng.chance(0.95) ? cashOut : Math.max(cashOut - 50_000, 0) });
    }
  }
  counts.attendance = attRows.length;
  const attInserted = await insertManyReturning(attendance, attRows);
  const attIdBySchedule = new Map(attInserted.map((a) => [a.scheduleId as number, a.id]));
  counts.breaks = await insertMany(breakSessions, breakPlans.map((b): typeof breakSessions.$inferInsert => ({
    attendanceId: attIdBySchedule.get(b.scheduleId)!, userId: b.userId, storeId: store.id, breakType: b.type,
    breakOutTime: b.out, returnTime: b.ret, cashOut: String(b.cashOut), cashIn: String(b.cashIn),
  })));

  // ── 3. task progress, following the live shift_tasks config ───────────────
  const morningId = ctx.shiftByCode.morning.id;
  const eveningId = ctx.shiftByCode.evening.id;
  const T = {
    grooming: [] as Array<typeof groomingTasks.$inferInsert>,
    front: [] as Array<typeof storeFrontTasks.$inferInsert>,
    setoran: [] as Array<typeof setoranTasks.$inferInsert>,
    opening: [] as Array<typeof storeOpeningTasks.$inferInsert>,
    uangModal: [] as Array<typeof cekUangModalTasks.$inferInsert>,
    cekBin: [] as Array<typeof cekBinTasks.$inferInsert>,
    vm: [] as Array<typeof vmChecklistTasks.$inferInsert>,
    marketing: [] as Array<typeof marketingCheckTasks.$inferInsert>,
    briefing: [] as Array<typeof briefingTasks.$inferInsert>,
    serah: [] as Array<typeof serahTerimaTasks.$inferInsert>,
    closing: [] as Array<typeof storeClosingTasks.$inferInsert>,
  };
  const setoranLedgerPlans: Array<{ day: number; row: Omit<typeof setoranMoneyStorage.$inferInsert, 'taskId'> }> = [];
  const uangModalPlans: Array<{ day: number; userId: string; qty: Record<number, number> }> = [];
  let lastUnpaid = 0;

  /** A moment inside the shift for a task: maps the task's window onto the right half of the day. */
  const at = (a: Attended, half: Half, [lo, hi]: readonly [number, number]): Date => {
    const [l, h] = a.code === 'full_day' ? (half === 'morning' ? [lo * 0.5, hi * 0.5] : [0.5 + lo * 0.5, 0.5 + hi * 0.5]) : [lo, hi];
    return new Date(a.checkIn.getTime() + (a.checkOut.getTime() - a.checkIn.getTime()) * (l + rng.next() * (h - l)));
  };

  const days = [...new Set(attended.map((a) => a.day))].sort((x, y) => x - y);
  for (const day of days) {
    const crew = attended.filter((a) => a.day === day);
    const date = dayBucket(day);
    const morningLead = crew.find((a) => a.code !== 'evening');
    const eveningLead = crew.find((a) => a.code !== 'morning');
    const base = (a: Attended, shiftId: number, st: TaskStatus, completedAt: Date | null) => ({
      scheduleId: a.schedId, userId: a.userId, storeId: store.id, shiftId, date, status: st,
      completedAt, createdAt: a.checkIn, updatedAt: completedAt ?? a.checkIn,
    });

    // Personal task — one per attended schedule
    for (const a of crew) {
      const st = status();
      const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.grooming) : null;
      T.grooming.push({
        ...base(a, a.shiftId, st, done),
        ...(done ? {
          uniformChecked: true, hairChecked: true, smellChecked: true, makeUpChecked: true, shoeChecked: true, nameTagChecked: true,
          selfiePhotos: pick('groomingSelfie'), ...geo(),
        } : {}),
      });
    }

    if (morningLead) {
      const a = morningLead;
      const who = { completedBy: a.userId, completedByScheduleId: a.schedId };

      // store_front
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.store_front) : null;
        T.front.push({
          ...base(a, morningId, st, done),
          ...(done ? { storefrontPhotos: pick('storefront'), rollingDoorClosedPhoto: pick('rollingDoor'), claimedBy: a.userId, claimedAt: addMin(done, -2), ...who, ...geo() } : {}),
        });
      }

      // setoran (+ money-storage ledger). The deficit chain mirrors the app:
      // today's carried deficit = last completed day's unpaid amount.
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.setoran) : null;
        if (done) {
          const actual = rng.int(85, 250) * 10_000;
          const required = actual + lastUnpaid;
          const auto = Math.floor(required / 50_000) * 50_000;
          const stored = rng.chance(0.85) ? auto : Math.max(auto - rng.int(1, 3) * 50_000, 0);
          const unpaid = required - stored;
          const resi = pick('resi'); const atm = pick('atmSelfie');
          T.setoran.push({
            ...base(a, morningId, st, done),
            expectedAmount: String(actual), carriedDeficit: String(lastUnpaid), carriedDeficitFetchedAt: addMin(done, -10),
            amount: String(stored), unpaidAmount: String(unpaid), resiPhoto: resi, atmCardSelfiePhoto: atm,
            actualReceivedAmountBy: a.userId, actualReceivedAmountAt: addMin(done, -6),
            storedAmountBy: a.userId, storedAmountAt: addMin(done, -4),
            resiPhotoBy: a.userId, resiPhotoAt: addMin(done, -2), atmCardSelfiePhotoBy: a.userId, atmCardSelfiePhotoAt: addMin(done, -1),
            notes: unpaid > 0 ? 'Ada sisa yang belum disetor, dibawa ke hari berikutnya.' : null, ...who, ...geo(),
          });
          setoranLedgerPlans.push({
            day,
            row: {
              scheduleId: a.schedId, userId: a.userId, storeId: store.id, shiftId: morningId, date,
              actualReceivedAmount: String(actual), previousUnpaidAmount: String(lastUnpaid), requiredStoreAmount: String(required),
              storedAmount: String(stored), unpaidAmount: String(unpaid), resiPhoto: resi, atmCardSelfiePhoto: atm,
              actualReceivedAmountBy: a.userId, actualReceivedAmountAt: addMin(done, -6), storedAmountBy: a.userId, storedAmountAt: addMin(done, -4),
              resiPhotoBy: a.userId, resiPhotoAt: addMin(done, -2), atmCardSelfiePhotoBy: a.userId, atmCardSelfiePhotoAt: addMin(done, -1),
              ...who, createdAt: done, updatedAt: done,
            },
          });
          lastUnpaid = unpaid;
        } else {
          T.setoran.push({ ...base(a, morningId, st, null), carriedDeficit: String(lastUnpaid) });
        }
      }

      // store_opening
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.store_opening) : null;
        if (done) {
          const t = (m: number) => addMin(done, -m);
          T.opening.push({
            ...base(a, morningId, st, done),
            loginPos: true, checkAbsenSunfish: true, tarikSohSales: true, fiveR: true, cekLamp: true, cekSoundSystem: true,
            fiveRAreaKasirPhotos: pick('fiveRKasir'), fiveRAreaDepanPhotos: pick('fiveRDepan'), fiveRAreaKananPhotos: pick('fiveRKanan'),
            fiveRAreaKiriPhotos: pick('fiveRKiri'), fiveRAreaGudangPhotos: pick('fiveRGudang'), cashDrawerPhotos: pick('cashDrawer'),
            loginPosBy: a.userId, loginPosAt: t(14), checkAbsenSunfishBy: a.userId, checkAbsenSunfishAt: t(12),
            tarikSohSalesBy: a.userId, tarikSohSalesAt: t(10), fiveRBy: a.userId, fiveRAt: t(6),
            fiveRAreaKasirBy: a.userId, fiveRAreaKasirAt: t(9), fiveRAreaDepanBy: a.userId, fiveRAreaDepanAt: t(8),
            fiveRAreaKananBy: a.userId, fiveRAreaKananAt: t(7), fiveRAreaKiriBy: a.userId, fiveRAreaKiriAt: t(6),
            fiveRAreaGudangBy: a.userId, fiveRAreaGudangAt: t(5), cekLampBy: a.userId, cekLampAt: t(4),
            cekSoundSystemBy: a.userId, cekSoundSystemAt: t(3), cashDrawerBy: a.userId, cashDrawerAt: t(2), ...who, ...geo(),
          });
        } else {
          T.opening.push(base(a, morningId, st, null));
        }
      }

      // cek_uang_modal (+ one row per denomination)
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.cek_uang_modal) : null;
        if (done) {
          const target = rng.chance(0.6) ? 500_000 : rng.int(60, 99) * 5_000; // 300k–495k = "belum penuh"
          const qty: Record<number, number> = {};
          for (const v of DENOMINATIONS) qty[v] = 1;
          let rest = target - DENOMINATIONS.reduce((s, v) => s + v, 0);
          // a few extra coins/small notes, then most of the rest in big notes; the
          // final exact greedy pass zeroes the remainder (every value divides by 100)
          for (const v of [100, 200, 500, 1000, 2000]) {
            const extra = Math.min(rng.int(0, 8), Math.floor(rest / v));
            qty[v] += extra; rest -= extra * v;
          }
          for (const v of [100000, 50000, 20000, 10000, 5000]) {
            const extra = Math.floor((rest / v) * rng.range(0.4, 1));
            qty[v] += extra; rest -= extra * v;
          }
          for (const v of [...DENOMINATIONS].reverse()) {
            const extra = Math.floor(rest / v);
            qty[v] += extra; rest -= extra * v;
          }
          const total = DENOMINATIONS.reduce((s, v) => s + v * qty[v], 0);
          T.uangModal.push({
            ...base(a, morningId, st, done), totalAmount: String(total), maxAmount: '500000',
            remainingAmount: String(500_000 - total), isPartial: total < 500_000, ...geo(),
          });
          uangModalPlans.push({ day, userId: a.userId, qty });
        } else {
          T.uangModal.push(base(a, morningId, st, null));
        }
      }

      // cek_bin — these stores have no BIN master data yet, so 0 of 0
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.cek_bin) : null;
        T.cekBin.push({ ...base(a, morningId, st, done), ...(done ? { totalStoreBins: 0, minimumBinsToCheck: 0, checkedBinsCount: 0, ...geo() } : {}) });
      }

      // vm_checklist
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.vm_checklist) : null;
        T.vm.push({
          ...base(a, morningId, st, done),
          ...(done ? {
            shoeLaceShoeFillerPriceTagHangtagLabelK3L: true, lastPairAndPigskinHangtag: true, popPromoUpdate: true,
            displayTableWallShelvingShowcaseHangbarStackingPedestal: true, floorDisplayCleanliness: true, vmToolsStorage: true, ...geo(),
          } : {}),
        });
      }

      // marketing_check
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.marketing_check) : null;
        if (done) {
          const t = (m: number) => addMin(done, -m);
          T.marketing.push({
            ...base(a, morningId, st, done),
            promoName: true, promoPeriod: true, promoMechanism: true, randomShoeItems: true, randomNonShoeItems: true, sellTag: true,
            promoNameBy: a.userId, promoNameAt: t(6), promoPeriodBy: a.userId, promoPeriodAt: t(5), promoMechanismBy: a.userId, promoMechanismAt: t(4),
            randomShoeItemsBy: a.userId, randomShoeItemsAt: t(3), randomNonShoeItemsBy: a.userId, randomNonShoeItemsAt: t(2), sellTagBy: a.userId, sellTagAt: t(1),
            ...who, ...geo(),
          });
        } else {
          T.marketing.push(base(a, morningId, st, null));
        }
      }

      // briefing + serah_terima — morning half
      {
        const st = status(); const done = st === 'completed' ? at(a, 'morning', MORNING_WINDOW.briefing) : null;
        T.briefing.push({ ...base(a, morningId, st, done), done: done != null, isBalanced: done ? true : null, ...(done ? geo() : {}) });
        const st2 = status(); const done2 = st2 === 'completed' ? at(a, 'morning', MORNING_WINDOW.serah_terima) : null;
        T.serah.push({ ...base(a, morningId, st2, done2), ...(done2 ? { ...who, ...geo() } : {}) });
      }
    }

    if (eveningLead) {
      const a = eveningLead;
      const who = { completedBy: a.userId, completedByScheduleId: a.schedId };

      // briefing + serah_terima — evening half
      {
        const st = status(); const done = st === 'completed' ? at(a, 'evening', EVENING_WINDOW.briefing) : null;
        T.briefing.push({ ...base(a, eveningId, st, done), done: done != null, isBalanced: done ? true : null, ...(done ? geo() : {}) });
        const st2 = status(); const done2 = st2 === 'completed' ? at(a, 'evening', EVENING_WINDOW.serah_terima) : null;
        T.serah.push({ ...base(a, eveningId, st2, done2), ...(done2 ? { ...who, ...geo() } : {}) });
      }

      // store_closing
      {
        const st = status(); const done = st === 'completed' ? at(a, 'evening', EVENING_WINDOW.store_closing) : null;
        if (done) {
          const t = (m: number) => addMin(done, -m);
          T.closing.push({
            ...base(a, eveningId, st, done),
            eodZReportDone: true, eodZReportBy: a.userId, eodZReportAt: t(8),
            eodEdcSettlementPhoto: pick('zReport'), eodEdcSettlementPhotoBy: a.userId, eodEdcSettlementPhotoAt: t(7),
            storefrontLockedPhoto: pick('storeLocked'), storefrontLockedPhotoBy: a.userId, storefrontLockedPhotoAt: t(1),
            edcSettlementDone: true, edcSettlementBy: a.userId, edcSettlementAt: t(6),
            edcSummaryDone: true, edcSummaryBy: a.userId, edcSummaryAt: t(4),
            openStatementDecision: 'post_statement', openStatementBy: a.userId, openStatementAt: t(3), isOnHold: false, ...who, ...geo(),
          });
        } else {
          T.closing.push(base(a, eveningId, st, null));
        }
      }
    }
  }

  await insertMany(groomingTasks, T.grooming);
  await insertMany(storeFrontTasks, T.front);
  const setoranInserted = await insertManyReturning(setoranTasks, T.setoran);
  await insertMany(storeOpeningTasks, T.opening);
  const uangModalInserted = await insertManyReturning(cekUangModalTasks, T.uangModal);
  await insertMany(cekBinTasks, T.cekBin);
  await insertMany(vmChecklistTasks, T.vm);
  await insertMany(marketingCheckTasks, T.marketing);
  await insertMany(briefingTasks, T.briefing);
  await insertMany(serahTerimaTasks, T.serah);
  await insertMany(storeClosingTasks, T.closing);

  const setoranIdByDay = new Map(setoranInserted.map((s) => [(s.date as Date).getUTCDate(), s.id]));
  counts.setoranLedger = await insertMany(
    setoranMoneyStorage,
    setoranLedgerPlans.map((p): typeof setoranMoneyStorage.$inferInsert => ({ ...p.row, taskId: setoranIdByDay.get(p.day)! })),
  );

  const uangModalIdByDay = new Map(uangModalInserted.map((s) => [(s.date as Date).getUTCDate(), s.id]));
  counts.denominations = await insertMany(
    cekUangModalDenominations,
    uangModalPlans.flatMap((p) =>
      DENOMINATIONS.map((v): typeof cekUangModalDenominations.$inferInsert => ({
        taskId: uangModalIdByDay.get(p.day)!, userId: p.userId, storeId: store.id,
        denominationValue: v, quantity: p.qty[v], amount: String(v * p.qty[v]),
      })),
    ),
  );

  const allTasks = Object.values(T).flat() as Array<{ status?: string }>;
  counts.tasks = allTasks.length;
  counts.completed = allTasks.filter((t) => t.status === 'completed').length;
  return counts;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function seedRosterDemo() {
  console.log(`\n🎭 roster-demo ${DRY ? '(DRY RUN — nothing is written)' : ''}: ${CAL.yearMonth}, history = days 1–${CAL.day - 1}, today = ${CAL.day}`);

  const shiftRows = await db.select({ id: shifts.id, code: shifts.code, startTime: shifts.startTime, endTime: shifts.endTime }).from(shifts);
  const shiftByCode = {} as Ctx['shiftByCode'];
  for (const code of ['morning', 'evening', 'full_day'] as const) {
    const row = shiftRows.find((s) => s.code === code);
    if (!row) throw new Error(`Shift "${code}" missing. Run the setup seed step first.`);
    if (!row.startTime || !row.endTime) throw new Error(`Shift "${code}" has no start/end time configured.`);
    shiftByCode[code] = { id: row.id, startMin: hhmmToMin(row.startTime), endMin: hhmmToMin(row.endTime) };
  }

  const { targets, skipped } = await findTargets();
  if (skipped.length) console.log(`   skipped: ${skipped.join(', ')}`);
  if (targets.length === 0) {
    console.log('   No eligible stores (every store with employees already has schedule/attendance data). Nothing to do.');
    return;
  }
  console.log(`   ${targets.length} eligible store(s): ${targets.map((t) => t.store.storeNo).join(', ')}\n`);

  const ctx: Ctx = { shiftByCode, pools: await loadPhotoPools(), missingPools: new Set() };

  const total = emptyCounts();
  const failed: string[] = [];
  for (const target of targets) {
    try {
      const c = await seedStore(target, ctx);
      for (const k of Object.keys(total) as Array<keyof Counts>) total[k] += c[k];
      console.log(
        `   ✓ ${target.store.storeNo.padEnd(6)} ${target.employees.length} emp · ${c.workDays} work/${c.offDays} off/${c.leaveDays} leave · ` +
        `att ${c.attendance} (${c.present} ok, ${c.late} late, ${c.absent} absent) · ${c.tasks} tasks (${c.completed} done)`,
      );
    } catch (err) {
      failed.push(target.store.storeNo);
      console.error(`   ✗ ${target.store.storeNo} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!DRY) {
        try { await rollbackStore(target.store.id, target.store.storeNo); console.error(`     rolled back ${target.store.storeNo}`); }
        catch (rbErr) { console.error(`     ROLLBACK FAILED for ${target.store.storeNo} — clean it up manually:`, rbErr); }
      }
    }
  }

  console.log('\n   ── totals ──');
  console.log(`   stores ${targets.length - failed.length}/${targets.length} · employees ${total.employees} · work ${total.workDays} / off ${total.offDays} / leave ${total.leaveDays}`);
  console.log(`   attendance ${total.attendance} (present ${total.present}, late ${total.late}, absent ${total.absent}) · breaks ${total.breaks}`);
  console.log(`   task rows ${total.tasks} (${total.completed} completed) · uang-modal denominations ${total.denominations} · setoran ledger ${total.setoranLedger}`);
  if (ctx.missingPools.size) console.log(`   ⚠ no sample photos found for: ${[...ctx.missingPools].join(', ')} (those fields were left empty)`);
  if (failed.length) throw new Error(`roster-demo failed for: ${failed.join(', ')}`);
  console.log('\n✅ roster-demo complete.');
}
