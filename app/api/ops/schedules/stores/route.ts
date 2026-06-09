// app/api/ops/schedules/stores/route.ts
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';

import {
  getOpsActor,
  listAreasForActor,
  listStoresForActor,
} from '../_helpers';

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const actor = await getOpsActor(session.user.id);

  if (!actor) {
    return NextResponse.json(
      { success: false, error: 'OPS only.' },
      { status: 403 },
    );
  }

  const [areas, stores] = await Promise.all([
    listAreasForActor(actor),
    listStoresForActor(actor),
  ]);

  return NextResponse.json({
    success: true,
    isHO: actor.isHO,
    area: actor.isHO ? null : (areas[0] ?? null),
    areas,
    stores: stores.map((store) => ({
      id: String(store.id),
      name: store.name,
      address: store.address,
      areaId: store.areaId,
      areaName: store.areaName ?? '—',
    })),
  });
}
