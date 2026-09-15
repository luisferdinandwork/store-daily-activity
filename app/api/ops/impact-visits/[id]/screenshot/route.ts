// app/api/ops/impact-visits/[id]/screenshot/route.ts
//
// POST — upload the proof screenshot for a Virtual impact visit. Unlike the
// employee task-photo routes, this deliberately accepts a plain file picker
// upload (not a live camera capture) — it's an existing screenshot, not a
// photo taken on the spot.

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { impactVisits, stores, areas } from '@/lib/db/schema';
import { resolveOpsScope } from '@/lib/performance/ops-scope';
import { computeImpactVisitPermissionFlags, serializeImpactVisit } from '@/lib/db/utils/impact-visits';
import { uploadToStorage } from '@/lib/storage';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_MB = 10;

async function loadVisitWithStoreArea(id: number) {
  const [row] = await db
    .select({
      visit: impactVisits,
      storeAreaId: stores.areaId,
      storeName: stores.name,
      storeNo: stores.storeNo,
      areaName: areas.name,
    })
    .from(impactVisits)
    .innerJoin(stores, eq(impactVisits.storeId, stores.id))
    .leftJoin(areas, eq(stores.areaId, areas.id))
    .where(eq(impactVisits.id, id))
    .limit(1);
  return row ?? null;
}

function sanitizeExtension(fileName: string, mimeType: string): string {
  const rawExt = fileName.split('.').pop()?.toLowerCase();
  if (rawExt && /^[a-z0-9]+$/.test(rawExt)) return rawExt;
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const scope = await resolveOpsScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { id } = await params;
  const visitId = Number(id);
  if (!Number.isInteger(visitId) || visitId <= 0) {
    return NextResponse.json({ success: false, error: 'Bad id' }, { status: 400 });
  }

  const found = await loadVisitWithStoreArea(visitId);
  if (!found) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  if (scope.scope === 'area' && found.storeAreaId !== scope.areaId) {
    return NextResponse.json({ success: false, error: 'Out of your area' }, { status: 403 });
  }

  const isHO = scope.scope === 'all_areas';
  const { canEdit } = computeImpactVisitPermissionFlags(found.visit, { userId: scope.userId, isHO });
  if (!canEdit) {
    return NextResponse.json(
      { success: false, error: found.visit.status !== 'draft' ? 'This visit has already been submitted.' : 'Forbidden' },
      { status: 409 },
    );
  }

  if (found.visit.visitType !== 'virtual') {
    return NextResponse.json({ success: false, error: 'This visit is not a Virtual visit.' }, { status: 400 });
  }

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ success: false, error: 'Only JPEG, PNG, or WebP images are allowed.' }, { status: 400 });
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ success: false, error: `File size must be under ${MAX_SIZE_MB}MB` }, { status: 400 });
  }

  const ext = sanitizeExtension(file.name, file.type);
  const key = `impact-visits/${visitId}/screenshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadToStorage(buffer, key, file.type);

  const [updated] = await db
    .update(impactVisits)
    .set({ screenshotUrl: url, updatedAt: new Date() })
    .where(eq(impactVisits.id, visitId))
    .returning();

  return NextResponse.json({
    success: true,
    visit: {
      ...serializeImpactVisit(updated),
      ...computeImpactVisitPermissionFlags(updated, { userId: scope.userId, isHO }),
      store: { name: found.storeName, storeNo: found.storeNo },
      areaName: found.areaName,
    },
  });
}
