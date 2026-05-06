// app/api/employee/performance/route.ts
//
// Returns today's sales performance for the authenticated employee.
// Swap the `getData` block below for a real external API call when ready:
//   const res = await fetch(`${SALES_API_BASE}/performance/${userId}/today`, { headers: { ... } });

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { dummyPerformance }          from '@/data/employee-performance';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Replace this block with a real external API call when ready ──────────
  const raw = dummyPerformance;
  // ─────────────────────────────────────────────────────────────────────────

  const { today } = raw;

  return NextResponse.json({
    success:          true,
    employeeName:     raw.employeeName,
    storeName:        raw.storeName,
    date:             today.date,
    salesAmount:      today.salesAmount,
    salesTarget:      today.salesTarget,
    salesPct:         Math.min(100, Math.round((today.salesAmount / today.salesTarget) * 100)),
    transactionCount:  today.transactionCount,
    transactionTarget: today.transactionTarget,
    transactionPct:   Math.min(100, Math.round((today.transactionCount / today.transactionTarget) * 100)),
  });
}