// app/api/employee/manuals/route.ts
//
// GET — list active manuals for the Knowledge Manual page. Any authenticated
// employee can view; only active entries are returned.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { eq, asc, desc } from 'drizzle-orm';

import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { manuals } from '@/lib/db/schema';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(manuals)
    .where(eq(manuals.isActive, true))
    .orderBy(asc(manuals.sortOrder), desc(manuals.createdAt));

  return NextResponse.json({
    success: true,
    manuals: rows.map((m) => ({
      id: String(m.id),
      title: m.title,
      description: m.description,
      fileUrl: m.fileUrl,
      fileType: m.fileType,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}
