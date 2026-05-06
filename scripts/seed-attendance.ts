// scripts/seed-attendance.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seeds attendance records for the CURRENT month, from the 1st day until today.
// Also marks existing task rows completed using the current task schema.
// Uses dynamic shift start/end values from the shifts lookup table and
// includes required break cashOut/cashIn values.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "@/lib/db";
import {
  schedules,
  attendance,
  breakSessions,
  users,
  stores,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  edcReconciliationTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks,
} from "@/lib/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";

// ─── Current month range: 1st day → today ────────────────────────────────────

const NOW = new Date();
const START_DATE = new Date(
  NOW.getFullYear(),
  NOW.getMonth() - 1,
  1,
  0,
  0,
  0,
  0,
);

const END_DATE = new Date(
  NOW.getFullYear(),
  NOW.getMonth(),
  0,
  23,
  59,
  59,
  999,
);
END_DATE.setHours(23, 59, 59, 999);
const YEAR_MONTH = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, "0")}`;

const FALLBACK_SHIFT_TIMES = {
  morning: { startTime: "07:00:00", endTime: "15:00:00" },
  evening: { startTime: "15:00:00", endTime: "23:00:00" },
  full_day: { startTime: "07:00:00", endTime: "23:00:00" },
} as const;

const BREAK_CONFIG = {
  morning: [
    {
      breakType: "lunch" as const,
      hour: 12,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 25,
      durationMax: 45,
    },
  ],
  evening: [
    {
      breakType: "dinner" as const,
      hour: 18,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 25,
      durationMax: 45,
    },
  ],
  full_day: [
    {
      breakType: "full_day_lunch" as const,
      hour: 12,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 30,
      durationMax: 45,
    },
    {
      breakType: "full_day_dinner" as const,
      hour: 18,
      minuteMin: 0,
      minuteMax: 30,
      durationMin: 30,
      durationMax: 45,
    },
  ],
} as const;

const LATE_AFTER_MINUTES = 30;

type ShiftCode = keyof typeof BREAK_CONFIG;

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
function rand(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
function chance(pct: number): boolean {
  return Math.random() < pct;
}
function json(paths: string[]): string {
  return JSON.stringify(paths);
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

function rupiahAmount(min = 50_000, max = 300_000, step = 50_000): string {
  const units = rand(Math.ceil(min / step), Math.floor(max / step));
  return String(units * step);
}

async function seedAttendance() {
  console.log(
    `📋  seed-attendance: ${YEAR_MONTH}-01 → today (${END_DATE.toISOString().slice(0, 10)})\n`,
  );

  const scheduleRows = await db
    .select({
      sched: schedules,
      shiftCode: shifts.code,
      shiftStartTime: shifts.startTime,
      shiftEndTime: shifts.endTime,
      user: users,
      store: stores,
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .leftJoin(users, eq(schedules.userId, users.id))
    .leftJoin(stores, eq(schedules.storeId, stores.id))
    .where(
      and(
        gte(schedules.date, startOfDay(START_DATE)),
        lte(schedules.date, endOfDay(END_DATE)),
        eq(schedules.isHoliday, false),
      ),
    )
    .orderBy(schedules.date, shifts.sortOrder);

  console.log(`   Found ${scheduleRows.length} schedule rows in range\n`);

  let created = 0;
  let skipped = 0;
  let cntAbsent = 0;
  let cntLate = 0;
  let cntPresent = 0;
  let cntBreaks = 0;

  const taskDone: Record<string, number> = {
    storeOpening: 0,
    storeFront: 0,
    setoran: 0,
    cekBin: 0,
    vmChecklist: 0,
    marketingCheck: 0,
    itemDropping: 0,
    briefing: 0,
    edcReconciliation: 0,
    eodZReport: 0,
    openStatement: 0,
    grooming: 0,
  };

  for (const {
    sched,
    shiftCode,
    shiftStartTime,
    shiftEndTime,
  } of scheduleRows) {
    if (
      shiftCode !== "morning" &&
      shiftCode !== "evening" &&
      shiftCode !== "full_day"
    ) {
      console.warn(
        `   ⚠️  Unknown shift code "${shiftCode}" on schedule ${sched.id} — skipping`,
      );
      continue;
    }

    const [existingAtt] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(eq(attendance.scheduleId, sched.id))
      .limit(1);

    if (existingAtt) {
      skipped++;
      continue;
    }

    const code = shiftCode as ShiftCode;
    const fallback = FALLBACK_SHIFT_TIMES[code];
    const shiftStart = dateWithTime(
      sched.date,
      shiftStartTime,
      fallback.startTime,
    );
    const shiftEnd = dateWithTime(sched.date, shiftEndTime, fallback.endTime);

    const roll = Math.random();

    if (roll < 0.05) {
      await db.insert(attendance).values({
        scheduleId: sched.id,
        userId: sched.userId,
        storeId: sched.storeId,
        date: startOfDay(sched.date),
        shiftId: sched.shiftId,
        status: "absent",
        onBreak: false,
        recordedBy: sched.userId,
      });
      cntAbsent++;
      created++;
      continue;
    }

    let checkIn: Date;
    let attStatus: "present" | "late";

    if (roll < 0.15) {
      checkIn = new Date(shiftStart);
      checkIn.setMinutes(
        checkIn.getMinutes() +
          rand(LATE_AFTER_MINUTES + 1, LATE_AFTER_MINUTES + 30),
      );
      attStatus = "late";
      cntLate++;
    } else {
      checkIn = new Date(shiftStart);
      checkIn.setMinutes(checkIn.getMinutes() - rand(0, 15));
      attStatus = "present";
      cntPresent++;
    }

    const checkOut = new Date(shiftEnd);
    checkOut.setMinutes(checkOut.getMinutes() + rand(0, 20));

    const [att] = await db
      .insert(attendance)
      .values({
        scheduleId: sched.id,
        userId: sched.userId,
        storeId: sched.storeId,
        date: startOfDay(sched.date),
        shiftId: sched.shiftId,
        status: attStatus,
        checkInTime: checkIn,
        checkOutTime: checkOut,
        onBreak: false,
        recordedBy: sched.userId,
      })
      .returning({ id: attendance.id });

    created++;

    for (const cfg of BREAK_CONFIG[code]) {
      if (!chance(code === "full_day" ? 0.75 : 0.8)) continue;

      const breakStart = new Date(sched.date);
      breakStart.setHours(cfg.hour, rand(cfg.minuteMin, cfg.minuteMax), 0, 0);

      const breakEnd = new Date(breakStart);
      breakEnd.setMinutes(
        breakEnd.getMinutes() + rand(cfg.durationMin, cfg.durationMax),
      );

      if (breakStart > checkIn && breakEnd < checkOut) {
        const cashOut = rupiahAmount();
        const cashIn = chance(0.95)
          ? cashOut
          : String(Math.max(parseInt(cashOut, 10) - 50_000, 0));

        await db.insert(breakSessions).values({
          attendanceId: att.id,
          userId: sched.userId,
          storeId: sched.storeId,
          breakType: cfg.breakType,
          breakOutTime: breakStart,
          returnTime: breakEnd,
          cashOut,
          cashIn,
        });
        cntBreaks++;
      }
    }

    async function completeTask(
      table: any,
      extraSet: Record<string, unknown>,
      taskName: keyof typeof taskDone,
    ): Promise<number | null> {
      const [row] = await db
        .select({ id: table.id, status: table.status })
        .from(table)
        .where(eq(table.scheduleId, sched.id))
        .limit(1);

      if (!row || row.status !== "pending") return null;

      const completedAt = new Date(checkIn);
      completedAt.setMinutes(completedAt.getMinutes() + rand(5, 25));

      await db
        .update(table)
        .set({
          ...extraSet,
          status: "completed",
          completedAt,
          updatedAt: new Date(),
        } as any)
        .where(eq(table.id, row.id));

      taskDone[taskName]++;
      return row.id;
    }

    const hasMorningTasks = code === "morning" || code === "full_day";
    const hasEveningTasks = code === "evening" || code === "full_day";

    if (hasMorningTasks) {
      if (chance(0.9)) {
        await completeTask(
          storeOpeningTasks,
          {
            loginPos: true,
            checkAbsenSunfish: chance(0.95),
            tarikSohSales: chance(0.95),
            fiveR: chance(0.9),
            fiveRAreaKasirPhotos: json(["opening/5r-kasir.jpg"]),
            fiveRAreaDepanPhotos: json(["opening/5r-depan.jpg"]),
            fiveRAreaKananPhotos: json(["opening/5r-kanan.jpg"]),
            fiveRAreaKiriPhotos: json(["opening/5r-kiri.jpg"]),
            fiveRAreaGudangPhotos: json(["opening/5r-gudang.jpg"]),
            cekLamp: true,
            cekSoundSystem: chance(0.9),
            cashDrawerPhotos: json(["opening/sample-cashdrawer.jpg"]),
            notes: chance(0.3) ? "All clear, store ready." : null,
          },
          "storeOpening",
        );
      }

      if (chance(0.9)) {
        await completeTask(
          storeFrontTasks,
          {
            storefrontPhotos: json([
              "store-front/storefront/staff-1.jpg",
              "store-front/storefront/staff-2.jpg",
            ]),
            rollingDoorClosedPhoto:
              "store-front/rolling-door-closed/rolling-door-closed.jpg",
            notes: chance(0.2) ? "Storefront photos completed." : null,
          },
          "storeFront",
        );
      }

      if (chance(0.8)) {
        const amount = (500_000 + rand(0, 10) * 50_000).toString();
        await completeTask(
          setoranTasks,
          {
            amount,
            resiPhoto: "setoran/sample-resi.jpg",
            notes: chance(0.2) ? "Transfer confirmed." : null,
          },
          "setoran",
        );
      }

      if (chance(0.8)) {
        await completeTask(
          vmChecklistTasks,
          {
            shoeLaceShoeFillerPriceTagHangtagLabelK3L: chance(0.95),
            lastPairAndPigskinHangtag: chance(0.95),
            popPromoUpdate: chance(0.9),
            displayTableWallShelvingShowcaseHangbarStackingPedestal:
              chance(0.9),
            floorDisplayCleanliness: chance(0.95),
            vmToolsStorage: chance(0.95),
            notes: chance(0.2) ? "Minor VM adjustment needed." : null,
          },
          "vmChecklist",
        );
      }

      if (chance(0.8)) {
        await completeTask(
          marketingCheckTasks,
          {
            promoName: chance(0.95),
            promoPeriod: chance(0.95),
            promoMechanism: chance(0.95),
            randomShoeItems: chance(0.9),
            randomNonShoeItems: chance(0.9),
            sellTag: chance(0.9),
            notes: chance(0.2) ? "Marketing checklist completed." : null,
          },
          "marketingCheck",
        );
      }

      if (chance(0.8)) {
        const hasDropping = chance(0.3);
        await completeTask(
          itemDroppingTasks,
          {
            hasDropping,
            notes: hasDropping
              ? `Dropped ${rand(2, 10)} boxes.`
              : "No delivery today.",
          },
          "itemDropping",
        );
      }

      if (chance(0.9)) {
        const activeBins = await db
          .select({
            id: storeBins.id,
            bin: storeBins.bin,
            nama: storeBins.nama,
            qtyBc: storeBins.qtyBc,
            qtySesuaiBin: storeBins.qtySesuaiBin,
            qtyTidakSesuaiBin: storeBins.qtyTidakSesuaiBin,
          })
          .from(storeBins)
          .where(
            and(
              eq(storeBins.storeId, sched.storeId),
              eq(storeBins.isActive, true),
            ),
          );

        const totalStoreBins = activeBins.length;
        const minimumBinsToCheck =
          totalStoreBins > 0 ? Math.ceil(totalStoreBins * 0.3) : 0;
        const selectedBins = activeBins
          .slice()
          .sort(() => Math.random() - 0.5)
          .slice(0, minimumBinsToCheck);

        const taskId = await completeTask(
          cekBinTasks,
          {
            totalStoreBins,
            minimumBinsToCheck,
            checkedBinsCount: selectedBins.length,
            notes: chance(0.1) ? "Cek BIN completed." : null,
          },
          "cekBin",
        );

        if (taskId && selectedBins.length) {
          await db
            .delete(cekBinTaskBins)
            .where(eq(cekBinTaskBins.taskId, taskId));
          await db.insert(cekBinTaskBins).values(
            selectedBins.map((bin) => {
              const qtyTidakSesuaiBin = chance(0.15)
                ? Math.min(bin.qtyBc, rand(1, 2))
                : bin.qtyTidakSesuaiBin;
              const qtySesuaiBin = Math.max(bin.qtyBc - qtyTidakSesuaiBin, 0);

              return {
                taskId,
                binId: bin.id,
                bin: bin.bin,
                nama: bin.nama,
                qtyBc: bin.qtyBc,
                qtySesuaiBin,
                qtyTidakSesuaiBin,
                notes:
                  qtyTidakSesuaiBin > 0 ? "Ada item tidak sesuai BIN." : null,
              };
            }),
          );
        }
      }
    }

    if (hasEveningTasks) {
      if (chance(0.7)) {
        await completeTask(
          briefingTasks,
          {
            done: true,
            isBalanced: true,
            notes: chance(0.2) ? "Briefing done, team aligned." : null,
          },
          "briefing",
        );
      }

      if (chance(0.7)) {
        await completeTask(
          edcReconciliationTasks,
          {
            expectedFetchedAt: new Date(
              checkIn.getTime() + rand(5, 15) * 60_000,
            ),
            expectedSnapshot: JSON.stringify({
              rows: [],
              generatedAt: new Date().toISOString(),
            }),
            isBalanced: true,
            notes: chance(0.2) ? "EDC reconciled, no discrepancies." : null,
          },
          "edcReconciliation",
        );
      }

      if (chance(0.7)) {
        await completeTask(
          eodZReportTasks,
          {
            totalNominal: (5_000_000 + rand(0, 20) * 100_000).toString(),
            zReportPhotos: json(["eod/z-report-sample.jpg"]),
            notes: chance(0.2) ? "Z-report printed and filed." : null,
          },
          "eodZReport",
        );
      }

      if (chance(0.7)) {
        const expected = 10_000_000 + rand(0, 5) * 500_000;
        await completeTask(
          openStatementTasks,
          {
            expectedAmount: expected.toString(),
            expectedFetchedAt: new Date(
              checkIn.getTime() + rand(10, 30) * 60_000,
            ),
            actualAmount: expected.toString(),
            isBalanced: true,
            notes: chance(0.2) ? "Open statement matched." : null,
          },
          "openStatement",
        );
      }
    }

    if (chance(0.95)) {
      await completeTask(
        groomingTasks,
        {
          uniformChecked: true,
          hairChecked: chance(0.95),
          smellChecked: chance(0.95),
          makeUpChecked: chance(0.95),
          shoeChecked: true,
          nameTagChecked: chance(0.95),
          selfiePhotos: json(["grooming/selfie-sample.jpg"]),
          notes: chance(0.1) ? "All good." : null,
        },
        "grooming",
      );
    }

    if (created % 50 === 0)
      process.stdout.write(`   ✓ ${created} attendance records created…\r`);
  }

  console.log("\n");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("✅  seed-attendance complete!\n");
  console.log(`   Schedule rows found  : ${scheduleRows.length}`);
  console.log(`   Already had records  : ${skipped}`);
  console.log(`   Created              : ${created}`);
  console.log(`     ↳ Present          : ${cntPresent}`);
  console.log(`     ↳ Late             : ${cntLate}`);
  console.log(`     ↳ Absent           : ${cntAbsent}`);
  console.log(`   Break sessions       : ${cntBreaks}`);
  console.log("\n   Tasks completed:");
  for (const [name, n] of Object.entries(taskDone))
    console.log(`     ↳ ${name.padEnd(18)}: ${n}`);
  console.log("═══════════════════════════════════════════════════════════");
}

seedAttendance()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌  seed-attendance failed:", err);
    process.exit(1);
  });
