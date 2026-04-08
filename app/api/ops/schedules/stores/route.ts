// app/api/ops/schedules/stores/route.ts
import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { db }               from '@/lib/db';
import { stores, areas }    from '@/lib/db/schema';
import { eq }               from 'drizzle-orm';
import { getOpsActor }      from '../_helpers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  if (!actor.areaId) return NextResponse.json({ success: false, error: 'No area assigned.' }, { status: 400 });

  const [area] = await db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(eq(areas.id, actor.areaId))
    .limit(1);

  const areaStores = await db
    .select({
      id:      stores.id,
      name:    stores.name,
      address: stores.address,
    })
    .from(stores)
    .where(eq(stores.areaId, actor.areaId))
    .orderBy(stores.name);

  return NextResponse.json({
    success: true,
    area:    area ?? null,
    stores:  areaStores.map(s => ({ ...s, id: String(s.id) })),
  });
}