// app/api/employee/petty-cash/refill-request/route.ts
//
// GET   — current month's refill request status for the employee's home store
//         (visible to every employee at the store, not just PIC).
// POST  — create a new refill request. PIC 1 / PIC 2 only, one active
//         (pending or approved) request per store per month.
// PATCH — attach a proof-of-receipt photo (drawer / signature) once Finance
//         has approved and handed over the cash outside the system. Any
//         store employee — whoever is on shift can take the photo.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  attachRefillProof,
  createRefillRequest,
  currentYearMonthJakarta,
  getLatestRefillRequest,
  isPicType,
  type ProofPhotoKind,
} from '@/lib/db/utils/petty-cash-refill';

function isProofPhotoKind(value: unknown): value is ProofPhotoKind {
  return value === 'drawer' || value === 'signature';
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
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

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  const kind = body?.kind;
  const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';

  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Invalid id.' }, { status: 400 });
  }
  if (!isProofPhotoKind(kind)) {
    return NextResponse.json({ success: false, error: 'kind must be drawer or signature.' }, { status: 400 });
  }
  if (!imageUrl) {
    return NextResponse.json({ success: false, error: 'imageUrl is required.' }, { status: 422 });
  }

  const result = await attachRefillProof(id, storeId, user.id as string, kind, imageUrl);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
