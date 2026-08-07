// app/api/ops/users/[userId]/route.ts
//
// GET   — history + upcoming-schedule snapshot for a single employee.
// PATCH — edit an employee's name / role (employee type) / active status /
//         password. Store transfers are NOT handled here — see
//         /api/ops/transfers, which also keeps schedules and attendance
//         consistent when an employee moves stores.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getUserTransferHistory,
  getUserScheduleSnapshot,
  updateEmployeeBasics,
} from '@/lib/db/utils/user-transfers';

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const actorId = session.user.id as string;
  const { userId } = await params;

  const history = await getUserTransferHistory(actorId, userId);
  if (!history.success) return NextResponse.json({ error: history.error }, { status: 403 });

  const now = new Date();
  const in60 = new Date(now);
  in60.setDate(in60.getDate() + 60);

  const snapshot = await getUserScheduleSnapshot(actorId, userId, null, now, in60);
  if (!snapshot.success) return NextResponse.json({ error: snapshot.error }, { status: 403 });

  return NextResponse.json({
    history: history.data,
    schedule: snapshot.data.map((r) => ({
      date: r.date.toISOString(),
      shiftCode: r.shiftCode,
      isOff: r.isOff,
      isLeave: r.isLeave,
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const { userId } = await params;
  const body = await req.json().catch(() => null);

  const input: Parameters<typeof updateEmployeeBasics>[2] = {};
  if (typeof body?.name === 'string') input.name = body.name;
  if (body?.employeeTypeId !== undefined && body?.employeeTypeId !== null) {
    input.employeeTypeId = Number(body.employeeTypeId);
  }
  if (typeof body?.isActive === 'boolean') input.isActive = body.isActive;
  if (typeof body?.password === 'string' && body.password.length > 0) input.password = body.password;

  const result = await updateEmployeeBasics(session.user.id as string, userId, input);

  if (!result.success) {
    const status = /outside your area|cannot be managed|OPS\/Admin|Area OPS user|role is inactive|Actor not found/.test(
      result.error,
    )
      ? 403
      : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, user: result.data });
}