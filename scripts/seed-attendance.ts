// scripts/seed-attendance.ts
// Robust, idempotent attendance seeder.
//
// Default target: previous calendar month only.
// This intentionally leaves the current month schedules without attendance rows
// so you can test live attendance on a new day.
//
// Optional:
//   SEED_ATTENDANCE_MONTH=previous  -> previous month (default)
//   SEED_ATTENDANCE_MONTH=current   -> current month, only if you explicitly want it
//   SEED_ATTENDANCE_MONTH=YYYY-MM   -> specific month
//
// Examples:
//   npx tsx scripts/seed-current-month.ts
//   npx tsx scripts/seed-attendance.ts
//   $env:SEED_ATTENDANCE_MONTH="2026-04"; npx tsx scripts/seed-attendance.ts

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { and, eq, gte, lte, inArray } from 'drizzle-orm';

type ShiftCode = 'morning' | 'evening' | 'full_day';

type BreakCfg = {
  breakType: 'lunch' | 'dinner' | 'full_day_lunch' | 'full_day_dinner';
  hour: number;
  minuteMin: number;
  minuteMax: number;
  durationMin: number;
  durationMax: number;
};

const FALLBACK_SHIFT_TIMES: Record<ShiftCode, { startTime: string; endTime: string }> = {
  morning: { startTime: '07:00:00', endTime: '15:00:00' },
  evening: { startTime: '15:00:00', endTime: '23:00:00' },
  full_day: { startTime: '07:00:00', endTime: '23:00:00' },
};

const BREAK_CONFIG: Record<ShiftCode, BreakCfg[]> = {
  morning: [
    { breakType: 'lunch', hour: 12, minuteMin: 0, minuteMax: 30, durationMin: 25, durationMax: 45 },
  ],
  evening: [
    { breakType: 'dinner', hour: 18, minuteMin: 0, minuteMax: 30, durationMin: 25, durationMax: 45 },
  ],
  full_day: [
    { breakType: 'full_day_lunch', hour: 12, minuteMin: 0, minuteMax: 30, durationMin: 30, durationMax: 45 },
    { breakType: 'full_day_dinner', hour: 18, minuteMin: 0, minuteMax: 30, durationMin: 30, durationMax: 45 },
  ],
};

const LATE_AFTER_MINUTES = 30;

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

function resolveTargetMonth(defaultMode: 'current' | 'previous' = 'current') {
  const now = new Date();
  const raw = (process.env.SEED_ATTENDANCE_MONTH || process.env.SEED_MONTH || defaultMode).trim().toLowerCase();

  let year: number;
  let monthIndex: number;

  if (raw === 'current') {
    year = now.getFullYear();
    monthIndex = now.getMonth();
  } else if (raw === 'previous' || raw === 'last') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    year = d.getFullYear();
    monthIndex = d.getMonth();
  } else if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split('-').map(Number);
    year = y;
    monthIndex = m - 1;
  } else {
    throw new Error('Invalid SEED_MONTH. Use current, previous, or YYYY-MM.');
  }

  const start = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  const yearMonth = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;

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

function dateWithTime(date: Date, time: string | null | undefined, fallback: string): Date {
  const [h, m, s] = (time || fallback).split(':').map((part) => parseInt(part, 10));
  const r = new Date(date);
  r.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, Number.isFinite(s) ? s : 0, 0);
  return r;
}

function parseNum(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const { db } = await import('../lib/db');
  const schema = await import('../lib/db/schema');
  const {
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
    edcReconciliationTasks,
    eodZReportTasks,
    openStatementTasks,
    groomingTasks,
  } = schema;

  const target = resolveTargetMonth('previous');
  console.log(`\n📋 seed-attendance: ${target.yearMonth}`);
  console.log(`   Range: ${target.start.toISOString().slice(0, 10)} → ${target.end.toISOString().slice(0, 10)}\n`);

  const scheduleRows = await db
    .select({
      sched: schedules,
      shiftCode: shifts.code,
      shiftStartTime: shifts.startTime,
      shiftEndTime: shifts.endTime,
    })
    .from(schedules)
    .innerJoin(shifts, eq(schedules.shiftId, shifts.id))
    .where(and(
      gte(schedules.date, startOfDay(target.start)),
      lte(schedules.date, endOfDay(target.end)),
      eq(schedules.isHoliday, false),
    ))
    .orderBy(schedules.date, shifts.sortOrder);

  if (!scheduleRows.length) {
    throw new Error(
      `No schedule rows found for ${target.yearMonth}. Run seed-current-month.ts with the same SEED_MONTH first.`,
    );
  }

  async function getAttendance(scheduleId: number) {
    const [row] = await db
      .select({ id: attendance.id, status: attendance.status, checkInTime: attendance.checkInTime, checkOutTime: attendance.checkOutTime })
      .from(attendance)
      .where(eq(attendance.scheduleId, scheduleId))
      .limit(1);
    return row ?? null;
  }

  async function completeTask(table: any, scheduleId: number, checkIn: Date, extra: Record<string, unknown>) {
    const [row] = await db
      .select({ id: table.id, status: table.status })
      .from(table)
      .where(eq(table.scheduleId, scheduleId))
      .limit(1);

    if (!row || row.status !== 'pending') return null;

    const completedAt = new Date(checkIn);
    completedAt.setMinutes(completedAt.getMinutes() + rand(5, 35));

    await db
      .update(table)
      .set({ ...extra, status: 'completed', completedAt, updatedAt: new Date() } as any)
      .where(eq(table.id, row.id));

    return row.id as number;
  }

  async function completeSetoran(sched: any, checkIn: Date) {
    const [row] = await db
      .select({ id: setoranTasks.id, status: setoranTasks.status, carriedDeficit: setoranTasks.carriedDeficit })
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, sched.id))
      .limit(1);

    if (!row || row.status !== 'pending') return false;

    const actualReceivedAmount = rand(850_000, 2_500_000);
    const previousUnpaidAmount = parseNum(row.carriedDeficit);
    const requiredStoreAmount = actualReceivedAmount + previousUnpaidAmount;
    const storedAmount = chance(0.85)
      ? requiredStoreAmount
      : Math.max(0, requiredStoreAmount - rand(50_000, 250_000));
    const unpaidAmount = Math.max(0, requiredStoreAmount - storedAmount);

    const completedAt = new Date(checkIn);
    completedAt.setMinutes(completedAt.getMinutes() + rand(15, 45));
    const now = new Date();

    await db
      .update(setoranTasks)
      .set({
        expectedAmount: String(actualReceivedAmount),
        carriedDeficit: String(previousUnpaidAmount),
        amount: String(storedAmount),
        unpaidAmount: String(unpaidAmount),
        resiPhoto: 'setoran/resi/sample.jpg',
        atmCardSelfiePhoto: 'setoran/atm-card-selfie/sample.jpg',
        notes: unpaidAmount > 0 ? 'Auto seed: ada unpaid untuk carry-forward.' : null,
        status: 'completed',
        completedAt,
        updatedAt: now,
      } as any)
      .where(eq(setoranTasks.id, row.id));

    await db
      .insert(setoranMoneyStorage)
      .values({
        taskId: row.id,
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
        resiPhoto: 'setoran/resi/sample.jpg',
        atmCardSelfiePhoto: 'setoran/atm-card-selfie/sample.jpg',
        notes: unpaidAmount > 0 ? 'Auto seed: carry-forward test row.' : null,
        updatedAt: now,
      } as any)
      .onConflictDoUpdate({
        target: setoranMoneyStorage.taskId,
        set: {
          actualReceivedAmount: String(actualReceivedAmount),
          previousUnpaidAmount: String(previousUnpaidAmount),
          requiredStoreAmount: String(requiredStoreAmount),
          storedAmount: String(storedAmount),
          unpaidAmount: String(unpaidAmount),
          resiPhoto: 'setoran/resi/sample.jpg',
          atmCardSelfiePhoto: 'setoran/atm-card-selfie/sample.jpg',
          notes: unpaidAmount > 0 ? 'Auto seed: carry-forward test row.' : null,
          updatedAt: now,
        } as any,
      });

    return true;
  }

  async function completeCekBin(scheduleId: number, storeId: number, checkIn: Date) {
    const [row] = await db
      .select({ id: cekBinTasks.id, status: cekBinTasks.status })
      .from(cekBinTasks)
      .where(eq(cekBinTasks.scheduleId, scheduleId))
      .limit(1);

    if (!row || row.status !== 'pending') return false;

    const bins = await db
      .select()
      .from(storeBins)
      .where(and(eq(storeBins.storeId, storeId), eq(storeBins.isActive, true)))
      .limit(200);

    const totalStoreBins = bins.length;
    const minimumBinsToCheck = Math.ceil(totalStoreBins * 0.3);
    const checkedBins = bins.slice(0, Math.max(0, minimumBinsToCheck));
    const completedAt = new Date(checkIn);
    completedAt.setMinutes(completedAt.getMinutes() + rand(20, 50));

    await db
      .update(cekBinTasks)
      .set({
        totalStoreBins,
        minimumBinsToCheck,
        checkedBinsCount: checkedBins.length,
        notes: checkedBins.length ? 'Auto seed cek bin.' : 'No active bins seeded for this store.',
        status: 'completed',
        completedAt,
        updatedAt: new Date(),
      } as any)
      .where(eq(cekBinTasks.id, row.id));

    await db.delete(cekBinTaskBins).where(eq(cekBinTaskBins.taskId, row.id));

    if (checkedBins.length) {
      await db.insert(cekBinTaskBins).values(
        checkedBins.map((bin: any) => ({
          taskId: row.id,
          binId: bin.id,
          bin: bin.bin,
          nama: bin.nama,
          qtyBc: bin.qtyBc,
          qtySesuaiBin: bin.qtySesuaiBin,
          qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
          notes: chance(0.15) ? 'Ada minor selisih, perlu follow up.' : null,
        })) as any,
      );
    }

    return true;
  }

  let createdAttendance = 0;
  let existingAttendance = 0;
  let absentCount = 0;
  let presentCount = 0;
  let lateCount = 0;
  let breakCount = 0;
  let tasksCompleted = 0;

  for (const { sched, shiftCode, shiftStartTime, shiftEndTime } of scheduleRows as any[]) {
    if (shiftCode !== 'morning' && shiftCode !== 'evening' && shiftCode !== 'full_day') continue;

    const code = shiftCode as ShiftCode;
    const fallback = FALLBACK_SHIFT_TIMES[code];
    const shiftStart = dateWithTime(sched.date, shiftStartTime, fallback.startTime);
    const shiftEnd = dateWithTime(sched.date, shiftEndTime, fallback.endTime);

    const existing = await getAttendance(sched.id);
    let attendanceId = existing?.id as number | undefined;
    let checkIn = existing?.checkInTime ? new Date(existing.checkInTime) : new Date(shiftStart);
    let checkOut = existing?.checkOutTime ? new Date(existing.checkOutTime) : new Date(shiftEnd);
    let isAbsent = existing?.status === 'absent';

    if (existing) {
      existingAttendance++;
    } else {
      const roll = Math.random();
      isAbsent = roll < 0.05;

      if (isAbsent) {
        const [att] = await db
          .insert(attendance)
          .values({
            scheduleId: sched.id,
            userId: sched.userId,
            storeId: sched.storeId,
            date: startOfDay(sched.date),
            shiftId: sched.shiftId,
            status: 'absent',
            onBreak: false,
            recordedBy: sched.userId,
          } as any)
          .returning({ id: attendance.id });
        attendanceId = att.id;
        absentCount++;
      } else {
        const late = roll < 0.15;
        checkIn = new Date(shiftStart);
        if (late) checkIn.setMinutes(checkIn.getMinutes() + rand(LATE_AFTER_MINUTES + 1, LATE_AFTER_MINUTES + 30));
        else checkIn.setMinutes(checkIn.getMinutes() - rand(0, 15));

        checkOut = new Date(shiftEnd);
        checkOut.setMinutes(checkOut.getMinutes() + rand(0, 20));

        const [att] = await db
          .insert(attendance)
          .values({
            scheduleId: sched.id,
            userId: sched.userId,
            storeId: sched.storeId,
            date: startOfDay(sched.date),
            shiftId: sched.shiftId,
            status: late ? 'late' : 'present',
            checkInTime: checkIn,
            checkOutTime: checkOut,
            onBreak: false,
            recordedBy: sched.userId,
          } as any)
          .returning({ id: attendance.id });

        attendanceId = att.id;
        if (late) lateCount++;
        else presentCount++;
      }

      createdAttendance++;
    }

    if (!attendanceId || isAbsent) continue;

    // Breaks are idempotent enough for seeding: only create if there are none for this attendance row.
    const [existingBreak] = await db
      .select({ id: breakSessions.id })
      .from(breakSessions)
      .where(eq(breakSessions.attendanceId, attendanceId))
      .limit(1);

    if (!existingBreak) {
      for (const cfg of BREAK_CONFIG[code]) {
        if (!chance(code === 'full_day' ? 0.75 : 0.8)) continue;

        const breakStart = new Date(sched.date);
        breakStart.setHours(cfg.hour, rand(cfg.minuteMin, cfg.minuteMax), 0, 0);
        const breakEnd = new Date(breakStart);
        breakEnd.setMinutes(breakEnd.getMinutes() + rand(cfg.durationMin, cfg.durationMax));

        if (breakStart > checkIn && breakEnd < checkOut) {
          const cashOut = money();
          const cashIn = chance(0.95) ? cashOut : String(Math.max(parseInt(cashOut, 10) - 50_000, 0));

          await db.insert(breakSessions).values({
            attendanceId,
            userId: sched.userId,
            storeId: sched.storeId,
            breakType: cfg.breakType,
            breakOutTime: breakStart,
            returnTime: breakEnd,
            cashOut,
            cashIn,
          } as any);
          breakCount++;
        }
      }
    }

    const hasMorningTasks = code === 'morning' || code === 'full_day';
    const hasEveningTasks = code === 'evening' || code === 'full_day';

    if (hasMorningTasks) {
      if (chance(0.9)) {
        const ok = await completeTask(storeOpeningTasks, sched.id, checkIn, {
          loginPos: true,
          checkAbsenSunfish: true,
          tarikSohSales: true,
          fiveR: true,
          fiveRAreaKasirPhotos: json(['opening/5r-kasir.jpg']),
          fiveRAreaDepanPhotos: json(['opening/5r-depan.jpg']),
          fiveRAreaKananPhotos: json(['opening/5r-kanan.jpg']),
          fiveRAreaKiriPhotos: json(['opening/5r-kiri.jpg']),
          fiveRAreaGudangPhotos: json(['opening/5r-gudang.jpg']),
          cekLamp: true,
          cekSoundSystem: true,
          cashDrawerPhotos: json(['opening/sample-cashdrawer.jpg']),
          notes: null,
        });
        if (ok) tasksCompleted++;
      }

      if (chance(0.9)) {
        const ok = await completeTask(storeFrontTasks, sched.id, checkIn, {
          storefrontPhotos: json(['store-front/storefront/team.jpg']),
          rollingDoorClosedPhoto: 'store-front/rolling-door/closed.jpg',
          notes: null,
        });
        if (ok) tasksCompleted++;
      }

      if (chance(0.8) && await completeSetoran(sched, checkIn)) tasksCompleted++;
      if (chance(0.8) && await completeCekBin(sched.id, sched.storeId, checkIn)) tasksCompleted++;

      if (chance(0.9)) {
        const ok = await completeTask(vmChecklistTasks, sched.id, checkIn, {
          shoeLaceShoeFillerPriceTagHangtagLabelK3L: true,
          lastPairAndPigskinHangtag: true,
          popPromoUpdate: true,
          displayTableWallShelvingShowcaseHangbarStackingPedestal: true,
          floorDisplayCleanliness: true,
          vmToolsStorage: true,
          notes: null,
        });
        if (ok) tasksCompleted++;
      }

      if (chance(0.9)) {
        const ok = await completeTask(marketingCheckTasks, sched.id, checkIn, {
          promoName: true,
          promoPeriod: true,
          promoMechanism: true,
          randomShoeItems: true,
          randomNonShoeItems: true,
          sellTag: true,
          notes: null,
        });
        if (ok) tasksCompleted++;
      }

      if (chance(0.75)) {
        const ok = await completeTask(itemDroppingTasks, sched.id, checkIn, {
          hasDropping: chance(0.6),
          notes: null,
        });
        if (ok) tasksCompleted++;
      }
    }

    if (hasEveningTasks) {
      if (chance(0.85)) {
        const ok = await completeTask(briefingTasks, sched.id, checkIn, { done: true, isBalanced: true, notes: null });
        if (ok) tasksCompleted++;
      }
      if (chance(0.85)) {
        const ok = await completeTask(edcReconciliationTasks, sched.id, checkIn, { isBalanced: true, notes: null });
        if (ok) tasksCompleted++;
      }
      if (chance(0.85)) {
        const ok = await completeTask(eodZReportTasks, sched.id, checkIn, {
          totalNominal: String(rand(1_000_000, 5_000_000)),
          zReportPhotos: json(['eod/z-report/sample.jpg']),
          notes: null,
        });
        if (ok) tasksCompleted++;
      }
      if (chance(0.85)) {
        const ok = await completeTask(openStatementTasks, sched.id, checkIn, {
          expectedAmount: String(rand(1_000_000, 5_000_000)),
          actualAmount: String(rand(1_000_000, 5_000_000)),
          isBalanced: true,
          notes: null,
        });
        if (ok) tasksCompleted++;
      }
    }

    if (chance(0.9)) {
      const ok = await completeTask(groomingTasks, sched.id, checkIn, {
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
        selfiePhotos: json(['grooming/selfie/sample.jpg']),
        notes: null,
      });
      if (ok) tasksCompleted++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`✅ seed-attendance complete (${target.yearMonth})`);
  console.log(`   Schedule rows scanned    : ${scheduleRows.length}`);
  console.log(`   Attendance created       : ${createdAttendance}`);
  console.log(`   Attendance already existed: ${existingAttendance}`);
  console.log(`   Present                  : ${presentCount}`);
  console.log(`   Late                     : ${lateCount}`);
  console.log(`   Absent                   : ${absentCount}`);
  console.log(`   Break rows created       : ${breakCount}`);
  console.log(`   Tasks completed          : ${tasksCompleted}`);
  console.log('═══════════════════════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ seed-attendance failed:', err);
    process.exit(1);
  });
