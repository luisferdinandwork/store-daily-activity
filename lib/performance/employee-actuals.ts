// lib/performance/employee-actuals.ts
// ─────────────────────────────────────────────────────────────────────────────
// Fetches Business Central sales actuals for a store and aggregates them per
// employee (matched via users.nik === BC row.salesStaff), for either:
//
//   - a single day (period = 'daily', date = YYYY-MM-DD)
//   - a full month (period = 'monthly', yearMonth = YYYY-MM)
//
// Used by the performance-targets detail API to show "actual vs target"
// comparisons in the employee target table.
// ─────────────────────────────────────────────────────────────────────────────

import {
  getBusinessCentralSalesEntries,
  type BusinessCentralSalesEntry,
} from "@/lib/performance/business-central-sales";
import {
  getMonthRange,
  listDateKeysInMonth,
  toDateOnly,
} from "@/lib/performance/target-utils";

export type EmployeeActual = {
  /** users.nik, matched against BC row.salesStaff */
  salesStaff: string;
  actualSales: number;
  actualTransactionCount: number;
};

export type StoreActualsResult = {
  /** Keyed by salesStaff (NIK). */
  byEmployee: Map<string, EmployeeActual>;
  storeActualSales: number;
  storeActualTransactionCount: number;
};

function normalizeSalesAmount(
  entry: BusinessCentralSalesEntry & { total?: number },
) {
  const amount = entry.totalRoundedAmt ?? entry.total ?? 0;
  return Math.abs(Number(amount || 0));
}

function normalizeEntryDate(date: number | string): string {
  if (typeof date === "number") {
    // Excel serial date fallback (kept for parity with employee-performance.ts).
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + date);
    return excelEpoch.toISOString().slice(0, 10);
  }
  return date.slice(0, 10);
}

function getTransactionKey(entry: BusinessCentralSalesEntry) {
  const date = normalizeEntryDate(entry.date);
  const terminal = entry.posTerminalNo ?? "";
  const transaction = entry.transactionNo ?? "";
  const receipt = entry.receiptNo ?? "";

  return `${date}|${terminal}|${transaction}|${receipt}`;
}

function aggregateByEmployee(
  entries: BusinessCentralSalesEntry[],
): StoreActualsResult {
  const byEmployee = new Map<
    string,
    { sales: number; receipts: Set<string> }
  >();
  const storeReceipts = new Set<string>();
  let storeActualSales = 0;

  for (const entry of entries) {
    const staff = entry.salesStaff;
    if (!staff) continue;

    const amount = normalizeSalesAmount(entry);
    const transactionKey = getTransactionKey(entry);

    storeActualSales += amount;
    if (entry.receiptNo) storeReceipts.add(transactionKey);

    const existing = byEmployee.get(staff) ?? {
      sales: 0,
      receipts: new Set<string>(),
    };
    existing.sales += amount;
    if (entry.receiptNo) existing.receipts.add(transactionKey);
    byEmployee.set(staff, existing);
  }

  const result = new Map<string, EmployeeActual>();
  for (const [staff, { sales, receipts }] of byEmployee) {
    result.set(staff, {
      salesStaff: staff,
      actualSales: sales,
      actualTransactionCount: receipts.size,
    });
  }

  return {
    byEmployee: result,
    storeActualSales,
    storeActualTransactionCount: storeReceipts.size,
  };
}

/**
 * Fetch + aggregate actuals for a single calendar day.
 *
 * IMPORTANT: this deliberately does NOT ask Business Central for just a
 * single day's window. A tight `date ge X and date lt X+1` $filter is
 * unreliable against this BC OData endpoint — some requests silently return
 * zero rows for a day that has real data (a timezone/off-by-one issue on
 * BC's side, not something we control), while the exact same day's rows
 * come back fine as part of a month-wide fetch. So instead we fetch the
 * whole month (same range the monthly view already uses successfully, and
 * the same approach employee-performance.ts uses for "today") and filter
 * down to the exact day locally, which is unaffected by BC's date-filter
 * quirk.
 */
export async function getStoreActualsForDay(params: {
  storeNo: string;
  date: string; // YYYY-MM-DD
}): Promise<StoreActualsResult> {
  const yearMonth = params.date.slice(0, 7);
  const { start, end } = getMonthRange(yearMonth);

  const entries = await getBusinessCentralSalesEntries({
    storeNo: params.storeNo,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  });

  const filtered = entries.filter(
    (entry) => normalizeEntryDate(entry.date) === params.date,
  );

  return aggregateByEmployee(filtered);
}

/**
 * Fetch + aggregate actuals for a full month (YYYY-MM).
 */
export async function getStoreActualsForMonth(params: {
  storeNo: string;
  yearMonth: string;
}): Promise<StoreActualsResult> {
  const { start, end } = getMonthRange(params.yearMonth);

  const entries = await getBusinessCentralSalesEntries({
    storeNo: params.storeNo,
    startDate: toDateOnly(start),
    endDate: toDateOnly(end),
  });

  return aggregateByEmployee(entries);
}

/**
 * Convenience wrapper: dispatches to the daily or monthly fetcher.
 * Returns an empty result (rather than throwing) if BC is not configured,
 * so the performance-targets page can still render targets-only.
 */
export async function getStoreActuals(params: {
  storeNo: string;
  period: "daily" | "monthly";
  /** Required when period === 'daily'. YYYY-MM-DD. */
  date?: string;
  /** Required when period === 'monthly'. YYYY-MM. */
  yearMonth?: string;
}): Promise<StoreActualsResult & { available: boolean; error?: string }> {
  try {
    if (params.period === "daily") {
      if (!params.date) throw new Error("date is required for daily period.");
      const result = await getStoreActualsForDay({
        storeNo: params.storeNo,
        date: params.date,
      });
      return { ...result, available: true };
    }

    if (!params.yearMonth)
      throw new Error("yearMonth is required for monthly period.");
    const result = await getStoreActualsForMonth({
      storeNo: params.storeNo,
      yearMonth: params.yearMonth,
    });
    return { ...result, available: true };
  } catch (error) {
    return {
      byEmployee: new Map(),
      storeActualSales: 0,
      storeActualTransactionCount: 0,
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch Business Central actuals.",
    };
  }
}

export type EmployeeDailyActual = {
  date: string; // YYYY-MM-DD
  actualSales: number;
  actualTransactionCount: number;
};

/**
 * Fetch one employee's (by NIK) daily sales + transaction counts for every
 * day in a month — used by the "monthly sales calendar" widget in the
 * employee target table's Aksi column.
 *
 * Returns a day-by-day breakdown (only days with at least one entry are
 * included in `daysWithSales`; `byDate` includes zero-value days for the
 * full month so the calendar can render every cell).
 */
export async function getEmployeeDailyActualsForMonth(params: {
  storeNo: string;
  yearMonth: string;
  /** users.nik */
  nik: string;
}): Promise<{
  byDate: Map<string, EmployeeDailyActual>;
  totalSales: number;
  totalTransactionCount: number;
  available: boolean;
  error?: string;
}> {
  try {
    const { start, end } = getMonthRange(params.yearMonth);

    const entries = await getBusinessCentralSalesEntries({
      storeNo: params.storeNo,
      startDate: toDateOnly(start),
      endDate: toDateOnly(end),
    });

    const byDate = new Map<string, { sales: number; receipts: Set<string> }>();

    // Pre-fill every date key directly. This avoids server-timezone shifts
    // when the calendar is rendered around midnight.
    for (const date of listDateKeysInMonth(params.yearMonth)) {
      byDate.set(date, { sales: 0, receipts: new Set<string>() });
    }

    let totalSales = 0;
    const totalReceipts = new Set<string>();

    for (const entry of entries) {
      if (entry.salesStaff !== params.nik) continue;

      const date = normalizeEntryDate(entry.date);
      const amount = normalizeSalesAmount(entry);

      const transactionKey = getTransactionKey(entry);
      const existing = byDate.get(date) ?? {
        sales: 0,
        receipts: new Set<string>(),
      };
      existing.sales += amount;
      if (entry.receiptNo) {
        existing.receipts.add(transactionKey);
        totalReceipts.add(transactionKey);
      }
      byDate.set(date, existing);

      totalSales += amount;
    }

    const result = new Map<string, EmployeeDailyActual>();
    for (const [date, { sales, receipts }] of byDate) {
      result.set(date, {
        date,
        actualSales: sales,
        actualTransactionCount: receipts.size,
      });
    }

    return {
      byDate: result,
      totalSales,
      totalTransactionCount: totalReceipts.size,
      available: true,
    };
  } catch (error) {
    return {
      byDate: new Map(),
      totalSales: 0,
      totalTransactionCount: 0,
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to fetch Business Central actuals.",
    };
  }
}
