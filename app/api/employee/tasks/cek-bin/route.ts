// app/api/employee/tasks/cek-bin/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  autoSaveCekBin,
  getCekBinById,
  submitCekBin,
  type AutoSaveCekBinInput,
  type CekBinSelectedBinInput,
} from '@/lib/db/utils/cek-bin';

function toInt(val: unknown, field: string): number {
  const n = Number(val);
  if (!Number.isInteger(n)) throw new Error(`${field} must be a valid integer.`);
  return n;
}

function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

function parseSelectedBins(raw: unknown): CekBinSelectedBinInput[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`selectedBins[${index}] must be an object.`);
    }

    const row = item as Record<string, unknown>;

    return {
      binId: toInt(row.binId, `selectedBins[${index}].binId`),
      qtyBc: toInt(row.qtyBc, `selectedBins[${index}].qtyBc`),
      qtySesuaiBin: toInt(row.qtySesuaiBin, `selectedBins[${index}].qtySesuaiBin`),
      qtyTidakSesuaiBin: toInt(row.qtyTidakSesuaiBin, `selectedBins[${index}].qtyTidakSesuaiBin`),
      notes: typeof row.notes === 'string' ? row.notes : undefined,
    };
  });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const taskId = Number(searchParams.get('taskId') ?? searchParams.get('id'));

  if (!Number.isInteger(taskId)) {
    return NextResponse.json({ success: false, error: 'taskId is required.' }, { status: 400 });
  }

  const result = await getCekBinById(taskId);
  return NextResponse.json(result, { status: result.success ? 200 : 404 });
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
  let shiftId: number | undefined;
  let selectedBins: CekBinSelectedBinInput[];

  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId = toInt(body.storeId, 'storeId');
    shiftId = body.shiftId == null ? undefined : toInt(body.shiftId, 'shiftId');
    selectedBins = parseSelectedBins(body.selectedBins);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const skipGeo = body.skipGeo === true;
  const rawGeo = toGeo(body.geo, skipGeo);
  const geo = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  const result = await submitCekBin({
    scheduleId,
    userId: session.user.id,
    storeId,
    shiftId,
    geo,
    skipGeo: effectiveSkipGeo,
    selectedBins,
    notes: typeof body.notes === 'string' ? body.notes : undefined,
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

  let taskId: number;
  try {
    taskId = toInt(body.taskId, 'taskId');
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const patch: AutoSaveCekBinInput = {};

  try {
    if ('selectedBins' in body) patch.selectedBins = parseSelectedBins(body.selectedBins);
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  const result = await autoSaveCekBin(taskId, patch);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
