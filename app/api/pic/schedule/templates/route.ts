// app/api/pic/schedule/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import {
  weeklyScheduleTemplates,
  weeklyScheduleEntries,
  users,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { createOrReplaceTemplate } from '@/lib/schedule-utils';

// ─── Guard: only PIC 1 of their own store ─────────────────────────────────────
function guardPic1(session: any): { userId: string; storeId: string } | null {
  const u = session?.user as any;
  if (!u?.id || u?.employeeType !== 'pic_1' || !u?.storeId) return null;
  return { userId: u.id, storeId: u.storeId };
}

// ─── GET /api/pic/schedule/templates ─────────────────────────────────────────
// Returns all active templates for the PIC 1's own store.
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardPic1(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only PIC 1 can access schedule management.' }, { status: 403 });
    }

    const rows = await db
      .select({ template: weeklyScheduleTemplates, user: users })
      .from(weeklyScheduleTemplates)
      .leftJoin(users, eq(weeklyScheduleTemplates.userId, users.id))
      .where(
        and(
          eq(weeklyScheduleTemplates.storeId,  actor.storeId),
          eq(weeklyScheduleTemplates.isActive, true),
        ),
      )
      .orderBy(users.name);

    const templates = await Promise.all(
      rows.map(async ({ template, user }) => {
        const entries = await db
          .select({
            weekday: weeklyScheduleEntries.weekday,
            shift:   weeklyScheduleEntries.shift,
          })
          .from(weeklyScheduleEntries)
          .where(eq(weeklyScheduleEntries.templateId, template.id))
          .orderBy(weeklyScheduleEntries.weekday);

        return {
          template: {
            id:        template.id,
            note:      template.note,
            isActive:  template.isActive,
            entries:   entries.map(e => ({
              weekday: Number(e.weekday) as 0|1|2|3|4|5|6,
              shift:   e.shift,
            })),
            createdAt: template.createdAt.toISOString(),
            updatedAt: template.updatedAt.toISOString(),
          },
          user: user
            ? { id: user.id, name: user.name, role: user.role, employeeType: user.employeeType }
            : null,
        };
      }),
    );

    return NextResponse.json({ success: true, templates });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─── POST /api/pic/schedule/templates ────────────────────────────────────────
// Create a new schedule template for an employee in the PIC 1's store.
// Body: { userId: string, entries: { weekday: number, shift: string }[], note?: string }
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const actor   = guardPic1(session);
    if (!actor) {
      return NextResponse.json({ success: false, error: 'Only PIC 1 can create schedules.' }, { status: 403 });
    }

    const body = await req.json();
    const { userId, entries, note } = body;

    if (!userId || !Array.isArray(entries) || entries.length === 0) {
      return NextResponse.json({ success: false, error: 'userId and entries are required.' }, { status: 400 });
    }

    // Verify the target employee belongs to the PIC 1's store
    const [targetUser] = await db
      .select({ id: users.id, storeId: users.storeId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!targetUser || targetUser.storeId !== actor.storeId) {
      return NextResponse.json(
        { success: false, error: 'You can only assign schedules to employees in your store.' },
        { status: 403 },
      );
    }

    const result = await createOrReplaceTemplate({
      userId,
      storeId:   actor.storeId,
      entries,
      note:      note ?? undefined,
      createdBy: actor.userId,   // PIC 1 is the creator
    });

    return NextResponse.json(result, { status: result.success ? 201 : 400 });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}