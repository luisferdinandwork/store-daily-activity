// app/api/pic/schedule/entry/[id]/route.ts
import { NextRequest, NextResponse }    from 'next/server';
import { getServerSession }             from 'next-auth';
import { authOptions }                  from '@/lib/auth';
import { updateMonthlyScheduleEntry }   from '@/lib/schedule-utils';
import { db }                           from '@/lib/db';
import { users, userRoles, employeeTypes } from '@/lib/db/schema';
import { eq }                           from 'drizzle-orm';

async function resolveActorCodes(userId: string): Promise<{ role: string | null; empType: string | null }> {
  const [row] = await db
    .select({ roleCode: userRoles.code, empTypeCode: employeeTypes.code })
    .from(users)
    .leftJoin(userRoles,     eq(users.roleId,         userRoles.id))
    .leftJoin(employeeTypes, eq(users.employeeTypeId, employeeTypes.id))
    .where(eq(users.id, userId))
    .limit(1);
  return { role: row?.roleCode ?? null, empType: row?.empTypeCode ?? null };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const user    = session.user as any;
  const actorId = user.id as string;

  const { role, empType } = await resolveActorCodes(actorId);
  if (role !== 'ops' && empType !== 'pic_1') {
    return NextResponse.json(
      { success: false, error: 'Only OPS or PIC 1 can edit schedule entries.' },
      { status: 403 },
    );
  }

  const { id } = await params;
  const entryId = Number(id);
  if (isNaN(entryId)) {
    return NextResponse.json({ success: false, error: 'Invalid entry id.' }, { status: 400 });
  }

  const body = await req.json();

  const patch: { shift?: 'morning' | 'evening' | null; isOff?: boolean; isLeave?: boolean } = {};
  if ('shift'   in body) patch.shift   = body.shift;
  if ('isOff'   in body) patch.isOff   = !!body.isOff;
  if ('isLeave' in body) patch.isLeave = !!body.isLeave;

  console.log('[PATCH entry]', entryId, patch);

  const result = await updateMonthlyScheduleEntry(entryId, patch, actorId);

  console.log('[PATCH entry] result:', result);

  if (!result.success) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}