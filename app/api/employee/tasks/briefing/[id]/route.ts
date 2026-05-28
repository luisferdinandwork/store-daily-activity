// app/api/employee/tasks/briefing/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { briefingTasks } from '@/lib/db/schema';
import { submitBriefing, type GeoPoint } from '@/lib/db/utils/briefing';

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function serialize(row: typeof briefingTasks.$inferSelect) {
  return {
    id: String(row.id),
    scheduleId: String(row.scheduleId),
    userId: row.userId,
    storeId: String(row.storeId),
    shiftId: String(row.shiftId),
    date: toIso(row.date),
    done: row.done,
    isBalanced: row.isBalanced,
    parentTaskId: row.parentTaskId,
    status: row.status,
    notes: row.notes,
    completedAt: toIso(row.completedAt),
    verifiedBy: row.verifiedBy,
    verifiedAt: toIso(row.verifiedAt),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);

  if (!id) {
    return NextResponse.json({ success: false, error: 'Invalid task id.' }, { status: 400 });
  }

  const [task] = await db
    .select()
    .from(briefingTasks)
    .where(eq(briefingTasks.id, id))
    .limit(1);

  if (!task) {
    return NextResponse.json({ success: false, error: 'Briefing task not found.' }, { status: 404 });
  }

  return NextResponse.json({ success: true, task: serialize(task) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await params;
  const id = parseId(rawId);

  if (!id) {
    return NextResponse.json({ success: false, error: 'Invalid task id.' }, { status: 400 });
  }

  const [task] = await db
    .select()
    .from(briefingTasks)
    .where(eq(briefingTasks.id, id))
    .limit(1);

  if (!task) {
    return NextResponse.json({ success: false, error: 'Briefing task not found.' }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    geo?: GeoPoint;
    notes?: string;
    skipGeo?: boolean;
  };

  if (!body.geo && !body.skipGeo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib diaktifkan sebelum submit briefing.' },
      { status: 400 },
    );
  }

  const result = await submitBriefing({
    taskId: id,
    scheduleId: task.scheduleId,
    userId: session.user.id,
    storeId: task.storeId,
    shiftId: task.shiftId,
    geo: body.geo ?? { lat: 0, lng: 0 },
    notes: body.notes,
    skipGeo: body.skipGeo,
  });

  if (!result.success) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, task: serialize(result.data) });
}
