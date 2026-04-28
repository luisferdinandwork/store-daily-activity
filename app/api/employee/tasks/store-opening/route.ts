// app/api/employee/tasks/store-opening/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitStoreOpening,
  autoSaveStoreOpening,
  type StoreOpeningAutoSavePatch,
} from '@/lib/db/utils/store-opening';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

// ─── POST (final submit) ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  let storeId:    number;
  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId    = toInt(body.storeId,    'storeId');
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const skipGeo          = body.skipGeo === true;
  const rawGeo           = toGeo(body.geo, skipGeo);
  const geo              = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  try {
    const result = await submitStoreOpening({
      scheduleId,
      userId:            session.user.id as string,
      storeId,
      geo,
      skipGeo:           effectiveSkipGeo,
      loginPos:          Boolean(body.loginPos),
      checkAbsenSunfish: Boolean(body.checkAbsenSunfish),
      tarikSohSales:     Boolean(body.tarikSohSales),
      fiveR:             Boolean(body.fiveR),
      // Per-area 5R photos
      fiveRAreaKasirPhotos:  strArr(body.fiveRAreaKasirPhotos),
      fiveRAreaDepanPhotos:  strArr(body.fiveRAreaDepanPhotos),
      fiveRAreaKananPhotos:  strArr(body.fiveRAreaKananPhotos),
      fiveRAreaKiriPhotos:   strArr(body.fiveRAreaKiriPhotos),
      fiveRAreaGudangPhotos: strArr(body.fiveRAreaGudangPhotos),
      cekLamp:           Boolean(body.cekLamp),
      cekSoundSystem:    Boolean(body.cekSoundSystem),
      storeFrontPhotos:  strArr(body.storeFrontPhotos),
      cashierDeskPhotos: strArr(body.cashierDeskPhotos),
      notes:             typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/store-opening]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH (auto-save) ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let storeId: number;
  try { storeId = toInt(body.storeId, 'storeId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: StoreOpeningAutoSavePatch = {};

  if ('loginPos'          in body) patch.loginPos          = Boolean(body.loginPos);
  if ('checkAbsenSunfish' in body) patch.checkAbsenSunfish = Boolean(body.checkAbsenSunfish);
  if ('tarikSohSales'     in body) patch.tarikSohSales     = Boolean(body.tarikSohSales);
  if ('fiveR'             in body) patch.fiveR             = Boolean(body.fiveR);
  if ('cekLamp'           in body) patch.cekLamp           = Boolean(body.cekLamp);
  if ('cekSoundSystem'    in body) patch.cekSoundSystem    = Boolean(body.cekSoundSystem);
  if ('notes'             in body) patch.notes             = typeof body.notes === 'string' ? body.notes : undefined;

  if ('storeFrontPhotos'        in body) patch.storeFrontPhotos        = strArr(body.storeFrontPhotos);
  if ('cashierDeskPhotos'       in body) patch.cashierDeskPhotos       = strArr(body.cashierDeskPhotos);
  if ('fiveRAreaKasirPhotos'    in body) patch.fiveRAreaKasirPhotos    = strArr(body.fiveRAreaKasirPhotos);
  if ('fiveRAreaDepanPhotos'    in body) patch.fiveRAreaDepanPhotos    = strArr(body.fiveRAreaDepanPhotos);
  if ('fiveRAreaKananPhotos'    in body) patch.fiveRAreaKananPhotos    = strArr(body.fiveRAreaKananPhotos);
  if ('fiveRAreaKiriPhotos'     in body) patch.fiveRAreaKiriPhotos     = strArr(body.fiveRAreaKiriPhotos);
  if ('fiveRAreaGudangPhotos'   in body) patch.fiveRAreaGudangPhotos   = strArr(body.fiveRAreaGudangPhotos);

  try {
    const result = await autoSaveStoreOpening(storeId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/store-opening]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}