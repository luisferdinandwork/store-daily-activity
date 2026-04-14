// lib/db/utils/edc-reconciliation.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated utilities for the EDC Reconciliation task (merges old EDC Summary
// + EDC Settlement into one).
//
// Lifecycle:
//   1. Task is materialised with status 'pending'.
//   2. On first open, front-end calls fetchExpectedForTask() to populate the
//      expectedSnapshot (idempotent — subsequent fetches return the stored
//      snapshot unchanged, so dummy randomness stays stable).
//   3. Employee adds transaction rows via addRow / updates via updateRow /
//      removes via deleteRow. Each row carries its own expected values copied
//      from the snapshot when added.
//   4. submitEdcReconciliation() compares every row against the snapshot,
//      sets `matches` per row, and:
//        • All rows match AND all expected types are covered →
//          status 'completed', isBalanced=true
//        • Otherwise → status 'discrepancy', isBalanced=false,
//          discrepancyStartedAt = now (if not already set)
//   5. Next shift opens the same task (via parentTaskId lookup) and fixes
//      rows. On a successful re-submit, discrepancyResolvedAt and
//      discrepancyDurationMinutes are stamped.
//
// Access rules:
//   • Employee must be checked in.
//   • Employee must be inside the store geofence (unless skipGeo).
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import {
  edcReconciliationTasks, edcTransactionRows,
  stores, shifts, attendance,
  type EdcReconciliationTask, type EdcTransactionRow,
} from '@/lib/db/schema';
import {
  generateExpectedEdcData,
  parseExpectedSnapshot,
  rowMatches,
  type ExpectedEdcSnapshot,
  type TxType,
} from './dummy-evening-data';

// ─── Public types ─────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export interface AddRowInput {
  taskId:          number;
  transactionType: TxType;
  actualAmount:    string;     // numeric string
  actualCount:     number;
  notes?:          string;
}

export interface UpdateRowInput {
  rowId:          number;
  transactionType?: TxType;
  actualAmount?:    string;
  actualCount?:     number;
  notes?:           string;
}

export interface SubmitEdcReconciliationInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  skipGeo?:   boolean;
  notes?:     string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay  (d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

let _eveningShiftIdCache: number | null = null;
async function getEveningShiftId(): Promise<number> {
  if (_eveningShiftIdCache != null) return _eveningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'evening')).limit(1);
  if (!row) throw new Error('Evening shift not found in shifts table.');
  _eveningShiftIdCache = row.id;
  return row.id;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);
  if (!att?.checkInTime)
    return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  return null;
}

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                   return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }
  return null;
}

// ─── Active task query (discrepancy-aware) ───────────────────────────────────

export async function getActiveEdcReconciliationTask(
  storeId: number,
  date:    Date,
): Promise<EdcReconciliationTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [today] = await db
    .select()
    .from(edcReconciliationTasks)
    .where(and(
      eq(edcReconciliationTasks.storeId, storeId),
      gte(edcReconciliationTasks.date, dayStart),
      lte(edcReconciliationTasks.date, dayEnd),
      inArray(edcReconciliationTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .orderBy(edcReconciliationTasks.createdAt)
    .limit(1);

  if (today) return today;

  // Surface an unresolved discrepancy from a prior day
  const [prior] = await db
    .select()
    .from(edcReconciliationTasks)
    .where(and(
      eq(edcReconciliationTasks.storeId, storeId),
      eq(edcReconciliationTasks.status, 'discrepancy'),
      isNull(edcReconciliationTasks.parentTaskId),
    ))
    .orderBy(edcReconciliationTasks.createdAt)
    .limit(1);

  return prior ?? null;
}

// ─── Expected data fetch (idempotent) ────────────────────────────────────────

/**
 * Ensure the task has an expectedSnapshot. If one already exists in the DB,
 * return it unchanged (so the dummy randomness stays stable across re-opens).
 * Otherwise generate a fresh snapshot, store it, and return it.
 */
export async function fetchExpectedForTask(
  taskId: number,
): Promise<TaskResult<ExpectedEdcSnapshot>> {
  try {
    const [task] = await db
      .select()
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.id, taskId))
      .limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };

    const existing = parseExpectedSnapshot(task.expectedSnapshot);
    if (existing) return { success: true, data: existing };

    const snapshot = generateExpectedEdcData(task.storeId, task.date, task.id);

    await db
      .update(edcReconciliationTasks)
      .set({
        expectedSnapshot:  JSON.stringify(snapshot),
        expectedFetchedAt: new Date(),
        updatedAt:         new Date(),
      })
      .where(eq(edcReconciliationTasks.id, taskId));

    return { success: true, data: snapshot };
  } catch (err) {
    return { success: false, error: `fetchExpectedForTask: ${err}` };
  }
}

// ─── Row CRUD ────────────────────────────────────────────────────────────────

export async function listRowsForTask(taskId: number): Promise<EdcTransactionRow[]> {
  return db
    .select()
    .from(edcTransactionRows)
    .where(eq(edcTransactionRows.edcTaskId, taskId))
    .orderBy(edcTransactionRows.createdAt);
}

export async function addRow(input: AddRowInput): Promise<TaskResult<EdcTransactionRow>> {
  try {
    const [task] = await db
      .select({
        id: edcReconciliationTasks.id,
        status: edcReconciliationTasks.status,
        expectedSnapshot: edcReconciliationTasks.expectedSnapshot,
      })
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.id, input.taskId))
      .limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (['completed', 'verified', 'rejected'].includes(task.status ?? ''))
      return { success: false, error: 'Task sudah final, tidak bisa menambah row.' };

    // Pull expected from the snapshot for this transaction type (best-effort)
    const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
    const exp      = snapshot?.rows.find(r => r.transactionType === input.transactionType);

    const [row] = await db
      .insert(edcTransactionRows)
      .values({
        edcTaskId:       input.taskId,
        transactionType: input.transactionType,
        expectedAmount:  exp ? String(exp.expectedAmount) : null,
        expectedCount:   exp ? exp.expectedCount : null,
        actualAmount:    input.actualAmount,
        actualCount:     input.actualCount,
        matches:         null,   // computed at submit
        notes:           input.notes,
      })
      .returning();

    // Promote task to in_progress on first row
    if (task.status === 'pending') {
      await db
        .update(edcReconciliationTasks)
        .set({ status: 'in_progress', updatedAt: new Date() })
        .where(eq(edcReconciliationTasks.id, input.taskId));
    }

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `addRow: ${err}` };
  }
}

export async function updateRow(input: UpdateRowInput): Promise<TaskResult<EdcTransactionRow>> {
  try {
    const [existing] = await db
      .select()
      .from(edcTransactionRows)
      .where(eq(edcTransactionRows.id, input.rowId))
      .limit(1);
    if (!existing) return { success: false, error: 'Row tidak ditemukan.' };

    // Check parent task isn't final
    const [task] = await db
      .select({ status: edcReconciliationTasks.status, expectedSnapshot: edcReconciliationTasks.expectedSnapshot })
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.id, existing.edcTaskId))
      .limit(1);
    if (!task) return { success: false, error: 'Parent task tidak ditemukan.' };
    if (['completed', 'verified', 'rejected'].includes(task.status ?? ''))
      return { success: false, error: 'Task sudah final, tidak bisa mengubah row.' };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if ('transactionType' in input && input.transactionType) {
      patch.transactionType = input.transactionType;
      // Refresh expected snapshot values for the new type
      const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
      const exp      = snapshot?.rows.find(r => r.transactionType === input.transactionType);
      patch.expectedAmount = exp ? String(exp.expectedAmount) : null;
      patch.expectedCount  = exp ? exp.expectedCount : null;
    }
    if ('actualAmount' in input && input.actualAmount != null) patch.actualAmount = input.actualAmount;
    if ('actualCount'  in input && input.actualCount  != null) patch.actualCount  = input.actualCount;
    if ('notes'        in input)                              patch.notes        = input.notes;

    const [row] = await db
      .update(edcTransactionRows)
      .set(patch)
      .where(eq(edcTransactionRows.id, input.rowId))
      .returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `updateRow: ${err}` };
  }
}

export async function deleteRow(rowId: number): Promise<TaskResult<void>> {
  try {
    const [existing] = await db
      .select({ edcTaskId: edcTransactionRows.edcTaskId })
      .from(edcTransactionRows)
      .where(eq(edcTransactionRows.id, rowId))
      .limit(1);
    if (!existing) return { success: false, error: 'Row tidak ditemukan.' };

    const [task] = await db
      .select({ status: edcReconciliationTasks.status })
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.id, existing.edcTaskId))
      .limit(1);
    if (['completed', 'verified', 'rejected'].includes(task?.status ?? ''))
      return { success: false, error: 'Task sudah final, tidak bisa menghapus row.' };

    await db.delete(edcTransactionRows).where(eq(edcTransactionRows.id, rowId));
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `deleteRow: ${err}` };
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * Compare all rows against the expected snapshot, set `matches` per row,
 * and transition the parent task to 'completed' (all match) or 'discrepancy'
 * (any mismatch or missing expected type).
 *
 * Also handles discrepancy timing:
 *   • First transition to discrepancy → discrepancyStartedAt = now
 *   • discrepancy → completed         → discrepancyResolvedAt = now,
 *                                       discrepancyDurationMinutes computed
 */
export async function submitEdcReconciliation(
  input: SubmitEdcReconciliationInput,
): Promise<TaskResult<EdcReconciliationTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [task] = await db
      .select()
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.scheduleId, input.scheduleId))
      .limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan untuk schedule ini.' };
    if (['completed', 'verified', 'rejected'].includes(task.status ?? ''))
      return { success: false, error: 'Task sudah final.' };

    const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
    if (!snapshot)
      return { success: false, error: 'Expected data belum di-fetch. Buka task ulang untuk fetch.' };

    const rows = await listRowsForTask(task.id);
    if (rows.length === 0)
      return { success: false, error: 'Belum ada transaksi yang diinput.' };

    // Compute per-row matches and persist
    const expectedByType = new Map(snapshot.rows.map(r => [r.transactionType, r]));
    let allMatch = true;

    for (const row of rows) {
      const exp = expectedByType.get(row.transactionType);
      const matches = rowMatches(
        exp ? { expectedAmount: exp.expectedAmount, expectedCount: exp.expectedCount } : undefined,
        row,
      );
      if (!matches) allMatch = false;

      await db
        .update(edcTransactionRows)
        .set({ matches, updatedAt: new Date() })
        .where(eq(edcTransactionRows.id, row.id));
    }

    // Also require every expected type to have at least one row entered —
    // if the expected data lists credit + debit + qris but the employee only
    // entered credit + debit, that's still a discrepancy.
    const enteredTypes = new Set(rows.map(r => r.transactionType));
    for (const exp of snapshot.rows) {
      if (!enteredTypes.has(exp.transactionType)) {
        allMatch = false;
        break;
      }
    }

    const now       = new Date();
    const eveningId = await getEveningShiftId();

    const isBalanced = allMatch;
    const newStatus  = isBalanced ? 'completed' as const : 'discrepancy' as const;

    // Discrepancy timing
    let discrepancyStartedAt       = task.discrepancyStartedAt;
    let discrepancyResolvedAt      = task.discrepancyResolvedAt;
    let discrepancyDurationMinutes = task.discrepancyDurationMinutes;

    if (!isBalanced && !discrepancyStartedAt) {
      discrepancyStartedAt = now;
    }
    if (isBalanced && discrepancyStartedAt && !discrepancyResolvedAt) {
      discrepancyResolvedAt      = now;
      discrepancyDurationMinutes = Math.max(0,
        Math.round((now.getTime() - new Date(discrepancyStartedAt).getTime()) / 60_000));
    }

    const [updated] = await db
      .update(edcReconciliationTasks)
      .set({
        scheduleId:                 input.scheduleId,
        userId:                     input.userId,
        storeId:                    input.storeId,
        shiftId:                    eveningId,
        isBalanced,
        status:                     newStatus,
        discrepancyStartedAt,
        discrepancyResolvedAt,
        discrepancyDurationMinutes,
        submittedLat:               String(input.geo.lat),
        submittedLng:               String(input.geo.lng),
        notes:                      input.notes,
        completedAt:                isBalanced ? now : null,
        updatedAt:                  now,
      })
      .where(eq(edcReconciliationTasks.id, task.id))
      .returning();

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitEdcReconciliation: ${err}` };
  }
}

// ─── Auto-save (top-level fields only; row CRUD is explicit) ─────────────────

export interface AutoSaveEdcReconciliationPatch {
  notes?: string;
}

export async function autoSaveEdcReconciliation(
  scheduleId: number,
  patch:      AutoSaveEdcReconciliationPatch,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({ id: edcReconciliationTasks.id, status: edcReconciliationTasks.status })
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.scheduleId, scheduleId))
      .limit(1);
    if (!existing) return { success: false, error: 'Task not found.' };
    if (['completed', 'verified', 'rejected'].includes(existing.status ?? ''))
      return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('notes' in patch) update.notes = patch.notes;
    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(edcReconciliationTasks).set(update).where(eq(edcReconciliationTasks.id, existing.id));
    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveEdcReconciliation: ${err}` };
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getEdcReconciliationBySchedule(
  scheduleId: number,
): Promise<{ task: EdcReconciliationTask; rows: EdcTransactionRow[] } | null> {
  const [task] = await db
    .select()
    .from(edcReconciliationTasks)
    .where(eq(edcReconciliationTasks.scheduleId, scheduleId))
    .limit(1);
  if (!task) return null;
  const rows = await listRowsForTask(task.id);
  return { task, rows };
}

export async function getEdcReconciliationById(
  id: number,
): Promise<{ task: EdcReconciliationTask; rows: EdcTransactionRow[] } | null> {
  const [task] = await db
    .select()
    .from(edcReconciliationTasks)
    .where(eq(edcReconciliationTasks.id, id))
    .limit(1);
  if (!task) return null;
  const rows = await listRowsForTask(task.id);
  return { task, rows };
}

// ─── Materialise ──────────────────────────────────────────────────────────────

/** Called by materialiseTasksForSchedule in lib/db/utils/tasks.ts. */
export async function materialiseEdcReconciliationTask(
  scheduleId: number,
  userId:     string,
  storeId:    number,
  shiftId:    number,
  date:       Date,
): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const [active] = await db
    .select({ id: edcReconciliationTasks.id })
    .from(edcReconciliationTasks)
    .where(and(
      eq(edcReconciliationTasks.storeId, storeId),
      gte(edcReconciliationTasks.date, dayStart),
      lte(edcReconciliationTasks.date, dayEnd),
      inArray(edcReconciliationTasks.status, ['pending', 'in_progress', 'discrepancy']),
    ))
    .limit(1);

  if (active) return 'skipped';

  await db.insert(edcReconciliationTasks).values({
    scheduleId,
    userId,
    storeId,
    shiftId,
    date:         dayStart,
    parentTaskId: null,
    status:       'pending',
  });

  return 'created';
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export async function verifyEdcReconciliation(input: {
  taskId: number; actorId: string; storeId: number; approve: boolean; notes?: string;
}): Promise<TaskResult<void>> {
  try {
    const { canManageSchedule } = await import('@/lib/schedule-utils');
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const [row] = await db
      .select({ id: edcReconciliationTasks.id, status: edcReconciliationTasks.status })
      .from(edcReconciliationTasks)
      .where(eq(edcReconciliationTasks.id, input.taskId))
      .limit(1);
    if (!row) return { success: false, error: 'Task tidak ditemukan.' };
    if (row.status !== 'completed')
      return { success: false, error: `Tidak bisa verifikasi task dengan status "${row.status}".` };

    await db
      .update(edcReconciliationTasks)
      .set({
        status:     input.approve ? 'verified' : 'rejected',
        verifiedBy: input.actorId,
        verifiedAt: new Date(),
        notes:      input.notes,
        updatedAt:  new Date(),
      })
      .where(eq(edcReconciliationTasks.id, input.taskId));

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyEdcReconciliation: ${err}` };
  }
}