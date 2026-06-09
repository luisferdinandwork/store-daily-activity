// app/api/ops/shift-tasks/shift/[id]/route.ts
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts } from '@/lib/db/schema';
import { isPaletteKey, normalizeShiftBreaks } from '@/lib/shift-tasks';

export const dynamic = 'force-dynamic';

function isOps(session: Awaited<ReturnType<typeof auth>>): boolean {
  const user = session?.user as any;
  const role = user?.role as string | undefined;
  const employeeType = (user?.employeeType ?? user?.employeeTypeCode) as string | undefined;

  return role === 'ops' || role === 'admin' || employeeType === 'ops_area' || employeeType === 'ops_ho';
}

async function resolveId(ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const p = await ctx.params;
  return Number(p.id);
}

interface PatchBody {
  label?: string;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  accent?: string | null;
  icon?: string | null;
  breaks?: unknown;
  isActive?: boolean;
  sortOrder?: number;
}

export async function PATCH(req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isOps(session)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const id = await resolveId(ctx);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ success: false, error: 'Invalid shift id' }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.accent != null && body.accent !== '' && !isPaletteKey(body.accent)) {
    return NextResponse.json({ success: false, error: `Unknown accent "${body.accent}"` }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (body.label !== undefined) {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ success: false, error: 'Label cannot be empty' }, { status: 400 });
    patch.label = label;
  }

  if (body.description !== undefined) patch.description = body.description;
  if (body.startTime !== undefined) patch.startTime = body.startTime;
  if (body.endTime !== undefined) patch.endTime = body.endTime;
  if (body.accent !== undefined) patch.accent = body.accent || null;
  if (body.icon !== undefined) patch.icon = body.icon || null;

  if (body.breaks !== undefined) {
    const result = normalizeShiftBreaks(body.breaks);
    if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    patch.breaks = result.breaks.length ? result.breaks : null;
  }

  if (body.isActive !== undefined) patch.isActive = body.isActive;
  if (body.sortOrder !== undefined && Number.isInteger(body.sortOrder)) patch.sortOrder = body.sortOrder;

  try {
    const [updated] = await db.update(shifts).set(patch).where(eq(shifts.id, id)).returning();
    if (!updated) return NextResponse.json({ success: false, error: 'Shift not found' }, { status: 404 });
    return NextResponse.json({ success: true, shift: updated });
  } catch (err) {
    console.error('PATCH /api/ops/shift-tasks/shift/[id] failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to update shift' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: { id: string } | Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!isOps(session)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

  const id = await resolveId(ctx);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ success: false, error: 'Invalid shift id' }, { status: 400 });
  }

  try {
    const [updated] = await db
      .update(shifts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(shifts.id, id))
      .returning();

    if (!updated) return NextResponse.json({ success: false, error: 'Shift not found' }, { status: 404 });
    return NextResponse.json({ success: true, shift: updated, disabled: true });
  } catch (err) {
    console.error('DELETE /api/ops/shift-tasks/shift/[id] failed:', err);
    return NextResponse.json({ success: false, error: 'Failed to disable shift' }, { status: 500 });
  }
}
