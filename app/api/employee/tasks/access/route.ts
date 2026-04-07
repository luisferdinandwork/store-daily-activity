// app/api/employee/tasks/access/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/employee/tasks/access?scheduleId=…&storeId=…&lat=…&lng=…
//
// Returns TaskAccessStatus so the frontend can show the correct blocking banner
// before the employee tries to interact with a task.
//
// Query params:
//   scheduleId  (required) — integer schedule row id
//   storeId     (required) — integer store id
//   lat         (optional) — float, employee's current latitude
//   lng         (optional) — float, employee's current longitude
//
// Response: TaskAccessStatus JSON
//   { status: 'ok' }
//   { status: 'not_checked_in' }
//   { status: 'outside_geofence', distanceM: number, radiusM: number }
//   { status: 'geo_unavailable' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server';
import { getServerSession }     from 'next-auth';
import { authOptions }          from '@/lib/auth';
import { getTaskAccessStatus }  from '@/lib/db/utils/tasks';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const scheduleId = parseInt(searchParams.get('scheduleId') ?? '', 10);
  const storeId    = parseInt(searchParams.get('storeId')    ?? '', 10);
  const latStr     = searchParams.get('lat');
  const lngStr     = searchParams.get('lng');

  if (!scheduleId || !storeId) {
    return NextResponse.json({ error: 'scheduleId and storeId are required.' }, { status: 400 });
  }

  const geo =
    latStr && lngStr
      ? { lat: parseFloat(latStr), lng: parseFloat(lngStr) }
      : null;

  try {
    const result = await getTaskAccessStatus(scheduleId, storeId, geo);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[GET /api/employee/tasks/access]', err);
    // Fail open — don't block the employee due to a server error
    return NextResponse.json({ status: 'geo_unavailable' });
  }
}