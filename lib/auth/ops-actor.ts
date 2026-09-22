// lib/auth/ops-actor.ts
// ─────────────────────────────────────────────────────────────────────────────
// The ONE definition of "is this user an OPS actor, and what can they see".
//
// app/api/ops/tasks/_helpers.ts and app/api/ops/schedules/_helpers.ts each used to
// carry their own copy of getOpsActor(), and the copies had drifted apart:
//   • the schedules copy never checked users.isActive, and
//   • it granted OPS access from employeeType alone (no `role === 'ops'` needed).
// Both now delegate here.
//
// Rules:
//   • the account must exist and be active
//   • role must be 'it' (super-admin → all areas) or 'ops'
//   • an 'ops' user must have employeeType 'ops_ho' (all areas) or 'ops_area' (own area)
//   • anything else (incl. role 'ops' with no/unknown employee type) → not an OPS actor
// ─────────────────────────────────────────────────────────────────────────────

import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { employeeTypes, userRoles, users } from '@/lib/db/schema';

export interface OpsActorRecord {
  id: string;
  role: string;
  employeeType: string | null;
  areaId: number | null;
  /** IT or OPS HO — may act on every area. */
  isHO: boolean;
  isOpsHo: boolean;
  isOpsArea: boolean;
}

export async function loadOpsActor(userId: string): Promise<OpsActorRecord | null> {
  const [row] = await db
    .select({
      id: users.id,
      role: userRoles.code,
      roleActive: userRoles.isActive,
      employeeType: employeeTypes.code,
      areaId: users.areaId,
    })
    .from(users)
    .innerJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(and(eq(users.id, userId), eq(users.isActive, true)))
    .limit(1);

  if (!row || !row.roleActive) return null;

  const isIt = row.role === 'it';
  if (row.role !== 'ops' && !isIt) return null;

  const isOpsHo = isIt || row.employeeType === 'ops_ho';
  const isOpsArea = !isIt && row.employeeType === 'ops_area';

  // Only these two OPS types exist; a generic/misconfigured ops user gets no access.
  if (!isOpsHo && !isOpsArea) return null;

  return {
    id: row.id,
    role: row.role,
    employeeType: row.employeeType ?? null,
    areaId: row.areaId ?? null,
    isHO: isOpsHo,
    isOpsHo,
    isOpsArea,
  };
}
