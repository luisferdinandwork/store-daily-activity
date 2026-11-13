// app/api/audit/cash-check/stores/route.ts — the active stores the audit team can count (store picker).

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { listAuditStores } from '@/lib/db/utils/audit-cash-check';

export async function GET() {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  try {
    return NextResponse.json({ success: true, stores: await listAuditStores() });
  } catch (error) {
    console.error('[audit/cash-check/stores] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat daftar toko.' }, { status: 500 });
  }
}
