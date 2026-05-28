// lib/performance/employee-performance.ts

import { and, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/lib/db';
import { schedules, users, stores } from '@/lib/db/schema';

import {
  dummyPosSalesEntries,
  dummySalesStaffMappings,
  dummyStoreTargets,
  type PosSalesEntry,
} from '@/data/employee-performance';

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function toDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toYearMonth(date: Date) {
  return date.toISOString().slice(0, 7);
}

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

function getMonthRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);

  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);

  return { start, end };
}

function safePct(actual: number, target: number) {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function safeContribution(part: number, total: number) {
  if (!total || total <= 0) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function normalizeSalesAmount(total: number) {
  /**
   * Your Excel sample has negative Total values because Quantity is -1.
   * For performance, sales should be positive.
   *
   * If later your POS sends returns/refunds, you can adjust this:
   * - sales rows: Math.abs(total)
   * - return rows: -Math.abs(total)
   */
  return Math.abs(Number(total || 0));
}

function getUniqueReceiptCount(entries: PosSalesEntry[]) {
  return new Set(entries.map((entry) => entry.receiptNo).filter(Boolean)).size;
}

function sumSales(entries: PosSalesEntry[]) {
  return entries.reduce((sum, entry) => sum + normalizeSalesAmount(entry.total), 0);
}

async function getScheduledDaysForEmployee(params: {
  userId: string;
  storeId: number;
  yearMonth: string;
}) {
  const { userId, storeId, yearMonth } = params;
  const { start, end } = getMonthRange(yearMonth);

  const rows = await db
    .select({
      date: schedules.date,
    })
    .from(schedules)
    .where(
      and(
        eq(schedules.userId, userId),
        eq(schedules.storeId, storeId),
        gte(schedules.date, start),
        lt(schedules.date, end),
      ),
    );

  const uniqueDates = new Set(rows.map((row) => toDateOnly(row.date)));

  /**
   * Dummy fallback so the tracker still works before monthly schedules exist.
   */
  return uniqueDates.size || 22;
}

async function getAuthenticatedEmployee(userId: string) {
  const result = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      homeStoreId: users.homeStoreId,
      storeId: stores.id,
      storeName: stores.name,
    })
    .from(users)
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0] ?? null;
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

  /**
   * First try to match POS staff code by userId.
   * In your seeded users, userId is EMP-001, EMP-002, etc.
   *
   * Later you can make this more exact by adding:
   * users.posSalesStaffCode
   * or a separate user_pos_mappings table.
   */
  const staffMapping = dummySalesStaffMappings.find(
    (mapping) => mapping.userId === employee.id || mapping.nik === employee.nik,
  );

  if (!staffMapping) {
    return {
      success: true,

      employeeId: employee.id,
      employeeNik: employee.nik,
      employeeName: employee.name,

      storeId: employee.storeId ?? employee.homeStoreId,
      storeName: employee.storeName ?? 'Unknown Store',

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

      storeMonthlySalesAmount: 0,
      storeMonthlyTransactionCount: 0,
      storeMonthlySalesTarget: 0,
      storeMonthlyTransactionTarget: 0,

      employeeStoreContributionPct: 0,

      warning: 'No dummy POS sales-staff mapping found for this user.',
    };
  }

  const storeId = staffMapping.storeId;
  const storeNo = staffMapping.storeNo;
  const storeName = staffMapping.storeName;

  const storeTarget = dummyStoreTargets.find(
    (target) => target.storeId === storeId && target.yearMonth === yearMonth,
  );

  const monthlyEntriesForStore = dummyPosSalesEntries.filter((entry) => {
    const entryDate = normalizeEntryDate(entry.date);
    return entry.storeNo === storeNo && entryDate.startsWith(yearMonth);
  });

  const monthlyEntriesForEmployee = monthlyEntriesForStore.filter(
    (entry) => entry.salesStaff === staffMapping.salesStaff,
  );

  const todayEntriesForEmployee = monthlyEntriesForEmployee.filter(
    (entry) => normalizeEntryDate(entry.date) === dateOnly,
  );

  const scheduledDaysInMonth = await getScheduledDaysForEmployee({
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

  /**
   * Employee daily target is generated from store target contribution.
   *
   * Simple dummy logic:
   * - count how many mapped employees are assigned to this store
   * - divide store target equally
   * - then divide employee monthly target by scheduled days
   *
   * Later, this can be replaced with real employee-specific targets.
   */
  const employeeCountInStore =
    dummySalesStaffMappings.filter((mapping) => mapping.storeId === storeId).length || 1;

  const employeeMonthlySalesTarget =
    (storeTarget?.monthlySalesTarget ?? 0) / employeeCountInStore;

  const employeeMonthlyTransactionTarget =
    (storeTarget?.monthlyTransactionTarget ?? 0) / employeeCountInStore;

  const salesTarget =
    scheduledDaysInMonth > 0
      ? Math.round(employeeMonthlySalesTarget / scheduledDaysInMonth)
      : 0;

  const transactionTarget =
    scheduledDaysInMonth > 0
      ? Math.round(employeeMonthlyTransactionTarget / scheduledDaysInMonth)
      : 0;

  const monthlyAtv =
    monthlyTransactionCount > 0
      ? Math.round(monthlySalesAmount / monthlyTransactionCount)
      : 0;

  return {
    success: true,

    employeeId: employee.id,
    employeeNik: employee.nik,
    employeeName: employee.name,

    salesStaffCode: staffMapping.salesStaff,

    storeId,
    storeNo,
    storeName,

    date: dateOnly,
    yearMonth,

    scheduledDaysInMonth,

    /**
     * Daily employee performance
     */
    salesAmount,
    salesTarget,
    salesPct: safePct(salesAmount, salesTarget),

    transactionCount,
    transactionTarget,
    transactionPct: safePct(transactionCount, transactionTarget),

    /**
     * Monthly employee performance
     */
    monthlySalesAmount,
    monthlyTransactionCount,
    monthlyAtv,

    monthlySalesTarget: Math.round(employeeMonthlySalesTarget),
    monthlySalesPct: safePct(monthlySalesAmount, employeeMonthlySalesTarget),

    monthlyTransactionTarget: Math.round(employeeMonthlyTransactionTarget),
    monthlyTransactionPct: safePct(monthlyTransactionCount, employeeMonthlyTransactionTarget),

    /**
     * Monthly store performance
     */
    storeMonthlySalesAmount,
    storeMonthlyTransactionCount,

    storeMonthlySalesTarget: storeTarget?.monthlySalesTarget ?? 0,
    storeMonthlySalesPct: safePct(
      storeMonthlySalesAmount,
      storeTarget?.monthlySalesTarget ?? 0,
    ),

    storeMonthlyTransactionTarget: storeTarget?.monthlyTransactionTarget ?? 0,
    storeMonthlyTransactionPct: safePct(
      storeMonthlyTransactionCount,
      storeTarget?.monthlyTransactionTarget ?? 0,
    ),

    /**
     * Employee contribution to the store monthly sales.
     */
    employeeStoreContributionPct: safeContribution(
      monthlySalesAmount,
      storeMonthlySalesAmount,
    ),
  };
}