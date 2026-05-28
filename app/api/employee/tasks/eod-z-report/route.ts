// app/api/employee/tasks/eod-z-report/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { autoSaveEodZReport, submitEodZReport } from '@/lib/db/utils/eod-z-report';

function unauthorized() {
  return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return unauthorized();

  const body = await request.json();
  const result = await submitEodZReport({
    scheduleId: Number(body.scheduleId),
    userId,
    storeId: Number(body.storeId),
    geo: body.geo ?? { lat: 0, lng: 0 },
    skipGeo: Boolean(body.skipGeo),
    zReportPhotos: Array.isArray(body.zReportPhotos) ? body.zReportPhotos : [],
    notes: body.notes,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return unauthorized();

  const body = await request.json();
  const result = await autoSaveEodZReport(Number(body.scheduleId), {
    zReportPhotos: body.zReportPhotos,
    notes: body.notes,
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

// Keep compatibility with useAutoSave implementations that use PUT.
export const PUT = PATCH;
