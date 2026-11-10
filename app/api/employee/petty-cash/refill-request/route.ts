// app/api/employee/petty-cash/refill-request/route.ts
//
// GET   — the store's refill: the one on its way (else the latest) plus what a new one would cover and where it
//         stands against the 15th (visible to every employee at the store, not just PIC 1).
// POST  — send the refill. PIC 1 only (the petty cash holder), one refill on its way per store at a time. The
//         server picks the period it settles (the oldest used one without a refill, up to the period in use —
//         lib/petty-cash-period.ts `pickRefillPeriod`); sending it closes nothing, the calendar changes periods.
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
  getLastBankDetails,
  getRefillOverview,
  isPettyCashHolder,
  type ProofPhotoKind,
} from '@/lib/db/utils/petty-cash-refill';
import { assertStoreOperational } from '@/lib/db/utils/store-status';
import { normalizeBankDetails } from '@/lib/petty-cash-bank';

/** What the session carries about the employee (NextAuth user, see lib/auth). */
type SessionUser = { id: string; homeStoreId?: number | string | null; employeeType?: string | null };

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

  const user = session.user as SessionUser;
  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  // Resolving the period in use may create one, so only for a store that runs petty cash.
  const inactive = await assertStoreOperational(storeId);
  if (inactive) return NextResponse.json({ success: false, error: inactive }, { status: 403 });

  const overview = await getRefillOverview(storeId);
  // Only PIC 1 files requests, so only they get their saved account back to pre-fill the form.
  const lastBankDetails = isPettyCashHolder(user.employeeType)
    ? await getLastBankDetails(session.user.id as string)
    : null;

  return NextResponse.json({
    success: true,
    request: overview.request,
    lastBankDetails,
    overview: {
      usageMonth: overview.usageMonth,
      settle: overview.settle,
      deadline: overview.deadline,
      canRequest: overview.canRequest,
      blockedReason: overview.blockedReason,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const user = session.user as SessionUser;
  if (!isPettyCashHolder(user.employeeType)) return holderOnly('mengajukan Refill petty cash');

  const storeId = Number(user.homeStoreId);
  if (!Number.isFinite(storeId)) {
    return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  }

  const inactive = await assertStoreOperational(storeId);
  if (inactive) return NextResponse.json({ success: false, error: inactive }, { status: 403 });

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

  const user = session.user as SessionUser;
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
