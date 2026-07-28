// app/api/employee/task-settings/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employee/task-settings
// Lightweight map of { [taskCode]: requiresLocation } for every active task
// type, read by task detail pages before they request the geolocation
// permission. OPS controls this per task type from /ops/tasks/settings.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { taskDefinitions } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = await db
      .select({ code: taskDefinitions.code, requiresLocation: taskDefinitions.requiresLocation })
      .from(taskDefinitions)
      .where(eq(taskDefinitions.isActive, true));

    const settings: Record<string, boolean> = {};
    for (const r of rows) settings[r.code] = r.requiresLocation;

    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error('GET /api/employee/task-settings failed:', err);
    // Fail safe: treat every task type as requiring location so callers don't
    // silently skip a permission/geofence check due to a transient DB error.
    return NextResponse.json({ success: false, settings: {} }, { status: 500 });
  }
}
