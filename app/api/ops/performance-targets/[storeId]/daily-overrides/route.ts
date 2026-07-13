// app/api/ops/performance-targets/[storeId]/daily-overrides/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/performance-targets/:storeId/daily-overrides
//   → set one employee's allocation % for one specific day. Everyone else
//     scheduled that same store + day is automatically rebalanced around it.
//   Body: { date: 'YYYY-MM-DD', yearMonth: 'YYYY-MM', userId, percentage }
//
// DELETE /api/ops/performance-targets/:storeId/daily-overrides
//   → clear an employee's override for a day, reverting them (and everyone
//     else that day) back to the default template split.
//   Body: { date: 'YYYY-MM-DD', yearMonth: 'YYYY-MM', userId }
//
// Both return the full recomputed day (computeDailyAllocations) so the UI
// can refresh every row in one round trip.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import {
  clearDailyTargetOverride,
  computeDailyAllocations,
  setDailyTargetOverride,
} from '@/lib/performance/target-utils';

type Params = { params: Promise<{ storeId: string }> };

async function loadStoreInScope(storeId: number, scope: Awaited<ReturnType<typeof resolveOpsScope>>) {
  if (!scope.ok) return null;

  const [store] = await db
    .select({ id: stores.id, areaId: stores.areaId })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return null;
  if (scope.scope === 'area' && store.areaId !== scope.areaId) return null;

  return store;
}

function parseBody(body: any) {
  const date = body?.date as string | undefined;
  const yearMonth = body?.yearMonth as string | undefined;
  const userId = body?.userId as string | undefined;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: 'date (YYYY-MM-DD) is required.' as const };
  }
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return { error: 'yearMonth (YYYY-MM) is required.' as const };
  }
  if (!date.startsWith(yearMonth)) {
    return { error: 'date must fall within yearMonth.' as const };
  }
  if (!userId) {
    return { error: 'userId is required.' as const };
  }

  return { date, yearMonth, userId };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const store = await loadStoreInScope(storeId, scope);
  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseBody(body);
  if ('error' in parsed) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  if (body?.percentage == null || !Number.isFinite(Number(body.percentage))) {
    return NextResponse.json({ success: false, error: 'percentage is required.' }, { status: 400 });
  }

  await setDailyTargetOverride({
    storeId,
    date: parsed.date,
    userId: parsed.userId,
    percentage: Number(body.percentage),
    updatedBy: scope.userId,
  });

  const day = await computeDailyAllocations({ storeId, date: parsed.date, yearMonth: parsed.yearMonth });

  return NextResponse.json({ success: true, day });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { storeId: storeIdRaw } = await params;
  const storeId = Number(storeIdRaw);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'Invalid store id.' }, { status: 400 });
  }

  const store = await loadStoreInScope(storeId, scope);
  if (!store) {
    return NextResponse.json({ success: false, error: 'Store not found or out of scope.' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const parsed = parseBody(body);
  if ('error' in parsed) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
  }

  await clearDailyTargetOverride({ storeId, date: parsed.date, userId: parsed.userId });

  const day = await computeDailyAllocations({ storeId, date: parsed.date, yearMonth: parsed.yearMonth });

  return NextResponse.json({ success: true, day });
}