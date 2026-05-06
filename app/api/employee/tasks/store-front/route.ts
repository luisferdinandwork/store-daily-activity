// app/api/employee/tasks/store-front/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  submitStoreFront,
  autoSaveStoreFront,
  type AutoSaveStoreFrontInput,
} from '@/lib/db/utils/store-front';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (Number.isNaN(n)) {
    throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  }
  return n;
}

function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;

  const { lat, lng } = geo as Record<string, unknown>;

  const latNumber = typeof lat === 'number' ? lat : Number(lat);
  const lngNumber = typeof lng === 'number' ? lng : Number(lng);

  if (!Number.isFinite(latNumber) || !Number.isFinite(lngNumber)) return null;

  return { lat: latNumber, lng: lngNumber };
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toOptionalStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function toStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof v === 'string' && v.trim().length > 0) {
    return [v];
  }

  return [];
}

function readStorefrontPhotos(body: Record<string, unknown>): string[] {
  const storefrontPhotos = toStringArray(body.storefrontPhotos);

  if (storefrontPhotos.length > 0) {
    return storefrontPhotos;
  }

  // Backward compatibility for the older API/page shape.
  return [
    toStr(body.storefrontStaffOnePhoto),
    toStr(body.storefrontStaffTwoPhoto),
  ].filter((url) => url.trim().length > 0);
}

// ─── POST — final submit ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let scheduleId: number;
  let storeId: number;

  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId = toInt(body.storeId, 'storeId');
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const skipGeo = body.skipGeo === true;
  const rawGeo = toGeo(body.geo, skipGeo);
  const geo = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  try {
    const result = await submitStoreFront({
      scheduleId,
      userId: session.user.id,
      storeId,
      geo,
      skipGeo: effectiveSkipGeo,
      storefrontPhotos: readStorefrontPhotos(body),
      rollingDoorClosedPhoto: toStr(body.rollingDoorClosedPhoto),
      notes: toOptionalStr(body.notes),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/store-front]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// ─── PATCH — auto-save ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let taskId: number;

  try {
    taskId = toInt(body.taskId, 'taskId');
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const patch: AutoSaveStoreFrontInput = {};

  if ('storefrontPhotos' in body) {
    patch.storefrontPhotos = toStringArray(body.storefrontPhotos);
  } else if ('storefrontStaffOnePhoto' in body || 'storefrontStaffTwoPhoto' in body) {
    // Backward compatibility for the older API/page shape.
    patch.storefrontPhotos = readStorefrontPhotos(body);
  }

  if ('rollingDoorClosedPhoto' in body) {
    patch.rollingDoorClosedPhoto = toStr(body.rollingDoorClosedPhoto);
  }

  if ('notes' in body) {
    patch.notes = toOptionalStr(body.notes);
  }

  try {
    const result = await autoSaveStoreFront(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/store-front]', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
