// lib/bc/client.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared low-level HTTP client for Business Central OData endpoints —
// authentication header building + `@odata.nextLink` pagination. Used by
// every BC integration in the app (sales entries, the item-transfer
// pipeline, ...). Extracted from lib/performance/business-central-sales.ts,
// which used to inline this and was the only caller.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResolvedBusinessCentralSettings } from '@/lib/performance/business-central-settings';

export type BusinessCentralPage = {
  value?: unknown[];
  '@odata.nextLink'?: string;
  'odata.nextLink'?: string;
};

const MAX_PAGE_COUNT = 1_000;

export function getBusinessCentralAuthHeaders(
  settings: ResolvedBusinessCentralSettings,
): HeadersInit {
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

async function fetchBusinessCentralPage(params: {
  url: string;
  headers: HeadersInit;
}): Promise<BusinessCentralPage | unknown[]> {
  const response = await fetch(params.url, {
    method: 'GET',
    headers: params.headers,
    cache: 'no-store',
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Business Central API failed: ${response.status} ${response.statusText}${
        body ? ` - ${body.slice(0, 300)}` : ''
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
  return page['@odata.nextLink'] ?? page['odata.nextLink'] ?? null;
}

/**
 * Fetches every page of a Business Central OData resource, following
 * `@odata.nextLink` until exhausted. Returns raw, unvalidated rows —
 * callers apply their own row-shape guard.
 */
export async function fetchAllBusinessCentralRows(
  url: string,
  settings: ResolvedBusinessCentralSettings,
): Promise<unknown[]> {
  const headers = getBusinessCentralAuthHeaders(settings);
  const rows: unknown[] = [];
  let nextUrl: string | null = url;
  let pageCount = 0;

  while (nextUrl) {
    pageCount += 1;

    if (pageCount > MAX_PAGE_COUNT) {
      throw new Error(
        `Business Central API exceeded ${MAX_PAGE_COUNT} pages. Pagination was stopped to prevent an infinite loop.`,
      );
    }

    const page = await fetchBusinessCentralPage({ url: nextUrl, headers });
    rows.push(...getRowsFromPage(page));

    const nextLink = getNextLink(page);
    nextUrl = nextLink ? new URL(nextLink, nextUrl).toString() : null;
  }

  return rows;
}
