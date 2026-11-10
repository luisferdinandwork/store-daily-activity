// app/api/employee/tasks/cek-bin/route.ts
//
// Cek Bin has no submit step: the employee page calls this once when the task is
// opened and the day's task is marked done (idempotent — see completeCekBin). The
// bins and what is wrong in them come live from Business Central: ./results/route.ts.
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { completeCekBin } from '@/lib/db/utils/cek-bin';
import { parseAccuracy, type GeoPoint } from '@/lib/geo';

function toInt(val: unknown, field: string): number {
  const n = Number(val);
  if (!Number.isInteger(n)) throw new Error(`${field} must be a valid integer.`);
  return n;
}

function toGeo(geo: unknown, skipGeo: boolean): GeoPoint | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng, accuracy } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng, accuracy: parseAccuracy(accuracy) };
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

  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId = toInt(body.storeId, 'storeId');
    shiftId = body.shiftId == null ? undefined : toInt(body.shiftId, 'shiftId');
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const skipGeo = body.skipGeo === true;
  const rawGeo = toGeo(body.geo, skipGeo);
  const geo = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  const result = await completeCekBin({
    scheduleId,
    userId: session.user.id,
    storeId,
    shiftId,
    geo,
    skipGeo: effectiveSkipGeo,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
