// app/api/employee/tasks/edc-reconciliation/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  addRow,
  autoSaveEdcReconciliation,
  deleteRow,
  getEdcReconciliationById,
  submitEdcReconciliation,
  updateRow,
} from '@/lib/db/utils/edc-reconciliation';

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const taskId = Number(request.nextUrl.searchParams.get('taskId'));
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ success: false, error: 'Invalid taskId' }, { status: 400 });
  }

  const data = await getEdcReconciliationById(taskId);
  if (!data) return NextResponse.json({ success: false, error: 'Task tidak ditemukan.' }, { status: 404 });
  return NextResponse.json({ success: true, data });
}

export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const body = await request.json();

  if (body.op === 'add') {
    const result = await addRow({
      taskId: Number(body.taskId),
      edcName: body.edcName,
      transactionType: body.transactionType,
      actualAmount: String(body.actualAmount ?? '0'),
      actualCount: Number(body.actualCount ?? 0),
      notes: body.notes,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (body.op === 'update') {
    const result = await updateRow({
      rowId: Number(body.rowId),
      edcName: body.edcName,
      transactionType: body.transactionType,
      actualAmount: body.actualAmount == null ? undefined : String(body.actualAmount),
      actualCount: body.actualCount == null ? undefined : Number(body.actualCount),
      notes: body.notes,
    });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  if (body.op === 'delete') {
    const result = await deleteRow(Number(body.rowId));
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }

  const result = await autoSaveEdcReconciliation(Number(body.scheduleId), { notes: body.notes });
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const body = await request.json();
  const result = await submitEdcReconciliation({
    scheduleId: Number(body.scheduleId),
    userId,
    storeId: Number(body.storeId),
    geo: body.geo ?? { lat: 0, lng: 0 },
    skipGeo: Boolean(body.skipGeo),
    notes: body.notes,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
