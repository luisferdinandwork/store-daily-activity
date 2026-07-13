// lib/performance/employee-performance.ts

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { users, stores } from "@/lib/db/schema";
import { dummyPosSalesEntries } from "@/data/employee-performance";
import {
  getBusinessCentralSalesEntries,
  type BusinessCentralSalesEntry,
} from "@/lib/performance/business-central-sales";
import {
  getMonthRange,
  resolvePerformanceTargets,
  safeContribution,
  safePct,
  uncappedPct,
  toDateOnly,
  toYearMonth,
} from "@/lib/performance/target-utils";

/**
 * The old dummy file may still use `total`, while Business Central uses
 * `totalRoundedAmt`. This shape supports both during the migration.
 */
type SalesEntry = BusinessCentralSalesEntry & {
  total?: number;
};

/**
 * Converts Excel serial date into YYYY-MM-DD.
 * Excel serial 46166 = 2026-05-24.
 */
function excelSerialToDateOnly(serial: number) {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  excelEpoch.setUTCDate(excelEpoch.getUTCDate() + serial);
  return excelEpoch.toISOString().slice(0, 10);
}

function normalizeEntryDate(date: number | string) {
  if (typeof date === "number") {
    return excelSerialToDateOnly(date);
  }

  return date.slice(0, 10);
}

function getMonthRangeDateOnly(yearMonth: string) {
  const { start, end } = getMonthRange(yearMonth);

  return {
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  };
}

function normalizeSalesAmount(entry: SalesEntry) {
  /**
   * Business Central sample has negative totalRoundedAmt because quantity is -1.
   * For performance, sales should be positive.
   *
   * Later, if you want refunds to reduce sales, add a document/entry type check
   * and only use Math.abs for normal sales rows.
   */
  const amount = entry.totalRoundedAmt ?? entry.total ?? 0;
  return Math.abs(Number(amount || 0));
}

function getTransactionKey(entry: SalesEntry) {
  const date = normalizeEntryDate(entry.date);
  const terminal = entry.posTerminalNo ?? "";
  const transaction = entry.transactionNo ?? "";
  const receipt = entry.receiptNo ?? "";

  return `${date}|${terminal}|${transaction}|${receipt}`;
}

function getUniqueReceiptCount(entries: SalesEntry[]) {
  return new Set(
    entries.filter((entry) => entry.receiptNo).map(getTransactionKey),
  ).size;
}

function sumSales(entries: SalesEntry[]) {
  return entries.reduce((sum, entry) => sum + normalizeSalesAmount(entry), 0);
}

async function getAuthenticatedEmployee(userId: string) {
  const result = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      homeStoreId: users.homeStoreId,
      storeId: stores.id,
      storeNo: stores.storeNo,
      storeName: stores.name,
    })
    .from(users)
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0] ?? null;
}

type SalesEntriesResult = {
  entries: SalesEntry[];
  source: "business_central" | "dummy" | "unavailable";
  warning?: string;
};

async function getMonthlySalesEntriesForStore(params: {
  storeNo: string;
  yearMonth: string;
}): Promise<SalesEntriesResult> {
  const { startDate, endDate } = getMonthRangeDateOnly(params.yearMonth);

  try {
    const entries = await getBusinessCentralSalesEntries({
      storeNo: params.storeNo,
      startDate,
      endDate,
    });

    return { entries, source: "business_central" };
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }

    const message =
      error instanceof Error
        ? error.message
        : "Business Central sales fetch failed.";

    /**
     * Dummy data is explicit opt-in. The old silent fallback made the
     * dashboard look valid while it was actually showing fabricated actuals.
     */
    if (process.env.ALLOW_DUMMY_PERFORMANCE_DATA === "true") {
      const entries = (dummyPosSalesEntries as SalesEntry[]).filter((entry) => {
        const entryDate = normalizeEntryDate(entry.date);
        return (
          entry.storeNo === params.storeNo &&
          entryDate.startsWith(params.yearMonth)
        );
      });

      return {
        entries,
        source: "dummy",
        warning: `Business Central is unavailable. Showing explicit dummy performance data because ALLOW_DUMMY_PERFORMANCE_DATA=true. ${message}`,
      };
    }

    return {
      entries: [],
      source: "unavailable",
      warning: `Business Central actual sales are unavailable, so actual values are shown as 0 instead of using dummy data. ${message}`,
    };
  }
}

export async function getEmployeePerformance(params: {
  userId: string;
  date?: Date;
}) {
  const date = params.date ?? new Date();
  const dateOnly = toDateOnly(date);
  const yearMonth = toYearMonth(date);

  const employee = await getAuthenticatedEmployee(params.userId);

  if (!employee) {
    throw new Error("Employee not found");
  }

  const storeId = employee.storeId ?? employee.homeStoreId;
  const storeNo = employee.storeNo;
  const storeName = employee.storeName ?? "Unknown Store";
  const salesStaffCode = employee.nik;

  if (!storeId || !storeNo) {
    return {
      success: true,

      employeeId: employee.id,
      employeeNik: employee.nik,
      employeeName: employee.name,
      salesStaffCode,

      storeId,
      storeNo,
      storeName,

      date: dateOnly,
      yearMonth,
      scheduledDaysInMonth: 0,

      salesAmount: 0,
      salesTarget: 0,
      employeeDailySalesTarget: 0,
      salesPct: 0,
      dailySalesAchievementPct: 0,

      transactionCount: 0,
      transactionTarget: 0,
      employeeDailyTransactionTarget: 0,
      transactionPct: 0,
      dailyTransactionAchievementPct: 0,

      monthlySalesAmount: 0,
      monthlyTransactionCount: 0,
      monthlyAtv: 0,

      monthlySalesTarget: 0,
      employeeMonthlySalesTarget: 0,
      monthlySalesPct: 0,
      monthlySalesAchievementPct: 0,

      monthlyTransactionTarget: 0,
      employeeMonthlyTransactionTarget: 0,
      monthlyTransactionPct: 0,
      monthlyTransactionAchievementPct: 0,

      storeMonthlySalesAmount: 0,
      storeMonthlyTransactionCount: 0,
      storeMonthlySalesTarget: 0,
      storeMonthlySalesPct: 0,
      storeMonthlyTransactionTarget: 0,
      storeMonthlyTransactionPct: 0,

      storeDailySalesAmount: 0,
      storeDailyTransactionCount: 0,
      storeDailySalesTarget: 0,
      storeDailyTransactionTarget: 0,
      employeeDailyContributionPct: 0,

      employeeStoreContributionPct: 0,
      actualsSource: "unavailable",
      targetSource: "no_store_target",
      employeeMonthlyTargetId: null,
      employeeTargetRoleCode: null,
      employeeSlotCode: null,
      dailyAllocationPct: 0,
      dailyTargetSharePct: 0,
      monthlyTargetSharePct: 0,
      isScheduledToday: false,

      warning:
        "Employee does not have a home store with stores.storeNo configured.",
    };
  }

  /**
   * Core matching rule:
   * - Business Central row.storeNo === stores.storeNo
   * - Business Central row.salesStaff === users.nik
   */
  const salesResult = await getMonthlySalesEntriesForStore({
    storeNo,
    yearMonth,
  });
  const monthlyEntriesForStore = salesResult.entries;

  const monthlyEntriesForEmployee = monthlyEntriesForStore.filter(
    (entry) => entry.salesStaff === salesStaffCode,
  );

  const todayEntriesForEmployee = monthlyEntriesForEmployee.filter(
    (entry) => normalizeEntryDate(entry.date) === dateOnly,
  );

  // Store-wide (not just this employee) actuals for TODAY — needed to work
  // out what % of today's real sales this employee actually contributed,
  // the daily counterpart to employeeStoreContributionPct below.
  const todayEntriesForStore = monthlyEntriesForStore.filter(
    (entry) => normalizeEntryDate(entry.date) === dateOnly,
  );

  const targets = await resolvePerformanceTargets({
    userId: employee.id,
    storeId,
    yearMonth,
    date: dateOnly,
  });

  const storeMonthlySalesAmount = sumSales(monthlyEntriesForStore);
  const storeMonthlyTransactionCount = getUniqueReceiptCount(
    monthlyEntriesForStore,
  );

  const storeDailySalesAmount = sumSales(todayEntriesForStore);
  const storeDailyTransactionCount =
    getUniqueReceiptCount(todayEntriesForStore);

  const monthlySalesAmount = sumSales(monthlyEntriesForEmployee);
  const monthlyTransactionCount = getUniqueReceiptCount(
    monthlyEntriesForEmployee,
  );

  const salesAmount = sumSales(todayEntriesForEmployee);
  const transactionCount = getUniqueReceiptCount(todayEntriesForEmployee);

  const monthlyAtv =
    monthlyTransactionCount > 0
      ? Math.round(monthlySalesAmount / monthlyTransactionCount)
      : 0;

  return {
    success: true,

    employeeId: employee.id,
    employeeNik: employee.nik,
    employeeName: employee.name,
    salesStaffCode,

    storeId,
    storeNo,
    storeName,

    date: dateOnly,
    yearMonth,

    scheduledDaysInMonth: targets.scheduledDaysInMonth,
    targetSource: targets.source,
    employeeMonthlyTargetId: targets.employeeMonthlyTargetId,
    employeeTargetRoleCode: targets.employeeTargetRoleCode,
    /** Today's slot, e.g. "SA2" — null if not scheduled today. */
    employeeSlotCode: targets.employeeSlotCode,
    /** Today's effective allocation % of the store's daily target. */
    dailyAllocationPct: targets.dailyAllocationPct,
    /** Explicit target-share names used by the contribution chart. */
    dailyTargetSharePct: targets.dailyAllocationPct,
    monthlyTargetSharePct: targets.monthlyAllocationPct,
    /** False = employee has no target allocation today, so today's target is Rp 0 by design. */
    isScheduledToday: targets.isScheduledToday,

    /** Daily employee performance */
    salesAmount,
    /** Employee target for today, not the store target. */
    salesTarget: targets.dailySalesTarget,
    employeeDailySalesTarget: targets.dailySalesTarget,
    salesPct: safePct(salesAmount, targets.dailySalesTarget),
    dailySalesAchievementPct: uncappedPct(
      salesAmount,
      targets.dailySalesTarget,
    ),

    transactionCount,
    /** Employee transaction target for today, not the store target. */
    transactionTarget: targets.dailyTransactionTarget,
    employeeDailyTransactionTarget: targets.dailyTransactionTarget,
    transactionPct: safePct(transactionCount, targets.dailyTransactionTarget),
    dailyTransactionAchievementPct: uncappedPct(
      transactionCount,
      targets.dailyTransactionTarget,
    ),

    /** Monthly employee performance (summed from daily allocations) */
    monthlySalesAmount,
    monthlyTransactionCount,
    monthlyAtv,

    /** Employee target for the month, derived from the employee's daily allocations. */
    monthlySalesTarget: targets.employeeMonthlySalesTarget,
    employeeMonthlySalesTarget: targets.employeeMonthlySalesTarget,
    monthlySalesPct: safePct(
      monthlySalesAmount,
      targets.employeeMonthlySalesTarget,
    ),
    monthlySalesAchievementPct: uncappedPct(
      monthlySalesAmount,
      targets.employeeMonthlySalesTarget,
    ),

    monthlyTransactionTarget: targets.employeeMonthlyTransactionTarget,
    employeeMonthlyTransactionTarget: targets.employeeMonthlyTransactionTarget,
    monthlyTransactionPct: safePct(
      monthlyTransactionCount,
      targets.employeeMonthlyTransactionTarget,
    ),
    monthlyTransactionAchievementPct: uncappedPct(
      monthlyTransactionCount,
      targets.employeeMonthlyTransactionTarget,
    ),

    monthlyAtvTarget: targets.employeeMonthlyAtvTarget,

    /** Daily store performance — the store-wide counterpart to salesAmount/
     *  salesTarget above, needed to work out today's contribution %. */
    storeDailySalesAmount,
    storeDailyTransactionCount,
    storeDailySalesTarget: targets.storeDailySalesTarget,
    storeDailyTransactionTarget: targets.storeDailyTransactionTarget,

    /** Monthly store performance */
    storeMonthlySalesAmount,
    storeMonthlyTransactionCount,

    storeMonthlySalesTarget: targets.storeMonthlySalesTarget,
    storeMonthlySalesPct: safePct(
      storeMonthlySalesAmount,
      targets.storeMonthlySalesTarget,
    ),

    storeMonthlyTransactionTarget: targets.storeMonthlyTransactionTarget,
    storeMonthlyTransactionPct: safePct(
      storeMonthlyTransactionCount,
      targets.storeMonthlyTransactionTarget,
    ),

    storeMonthlyAtvTarget: targets.storeMonthlyAtvTarget,

    /** Employee contribution to the store's ACTUAL sales TODAY — the daily
     *  counterpart to employeeStoreContributionPct (which is monthly). */
    employeeDailyContributionPct: safeContribution(
      salesAmount,
      storeDailySalesAmount,
    ),

    /** Employee contribution to the store monthly sales. */
    employeeStoreContributionPct: safeContribution(
      monthlySalesAmount,
      storeMonthlySalesAmount,
    ),

    actualsSource: salesResult.source,

    warning:
      [
        salesResult.warning,
        targets.source === "no_store_target"
          ? "No monthly target has been set for this store/month yet."
          : targets.source === "not_on_roster"
            ? "This employee is not on the target roster for this store/month."
            : !targets.isScheduledToday
              ? "Employee is not scheduled to work today, so today's target is Rp 0."
              : undefined,
      ]
        .filter(Boolean)
        .join(" ") || undefined,
  };
}
