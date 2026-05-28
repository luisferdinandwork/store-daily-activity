// lib/db/utils/user-transfers.ts
// ─────────────────────────────────────────────────────────────────────────────
// Employee transfer logic.
//
// Authorization model:
//   • role = 'admin'                  → can transfer any employee anywhere
//   • role = 'ops', employeeType = 'ops_ho'   → can transfer any employee anywhere
//   • role = 'ops', employeeType = 'ops_area' → can only transfer employees
//     who are currently inside their area, and only to stores inside their area
//   • The TARGET user must have role = 'employee'. OPS users cannot be managed
//     by other OPS users through this flow.
//
// Modes:
//   • permanent — no end date
//   • temporary — auto-reverts on `effectiveTo`
//
// Schedule rescheduling on transfer:
//   • All future monthlyScheduleEntries + materialised schedules for the user
//     in the affected date window are moved to the destination store. Shift
//     codes are preserved (morning stays morning).
//   • Attendance rows for affected days are wiped; OPS resolves later on the
//     attendance page using the transfer note.
//   • Future task rows are deleted; they re-materialise on next check-in.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import {
  areas,
  stores,
  users,
  userRoles,
  employeeTypes,
  userStoreAssignments,
  schedules,
  attendance,
  monthlyScheduleEntries,
  monthlySchedules,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  setoranMoneyStorage,
  cekBinTasks,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  itemDroppingTasks,
  briefingTasks,
  edcReconciliationTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks,
  breakSessions,
} from '@/lib/db/schema';
import { and, eq, gte, inArray, isNotNull, lte, lt, sql } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransferResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface TransferInput {
  actorId: string;
  userId: string;
  toStoreId: number;
  roleId: number;
  employeeTypeId?: number | null;
  notes?: string | null;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
  isTemporary?: boolean;
}

export interface TransferPreview {
  affectedScheduleCount: number;
  affectedMonthlyEntryCount: number;
  attendanceToWipeCount: number;
  affectedDates: string[];
  fromStore: { id: number; name: string; areaName: string | null } | null;
  toStore: { id: number; name: string; areaName: string | null };
  user: { id: string; name: string; nik: string };
  mode: 'permanent' | 'temporary';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  crossArea: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Resolve actor + their effective permissions.
 * HO means "head office" → can see/manage any area.
 */
export async function getActorAccess(actorId: string) {
  const [actor] = await db
    .select({
      id: users.id,
      areaId: users.areaId,
      roleCode: userRoles.code,
      roleActive: userRoles.isActive,
      employeeTypeCode: employeeTypes.code,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false as const, error: 'Actor not found.' };
  if (!actor.roleActive) return { allowed: false as const, error: 'Your role is inactive.' };

  const isAdmin = actor.roleCode === 'admin';
  const isOps = actor.roleCode === 'ops';
  if (!isAdmin && !isOps) {
    return { allowed: false as const, error: 'Only OPS/Admin can use this.' };
  }

  const isHO = isAdmin || actor.employeeTypeCode === 'ops_ho';

  if (isOps && !isHO && !actor.areaId) {
    return { allowed: false as const, error: 'Area OPS user has no area assigned.' };
  }

  return {
    allowed: true as const,
    actor: { ...actor, isHO, isAdmin },
  };
}

async function assertCanTransfer(actorId: string, userId: string, toStoreId: number) {
  const access = await getActorAccess(actorId);
  if (!access.allowed) return access;

  // The destination
  const [toStore] = await db
    .select({ id: stores.id, name: stores.name, areaId: stores.areaId, areaName: areas.name })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(eq(stores.id, toStoreId))
    .limit(1);

  if (!toStore) return { allowed: false as const, error: 'Destination store not found.' };

  // The target user — must be an employee
  const [target] = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      homeStoreId: users.homeStoreId,
      userAreaId: users.areaId,
      targetRoleCode: userRoles.code,
      currentStoreAreaId: stores.areaId,
      currentStoreAreaName: areas.name,
      currentStoreName: stores.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) return { allowed: false as const, error: 'Target user not found.' };

  if (target.targetRoleCode !== 'employee') {
    return { allowed: false as const, error: 'OPS users cannot be managed through this flow.' };
  }

  // Area OPS: both source and destination must be in their area
  if (!access.actor.isHO) {
    const targetAreaId = target.currentStoreAreaId ?? target.userAreaId;
    if (targetAreaId && targetAreaId !== access.actor.areaId) {
      return { allowed: false as const, error: 'Employee is outside your area.' };
    }
    if (toStore.areaId !== access.actor.areaId) {
      return { allowed: false as const, error: 'Destination store is outside your area.' };
    }
  }

  return { allowed: true as const, actor: access.actor, target, toStore };
}

async function deleteAllTasksForSchedules(scheduleIds: number[]): Promise<void> {
  if (scheduleIds.length === 0) return;

  const setoranIds = await db
    .select({ id: setoranTasks.id })
    .from(setoranTasks)
    .where(inArray(setoranTasks.scheduleId, scheduleIds));

  if (setoranIds.length > 0) {
    await db
      .delete(setoranMoneyStorage)
      .where(inArray(setoranMoneyStorage.taskId, setoranIds.map((r) => r.id)));
  }

  const cekBinIds = await db
    .select({ id: cekBinTasks.id })
    .from(cekBinTasks)
    .where(inArray(cekBinTasks.scheduleId, scheduleIds));

  if (cekBinIds.length > 0) {
    await db
      .delete(cekBinTaskBins)
      .where(inArray(cekBinTaskBins.taskId, cekBinIds.map((r) => r.id)));
  }

  await Promise.all([
    db.delete(storeOpeningTasks).where(inArray(storeOpeningTasks.scheduleId, scheduleIds)),
    db.delete(storeFrontTasks).where(inArray(storeFrontTasks.scheduleId, scheduleIds)),
    db.delete(setoranTasks).where(inArray(setoranTasks.scheduleId, scheduleIds)),
    db.delete(cekBinTasks).where(inArray(cekBinTasks.scheduleId, scheduleIds)),
    db.delete(vmChecklistTasks).where(inArray(vmChecklistTasks.scheduleId, scheduleIds)),
    db.delete(marketingCheckTasks).where(inArray(marketingCheckTasks.scheduleId, scheduleIds)),
    db.delete(itemDroppingTasks).where(inArray(itemDroppingTasks.scheduleId, scheduleIds)),
    db.delete(briefingTasks).where(inArray(briefingTasks.scheduleId, scheduleIds)),
    db.delete(edcReconciliationTasks).where(inArray(edcReconciliationTasks.scheduleId, scheduleIds)),
    db.delete(eodZReportTasks).where(inArray(eodZReportTasks.scheduleId, scheduleIds)),
    db.delete(openStatementTasks).where(inArray(openStatementTasks.scheduleId, scheduleIds)),
    db.delete(groomingTasks).where(inArray(groomingTasks.scheduleId, scheduleIds)),
  ]);
}

async function wipeAttendanceForSchedules(scheduleIds: number[]): Promise<void> {
  if (scheduleIds.length === 0) return;
  const attRows = await db
    .select({ id: attendance.id })
    .from(attendance)
    .where(inArray(attendance.scheduleId, scheduleIds));
  if (attRows.length === 0) return;
  const attIds = attRows.map((r) => r.id);
  await db.delete(breakSessions).where(inArray(breakSessions.attendanceId, attIds));
  await db.delete(attendance).where(inArray(attendance.id, attIds));
}

async function collectAffectedScheduleData(userId: string, currentStoreId: number | null, from: Date, to: Date | null) {
  const fromStart = startOfDay(from);
  const toEnd = to ? endOfDay(to) : null;

  const entryWhere = currentStoreId
    ? and(
        eq(monthlyScheduleEntries.userId, userId),
        eq(monthlyScheduleEntries.storeId, currentStoreId),
        toEnd ? and(gte(monthlyScheduleEntries.date, fromStart), lte(monthlyScheduleEntries.date, toEnd)) : gte(monthlyScheduleEntries.date, fromStart),
      )
    : and(
        eq(monthlyScheduleEntries.userId, userId),
        toEnd ? and(gte(monthlyScheduleEntries.date, fromStart), lte(monthlyScheduleEntries.date, toEnd)) : gte(monthlyScheduleEntries.date, fromStart),
      );

  const monthlyEntries = await db
    .select({
      id: monthlyScheduleEntries.id,
      storeId: monthlyScheduleEntries.storeId,
      monthlyScheduleId: monthlyScheduleEntries.monthlyScheduleId,
      date: monthlyScheduleEntries.date,
      shiftId: monthlyScheduleEntries.shiftId,
      isOff: monthlyScheduleEntries.isOff,
      isLeave: monthlyScheduleEntries.isLeave,
    })
    .from(monthlyScheduleEntries)
    .where(entryWhere);

  const schedWhere = currentStoreId
    ? and(
        eq(schedules.userId, userId),
        eq(schedules.storeId, currentStoreId),
        toEnd ? and(gte(schedules.date, fromStart), lte(schedules.date, toEnd)) : gte(schedules.date, fromStart),
      )
    : and(
        eq(schedules.userId, userId),
        toEnd ? and(gte(schedules.date, fromStart), lte(schedules.date, toEnd)) : gte(schedules.date, fromStart),
      );

  const scheduleRows = await db
    .select({ id: schedules.id, storeId: schedules.storeId, date: schedules.date, monthlyScheduleEntryId: schedules.monthlyScheduleEntryId })
    .from(schedules)
    .where(schedWhere);

  const attRows = scheduleRows.length
    ? await db.select({ id: attendance.id }).from(attendance).where(inArray(attendance.scheduleId, scheduleRows.map((s) => s.id)))
    : [];

  return { monthlyEntries, scheduleRows, attendanceCount: attRows.length };
}

async function ensureMonthlySchedule(storeId: number, ym: string, actorId: string): Promise<number> {
  const [existing] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, ym)))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db
    .insert(monthlySchedules)
    .values({ storeId, yearMonth: ym, importedBy: actorId, note: 'Auto-created via employee transfer' })
    .returning({ id: monthlySchedules.id });

  return created.id;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export async function previewTransfer(input: TransferInput): Promise<TransferResult<TransferPreview>> {
  const guard = await assertCanTransfer(input.actorId, input.userId, input.toStoreId);
  if (!guard.allowed) return { success: false, error: guard.error };

  const from = startOfDay(input.effectiveFrom ?? new Date());
  const to = input.effectiveTo ? endOfDay(input.effectiveTo) : null;
  if (to && to < from) return { success: false, error: 'End date must be on or after start date.' };

  const isTemp = !!input.isTemporary && !!to;

  const { monthlyEntries, scheduleRows, attendanceCount } = await collectAffectedScheduleData(
    input.userId,
    guard.target.homeStoreId ?? null,
    from,
    isTemp ? to : null,
  );

  const dateSet = new Set<string>();
  for (const e of monthlyEntries) dateSet.add(toIso(new Date(e.date)));
  for (const s of scheduleRows) dateSet.add(toIso(new Date(s.date)));
  const affectedDates = [...dateSet].sort();

  return {
    success: true,
    data: {
      affectedScheduleCount: scheduleRows.length,
      affectedMonthlyEntryCount: monthlyEntries.length,
      attendanceToWipeCount: attendanceCount,
      affectedDates,
      fromStore: guard.target.homeStoreId
        ? {
            id: guard.target.homeStoreId,
            name: guard.target.currentStoreName ?? '—',
            areaName: guard.target.currentStoreAreaName ?? null,
          }
        : null,
      toStore: { id: guard.toStore.id, name: guard.toStore.name, areaName: guard.toStore.areaName },
      user: { id: guard.target.id, name: guard.target.name, nik: guard.target.nik },
      mode: isTemp ? 'temporary' : 'permanent',
      effectiveFrom: from,
      effectiveTo: isTemp ? to : null,
      crossArea: guard.target.currentStoreAreaId != null && guard.target.currentStoreAreaId !== guard.toStore.areaId,
    },
  };
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export async function executeTransfer(input: TransferInput): Promise<TransferResult<{ assignmentId: number; movedSchedules: number; wipedAttendance: number }>> {
  const guard = await assertCanTransfer(input.actorId, input.userId, input.toStoreId);
  if (!guard.allowed) return { success: false, error: guard.error };

  const [role] = await db
    .select({ id: userRoles.id, code: userRoles.code, isActive: userRoles.isActive })
    .from(userRoles)
    .where(eq(userRoles.id, input.roleId))
    .limit(1);

  if (!role || !role.isActive) return { success: false, error: 'Selected role is invalid or inactive.' };
  if (role.code !== 'employee') return { success: false, error: 'Only employee role can be assigned through this flow.' };

  let employeeTypeId: number | null = input.employeeTypeId ?? null;
  if (employeeTypeId != null) {
    const [et] = await db
      .select({ id: employeeTypes.id, code: employeeTypes.code, isActive: employeeTypes.isActive })
      .from(employeeTypes)
      .where(eq(employeeTypes.id, employeeTypeId))
      .limit(1);
    if (!et || !et.isActive) return { success: false, error: 'Selected employee type is invalid or inactive.' };
    // Don't allow assigning OPS types to employees
    if (et.code === 'ops_ho' || et.code === 'ops_area') {
      return { success: false, error: 'OPS employee types cannot be assigned through this flow.' };
    }
  }

  const now = new Date();
  const from = startOfDay(input.effectiveFrom ?? now);
  const to = input.effectiveTo ? endOfDay(input.effectiveTo) : null;
  if (to && to < from) return { success: false, error: 'End date must be on or after start date.' };

  const isTemp = !!input.isTemporary && !!to;

  const [currentUser] = await db
    .select({ homeStoreId: users.homeStoreId, areaId: users.areaId, roleId: users.roleId, employeeTypeId: users.employeeTypeId })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!currentUser) return { success: false, error: 'Target user disappeared mid-transfer.' };

  const window = await collectAffectedScheduleData(input.userId, currentUser.homeStoreId, from, isTemp ? to : null);

  await wipeAttendanceForSchedules(window.scheduleRows.map((s) => s.id));
  await deleteAllTasksForSchedules(window.scheduleRows.map((s) => s.id));

  const ymsAffected = new Set<string>();
  for (const e of window.monthlyEntries) ymsAffected.add(yearMonth(new Date(e.date)));

  const destMonthlyIdByYm = new Map<string, number>();
  for (const ym of ymsAffected) {
    const id = await ensureMonthlySchedule(input.toStoreId, ym, input.actorId);
    destMonthlyIdByYm.set(ym, id);
  }

  for (const entry of window.monthlyEntries) {
    const ym = yearMonth(new Date(entry.date));
    const newMonthlyId = destMonthlyIdByYm.get(ym)!;
    await db
      .update(monthlyScheduleEntries)
      .set({ storeId: input.toStoreId, monthlyScheduleId: newMonthlyId, updatedAt: now })
      .where(eq(monthlyScheduleEntries.id, entry.id));
  }

  if (window.scheduleRows.length > 0) {
    await db
      .update(schedules)
      .set({ storeId: input.toStoreId, updatedAt: now })
      .where(inArray(schedules.id, window.scheduleRows.map((s) => s.id)));
  }

  await db
    .update(userStoreAssignments)
    .set({ isActive: false, effectiveTo: now, updatedAt: now })
    .where(and(eq(userStoreAssignments.userId, input.userId), eq(userStoreAssignments.isActive, true)));

  await db
    .update(users)
    .set({
      roleId: input.roleId,
      employeeTypeId,
      homeStoreId: input.toStoreId,
      areaId: guard.toStore.areaId,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  const [newAssignment] = await db
    .insert(userStoreAssignments)
    .values({
      userId: input.userId,
      storeId: input.toStoreId,
      areaId: guard.toStore.areaId,
      roleId: input.roleId,
      employeeTypeId,
      effectiveFrom: from,
      effectiveTo: isTemp ? to : null,
      isActive: true,
      isTemporary: isTemp,
      previousStoreId: currentUser.homeStoreId,
      previousAreaId: currentUser.areaId,
      previousRoleId: currentUser.roleId,
      previousEmployeeTypeId: currentUser.employeeTypeId,
      assignedBy: input.actorId,
      notes: input.notes ?? null,
    })
    .returning({ id: userStoreAssignments.id });

  return {
    success: true,
    data: {
      assignmentId: newAssignment.id,
      movedSchedules: window.scheduleRows.length,
      wipedAttendance: window.attendanceCount,
    },
  };
}

// ─── Auto-revert ──────────────────────────────────────────────────────────────

export async function autoRevertExpiredTransfers(actorId: string): Promise<TransferResult<{ reverted: number; errors: string[] }>> {
  const access = await getActorAccess(actorId);
  if (!access.allowed) return { success: false, error: access.error };

  const now = new Date();
  const errors: string[] = [];
  let reverted = 0;

  const expired = await db
    .select()
    .from(userStoreAssignments)
    .where(
      and(
        eq(userStoreAssignments.isTemporary, true),
        eq(userStoreAssignments.isActive, true),
        isNotNull(userStoreAssignments.effectiveTo),
        lt(userStoreAssignments.effectiveTo, now),
      ),
    );

  for (const a of expired) {
    if (!a.previousStoreId || !a.previousRoleId) {
      errors.push(`Assignment ${a.id}: missing previous placement.`);
      continue;
    }

    try {
      const revertResult = await executeTransfer({
        actorId,
        userId: a.userId,
        toStoreId: a.previousStoreId,
        roleId: a.previousRoleId,
        employeeTypeId: a.previousEmployeeTypeId ?? null,
        notes: `Auto-revert from temporary transfer #${a.id}`,
        effectiveFrom: now,
        effectiveTo: null,
        isTemporary: false,
      });

      if (!revertResult.success) {
        errors.push(`Assignment ${a.id}: ${revertResult.error}`);
        continue;
      }

      await db.update(userStoreAssignments).set({ revertedAt: now, updatedAt: now }).where(eq(userStoreAssignments.id, a.id));
      reverted++;
    } catch (err) {
      errors.push(`Assignment ${a.id}: ${err}`);
    }
  }

  return { success: true, data: { reverted, errors } };
}

// ─── List employees + stores (HO-aware) ───────────────────────────────────────

export interface ManageEmployeeRow {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  employeeTypeId: number | null;
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
  // Active assignment context
  isTemporary: boolean;
  effectiveTo: Date | null;
  previousStoreName: string | null;
}

export interface ManageStoreRow {
  id: number;
  name: string;
  address: string;
  areaId: number;
  areaName: string;
  employeeCount: number;
}

export interface ManageAreaRow {
  id: number;
  name: string;
  storeCount: number;
  employeeCount: number;
}

export interface ManageLookups {
  employeeTypes: Array<{ id: number; code: string; label: string }>;
  employeeRoleId: number;
}

export async function listManageData(actorId: string): Promise<TransferResult<{
  employees: ManageEmployeeRow[];
  stores: ManageStoreRow[];
  areas: ManageAreaRow[];
  lookups: ManageLookups;
  actor: { isHO: boolean; areaId: number | null };
}>> {
  const access = await getActorAccess(actorId);
  if (!access.allowed) return { success: false, error: access.error };

  const { isHO, areaId: actorAreaId } = access.actor;

  // Areas
  const areaRows = isHO
    ? await db.select().from(areas).orderBy(areas.name)
    : await db.select().from(areas).where(eq(areas.id, actorAreaId!));

  const areaIds = areaRows.map((a) => a.id);

  // Stores within those areas
  const storeRows = areaIds.length
    ? await db
        .select({
          id: stores.id,
          name: stores.name,
          address: stores.address,
          areaId: stores.areaId,
          areaName: areas.name,
        })
        .from(stores)
        .innerJoin(areas, eq(areas.id, stores.areaId))
        .where(inArray(stores.areaId, areaIds))
        .orderBy(areas.name, stores.name)
    : [];

  // Active assignment per user (for is_temporary / effectiveTo + previousStore)
  const employeeRoleRow = await db.select().from(userRoles).where(eq(userRoles.code, 'employee')).limit(1);
  if (!employeeRoleRow[0]) return { success: false, error: 'Employee role not found in DB.' };
  const employeeRoleId = employeeRoleRow[0].id;

  const userRows = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      isActive: users.isActive,
      employeeTypeId: users.employeeTypeId,
      employeeTypeCode: employeeTypes.code,
      employeeTypeLabel: employeeTypes.label,
      homeStoreId: users.homeStoreId,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,
    })
    .from(users)
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(
      and(
        eq(users.roleId, employeeRoleId),
        isHO ? undefined : inArray(stores.areaId, areaIds.length ? areaIds : [-1]),
      ),
    );

  // Active assignments
  const userIds = userRows.map((u) => u.id);
  const assignmentRows = userIds.length
    ? await db.execute(sql`
        SELECT
          a.user_id          AS "userId",
          a.is_temporary     AS "isTemporary",
          a.effective_to     AS "effectiveTo",
          prev.name          AS "previousStoreName"
        FROM user_store_assignments a
        LEFT JOIN stores prev ON prev.id = a.previous_store_id
        WHERE a.is_active = true
          AND a.user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})
      `)
    : { rows: [] } as any;

  const assignments = ((Array.isArray(assignmentRows) ? assignmentRows : (assignmentRows as any).rows) ?? []) as Array<{
    userId: string;
    isTemporary: boolean;
    effectiveTo: string | null;
    previousStoreName: string | null;
  }>;

  const assignmentByUser = new Map(assignments.map((a) => [a.userId, a]));

  const employees: ManageEmployeeRow[] = userRows.map((u) => {
    const a = assignmentByUser.get(u.id);
    return {
      id: u.id,
      nik: u.nik,
      name: u.name,
      isActive: u.isActive,
      employeeTypeId: u.employeeTypeId,
      employeeTypeCode: u.employeeTypeCode,
      employeeTypeLabel: u.employeeTypeLabel,
      homeStoreId: u.homeStoreId,
      storeName: u.storeName,
      areaId: u.areaId,
      areaName: u.areaName,
      isTemporary: !!a?.isTemporary,
      effectiveTo: a?.effectiveTo ? new Date(a.effectiveTo) : null,
      previousStoreName: a?.previousStoreName ?? null,
    };
  });

  // Stores with counts
  const storeCount = new Map<number, number>();
  for (const e of employees) {
    if (e.homeStoreId) storeCount.set(e.homeStoreId, (storeCount.get(e.homeStoreId) ?? 0) + 1);
  }

  const storeOut: ManageStoreRow[] = storeRows.map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    areaId: s.areaId,
    areaName: s.areaName ?? '—',
    employeeCount: storeCount.get(s.id) ?? 0,
  }));

  // Areas with counts
  const areaOut: ManageAreaRow[] = areaRows.map((a) => {
    const storesInArea = storeOut.filter((s) => s.areaId === a.id);
    return {
      id: a.id,
      name: a.name,
      storeCount: storesInArea.length,
      employeeCount: storesInArea.reduce((acc, s) => acc + s.employeeCount, 0),
    };
  });

  // Employee type lookups, excluding ops types
  const empTypeRows = await db
    .select({ id: employeeTypes.id, code: employeeTypes.code, label: employeeTypes.label })
    .from(employeeTypes)
    .where(eq(employeeTypes.isActive, true))
    .orderBy(employeeTypes.sortOrder, employeeTypes.label);

  const lookups: ManageLookups = {
    employeeTypes: empTypeRows.filter((t) => t.code !== 'ops_ho' && t.code !== 'ops_area'),
    employeeRoleId,
  };

  return {
    success: true,
    data: {
      employees,
      stores: storeOut,
      areas: areaOut,
      lookups,
      actor: { isHO: access.actor.isHO, areaId: access.actor.areaId },
    },
  };
}

// ─── User history ─────────────────────────────────────────────────────────────

export async function getUserTransferHistory(actorId: string, userId: string): Promise<TransferResult<Array<{
  id: number;
  storeName: string | null;
  areaName: string | null;
  roleLabel: string | null;
  employeeTypeLabel: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  isTemporary: boolean;
  revertedAt: Date | null;
  previousStoreName: string | null;
  assignedByName: string | null;
  notes: string | null;
}>>> {
  const access = await getActorAccess(actorId);
  if (!access.allowed) return { success: false, error: access.error };

  const [target] = await db
    .select({ id: users.id, roleCode: userRoles.code, homeStoreAreaId: stores.areaId, userAreaId: users.areaId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) return { success: false, error: 'User not found.' };
  if (target.roleCode !== 'employee') return { success: false, error: 'Not an employee.' };

  if (!access.actor.isHO) {
    const areaId = target.homeStoreAreaId ?? target.userAreaId;
    if (areaId && areaId !== access.actor.areaId) {
      return { success: false, error: 'Employee is outside your area.' };
    }
  }

  const rows = await db.execute(sql`
    SELECT
      a.id,
      s.name           AS "storeName",
      ar.name          AS "areaName",
      r.label          AS "roleLabel",
      et.label         AS "employeeTypeLabel",
      a.effective_from AS "effectiveFrom",
      a.effective_to   AS "effectiveTo",
      a.is_active      AS "isActive",
      a.is_temporary   AS "isTemporary",
      a.reverted_at    AS "revertedAt",
      prev_store.name  AS "previousStoreName",
      assigned_by_user.name AS "assignedByName",
      a.notes
    FROM user_store_assignments a
    LEFT JOIN stores s        ON s.id = a.store_id
    LEFT JOIN areas ar        ON ar.id = a.area_id
    LEFT JOIN user_roles r    ON r.id = a.role_id
    LEFT JOIN employee_types et ON et.id = a.employee_type_id
    LEFT JOIN stores prev_store ON prev_store.id = a.previous_store_id
    LEFT JOIN users assigned_by_user ON assigned_by_user.id = a.assigned_by
    WHERE a.user_id = ${userId}
    ORDER BY a.effective_from DESC
  `);

  const list = (Array.isArray(rows) ? rows : (rows as any).rows ?? []) as any[];

  return {
    success: true,
    data: list.map((r) => ({
      id: Number(r.id),
      storeName: r.storeName ?? null,
      areaName: r.areaName ?? null,
      roleLabel: r.roleLabel ?? null,
      employeeTypeLabel: r.employeeTypeLabel ?? null,
      effectiveFrom: new Date(r.effectiveFrom),
      effectiveTo: r.effectiveTo ? new Date(r.effectiveTo) : null,
      isActive: !!r.isActive,
      isTemporary: !!r.isTemporary,
      revertedAt: r.revertedAt ? new Date(r.revertedAt) : null,
      previousStoreName: r.previousStoreName ?? null,
      assignedByName: r.assignedByName ?? null,
      notes: r.notes ?? null,
    })),
  };
}

// ─── Read user's schedule for the next ~30 days at a store (preview) ──────────

export async function getUserScheduleSnapshot(
  actorId: string,
  userId: string,
  storeId: number | null,
  fromDate: Date,
  toDate: Date,
): Promise<TransferResult<Array<{ date: Date; shiftCode: string | null; isOff: boolean; isLeave: boolean }>>> {
  const access = await getActorAccess(actorId);
  if (!access.allowed) return { success: false, error: access.error };

  const conditions = [
    eq(monthlyScheduleEntries.userId, userId),
    gte(monthlyScheduleEntries.date, startOfDay(fromDate)),
    lte(monthlyScheduleEntries.date, endOfDay(toDate)),
  ];
  if (storeId) conditions.push(eq(monthlyScheduleEntries.storeId, storeId));

  const rows = await db
    .select({
      date: monthlyScheduleEntries.date,
      shiftCode: sql<string | null>`shifts.code`,
      isOff: monthlyScheduleEntries.isOff,
      isLeave: monthlyScheduleEntries.isLeave,
    })
    .from(monthlyScheduleEntries)
    .leftJoin(sql`shifts`, sql`shifts.id = ${monthlyScheduleEntries.shiftId}`)
    .where(and(...conditions))
    .orderBy(monthlyScheduleEntries.date);

  return {
    success: true,
    data: rows.map((r) => ({
      date: new Date(r.date),
      shiftCode: r.shiftCode,
      isOff: r.isOff,
      isLeave: r.isLeave,
    })),
  };
}