// app/api/employee/tasks/marketing-check/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import {
  autoSaveMarketingCheck,
  submitMarketingCheck,
  type AutoSaveMarketingCheckInput,
} from '@/lib/db/utils/marketing-check';

function toInt(value: unknown, field: string): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a valid positive integer.`);
  }
  return parsed;
}

function optionalInt(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toBool(value: unknown): boolean {
  return value === true;
}

function readGeo(value: unknown): { lat: number; lng: number } | null {
  if (!value || typeof value !== 'object') return null;

  const geo = value as Record<string, unknown>;
  return typeof geo.lat === 'number' && typeof geo.lng === 'number'
    ? { lat: geo.lat, lng: geo.lng }
    : null;
}

function readNotes(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readPatch(body: Record<string, unknown>): AutoSaveMarketingCheckInput {
  const patch: AutoSaveMarketingCheckInput = {};

  if ('taskId' in body) patch.taskId = optionalInt(body.taskId);
  if ('scheduleId' in body) patch.scheduleId = optionalInt(body.scheduleId);
  if ('storeId' in body) patch.storeId = optionalInt(body.storeId);

  if ('promoName' in body) patch.promoName = toBool(body.promoName);
  if ('promoPeriod' in body) patch.promoPeriod = toBool(body.promoPeriod);
  if ('promoMechanism' in body) patch.promoMechanism = toBool(body.promoMechanism);
  if ('randomShoeItems' in body) patch.randomShoeItems = toBool(body.randomShoeItems);
  if ('randomNonShoeItems' in body) patch.randomNonShoeItems = toBool(body.randomNonShoeItems);
  if ('sellTag' in body) patch.sellTag = toBool(body.sellTag);
  if ('notes' in body) patch.notes = readNotes(body.notes) ?? null;

  patch.geo = readGeo(body.geo);
  patch.skipGeo = body.skipGeo === true;

  return patch;
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
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  let scheduleId: number;
  let storeId: number;
  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId = toInt(body.storeId, 'storeId');
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 400 });
  }

  const geo = readGeo(body.geo);
  if (!geo && body.skipGeo !== true) {
    return NextResponse.json({ success: false, error: 'Lokasi wajib aktif.' }, { status: 400 });
  }

  const result = await submitMarketingCheck({
    taskId: optionalInt(body.taskId),
    scheduleId,
    userId: session.user.id,
    storeId,
    geo: geo ?? { lat: 0, lng: 0 },
    skipGeo: body.skipGeo === true,
    promoName: toBool(body.promoName),
    promoPeriod: toBool(body.promoPeriod),
    promoMechanism: toBool(body.promoMechanism),
    randomShoeItems: toBool(body.randomShoeItems),
    randomNonShoeItems: toBool(body.randomNonShoeItems),
    sellTag: toBool(body.sellTag),
    notes: readNotes(body.notes),
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
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
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const patch = readPatch(body);
  if (!patch.taskId && !patch.scheduleId) {
    return NextResponse.json(
      { success: false, error: 'taskId or scheduleId is required.' },
      { status: 400 },
    );
  }

  patch.userId = session.user.id;

  const result = await autoSaveMarketingCheck(patch);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
