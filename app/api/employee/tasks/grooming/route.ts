// app/api/employee/tasks/grooming/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated endpoint for the Grooming task.
//   POST  → final submit (runs check-in + geofence + checklist/photo validation)
//   PATCH → auto-save partial patch (status: pending → in_progress)
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitGrooming,
  autoSaveGrooming,
  type GroomingAutoSavePatch,
} from '@/lib/db/utils/grooming';

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
    const result = await submitGrooming({
      scheduleId,
      userId:            session.user.id as string,
      storeId,
      geo,
      skipGeo:           effectiveSkipGeo,

      uniformActive:     body.uniformActive !== undefined ? Boolean(body.uniformActive) : true,
      hairActive:        body.hairActive !== undefined ? Boolean(body.hairActive) : true,
      smellActive:       body.smellActive !== undefined ? Boolean(body.smellActive) : true,
      makeUpActive:      body.makeUpActive !== undefined ? Boolean(body.makeUpActive) : true,
      shoeActive:        body.shoeActive !== undefined ? Boolean(body.shoeActive) : true,
      nameTagActive:     body.nameTagActive !== undefined ? Boolean(body.nameTagActive) : true,

      uniformChecked:    Boolean(body.uniformChecked),
      hairChecked:       Boolean(body.hairChecked),
      smellChecked:      Boolean(body.smellChecked),
      makeUpChecked:     Boolean(body.makeUpChecked),
      shoeChecked:       Boolean(body.shoeChecked),
      nameTagChecked:    Boolean(body.nameTagChecked),

      selfiePhotos:      strArr(body.selfiePhotos),
      notes:             typeof body.notes === 'string' ? body.notes : undefined,
    });
    
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/grooming]', err);
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

  const patch: GroomingAutoSavePatch = {};

  // Active toggles
  if ('uniformActive' in body) patch.uniformActive = Boolean(body.uniformActive);
  if ('hairActive'    in body) patch.hairActive    = Boolean(body.hairActive);
  if ('smellActive'   in body) patch.smellActive   = Boolean(body.smellActive);
  if ('makeUpActive'  in body) patch.makeUpActive  = Boolean(body.makeUpActive);
  if ('shoeActive'    in body) patch.shoeActive    = Boolean(body.shoeActive);
  if ('nameTagActive' in body) patch.nameTagActive = Boolean(body.nameTagActive);

  if ('uniformChecked' in body) patch.uniformChecked = Boolean(body.uniformChecked);
  if ('hairChecked'    in body) patch.hairChecked    = Boolean(body.hairChecked);
  if ('smellChecked'   in body) patch.smellChecked   = Boolean(body.smellChecked);
  if ('makeUpChecked'  in body) patch.makeUpChecked  = Boolean(body.makeUpChecked);
  if ('shoeChecked'    in body) patch.shoeChecked    = Boolean(body.shoeChecked);
  if ('nameTagChecked' in body) patch.nameTagChecked = Boolean(body.nameTagChecked);

  if ('selfiePhotos' in body) patch.selfiePhotos = strArr(body.selfiePhotos);
  if ('notes'        in body) patch.notes        = typeof body.notes === 'string' ? body.notes : undefined;

  // Photos & Notes
  if ('selfiePhotos' in body) patch.selfiePhotos = strArr(body.selfiePhotos);
  if ('notes'        in body) patch.notes        = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveGrooming(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/grooming]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}