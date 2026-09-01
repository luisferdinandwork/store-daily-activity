// scripts/seed/tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fast task seeder.
//
// Seeds task rows for existing schedules using preloaded keys + batched inserts.
//
// Store Closing change:
// - Removed old EDC Reconciliation, EOD Z-Report, and Open Statement task rows.
// - Seeds only one evening shared task: store_closing_tasks.
// - Store Closing is once per store/date, even when multiple evening/full-day
//   schedules exist for that store/day.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  schedules,
  users,
  stores,
  areas,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  storeBins,
  vmChecklistTasks,
  marketingCheckTasks,
  briefingTasks,
  storeClosingTasks,
  groomingTasks,
} from "@/lib/db/schema";

type ShiftCode = "morning" | "evening" | "full_day";
type CountBucket = { created: number; skipped: number };
type TaskCounts = Record<string, CountBucket>;

const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 500);

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

function resolveSeedRange() {
  const now = new Date();
  const raw = (
    process.env.SEED_TASKS_MONTH ||
    process.env.SEED_SCHEDULE_MONTHS ||
    process.env.SEED_MONTH ||
    "both"
  )
    .trim()
    .toLowerCase();

  if (
    raw === "both" ||
    raw === "default" ||
    raw === "previous,current" ||
    raw === "current,previous"
  ) {
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const currEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return {
      start: startOfDay(prevStart),
      end: endOfDay(currEnd),
      label: "previous+current",
    };
  }

  if (raw === "current") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );
    return {
      start: startOfDay(start),
      end: endOfDay(end),
      label: ymd(start).slice(0, 7),
    };
  }

  if (raw === "previous" || raw === "last") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return {
      start: startOfDay(start),
      end: endOfDay(end),
      label: ymd(start).slice(0, 7),
    };
  }

  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [year, month] = raw.split("-").map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start: startOfDay(start), end: endOfDay(end), label: raw };
  }

  return {
    start: null as Date | null,
    end: null as Date | null,
    label: "all schedules",
  };
}

async function insertInBatches<T extends Record<string, unknown>>(
  table: any,
  rows: T[],
  batchSize = BATCH_SIZE,
) {
  if (!rows.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    await db.insert(table).values(batch as any);
    inserted += batch.length;
  }

  return inserted;
}

function bump(
  counts: TaskCounts,
  key: string,
  action: "created" | "skipped",
  amount = 1,
) {
  counts[key][action] += amount;
}

function makeBase(sched: any, shiftId: number, date: Date) {
  return {
    scheduleId: sched.id,
    userId: sched.userId,
    storeId: sched.storeId,
    shiftId,
    date,
    status: "not_started" as const,
  };
}

async function loadStoreDateKeys(
  table: any,
  storeIds: number[],
  start: Date | null,
  end: Date | null,
) {
  if (!storeIds.length) return new Set<string>();

  const where =
    start && end
      ? and(
          inArray(table.storeId, storeIds),
          gte(table.date, start),
          lte(table.date, end),
        )
      : inArray(table.storeId, storeIds);

  const rows = await db
    .select({ storeId: table.storeId, date: table.date })
    .from(table)
    .where(where as any);

  return new Set((rows as any[]).map((r) => `${r.storeId}|${ymd(r.date)}`));
}

async function loadStoreDateShiftKeys(
  table: any,
  storeIds: number[],
  start: Date | null,
  end: Date | null,
) {
  if (!storeIds.length) return new Set<string>();

  const filters: any[] = [inArray(table.storeId, storeIds)];
  if (start && end) filters.push(gte(table.date, start), lte(table.date, end));

  const rows = await db
    .select({
      storeId: table.storeId,
      date: table.date,
      shiftId: table.shiftId,
    })
    .from(table)
    .where(and(...filters));

  return new Set(
    (rows as any[]).map((r) => `${r.storeId}|${ymd(r.date)}|${r.shiftId}`),
  );
}

async function loadScheduleIdKeys(table: any, scheduleIds: number[]) {
  if (!scheduleIds.length) return new Set<number>();

  const rows = await db
    .select({ scheduleId: table.scheduleId })
    .from(table)
    .where(inArray(table.scheduleId, scheduleIds));

  return new Set((rows as any[]).map((r) => Number(r.scheduleId)));
}

function addStoreDateTask(
  counts: TaskCounts,
  keySet: Set<string>,
  countKey: keyof TaskCounts,
  list: Array<any>,
  base: Record<string, unknown>,
) {
  const key = `${base.storeId}|${ymd(base.date as Date)}`;

  if (keySet.has(key)) {
    bump(counts, countKey as string, "skipped");
    return;
  }

  keySet.add(key);
  list.push(base);
  bump(counts, countKey as string, "created");
}

function addStoreDateShiftTask(
  counts: TaskCounts,
  keySet: Set<string>,
  countKey: keyof TaskCounts,
  list: Array<any>,
  base: Record<string, unknown>,
) {
  const key = `${base.storeId}|${ymd(base.date as Date)}|${base.shiftId}`;

  if (keySet.has(key)) {
    bump(counts, countKey as string, "skipped");
    return;
  }

  keySet.add(key);
  list.push(base);
  bump(counts, countKey as string, "created");
}

export async function seedTasks() {
  const range = resolveSeedRange();
  console.log(`\n🗂️  seed-tasks fast mode: ${range.label}`);

  const scheduleFilters: any[] = [];
  if (range.start && range.end) {
    scheduleFilters.push(
      gte(schedules.date, range.start),
      lte(schedules.date, range.end),
    );
  }

  const allSchedules = await db
    .select({
      sched: schedules,
      shiftCode: shifts.code,
      user: { id: users.id, name: users.name },
      store: { id: stores.id, name: stores.name },
      area: { name: areas.name },
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .leftJoin(users, eq(schedules.userId, users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(
      scheduleFilters.length ? and(...scheduleFilters) : (undefined as any),
    )
    .orderBy(areas.name, stores.name, schedules.date, shifts.sortOrder);

  if (!allSchedules.length) {
    throw new Error("No schedule rows found. Run the schedules seed step first.");
  }

  const allShifts = await db
    .select({ id: shifts.id, code: shifts.code })
    .from(shifts);
  const shiftIdByCode = Object.fromEntries(
    allShifts.map((s) => [s.code, s.id]),
  ) as Record<string, number>;
  const morningShiftId = shiftIdByCode.morning;
  const eveningShiftId = shiftIdByCode.evening;

  if (!morningShiftId || !eveningShiftId) {
    throw new Error(
      "morning/evening shifts not found. Run the setup seed step first.",
    );
  }

  const storeIds = [
    ...new Set((allSchedules as any[]).map((r) => r.sched.storeId)),
  ];
  const scheduleIds = (allSchedules as any[]).map((r) => r.sched.id);

  const counts: TaskCounts = {
    storeOpening: { created: 0, skipped: 0 },
    storeFront: { created: 0, skipped: 0 },
    setoran: { created: 0, skipped: 0 },
    cekBin: { created: 0, skipped: 0 },
    vmChecklist: { created: 0, skipped: 0 },
    marketingCheck: { created: 0, skipped: 0 },
    briefing: { created: 0, skipped: 0 },
    // serah_terima intentionally not seeded here — it's a shared, rolling
    // handover board per store now, not a per-day task row. Add sample
    // entries via the app itself if needed for testing.
    storeClosing: { created: 0, skipped: 0 },
    grooming: { created: 0, skipped: 0 },
  };

  console.log(`   Schedules scanned: ${allSchedules.length}`);

  const [
    openingKeys,
    frontKeys,
    setoranKeys,
    cekBinKeys,
    vmKeys,
    marketingKeys,
    briefingKeys,
    storeClosingKeys,
    groomingScheduleIds,
    activeBins,
  ] = await Promise.all([
    loadStoreDateKeys(storeOpeningTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(storeFrontTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(setoranTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(cekBinTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(vmChecklistTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(marketingCheckTasks, storeIds, range.start, range.end),
    loadStoreDateShiftKeys(briefingTasks, storeIds, range.start, range.end),
    loadStoreDateKeys(storeClosingTasks, storeIds, range.start, range.end),
    loadScheduleIdKeys(groomingTasks, scheduleIds),
    db
      .select({ storeId: storeBins.storeId })
      .from(storeBins)
      .where(
        and(inArray(storeBins.storeId, storeIds), eq(storeBins.isActive, true)),
      ),
  ]);

  const binCountByStoreId = new Map<number, number>();
  for (const row of activeBins as Array<{ storeId: number }>) {
    binCountByStoreId.set(
      row.storeId,
      (binCountByStoreId.get(row.storeId) ?? 0) + 1,
    );
  }

  const rows = {
    storeOpening: [] as Array<typeof storeOpeningTasks.$inferInsert>,
    storeFront: [] as Array<typeof storeFrontTasks.$inferInsert>,
    setoran: [] as Array<typeof setoranTasks.$inferInsert>,
    cekBin: [] as Array<typeof cekBinTasks.$inferInsert>,
    vmChecklist: [] as Array<typeof vmChecklistTasks.$inferInsert>,
    marketingCheck: [] as Array<typeof marketingCheckTasks.$inferInsert>,
    briefing: [] as Array<typeof briefingTasks.$inferInsert>,
    storeClosing: [] as Array<typeof storeClosingTasks.$inferInsert>,
    grooming: [] as Array<typeof groomingTasks.$inferInsert>,
  };

  for (const { sched, shiftCode } of allSchedules as any[]) {
    const code = shiftCode as ShiftCode;
    const date = startOfDay(sched.date);
    const isMorning = code === "morning" || code === "full_day";
    const isEvening = code === "evening" || code === "full_day";

    const morningBase = makeBase(sched, morningShiftId, date);
    const eveningBase = makeBase(sched, eveningShiftId, date);

    if (isMorning) {
      addStoreDateTask(
        counts,
        openingKeys,
        "storeOpening",
        rows.storeOpening,
        morningBase,
      );
      addStoreDateTask(
        counts,
        frontKeys,
        "storeFront",
        rows.storeFront,
        morningBase,
      );
      addStoreDateTask(counts, setoranKeys, "setoran", rows.setoran, {
        ...morningBase,
        carriedDeficit: "0",
        unpaidAmount: "0",
      });

      const totalStoreBins = binCountByStoreId.get(sched.storeId) ?? 0;
      addStoreDateTask(counts, cekBinKeys, "cekBin", rows.cekBin, {
        ...morningBase,
        totalStoreBins,
        minimumBinsToCheck:
          totalStoreBins > 0 ? Math.ceil(totalStoreBins * 0.3) : 0,
        checkedBinsCount: 0,
      });

      addStoreDateTask(
        counts,
        vmKeys,
        "vmChecklist",
        rows.vmChecklist,
        morningBase,
      );
      addStoreDateTask(
        counts,
        marketingKeys,
        "marketingCheck",
        rows.marketingCheck,
        morningBase,
      );
      addStoreDateShiftTask(counts, briefingKeys, "briefing", rows.briefing, {
        ...morningBase,
        done: false,
        isBalanced: null,
        parentTaskId: null,
      });
    }

    if (isEvening) {
      // Evening Briefing row — shared per store/shift/day. Created for a
      // standalone evening schedule AND for a full_day schedule (full_day
      // employees work both halves and complete both briefings), matching
      // getOrCreateBriefingForSchedule in lib/db/utils/briefing.ts.
      addStoreDateShiftTask(counts, briefingKeys, "briefing", rows.briefing, {
        ...eveningBase,
        done: false,
        isBalanced: null,
        parentTaskId: null,
      });

      addStoreDateTask(
        counts,
        storeClosingKeys,
        "storeClosing",
        rows.storeClosing,
        {
          ...eveningBase,
          eodZReportDone: false,
          edcSettlementDone: false,
          edcSummaryDone: false,
          isOnHold: false,
        },
      );
    }

    if (groomingScheduleIds.has(sched.id)) {
      bump(counts, "grooming", "skipped");
    } else {
      groomingScheduleIds.add(sched.id);
      rows.grooming.push({
        scheduleId: sched.id,
        userId: sched.userId,
        storeId: sched.storeId,
        shiftId: sched.shiftId,
        date,
        status: "not_started" as const,
      } as any);
      bump(counts, "grooming", "created");
    }
  }

  await insertInBatches(storeOpeningTasks, rows.storeOpening);
  await insertInBatches(storeFrontTasks, rows.storeFront);
  await insertInBatches(setoranTasks, rows.setoran);
  await insertInBatches(cekBinTasks, rows.cekBin);
  await insertInBatches(vmChecklistTasks, rows.vmChecklist);
  await insertInBatches(marketingCheckTasks, rows.marketingCheck);
  await insertInBatches(briefingTasks, rows.briefing);
  await insertInBatches(storeClosingTasks, rows.storeClosing);
  await insertInBatches(groomingTasks, rows.grooming);

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("✅ seed-tasks complete");
  console.log("═══════════════════════════════════════════════════════════");

  for (const [key, value] of Object.entries(counts)) {
    console.log(
      `${key.padEnd(18)} created=${String(value.created).padStart(4)} skipped=${String(value.skipped).padStart(4)}`,
    );
  }

  console.log("");
}

