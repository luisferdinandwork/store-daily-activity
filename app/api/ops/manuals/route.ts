// app/api/ops/manuals/route.ts
//
// GET  — list every manual (active + inactive), for the admin management page.
// POST — create a manual record (the file itself is uploaded separately via
//        POST /api/upload/manual, which returns the fileUrl/fileType used here).
//
// Ops HO / IT only — this is a broadcast library visible to every
// employee once created, so only head office manages it.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { desc, eq } from 'drizzle-orm';

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

export async function GET() {
  const actor = await requireManualsManager();
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const rows = await db
    .select({ manual: manuals, uploaderName: users.name })
    .from(manuals)
    .leftJoin(users, eq(manuals.uploadedBy, users.id))
    .orderBy(manuals.sortOrder, desc(manuals.createdAt));

  return NextResponse.json({
    success: true,
    manuals: rows.map((row) => ({
      id: String(row.manual.id),
      title: row.manual.title,
      description: row.manual.description,
      fileUrl: row.manual.fileUrl,
      fileType: row.manual.fileType,
      isActive: row.manual.isActive,
      sortOrder: row.manual.sortOrder,
      uploaderName: row.uploaderName,
      createdAt: row.manual.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const actor = await requireManualsManager();
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl : '';
  const fileType = typeof body.fileType === 'string' ? body.fileType : '';

  if (title.length < 2) {
    return NextResponse.json({ success: false, error: 'Title is required.' }, { status: 400 });
  }
  if (!fileUrl || !fileType) {
    return NextResponse.json({ success: false, error: 'Upload the file first.' }, { status: 400 });
  }

  const [created] = await db
    .insert(manuals)
    .values({
      title,
      description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
      fileUrl,
      fileType,
      uploadedBy: actor.id,
      updatedAt: new Date(),
    })
    .returning();

  return NextResponse.json({
    success: true,
    manual: {
      id: String(created.id),
      title: created.title,
      description: created.description,
      fileUrl: created.fileUrl,
      fileType: created.fileType,
      isActive: created.isActive,
      sortOrder: created.sortOrder,
    },
  }, { status: 201 });
}
