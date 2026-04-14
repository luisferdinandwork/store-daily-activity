// app/api/employee/tasks/edc-reconciliation/route.ts
// ─────────────────────────────────────────────────────────────────────────────
//   POST   → final submit (compare + discrepancy bookkeeping)
//   PATCH  → auto-save top-level (notes)
//   PUT    → add / update / delete a transaction row
//             body: { op: 'add' | 'update' | 'delete', ...fields }
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitEdcReconciliation,
  autoSaveEdcReconciliation,
  addRow, updateRow, deleteRow,
  type AutoSaveEdcReconciliationPatch,
} from '@/lib/db/utils/edc-reconciliation';
import type { TxType } from '@/lib/db/utils/dummy-evening-data';

const TX_TYPES = new Set<TxType>(['credit', 'debit', 'qris', 'ewallet', 'cash']);

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

// ─── POST (final submit) ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

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
    const result = await submitEdcReconciliation({
      scheduleId,
      userId:   session.user.id as string,
      storeId,
      geo,
      skipGeo:  effectiveSkipGeo,
      notes:    typeof body.notes === 'string' ? body.notes : undefined,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/edc-reconciliation]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PATCH (auto-save top-level) ─────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  let scheduleId: number;
  try { scheduleId = toInt(body.scheduleId, 'scheduleId'); }
  catch (e) { return NextResponse.json({ success: false, error: String(e) }, { status: 400 }); }

  const patch: AutoSaveEdcReconciliationPatch = {};
  if ('notes' in body) patch.notes = typeof body.notes === 'string' ? body.notes : undefined;

  try {
    const result = await autoSaveEdcReconciliation(scheduleId, patch);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/edc-reconciliation]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── PUT (row CRUD) ──────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const op = body.op as string;

  try {
    if (op === 'add') {
      const taskId          = toInt(body.taskId, 'taskId');
      const transactionType = body.transactionType as TxType;
      if (!TX_TYPES.has(transactionType))
        return NextResponse.json({ success: false, error: 'Invalid transactionType' }, { status: 400 });
      if (typeof body.actualAmount !== 'string' && typeof body.actualAmount !== 'number')
        return NextResponse.json({ success: false, error: 'actualAmount required' }, { status: 400 });
      if (typeof body.actualCount !== 'number')
        return NextResponse.json({ success: false, error: 'actualCount required (number)' }, { status: 400 });

      const result = await addRow({
        taskId,
        transactionType,
        actualAmount: String(body.actualAmount),
        actualCount:  body.actualCount,
        notes:        typeof body.notes === 'string' ? body.notes : undefined,
      });
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (op === 'update') {
      const rowId = toInt(body.rowId, 'rowId');
      const result = await updateRow({
        rowId,
        transactionType: typeof body.transactionType === 'string' && TX_TYPES.has(body.transactionType as TxType)
          ? (body.transactionType as TxType) : undefined,
        actualAmount:    body.actualAmount != null ? String(body.actualAmount) : undefined,
        actualCount:     typeof body.actualCount === 'number' ? body.actualCount : undefined,
        notes:           typeof body.notes === 'string' ? body.notes : undefined,
      });
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    if (op === 'delete') {
      const rowId  = toInt(body.rowId, 'rowId');
      const result = await deleteRow(rowId);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    return NextResponse.json({ success: false, error: `Unknown op: ${op}` }, { status: 400 });
  } catch (err) {
    console.error('[PUT /api/employee/tasks/edc-reconciliation]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}