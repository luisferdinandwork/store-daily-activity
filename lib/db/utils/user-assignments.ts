// lib/db/utils/user-assignments.ts
import { db } from '@/lib/db';
import {
  areas,
  stores,
  users,
  userRoles,
  employeeTypes,
  userStoreAssignments,
} from '@/lib/db/schema';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

export type UserAssignmentResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface UpdateUserAssignmentInput {
  actorId: string;
  userId: string;
  storeId: number;
  roleId: number;
  employeeTypeId?: number | null;
  notes?: string | null;
}

export interface OpsManagedUserRow {
  id: string;
  nik: string;
  name: string;
  isActive: boolean;
  roleId: number;
  roleCode: string | null;
  roleLabel: string | null;
  employeeTypeId: number | null;
  employeeTypeCode: string | null;
  employeeTypeLabel: string | null;
  homeStoreId: number | null;
  storeName: string | null;
  areaId: number | null;
  areaName: string | null;
  updatedAt: Date;
}

async function getOpsActor(actorId: string) {
  const [actor] = await db
    .select({
      id: users.id,
      areaId: users.areaId,
      roleCode: userRoles.code,
      roleActive: userRoles.isActive,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.id, users.roleId))
    .where(eq(users.id, actorId))
    .limit(1);

  if (!actor) return { allowed: false as const, error: 'Actor not found.' };
  if (!actor.roleActive) return { allowed: false as const, error: 'Your role is inactive.' };
  if (actor.roleCode !== 'ops' && actor.roleCode !== 'admin') {
    return { allowed: false as const, error: 'Only OPS/Admin can manage employee assignments.' };
  }
  if (actor.roleCode === 'ops' && !actor.areaId) {
    return { allowed: false as const, error: 'OPS user has no area assigned.' };
  }

  return { allowed: true as const, actor };
}

async function assertStoreInActorArea(actorId: string, storeId: number) {
  const auth = await getOpsActor(actorId);
  if (!auth.allowed) return auth;

  const [store] = await db
    .select({
      id: stores.id,
      areaId: stores.areaId,
      areaName: areas.name,
      storeName: stores.name,
    })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return { allowed: false as const, error: 'Target store not found.' };

  if (auth.actor.roleCode === 'ops' && store.areaId !== auth.actor.areaId) {
    return { allowed: false as const, error: 'Target store is not inside your OPS area.' };
  }

  return { allowed: true as const, actor: auth.actor, store };
}

async function assertCanManageUser(actorId: string, userId: string) {
  const auth = await getOpsActor(actorId);
  if (!auth.allowed) return auth;

  const [target] = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      roleCode: userRoles.code,
      homeStoreId: users.homeStoreId,
      userAreaId: users.areaId,
      homeStoreAreaId: stores.areaId,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) return { allowed: false as const, error: 'Target user not found.' };

  if (auth.actor.roleCode === 'ops') {
    const targetAreaId = target.homeStoreAreaId ?? target.userAreaId;
    if (targetAreaId && targetAreaId !== auth.actor.areaId) {
      return { allowed: false as const, error: 'You can only manage users inside your OPS area.' };
    }
  }

  return { allowed: true as const, actor: auth.actor, target };
}

export async function listAssignableLookups(actorId: string) {
  const auth = await getOpsActor(actorId);
  if (!auth.allowed) return { success: false as const, error: auth.error };

  const [storeRows, roleRows, employeeTypeRows] = await Promise.all([
    auth.actor.roleCode === 'admin'
      ? db
          .select({
            id: stores.id,
            name: stores.name,
            areaId: stores.areaId,
            areaName: areas.name,
          })
          .from(stores)
          .leftJoin(areas, eq(areas.id, stores.areaId))
          .orderBy(areas.name, stores.name)
      : db
          .select({
            id: stores.id,
            name: stores.name,
            areaId: stores.areaId,
            areaName: areas.name,
          })
          .from(stores)
          .leftJoin(areas, eq(areas.id, stores.areaId))
          .where(eq(stores.areaId, auth.actor.areaId!))
          .orderBy(stores.name),

    db
      .select({
        id: userRoles.id,
        code: userRoles.code,
        label: userRoles.label,
      })
      .from(userRoles)
      .where(eq(userRoles.isActive, true))
      .orderBy(userRoles.sortOrder, userRoles.label),

    db
      .select({
        id: employeeTypes.id,
        code: employeeTypes.code,
        label: employeeTypes.label,
      })
      .from(employeeTypes)
      .where(eq(employeeTypes.isActive, true))
      .orderBy(employeeTypes.sortOrder, employeeTypes.label),
  ]);

  return {
    success: true as const,
    data: {
      stores: storeRows,
      roles: roleRows,
      employeeTypes: employeeTypeRows,
    },
  };
}

export async function listOpsManagedUsers(
  actorId: string,
  query = '',
): Promise<UserAssignmentResult<{
  users: OpsManagedUserRow[];
  stores: Awaited<ReturnType<typeof listAssignableLookups>> extends infer R
    ? R extends { success: true; data: infer D }
      ? D extends { stores: infer S }
        ? S
        : never
      : never
    : never;
  roles: Array<{ id: number; code: string; label: string }>;
  employeeTypes: Array<{ id: number; code: string; label: string }>;
}>> {
  const auth = await getOpsActor(actorId);
  if (!auth.allowed) return { success: false, error: auth.error };

  const lookups = await listAssignableLookups(actorId);
  if (!lookups.success) return { success: false, error: lookups.error };

  const cleanedQuery = query.trim();

  const conditions = [];

  if (auth.actor.roleCode === 'ops') {
    conditions.push(or(eq(stores.areaId, auth.actor.areaId!), eq(users.areaId, auth.actor.areaId!)));
  }

  if (cleanedQuery) {
    conditions.push(
      or(
        ilike(users.name, `%${cleanedQuery}%`),
        ilike(users.nik, `%${cleanedQuery}%`),
        ilike(stores.name, `%${cleanedQuery}%`),
      ),
    );
  }

  const rows = await db
    .select({
      id: users.id,
      nik: users.nik,
      name: users.name,
      isActive: users.isActive,
      roleId: users.roleId,
      roleCode: userRoles.code,
      roleLabel: userRoles.label,
      employeeTypeId: users.employeeTypeId,
      employeeTypeCode: employeeTypes.code,
      employeeTypeLabel: employeeTypes.label,
      homeStoreId: users.homeStoreId,
      storeName: stores.name,
      areaId: areas.id,
      areaName: areas.name,
      updatedAt: users.updatedAt,
    })
    .from(users)
    .leftJoin(userRoles, eq(userRoles.id, users.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
    .leftJoin(stores, eq(stores.id, users.homeStoreId))
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(conditions.length ? and(...conditions) : sql`true`)
    .orderBy(stores.name, users.name);

  return {
    success: true,
    data: {
      users: rows,
      stores: lookups.data.stores,
      roles: lookups.data.roles,
      employeeTypes: lookups.data.employeeTypes,
    },
  };
}

export async function getUserAssignmentHistory(
  actorId: string,
  userId: string,
): Promise<UserAssignmentResult<Array<{
  id: number;
  storeName: string | null;
  areaName: string | null;
  roleLabel: string | null;
  employeeTypeLabel: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  isActive: boolean;
  assignedByName: string | null;
  notes: string | null;
}>>> {
  const auth = await assertCanManageUser(actorId, userId);
  if (!auth.allowed) return { success: false, error: auth.error };

  const assignedBy = users;

  const rows = await db
    .select({
      id: userStoreAssignments.id,
      storeName: stores.name,
      areaName: areas.name,
      roleLabel: userRoles.label,
      employeeTypeLabel: employeeTypes.label,
      effectiveFrom: userStoreAssignments.effectiveFrom,
      effectiveTo: userStoreAssignments.effectiveTo,
      isActive: userStoreAssignments.isActive,
      assignedByName: assignedBy.name,
      notes: userStoreAssignments.notes,
    })
    .from(userStoreAssignments)
    .leftJoin(stores, eq(stores.id, userStoreAssignments.storeId))
    .leftJoin(areas, eq(areas.id, userStoreAssignments.areaId))
    .leftJoin(userRoles, eq(userRoles.id, userStoreAssignments.roleId))
    .leftJoin(employeeTypes, eq(employeeTypes.id, userStoreAssignments.employeeTypeId))
    .leftJoin(assignedBy, eq(assignedBy.id, userStoreAssignments.assignedBy))
    .where(eq(userStoreAssignments.userId, userId))
    .orderBy(desc(userStoreAssignments.effectiveFrom));

  return { success: true, data: rows };
}

export async function updateUserAssignment(
  input: UpdateUserAssignmentInput,
): Promise<UserAssignmentResult<{ userId: string }>> {
  const userAuth = await assertCanManageUser(input.actorId, input.userId);
  if (!userAuth.allowed) return { success: false, error: userAuth.error };

  const storeAuth = await assertStoreInActorArea(input.actorId, input.storeId);
  if (!storeAuth.allowed) return { success: false, error: storeAuth.error };

  const [role] = await db
    .select({
      id: userRoles.id,
      code: userRoles.code,
      isActive: userRoles.isActive,
    })
    .from(userRoles)
    .where(eq(userRoles.id, input.roleId))
    .limit(1);

  if (!role || !role.isActive) {
    return { success: false, error: 'Selected role is invalid or inactive.' };
  }

  let employeeTypeId: number | null = input.employeeTypeId ?? null;

  if (employeeTypeId != null) {
    const [employeeType] = await db
      .select({
        id: employeeTypes.id,
        isActive: employeeTypes.isActive,
      })
      .from(employeeTypes)
      .where(eq(employeeTypes.id, employeeTypeId))
      .limit(1);

    if (!employeeType || !employeeType.isActive) {
      return { success: false, error: 'Selected employee type is invalid or inactive.' };
    }
  }

  if (role.code !== 'employee') {
    employeeTypeId = null;
  }

  const now = new Date();

  await db
    .update(userStoreAssignments)
    .set({
      isActive: false,
      effectiveTo: now,
      updatedAt: now,
    })
    .where(and(eq(userStoreAssignments.userId, input.userId), eq(userStoreAssignments.isActive, true)));

  await db
    .update(users)
    .set({
      roleId: input.roleId,
      employeeTypeId,
      homeStoreId: input.storeId,
      areaId: storeAuth.store.areaId,
      updatedAt: now,
    })
    .where(eq(users.id, input.userId));

  await db.insert(userStoreAssignments).values({
    userId: input.userId,
    storeId: input.storeId,
    areaId: storeAuth.store.areaId,
    roleId: input.roleId,
    employeeTypeId,
    effectiveFrom: now,
    isActive: true,
    assignedBy: input.actorId,
    notes: input.notes ?? null,
  });

  return { success: true, data: { userId: input.userId } };
}
