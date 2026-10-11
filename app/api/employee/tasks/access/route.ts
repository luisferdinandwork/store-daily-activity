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
//   acc         (optional) — float, reported GPS accuracy in metres
//
// Response: TaskAccessStatus JSON
//   { status: 'ok' }
//   { status: 'not_checked_in' }
//   { status: 'outside_geofence', distanceM: number, radiusM: number, accuracyM: number | null }
//   { status: 'geo_unavailable' }
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse }         from 'next/server';
import { getServerSession }     from 'next-auth';
import { authOptions }          from '@/lib/auth';
import { getTaskAccessStatus }  from '@/lib/db/utils/tasks';
import { parseGeoPoint }        from '@/lib/geo';
import { db } from '@/lib/db';
import { schedules, stores } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { resolveSetoranActorSchedule } from '@/lib/db/utils/setoran';
import { taskRequiresLocation } from '@/lib/db/utils/task-location';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  let scheduleId = Number(searchParams.get('scheduleId'));
  const storeId = Number(searchParams.get('storeId'));
  const taskType = searchParams.get('taskType');
  const latStr     = searchParams.get('lat');
  const lngStr     = searchParams.get('lng');
  const accStr     = searchParams.get('acc');

  if (!Number.isSafeInteger(scheduleId) || scheduleId <= 0 || !Number.isSafeInteger(storeId) || storeId <= 0) {
    return NextResponse.json({ error: 'scheduleId and storeId are required.' }, { status: 400 });
  }

  const geo = parseGeoPoint(latStr, lngStr, accStr);

  try {
    const [schedule] = await db.select({ userId: schedules.userId, storeId: schedules.storeId, date: schedules.date, status: stores.status })
      .from(schedules).innerJoin(stores, eq(stores.id, schedules.storeId))
      .where(eq(schedules.id, scheduleId)).limit(1);
    if (!schedule || schedule.storeId !== storeId || schedule.status !== 'active') {
      return NextResponse.json({ success: false, status: 'validation_unavailable', error: 'Jadwal atau toko tidak tersedia.' }, { status: 403 });
    }
    if (taskType === 'setoran') {
      const ownScheduleId = await resolveSetoranActorSchedule(session.user.id, storeId, schedule.date);
      if (!ownScheduleId) return NextResponse.json({ success: false, status: 'validation_unavailable', error: 'Tidak ada jadwal setoran untuk kamu di toko ini.' }, { status: 403 });
      scheduleId = ownScheduleId;
    } else if (schedule.userId !== session.user.id) {
      return NextResponse.json({ success: false, status: 'validation_unavailable', error: 'Jadwal bukan milik kamu.' }, { status: 403 });
    }
    const requireGeo = taskType ? await taskRequiresLocation(taskType) : true;
    const result = await getTaskAccessStatus(scheduleId, storeId, geo, requireGeo);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[GET /api/employee/tasks/access]', err);
    return NextResponse.json({ success: false, status: 'validation_unavailable', error: 'Validasi belum tersedia. Coba cek ulang.' }, { status: 503 });
  }
}
