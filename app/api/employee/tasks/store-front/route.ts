// app/api/employee/tasks/store-front/route.ts
// Replacement route. Accepts taskId + scheduleId, and passes actor data to util.

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
  if (Number.isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function toOptionalInt(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? undefined : n;
}

function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toStrArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

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
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const taskId = toOptionalInt(body.taskId);
  const skipGeo = body.skipGeo === true;
  const rawGeo = toGeo(body.geo, skipGeo);
  const geo = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  try {
    const result = await submitStoreFront({
      taskId,
      scheduleId,
      userId: session.user.id,
      storeId,
      geo,
      skipGeo: effectiveSkipGeo,
      storefrontPhotos: toStrArray(body.storefrontPhotos),
      rollingDoorClosedPhoto: toStr(body.rollingDoorClosedPhoto),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/store-front]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

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
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const patch: AutoSaveStoreFrontInput = {
    userId: session.user.id,
  };

  const scheduleId = toOptionalInt(body.scheduleId);
  if (scheduleId) patch.scheduleId = scheduleId;

  if ('storefrontPhotos' in body) patch.storefrontPhotos = toStrArray(body.storefrontPhotos);
  if ('rollingDoorClosedPhoto' in body) patch.rollingDoorClosedPhoto = toStr(body.rollingDoorClosedPhoto);
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveStoreFront(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/store-front]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
