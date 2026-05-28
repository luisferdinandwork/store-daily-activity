// app/api/ops/users/[userId]/route.ts
// Returns history + upcoming-schedule snapshot for a single employee.
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserTransferHistory, getUserScheduleSnapshot } from '@/lib/db/utils/user-transfers';

export async function GET(_req: Request, { params }: { params: { userId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const actorId = session.user.id as string;
  const { userId } = params;

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