// app/api/ops/areas/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// OPS HO only — the "Area Management" menu's data source.
//
// GET  → every area with its store roster and the one OPS Area user (if any)
//        responsible for it, plus the full OPS Area user roster (for the
//        assignment picker — including unassigned users and, for each, which
//        area they're already covering).
// POST → create a new area.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { areas, stores, users } from '@/lib/db/schema/core';
import { employeeTypes } from '@/lib/db/schema/lookups';
import { getOpsActor } from '@/app/api/ops/tasks/_helpers';

export const dynamic = 'force-dynamic';

export interface AreaSettingsRow {
  id: number;
  name: string;
  storeCount: number;
  stores: { id: number; name: string; storeNo: string }[];
  opsUser: { id: string; name: string; nik: string } | null;
}

export interface OpsAreaUserRow {
  id: string;
  name: string;
  nik: string;
  areaId: number | null;
  areaName: string | null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor(userId);
  if (!actor?.isOpsHo) {
    return NextResponse.json({ success: false, error: 'OPS HO access only.' }, { status: 403 });
  }

  try {
    const [areaRows, storeRows, opsUserRows] = await Promise.all([
      db.select().from(areas).orderBy(areas.name),
      db.select({ id: stores.id, name: stores.name, storeNo: stores.storeNo, areaId: stores.areaId }).from(stores).orderBy(stores.name),
      db
        .select({ id: users.id, name: users.name, nik: users.nik, areaId: users.areaId })
        .from(users)
        .innerJoin(employeeTypes, eq(employeeTypes.id, users.employeeTypeId))
        .where(eq(employeeTypes.code, 'ops_area'))
        .orderBy(users.name),
    ]);

    const areaNameById = new Map(areaRows.map((a) => [a.id, a.name]));
    const opsUserByAreaId = new Map(opsUserRows.filter((u) => u.areaId != null).map((u) => [u.areaId as number, u]));
    const storesByAreaId = new Map<number, typeof storeRows>();
    for (const s of storeRows) {
      const list = storesByAreaId.get(s.areaId) ?? [];
      list.push(s);
      storesByAreaId.set(s.areaId, list);
    }

    const areasOut: AreaSettingsRow[] = areaRows.map((a) => {
      const areaStores = storesByAreaId.get(a.id) ?? [];
      const opsUser = opsUserByAreaId.get(a.id);
      return {
        id: a.id,
        name: a.name,
        storeCount: areaStores.length,
        stores: areaStores.map((s) => ({ id: s.id, name: s.name, storeNo: s.storeNo })),
        opsUser: opsUser ? { id: opsUser.id, name: opsUser.name, nik: opsUser.nik } : null,
      };
    });

    const opsUsersOut: OpsAreaUserRow[] = opsUserRows.map((u) => ({
      id: u.id,
      name: u.name,
      nik: u.nik,
      areaId: u.areaId,
      areaName: u.areaId != null ? (areaNameById.get(u.areaId) ?? null) : null,
    }));

    return NextResponse.json({ success: true, areas: areasOut, opsUsers: opsUsersOut });
  } catch (err) {
    console.error('GET /api/ops/areas failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to load areas' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor(userId);
  if (!actor?.isOpsHo) {
    return NextResponse.json({ success: false, error: 'OPS HO access only.' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return NextResponse.json({ success: false, error: 'Area name is required.' }, { status: 400 });
  }

  try {
    const [created] = await db.insert(areas).values({ name }).returning();
    return NextResponse.json({ success: true, area: created });
  } catch (err) {
    console.error('POST /api/ops/areas failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to create area' }, { status: 500 });
  }
}
