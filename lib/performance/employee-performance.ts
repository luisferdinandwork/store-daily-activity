// lib/performance/employee-performance.ts

import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { users, stores } from '@/lib/db/schema';
import { dummyPosSalesEntries } from '@/data/employee-performance';
import {
  getBusinessCentralSalesEntries,
  type BusinessCentralSalesEntry,
} from '@/lib/performance/business-central-sales';
import {
  getMonthRange,
  resolvePerformanceTargets,
  safeContribution,
  safePct,
  toDateOnly,
  toYearMonth,
} from '@/lib/performance/target-utils';

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
  if (typeof date === 'number') {
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

function getUniqueReceiptCount(entries: SalesEntry[]) {
  return new Set(entries.map((entry) => entry.receiptNo).filter(Boolean)).size;
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

async function getMonthlySalesEntriesForStore(params: {
  storeNo: string;
  yearMonth: string;
}): Promise<SalesEntry[]> {
  const { startDate, endDate } = getMonthRangeDateOnly(params.yearMonth);

  try {
    return await getBusinessCentralSalesEntries({
      storeNo: params.storeNo,
      startDate,
      endDate,
    });
  } catch (error) {
    // Keep local development usable if BC settings have not been seeded yet.
    // In production, you may prefer to rethrow instead of falling back.
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }

    console.warn(
      'Business Central sales fetch failed; falling back to dummyPosSalesEntries in non-production.',
      error,
    );

    return (dummyPosSalesEntries as SalesEntry[]).filter((entry) => {
      const entryDate = normalizeEntryDate(entry.date);
      return entry.storeNo === params.storeNo && entryDate.startsWith(params.yearMonth);
    });
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
    throw new Error('Employee not found');
  }

  const storeId = employee.storeId ?? employee.homeStoreId;
  const storeNo = employee.storeNo;
  const storeName = employee.storeName ?? 'Unknown Store';
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
      salesPct: 0,

      transactionCount: 0,
      transactionTarget: 0,
      transactionPct: 0,

      monthlySalesAmount: 0,
      monthlyTransactionCount: 0,
      monthlyAtv: 0,

      monthlySalesTarget: 0,
      monthlySalesPct: 0,

      monthlyTransactionTarget: 0,
      monthlyTransactionPct: 0,

      storeMonthlySalesAmount: 0,
      storeMonthlyTransactionCount: 0,
      storeMonthlySalesTarget: 0,
      storeMonthlySalesPct: 0,
      storeMonthlyTransactionTarget: 0,
      storeMonthlyTransactionPct: 0,

      employeeStoreContributionPct: 0,
      targetSource: 'none',
      employeeMonthlyTargetId: null,
      employeeTargetRoleCode: null,
      employeeTargetWeightPct: 0,
      storeEmployeeTargetCount: 0,

      warning: 'Employee does not have a home store with stores.storeNo configured.',
    };
  }

  /**
   * Core matching rule:
   * - Business Central row.storeNo === stores.storeNo
   * - Business Central row.salesStaff === users.nik
   */
  const monthlyEntriesForStore = await getMonthlySalesEntriesForStore({
    storeNo,
    yearMonth,
  });

  const monthlyEntriesForEmployee = monthlyEntriesForStore.filter(
    (entry) => entry.salesStaff === salesStaffCode,
  );

  const todayEntriesForEmployee = monthlyEntriesForEmployee.filter(
    (entry) => normalizeEntryDate(entry.date) === dateOnly,
  );

  const targets = await resolvePerformanceTargets({
    userId: employee.id,
    storeId,
    yearMonth,
  });

  const storeMonthlySalesAmount = sumSales(monthlyEntriesForStore);
  const storeMonthlyTransactionCount = getUniqueReceiptCount(monthlyEntriesForStore);

  const monthlySalesAmount = sumSales(monthlyEntriesForEmployee);
  const monthlyTransactionCount = getUniqueReceiptCount(monthlyEntriesForEmployee);

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
    employeeTargetWeightPct: targets.employeeTargetWeightPct,
    storeEmployeeTargetCount: targets.employeeTargetCount,

    /** Daily employee performance */
    salesAmount,
    salesTarget: targets.dailySalesTarget,
    salesPct: safePct(salesAmount, targets.dailySalesTarget),

    transactionCount,
    transactionTarget: targets.dailyTransactionTarget,
    transactionPct: safePct(transactionCount, targets.dailyTransactionTarget),

    /** Monthly employee performance */
    monthlySalesAmount,
    monthlyTransactionCount,
    monthlyAtv,

    monthlySalesTarget: targets.employeeMonthlySalesTarget,
    monthlySalesPct: safePct(monthlySalesAmount, targets.employeeMonthlySalesTarget),

    monthlyTransactionTarget: targets.employeeMonthlyTransactionTarget,
    monthlyTransactionPct: safePct(
      monthlyTransactionCount,
      targets.employeeMonthlyTransactionTarget,
    ),

    monthlyAtvTarget: targets.employeeMonthlyAtvTarget,

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

    /** Employee contribution to the store monthly sales. */
    employeeStoreContributionPct: safeContribution(
      monthlySalesAmount,
      storeMonthlySalesAmount,
    ),

    warning:
      targets.source === 'none'
        ? 'No monthly target has been configured for this store/month yet.'
        : targets.source === 'store_rollup_only'
          ? 'Store target exists from other employee targets, but this employee has no monthly target for this store/month.'
          : undefined,
  };
}
