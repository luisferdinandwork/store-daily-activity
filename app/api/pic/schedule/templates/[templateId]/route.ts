// app/api/pic/schedule/templates/[templateId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { weeklyScheduleTemplates } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { updateTemplate } from '@/lib/schedule-utils';

// ─── Guard: only PIC 1 of their own store ─────────────────────────────────────
function guardPic1(session: any): { userId: string; storeId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.employeeType !== 'pic_1' || !u?.storeId) return null;
  return { userId: u.id, storeId: u.storeId };
}

// ─── Verify template belongs to PIC 1's store ─────────────────────────────────
async function verifyOwnership(templateId: string, storeId: string): Promise<boolean> {
  const [tmpl] = await db
    .select({ storeId: weeklyScheduleTemplates.storeId })
    .from(weeklyScheduleTemplates)
    .where(eq(weeklyScheduleTemplates.id, templateId))
    .limit(1);
  return tmpl?.storeId === storeId;
}

// ─── PATCH /api/pic/schedule/templates/[templateId] ──────────────────────────
// Update entries and/or note of an existing template.
// Body: { entries?: { weekday: number, shift: string }[], note?: string }
export async function PATCH(
  req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardPic1(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only PIC 1 can edit schedules.' }, { status: 403 });
    }

    const { templateId } = params;
    const owned = await verifyOwnership(templateId, actor.storeId);
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Template not found in your store.' }, { status: 404 });
    }

    const { entries, note } = await req.json();

    const result = await updateTemplate(
      templateId,
      { entries, note },
      actor.userId,   // PIC 1 as actorId — passes canManageSchedule
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── DELETE /api/pic/schedule/templates/[templateId] ─────────────────────────
// Deactivate (soft-delete) a template. Future unattended schedules are removed.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { templateId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardPic1(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only PIC 1 can remove schedules.' }, { status: 403 });
    }

    const { templateId } = params;
    const owned = await verifyOwnership(templateId, actor.storeId);
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Template not found in your store.' }, { status: 404 });
    }

    // isActive: false → rolling generator will no longer produce schedules from it.
    // Future unattended schedule rows are cleaned up by applyTemplateChange (via updateTemplate).
    const result = await updateTemplate(
      templateId,
      { isActive: false },
      actor.userId,
    );

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}