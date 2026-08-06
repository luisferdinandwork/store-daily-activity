// lib/performance/business-central-sales.ts

import { getActiveBusinessCentralSettings } from "@/lib/performance/business-central-settings";
import { fetchAllBusinessCentralRows } from "@/lib/bc/client";

export type BusinessCentralSalesEntry = {
  storeNo: string;
  posTerminalNo?: string;
  transactionNo?: number;
  lineNo?: number;
  receiptNo: string;
  barcodeNo?: string;
  itemNo?: string;
  variantCode?: string;
  salesStaff: string;
  quantity?: number;
  totalRoundedAmt?: number;
  date: string | number;
  time?: string;
  totalByDate?: number;
};

type GetSalesEntriesParams = {
  storeNo: string;
  /** YYYY-MM-DD inclusive */
  startDate: string;
  /** YYYY-MM-DD exclusive */
  endDate: string;
};

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function isValidSalesEntry(row: unknown): row is BusinessCentralSalesEntry {
  if (!row || typeof row !== "object") return false;

  const candidate = row as Partial<BusinessCentralSalesEntry>;
  return Boolean(
    candidate.storeNo && candidate.salesStaff && candidate.receiptNo,
  );
}

export async function getBusinessCentralSalesEntries(
  params: GetSalesEntriesParams,
): Promise<BusinessCentralSalesEntry[]> {
  const settings = await getActiveBusinessCentralSettings("sales_entries");

  if (!settings) {
    throw new Error(
      "Business Central sales API is not configured. Add a business_central_settings row or set BC_SALES_ENTRIES_URL.",
    );
  }

  const url = new URL(settings.apiUrl);

  /**
   * Pull one store + one period only, then calculate employee totals locally.
   * The API response is line-level, so transaction counts are deduplicated by
   * receipt/terminal/date in the aggregation layer.
   */
  const filter = [
    `storeNo eq '${escapeODataString(params.storeNo)}'`,
    `date ge ${params.startDate}`,
    `date lt ${params.endDate}`,
  ].join(" and ");

  url.searchParams.set("$filter", filter);

  /**
   * Business Central/OData can paginate large monthly result sets. Follow
   * @odata.nextLink until the complete period has been loaded (see
   * lib/bc/client.ts) — the old implementation only read the first page,
   * which made store and employee actuals look smaller than they really were.
   */
  const rows = await fetchAllBusinessCentralRows(url.toString(), settings);

  return rows.filter(isValidSalesEntry);
}
