// lib/performance/business-central-sales.ts
import {
  getActiveBusinessCentralSettings,
  type ResolvedBusinessCentralSettings,
} from '@/lib/performance/business-central-settings';

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

function getAuthHeaders(settings: ResolvedBusinessCentralSettings): HeadersInit {
  const headers: HeadersInit = {
    Accept: 'application/json',
  };

  if (settings.authType === 'bearer') {
    if (!settings.bearerToken) {
      throw new Error('Business Central bearer token is missing.');
    }

    return {
      ...headers,
      Authorization: `Bearer ${settings.bearerToken}`,
    };
  }

  if (!settings.username || !settings.password) {
    throw new Error(
      'Business Central Basic Auth credentials are missing. Configure username and password in DB or .env.local.',
    );
  }

  const basic = Buffer.from(
    `${settings.username}:${settings.password}`,
    'utf8',
  ).toString('base64');

  return {
    ...headers,
    Authorization: `Basic ${basic}`,
  };
}

export async function getBusinessCentralSalesEntries(
  params: GetSalesEntriesParams,
): Promise<BusinessCentralSalesEntry[]> {
  const settings = await getActiveBusinessCentralSettings();

  if (!settings) {
    throw new Error(
      'Business Central sales API is not configured. Add a business_central_settings row or set BC_SALES_ENTRIES_URL.',
    );
  }

  const url = new URL(settings.apiUrl);

  /**
   * Pull one store + one month only, then calculate employee totals locally.
   * The API response is line-level, so receiptNo is used later to count
   * unique transactions.
   */
  const filter = [
    `storeNo eq '${escapeODataString(params.storeNo)}'`,
    `date ge ${params.startDate}`,
    `date lt ${params.endDate}`,
  ].join(' and ');

  url.searchParams.set('$filter', filter);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: getAuthHeaders(settings),
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Business Central sales API failed: ${response.status} ${response.statusText}${
        body ? ` - ${body.slice(0, 300)}` : ''
      }`,
    );
  }

  const json = await response.json();
  const rows = Array.isArray(json?.value)
    ? json.value
    : Array.isArray(json)
      ? json
      : [];

  return rows.filter(
    (row: Partial<BusinessCentralSalesEntry>) =>
      row.storeNo && row.salesStaff && row.receiptNo,
  ) as BusinessCentralSalesEntry[];
}
