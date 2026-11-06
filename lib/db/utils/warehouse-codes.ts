// lib/db/utils/warehouse-codes.ts
// Data for the IT Warehouse Codes page: the listed codes, the automatic "DM…" ones
// seen on transfer orders, and codes seen on orders that are neither a store nor a
// warehouse yet ("belum dikenal"). The rule itself lives in isWarehouseCode()
// (lib/db/utils/item-transfers.ts).

import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stores, warehouseCodes } from '@/lib/db/schema';
import {
  ensureWarehouseCodes,
  isWarehouseCode,
  unlinkWarehouseCodeFromStores,
} from '@/lib/db/utils/item-transfers';
import type { UnknownCodeRow, WarehouseCodeRow } from '@/lib/warehouse-codes';

/** Every code on a transfer order (either end) with how many orders touch it. */
async function seenCodes(): Promise<Map<string, number>> {
  const rows = await db.execute<{ code: string; n: number }>(sql`
    SELECT code, count(*)::int AS n FROM (
      SELECT upper(trim(transfer_from_code)) AS code FROM item_transfer_orders
      UNION ALL
      SELECT upper(trim(transfer_to_code)) AS code FROM item_transfer_orders
    ) t
    WHERE code <> ''
    GROUP BY code
  `);
  return new Map(rows.rows.map((r) => [r.code, Number(r.n)]));
}

export async function getWarehouseCodeOverview(): Promise<{ warehouses: WarehouseCodeRow[]; unknown: UnknownCodeRow[] }> {
  await ensureWarehouseCodes(true);
  const [listed, seen, storeRows] = await Promise.all([
    db.select().from(warehouseCodes).orderBy(asc(warehouseCodes.code)),
    seenCodes(),
    db.select({ storeNo: stores.storeNo }).from(stores),
  ]);

  const warehouses: WarehouseCodeRow[] = listed.map((l) => ({
    id: l.id,
    code: l.code,
    name: l.name,
    source: 'listed',
    orderCount: seen.get(l.code.toUpperCase()) ?? 0,
  }));
  const listedSet = new Set(listed.map((l) => l.code.toUpperCase()));

  const unknown: UnknownCodeRow[] = [];
  const storeCodes = new Set(storeRows.map((s) => s.storeNo.trim().toUpperCase()));
  for (const [code, n] of seen) {
    if (listedSet.has(code)) continue;
    if (isWarehouseCode(code)) {
      warehouses.push({ id: null, code, name: null, source: 'dm', orderCount: n });
    } else if (!storeCodes.has(code)) {
      unknown.push({ code, orderCount: n });
    }
  }
  warehouses.sort((a, b) => a.code.localeCompare(b.code));
  unknown.sort((a, b) => b.orderCount - a.orderCount || a.code.localeCompare(b.code));
  return { warehouses, unknown };
}

export async function addWarehouseCode(
  code: string,
  name: string | null,
  userId: string,
): Promise<{ success: true; unlinked: number } | { success: false; error: string }> {
  const [existing] = await db.select({ id: warehouseCodes.id }).from(warehouseCodes).where(eq(warehouseCodes.code, code)).limit(1);
  if (existing) return { success: false, error: `Kode ${code} sudah ada di daftar.` };
  await db.insert(warehouseCodes).values({ code, name, createdBy: userId });
  await ensureWarehouseCodes(true);
  const unlinked = await unlinkWarehouseCodeFromStores(code);
  return { success: true, unlinked };
}

export async function updateWarehouseName(id: number, name: string | null): Promise<boolean> {
  const rows = await db.update(warehouseCodes).set({ name }).where(eq(warehouseCodes.id, id)).returning({ id: warehouseCodes.id });
  return rows.length > 0;
}

export async function removeWarehouseCode(id: number): Promise<boolean> {
  const rows = await db.delete(warehouseCodes).where(eq(warehouseCodes.id, id)).returning({ id: warehouseCodes.id });
  await ensureWarehouseCodes(true);
  return rows.length > 0;
}
