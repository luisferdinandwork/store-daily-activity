// app/api/pic/schedule/entry/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { updateMonthlyScheduleEntry } from '@/lib/schedule-utils';

export async function PATCH(
  req:     NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user         = session.user as any;
  const actorId      = user.id          as string;
  const employeeType = user.employeeType as string | null;
  const role         = user.role         as string;

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can edit schedule entries.' }, { status: 403 });
  }

  const body = await req.json();
  const patch = {
    shift:   body.shift   ?? null,
    isOff:   body.isOff   ?? false,
    isLeave: body.isLeave ?? false,
  };

  const result = await updateMonthlyScheduleEntry(params.id, patch, actorId);
  return NextResponse.json(result);
}