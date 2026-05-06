// app/api/employee/tasks/vm-checklist/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitVmChecklist,
  autoSaveVmChecklist,
  type AutoSaveVmChecklistInput,
} from '@/lib/db/utils/vm-checklist';

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

function toBool(v: unknown): boolean {
  return Boolean(v);
}

const CHECKLIST_FIELDS = [
  'shoeLaceShoeFillerPriceTagHangtagLabelK3L',
  'lastPairAndPigskinHangtag',
  'popPromoUpdate',
  'displayTableWallShelvingShowcaseHangbarStackingPedestal',
  'floorDisplayCleanliness',
  'vmToolsStorage',
] as const;

// ─── POST — final submit ──────────────────────────────────────────────────────

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
    const result = await submitVmChecklist({
      scheduleId,
      userId:  session.user.id as string,
      storeId,
      geo,
      skipGeo: effectiveSkipGeo,
      shoeLaceShoeFillerPriceTagHangtagLabelK3L:              toBool(body.shoeLaceShoeFillerPriceTagHangtagLabelK3L),
      lastPairAndPigskinHangtag:                              toBool(body.lastPairAndPigskinHangtag),
      popPromoUpdate:                                         toBool(body.popPromoUpdate),
      displayTableWallShelvingShowcaseHangbarStackingPedestal: toBool(body.displayTableWallShelvingShowcaseHangbarStackingPedestal),
      floorDisplayCleanliness:                                toBool(body.floorDisplayCleanliness),
      vmToolsStorage:                                         toBool(body.vmToolsStorage),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/vm-checklist]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH — auto-save ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let taskId: number;
  try { taskId = toInt(body.taskId, 'taskId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveVmChecklistInput = {};
  for (const field of CHECKLIST_FIELDS) {
    if (field in body) (patch as any)[field] = toBool(body[field]);
  }
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveVmChecklist(taskId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/vm-checklist]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}