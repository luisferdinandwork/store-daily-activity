// app/api/ops/schedules/entry/[id]/route.ts
import { NextRequest, NextResponse }  from 'next/server';
import { getServerSession }           from 'next-auth';
import { authOptions }                from '@/lib/auth';
import { updateMonthlyScheduleEntry } from '@/lib/schedule-utils';
import { db }                         from '@/lib/db';
import { monthlyScheduleEntries }     from '@/lib/db/schema';
import { eq }                         from 'drizzle-orm';
import { getOpsActor, assertStoreInActorArea } from '../../_helpers';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });

  const { id } = await params;
  const entryId = Number(id);
  if (isNaN(entryId)) return NextResponse.json({ success: false, error: 'Invalid entry id.' }, { status: 400 });

  // Look up the entry's storeId so we can verify it's in the actor's area
  const [entry] = await db
    .select({ storeId: monthlyScheduleEntries.storeId })
    .from(monthlyScheduleEntries)
    .where(eq(monthlyScheduleEntries.id, entryId))
    .limit(1);
  if (!entry) return NextResponse.json({ success: false, error: 'Entry not found.' }, { status: 404 });

  const areaErr = await assertStoreInActorArea(actor, entry.storeId);
  if (areaErr) return NextResponse.json({ success: false, error: areaErr }, { status: 403 });

  const body = await req.json();
  const patch: { shift?: 'morning' | 'evening' | null; isOff?: boolean; isLeave?: boolean } = {};
  if ('shift'   in body) patch.shift   = body.shift;
  if ('isOff'   in body) patch.isOff   = !!body.isOff;
  if ('isLeave' in body) patch.isLeave = !!body.isLeave;

  const result = await updateMonthlyScheduleEntry(entryId, patch, actor.id);
  if (!result.success) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}