// scripts/seed-tasks.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds task rows for every existing schedule row.
//
// Current task behavior:
//   • Morning shared tasks are seeded ONCE per (storeId, date).
//   • Briefing, Item Dropping, and Serah Terima are shared PER SHIFT:
//       - morning schedule  -> morning row
//       - evening schedule  -> evening row
//       - full_day schedule -> morning row only
//   • Evening operational tasks are seeded ONCE per (storeId, date, eveningShift).
//   • Grooming is personal, so it is seeded ONCE per scheduleId.
//   • full_day schedules receive morning shared tasks and evening operational tasks.
//
// Run order:
//   1. tsx scripts/seed-schedules.ts
//   2. tsx scripts/seed-tasks.ts
//   3. tsx scripts/seed-attendance.ts
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
config({ path: '.env.local' });

import { db } from '@/lib/db';
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
  itemDroppingTasks,
  briefingTasks,
  serahTerimaTasks,
  eodZReportTasks,
  edcReconciliationTasks,
  openStatementTasks,
  groomingTasks,
} from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type CountBucket = { created: number; skipped: number };
type SeedStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'discrepancy';

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function ymd(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function makeLabel(input: {
  areaName?: string | null;
  storeName?: string | null;
  userName?: string | null;
  shiftCode: string;
  date: Date;
}) {
  return (
    `${(input.areaName ?? '?').padEnd(12)} | ` +
    `${(input.storeName ?? '?').padEnd(16)} | ` +
    `${(input.userName ?? '?').padEnd(18)} | ` +
    `${input.shiftCode.padEnd(8)} | ` +
    ymd(input.date)
  );
}

/**
 * Shared store/day task, like store opening or store front.
 * These tables usually have unique(storeId, date), so shift is intentionally
 * not part of the existence check.
 */
async function sharedStoreDateExists(
  table: any,
  storeId: number,
  date: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.storeId, storeId),
        eq(table.date, startOfDay(date)),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * Shared store/day/shift task.
 * Used for Briefing, Item Dropping, and Serah Terima because each shift has
 * its own row, while full_day maps to the morning row only.
 */
async function sharedStoreDateShiftExists(
  table: any,
  storeId: number,
  date: Date,
  shiftId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.storeId, storeId),
        eq(table.date, startOfDay(date)),
        eq(table.shiftId, shiftId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/**
 * Evening discrepancy-capable tasks can stay active for the day.
 * We only skip if a non-terminal task already exists for this store/date/shift.
 */
async function activeStoreDateShiftExists(
  table: any,
  storeId: number,
  date: Date,
  shiftId: number,
): Promise<boolean> {
  const activeStatuses: SeedStatus[] = ['pending', 'in_progress', 'discrepancy'];

  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        eq(table.storeId, storeId),
        eq(table.date, startOfDay(date)),
        eq(table.shiftId, shiftId),
        inArray(table.status, activeStatuses),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** Grooming is personal — one row per scheduleId. */
async function personalExists(
  table: typeof groomingTasks,
  scheduleId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.scheduleId, scheduleId))
    .limit(1);

  return Boolean(row);
}

function bump(bucket: CountBucket, action: 'created' | 'skipped') {
  bucket[action]++;
}

// ─── Counters ─────────────────────────────────────────────────────────────────

const counts: Record<string, CountBucket> = {
  storeOpening:      { created: 0, skipped: 0 },
  storeFront:        { created: 0, skipped: 0 },
  setoran:           { created: 0, skipped: 0 },
  cekBin:            { created: 0, skipped: 0 },
  vmChecklist:       { created: 0, skipped: 0 },
  marketingCheck:    { created: 0, skipped: 0 },
  itemDropping:      { created: 0, skipped: 0 },
  briefing:          { created: 0, skipped: 0 },
  serahTerima:       { created: 0, skipped: 0 },
  eodZReport:        { created: 0, skipped: 0 },
  edcReconciliation: { created: 0, skipped: 0 },
  openStatement:     { created: 0, skipped: 0 },
  grooming:          { created: 0, skipped: 0 },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function seedTasks() {
  console.log('🗂️   seed-tasks: all current task types\n');

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
    .orderBy(areas.name, stores.name, schedules.date, shifts.sortOrder);

  if (!allSchedules.length) {
    console.error('❌  No schedule rows found. Run seed-schedules.ts first.');
    process.exit(1);
  }

  const allShifts = await db.select({ id: shifts.id, code: shifts.code }).from(shifts);
  const shiftIdByCode = Object.fromEntries(allShifts.map((s) => [s.code, s.id])) as Record<string, number>;

  const morningShiftId = shiftIdByCode.morning;
  const eveningShiftId = shiftIdByCode.evening;

  if (!morningShiftId || !eveningShiftId) {
    console.error('❌  morning/evening shifts not found. Run seed-setup.ts first.');
    process.exit(1);
  }

  console.log(`   Found ${allSchedules.length} schedule row(s).`);
  console.log(`   morning shift id: ${morningShiftId}`);
  console.log(`   evening shift id: ${eveningShiftId}\n`);

  let errors = 0;

  for (const { sched, shiftCode, user, store, area } of allSchedules) {
    const date = startOfDay(sched.date);
    const isMorning = shiftCode === 'morning' || shiftCode === 'full_day';
    const isEvening = shiftCode === 'evening' || shiftCode === 'full_day';

    const label = makeLabel({
      areaName: area?.name,
      storeName: store?.name,
      userName: user?.name,
      shiftCode,
      date,
    });

    const morningBase = {
      scheduleId: sched.id,
      userId: sched.userId,
      storeId: sched.storeId,
      shiftId: morningShiftId,
      date,
      status: 'pending' as const,
    };

    const eveningBase = {
      scheduleId: sched.id,
      userId: sched.userId,
      storeId: sched.storeId,
      shiftId: eveningShiftId,
      date,
      status: 'pending' as const,
    };

    try {
      // ── MORNING SHARED TASKS ──────────────────────────────────────────────
      if (isMorning) {
        if (await sharedStoreDateExists(storeOpeningTasks, sched.storeId, date)) {
          bump(counts.storeOpening, 'skipped');
        } else {
          await db.insert(storeOpeningTasks).values(morningBase);
          bump(counts.storeOpening, 'created');
          console.log(`   ✅ storeOpening       ${label}`);
        }

        if (await sharedStoreDateExists(storeFrontTasks, sched.storeId, date)) {
          bump(counts.storeFront, 'skipped');
        } else {
          await db.insert(storeFrontTasks).values(morningBase);
          bump(counts.storeFront, 'created');
          console.log(`   ✅ storeFront         ${label}`);
        }

        if (await sharedStoreDateExists(setoranTasks, sched.storeId, date)) {
          bump(counts.setoran, 'skipped');
        } else {
          await db.insert(setoranTasks).values(morningBase);
          bump(counts.setoran, 'created');
          console.log(`   ✅ setoran            ${label}`);
        }

        if (await sharedStoreDateExists(cekBinTasks, sched.storeId, date)) {
          bump(counts.cekBin, 'skipped');
        } else {
          const activeBins = await db
            .select({ id: storeBins.id })
            .from(storeBins)
            .where(
              and(
                eq(storeBins.storeId, sched.storeId),
                eq(storeBins.isActive, true),
              ),
            );

          const totalStoreBins = activeBins.length;
          const minimumBinsToCheck = totalStoreBins > 0 ? Math.ceil(totalStoreBins * 0.3) : 0;

          await db.insert(cekBinTasks).values({
            ...morningBase,
            totalStoreBins,
            minimumBinsToCheck,
            checkedBinsCount: 0,
          });
          bump(counts.cekBin, 'created');
          console.log(`   ✅ cekBin             ${label}`);
        }

        if (await sharedStoreDateExists(vmChecklistTasks, sched.storeId, date)) {
          bump(counts.vmChecklist, 'skipped');
        } else {
          await db.insert(vmChecklistTasks).values(morningBase);
          bump(counts.vmChecklist, 'created');
          console.log(`   ✅ vmChecklist        ${label}`);
        }

        if (await sharedStoreDateExists(marketingCheckTasks, sched.storeId, date)) {
          bump(counts.marketingCheck, 'skipped');
        } else {
          await db.insert(marketingCheckTasks).values(morningBase);
          bump(counts.marketingCheck, 'created');
          console.log(`   ✅ marketingCheck     ${label}`);
        }

        // Shift-scoped shared tasks: morning and full_day schedules use
        // the morning row. Evening rows are seeded below only for evening shifts.
        if (await sharedStoreDateShiftExists(itemDroppingTasks, sched.storeId, date, morningShiftId)) {
          bump(counts.itemDropping, 'skipped');
        } else {
          await db.insert(itemDroppingTasks).values({
            ...morningBase,
            hasDropping: false,
          });
          bump(counts.itemDropping, 'created');
          console.log(`   ✅ itemDropping       ${label}`);
        }

        if (await sharedStoreDateShiftExists(briefingTasks, sched.storeId, date, morningShiftId)) {
          bump(counts.briefing, 'skipped');
        } else {
          await db.insert(briefingTasks).values({
            ...morningBase,
            done: false,
            isBalanced: null,
            parentTaskId: null,
          });
          bump(counts.briefing, 'created');
          console.log(`   ✅ briefing           ${label}`);
        }

        if (await sharedStoreDateShiftExists(serahTerimaTasks, sched.storeId, date, morningShiftId)) {
          bump(counts.serahTerima, 'skipped');
        } else {
          await db.insert(serahTerimaTasks).values({
            ...morningBase,
            handoverText: '',
          });
          bump(counts.serahTerima, 'created');
          console.log(`   ✅ serahTerima        ${label}`);
        }
      }

      // ── EVENING OPERATIONAL TASKS ─────────────────────────────────────────
      if (isEvening) {
        // Briefing, Item Dropping, and Serah Terima have an evening row only
        // for real evening schedules. Full-day employees use the morning row.
        if (shiftCode === 'evening') {
          if (await sharedStoreDateShiftExists(itemDroppingTasks, sched.storeId, date, eveningShiftId)) {
            bump(counts.itemDropping, 'skipped');
          } else {
            await db.insert(itemDroppingTasks).values({
              ...eveningBase,
              hasDropping: false,
            });
            bump(counts.itemDropping, 'created');
            console.log(`   ✅ itemDropping       ${label}`);
          }

          if (await sharedStoreDateShiftExists(briefingTasks, sched.storeId, date, eveningShiftId)) {
            bump(counts.briefing, 'skipped');
          } else {
            await db.insert(briefingTasks).values({
              ...eveningBase,
              done: false,
              isBalanced: null,
              parentTaskId: null,
            });
            bump(counts.briefing, 'created');
            console.log(`   ✅ briefing           ${label}`);
          }

          if (await sharedStoreDateShiftExists(serahTerimaTasks, sched.storeId, date, eveningShiftId)) {
            bump(counts.serahTerima, 'skipped');
          } else {
            await db.insert(serahTerimaTasks).values({
              ...eveningBase,
              handoverText: '',
            });
            bump(counts.serahTerima, 'created');
            console.log(`   ✅ serahTerima        ${label}`);
          }
        }
        if (await activeStoreDateShiftExists(eodZReportTasks, sched.storeId, date, eveningShiftId)) {
          bump(counts.eodZReport, 'skipped');
        } else {
          await db.insert(eodZReportTasks).values(eveningBase);
          bump(counts.eodZReport, 'created');
          console.log(`   ✅ eodZReport         ${label}`);
        }

        if (await activeStoreDateShiftExists(edcReconciliationTasks, sched.storeId, date, eveningShiftId)) {
          bump(counts.edcReconciliation, 'skipped');
        } else {
          await db.insert(edcReconciliationTasks).values(eveningBase);
          bump(counts.edcReconciliation, 'created');
          console.log(`   ✅ edcReconciliation  ${label}`);
        }

        if (await activeStoreDateShiftExists(openStatementTasks, sched.storeId, date, eveningShiftId)) {
          bump(counts.openStatement, 'skipped');
        } else {
          await db.insert(openStatementTasks).values(eveningBase);
          bump(counts.openStatement, 'created');
          console.log(`   ✅ openStatement      ${label}`);
        }
      }

      // ── GROOMING — PERSONAL, ALL SHIFTS ──────────────────────────────────
      if (await personalExists(groomingTasks, sched.id)) {
        bump(counts.grooming, 'skipped');
      } else {
        await db.insert(groomingTasks).values({
          scheduleId: sched.id,
          userId: sched.userId,
          storeId: sched.storeId,
          shiftId: sched.shiftId,
          date,
          status: 'pending' as const,
        });
        bump(counts.grooming, 'created');
        console.log(`   ✅ grooming           ${label}`);
      }
    } catch (err) {
      errors++;
      console.error(`   ❌ schedule ${sched.id}:`, err);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅  seed-tasks complete!\n');

  const pad = (s: string) => s.padEnd(19);
  console.log(`   ${'Task type'.padEnd(19)}  created  skipped`);
  console.log('   ' + '─'.repeat(38));

  for (const [name, c] of Object.entries(counts)) {
    console.log(
      `   ${pad(name)}  ${String(c.created).padStart(7)}  ${String(c.skipped).padStart(7)}`,
    );
  }

  console.log(`\n   Errors: ${errors}`);
  if (errors > 0) console.log('   ⚠️  Some rows failed — check logs above.');
  console.log('\n   Next step: tsx scripts/seed-attendance.ts');
  console.log('═══════════════════════════════════════════════════════════');

  if (errors > 0) process.exit(1);
}

seedTasks()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌  seed-tasks failed:', err);
    process.exit(1);
  });
