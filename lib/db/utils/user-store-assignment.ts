// lib/db/utils/user-store-assignment.ts
//
// Single writer for "which store/area/role is this user assigned to right
// now" — keeps `users.homeStoreId`/`areaId` (the fast-read denormalized
// columns) and `userStoreAssignments` (the append-only history log other
// reports read the *active* roster from, e.g. app/api/pic/schedule/template
// and app/api/ops/stores) in sync. Before this helper existed, IT Users
// management only wrote `users` on edit, silently drifting from the history
// table. Every writer of a user's home store (create, edit, roster assign,
// Excel import) should go through here instead of touching either table
// directly.
//
// Sequential awaited writes, not a transaction — this codebase avoids
// db.transaction() (Neon-HTTP-safe convention, see CLAUDE.md), same as
// app/api/ops/areas/[id]/assign/route.ts.

import { db } from '@/lib/db';
import { users, userStoreAssignments } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

export interface SetUserHomeStoreParams {
  userId: string;
  /** null = unassign (clear home store, close out the active assignment row) */
  homeStoreId: number | null;
  areaId: number | null;
  roleId: number;
  employeeTypeId: number | null;
  assignedBy: string | null;
  notes?: string | null;
}

export async function setUserHomeStore(params: SetUserHomeStoreParams): Promise<void> {
  const { userId, homeStoreId, areaId, roleId, employeeTypeId, assignedBy, notes } = params;

  await db
    .update(users)
    .set({ homeStoreId, areaId, roleId, employeeTypeId, updatedAt: new Date() })
    .where(eq(users.id, userId));

  await db
    .update(userStoreAssignments)
    .set({ isActive: false, effectiveTo: new Date(), updatedAt: new Date() })
    .where(and(eq(userStoreAssignments.userId, userId), eq(userStoreAssignments.isActive, true)));

  if (homeStoreId != null) {
    await db.insert(userStoreAssignments).values({
      userId,
      storeId: homeStoreId,
      areaId,
      roleId,
      employeeTypeId,
      isActive: true,
      assignedBy,
      notes: notes ?? null,
    });
  }
}
