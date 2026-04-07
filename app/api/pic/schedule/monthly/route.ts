// app/api/pic/schedule/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  getMonthlySchedule,
  deleteMonthlySchedule,
  createEmptyMonthlySchedule,
} from '@/lib/schedule-utils';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const rawHomeStoreId = user.homeStoreId as string | number | null | undefined;
  const yearMonth      = req.nextUrl.searchParams.get('yearMonth');

  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth)      return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  const schedule = await getMonthlySchedule(storeId, yearMonth);
  return NextResponse.json({ success: true, schedule });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id          as string;
  const employeeType   = user.employeeType as string | null;
  const role           = user.role         as string;
  const rawHomeStoreId = user.homeStoreId  as string | number | null | undefined;

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can create schedules.' }, { status: 403 });
  }
  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  const body      = await req.json().catch(() => ({}));
  const yearMonth = body.yearMonth as string | undefined;
  const note      = body.note      as string | undefined;

  if (!yearMonth) return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const result = await createEmptyMonthlySchedule(storeId, yearMonth, actorId, note);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user           = session.user as any;
  const actorId        = user.id          as string;
  const employeeType   = user.employeeType as string | null;
  const role           = user.role         as string;
  const rawHomeStoreId = user.homeStoreId  as string | number | null | undefined;
  const yearMonth      = req.nextUrl.searchParams.get('yearMonth');

  if (role !== 'ops' && employeeType !== 'pic_1') {
    return NextResponse.json({ success: false, error: 'Only OPS or PIC 1 can delete schedules.' }, { status: 403 });
  }
  if (!rawHomeStoreId) return NextResponse.json({ success: false, error: 'No home store.' }, { status: 400 });
  if (!yearMonth)      return NextResponse.json({ success: false, error: 'yearMonth required.' }, { status: 400 });

  const storeId = Number(rawHomeStoreId);
  if (isNaN(storeId)) return NextResponse.json({ success: false, error: 'Invalid homeStoreId.' }, { status: 400 });

  console.log('[DELETE monthly]', { storeId, yearMonth });

  const result = await deleteMonthlySchedule(storeId, yearMonth, actorId);

  console.log('[DELETE monthly] result:', result);

  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}