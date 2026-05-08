// app/api/employee/tasks/store-opening/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { storeOpeningTasks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  submitStoreOpening,
  autoSaveStoreOpening,
  type StoreOpeningAutoSavePatch,
} from '@/lib/db/utils/store-opening';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (Number.isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function optionalInt(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseInt(String(val), 10);
  // Treat 0/negative as missing. The employee page can briefly render with taskId: 0
  // before taskData is loaded; using 0 as a real id breaks autosave.
  return Number.isNaN(n) || n <= 0 ? undefined : n;
}

function toBool(v: unknown): boolean {
  return v === true;
}

function toStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function toOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function toGeo(geo: unknown): { lat: number; lng: number } | null {
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

async function resolveTask(taskId: number | undefined): Promise<{
  scheduleId?: number;
  storeId?: number;
}> {
  if (!taskId) return {};
  const [row] = await db
    .select({ scheduleId: storeOpeningTasks.scheduleId, storeId: storeOpeningTasks.storeId })
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.id, taskId))
    .limit(1);
  return row ?? {};
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const taskId = optionalInt(body.taskId);
  const resolved = await resolveTask(taskId);

  let scheduleId: number;
  let storeId: number;
  try {
    scheduleId = optionalInt(body.scheduleId) ?? resolved.scheduleId ?? toInt(undefined, 'scheduleId');
    storeId = optionalInt(body.storeId) ?? resolved.storeId ?? toInt(undefined, 'storeId');
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const geo = toGeo(body.geo);
  if (!geo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib aktif untuk mengerjakan Store Opening.' },
      { status: 400 },
    );
  }

  const result = await submitStoreOpening({
    taskId,
    scheduleId,
    userId: session.user.id,
    storeId,
    geo,
    skipGeo: false,

    loginPos: toBool(body.loginPos),
    checkAbsenSunfish: toBool(body.checkAbsenSunfish),
    tarikSohSales: toBool(body.tarikSohSales),
    fiveR: toBool(body.fiveR),

    fiveRAreaKasirPhotos: toStrArray(body.fiveRAreaKasirPhotos),
    fiveRAreaDepanPhotos: toStrArray(body.fiveRAreaDepanPhotos),
    fiveRAreaKananPhotos: toStrArray(body.fiveRAreaKananPhotos),
    fiveRAreaKiriPhotos: toStrArray(body.fiveRAreaKiriPhotos),
    fiveRAreaGudangPhotos: toStrArray(body.fiveRAreaGudangPhotos),

    cekLamp: toBool(body.cekLamp),
    cekSoundSystem: toBool(body.cekSoundSystem),
    cashierDeskPhotos: toStrArray(body.cashierDeskPhotos ?? body.cashDrawerPhotos),
    notes: toOptionalString(body.notes),
  });

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const taskId = optionalInt(body.taskId);
  const resolved = await resolveTask(taskId);

  let scheduleId: number | undefined = optionalInt(body.scheduleId) ?? resolved.scheduleId;
  let storeId: number | undefined = optionalInt(body.storeId) ?? resolved.storeId;

  if (!taskId && !storeId) {
    return NextResponse.json({ success: false, error: 'taskId or storeId is required.' }, { status: 400 });
  }

  const geo = toGeo(body.geo);
  if (!geo) {
    return NextResponse.json(
      { success: false, error: 'Lokasi wajib aktif untuk menyimpan Store Opening.' },
      { status: 400 },
    );
  }

  const patch: StoreOpeningAutoSavePatch = {};
  if ('loginPos' in body) patch.loginPos = toBool(body.loginPos);
  if ('checkAbsenSunfish' in body) patch.checkAbsenSunfish = toBool(body.checkAbsenSunfish);
  if ('tarikSohSales' in body) patch.tarikSohSales = toBool(body.tarikSohSales);
  if ('fiveR' in body) patch.fiveR = toBool(body.fiveR);
  if ('fiveRAreaKasirPhotos' in body) patch.fiveRAreaKasirPhotos = toStrArray(body.fiveRAreaKasirPhotos);
  if ('fiveRAreaDepanPhotos' in body) patch.fiveRAreaDepanPhotos = toStrArray(body.fiveRAreaDepanPhotos);
  if ('fiveRAreaKananPhotos' in body) patch.fiveRAreaKananPhotos = toStrArray(body.fiveRAreaKananPhotos);
  if ('fiveRAreaKiriPhotos' in body) patch.fiveRAreaKiriPhotos = toStrArray(body.fiveRAreaKiriPhotos);
  if ('fiveRAreaGudangPhotos' in body) patch.fiveRAreaGudangPhotos = toStrArray(body.fiveRAreaGudangPhotos);
  if ('cekLamp' in body) patch.cekLamp = toBool(body.cekLamp);
  if ('cekSoundSystem' in body) patch.cekSoundSystem = toBool(body.cekSoundSystem);
  if ('cashierDeskPhotos' in body || 'cashDrawerPhotos' in body) {
    patch.cashierDeskPhotos = toStrArray(body.cashierDeskPhotos ?? body.cashDrawerPhotos);
  }
  if ('notes' in body) patch.notes = toOptionalString(body.notes);

  const result = await autoSaveStoreOpening(
    storeId!,
    patch,
  );

  if (!result.success) {
    console.warn('[PATCH /api/employee/tasks/store-opening] failed:', result.error, { taskId, scheduleId, storeId });
  }

  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
