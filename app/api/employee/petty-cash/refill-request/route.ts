// app/api/employee/petty-cash/refill-request/route.ts
//
// GET  — current month's refill request status for the PIC's home store (if any).
// POST — create a new refill request. PIC 1 / PIC 2 only, one active
//        (pending or approved) request per store per month.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createRefillRequest,
  currentYearMonthJakarta,
  getLatestRefillRequest,
} from '@/lib/db/utils/petty-cash-refill';

function isPicType(empType: unknown) {
  return empType === 'pic_1' || empType === 'pic_2';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  if (!isPicType(user.employeeType)) {
    return NextResponse.json({ success: false, error: 'PIC only.' }, { status: 403 });
  }

  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const yearMonth = currentYearMonthJakarta();
  const request = await getLatestRefillRequest(storeId, yearMonth);

  return NextResponse.json({ success: true, yearMonth, request });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  if (!isPicType(user.employeeType)) {
    return NextResponse.json({ success: false, error: 'Only PIC can request a petty cash refill.' }, { status: 403 });
  }

  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;

  const result = await createRefillRequest(storeId, user.id as string, notes);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
