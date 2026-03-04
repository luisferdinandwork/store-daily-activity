// app/api/ops/schedules/route.ts
//
// POST /api/ops/schedules
// Creates a new schedule template via OPS override.
// Authorization delegated to createOrReplaceTemplate → canManageSchedule.
//
// The old GET on this route is replaced by GET /api/ops/schedules/area
// which returns the full area tree. This file now only handles POST.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { createOrReplaceTemplate } from '@/lib/schedule-utils';

// ─── Auth guard: OPS only ─────────────────────────────────────────────────────
function guardOps(session: any): { userId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.role !== 'ops') return null;
  return { userId: u.id };
}

// ─── POST /api/ops/schedules ──────────────────────────────────────────────────
// Body: { userId, storeId, entries: [{ weekday: number, shift }], note? }
//
// createOrReplaceTemplate() calls canManageSchedule(actorId, storeId) —
// that function verifies the store belongs to the OPS user's area.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardOps(session);
    if (!actor) {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can create schedule overrides.' },
        { status: 403 },
      );
    }

    const body = await req.json();
    const { userId, storeId, entries, note } = body;

    if (!userId || !storeId || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'userId, storeId, and at least one entry are required.' },
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

    // actorId = OPS user id → canManageSchedule checks area ownership
    const result = await createOrReplaceTemplate({
      userId,
      storeId,
      entries,
      note,
      createdBy: actor.userId,
    });

    return NextResponse.json(result, { status: result.success ? 201 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}