// app/api/pic/schedule/shifts/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { shifts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const rows = await db
    .select({
      id:        shifts.id,
      code:      shifts.code,
      label:     shifts.label,
      startTime: shifts.startTime,
      endTime:   shifts.endTime,
    })
    .from(shifts)
    .where(eq(shifts.isActive, true))
    .orderBy(shifts.sortOrder);

  return NextResponse.json({ success: true, shifts: rows });
}