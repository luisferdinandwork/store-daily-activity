// app/api/employee/tasks/store-opening/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated endpoint for the Store Opening task.
//   POST  → final submit (runs check-in + geofence + checklist/photo validation)
//   PATCH → auto-save partial patch (status: pending → in_progress)
// ─────────────────────────────────────────────────────────────────────────────

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
      userId:                   session.user.id as string,
      storeId,
      geo,
      skipGeo:                  effectiveSkipGeo,
      loginPos:                 Boolean(body.loginPos),
      checkAbsenSunfish:        Boolean(body.checkAbsenSunfish),
      tarikSohSales:            Boolean(body.tarikSohSales),
      fiveR:                    Boolean(body.fiveR),
      fiveRPhotos:              strArr(body.fiveRPhotos),
      cekPromo:                 Boolean(body.cekPromo),
      cekPromoStorefrontPhotos: strArr(body.cekPromoStorefrontPhotos),
      cekPromoDeskPhotos:       strArr(body.cekPromoDeskPhotos),
      cekLamp:                  Boolean(body.cekLamp),
      cekSoundSystem:           Boolean(body.cekSoundSystem),
      storeFrontPhotos:         strArr(body.storeFrontPhotos),
      cashierDeskPhotos:        strArr(body.cashierDeskPhotos),
      notes:                    typeof body.notes === 'string' ? body.notes : undefined,
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

  let scheduleId: number;
  try { scheduleId = toInt(body.scheduleId, 'scheduleId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: StoreOpeningAutoSavePatch = {};

  if ('loginPos'          in body) patch.loginPos          = Boolean(body.loginPos);
  if ('checkAbsenSunfish' in body) patch.checkAbsenSunfish = Boolean(body.checkAbsenSunfish);
  if ('tarikSohSales'     in body) patch.tarikSohSales     = Boolean(body.tarikSohSales);
  if ('fiveR'             in body) patch.fiveR             = Boolean(body.fiveR);
  if ('cekPromo'          in body) patch.cekPromo          = Boolean(body.cekPromo);
  if ('cekLamp'           in body) patch.cekLamp           = Boolean(body.cekLamp);
  if ('cekSoundSystem'    in body) patch.cekSoundSystem    = Boolean(body.cekSoundSystem);
  if ('notes'             in body) patch.notes             = typeof body.notes === 'string' ? body.notes : undefined;

  if ('storeFrontPhotos'         in body) patch.storeFrontPhotos         = strArr(body.storeFrontPhotos);
  if ('cashierDeskPhotos'        in body) patch.cashierDeskPhotos        = strArr(body.cashierDeskPhotos);
  if ('fiveRPhotos'              in body) patch.fiveRPhotos              = strArr(body.fiveRPhotos);
  if ('cekPromoStorefrontPhotos' in body) patch.cekPromoStorefrontPhotos = strArr(body.cekPromoStorefrontPhotos);
  if ('cekPromoDeskPhotos'       in body) patch.cekPromoDeskPhotos       = strArr(body.cekPromoDeskPhotos);

  try {
    const result = await autoSaveStoreOpening(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/store-opening]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}