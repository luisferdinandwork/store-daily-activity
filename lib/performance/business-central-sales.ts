// lib/performance/business-central-sales.ts

import {
  getActiveBusinessCentralSettings,
  type ResolvedBusinessCentralSettings,
} from "@/lib/performance/business-central-settings";

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

type BusinessCentralPage = {
  value?: unknown[];
  "@odata.nextLink"?: string;
  "odata.nextLink"?: string;
};

const MAX_PAGE_COUNT = 1_000;

function escapeODataString(value: string) {
  return value.replace(/'/g, "''");
}

function getAuthHeaders(
  settings: ResolvedBusinessCentralSettings,
): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (settings.authType === "bearer") {
    if (!settings.bearerToken) {
      throw new Error("Business Central bearer token is missing.");
    }

    return {
      ...headers,
      Authorization: `Bearer ${settings.bearerToken}`,
    };
  }

  if (!settings.username || !settings.password) {
    throw new Error(
      "Business Central Basic Auth credentials are missing. Configure username and password in DB or .env.local.",
    );
  }

  const basic = Buffer.from(
    `${settings.username}:${settings.password}`,
    "utf8",
  ).toString("base64");

  return {
    ...headers,
    Authorization: `Basic ${basic}`,
  };
}

async function fetchBusinessCentralPage(params: {
  url: string;
  headers: HeadersInit;
}): Promise<BusinessCentralPage | unknown[]> {
  const response = await fetch(params.url, {
    method: "GET",
    headers: params.headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Business Central sales API failed: ${response.status} ${response.statusText}${
        body ? ` - ${body.slice(0, 300)}` : ""
      }`,
    );
  }

  return response.json();
}

function getRowsFromPage(page: BusinessCentralPage | unknown[]): unknown[] {
  if (Array.isArray(page)) return page;
  return Array.isArray(page.value) ? page.value : [];
}

function getNextLink(page: BusinessCentralPage | unknown[]): string | null {
  if (Array.isArray(page)) return null;
  return page["@odata.nextLink"] ?? page["odata.nextLink"] ?? null;
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
  const settings = await getActiveBusinessCentralSettings();

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

  const headers = getAuthHeaders(settings);
  const rows: unknown[] = [];
  let nextUrl: string | null = url.toString();
  let pageCount = 0;

  /**
   * Business Central/OData can paginate large monthly result sets. The old
   * implementation only read the first page, which made store and employee
   * actuals look smaller than they really were. Follow @odata.nextLink until
   * the complete period has been loaded.
   */
  while (nextUrl) {
    pageCount += 1;

    if (pageCount > MAX_PAGE_COUNT) {
      throw new Error(
        `Business Central sales API exceeded ${MAX_PAGE_COUNT} pages. Pagination was stopped to prevent an infinite loop.`,
      );
    }

    const page = await fetchBusinessCentralPage({ url: nextUrl, headers });
    rows.push(...getRowsFromPage(page));

    const nextLink = getNextLink(page);
    nextUrl = nextLink ? new URL(nextLink, nextUrl).toString() : null;
  }

  return rows.filter(isValidSalesEntry);
}
