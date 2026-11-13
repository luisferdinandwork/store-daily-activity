// app/api/audit/berita-acara/route.ts — every Berita Acara Pemeriksaan Kas of a month (?month=YYYY-MM, by check date).

import { NextResponse } from 'next/server';

import { resolveAuditScope } from '@/lib/audit/scope';
import { isMonth } from '@/lib/audit-cash-check';
import { jakartaTodayKey } from '@/lib/day-bucket';
import { listCashChecks } from '@/lib/db/utils/audit-cash-check';

export async function GET(req: Request) {
  const scope = await resolveAuditScope();
  if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });

  const month = new URL(req.url).searchParams.get('month') ?? jakartaTodayKey().slice(0, 7);
  if (!isMonth(month)) return NextResponse.json({ success: false, error: 'Bulan tidak valid.' }, { status: 400 });

  try {
    return NextResponse.json({ success: true, month, rows: await listCashChecks(month) });
  } catch (error) {
    console.error('[audit/berita-acara] GET failed', error);
    return NextResponse.json({ success: false, error: 'Gagal memuat Berita Acara.' }, { status: 500 });
  }
}
