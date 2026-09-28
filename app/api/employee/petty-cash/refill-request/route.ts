// app/api/employee/petty-cash/refill-request/route.ts
//
// GET   — current month's refill request status for the employee's home store
//         (visible to every employee at the store, not just PIC 1).
// POST  — create a new refill request. PIC 1 only (the petty cash holder),
//         one active (pending or approved) request per store per month.
//         Must include the bank account Finance should send the cash to
//         (bankName / accountNumber / accountHolderName).
// PATCH — attach a proof-of-receipt photo (drawer / signature) once Finance
//         has approved and handed over the cash outside the system. PIC 1
//         only; everyone else just sees the status.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  attachRefillProof,
  createRefillRequest,
  currentYearMonthJakarta,
  getLastBankDetails,
  getLatestRefillRequest,
  isPettyCashHolder,
  type ProofPhotoKind,
} from '@/lib/db/utils/petty-cash-refill';
import { normalizeBankDetails } from '@/lib/petty-cash-bank';

const holderOnly = (what: string) =>
  NextResponse.json(
    { success: false, error: `Hanya PIC 1 yang bisa ${what}.` },
    { status: 403 },
  );

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
  // Only PIC 1 files requests, so only they get their saved account back to pre-fill the form.
  const lastBankDetails = isPettyCashHolder(user.employeeType)
    ? await getLastBankDetails(session.user.id as string)
    : null;

  return NextResponse.json({ success: true, yearMonth, request, lastBankDetails });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  if (!isPettyCashHolder(user.employeeType)) return holderOnly('mengajukan Refill petty cash');

  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const notes = typeof body?.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined;

  const bank = normalizeBankDetails(body);
  if (!bank.ok) {
    return NextResponse.json({ success: false, error: bank.error }, { status: 422 });
  }

  const result = await createRefillRequest(storeId, user.id as string, bank.value, notes);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as any;
  if (!isPettyCashHolder(user.employeeType)) return holderOnly('mengunggah foto bukti Refill');

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
