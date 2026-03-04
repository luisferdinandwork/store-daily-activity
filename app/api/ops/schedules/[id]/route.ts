// app/api/ops/schedules/[id]/route.ts
//
// PATCH  /api/ops/schedules/[id]  — override/edit a template (OPS only, area check inside updateTemplate)
// DELETE /api/ops/schedules/[id]  — deactivate a template   (OPS only, area check inside updateTemplate)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { updateTemplate } from '@/lib/schedule-utils';

// ─── Auth guard: OPS only ─────────────────────────────────────────────────────
function guardOps(session: any): { userId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.role !== 'ops') return null;
  return { userId: u.id };
}

// ─── PATCH /api/ops/schedules/[id] ───────────────────────────────────────────
// Body: { entries?: [{ weekday: number, shift }], note?: string, isActive?: boolean }
//
// updateTemplate() calls canManageSchedule(actorId, storeId) internally —
// the area ownership check is enforced there, not duplicated here.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only OPS users can override schedules.' }, { status: 403 });
    }

    const { id } = await params;
    const { entries, note, isActive } = await req.json();

    // Validate entries if provided
    if (entries !== undefined) {
      if (!Array.isArray(entries) || entries.length === 0) {
        return NextResponse.json(
          { success: false, error: 'entries must be a non-empty array' },
          { status: 400 },
        );
      }
      const validShifts = ['morning', 'evening'];
      for (const e of entries) {
        if (typeof e.weekday !== 'number' || e.weekday < 0 || e.weekday > 6) {
          return NextResponse.json(
            { success: false, error: `Invalid weekday "${e.weekday}" — must be 0–6` },
            { status: 400 },
          );
        }
        if (!validShifts.includes(e.shift)) {
          return NextResponse.json(
            { success: false, error: `Invalid shift "${e.shift}"` },
            { status: 400 },
          );
        }
      }
    }

    // actorId = OPS user id → canManageSchedule will verify area ownership
    const result = await updateTemplate(id, { entries, note, isActive }, actor.userId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── DELETE /api/ops/schedules/[id] ──────────────────────────────────────────
// Soft-deletes by setting isActive = false.
// updateTemplate({ isActive: false }) triggers applyTemplateChange internally,
// which cleans up future unattended schedules.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only OPS users can remove schedules.' }, { status: 403 });
    }

    const { id } = await params;

    // isActive: false → rolling generator stops producing schedules from this template.
    // Future unattended schedules are cleaned up inside applyTemplateChange (called by updateTemplate).
    const result = await updateTemplate(id, { isActive: false }, actor.userId);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}