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
      userId:              session.user.id as string,
      storeId,
      geo,
      skipGeo:             effectiveSkipGeo,
      
      // Active toggles
      uniformActive:       body.uniformActive !== undefined ? Boolean(body.uniformActive) : true,
      hairActive:          body.hairActive !== undefined ? Boolean(body.hairActive) : true,
      nailsActive:         body.nailsActive !== undefined ? Boolean(body.nailsActive) : true,
      accessoriesActive:   body.accessoriesActive !== undefined ? Boolean(body.accessoriesActive) : true,
      shoeActive:          body.shoeActive !== undefined ? Boolean(body.shoeActive) : true,
      
      // Compliance answers
      uniformComplete:      Boolean(body.uniformComplete),
      hairGroomed:          Boolean(body.hairGroomed),
      nailsClean:           Boolean(body.nailsClean),
      accessoriesCompliant: Boolean(body.accessoriesCompliant),
      shoeCompliant:        Boolean(body.shoeCompliant),
      
      // Photos & Notes
      selfiePhotos:         strArr(body.selfiePhotos),
      notes:                typeof body.notes === 'string' ? body.notes : undefined,
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
  if ('uniformActive'      in body) patch.uniformActive      = Boolean(body.uniformActive);
  if ('hairActive'         in body) patch.hairActive         = Boolean(body.hairActive);
  if ('nailsActive'        in body) patch.nailsActive        = Boolean(body.nailsActive);
  if ('accessoriesActive'  in body) patch.accessoriesActive  = Boolean(body.accessoriesActive);
  if ('shoeActive'         in body) patch.shoeActive         = Boolean(body.shoeActive);

  // Compliance answers
  if ('uniformComplete'      in body) patch.uniformComplete      = Boolean(body.uniformComplete);
  if ('hairGroomed'          in body) patch.hairGroomed          = Boolean(body.hairGroomed);
  if ('nailsClean'           in body) patch.nailsClean           = Boolean(body.nailsClean);
  if ('accessoriesCompliant' in body) patch.accessoriesCompliant = Boolean(body.accessoriesCompliant);
  if ('shoeCompliant'        in body) patch.shoeCompliant        = Boolean(body.shoeCompliant);

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