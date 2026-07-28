// lib/db/utils/store-closing.ts
// ─────────────────────────────────────────────────────────────────────────────
// Store Closing task utilities.
//
// Store Closing replaces the separate evening tasks:
//   1. EOD Z-Report       → checklist only
//   2. EDC settlement     → checklist
//   3. EDC summary        → checklist
//   4. Evidence photo     → EOD + EDC settlement side by side
//   5. Open statement     → post statement, or on hold
//
// On Hold behavior:
//   • Submit with openStatementDecision = 'on_hold' creates an Issue in Bahasa.
//   • The generated Issue starts with status = 'draft'.
//   • The Store Closing row stays with status = 'pending' and isOnHold=true.
//   • Future days still generate their own Store Closing rows.
//   • When the linked issue is resolved, syncResolvedStoreClosingHoldsForStores()
//     reopens only that held task so the current employee can finish it.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import {
  attendance,
  issues,
  schedules,
  shifts,
  storeClosingTasks,
  stores,
  type Issue,
  type StoreClosingTask,
} from '@/lib/db/schema';
import {
  createIssueWithRoles,
  getOperationIssueRoleIds,
} from '@/lib/db/utils/issues';

// ─── Public types ─────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const STORE_CLOSING_PHOTO_RULES = {
  eodEdcSettlement: { required: true },
} as const;

export type StoreClosingOpenStatementDecision = 'post_statement' | 'on_hold';

export interface SubmitStoreClosingInput {
  taskId?: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;
  skipGeo?: boolean;

  eodZReportDone: boolean;
  edcSettlementDone: boolean;
  edcSettlementNotes?: string;
  edcSummaryDone: boolean;
  edcSummaryNotes?: string;

  /** Required evidence: photo of EOD and EDC settlement side by side. */
  eodEdcSettlementPhoto: string | null;

  openStatementDecision: StoreClosingOpenStatementDecision;
  openStatementHoldReason?: string;
  notes?: string;
}

export interface AutoSaveStoreClosingPatch {
  eodZReportDone?: boolean;
  edcSettlementDone?: boolean;
  edcSettlementNotes?: string | null;
  edcSummaryDone?: boolean;
  edcSummaryNotes?: string | null;
  eodEdcSettlementPhoto?: string | null;
  openStatementDecision?: StoreClosingOpenStatementDecision | null;
  openStatementHoldReason?: string | null;
  notes?: string | null;
}

export interface AutoSaveStoreClosingInput {
  taskId: number;
  userId: string;
  patch: AutoSaveStoreClosingPatch;
}

export interface StoreClosingWithIssue {
  task: StoreClosingTask;
  issue: Issue | null;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function formatDateId(d: Date): string {
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function isFilled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

async function assertCheckedIn(
  scheduleId: number,
  opts?: { userId?: string; storeId?: number },
): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (att?.checkInTime) return null;

  // Defensive fallback for shared Store Closing rows:
  // if the client accidentally sends the original shared row scheduleId, still
  // allow the logged-in employee when they are checked in for their own schedule
  // at the same store today.
  if (opts?.userId && opts?.storeId) {
    const now = new Date();

    const [ownAttendance] = await db
      .select({ checkInTime: attendance.checkInTime })
      .from(attendance)
      .innerJoin(schedules, eq(schedules.id, attendance.scheduleId))
      .where(
        and(
          eq(attendance.userId, opts.userId),
          eq(attendance.storeId, opts.storeId),
          eq(schedules.isHoliday, false),
          gte(schedules.date, startOfDay(now)),
          lte(schedules.date, endOfDay(now)),
        ),
      )
      .limit(1);

    if (ownAttendance?.checkInTime) return null;
  }

  return 'Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.';
}

async function assertInGeofence(
  storeId: number,
  geo: GeoPoint,
): Promise<string | null> {
  const [store] = await db
    .select({
      lat: stores.latitude,
      lng: stores.longitude,
      radius: stores.geofenceRadiusM,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return 'Toko tidak ditemukan.';
  if (!store.lat || !store.lng) return null;

  const dist = haversineMetres(geo, {
    lat: parseFloat(store.lat),
    lng: parseFloat(store.lng),
  });
  const radius = store.radius
    ? parseFloat(store.radius)
    : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number,
  storeId: number,
  geo: GeoPoint,
  skipGeo?: boolean,
  opts?: { userId?: string },
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId, {
    userId: opts?.userId,
    storeId,
  });
  if (checkInErr) return checkInErr;

  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }

  return null;
}

function validateSubmitPayload(input: SubmitStoreClosingInput): string | null {
  if (!input.eodZReportDone) {
    return 'Checklist EOD Z-Report wajib diselesaikan.';
  }

  if (!input.edcSettlementDone) {
    return 'Checklist EDC settlement wajib diselesaikan.';
  }

  if (!input.edcSummaryDone) {
    return 'Checklist EDC summary wajib diselesaikan.';
  }

  if (!isFilled(input.eodEdcSettlementPhoto)) {
    return 'Foto EOD dan EDC settlement berdampingan wajib diupload.';
  }

  if (!input.openStatementDecision) {
    return 'Pilih status Open Statement: Post Statement atau On Hold.';
  }

  return null;
}

async function getShiftCode(shiftId: number): Promise<string | null> {
  const [row] = await db
    .select({ code: shifts.code })
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);

  return row?.code ?? null;
}

async function createOpenStatementHoldIssue(input: {
  task: StoreClosingTask;
  userId: string;
  reason: string;
  eodEdcSettlementPhoto: string | null;
}): Promise<Issue> {
  const [store] = await db
    .select({ name: stores.name })
    .from(stores)
    .where(eq(stores.id, input.task.storeId))
    .limit(1);

  const operationRoleIds = await getOperationIssueRoleIds();
  if (!operationRoleIds.length) {
    throw new Error('Tidak ada role Operation/Ops yang aktif untuk menerima issue.');
  }

  const storeName = store?.name ?? `Store #${input.task.storeId}`;
  const dateLabel = formatDateId(input.task.date);

  const title = `Draft Issue Open Statement Tertunda - ${storeName} - ${dateLabel}`;
  const holdReason = input.reason.trim() || 'Tidak ada alasan tambahan dari employee.';
  const description = [
    `Draft issue dari task Store Closing untuk toko ${storeName} pada tanggal ${dateLabel}.`,
    '',
    'Open Statement dipilih On Hold sehingga task Store Closing belum dapat diselesaikan.',
    '',
    `Alasan dari employee: ${holdReason}`,
    '',
    'Mohon tim Operation melakukan pengecekan sesuai area toko. Ops Area hanya melihat issue dari area toko ini, sedangkan Ops HO dapat melihat seluruh issue Operation.',
    '',
    'Setelah issue ditandai Resolved, task Store Closing terkait akan dibuka kembali agar employee bisa menyelesaikan Open Statement.',
  ].join('\n');

  const serialized = await createIssueWithRoles({
    title,
    description,
    userId: input.userId,
    storeId: input.task.storeId,
    assignedToRoleIds: operationRoleIds,
    status: 'draft',
    attachmentUrls: input.eodEdcSettlementPhoto ? [input.eodEdcSettlementPhoto] : [],
  });

  const [issue] = await db
    .select()
    .from(issues)
    .where(eq(issues.id, Number(serialized.id)))
    .limit(1);

  return issue;
}

// ─── Materialise / read ───────────────────────────────────────────────────────

export async function getOrCreateStoreClosingForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  shiftId: number,
  date: Date = new Date(),
): Promise<TaskResult<StoreClosingTask>> {
  try {
    await syncResolvedStoreClosingHoldsForStores([storeId]);

    const dayStart = startOfDay(date);
    const dayEnd = endOfDay(date);

    const [existing] = await db
      .select()
      .from(storeClosingTasks)
      .where(
        and(
          eq(storeClosingTasks.storeId, storeId),
          gte(storeClosingTasks.date, dayStart),
          lte(storeClosingTasks.date, dayEnd),
        ),
      )
      .limit(1);

    if (existing) return { success: true, data: existing };

    const [row] = await db
      .insert(storeClosingTasks)
      .values({
        scheduleId,
        userId,
        storeId,
        shiftId,
        date: dayStart,
        status: 'not_started',
        updatedAt: new Date(),
      })
      .returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `getOrCreateStoreClosingForSchedule: ${err}` };
  }
}

export async function getStoreClosingById(
  taskId: number,
): Promise<StoreClosingTask | null> {
  const [row] = await db
    .select()
    .from(storeClosingTasks)
    .where(eq(storeClosingTasks.id, taskId))
    .limit(1);

  return row ?? null;
}

export async function getStoreClosingBySchedule(
  scheduleId: number,
): Promise<StoreClosingTask | null> {
  const [row] = await db
    .select()
    .from(storeClosingTasks)
    .where(eq(storeClosingTasks.scheduleId, scheduleId))
    .orderBy(desc(storeClosingTasks.date))
    .limit(1);

  return row ?? null;
}

export async function getVisibleStoreClosingTasksForStores(
  storeIds: number[],
  date: Date = new Date(),
): Promise<StoreClosingTask[]> {
  if (!storeIds.length) return [];

  await syncResolvedStoreClosingHoldsForStores(storeIds);

  const dayStart = startOfDay(date);
  const dayEnd = endOfDay(date);

  return db
    .select()
    .from(storeClosingTasks)
    .where(
      and(
        inArray(storeClosingTasks.storeId, storeIds),
        or(
          and(
            gte(storeClosingTasks.date, dayStart),
            lte(storeClosingTasks.date, dayEnd),
          ),
          and(
            isNotNull(storeClosingTasks.holdIssueId),
            ne(storeClosingTasks.status, 'completed'),
          ),
        ),
      ),
    )
    .orderBy(desc(storeClosingTasks.date));
}

// ─── Auto-save ────────────────────────────────────────────────────────────────

export async function autoSaveStoreClosing(
  input: AutoSaveStoreClosingInput,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const [existing] = await db
      .select({
        id: storeClosingTasks.id,
        status: storeClosingTasks.status,
        isOnHold: storeClosingTasks.isOnHold,
      })
      .from(storeClosingTasks)
      .where(eq(storeClosingTasks.id, input.taskId))
      .limit(1);

    if (!existing) return { success: false, error: 'Store Closing task not found.' };

    if (existing.status === 'completed') {
      return { success: true, data: { saved: [] } };
    }

    if (existing.isOnHold) {
      return {
        success: false,
        error: 'Task sedang On Hold. Selesaikan issue terkait terlebih dahulu.',
      };
    }

    const now = new Date();
    const update: Record<string, unknown> = { updatedAt: now };

    if ('eodZReportDone' in input.patch) {
      update.eodZReportDone = !!input.patch.eodZReportDone;
      update.eodZReportBy = input.userId;
      update.eodZReportAt = now;
    }

    if ('edcSettlementDone' in input.patch) {
      update.edcSettlementDone = !!input.patch.edcSettlementDone;
      update.edcSettlementBy = input.userId;
      update.edcSettlementAt = now;
    }

    if ('edcSettlementNotes' in input.patch) {
      update.edcSettlementNotes = input.patch.edcSettlementNotes ?? null;
    }

    if ('edcSummaryDone' in input.patch) {
      update.edcSummaryDone = !!input.patch.edcSummaryDone;
      update.edcSummaryBy = input.userId;
      update.edcSummaryAt = now;
    }

    if ('edcSummaryNotes' in input.patch) {
      update.edcSummaryNotes = input.patch.edcSummaryNotes ?? null;
    }

    if ('eodEdcSettlementPhoto' in input.patch) {
      update.eodEdcSettlementPhoto = input.patch.eodEdcSettlementPhoto ?? null;
      update.eodEdcSettlementPhotoBy = input.userId;
      update.eodEdcSettlementPhotoAt = now;
    }

    if ('openStatementDecision' in input.patch) {
      update.openStatementDecision = input.patch.openStatementDecision ?? null;
      update.openStatementBy = input.userId;
      update.openStatementAt = now;
    }

    if ('openStatementHoldReason' in input.patch) {
      update.openStatementHoldReason = input.patch.openStatementHoldReason ?? null;
    }

    if ('notes' in input.patch) {
      update.notes = input.patch.notes ?? null;
    }

    if (existing.status === 'not_started') {
      update.status = 'in_progress';
    }

    await db
      .update(storeClosingTasks)
      .set(update)
      .where(eq(storeClosingTasks.id, existing.id));

    return {
      success: true,
      data: { saved: Object.keys(update).filter((k) => k !== 'updatedAt') },
    };
  } catch (err) {
    return { success: false, error: `autoSaveStoreClosing: ${err}` };
  }
}

// ─── Submit ───────────────────────────────────────────────────────────────────

export async function submitStoreClosing(
  input: SubmitStoreClosingInput,
): Promise<TaskResult<StoreClosingWithIssue>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
      { userId: input.userId },
    );
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateSubmitPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    let existing: StoreClosingTask | undefined;

    if (input.taskId) {
      existing =
        (await db
          .select()
          .from(storeClosingTasks)
          .where(eq(storeClosingTasks.id, input.taskId))
          .limit(1))[0] ?? undefined;
    }

    if (!existing) {
      existing =
        (await db
          .select()
          .from(storeClosingTasks)
          .where(eq(storeClosingTasks.scheduleId, input.scheduleId))
          .orderBy(desc(storeClosingTasks.date))
          .limit(1))[0] ?? undefined;
    }

    if (!existing) {
      const [schedule] = await db
        .select({ shiftId: schedules.shiftId, date: schedules.date })
        .from(schedules)
        .where(eq(schedules.id, input.scheduleId))
        .limit(1);

      if (!schedule) return { success: false, error: 'Schedule tidak ditemukan.' };

      const created = await getOrCreateStoreClosingForSchedule(
        input.scheduleId,
        input.userId,
        input.storeId,
        schedule.shiftId,
        schedule.date,
      );
      if (!created.success) return { success: false, error: created.error };
      existing = created.data;
    }

    if (existing.storeId !== input.storeId) {
      return { success: false, error: 'Task tidak sesuai dengan toko employee.' };
    }

    if (existing.status === 'completed') {
      return { success: false, error: 'Store Closing sudah disubmit.' };
    }

    if (existing.isOnHold) {
      return {
        success: false,
        error: 'Task masih On Hold. Tunggu issue terkait ditandai resolved terlebih dahulu.',
      };
    }

    const shiftCode = await getShiftCode(existing.shiftId);
    if (shiftCode !== 'evening' && shiftCode !== 'full_day') {
      return {
        success: false,
        error: 'Store Closing hanya bisa disubmit pada shift evening atau full_day.',
      };
    }

    const now = new Date();
    const sideBySidePhoto = input.eodEdcSettlementPhoto?.trim() ?? null;
    const holdReason =
      input.openStatementDecision === 'on_hold'
        ? input.openStatementHoldReason?.trim() || 'Tidak ada alasan tambahan dari employee.'
        : input.openStatementHoldReason?.trim() || null;

    const baseValues = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,

      eodZReportDone: input.eodZReportDone,
      eodZReportBy: input.userId,
      eodZReportAt: now,

      edcSettlementDone: input.edcSettlementDone,
      edcSettlementNotes: input.edcSettlementNotes,
      edcSettlementBy: input.userId,
      edcSettlementAt: now,

      edcSummaryDone: input.edcSummaryDone,
      edcSummaryNotes: input.edcSummaryNotes,
      edcSummaryBy: input.userId,
      edcSummaryAt: now,

      eodEdcSettlementPhoto: sideBySidePhoto,
      eodEdcSettlementPhotoBy: input.userId,
      eodEdcSettlementPhotoAt: now,

      openStatementDecision: input.openStatementDecision,
      openStatementHoldReason: holdReason,
      openStatementBy: input.userId,
      openStatementAt: now,

      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      updatedAt: now,
    };

    if (input.openStatementDecision === 'on_hold') {
      const issue = existing.holdIssueId
        ? null
        : await createOpenStatementHoldIssue({
            task: existing,
            userId: input.userId,
            reason: input.openStatementHoldReason ?? '',
            eodEdcSettlementPhoto: sideBySidePhoto,
          });

      const [row] = await db
        .update(storeClosingTasks)
        .set({
          ...baseValues,
          status: 'pending',
          isOnHold: true,
          holdIssueId: existing.holdIssueId ?? issue?.id ?? null,
          heldBy: input.userId,
          heldAt: now,
          completedBy: null,
          completedByScheduleId: null,
          completedAt: null,
        })
        .where(eq(storeClosingTasks.id, existing.id))
        .returning();

      return { success: true, data: { task: row, issue } };
    }

    const [row] = await db
      .update(storeClosingTasks)
      .set({
        ...baseValues,
        status: 'completed',
        isOnHold: false,
        completedBy: input.userId,
        completedByScheduleId: input.scheduleId,
        completedAt: now,
      })
      .where(eq(storeClosingTasks.id, existing.id))
      .returning();

    return { success: true, data: { task: row, issue: null } };
  } catch (err) {
    return { success: false, error: `submitStoreClosing: ${err}` };
  }
}

// ─── Reopen held tasks after issue resolved ───────────────────────────────────

export async function syncResolvedStoreClosingHoldsForStores(
  storeIds: number[],
): Promise<TaskResult<{ reopened: number[] }>> {
  try {
    if (!storeIds.length) return { success: true, data: { reopened: [] } };

    const rows = await db
      .select({
        taskId: storeClosingTasks.id,
        issueStatus: issues.status,
      })
      .from(storeClosingTasks)
      .innerJoin(issues, eq(issues.id, storeClosingTasks.holdIssueId))
      .where(
        and(
          inArray(storeClosingTasks.storeId, storeIds),
          eq(storeClosingTasks.isOnHold, true),
          eq(storeClosingTasks.status, 'pending'),
          isNotNull(storeClosingTasks.holdIssueId),
          eq(issues.status, 'completed'),
        ),
      );

    if (!rows.length) return { success: true, data: { reopened: [] } };

    const taskIds = rows.map((r) => r.taskId);
    const now = new Date();

    await db
      .update(storeClosingTasks)
      .set({
        status: 'in_progress',
        isOnHold: false,
        openStatementDecision: null,
        holdResolvedAt: now,
        reopenedAt: now,
        updatedAt: now,
      })
      .where(inArray(storeClosingTasks.id, taskIds));

    return { success: true, data: { reopened: taskIds } };
  } catch (err) {
    return { success: false, error: `syncResolvedStoreClosingHoldsForStores: ${err}` };
  }
}

export async function reopenStoreClosingHoldForIssue(
  issueId: number,
): Promise<TaskResult<{ reopened: number[] }>> {
  try {
    const [issue] = await db
      .select({ status: issues.status })
      .from(issues)
      .where(eq(issues.id, issueId))
      .limit(1);

    if (!issue || issue.status !== 'completed') {
      return { success: true, data: { reopened: [] } };
    }

    const heldRows = await db
      .select({ id: storeClosingTasks.id })
      .from(storeClosingTasks)
      .where(
        and(
          eq(storeClosingTasks.holdIssueId, issueId),
          eq(storeClosingTasks.isOnHold, true),
          eq(storeClosingTasks.status, 'pending'),
        ),
      );

    if (!heldRows.length) return { success: true, data: { reopened: [] } };

    const now = new Date();
    const taskIds = heldRows.map((r) => r.id);

    await db
      .update(storeClosingTasks)
      .set({
        status: 'in_progress',
        isOnHold: false,
        openStatementDecision: null,
        holdResolvedAt: now,
        reopenedAt: now,
        updatedAt: now,
      })
      .where(inArray(storeClosingTasks.id, taskIds));

    return { success: true, data: { reopened: taskIds } };
  } catch (err) {
    return { success: false, error: `reopenStoreClosingHoldForIssue: ${err}` };
  }
}
