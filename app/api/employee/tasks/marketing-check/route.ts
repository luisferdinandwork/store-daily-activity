// app/api/employee/tasks/marketing-check/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  submitMarketingCheck,
  autoSaveMarketingCheck,
  type MarketingCheckAutoSavePatch,
} from '@/lib/db/utils/marketing-check';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
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

  const skipGeo = body.skipGeo === true;
  const rawGeo = toGeo(body.geo, skipGeo);

  try {
    const result = await submitMarketingCheck({
      scheduleId,
      userId: session.user.id as string,
      storeId,
      geo: rawGeo,
      skipGeo,

      promoName: Boolean(body.promoName),
      promoPeriod: Boolean(body.promoPeriod),
      promoMechanism: Boolean(body.promoMechanism),
      randomShoeItems: Boolean(body.randomShoeItems),
      randomNonShoeItems: Boolean(body.randomNonShoeItems),
      sellTag: Boolean(body.sellTag),

      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/marketing-check]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let scheduleId: number;
  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const patch: MarketingCheckAutoSavePatch = {};

  if ('promoName' in body) patch.promoName = Boolean(body.promoName);
  if ('promoPeriod' in body) patch.promoPeriod = Boolean(body.promoPeriod);
  if ('promoMechanism' in body) patch.promoMechanism = Boolean(body.promoMechanism);
  if ('randomShoeItems' in body) patch.randomShoeItems = Boolean(body.randomShoeItems);
  if ('randomNonShoeItems' in body) patch.randomNonShoeItems = Boolean(body.randomNonShoeItems);
  if ('sellTag' in body) patch.sellTag = Boolean(body.sellTag);
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveMarketingCheck(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/marketing-check]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}