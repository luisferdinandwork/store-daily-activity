// app/api/pic/schedule/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  getMonthlySchedule,
  deleteMonthlySchedule,
} from '@/lib/schedule-utils';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user      = session.user as any;
  const storeId   = user.homeStoreId as string | null;
  const yearMonth = req.nextUrl.searchParams.get('yearMonth');

  // ADD THIS LINE:
  console.log('GET /api/pic/schedule/monthly', { storeId, yearMonth });

  if (!storeId)   return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth) return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const schedule = await getMonthlySchedule(storeId, yearMonth);

  // AND THIS:
  console.log('schedule result:', schedule ? 'found' : 'null');

  return NextResponse.json({ success: true, schedule });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user         = session.user as any;
  const actorId      = user.id          as string;
  const employeeType = user.employeeType as string | null;
  const role         = user.role         as string;
  const storeId      = user.homeStoreId  as string | null;
  const yearMonth    = req.nextUrl.searchParams.get('yearMonth');

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can delete schedules.' }, { status: 403 });
  }
  if (!storeId)   return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth) return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const result = await deleteMonthlySchedule(storeId, yearMonth, actorId);
  return NextResponse.json(result);
}