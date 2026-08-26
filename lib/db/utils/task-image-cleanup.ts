// lib/db/utils/task-image-cleanup.ts
//
// Deletes task checklist photos older than the retention window from
// Alibaba Cloud OSS, then clears the DB columns that referenced them. Driven
// from the DB side (not a bucket list()) so we know exactly which row/column
// to null once the corresponding object is gone — never leaves a DB
// reference pointing at a deleted file.
//
// Scope: task checklist photos only. Petty cash receipts and issue-report
// attachments are NOT covered — not touched here.

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { deleteFromOss, isOssUrl } from '@/lib/oss';

export const IMAGE_RETENTION_DAYS = 60;

interface SimpleTarget {
  table: string;
  dateColumn: string;
  photoColumns: string[];
}

interface JoinedTarget {
  childTable: string;
  parentTable: string;
  parentDateColumn: string;
  fkColumn: string;
  photoColumn: string;
}

// Tables with their own `date` column and one or more photo columns
// (JSON-array-in-text or a single URL string — parsePhotoUrls handles both).
const SIMPLE_TARGETS: SimpleTarget[] = [
  {
    table: 'store_opening_tasks',
    dateColumn: 'date',
    photoColumns: [
      'five_r_area_kasir_photos',
      'five_r_area_depan_photos',
      'five_r_area_kanan_photos',
      'five_r_area_kiri_photos',
      'five_r_area_gudang_photos',
      'cash_drawer_photos',
    ],
  },
  { table: 'store_front_tasks', dateColumn: 'date', photoColumns: ['storefront_photos', 'rolling_door_closed_photo'] },
  { table: 'setoran_tasks', dateColumn: 'date', photoColumns: ['resi_photo', 'atm_card_selfie_photo'] },
  { table: 'setoran_money_storage', dateColumn: 'date', photoColumns: ['resi_photo', 'atm_card_selfie_photo'] },
  { table: 'store_closing_tasks', dateColumn: 'date', photoColumns: ['eod_edc_settlement_photo'] },
  { table: 'grooming_tasks', dateColumn: 'date', photoColumns: ['selfie_photos'] },
];

// Child (entries) tables — no date of their own, filtered via the parent task's date.
const JOINED_TARGETS: JoinedTarget[] = [
  {
    childTable: 'item_dropping_entries',
    parentTable: 'item_dropping_tasks',
    parentDateColumn: 'date',
    fkColumn: 'task_id',
    photoColumn: 'dropping_photos',
  },
  {
    childTable: 'item_return_entries',
    parentTable: 'item_return_tasks',
    parentDateColumn: 'date',
    fkColumn: 'task_id',
    photoColumn: 'return_photos',
  },
];

function parsePhotoUrls(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
  return [trimmed];
}

function extractRows<T>(result: unknown): T[] {
  const withRows = result as { rows?: unknown[] };
  return Array.isArray(withRows.rows) ? (withRows.rows as T[]) : (result as unknown as T[]);
}

const ident = (name: string) => sql.raw(`"${name}"`);

export interface CleanupSummary {
  dryRun: boolean;
  retentionDays: number;
  cutoff: string;
  rowsCleared: number;
  objectsDeleted: number;
  /** Per-table match counts, always populated (even in dry-run) so the join logic is verifiable. */
  matchesByTable: Record<string, number>;
  /** A few sample rows per table (dry-run only) so you can spot-check the join found the right thing. */
  sample: Array<{ table: string; id: unknown; urls: string[] }>;
  errors: string[];
}

export interface CleanupOptions {
  retentionDays?: number;
  /** Report what would be deleted without calling OSS delete or touching the DB. */
  dryRun?: boolean;
}

export async function cleanupOldTaskImages(options: CleanupOptions = {}): Promise<CleanupSummary> {
  const { retentionDays = IMAGE_RETENTION_DAYS, dryRun = false } = options;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const summary: CleanupSummary = {
    dryRun,
    retentionDays,
    cutoff: cutoff.toISOString(),
    rowsCleared: 0,
    objectsDeleted: 0,
    matchesByTable: {},
    sample: [],
    errors: [],
  };
  const allUrls: string[] = [];
  const pendingUpdates: Array<() => Promise<void>> = [];

  for (const target of SIMPLE_TARGETS) {
    try {
      const columnList = sql.join(target.photoColumns.map(ident), sql`, `);
      const notNullClause = sql.join(
        target.photoColumns.map((c) => sql`${ident(c)} IS NOT NULL`),
        sql` OR `,
      );

      const result = await db.execute(sql`
        SELECT id, ${columnList}
        FROM ${ident(target.table)}
        WHERE ${ident(target.dateColumn)} < ${cutoff} AND (${notNullClause})
      `);

      for (const row of extractRows<Record<string, unknown>>(result)) {
        const urls = target.photoColumns.flatMap((c) => parsePhotoUrls(row[c])).filter(isOssUrl);
        if (!urls.length) continue;

        summary.matchesByTable[target.table] = (summary.matchesByTable[target.table] ?? 0) + 1;
        if (dryRun && summary.sample.length < 20) {
          summary.sample.push({ table: target.table, id: row.id, urls });
        }

        allUrls.push(...urls);
        const rowId = row.id;
        pendingUpdates.push(async () => {
          const setClause = sql.join(
            target.photoColumns.map((c) => sql`${ident(c)} = NULL`),
            sql`, `,
          );
          await db.execute(sql`UPDATE ${ident(target.table)} SET ${setClause} WHERE id = ${rowId}`);
          summary.rowsCleared += 1;
        });
      }
    } catch (err) {
      summary.errors.push(`${target.table}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const target of JOINED_TARGETS) {
    try {
      const result = await db.execute(sql`
        SELECT c.id AS id, c.${ident(target.photoColumn)} AS photo
        FROM ${ident(target.childTable)} c
        JOIN ${ident(target.parentTable)} p ON p.id = c.${ident(target.fkColumn)}
        WHERE p.${ident(target.parentDateColumn)} < ${cutoff} AND c.${ident(target.photoColumn)} IS NOT NULL
      `);

      for (const row of extractRows<Record<string, unknown>>(result)) {
        const urls = parsePhotoUrls(row.photo).filter(isOssUrl);
        if (!urls.length) continue;

        summary.matchesByTable[target.childTable] = (summary.matchesByTable[target.childTable] ?? 0) + 1;
        if (dryRun && summary.sample.length < 20) {
          summary.sample.push({ table: target.childTable, id: row.id, urls });
        }

        allUrls.push(...urls);
        const rowId = row.id;
        pendingUpdates.push(async () => {
          await db.execute(sql`UPDATE ${ident(target.childTable)} SET ${ident(target.photoColumn)} = NULL WHERE id = ${rowId}`);
          summary.rowsCleared += 1;
        });
      }
    } catch (err) {
      summary.errors.push(`${target.childTable}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (allUrls.length === 0) return summary;

  if (dryRun) {
    // Report what would be deleted — no OSS call, no DB writes.
    summary.objectsDeleted = allUrls.length;
    return summary;
  }

  try {
    await deleteFromOss(allUrls);
    summary.objectsDeleted = allUrls.length;
  } catch (err) {
    // Don't null any DB reference unless we're sure the object is actually gone.
    summary.errors.push(`OSS delete failed, aborting DB cleanup this run: ${err instanceof Error ? err.message : String(err)}`);
    return summary;
  }

  for (const update of pendingUpdates) {
    try {
      await update();
    } catch (err) {
      summary.errors.push(`DB update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return summary;
}
