import { NextRequest, NextResponse } from 'next/server';
import { visitActor, visitReport } from '@/lib/store-visit/server';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/ops/store-visits/report[?month=YYYY-MM] — Ops HO / IT see every area,
// Ops Area only their own submissions in their area. `month` picks the calendar month.
export async function GET(req: NextRequest) {
  const guard = await visitActor();
  if (!guard.ok) return guard.response;
  const month = req.nextUrl.searchParams.get('month') ?? undefined;
  if (month && !MONTH.test(month)) {
    return NextResponse.json({ success: false, error: 'month must be YYYY-MM' }, { status: 400 });
  }
  try {
    const report = await visitReport(guard.actor, month);
    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    console.error('Failed to load store visit report', error);
    return NextResponse.json({ success: false, error: 'Report visit gagal dimuat.' }, { status: 500 });
  }
}
