// app/api/it/target-allocation-templates/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET    — every target_allocation_templates row (the PIC1/PIC2/SA1-5 ×
//          "Man Power" default-split grid Ops's monthly percentages come
//          from). IT-only.
// PUT    — upsert one { headcount, slotCode, percentage } cell.
// DELETE — remove one { headcount, slotCode } cell (?headcount=&slotCode=).
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { targetAllocationTemplates } from '@/lib/db/schema';
import { resolveItScope } from '@/lib/auth/it-scope';

const SLOT_CODE_PATTERN = /^(PIC[12]|SA\d{1,2})$/;
const MAX_HEADCOUNT = 30;

export async function GET() {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const rows = await db
    .select()
    .from(targetAllocationTemplates)
    .where(eq(targetAllocationTemplates.isActive, true))
    .orderBy(asc(targetAllocationTemplates.headcount), asc(targetAllocationTemplates.slotCode));

  return NextResponse.json({
    success: true,
    templates: rows.map((row) => ({
      id: row.id,
      headcount: row.headcount,
      slotCode: row.slotCode,
      percentage: Number(row.percentage),
    })),
  });
}

export async function PUT(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const body = await req.json().catch(() => null);

  const headcount = Number(body?.headcount);
  const slotCode = typeof body?.slotCode === 'string' ? body.slotCode.trim().toUpperCase() : '';
  const percentage = Number(body?.percentage);

  if (!Number.isInteger(headcount) || headcount < 1 || headcount > MAX_HEADCOUNT) {
    return NextResponse.json(
      { success: false, error: `headcount must be an integer between 1 and ${MAX_HEADCOUNT}.` },
      { status: 400 },
    );
  }

  if (!SLOT_CODE_PATTERN.test(slotCode)) {
    return NextResponse.json(
      { success: false, error: 'slotCode must be PIC1, PIC2, or SA followed by a number (e.g. SA1).' },
      { status: 400 },
    );
  }

  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    return NextResponse.json(
      { success: false, error: 'percentage must be a number between 0 and 100.' },
      { status: 400 },
    );
  }

  const [row] = await db
    .insert(targetAllocationTemplates)
    .values({
      headcount,
      slotCode,
      percentage: percentage.toFixed(2),
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [targetAllocationTemplates.headcount, targetAllocationTemplates.slotCode],
      set: { percentage: percentage.toFixed(2), isActive: true, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json({
    success: true,
    template: { id: row.id, headcount: row.headcount, slotCode: row.slotCode, percentage: Number(row.percentage) },
  });
}

export async function DELETE(req: NextRequest) {
  const scope = await resolveItScope();
  if (!scope.ok) {
    return NextResponse.json({ success: false, error: scope.error }, { status: scope.status });
  }

  const { searchParams } = new URL(req.url);
  const headcount = Number(searchParams.get('headcount'));
  const slotCode = (searchParams.get('slotCode') ?? '').trim().toUpperCase();

  if (!Number.isInteger(headcount) || headcount < 1) {
    return NextResponse.json({ success: false, error: 'Invalid headcount.' }, { status: 400 });
  }
  if (!SLOT_CODE_PATTERN.test(slotCode)) {
    return NextResponse.json({ success: false, error: 'Invalid slotCode.' }, { status: 400 });
  }

  await db
    .delete(targetAllocationTemplates)
    .where(
      and(
        eq(targetAllocationTemplates.headcount, headcount),
        eq(targetAllocationTemplates.slotCode, slotCode),
      ),
    );

  return NextResponse.json({ success: true });
}
