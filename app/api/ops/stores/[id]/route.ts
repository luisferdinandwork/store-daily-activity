// app/api/ops/stores/[id]/route.ts
//
// PATCH /api/ops/stores/:id
//   → update a store's name, address, latitude/longitude, or geofence radius.
//   → IT only: set the BC dept code (deptCode) and move the store through its
//     lifecycle (status: ready_to_open → active → close, + optional statusNote).
//   → reassign a store to a different area (areaId) — OPS HO only; moving a
//     store between areas is a structural org-chart change, not something an
//     OPS Area user should be able to do (even within/out of their own area).
//
// Access: OPS HO (any store) or OPS Area (only stores in their own area).

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { areas, stores } from '@/lib/db/schema/core';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { resolveItScope } from '@/lib/auth/it-scope';
import { changeStoreStatus } from '@/lib/db/utils/store-status';
import { isStoreStatus } from '@/lib/store-status';

type Params = { params: Promise<{ id: string }> };

const LAT_MIN = -90;
const LAT_MAX = 90;
const LNG_MIN = -180;
const LNG_MAX = 180;

/** Only called when the key is present in the body, so `raw` is null/number/string, never undefined. */
function parseCoordinate(raw: unknown, min: number, max: number): { ok: true; value: string | null } | { ok: false } {
  if (raw === null || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return { ok: false };
  return { ok: true, value: n.toFixed(7) };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }

  const [existing] = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Store not found.' }, { status: 404 });
  }

  if (scope.scope === 'area' && existing.areaId !== scope.areaId) {
    return NextResponse.json(
      { success: false, error: 'Forbidden: this store is outside your assigned area.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const updates: Partial<typeof stores.$inferInsert> = { updatedAt: new Date() };

  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ success: false, error: 'Name cannot be empty.' }, { status: 400 });
    updates.name = name;
  }

  if (typeof body?.address === 'string') {
    const address = body.address.trim();
    if (!address) return NextResponse.json({ success: false, error: 'Address cannot be empty.' }, { status: 400 });
    updates.address = address;
  }

  const wantsLocation =
    'latitude' in (body ?? {}) || 'longitude' in (body ?? {}) || 'geofenceRadiusM' in (body ?? {});

  if (wantsLocation) {
    const itScope = await resolveItScope();
    if (!itScope.ok) {
      return NextResponse.json(
        { success: false, error: "Forbidden: only IT can change a store's location." },
        { status: 403 },
      );
    }
  }

  if ('latitude' in (body ?? {})) {
    const lat = parseCoordinate(body.latitude, LAT_MIN, LAT_MAX);
    if (!lat.ok) return NextResponse.json({ success: false, error: 'Latitude must be between -90 and 90.' }, { status: 400 });
    updates.latitude = lat.value;
  }

  if ('longitude' in (body ?? {})) {
    const lng = parseCoordinate(body.longitude, LNG_MIN, LNG_MAX);
    if (!lng.ok) return NextResponse.json({ success: false, error: 'Longitude must be between -180 and 180.' }, { status: 400 });
    updates.longitude = lng.value;
  }

  if ('geofenceRadiusM' in (body ?? {})) {
    const radius = parseCoordinate(body.geofenceRadiusM, 1, 100_000);
    if (!radius.ok) {
      return NextResponse.json({ success: false, error: 'Geofence radius must be a positive number.' }, { status: 400 });
    }
    updates.geofenceRadiusM = radius.value;
  }

  if ('areaId' in (body ?? {})) {
    if (scope.scope !== 'all_areas') {
      return NextResponse.json(
        { success: false, error: 'Only OPS HO can move a store between areas.' },
        { status: 403 },
      );
    }
    const areaId = Number(body.areaId);
    if (!Number.isInteger(areaId) || areaId <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid areaId.' }, { status: 400 });
    }
    const [areaRow] = await db.select({ id: areas.id }).from(areas).where(eq(areas.id, areaId)).limit(1);
    if (!areaRow) {
      return NextResponse.json({ success: false, error: 'Area not found.' }, { status: 400 });
    }
    updates.areaId = areaId;
  }

  // Dept code + lifecycle are IT-only back-office fields.
  const wantsDeptCode = 'deptCode' in (body ?? {});
  const wantsStatus = 'status' in (body ?? {});
  const isIt = (await resolveItScope()).ok;

  if ((wantsDeptCode || wantsStatus) && !isIt) {
    return NextResponse.json(
      { success: false, error: "Forbidden: only IT can change a store's dept code or status." },
      { status: 403 },
    );
  }

  if (wantsDeptCode) {
    if (body.deptCode === null || body.deptCode === '') {
      updates.deptCode = null;
    } else if (typeof body.deptCode !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid dept code.' }, { status: 400 });
    } else {
      const deptCode = body.deptCode.trim().toUpperCase();
      const [dup] = await db.select({ id: stores.id }).from(stores).where(eq(stores.deptCode, deptCode)).limit(1);
      if (dup && dup.id !== id) {
        return NextResponse.json({ success: false, error: `Dept code "${deptCode}" is already used by another store.` }, { status: 409 });
      }
      updates.deptCode = deptCode;
    }
  }

  // Status first — it can be refused (bad transition, or the future Audit
  // close-out) and then nothing else should have been saved.
  if (wantsStatus && body.status !== existing.status) {
    if (!isStoreStatus(body.status)) {
      return NextResponse.json({ success: false, error: 'Invalid status.' }, { status: 400 });
    }
    const changed = await changeStoreStatus({
      storeId: id,
      to: body.status,
      actorId: scope.userId,
      note: typeof body.statusNote === 'string' ? body.statusNote : null,
    });
    if (!changed.success) {
      return NextResponse.json({ success: false, error: changed.error }, { status: 400 });
    }
  }

  const [updated] = await db.update(stores).set(updates).where(eq(stores.id, id)).returning();

  const { deptCode, ...publicStore } = updated;
  return NextResponse.json({ success: true, store: isIt ? { ...publicStore, deptCode } : publicStore });
}
