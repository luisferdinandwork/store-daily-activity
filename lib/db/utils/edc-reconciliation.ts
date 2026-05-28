// lib/db/utils/edc-reconciliation.ts
// ─────────────────────────────────────────────────────────────────────────────
// EDC Reconciliation task.
// New data model:
//   • Each store can have 3-4 EDC terminals: BCA, Mandiri, BNI, OCBC.
//   • Each day can use any 1-4 EDC terminals.
//   • Each EDC terminal has 3 payment buckets: QRIS, Debit, Credit.
//   • Rows are compared by (edcName + transactionType), not only type.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { eq, and, gte, lte, inArray, isNull, sql } from 'drizzle-orm';
import {
  edcReconciliationTasks, edcTransactionRows, storeEdcTerminals,
  stores, shifts, attendance,
  type EdcReconciliationTask, type EdcTransactionRow,
} from '@/lib/db/schema';

export const DEFAULT_GEOFENCE_RADIUS_M = 100;
export const EDC_NAMES = ['BCA', 'Mandiri', 'BNI', 'OCBC'] as const;
export type EdcName = typeof EDC_NAMES[number];
export type TxType = 'qris' | 'debit' | 'credit';
export const EDC_TX_TYPES: TxType[] = ['qris', 'debit', 'credit'];

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint { lat: number; lng: number; }

export interface ExpectedEdcRow {
  edcName: EdcName;
  transactionType: TxType;
  expectedAmount: number;
  expectedCount: number;
}

export interface ExpectedEdcGroup {
  edcName: EdcName;
  rows: ExpectedEdcRow[];
}

export interface ExpectedEdcSnapshot {
  edcs: ExpectedEdcGroup[];
  rows: ExpectedEdcRow[];
  generatedAt: string;
  seed: number;
}

export interface AddRowInput {
  taskId: number;
  edcName: EdcName;
  transactionType: TxType;
  actualAmount: string;
  actualCount: number;
  notes?: string;
}

export interface UpdateRowInput {
  rowId: number;
  edcName?: EdcName;
  transactionType?: TxType;
  actualAmount?: string;
  actualCount?: number;
  notes?: string;
}

export interface SubmitEdcReconciliationInput {
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;
  notes?: string;
}

function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d: Date): Date { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function hashSeed(...parts: Array<string | number | Date>): number {
  const str = parts.map(p => p instanceof Date ? p.toISOString().slice(0, 10) : String(p)).join('|');
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function money(rand: () => number, min: number, max: number): number {
  const value = Math.round((min + rand() * (max - min)) / 1000) * 1000;
  return Math.max(0, value);
}

function parseExpectedSnapshot(raw: string | null): ExpectedEdcSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ExpectedEdcSnapshot;
    if (Array.isArray(parsed.rows) && Array.isArray(parsed.edcs)) return parsed;
    return null;
  } catch { return null; }
}

function normalizeEdcName(input: string): EdcName {
  const found = EDC_NAMES.find(name => name.toLowerCase() === input.toLowerCase());
  if (!found) throw new Error(`EDC tidak valid. Gunakan: ${EDC_NAMES.join(', ')}.`);
  return found;
}

function normalizeTxType(input: string): TxType {
  if (input === 'qris' || input === 'debit' || input === 'credit') return input;
  throw new Error('Tipe transaksi tidak valid. Gunakan qris, debit, atau credit.');
}

function generateExpectedEdcData(storeId: number, date: Date, taskId: number): ExpectedEdcSnapshot {
  const seed = hashSeed(storeId, date, taskId, 'edc-reconciliation-v2');
  const rand = mulberry32(seed);
  const shuffled = [...EDC_NAMES].sort(() => rand() - 0.5);
  const terminalCount = 1 + Math.floor(rand() * 4); // 1-4 EDC used that day
  const used = shuffled.slice(0, terminalCount);

  const edcs: ExpectedEdcGroup[] = used.map((edcName) => {
    const rows: ExpectedEdcRow[] = EDC_TX_TYPES.map((transactionType) => {
      const count = Math.floor(rand() * 16); // optional per type, can be zero
      const avg = transactionType === 'qris' ? [25_000, 350_000] : transactionType === 'debit' ? [100_000, 900_000] : [150_000, 1_500_000];
      return {
        edcName,
        transactionType,
        expectedCount: count,
        expectedAmount: count === 0 ? 0 : money(rand, avg[0] * count, avg[1] * Math.max(1, count)),
      };
    });
    return { edcName, rows };
  });

  return { edcs, rows: edcs.flatMap(e => e.rows), generatedAt: new Date().toISOString(), seed };
}

function rowMatches(expected: ExpectedEdcRow | undefined, row: EdcTransactionRow): boolean {
  if (!expected) return false;
  return Number(row.actualAmount ?? 0) === expected.expectedAmount && Number(row.actualCount ?? 0) === expected.expectedCount;
}

async function ensureStoreEdcTerminals(storeId: number): Promise<void> {
  for (let i = 0; i < EDC_NAMES.length; i++) {
    await db.insert(storeEdcTerminals).values({ storeId, edcName: EDC_NAMES[i], sortOrder: i + 1 }).onConflictDoNothing();
  }
}

let _eveningShiftIdCache: number | null = null;
async function getEveningShiftId(): Promise<number> {
  if (_eveningShiftIdCache != null) return _eveningShiftIdCache;
  const [row] = await db.select({ id: shifts.id }).from(shifts).where(eq(shifts.code, 'evening')).limit(1);
  if (!row) throw new Error('Evening shift not found in shifts table.');
  _eveningShiftIdCache = row.id;
  return row.id;
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db.select({ checkInTime: attendance.checkInTime }).from(attendance).where(eq(attendance.scheduleId, scheduleId)).limit(1);
  if (!att?.checkInTime) return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
  return null;
}

async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const [store] = await db.select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM }).from(stores).where(eq(stores.id, storeId)).limit(1);
  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;
  const dist = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;
  return dist > radius ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.` : null;
}

async function assertCanProgressTask(scheduleId: number, storeId: number, geo: GeoPoint, skipGeo?: boolean): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;
  if (!skipGeo) return assertInGeofence(storeId, geo);
  return null;
}

export async function getActiveEdcReconciliationTask(storeId: number, date: Date): Promise<EdcReconciliationTask | null> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  const [today] = await db.select().from(edcReconciliationTasks).where(and(
    eq(edcReconciliationTasks.storeId, storeId),
    gte(edcReconciliationTasks.date, dayStart),
    lte(edcReconciliationTasks.date, dayEnd),
    inArray(edcReconciliationTasks.status, ['pending', 'in_progress', 'discrepancy']),
  )).orderBy(edcReconciliationTasks.createdAt).limit(1);
  if (today) return today;

  const [prior] = await db.select().from(edcReconciliationTasks).where(and(
    eq(edcReconciliationTasks.storeId, storeId),
    eq(edcReconciliationTasks.status, 'discrepancy'),
    isNull(edcReconciliationTasks.parentTaskId),
  )).orderBy(edcReconciliationTasks.createdAt).limit(1);

  return prior ?? null;
}

export async function fetchExpectedForTask(taskId: number): Promise<TaskResult<ExpectedEdcSnapshot>> {
  try {
    const [task] = await db.select().from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, taskId)).limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };

    await ensureStoreEdcTerminals(task.storeId);

    const existing = parseExpectedSnapshot(task.expectedSnapshot);
    if (existing) return { success: true, data: existing };

    const snapshot = generateExpectedEdcData(task.storeId, task.date, task.id);
    await db.update(edcReconciliationTasks).set({ expectedSnapshot: JSON.stringify(snapshot), expectedFetchedAt: new Date(), updatedAt: new Date() }).where(eq(edcReconciliationTasks.id, taskId));

    return { success: true, data: snapshot };
  } catch (err) {
    return { success: false, error: `fetchExpectedForTask: ${err}` };
  }
}

export async function listRowsForTask(taskId: number): Promise<EdcTransactionRow[]> {
  return db.select().from(edcTransactionRows).where(eq(edcTransactionRows.edcTaskId, taskId)).orderBy(edcTransactionRows.createdAt);
}

function findExpected(snapshot: ExpectedEdcSnapshot | null, edcName: EdcName, transactionType: TxType): ExpectedEdcRow | undefined {
  return snapshot?.rows.find(r => r.edcName === edcName && r.transactionType === transactionType);
}

export async function addRow(input: AddRowInput): Promise<TaskResult<EdcTransactionRow>> {
  try {
    const edcName = normalizeEdcName(input.edcName);
    const transactionType = normalizeTxType(input.transactionType);

    const [task] = await db.select({ id: edcReconciliationTasks.id, status: edcReconciliationTasks.status, expectedSnapshot: edcReconciliationTasks.expectedSnapshot, storeId: edcReconciliationTasks.storeId }).from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, input.taskId)).limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah final, tidak bisa menambah row.' };

    const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
    const exp = findExpected(snapshot, edcName, transactionType);

    const [terminal] = await db.select({ id: storeEdcTerminals.id }).from(storeEdcTerminals).where(and(eq(storeEdcTerminals.storeId, task.storeId), eq(storeEdcTerminals.edcName, edcName))).limit(1);

    const [row] = await db.insert(edcTransactionRows).values({
      edcTaskId: input.taskId,
      edcTerminalId: terminal?.id ?? null,
      edcName,
      transactionType,
      expectedAmount: exp ? String(exp.expectedAmount) : null,
      expectedCount: exp ? exp.expectedCount : null,
      actualAmount: input.actualAmount,
      actualCount: input.actualCount,
      matches: null,
      notes: input.notes,
    }).returning();

    if (task.status === 'pending') await db.update(edcReconciliationTasks).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(edcReconciliationTasks.id, input.taskId));

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `addRow: ${err}` };
  }
}

export async function updateRow(input: UpdateRowInput): Promise<TaskResult<EdcTransactionRow>> {
  try {
    const [existing] = await db.select().from(edcTransactionRows).where(eq(edcTransactionRows.id, input.rowId)).limit(1);
    if (!existing) return { success: false, error: 'Row tidak ditemukan.' };

    const [task] = await db.select({ status: edcReconciliationTasks.status, expectedSnapshot: edcReconciliationTasks.expectedSnapshot, storeId: edcReconciliationTasks.storeId }).from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, existing.edcTaskId)).limit(1);
    if (!task) return { success: false, error: 'Parent task tidak ditemukan.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah final, tidak bisa mengubah row.' };

    const edcName = input.edcName ? normalizeEdcName(input.edcName) : normalizeEdcName(existing.edcName);
    const transactionType = input.transactionType ? normalizeTxType(input.transactionType) : normalizeTxType(existing.transactionType);
    const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
    const exp = findExpected(snapshot, edcName, transactionType);
    const [terminal] = await db.select({ id: storeEdcTerminals.id }).from(storeEdcTerminals).where(and(eq(storeEdcTerminals.storeId, task.storeId), eq(storeEdcTerminals.edcName, edcName))).limit(1);

    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      edcName,
      edcTerminalId: terminal?.id ?? null,
      transactionType,
      expectedAmount: exp ? String(exp.expectedAmount) : null,
      expectedCount: exp ? exp.expectedCount : null,
      matches: null,
    };
    if ('actualAmount' in input && input.actualAmount != null) patch.actualAmount = input.actualAmount;
    if ('actualCount' in input && input.actualCount != null) patch.actualCount = input.actualCount;
    if ('notes' in input) patch.notes = input.notes;

    const [row] = await db.update(edcTransactionRows).set(patch).where(eq(edcTransactionRows.id, input.rowId)).returning();
    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `updateRow: ${err}` };
  }
}

export async function deleteRow(rowId: number): Promise<TaskResult<void>> {
  try {
    const [existing] = await db.select({ edcTaskId: edcTransactionRows.edcTaskId }).from(edcTransactionRows).where(eq(edcTransactionRows.id, rowId)).limit(1);
    if (!existing) return { success: false, error: 'Row tidak ditemukan.' };
    const [task] = await db.select({ status: edcReconciliationTasks.status }).from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, existing.edcTaskId)).limit(1);
    if (task?.status === 'completed') return { success: false, error: 'Task sudah final, tidak bisa menghapus row.' };
    await db.delete(edcTransactionRows).where(eq(edcTransactionRows.id, rowId));
    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `deleteRow: ${err}` };
  }
}

export async function submitEdcReconciliation(input: SubmitEdcReconciliationInput): Promise<TaskResult<EdcReconciliationTask>> {
  try {
    const gateErr = await assertCanProgressTask(input.scheduleId, input.storeId, input.geo, input.skipGeo);
    if (gateErr) return { success: false, error: gateErr };

    const [task] = await db.select().from(edcReconciliationTasks).where(eq(edcReconciliationTasks.scheduleId, input.scheduleId)).limit(1);
    if (!task) return { success: false, error: 'Task tidak ditemukan untuk schedule ini.' };
    if (task.status === 'completed') return { success: false, error: 'Task sudah final.' };

    const snapshot = parseExpectedSnapshot(task.expectedSnapshot);
    if (!snapshot) return { success: false, error: 'Expected data belum di-fetch. Buka task ulang untuk fetch.' };

    const rows = await listRowsForTask(task.id);
    if (rows.length === 0) return { success: false, error: 'Belum ada transaksi yang diinput.' };

    const expectedKeys = new Set(snapshot.rows.map(r => `${r.edcName}:${r.transactionType}`));
    const enteredKeys = new Set(rows.map(r => `${r.edcName}:${r.transactionType}`));
    let allMatch = true;

    for (const row of rows) {
      const exp = snapshot.rows.find(r => r.edcName === row.edcName && r.transactionType === row.transactionType);
      const matches = rowMatches(exp, row);
      if (!matches) allMatch = false;
      await db.update(edcTransactionRows).set({ matches, updatedAt: new Date() }).where(eq(edcTransactionRows.id, row.id));
    }

    for (const key of expectedKeys) if (!enteredKeys.has(key)) allMatch = false;

    const now = new Date();
    const eveningId = await getEveningShiftId();
    const isBalanced = allMatch;
    const newStatus = isBalanced ? 'completed' as const : 'discrepancy' as const;

    let discrepancyStartedAt = task.discrepancyStartedAt;
    let discrepancyResolvedAt = task.discrepancyResolvedAt;
    let discrepancyDurationMinutes = task.discrepancyDurationMinutes;

    if (!isBalanced && !discrepancyStartedAt) discrepancyStartedAt = now;
    if (isBalanced && discrepancyStartedAt && !discrepancyResolvedAt) {
      discrepancyResolvedAt = now;
      discrepancyDurationMinutes = Math.max(0, Math.round((now.getTime() - new Date(discrepancyStartedAt).getTime()) / 60_000));
    }

    const [updated] = await db.update(edcReconciliationTasks).set({
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: eveningId,
      isBalanced,
      status: newStatus,
      discrepancyStartedAt,
      discrepancyResolvedAt,
      discrepancyDurationMinutes,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      completedAt: isBalanced ? now : null,
      updatedAt: now,
    }).where(eq(edcReconciliationTasks.id, task.id)).returning();

    return { success: true, data: updated };
  } catch (err) {
    return { success: false, error: `submitEdcReconciliation: ${err}` };
  }
}

export interface AutoSaveEdcReconciliationPatch { notes?: string; }

export async function autoSaveEdcReconciliation(scheduleId: number, patch: AutoSaveEdcReconciliationPatch): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db.select({ id: edcReconciliationTasks.id, status: edcReconciliationTasks.status }).from(edcReconciliationTasks).where(eq(edcReconciliationTasks.scheduleId, scheduleId)).limit(1);
    if (!existing) return { success: false, error: 'Task not found.' };
    if (existing.status === 'completed') return { success: true, data: { saved: [] } };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if ('notes' in patch) update.notes = patch.notes;
    if (existing.status === 'pending') update.status = 'in_progress';

    await db.update(edcReconciliationTasks).set(update).where(eq(edcReconciliationTasks.id, existing.id));
    return { success: true, data: { saved: Object.keys(update).filter(k => k !== 'updatedAt') } };
  } catch (err) {
    return { success: false, error: `autoSaveEdcReconciliation: ${err}` };
  }
}

export async function getEdcReconciliationBySchedule(scheduleId: number): Promise<{ task: EdcReconciliationTask; rows: EdcTransactionRow[] } | null> {
  const [task] = await db.select().from(edcReconciliationTasks).where(eq(edcReconciliationTasks.scheduleId, scheduleId)).limit(1);
  if (!task) return null;
  const rows = await listRowsForTask(task.id);
  return { task, rows };
}

export async function getEdcReconciliationById(id: number): Promise<{ task: EdcReconciliationTask; rows: EdcTransactionRow[] } | null> {
  const [task] = await db.select().from(edcReconciliationTasks).where(eq(edcReconciliationTasks.id, id)).limit(1);
  if (!task) return null;
  const rows = await listRowsForTask(task.id);
  return { task, rows };
}

export async function materialiseEdcReconciliationTask(scheduleId: number, userId: string, storeId: number, shiftId: number, date: Date): Promise<'created' | 'skipped'> {
  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  await ensureStoreEdcTerminals(storeId);

  const [active] = await db.select({ id: edcReconciliationTasks.id }).from(edcReconciliationTasks).where(and(
    eq(edcReconciliationTasks.storeId, storeId),
    gte(edcReconciliationTasks.date, dayStart),
    lte(edcReconciliationTasks.date, dayEnd),
    inArray(edcReconciliationTasks.status, ['pending', 'in_progress', 'discrepancy']),
  )).limit(1);
  if (active) return 'skipped';

  await db.insert(edcReconciliationTasks).values({ scheduleId, userId, storeId, shiftId, date: dayStart, parentTaskId: null, status: 'pending' });
  return 'created';
}
