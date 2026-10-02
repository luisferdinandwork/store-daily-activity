// lib/db/utils/store-deletion.ts
//
// IT "Delete store" — permanent. The store row and everything that belongs to
// it go: schedules, attendance, every task row, petty cash, setoran, targets,
// issues, visits, item transfers it was part of, status history. Employees
// whose home store it was keep their account and simply end up with no store.
//
// A store is only deletable once it is not `active` (close it first, or delete
// a ready_to_open store that was created by mistake).
//
// Rather than hand-list the ~40 tables, the delete walks the foreign-key graph:
// for each table that points at a doomed row it first deletes the rows pointing
// at those, then the rows themselves (deepest first). Foreign keys that must
// NOT cascade are the two that point back at a store from user data
// (users.home_store_id, user_store_assignments.previous_store_id) — those are
// set to NULL. Everything runs in one transaction, and the preview runs the
// same steps and rolls back so the dialog shows exactly what will happen.
//
// Photos in object storage are collected before the delete and removed after
// it commits (best effort — a storage failure never undoes the delete).

import { eq, sql, TransactionRollbackError, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { collectStoreImageUrls, deleteManagedImages } from '@/lib/db/utils/task-image-cleanup';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ForeignKey {
  table: string;
  column: string;
  parent: string;
  parentColumn: string;
  nullable: boolean;
}

export interface StoreRecordCount {
  table: string;
  label: string;
  count: number;
}

export interface StoreDeletionSummary {
  storeNo: string;
  storeName: string;
  /** Rows removed together with the store, biggest first. */
  removed: StoreRecordCount[];
  totalRemoved: number;
  /** Employees whose home store becomes "no store". */
  unassignedEmployees: number;
  /** Uploaded photos that get deleted from object storage. */
  photos: number;
}

export type StoreDeletionResult =
  | { success: true; data: StoreDeletionSummary }
  | { success: false; error: string; status: 400 | 404 };

const LABELS: Record<string, string> = {
  schedules: 'working days',
  monthly_schedules: 'monthly schedules',
  monthly_schedule_entries: 'schedule entries',
  attendance: 'attendance records',
  break_sessions: 'break sessions',
  user_store_assignments: 'store assignment history',
  store_status_history: 'status history',
  petty_cash_transactions: 'petty cash transactions',
  petty_cash_periods: 'petty cash periods',
  petty_cash_refills: 'petty cash refills',
  petty_cash_refill_requests: 'petty cash refill requests',
  setoran_tasks: 'setoran tasks',
  setoran_money_storage: 'setoran money storage',
  setoran_corrections: 'setoran corrections',
  store_cash_counts: 'store cash counts',
  store_monthly_targets: 'monthly targets',
  employee_monthly_targets: 'employee target shares',
  item_transfer_orders: 'item transfer orders',
  impact_visits: 'impact visits',
  issues: 'issues',
  store_bins: 'bins',
};

const label = (table: string) => LABELS[table] ?? table.replace(/_/g, ' ');

function extractRows<T>(result: unknown): T[] {
  const withRows = result as { rows?: unknown[] };
  return Array.isArray(withRows.rows) ? (withRows.rows as T[]) : (result as unknown as T[]);
}

function affected(result: unknown): number {
  return Number((result as { rowCount?: number | null }).rowCount ?? 0);
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, '""')}"`);

/** Every single-column FK in `public`, with the column it references. */
async function loadForeignKeys(tx: Tx): Promise<ForeignKey[]> {
  const result = await tx.execute(sql`
    SELECT src.relname AS "table", col.attname AS "column",
           tgt.relname AS "parent", pcol.attname AS "parentColumn",
           NOT col.attnotnull AS "nullable"
    FROM pg_constraint con
    JOIN pg_class src       ON src.oid = con.conrelid
    JOIN pg_class tgt       ON tgt.oid = con.confrelid
    JOIN pg_namespace ns    ON ns.oid = src.relnamespace
    JOIN pg_attribute col   ON col.attrelid = con.conrelid  AND col.attnum  = con.conkey[1]
    JOIN pg_attribute pcol  ON pcol.attrelid = con.confrelid AND pcol.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND ns.nspname = 'public' AND array_length(con.conkey, 1) = 1
  `);
  return extractRows<ForeignKey>(result);
}

// Pointers from user data back at a store: cleared, never followed.
const KEEP_ROW_COLUMNS = new Set(['users.home_store_id', 'user_store_assignments.previous_store_id']);

async function purge(
  tx: Tx,
  fks: ForeignKey[],
  table: string,
  cond: SQL,
  path: string[],
  counts: Map<string, number>,
) {
  for (const fk of fks) {
    if (fk.parent !== table || fk.table === table) continue;
    if (table === 'stores' && KEEP_ROW_COLUMNS.has(`${fk.table}.${fk.column}`)) continue;

    const childCond = sql`${ident(fk.column)} IN (SELECT ${ident(fk.parentColumn)} FROM ${ident(table)} WHERE ${cond})`;

    if (path.includes(fk.table)) {
      // Cycle back into a table we're already deleting from — unlink instead.
      if (fk.nullable) await tx.execute(sql`UPDATE ${ident(fk.table)} SET ${ident(fk.column)} = NULL WHERE ${childCond}`);
      continue;
    }
    await purge(tx, fks, fk.table, childCond, [...path, table], counts);
  }

  const result = await tx.execute(sql`DELETE FROM ${ident(table)} WHERE ${cond}`);
  const n = affected(result);
  if (n > 0) counts.set(table, (counts.get(table) ?? 0) + n);
}

type Outcome =
  | { ok: false; error: string; status: 400 | 404 }
  | {
      ok: true;
      store: { id: number; storeNo: string; name: string };
      removed: StoreRecordCount[];
      unassigned: number;
    };

/** Exported for tests that run it inside a rolled-back transaction. */
export async function deleteWithin(tx: Tx, storeId: number): Promise<Outcome> {
  // Row lock so nothing records against the store while it is being removed.
  const [store] = await tx
    .select({ id: stores.id, storeNo: stores.storeNo, name: stores.name, status: stores.status })
    .from(stores)
    .where(eq(stores.id, storeId))
    .for('update');
  if (!store) return { ok: false, error: 'Store not found.', status: 404 };
  if (store.status === 'active') {
    return {
      ok: false,
      error: 'An active store can\'t be deleted. Close it first (Change status → Close), then delete it.',
      status: 400,
    };
  }

  // Employees: no store (and an in-progress role preview must not restore a dead id).
  const unassigned = affected(
    await tx.execute(sql`UPDATE users SET home_store_id = NULL, updated_at = now() WHERE home_store_id = ${storeId}`),
  );
  await tx.execute(sql`
    UPDATE users
    SET switch_context = jsonb_set(switch_context, '{originalHomeStoreId}', 'null'::jsonb)
    WHERE switch_context IS NOT NULL AND (switch_context->>'originalHomeStoreId') = ${String(storeId)}`);
  await tx.execute(sql`UPDATE user_store_assignments SET previous_store_id = NULL WHERE previous_store_id = ${storeId}`);

  const fks = await loadForeignKeys(tx);
  const counts = new Map<string, number>();
  await purge(tx, fks, 'stores', sql`"id" = ${storeId}`, [], counts);

  counts.delete('stores');

  const removed = [...counts].map(([table, count]) => ({ table, label: label(table), count }));
  removed.sort((a, b) => b.count - a.count);

  return { ok: true, store, removed, unassigned };
}

/** What deleting this store would do — the real steps, rolled back. */
export async function previewStoreDeletion(storeId: number): Promise<StoreDeletionResult> {
  const box: { out?: Outcome } = {};
  try {
    await db.transaction(async (tx) => {
      box.out = await deleteWithin(tx, storeId);
      tx.rollback();
    });
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err;
  }
  const out = box.out;
  if (!out) return { success: false, error: 'Store not found.', status: 404 };
  if (!out.ok) return { success: false, error: out.error, status: out.status };

  const photos = (await collectStoreImageUrls(storeId)).length;
  return {
    success: true,
    data: {
      storeNo: out.store.storeNo,
      storeName: out.store.name,
      removed: out.removed,
      totalRemoved: out.removed.reduce((sum, r) => sum + r.count, 0),
      unassignedEmployees: out.unassigned,
      photos,
    },
  };
}

export async function deleteStore(params: {
  storeId: number;
  /** Must equal the store code — the dialog makes IT type it. */
  confirmStoreNo: string;
}): Promise<StoreDeletionResult> {
  const [row] = await db.select({ storeNo: stores.storeNo }).from(stores).where(eq(stores.id, params.storeId)).limit(1);
  if (!row) return { success: false, error: 'Store not found.', status: 404 };
  if (params.confirmStoreNo.trim().toUpperCase() !== row.storeNo.toUpperCase()) {
    return { success: false, error: `Type the store code (${row.storeNo}) to confirm.`, status: 400 };
  }

  // Photo URLs have to be read before the rows holding them are gone.
  const photoUrls = await collectStoreImageUrls(params.storeId);

  const out = await db.transaction((tx) => deleteWithin(tx, params.storeId));
  if (!out.ok) return { success: false, error: out.error, status: out.status };

  if (photoUrls.length > 0) {
    try {
      await deleteManagedImages(photoUrls);
    } catch (err) {
      console.error(`[store-deletion] ${row.storeNo}: store deleted but ${photoUrls.length} photos could not be removed from storage:`, err);
    }
  }

  return {
    success: true,
    data: {
      storeNo: out.store.storeNo,
      storeName: out.store.name,
      removed: out.removed,
      totalRemoved: out.removed.reduce((sum, r) => sum + r.count, 0),
      unassignedEmployees: out.unassigned,
      photos: photoUrls.length,
    },
  };
}
