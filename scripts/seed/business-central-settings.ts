// scripts/seed/business-central-settings.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { db } from '@/lib/db';
import { businessCentralSettings } from '@/lib/db/schema';

// The BC address is never written in code (the repo is shared) — it comes from `.env.local` only:
// each feed's own *_URL, or else BC_COMPANY_BASE_URL (`…/companies(<guid>)`) + the entity below.
const BC_COMPANY_BASE = (process.env.BC_COMPANY_BASE_URL ?? '').trim().replace(/\/+$/, '');

const salesEntriesUrl =
  process.env.BC_SALES_ENTRIES_URL ??
  `${BC_COMPANY_BASE}/ppQueryTransSalesEntries?$schemaversion=2.0`;

// Item Return / Item Dropping pipeline — same BC company, same credentials.
const transferOrdersUrl =
  process.env.BC_TRANSFER_ORDERS_URL ??
  `${BC_COMPANY_BASE}/ppQueryTransferOrders?$schemaversion=2.0`;

const whseShipmentsUrl =
  process.env.BC_WHSE_SHIPMENTS_URL ??
  `${BC_COMPANY_BASE}/ppQueryPostedWhseShipments?$schemaversion=2.0&$filter=startswith(transferOrderNo,%20%27TOA%27)`;

const whseReceiptsUrl =
  process.env.BC_WHSE_RECEIPTS_URL ??
  `${BC_COMPANY_BASE}/ppQueryPostedWhseReceipts?$schemaversion=2.0&$filter=startswith(sourceNo,%20'TOA')`;

const username = process.env.BC_API_USERNAME ?? process.env.BC_USERNAME ?? '';
const password = process.env.BC_API_PASSWORD ?? process.env.BC_PASSWORD ?? '';

const SETTINGS: Array<{ code: string; name: string; apiUrl: string }> = [
  { code: 'sales_entries',    name: 'Business Central Sales Entries',       apiUrl: salesEntriesUrl },
  { code: 'transfer_orders',  name: 'BC Transfer Orders (Item Return)',     apiUrl: transferOrdersUrl },
  { code: 'whse_shipments',   name: 'BC Posted Whse Shipments (Item Dropping)', apiUrl: whseShipmentsUrl },
  { code: 'whse_receipts',    name: 'BC Posted Whse Receipts (Item Receiving)', apiUrl: whseReceiptsUrl },
];

export async function seedBusinessCentralSettings() {
  if (!username || !password) {
    throw new Error(
      'Missing BC credentials. Set BC_API_USERNAME and BC_API_PASSWORD in .env.local first.',
    );
  }
  const missing = SETTINGS.filter((s) => !/^https?:\/\/[^/]/.test(s.apiUrl)).map((s) => s.code);
  if (missing.length > 0) {
    throw new Error(
      `Missing BC URL for ${missing.join(', ')}. Set BC_COMPANY_BASE_URL (or each BC_*_URL) in .env.local first.`,
    );
  }

  await db.delete(businessCentralSettings);

  await db.insert(businessCentralSettings).values(
    SETTINGS.map((s) => ({
      code: s.code,
      name: s.name,
      apiUrl: s.apiUrl,
      username,
      password,
      authType: 'basic' as const,
      isActive: true,
    })),
  );

  console.log(`✅ Business Central settings seeded from env into DB (${SETTINGS.length} rows).`);
}
