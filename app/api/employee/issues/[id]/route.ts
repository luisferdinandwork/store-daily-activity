// app/api/employee/issues/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.enum(['reported', 'in_review', 'resolved']).optional(),
  title:       z.string().min(3).max(120).optional(),
  description: z.string().min(10).max(2000).optional(),
});

// ─── PATCH /api/employee/issues/[id] ─────────────────────────────────────────
// Employees can edit title/description while status === 'reported'.
// Ops/admin can change status.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 15+: params is a Promise and must be awaited.
    const { id } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string; storeId?: string };

    // Fetch the issue first to verify ownership / permissions
    const [existing] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    // Employees can only edit their own issues, and only if still 'reported'
    if (user.role === 'employee') {
      if (existing.userId !== user.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (existing.status !== 'reported') {
        return NextResponse.json(
          { error: 'Cannot edit an issue that is already under review or resolved' },
          { status: 409 },
        );
      }
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      );
    }

    const updates: Partial<typeof existing> = {
      updatedAt: new Date(),
    };

    // Only ops/admin/finance can change status
    if (parsed.data.status && ['ops', 'admin', 'finance'].includes(user.role)) {
      updates.status     = parsed.data.status;
      updates.reviewedBy = user.id;
      updates.reviewedAt = new Date();
    }

    if (parsed.data.title)       updates.title       = parsed.data.title;
    if (parsed.data.description) updates.description = parsed.data.description;

    const [updated] = await db
      .update(issues)
      .set(updates)
      .where(eq(issues.id, id))
      .returning();

    return NextResponse.json({ issue: updated });
  } catch (err) {
    console.error('[PATCH /api/employee/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── DELETE /api/employee/issues/[id] ────────────────────────────────────────
// Only the reporter can delete their own issue, and only while 'reported'.

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 15+: params is a Promise and must be awaited.
    const { id } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string };

    const [existing] = await db
      .select()
      .from(issues)
      .where(eq(issues.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    if (existing.userId !== user.id && !['admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (existing.status !== 'reported') {
      return NextResponse.json(
        { error: 'Cannot delete an issue that is already under review or resolved' },
        { status: 409 },
      );
    }

    await db.delete(issues).where(eq(issues.id, id));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/employee/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}