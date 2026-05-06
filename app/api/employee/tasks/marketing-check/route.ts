// app/api/employee/tasks/marketing-check/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  submitMarketingCheck,
  autoSaveMarketingCheck,
} from '@/lib/db/utils/marketing-check';

function toBool(v: unknown): boolean {
  return v === true;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const body = await req.json();

    const scheduleId = Number(body.scheduleId);
    const storeId = Number(body.storeId);

    if (!Number.isFinite(scheduleId) || !Number.isFinite(storeId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid scheduleId or storeId.' },
        { status: 400 },
      );
    }

    const result = await submitMarketingCheck({
      scheduleId,
      userId: session.user.id,
      storeId,
      geo: body.geo ?? null,
      skipGeo: Boolean(body.skipGeo),

      promoName: toBool(body.promoName),
      promoPeriod: toBool(body.promoPeriod),
      promoMechanism: toBool(body.promoMechanism),
      randomShoeItems: toBool(body.randomShoeItems),
      randomNonShoeItems: toBool(body.randomNonShoeItems),
      sellTag: toBool(body.sellTag),

      notes: typeof body.notes === 'string' ? body.notes : undefined,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[POST /api/employee/tasks/marketing-check]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to submit Marketing Check.' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    const body = await req.json();
    const scheduleId = Number(body.scheduleId);

    if (!Number.isFinite(scheduleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid scheduleId.' },
        { status: 400 },
      );
    }

    const patch = {
      promoName: typeof body.promoName === 'boolean' ? body.promoName : undefined,
      promoPeriod: typeof body.promoPeriod === 'boolean' ? body.promoPeriod : undefined,
      promoMechanism: typeof body.promoMechanism === 'boolean' ? body.promoMechanism : undefined,
      randomShoeItems: typeof body.randomShoeItems === 'boolean' ? body.randomShoeItems : undefined,
      randomNonShoeItems: typeof body.randomNonShoeItems === 'boolean' ? body.randomNonShoeItems : undefined,
      sellTag: typeof body.sellTag === 'boolean' ? body.sellTag : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    };

    const result = await autoSaveMarketingCheck(scheduleId, patch);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/marketing-check]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to autosave Marketing Check.' },
      { status: 500 },
    );
  }
}