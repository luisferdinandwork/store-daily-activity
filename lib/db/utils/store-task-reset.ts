// lib/db/utils/store-task-reset.ts
//
// IT "Reset today's tasks" for one store (Store Management). Removes the day's
// TASK data — store opening / front, setoran (+ its ledger row), cek bin, VM,
// marketing, cek uang modal, briefing, serah terima (the day's completion row;
// the handover board itself stays), store closing (+ EDC figures), grooming and
// the day's cash counts — together with their photos in object storage.
// Attendance (check-in/out, breaks), schedules and everything dated another day
// are never touched, so staff stay checked in and the tasks start from zero.
// Child rows (bins, denominations, ledger, EDC cells) go by ON DELETE CASCADE.

import { and, eq, gte, lt } from 'drizzle-orm';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import {
  briefingTasks,
  cekBinTasks,
  cekUangModalTasks,
  groomingTasks,
  marketingCheckTasks,
  serahTerimaTasks,
  setoranTasks,
  storeCashCounts,
  storeClosingTasks,
  storeFrontTasks,
  storeOpeningTasks,
  stores,
  vmChecklistTasks,
} from '@/lib/db/schema';
import { jakartaDayRange, jakartaTodayKey } from '@/lib/day-bucket';
import { collectStoreDayImageUrls, deleteManagedImages } from '@/lib/db/utils/task-image-cleanup';

type DayTable = PgTable & {
  storeId: typeof storeOpeningTasks.storeId;
  date: typeof storeOpeningTasks.date;
  id: typeof storeOpeningTasks.id;
};

const DAY_TABLES: DayTable[] = [
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  vmChecklistTasks,
  marketingCheckTasks,
  cekUangModalTasks,
  briefingTasks,
  serahTerimaTasks,
  storeClosingTasks,
  groomingTasks,
  storeCashCounts,
] as unknown as DayTable[];

export interface StoreTaskResetSummary {
  storeNo: string;
  storeName: string;
  /** Jakarta calendar day that was reset, YYYY-MM-DD. */
  day: string;
  /** Rows removed per table (only tables that had any). */
  removed: Record<string, number>;
  totalRemoved: number;
  photos: number;
}

export type StoreTaskResetResult =
  | { success: true; data: StoreTaskResetSummary }
  | { success: false; error: string; status: 404 };

export async function resetStoreTodayTasks(storeId: number): Promise<StoreTaskResetResult> {
  const [store] = await db
    .select({ storeNo: stores.storeNo, name: stores.name })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  if (!store) return { success: false, error: 'Store not found.', status: 404 };

  const day = jakartaTodayKey();
  const { start, end } = jakartaDayRange(day);

  // Photos are read before their rows go; removed from storage after the commit.
  const photoUrls = await collectStoreDayImageUrls(storeId, start, end);

  const removed: Record<string, number> = {};
  await db.transaction(async (tx) => {
    for (const table of DAY_TABLES) {
      const rows = await tx
        .delete(table)
        .where(and(eq(table.storeId, storeId), gte(table.date, start), lt(table.date, end)))
        .returning({ id: table.id });
      if (rows.length) removed[getTableName(table)] = rows.length;
    }
  });

  if (photoUrls.length) {
    try {
      await deleteManagedImages(photoUrls);
    } catch (err) {
      console.error(`[store-task-reset] ${photoUrls.length} photos could not be removed from storage:`, err);
    }
  }

  return {
    success: true,
    data: {
      storeNo: store.storeNo,
      storeName: store.name,
      day,
      removed,
      totalRemoved: Object.values(removed).reduce((a, b) => a + b, 0),
      photos: photoUrls.length,
    },
  };
}
