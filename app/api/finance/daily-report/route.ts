// app/api/finance/daily-report/route.ts
//
// GET /api/finance/daily-report?date=YYYY-MM-DD
//
// Returns a full daily performance snapshot for every store:
//   • Store-level: actual sales, transaction count, ATV vs monthly targets
//   • Employee-level: per-employee actuals vs their monthly target (pro-rated daily)
//   • Sales data sourced from Business Central via getStoreActualsForDay
//   • Targets sourced from employee_monthly_targets via listStoreEmployeeTargets
//   • Auth: finance role or admin only (resolveFinanceScope)
//   • Finance sees ALL stores — no area scoping
//
// Sorted: stores by area name → store name; employees by targetRoleCode → name.

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores, areas, users, schedules } from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import {
  listStoreEmployeeTargets,
  getStoreMonthlyTargetRollup,
  safePct,
  uncappedPct,
  calculateDailyTarget,
  toDateOnly,
  toYearMonth,
  getScheduledDaysForEmployeeInStore,
} from '@/lib/performance/target-utils';
import { getStoreActualsForDay } from '@/lib/performance/employee-actuals';
import { resolveFinanceScope } from '@/lib/finance/scope';

// ─── Response types ───────────────────────────────────────────────────────────

export interface DailyReportEmployee {
  userId:    string;
  nik:       string;
  name:      string;
  roleCode:  string;
  /** Whether this employee was scheduled to work today */
  isScheduled: boolean;

  // Monthly targets
  monthlySalesTarget:       number;
  monthlyTransactionTarget: number;
  monthlyAtvTarget:         number;
  /** Number of days this employee is scheduled in this store this month */
  scheduledDaysInMonth: number;

  // Daily targets (monthlySalesTarget / scheduledDaysInMonth)
  dailySalesTarget:       number;
  dailyTransactionTarget: number;

  // Today's actuals from Business Central
  actualSales:            number;
  actualTransactionCount: number;
  actualAtv:              number;

  // Achievement % vs daily target — uncapped so over-achievers show > 100
  salesAchievementPct:       number;
  transactionAchievementPct: number;
}

export interface DailyReportStore {
  storeId:   number;
  storeName: string;
  storeNo:   string;
  areaId:    number;
  areaName:  string;

  // Monthly store targets (sum of active employee targets)
  storeMonthlySalesTarget:       number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget:         number;

  // Today's store-level actuals
  storeActualSales:            number;
  storeActualTransactionCount: number;
  storeActualAtv:              number;

  /** Running % of monthly target accumulated so far today */
  storeSalesVsMonthlyPct: number;

  employees: DailyReportEmployee[];

  /** Employees scheduled today who have no target row configured */
  unassignedScheduledStaff: { userId: string; nik: string; name: string }[];

  bcAvailable: boolean;
  bcError?:    string;
}

export interface DailyReportResponse {
  success:     true;
  date:        string;
  yearMonth:   string;
  totalStores: number;
  stores:      DailyReportStore[];
}

export interface DailyReportErrorResponse {
  success: false;
  error:   string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
): Promise<NextResponse<DailyReportResponse | DailyReportErrorResponse>> {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const scope = await resolveFinanceScope();
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error },
        { status: scope.status },
      );
    }

    // ── Parse date ────────────────────────────────────────────────────────────
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const rawDate   = dateParam ? new Date(dateParam) : new Date();

    if (isNaN(rawDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date. Use YYYY-MM-DD.' },
        { status: 400 },
      );
    }

    const dayStart  = startOfDay(rawDate);
    const dateStr   = toDateOnly(dayStart);
    const yearMonth = toYearMonth(dayStart);

    // ── 1. All stores (finance sees everything) ───────────────────────────────
    const storeRows = await db
      .select({
        id:       stores.id,
        name:     stores.name,
        storeNo:  stores.storeNo,
        areaId:   stores.areaId,
        areaName: areas.name,
      })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .orderBy(areas.name, stores.name);

    if (storeRows.length === 0) {
      return NextResponse.json({
        success: true,
        date:        dateStr,
        yearMonth,
        totalStores: 0,
        stores:      [],
      });
    }

    const storeIds = storeRows.map((s) => s.id);

    // ── 2. All employees scheduled today across those stores ──────────────────
    //    All shift types count (morning + evening + full_day all sell)
    const scheduledRows = await db
      .select({
        userId:  schedules.userId,
        storeId: schedules.storeId,
      })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      .where(
        and(
          eq(schedules.date, dayStart),
          inArray(schedules.storeId, storeIds),
        ),
      );

    const scheduledByStore = new Map<number, Set<string>>();
    for (const row of scheduledRows) {
      if (!scheduledByStore.has(row.storeId)) scheduledByStore.set(row.storeId, new Set());
      scheduledByStore.get(row.storeId)!.add(row.userId);
    }

    const allScheduledUserIds = [...new Set(scheduledRows.map((r) => r.userId))];

    // ── 3. User display info for scheduled staff ──────────────────────────────
    const userRows =
      allScheduledUserIds.length > 0
        ? await db
            .select({ id: users.id, nik: users.nik, name: users.name })
            .from(users)
            .where(inArray(users.id, allScheduledUserIds))
        : [];

    const userMap = new Map(userRows.map((u) => [u.id, u]));

    // ── 4. Per-store: targets + BC actuals (parallel across stores) ───────────
    const storeResults = await Promise.all(
      storeRows.map(async (store): Promise<DailyReportStore> => {
        // 4a. Targets
        const [employeeTargets, storeRollup] = await Promise.all([
          listStoreEmployeeTargets({ storeId: store.id, yearMonth }),
          getStoreMonthlyTargetRollup({ storeId: store.id, yearMonth }),
        ]);

        // 4b. BC actuals for today — degrade gracefully on error
        const bcResult = await getStoreActualsForDay({
          storeNo: store.storeNo,
          date:    dateStr,
        })
          .then((r) => ({ ...r, available: true, error: undefined as string | undefined }))
          .catch((err: unknown) => ({
            byEmployee:                  new Map<string, { actualSales: number; actualTransactionCount: number }>(),
            storeActualSales:            0,
            storeActualTransactionCount: 0,
            available:                   false,
            error:                       err instanceof Error ? err.message : String(err),
          }));

        // 4c. Scheduled staff for this store today
        const scheduledUserIds = scheduledByStore.get(store.id) ?? new Set<string>();

        // 4d. Per-employee rows
        const employees: DailyReportEmployee[] = await Promise.all(
          employeeTargets.map(async (target): Promise<DailyReportEmployee> => {
            const bcActual = bcResult.byEmployee.get(target.nik);
            const isScheduled = scheduledUserIds.has(target.userId);

            const scheduledDaysInMonth = await getScheduledDaysForEmployeeInStore({
              userId:  target.userId,
              storeId: store.id,
              yearMonth,
            });

            const dailySalesTarget       = calculateDailyTarget(target.monthlySalesTarget,       scheduledDaysInMonth);
            const dailyTransactionTarget = calculateDailyTarget(target.monthlyTransactionTarget, scheduledDaysInMonth);

            const actualSales            = bcActual?.actualSales            ?? 0;
            const actualTransactionCount = bcActual?.actualTransactionCount ?? 0;
            const actualAtv              = actualTransactionCount > 0
              ? Math.round(actualSales / actualTransactionCount)
              : 0;

            return {
              userId:    target.userId,
              nik:       target.nik,
              name:      target.name,
              roleCode:  target.targetRoleCode,
              isScheduled,

              monthlySalesTarget:       target.monthlySalesTarget,
              monthlyTransactionTarget: target.monthlyTransactionTarget,
              monthlyAtvTarget:         target.monthlyAtvTarget,
              scheduledDaysInMonth,

              dailySalesTarget,
              dailyTransactionTarget,

              actualSales,
              actualTransactionCount,
              actualAtv,

              salesAchievementPct:       uncappedPct(actualSales,            dailySalesTarget),
              transactionAchievementPct: uncappedPct(actualTransactionCount, dailyTransactionTarget),
            };
          }),
        );

        // 4e. Scheduled staff with no target row
        const targetUserIds = new Set(employeeTargets.map((t) => t.userId));
        const unassignedScheduledStaff = [...scheduledUserIds]
          .filter((uid) => !targetUserIds.has(uid))
          .map((uid) => {
            const u = userMap.get(uid);
            return { userId: uid, nik: u?.nik ?? uid, name: u?.name ?? uid };
          });

        const storeActualSales            = bcResult.storeActualSales;
        const storeActualTransactionCount = bcResult.storeActualTransactionCount;
        const storeActualAtv              = storeActualTransactionCount > 0
          ? Math.round(storeActualSales / storeActualTransactionCount)
          : 0;

        return {
          storeId:   store.id,
          storeName: store.name,
          storeNo:   store.storeNo,
          areaId:    store.areaId,
          areaName:  store.areaName,

          storeMonthlySalesTarget:       storeRollup.storeMonthlySalesTarget,
          storeMonthlyTransactionTarget: storeRollup.storeMonthlyTransactionTarget,
          storeMonthlyAtvTarget:         storeRollup.storeMonthlyAtvTarget,

          storeActualSales,
          storeActualTransactionCount,
          storeActualAtv,

          storeSalesVsMonthlyPct: safePct(storeActualSales, storeRollup.storeMonthlySalesTarget),

          employees,
          unassignedScheduledStaff,

          bcAvailable: bcResult.available,
          bcError:     bcResult.error,
        };
      }),
    );

    return NextResponse.json({
      success:     true,
      date:        dateStr,
      yearMonth,
      totalStores: storeResults.length,
      stores:      storeResults,
    });
  } catch (err) {
    console.error('[GET /api/finance/daily-report]', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}