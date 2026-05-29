// app/api/ops/issues/route.ts
//
// GET — issues routed to the Ops role that the current Ops user may follow up.
//
//   • Ops HO  (employeeType 'ops_ho')  → sees every Ops-assigned issue, all areas
//   • Ops Area (employeeType 'ops_area') → sees only issues whose store is in
//                                          their assigned area
//   • admin                            → treated as HO
//
// Returns the full in-scope set (all statuses). Status/store filtering is done
// client-side so the stat cards and store dropdown stay complete and snappy.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, stores, areas, users, userRoles, employeeTypes } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

function parseUrls(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as string[];
  try { const p = JSON.parse(v as string); return Array.isArray(p) ? p : []; }
  catch { return []; }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = (session.user as any).id as string;

  // Authoritative actor info (don't trust the session for scoping).
  const [actor] = await db
    .select({
      id:        users.id,
      areaId:    users.areaId,
      roleCode:  userRoles.code,
      empType:   employeeTypes.code,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId));

  if (!actor || (actor.roleCode !== 'ops' && actor.roleCode !== 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isHO = actor.empType === 'ops_ho' || actor.roleCode === 'admin';

  const [opsRole] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.code, 'ops'));

  if (!opsRole) return NextResponse.json({ error: 'Ops role missing' }, { status: 500 });

  const conditions = [eq(issues.assignedToRoleId, opsRole.id)];
  if (!isHO) {
    // Area user with no area → nothing in scope.
    if (actor.areaId == null) {
      return NextResponse.json({ success: true, isHO, area: null, issues: [] });
    }
    conditions.push(eq(stores.areaId, actor.areaId));
  }

  const rows = await db
    .select({
      id: issues.id, title: issues.title, description: issues.description,
      status: issues.status, attachmentUrls: issues.attachmentUrls,
      reviewedAt: issues.reviewedAt, reviewedBy: issues.reviewedBy,
      createdAt: issues.createdAt, updatedAt: issues.updatedAt,
      storeId: stores.id, storeName: stores.name,
      areaId: areas.id, areaName: areas.name,
      reporterId: users.id, reporterName: users.name, reporterNik: users.nik,
    })
    .from(issues)
    .innerJoin(stores, eq(issues.storeId, stores.id))
    .innerJoin(areas, eq(stores.areaId, areas.id))
    .innerJoin(users, eq(issues.userId, users.id))
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt));

  const out = rows.map(r => ({
    id:          String(r.id),
    title:       r.title,
    description: r.description,
    status:      r.status,
    attachmentUrls: parseUrls(r.attachmentUrls),
    reviewedAt:  r.reviewedAt,
    reviewedBy:  r.reviewedBy,
    createdAt:   r.createdAt,
    updatedAt:   r.updatedAt,
    store:    { id: String(r.storeId), name: r.storeName, areaId: String(r.areaId), areaName: r.areaName },
    reporter: { id: r.reporterId, name: r.reporterName, nik: r.reporterNik },
  }));

  // For the area-user, surface their area name for the header.
  const area = (!isHO && rows[0]) ? { id: String(rows[0].areaId), name: rows[0].areaName } : null;

  return NextResponse.json({ success: true, isHO, area, issues: out });
}