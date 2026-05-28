// app/api/ops/schedules/stores/route.ts
//
// GET /api/ops/schedules/stores
//
// Response shape:
//
//   Area OPS (single area):
//     {
//       success: true,
//       isHO:    false,
//       area:    { id, name } | null,
//       areas:   [ { id, name } ],            // single-element, for convenience
//       stores:  [
//         { id: "1", name, address, areaId, areaName },
//         …
//       ]
//     }
//
//   HO OPS / Admin (all areas):
//     {
//       success: true,
//       isHO:    true,
//       area:    null,
//       areas:   [ { id, name }, … ],         // every area in the system
//       stores:  [
//         { id: "1", name, address, areaId, areaName },
//         …
//       ]                                     // every store, sorted by area name then store name
//     }
//
// `stores[].id` is stringified so existing client code (which uses string IDs
// in sessionStorage / dropdowns) keeps working unchanged.

import { NextResponse }    from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth';
import { db }               from '@/lib/db';
import { stores, areas }    from '@/lib/db/schema';
import { eq, asc }          from 'drizzle-orm';
import { getOpsActor }      from '../_helpers';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const actor = await getOpsActor((session.user as any).id);
  if (!actor) {
    return NextResponse.json({ success: false, error: 'OPS only.' }, { status: 403 });
  }

  // ── HO / Admin: every area, every store ────────────────────────────────────
  if (actor.isHO) {
    const [allAreas, allStores] = await Promise.all([
      db
        .select({ id: areas.id, name: areas.name })
        .from(areas)
        .orderBy(asc(areas.name)),
      db
        .select({
          id:       stores.id,
          name:     stores.name,
          address:  stores.address,
          areaId:   stores.areaId,
          areaName: areas.name,
        })
        .from(stores)
        .leftJoin(areas, eq(areas.id, stores.areaId))
        .orderBy(asc(areas.name), asc(stores.name)),
    ]);

    return NextResponse.json({
      success: true,
      isHO:    true,
      area:    null,
      areas:   allAreas,
      stores:  allStores.map(s => ({
        id:       String(s.id),
        name:     s.name,
        address:  s.address,
        areaId:   s.areaId,
        areaName: s.areaName ?? '—',
      })),
    });
  }

  // ── Area OPS: their single area only ───────────────────────────────────────
  if (!actor.areaId) {
    return NextResponse.json(
      { success: false, error: 'No area assigned. Contact an admin.' },
      { status: 400 },
    );
  }

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
    .orderBy(asc(stores.name));

  return NextResponse.json({
    success: true,
    isHO:    false,
    area:    area ?? null,
    areas:   area ? [area] : [],
    stores:  areaStores.map(s => ({
      id:       String(s.id),
      name:     s.name,
      address:  s.address,
      areaId:   actor.areaId,
      areaName: area?.name ?? '—',
    })),
  });
}