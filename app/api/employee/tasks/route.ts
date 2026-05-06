// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  schedules,
  shifts,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  briefingTasks,
  edcReconciliationTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks,
  itemDroppingTasks,
  itemDroppingEntries,
} from '@/lib/db/schema';
import { eq, and, gte, lte, desc, inArray, asc } from 'drizzle-orm';
import { getOrCreateSetoranForSchedule } from '@/lib/db/utils/setoran';
import { getOrCreateStoreOpeningForSchedule } from '@/lib/db/utils/store-opening';
import { getOrCreateStoreFrontForSchedule } from '@/lib/db/utils/store-front';
import { getOrCreateCekBinForSchedule } from '@/lib/db/utils/cek-bin';
import { getOrCreateVmChecklistForSchedule } from '@/lib/db/utils/vm-checklist';
import { getOrCreateMarketingCheckForSchedule } from '@/lib/db/utils/marketing-check';
import { getOrCreateItemDroppingForSchedule } from '@/lib/db/utils/item-dropping';
import { getOrCreateGroomingForSchedule } from '@/lib/db/utils/grooming';

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

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type ShiftCode = 'morning' | 'evening' | 'full_day';

let _shiftCodeCache: Record<number, string> | null = null;

async function getShiftCodeMap(): Promise<Record<number, string>> {
  if (_shiftCodeCache) return _shiftCodeCache;

  const rows = await db
    .select({ id: shifts.id, code: shifts.code })
    .from(shifts);

  _shiftCodeCache = Object.fromEntries(rows.map((r) => [r.id, r.code]));
  return _shiftCodeCache;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');

    const targetDate = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    const todaySchedules = await db
      .select({
        id: schedules.id,
        shiftId: schedules.shiftId,
        storeId: schedules.storeId,
      })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.isHoliday, false),
          gte(schedules.date, dayStart),
          lte(schedules.date, dayEnd),
        ),
      );

    if (!todaySchedules.length) {
      return NextResponse.json({
        success: true,
        tasks: [],
        shift: null,
        scheduleIds: [],
      });
    }

    const shiftCodeMap = await getShiftCodeMap();
    const scheduleIds = todaySchedules.map((s) => s.id);
    const storeIds = [...new Set(todaySchedules.map((s) => s.storeId))];

    const shiftCodesRaw = [
      ...new Set(todaySchedules.map((s) => shiftCodeMap[s.shiftId] ?? '')),
    ].filter(Boolean) as ShiftCode[];

    const hasMorningTasks = shiftCodesRaw.some(
      (c) => c === 'morning' || c === 'full_day',
    );

    const hasEveningTasks = shiftCodesRaw.some(
      (c) => c === 'evening' || c === 'full_day',
    );

    const primaryShift: ShiftCode | null = shiftCodesRaw[0] ?? null;
    const inStore = (storeId: number) => storeIds.includes(storeId);

    const morningSchedules = todaySchedules.filter((s) => {
      const code = shiftCodeMap[s.shiftId];
      return code === 'morning' || code === 'full_day';
    });

    const [
      openingRows,
      storeFrontRows,
      setoranRows,
      cekBinRows,
      vmChecklistRows,
      marketingCheckRows,
      itemDroppingRows,
      itemDroppingEntryRows,
      edcReconciliationRows,
      briefingRows,
      eodZReportRows,
      openStatementRows,
      groomingRows,
    ] = await Promise.all([
      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateStoreOpeningForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(storeOpeningTasks)
              .where(
                and(
                  inArray(storeOpeningTasks.storeId, storeIds),
                  gte(storeOpeningTasks.date, dayStart),
                  lte(storeOpeningTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(storeOpeningTasks.date));
          })()
        : Promise.resolve([]),

      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateStoreFrontForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(storeFrontTasks)
              .where(
                and(
                  inArray(storeFrontTasks.storeId, storeIds),
                  gte(storeFrontTasks.date, dayStart),
                  lte(storeFrontTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(storeFrontTasks.date));
          })()
        : Promise.resolve([]),

      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) => getOrCreateSetoranForSchedule(s.id)),
            );

            return db
              .select()
              .from(setoranTasks)
              .where(
                and(
                  inArray(setoranTasks.storeId, storeIds),
                  gte(setoranTasks.date, dayStart),
                  lte(setoranTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(setoranTasks.date));
          })()
        : Promise.resolve([]),

      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateCekBinForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(cekBinTasks)
              .where(
                and(
                  inArray(cekBinTasks.storeId, storeIds),
                  gte(cekBinTasks.date, dayStart),
                  lte(cekBinTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(cekBinTasks.date));
          })()
        : Promise.resolve([]),

      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateVmChecklistForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(vmChecklistTasks)
              .where(
                and(
                  inArray(vmChecklistTasks.storeId, storeIds),
                  gte(vmChecklistTasks.date, dayStart),
                  lte(vmChecklistTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(vmChecklistTasks.date));
          })()
        : Promise.resolve([]),

      hasMorningTasks
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateMarketingCheckForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(marketingCheckTasks)
              .where(
                and(
                  inArray(marketingCheckTasks.storeId, storeIds),
                  gte(marketingCheckTasks.date, dayStart),
                  lte(marketingCheckTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(marketingCheckTasks.date));
          })()
        : Promise.resolve([]),

      (async () => {
        await Promise.all(
          todaySchedules.map((s) =>
            getOrCreateItemDroppingForSchedule(
              s.id,
              userId,
              s.storeId,
              s.shiftId,
              targetDate,
            ),
          ),
        );

        return db
          .select()
          .from(itemDroppingTasks)
          .where(
            and(
              inArray(itemDroppingTasks.storeId, storeIds),
              gte(itemDroppingTasks.date, dayStart),
              lte(itemDroppingTasks.date, dayEnd),
            ),
          )
          .orderBy(desc(itemDroppingTasks.date));
      })(),

      (async () => {
        const taskIds = await db
          .select({ id: itemDroppingTasks.id })
          .from(itemDroppingTasks)
          .where(
            and(
              inArray(itemDroppingTasks.storeId, storeIds),
              gte(itemDroppingTasks.date, dayStart),
              lte(itemDroppingTasks.date, dayEnd),
            ),
          );

        if (!taskIds.length) return [];

        return db
          .select()
          .from(itemDroppingEntries)
          .where(inArray(itemDroppingEntries.taskId, taskIds.map((r) => r.id)))
          .orderBy(itemDroppingEntries.dropTime);
      })(),

      hasEveningTasks
        ? db
            .select()
            .from(edcReconciliationTasks)
            .where(
              and(
                inArray(edcReconciliationTasks.storeId, storeIds),
                gte(edcReconciliationTasks.date, dayStart),
                lte(edcReconciliationTasks.date, dayEnd),
              ),
            )
            .orderBy(desc(edcReconciliationTasks.date))
        : Promise.resolve([]),

      hasEveningTasks
        ? db
            .select()
            .from(briefingTasks)
            .where(
              and(
                inArray(briefingTasks.storeId, storeIds),
                gte(briefingTasks.date, dayStart),
                lte(briefingTasks.date, dayEnd),
              ),
            )
            .orderBy(desc(briefingTasks.date))
        : Promise.resolve([]),

      hasEveningTasks
        ? db
            .select()
            .from(eodZReportTasks)
            .where(
              and(
                inArray(eodZReportTasks.storeId, storeIds),
                gte(eodZReportTasks.date, dayStart),
                lte(eodZReportTasks.date, dayEnd),
              ),
            )
            .orderBy(desc(eodZReportTasks.date))
        : Promise.resolve([]),

      hasEveningTasks
        ? db
            .select()
            .from(openStatementTasks)
            .where(
              and(
                inArray(openStatementTasks.storeId, storeIds),
                gte(openStatementTasks.date, dayStart),
                lte(openStatementTasks.date, dayEnd),
              ),
            )
            .orderBy(desc(openStatementTasks.date))
        : Promise.resolve([]),

      (async () => {
        await Promise.all(
          todaySchedules.map((s) =>
            getOrCreateGroomingForSchedule(
              s.id,
              userId,
              s.storeId,
              s.shiftId,
              targetDate,
            ),
          ),
        );

        return db
          .select()
          .from(groomingTasks)
          .where(
            and(
              eq(groomingTasks.userId, userId),
              inArray(groomingTasks.storeId, storeIds),
              gte(groomingTasks.date, dayStart),
              lte(groomingTasks.date, dayEnd),
            ),
          )
          .orderBy(desc(groomingTasks.date));
      })(),
    ]);

    const cekBinTaskIds = cekBinRows.map((r) => r.id);

    const [availableBinRows, checkedBinRows] = await Promise.all([
      hasMorningTasks
        ? db
            .select({
              id: storeBins.id,
              storeId: storeBins.storeId,
              bin: storeBins.bin,
              qtyBc: storeBins.qtyBc,
              qtySesuaiBin: storeBins.qtySesuaiBin,
              qtyTidakSesuaiBin: storeBins.qtyTidakSesuaiBin,
              nama: storeBins.nama,
            })
            .from(storeBins)
            .where(
              and(
                inArray(storeBins.storeId, storeIds),
                eq(storeBins.isActive, true),
              ),
            )
            .orderBy(asc(storeBins.storeId), asc(storeBins.bin))
        : Promise.resolve([]),

      cekBinTaskIds.length
        ? db
            .select({
              id: cekBinTaskBins.id,
              taskId: cekBinTaskBins.taskId,
              binId: cekBinTaskBins.binId,
              bin: cekBinTaskBins.bin,
              qtyBc: cekBinTaskBins.qtyBc,
              qtySesuaiBin: cekBinTaskBins.qtySesuaiBin,
              qtyTidakSesuaiBin: cekBinTaskBins.qtyTidakSesuaiBin,
              nama: cekBinTaskBins.nama,
              notes: cekBinTaskBins.notes,
            })
            .from(cekBinTaskBins)
            .where(inArray(cekBinTaskBins.taskId, cekBinTaskIds))
            .orderBy(asc(cekBinTaskBins.bin))
        : Promise.resolve([]),
    ]);

    const entriesByTaskId = new Map<number, typeof itemDroppingEntryRows>();
    for (const entry of itemDroppingEntryRows) {
      const bucket = entriesByTaskId.get(entry.taskId) ?? [];
      bucket.push(entry);
      entriesByTaskId.set(entry.taskId, bucket);
    }

    const availableBinsByStoreId = new Map<number, typeof availableBinRows>();
    for (const bin of availableBinRows) {
      const bucket = availableBinsByStoreId.get(bin.storeId) ?? [];
      bucket.push(bin);
      availableBinsByStoreId.set(bin.storeId, bucket);
    }

    const checkedBinsByTaskId = new Map<number, typeof checkedBinRows>();
    for (const bin of checkedBinRows) {
      const bucket = checkedBinsByTaskId.get(bin.taskId) ?? [];
      bucket.push(bin);
      checkedBinsByTaskId.set(bin.taskId, bucket);
    }

    const tasks = [
      ...openingRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'store_opening' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          date: t.date.toISOString(),

          loginPos: t.loginPos,
          checkAbsenSunfish: t.checkAbsenSunfish,
          tarikSohSales: t.tarikSohSales,
          fiveR: t.fiveR,

          fiveRAreaKasirPhotos: parsePhotos(t.fiveRAreaKasirPhotos),
          fiveRAreaDepanPhotos: parsePhotos(t.fiveRAreaDepanPhotos),
          fiveRAreaKananPhotos: parsePhotos(t.fiveRAreaKananPhotos),
          fiveRAreaKiriPhotos: parsePhotos(t.fiveRAreaKiriPhotos),
          fiveRAreaGudangPhotos: parsePhotos(t.fiveRAreaGudangPhotos),

          cekLamp: t.cekLamp,
          cekSoundSystem: t.cekSoundSystem,
          cashDrawerPhotos: parsePhotos(t.cashDrawerPhotos),

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...storeFrontRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'store_front' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          date: t.date.toISOString(),

          storefrontPhotos: parsePhotos(t.storefrontPhotos),
          rollingDoorClosedPhoto: t.rollingDoorClosedPhoto,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...setoranRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'setoran' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          date: t.date.toISOString(),

          amount: t.amount,
          resiPhoto: t.resiPhoto,
          atmCardSelfiePhoto: t.atmCardSelfiePhoto,
          expectedAmount: t.expectedAmount,
          carriedDeficit: t.carriedDeficit,
          carriedDeficitFetchedAt: toIso(t.carriedDeficitFetchedAt),
          unpaidAmount: t.unpaidAmount,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...cekBinRows.filter((r) => inStore(r.storeId)).map((t) => {
        const availableBins = (availableBinsByStoreId.get(t.storeId) ?? []).map((bin) => ({
          id: String(bin.id),
          storeId: String(bin.storeId),
          bin: bin.bin,
          qtyBc: bin.qtyBc,
          qtySesuaiBin: bin.qtySesuaiBin,
          qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
          nama: bin.nama,
        }));

        const checkedBins = (checkedBinsByTaskId.get(t.id) ?? []).map((bin) => ({
          id: String(bin.id),
          taskId: String(bin.taskId),
          binId: String(bin.binId),
          bin: bin.bin,
          qtyBc: bin.qtyBc,
          qtySesuaiBin: bin.qtySesuaiBin,
          qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
          nama: bin.nama,
          notes: bin.notes,
        }));

        const totalStoreBins = t.totalStoreBins || availableBins.length;
        const minimumBinsToCheck = t.minimumBinsToCheck || Math.ceil(totalStoreBins * 0.3);
        const checkedBinsCount = t.checkedBinsCount || checkedBins.length;

        return {
          type: 'cek_bin' as const,
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
            date: t.date.toISOString(),

            totalStoreBins,
            minimumBinsToCheck,
            checkedBinsCount,
            availableBins,
            checkedBins,
            selectedBinIds: checkedBins.map((bin) => bin.binId),

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        };
      }),

      ...vmChecklistRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'vm_checklist' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          date: t.date.toISOString(),

          shoeLaceShoeFillerPriceTagHangtagLabelK3L:
            t.shoeLaceShoeFillerPriceTagHangtagLabelK3L,
          lastPairAndPigskinHangtag: t.lastPairAndPigskinHangtag,
          popPromoUpdate: t.popPromoUpdate,
          displayTableWallShelvingShowcaseHangbarStackingPedestal:
            t.displayTableWallShelvingShowcaseHangbarStackingPedestal,
          floorDisplayCleanliness: t.floorDisplayCleanliness,
          vmToolsStorage: t.vmToolsStorage,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...marketingCheckRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'marketing_check' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode,
          date: t.date.toISOString(),

          promoName: t.promoName,
          promoPeriod: t.promoPeriod,
          promoMechanism: t.promoMechanism,
          randomShoeItems: t.randomShoeItems,
          randomNonShoeItems: t.randomNonShoeItems,
          sellTag: t.sellTag,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...itemDroppingRows.filter((r) => inStore(r.storeId)).map((t) => {
        const shift = (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode;

        const entries = (entriesByTaskId.get(t.id) ?? []).map((e) => ({
          id: String(e.id),
          taskId: String(e.taskId),
          userId: e.userId,
          storeId: String(e.storeId),
          toNumber: e.toNumber,
          quantity: e.quantity ?? 0,
          dropTime: toIso(e.dropTime),
          droppingPhotos: parsePhotos(e.droppingPhotos),
          notes: e.notes,
          createdAt: toIso(e.createdAt),
        }));

        return {
          type: 'item_dropping' as const,
          shift,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift,
            date: t.date.toISOString(),

            hasDropping: t.hasDropping,
            entries,

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        };
      }),

      ...briefingRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'briefing' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
          date: t.date.toISOString(),

          done: t.done,
          isBalanced: t.isBalanced,
          parentTaskId: t.parentTaskId,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...eodZReportRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'eod_z_report' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
          date: t.date.toISOString(),

          totalNominal: t.totalNominal,
          zReportPhotos: parsePhotos(t.zReportPhotos),

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...edcReconciliationRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'edc_reconciliation' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
          date: t.date.toISOString(),

          parentTaskId: t.parentTaskId,
          isBalanced: t.isBalanced,
          expectedFetchedAt: toIso(t.expectedFetchedAt),
          discrepancyStartedAt: toIso(t.discrepancyStartedAt),
          discrepancyResolvedAt: toIso(t.discrepancyResolvedAt),
          discrepancyDurationMinutes: t.discrepancyDurationMinutes,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...openStatementRows.filter((r) => inStore(r.storeId)).map((t) => ({
        type: 'open_statement' as const,
        shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
        data: {
          id: String(t.id),
          scheduleId: String(t.scheduleId),
          userId: t.userId,
          storeId: String(t.storeId),
          shift: (shiftCodeMap[t.shiftId] ?? 'evening') as ShiftCode,
          date: t.date.toISOString(),

          parentTaskId: t.parentTaskId,
          expectedAmount: t.expectedAmount,
          expectedFetchedAt: toIso(t.expectedFetchedAt),
          actualAmount: t.actualAmount,
          isBalanced: t.isBalanced,
          discrepancyStartedAt: toIso(t.discrepancyStartedAt),
          discrepancyResolvedAt: toIso(t.discrepancyResolvedAt),
          discrepancyDurationMinutes: t.discrepancyDurationMinutes,

          status: t.status,
          notes: t.notes,
          completedAt: toIso(t.completedAt),
          verifiedBy: t.verifiedBy,
          verifiedAt: toIso(t.verifiedAt),
        },
      })),

      ...groomingRows.map((t) => {
        const code = (shiftCodeMap[t.shiftId] ?? 'morning') as ShiftCode;

        return {
          type: 'grooming' as const,
          shift: code,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: code,
            date: t.date.toISOString(),

            uniformActive: t.uniformActive,
            hairActive: t.hairActive,
            smellActive: t.smellActive,
            makeUpActive: t.makeUpActive,
            shoeActive: t.shoeActive,
            nameTagActive: t.nameTagActive,

            uniformChecked: t.uniformChecked,
            hairChecked: t.hairChecked,
            smellChecked: t.smellChecked,
            makeUpChecked: t.makeUpChecked,
            shoeChecked: t.shoeChecked,
            nameTagChecked: t.nameTagChecked,

            selfiePhotos: parsePhotos(t.selfiePhotos),

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        };
      }),
    ];

    const STATUS_ORDER: Record<string, number> = {
      pending: 0,
      in_progress: 1,
      discrepancy: 2,
      completed: 3,
      verified: 4,
      rejected: 5,
    };

    const SHIFT_ORDER: Record<string, number> = {
      morning: 0,
      full_day: 1,
      evening: 2,
    };

    tasks.sort((a, b) => {
      const statusSort =
        (STATUS_ORDER[a.data.status] ?? 9) - (STATUS_ORDER[b.data.status] ?? 9);

      if (statusSort !== 0) return statusSort;

      return (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
    });

    return NextResponse.json({
      success: true,
      tasks,
      shift: primaryShift,
      scheduleIds,
    });
  } catch (error) {
    console.error('[GET /api/employee/tasks]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to load employee tasks.' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    const { taskId, taskType, status } = (await request.json()) as {
      taskId: string;
      taskType: string;
      status: string;
    };

    if (!taskId || !taskType || status !== 'in_progress') {
      return NextResponse.json(
        { error: 'taskId, taskType, and status=in_progress are required' },
        { status: 400 },
      );
    }

    const id = parseInt(taskId, 10);

    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: 'taskId must be a number' },
        { status: 400 },
      );
    }

    const SHARED_TABLES: Record<
      string,
      {
        getRow: (id: number) => Promise<{ status: string | null } | undefined>;
        update: (id: number) => Promise<void>;
      }
    > = {
      store_opening: {
        getRow: async (id) =>
          (
            await db
              .select({ status: storeOpeningTasks.status })
              .from(storeOpeningTasks)
              .where(eq(storeOpeningTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(storeOpeningTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(storeOpeningTasks.id, id))
            .then(() => {}),
      },

      store_front: {
        getRow: async (id) =>
          (
            await db
              .select({ status: storeFrontTasks.status })
              .from(storeFrontTasks)
              .where(eq(storeFrontTasks.id, id))
              .limit(1)
            )[0],

        update: (id) =>
          db
            .update(storeFrontTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(storeFrontTasks.id, id))
            .then(() => {}),
      },

      setoran: {
        getRow: async (id) =>
          (
            await db
              .select({ status: setoranTasks.status })
              .from(setoranTasks)
              .where(eq(setoranTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(setoranTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(setoranTasks.id, id))
            .then(() => {}),
      },

      cek_bin: {
        getRow: async (id) =>
          (
            await db
              .select({ status: cekBinTasks.status })
              .from(cekBinTasks)
              .where(eq(cekBinTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(cekBinTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(cekBinTasks.id, id))
            .then(() => {}),
      },

      vm_checklist: {
        getRow: async (id) =>
          (
            await db
              .select({ status: vmChecklistTasks.status })
              .from(vmChecklistTasks)
              .where(eq(vmChecklistTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(vmChecklistTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(vmChecklistTasks.id, id))
            .then(() => {}),
      },

      marketing_check: {
        getRow: async (id) =>
          (
            await db
              .select({ status: marketingCheckTasks.status })
              .from(marketingCheckTasks)
              .where(eq(marketingCheckTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(marketingCheckTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(marketingCheckTasks.id, id))
            .then(() => {}),
      },

      item_dropping: {
        getRow: async (id) =>
          (
            await db
              .select({ status: itemDroppingTasks.status })
              .from(itemDroppingTasks)
              .where(eq(itemDroppingTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(itemDroppingTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(itemDroppingTasks.id, id))
            .then(() => {}),
      },

      briefing: {
        getRow: async (id) =>
          (
            await db
              .select({ status: briefingTasks.status })
              .from(briefingTasks)
              .where(eq(briefingTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(briefingTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(briefingTasks.id, id))
            .then(() => {}),
      },

      edc_reconciliation: {
        getRow: async (id) =>
          (
            await db
              .select({ status: edcReconciliationTasks.status })
              .from(edcReconciliationTasks)
              .where(eq(edcReconciliationTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(edcReconciliationTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(edcReconciliationTasks.id, id))
            .then(() => {}),
      },

      eod_z_report: {
        getRow: async (id) =>
          (
            await db
              .select({ status: eodZReportTasks.status })
              .from(eodZReportTasks)
              .where(eq(eodZReportTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(eodZReportTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(eodZReportTasks.id, id))
            .then(() => {}),
      },

      open_statement: {
        getRow: async (id) =>
          (
            await db
              .select({ status: openStatementTasks.status })
              .from(openStatementTasks)
              .where(eq(openStatementTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(openStatementTasks)
            .set({ status: 'in_progress', updatedAt: new Date() })
            .where(eq(openStatementTasks.id, id))
            .then(() => {}),
      },
    };

    if (taskType === 'grooming') {
      const [row] = await db
        .select({ userId: groomingTasks.userId, status: groomingTasks.status })
        .from(groomingTasks)
        .where(eq(groomingTasks.id, id))
        .limit(1);

      if (!row) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 });
      }

      if (row.userId !== userId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      if (row.status !== 'pending') {
        return NextResponse.json({ success: true });
      }

      await db
        .update(groomingTasks)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(groomingTasks.id, id));

      return NextResponse.json({ success: true });
    }

    const handler = SHARED_TABLES[taskType];

    if (!handler) {
      return NextResponse.json(
        { error: `Unknown taskType: ${taskType}` },
        { status: 400 },
      );
    }

    const row = await handler.getRow(id);

    if (!row) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (row.status !== 'pending') {
      return NextResponse.json({ success: true });
    }

    await handler.update(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/employee/tasks]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update employee task.' },
      { status: 500 },
    );
  }
}
