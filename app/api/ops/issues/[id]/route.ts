// app/api/ops/issues/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { issues, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const patchSchema = z.object({
  status: z.enum(['reported', 'in_review', 'resolved']),
  note:   z.string().max(500).optional(),
});

// ─── PATCH /api/ops/issues/[id] ───────────────────────────────────────────────
// OPS changes the status of an issue. Validates area ownership before updating.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Next.js 15+: params is a Promise and must be awaited before use.
    const { id } = await params;

    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as { id: string; role: string; areaId?: string };

    if (!['ops', 'admin'].includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch issue + its store in one join
    const [row] = await db
      .select({ issue: issues, storeAreaId: stores.areaId })
      .from(issues)
      .innerJoin(stores, eq(issues.storeId, stores.id))
      .where(eq(issues.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }

    // OPS can only update issues from their area
    if (user.role === 'ops' && row.storeAreaId !== user.areaId) {
      return NextResponse.json({ error: 'Forbidden — issue is outside your area' }, { status: 403 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 422 },
      );
    }

    const [updated] = await db
      .update(issues)
      .set({
        status:     parsed.data.status,
        reviewedBy: user.id,
        reviewedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(eq(issues.id, id))
      .returning();

    return NextResponse.json({ issue: updated });
  } catch (err) {
    console.error('[PATCH /api/ops/issues/[id]]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}