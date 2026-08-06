// scripts/seed/attendance.ts
// Fast attendance + historical task completion seeder.
//
// Optimized changes:
// - Preloads existing attendance once.
// - Bulk inserts new attendance rows and breaks.
// - Preloads task rows once per task table instead of SELECTing inside every loop.
//
// Supported env:
//   SEED_ATTENDANCE_MONTH=previous | current | YYYY-MM
//   SEED_MONTH=previous | current | YYYY-MM

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  schedules,
  attendance,
  breakSessions,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  setoranMoneyStorage,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  storeClosingTasks,
  groomingTasks,
} from "@/lib/db/schema";

type ShiftCode = "morning" | "evening" | "full_day";

type BreakCfg = {
  breakType: "lunch" | "dinner" | "full_day_lunch" | "full_day_dinner";
  hour: number;
  minuteMin: number;
  minuteMax: number;
  durationMin: number;
  durationMax: number;
};

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 500);
// Neon HTTP can timeout on large IN (...) queries and too many parallel selects.
// Keep read/update batches smaller than insert batches.
const SELECT_BATCH_SIZE = Number(process.env.SEED_SELECT_BATCH_SIZE ?? 150);
const UPDATE_BATCH_SIZE = Number(process.env.SEED_UPDATE_BATCH_SIZE ?? 150);
const LATE_AFTER_MINUTES = 30;

const FALLBACK_SHIFT_TIMES: Record<
  ShiftCode,
  { startTime: string; endTime: string }
> = {
  morning: { startTime: "07:00:00", endTime: "15:00:00" },
  evening: { startTime: "15:00:00", endTime: "23:00:00" },
  full_day: { startTime: "07:00:00", endTime: "23:00:00" },
};

const BREAK_CONFIG: Record<ShiftCode, BreakCfg[]> = {
  morning: [
    {
      breakType: "lunch",
      hour: 12,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 25,
      durationMax: 45,
    },
  ],
  evening: [
    {
      breakType: "dinner",
      hour: 18,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 25,
      durationMax: 45,
    },
  ],
  full_day: [
    {
      breakType: "full_day_lunch",
      hour: 12,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 30,
      durationMax: 45,
    },
    {
      breakType: "full_day_dinner",
      hour: 18,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 30,
      durationMax: 45,
    },
  ],
};

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function ymd(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function resolveTargetMonth(defaultMode: "current" | "previous" = "current") {
  const now = new Date();
  const raw = (
    process.env.SEED_ATTENDANCE_MONTH ||
    process.env.SEED_MONTH ||
    defaultMode
  )
    .trim()
    .toLowerCase();

  let year: number;
  let monthIndex: number;

  if (raw === "current") {
    year = now.getFullYear();
    monthIndex = now.getMonth();
  } else if (raw === "previous" || raw === "last") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    year = d.getFullYear();
    monthIndex = d.getMonth();
  } else if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    year = y;
    monthIndex = m - 1;
  } else {
    throw new Error(
      "Invalid SEED_ATTENDANCE_MONTH. Use current, previous, or YYYY-MM.",
    );
  }

  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const yearMonth = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

  return { year, monthIndex, start, end, yearMonth };
}

function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function chance(probability: number): boolean {
  return Math.random() < probability;
}

function json(paths: string[]): string {
  return JSON.stringify(paths);
}

function money(min = 50_000, max = 300_000, step = 50_000): string {
  const units = rand(Math.ceil(min / step), Math.floor(max / step));
  return String(units * step);
}

function dateWithTime(
  date: Date,
  time: string | null | undefined,
  fallback: string,
): Date {
  const [h, m, s] = (time || fallback)
    .split(":")
    .map((part) => parseInt(part, 10));
  const r = new Date(date);
  r.setHours(
    Number.isFinite(h) ? h : 0,
    Number.isFinite(m) ? m : 0,
    Number.isFinite(s) ? s : 0,
    0,
  );
  return r;
}

function parseNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  return [
    ...new Set(
      values.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      ),
    ),
  ];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function selectWhereInBatches<T>(
  table: any,
  column: any,
  ids: number[],
  batchSize = SELECT_BATCH_SIZE,
): Promise<T[]> {
  const cleanIds = uniqueNumbers(ids);
  if (!cleanIds.length) return [];

  const rows: T[] = [];
  for (const batch of chunks(cleanIds, batchSize)) {
    const result = await db.select().from(table).where(inArray(column, batch));
    rows.push(...(result as T[]));
  }
  return rows;
}

async function selectAttendanceIdsFromBreaksInBatches(
  attendanceIds: number[],
  batchSize = SELECT_BATCH_SIZE,
): Promise<number[]> {
  const cleanIds = uniqueNumbers(attendanceIds);
  if (!cleanIds.length) return [];

  const ids: number[] = [];
  for (const batch of chunks(cleanIds, batchSize)) {
    const rows = await db
      .select({ attendanceId: breakSessions.attendanceId })
      .from(breakSessions)
      .where(inArray(breakSessions.attendanceId, batch));

    for (const row of rows as Array<{ attendanceId: number | null }>) {
      if (typeof row.attendanceId === "number") ids.push(row.attendanceId);
    }
  }
  return ids;
}

async function insertInBatches<T extends Record<string, unknown>>(
  table: any,
  rows: T[],
  batchSize = BATCH_SIZE,
) {
  if (!rows.length) return [] as any[];
  const inserted: any[] = [];

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const result = await db
      .insert(table)
      .values(batch as any)
      .returning();
    inserted.push(...(result as any[]));
  }

  return inserted;
}

async function updateTaskByIds(
  table: any,
  ids: number[],
  patch: Record<string, unknown>,
) {
  if (!ids.length) return 0;
  let updated = 0;

  for (let i = 0; i < ids.length; i += UPDATE_BATCH_SIZE) {
    const batch = ids.slice(i, i + UPDATE_BATCH_SIZE);
    await db
      .update(table)
      .set(patch as any)
      .where(inArray(table.id, batch));
    updated += batch.length;
  }

  return updated;
}

async function loadTaskMap(table: any, scheduleIds: number[]) {
  const rows = await selectWhereInBatches<any>(
    table,
    table.scheduleId,
    scheduleIds,
  );

  const map = new Map<number, any>();
  for (const row of rows as any[]) {
    if (!map.has(row.scheduleId)) map.set(row.scheduleId, row);
  }
  return map;
}

export async function seedAttendance() {
  const target = resolveTargetMonth("previous");
  console.log(`\n📋 seed-attendance fast mode: ${target.yearMonth}`);
  console.log(`   Range: ${ymd(target.start)} → ${ymd(target.end)}\n`);

  const scheduleRows = await db
    .select({
      sched: schedules,
      shiftCode: shifts.code,
      shiftStartTime: shifts.startTime,
      shiftEndTime: shifts.endTime,
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .where(
      and(
        gte(schedules.date, startOfDay(target.start)),
        lte(schedules.date, endOfDay(target.end)),
        eq(schedules.isHoliday, false),
      ),
    )
    .orderBy(schedules.date, shifts.sortOrder);

  if (!scheduleRows.length) {
    throw new Error(
      `No schedules found for ${target.yearMonth}. Run the schedules seed step with the same month first.`,
    );
  }

  const scheduleIds = (scheduleRows as any[]).map((r) => r.sched.id);
  const storeIds = [
    ...new Set((scheduleRows as any[]).map((r) => r.sched.storeId)),
  ];

  const existingAttendanceRows = await selectWhereInBatches<any>(
    attendance,
    attendance.scheduleId,
    scheduleIds,
  );

  const attendanceByScheduleId = new Map<number, any>();
  for (const row of existingAttendanceRows as any[])
    attendanceByScheduleId.set(row.scheduleId, row);

  let absentCount = 0;
  let presentCount = 0;
  let lateCount = 0;

  const attendanceRowsToInsert: Array<typeof attendance.$inferInsert> = [];
  const generatedByScheduleId = new Map<
    number,
    { checkIn: Date; checkOut: Date; isAbsent: boolean; status: string }
  >();

  for (const {
    sched,
    shiftCode,
    shiftStartTime,
    shiftEndTime,
  } of scheduleRows as any[]) {
    if (
      shiftCode !== "morning" &&
      shiftCode !== "evening" &&
      shiftCode !== "full_day"
    )
      continue;
    if (attendanceByScheduleId.has(sched.id)) continue;

    const code = shiftCode as ShiftCode;
    const fallback = FALLBACK_SHIFT_TIMES[code];
    const shiftStart = dateWithTime(
      sched.date,
      shiftStartTime,
      fallback.startTime,
    );
    const shiftEnd = dateWithTime(sched.date, shiftEndTime, fallback.endTime);

    const roll = Math.random();
    const isAbsent = roll < 0.05;

    if (isAbsent) {
      attendanceRowsToInsert.push({
        scheduleId: sched.id,
        userId: sched.userId,
        storeId: sched.storeId,
        date: startOfDay(sched.date),
        shiftId: sched.shiftId,
        status: "absent",
        onBreak: false,
        recordedBy: sched.userId,
      } as any);
      generatedByScheduleId.set(sched.id, {
        checkIn: shiftStart,
        checkOut: shiftEnd,
        isAbsent: true,
        status: "absent",
      });
      absentCount++;
      continue;
    }

    const late = roll < 0.15;
    const checkIn = new Date(shiftStart);
    if (late)
      checkIn.setMinutes(
        checkIn.getMinutes() +
          rand(LATE_AFTER_MINUTES + 1, LATE_AFTER_MINUTES + 30),
      );
    else checkIn.setMinutes(checkIn.getMinutes() - rand(0, 15));

    const checkOut = new Date(shiftEnd);
    checkOut.setMinutes(checkOut.getMinutes() + rand(0, 20));

    const status = late ? "late" : "present";
    attendanceRowsToInsert.push({
      scheduleId: sched.id,
      userId: sched.userId,
      storeId: sched.storeId,
      date: startOfDay(sched.date),
      shiftId: sched.shiftId,
      status,
      checkInTime: checkIn,
      checkOutTime: checkOut,
      onBreak: false,
      recordedBy: sched.userId,
    } as any);
    generatedByScheduleId.set(sched.id, {
      checkIn,
      checkOut,
      isAbsent: false,
      status,
    });

    if (late) lateCount++;
    else presentCount++;
  }

  const insertedAttendance = await insertInBatches(
    attendance,
    attendanceRowsToInsert,
  );
  for (const row of insertedAttendance)
    attendanceByScheduleId.set(row.scheduleId, row);

  const existingBreakAttendanceIds =
    await selectAttendanceIdsFromBreaksInBatches(
      [...attendanceByScheduleId.values()].map((a: any) => a.id),
    );
  const breakAttendanceIds = new Set(existingBreakAttendanceIds);

  const breakRows: Array<typeof breakSessions.$inferInsert> = [];

  for (const {
    sched,
    shiftCode,
    shiftStartTime,
    shiftEndTime,
  } of scheduleRows as any[]) {
    if (
      shiftCode !== "morning" &&
      shiftCode !== "evening" &&
      shiftCode !== "full_day"
    )
      continue;

    const att = attendanceByScheduleId.get(sched.id);
    if (!att || att.status === "absent" || breakAttendanceIds.has(att.id))
      continue;

    const code = shiftCode as ShiftCode;
    const fallback = FALLBACK_SHIFT_TIMES[code];
    const checkIn = att.checkInTime
      ? new Date(att.checkInTime)
      : dateWithTime(sched.date, shiftStartTime, fallback.startTime);
    const checkOut = att.checkOutTime
      ? new Date(att.checkOutTime)
      : dateWithTime(sched.date, shiftEndTime, fallback.endTime);

    for (const cfg of BREAK_CONFIG[code]) {
      if (!chance(code === "full_day" ? 0.75 : 0.8)) continue;

      const breakStart = new Date(sched.date);
      breakStart.setHours(cfg.hour, rand(cfg.minuteMin, cfg.minuteMax), 0, 0);
      const breakEnd = new Date(breakStart);
      breakEnd.setMinutes(
        breakEnd.getMinutes() + rand(cfg.durationMin, cfg.durationMax),
      );

      if (breakStart > checkIn && breakEnd < checkOut) {
        const cashOut = money();
        const cashIn = chance(0.95)
          ? cashOut
          : String(Math.max(parseInt(cashOut, 10) - 50_000, 0));

        breakRows.push({
          attendanceId: att.id,
          userId: sched.userId,
          storeId: sched.storeId,
          breakType: cfg.breakType,
          breakOutTime: breakStart,
          returnTime: breakEnd,
          cashOut,
          cashIn,
        } as any);
      }
    }
  }

  const insertedBreaks = await insertInBatches(breakSessions, breakRows);

  // Load task maps sequentially. Parallel Promise.all is faster locally, but it can
  // overwhelm Neon HTTP during large seed runs and cause intermittent fetch timeouts.
  const storeOpeningMap = await loadTaskMap(storeOpeningTasks, scheduleIds);
  const storeFrontMap = await loadTaskMap(storeFrontTasks, scheduleIds);
  const setoranMap = await loadTaskMap(setoranTasks, scheduleIds);
  const cekBinMap = await loadTaskMap(cekBinTasks, scheduleIds);
  const vmMap = await loadTaskMap(vmChecklistTasks, scheduleIds);
  const marketingMap = await loadTaskMap(marketingCheckTasks, scheduleIds);
  const itemDroppingMap = await loadTaskMap(itemDroppingTasks, scheduleIds);
  const briefingMap = await loadTaskMap(briefingTasks, scheduleIds);
  const storeClosingMap = await loadTaskMap(storeClosingTasks, scheduleIds);
  const groomingMap = await loadTaskMap(groomingTasks, scheduleIds);

  const completedAt = new Date();
  const now = new Date();
  let tasksCompleted = 0;

  function pendingIds(
    map: Map<number, any>,
    probability: number,
    sourceSchedules: any[],
  ) {
    const ids: number[] = [];
    for (const { sched } of sourceSchedules) {
      const task = map.get(sched.id);
      if (!task || task.status !== "not_started") continue;
      if (!chance(probability)) continue;
      ids.push(task.id);
    }
    return ids;
  }

  const morningSchedules = (scheduleRows as any[]).filter(
    (r) => r.shiftCode === "morning" || r.shiftCode === "full_day",
  );
  const eveningSchedules = (scheduleRows as any[]).filter(
    (r) => r.shiftCode === "evening" || r.shiftCode === "full_day",
  );

  const storeOpeningIds = pendingIds(storeOpeningMap, 0.9, morningSchedules);
  tasksCompleted += await updateTaskByIds(storeOpeningTasks, storeOpeningIds, {
    loginPos: true,
    checkAbsenSunfish: true,
    tarikSohSales: true,
    fiveR: true,
    fiveRAreaKasirPhotos: json(["opening/5r-kasir.jpg"]),
    fiveRAreaDepanPhotos: json(["opening/5r-depan.jpg"]),
    fiveRAreaKananPhotos: json(["opening/5r-kanan.jpg"]),
    fiveRAreaKiriPhotos: json(["opening/5r-kiri.jpg"]),
    fiveRAreaGudangPhotos: json(["opening/5r-gudang.jpg"]),
    cekLamp: true,
    cekSoundSystem: true,
    cashDrawerPhotos: json(["opening/sample-cashdrawer.jpg"]),
    notes: null,
    status: "completed",
    completedAt,
    updatedAt: now,
  });

  tasksCompleted += await updateTaskByIds(
    storeFrontTasks,
    pendingIds(storeFrontMap, 0.9, morningSchedules),
    {
      storefrontPhotos: json(["store-front/storefront/team.jpg"]),
      rollingDoorClosedPhoto: "store-front/rolling-door/closed.jpg",
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  // Setoran needs per-row amounts, so it stays row-by-row but without row SELECTs.
  const setoranStorageRows: Array<typeof setoranMoneyStorage.$inferInsert> = [];
  for (const { sched } of morningSchedules) {
    const task = setoranMap.get(sched.id);
    if (!task || task.status !== "not_started" || !chance(0.8)) continue;

    const actualReceivedAmount = rand(850_000, 2_500_000);
    const previousUnpaidAmount = parseNum(task.carriedDeficit);
    const requiredStoreAmount = actualReceivedAmount + previousUnpaidAmount;
    const storedAmount = chance(0.85)
      ? requiredStoreAmount
      : Math.max(0, requiredStoreAmount - rand(50_000, 250_000));
    const unpaidAmount = Math.max(0, requiredStoreAmount - storedAmount);

    await db
      .update(setoranTasks)
      .set({
        expectedAmount: String(actualReceivedAmount),
        carriedDeficit: String(previousUnpaidAmount),
        amount: String(storedAmount),
        unpaidAmount: String(unpaidAmount),
        resiPhoto: "setoran/resi/sample.jpg",
        atmCardSelfiePhoto: "setoran/atm-card-selfie/sample.jpg",
        notes:
          unpaidAmount > 0
            ? "Auto seed: ada unpaid untuk carry-forward."
            : null,
        status: "completed",
        completedAt,
        updatedAt: now,
      } as any)
      .where(eq(setoranTasks.id, task.id));

    setoranStorageRows.push({
      taskId: task.id,
      scheduleId: sched.id,
      userId: sched.userId,
      storeId: sched.storeId,
      shiftId: sched.shiftId,
      date: startOfDay(sched.date),
      actualReceivedAmount: String(actualReceivedAmount),
      previousUnpaidAmount: String(previousUnpaidAmount),
      requiredStoreAmount: String(requiredStoreAmount),
      storedAmount: String(storedAmount),
      unpaidAmount: String(unpaidAmount),
      resiPhoto: "setoran/resi/sample.jpg",
      atmCardSelfiePhoto: "setoran/atm-card-selfie/sample.jpg",
      notes: unpaidAmount > 0 ? "Auto seed: carry-forward test row." : null,
      updatedAt: now,
    } as any);
    tasksCompleted++;
  }
  await insertInBatches(setoranMoneyStorage, setoranStorageRows);

  // Cek Bin needs child rows.
  const activeBins: any[] = [];
  for (const storeBatch of chunks(uniqueNumbers(storeIds), SELECT_BATCH_SIZE)) {
    const rows = await db
      .select()
      .from(storeBins)
      .where(
        and(
          inArray(storeBins.storeId, storeBatch),
          eq(storeBins.isActive, true),
        ),
      );
    activeBins.push(...(rows as any[]));
  }
  const binsByStoreId = new Map<number, any[]>();
  for (const bin of activeBins as any[]) {
    const list = binsByStoreId.get(bin.storeId) ?? [];
    list.push(bin);
    binsByStoreId.set(bin.storeId, list);
  }

  const cekBinTaskBinsRows: Array<typeof cekBinTaskBins.$inferInsert> = [];
  for (const { sched } of morningSchedules) {
    const task = cekBinMap.get(sched.id);
    if (!task || task.status !== "not_started" || !chance(0.8)) continue;
    const bins = binsByStoreId.get(sched.storeId) ?? [];
    const minToCheck = Math.max(1, Math.ceil(bins.length * 0.3));
    const checkedBins = bins.slice(0, minToCheck);

    await db
      .update(cekBinTasks)
      .set({
        totalStoreBins: bins.length,
        minimumBinsToCheck: minToCheck,
        checkedBinsCount: checkedBins.length,
        notes: checkedBins.length
          ? "Auto seed cek bin."
          : "No active bins seeded for this store.",
        status: "completed",
        completedAt,
        updatedAt: now,
      } as any)
      .where(eq(cekBinTasks.id, task.id));

    for (const bin of checkedBins) {
      cekBinTaskBinsRows.push({
        taskId: task.id,
        binId: bin.id,
        bin: bin.bin,
        nama: bin.nama,
        qtyBc: bin.qtyBc,
        qtySesuaiBin: bin.qtySesuaiBin,
        qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
        notes: chance(0.15) ? "Ada minor selisih, perlu follow up." : null,
      } as any);
    }
    tasksCompleted++;
  }
  await insertInBatches(cekBinTaskBins, cekBinTaskBinsRows);

  tasksCompleted += await updateTaskByIds(
    vmChecklistTasks,
    pendingIds(vmMap, 0.9, morningSchedules),
    {
      shoeLaceShoeFillerPriceTagHangtagLabelK3L: true,
      lastPairAndPigskinHangtag: true,
      popPromoUpdate: true,
      displayTableWallShelvingShowcaseHangbarStackingPedestal: true,
      floorDisplayCleanliness: true,
      vmToolsStorage: true,
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  tasksCompleted += await updateTaskByIds(
    marketingCheckTasks,
    pendingIds(marketingMap, 0.9, morningSchedules),
    {
      promoName: true,
      promoPeriod: true,
      promoMechanism: true,
      randomShoeItems: true,
      randomNonShoeItems: true,
      sellTag: true,
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  tasksCompleted += await updateTaskByIds(
    itemDroppingTasks,
    pendingIds(itemDroppingMap, 0.75, morningSchedules),
    {
      hasDropping: true,
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  tasksCompleted += await updateTaskByIds(
    briefingTasks,
    pendingIds(briefingMap, 0.85, eveningSchedules),
    {
      done: true,
      isBalanced: true,
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  tasksCompleted += await updateTaskByIds(
    storeClosingTasks,
    pendingIds(storeClosingMap, 0.85, eveningSchedules),
    {
      eodZReportDone: true,
      zReportPhotos: json(["store-closing/eod-z-report/sample.jpg"]),
      edcSettlementDone: true,
      edcSettlementNotes: null,
      edcSummaryDone: true,
      edcSummaryNotes: null,
      openStatementDecision: "post_statement",
      openStatementHoldReason: null,
      isOnHold: false,
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  tasksCompleted += await updateTaskByIds(
    groomingTasks,
    pendingIds(groomingMap, 0.9, scheduleRows as any[]),
    {
      uniformActive: true,
      hairActive: true,
      smellActive: true,
      makeUpActive: true,
      shoeActive: true,
      nameTagActive: true,
      uniformChecked: true,
      hairChecked: true,
      smellChecked: true,
      makeUpChecked: true,
      shoeChecked: true,
      nameTagChecked: true,
      selfiePhotos: json(["grooming/selfie/sample.jpg"]),
      notes: null,
      status: "completed",
      completedAt,
      updatedAt: now,
    },
  );

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`✅ seed-attendance complete (${target.yearMonth})`);
  console.log(`   Schedule rows scanned     : ${scheduleRows.length}`);
  console.log(`   Attendance created        : ${insertedAttendance.length}`);
  console.log(
    `   Attendance already existed: ${existingAttendanceRows.length}`,
  );
  console.log(`   Present                   : ${presentCount}`);
  console.log(`   Late                      : ${lateCount}`);
  console.log(`   Absent                    : ${absentCount}`);
  console.log(`   Break rows created        : ${insertedBreaks.length}`);
  console.log(`   Tasks completed           : ${tasksCompleted}`);
  console.log("═══════════════════════════════════════════════════════════\n");
}

