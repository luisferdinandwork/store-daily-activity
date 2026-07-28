// app/api/ops/manuals/[id]/route.ts
//
// PATCH — edit a manual's metadata or toggle isActive.
// DELETE — remove a manual record (the file itself is left on disk; only
//          the listing is removed, matching the low-stakes nature of a
//          replaceable reference document).
//
// Ops HO / IT only.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { manuals, users, userRoles, employeeTypes } from '@/lib/db/schema';

async function requireManualsManager() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;

  const userId = (session.user as any).id as string;
  const [actor] = await db
    .select({ id: users.id, roleCode: userRoles.code, empType: employeeTypes.code })
    .from(users)
    .leftJoin(userRoles, eq(users.roleId, userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!actor) return null;
  if (actor.roleCode !== 'it' && actor.empType !== 'ops_ho') return null;

  return actor;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManualsManager();
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const manualId = Number(id);
  if (!Number.isInteger(manualId)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const updates: Partial<typeof manuals.$inferInsert> = { updatedAt: new Date() };

  if (typeof body.title === 'string') {
    if (body.title.trim().length < 2) {
      return NextResponse.json({ success: false, error: 'Title is required.' }, { status: 400 });
    }
    updates.title = body.title.trim();
  }
  if (typeof body.description === 'string') {
    updates.description = body.description.trim() || null;
  }
  if (typeof body.isActive === 'boolean') {
    updates.isActive = body.isActive;
  }
  if (typeof body.sortOrder === 'number' && Number.isFinite(body.sortOrder)) {
    updates.sortOrder = body.sortOrder;
  }
  if (typeof body.fileUrl === 'string' && body.fileUrl) {
    updates.fileUrl = body.fileUrl;
  }
  if (typeof body.fileType === 'string' && body.fileType) {
    updates.fileType = body.fileType;
  }

  const [updated] = await db
    .update(manuals)
    .set(updates)
    .where(eq(manuals.id, manualId))
    .returning();

  if (!updated) {
    return NextResponse.json({ success: false, error: 'Manual not found' }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    manual: {
      id: String(updated.id),
      title: updated.title,
      description: updated.description,
      fileUrl: updated.fileUrl,
      fileType: updated.fileType,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await requireManualsManager();
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const manualId = Number(id);
  if (!Number.isInteger(manualId)) {
    return NextResponse.json({ success: false, error: 'Invalid id' }, { status: 400 });
  }

  const [deleted] = await db.delete(manuals).where(eq(manuals.id, manualId)).returning();
  if (!deleted) {
    return NextResponse.json({ success: false, error: 'Manual not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
