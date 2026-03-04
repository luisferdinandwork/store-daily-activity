// app/api/ops/schedules/area/route.ts
//
// GET /api/ops/schedules/area
//
// Returns the full area → stores → templates + employees tree for the
// currently authenticated OPS user.
//
// Authorization:
//   - Caller must have role = 'ops' and a non-null areaId.
//   - Only stores belonging to that area are included.
//   - Calls ensureSchedulesUpToDate() for each store so the rolling
//     generator keeps schedules current on every page load.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { users, stores, areas, weeklyScheduleTemplates, weeklyScheduleEntries } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { ensureSchedulesUpToDate } from '@/lib/schedule-utils';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const u = session?.user as any;

    // ── Auth: OPS only ────────────────────────────────────────────────────────
    if (!u?.id || u?.role !== 'ops') {
      return NextResponse.json(
        { success: false, error: 'Only OPS users can access this resource.' },
        { status: 403 },
      );
    }

    if (!u?.areaId) {
      return NextResponse.json(
        { success: false, error: 'OPS user has no area assigned. Contact an admin.' },
        { status: 400 },
      );
    }

    const areaId: string  = u.areaId;
    const opsId:  string  = u.id;

    // ── 1. Fetch area ─────────────────────────────────────────────────────────
    const [area] = await db
      .select()
      .from(areas)
      .where(eq(areas.id, areaId))
      .limit(1);

    if (!area) {
      return NextResponse.json(
        { success: false, error: 'Area not found.' },
        { status: 404 },
      );
    }

    // ── 2. Fetch all stores in this area ──────────────────────────────────────
    const areaStores = await db
      .select()
      .from(stores)
      .where(eq(stores.areaId, areaId))
      .orderBy(stores.name);

    // ── 3. For each store: run rolling generator + fetch templates + employees ─
    const storeResults = await Promise.all(
      areaStores.map(async (store) => {
        // Trigger rolling schedule generation (lightweight if already up-to-date)
        await ensureSchedulesUpToDate(store.id);

        // Fetch active templates for this store
        const templateRows = await db
          .select({ tmpl: weeklyScheduleTemplates, user: users })
          .from(weeklyScheduleTemplates)
          .leftJoin(users, eq(weeklyScheduleTemplates.userId, users.id))
          .where(
            and(
              eq(weeklyScheduleTemplates.storeId,  store.id),
              eq(weeklyScheduleTemplates.isActive, true),
            ),
          )
          .orderBy(users.name);

        // Fetch entries for each template
        const templates = await Promise.all(
          templateRows.map(async ({ tmpl, user }) => {
            const entries = await db
              .select({
                id:         weeklyScheduleEntries.id,
                templateId: weeklyScheduleEntries.templateId,
                weekday:    weeklyScheduleEntries.weekday,
                shift:      weeklyScheduleEntries.shift,
                createdAt:  weeklyScheduleEntries.createdAt,
              })
              .from(weeklyScheduleEntries)
              .where(eq(weeklyScheduleEntries.templateId, tmpl.id))
              .orderBy(weeklyScheduleEntries.weekday);

            return {
              template: {
                id:                   tmpl.id,
                userId:               tmpl.userId,
                storeId:              tmpl.storeId,
                isActive:             tmpl.isActive,
                note:                 tmpl.note ?? null,
                createdBy:            tmpl.createdBy ?? null,
                lastScheduledThrough: tmpl.lastScheduledThrough?.toISOString() ?? null,
                createdAt:            tmpl.createdAt.toISOString(),
                updatedAt:            tmpl.updatedAt.toISOString(),
              },
              entries: entries.map((e) => ({
                id:         e.id,
                templateId: e.templateId,
                weekday:    Number(e.weekday), // pg enum '0'–'6' → number
                shift:      e.shift,
                createdAt:  e.createdAt.toISOString(),
              })),
              user: user
                ? {
                    id:           user.id,
                    name:         user.name,
                    role:         user.role,
                    employeeType: user.employeeType ?? null,
                  }
                : null,
            };
          }),
        );

        // Fetch all employee-role users for this store (for the override editor dropdown)
        const employees = await db
          .select({
            id:           users.id,
            name:         users.name,
            role:         users.role,
            employeeType: users.employeeType,
          })
          .from(users)
          .where(
            and(
              eq(users.storeId, store.id),
              eq(users.role,    'employee'),
            ),
          )
          .orderBy(users.name);

        return {
          storeId:   store.id,
          storeName: store.name,
          address:   store.address,
          templates,
          employees,
        };
      }),
    );

    return NextResponse.json({
      success: true,
      area: {
        areaId:   area.id,
        areaName: area.name,
        stores:   storeResults,
      },
    });
  } catch (err) {
    console.error('[GET /api/ops/schedules/area]', err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}