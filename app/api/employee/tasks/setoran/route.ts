// app/api/employee/tasks/setoran/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitSetoran,
  autoSaveSetoran,
  type SetoranAutoSavePatch,
} from '@/lib/db/utils/setoran';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
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

  try {
    const result = await submitSetoran({
      scheduleId,
      userId:         session.user.id as string,
      storeId,
      expectedAmount: typeof body.expectedAmount === 'string' ? body.expectedAmount : String(body.expectedAmount ?? ''),
      amount:         typeof body.amount         === 'string' ? body.amount         : String(body.amount         ?? ''),
      linkSetoran:    typeof body.linkSetoran    === 'string' ? body.linkSetoran    : '',
      resiPhoto:      typeof body.resiPhoto      === 'string' ? body.resiPhoto      : '',
      notes:          typeof body.notes          === 'string' ? body.notes          : undefined,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    const unpaid = Number(result.data.unpaidAmount ?? 0);
    const meta = {
      unpaidAmount: String(unpaid),
      hasUnpaid:    unpaid > 0,
      // Informational: what tomorrow's task will show as carried deficit.
      nextDayCarriedDeficit: String(unpaid),
    };

    return NextResponse.json({ ...result, meta }, { status: 200 });

  } catch (err) {
    console.error('[POST /api/employee/tasks/setoran]', err);
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

  const patch: SetoranAutoSavePatch = {};

  if ('amount'         in body) patch.amount         = typeof body.amount         === 'string' ? body.amount         : String(body.amount ?? '');
  if ('expectedAmount' in body) patch.expectedAmount = typeof body.expectedAmount === 'string' && body.expectedAmount.length > 0 ? body.expectedAmount : null;
  if ('linkSetoran'    in body) patch.linkSetoran    = typeof body.linkSetoran    === 'string' ? body.linkSetoran    : '';
  if ('notes'          in body) patch.notes          = typeof body.notes          === 'string' ? body.notes          : undefined;

  if ('resiPhoto' in body) {
    patch.resiPhoto = typeof body.resiPhoto === 'string' && body.resiPhoto.length > 0
      ? body.resiPhoto
      : null;
  }

  try {
    const result = await autoSaveSetoran(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/setoran]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}