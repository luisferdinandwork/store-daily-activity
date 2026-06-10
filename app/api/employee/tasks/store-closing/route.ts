// app/api/employee/tasks/store-closing/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { authOptions } from '@/lib/auth';
import {
  autoSaveStoreClosing,
  submitStoreClosing,
  type AutoSaveStoreClosingPatch,
  type GeoPoint,
  type StoreClosingOpenStatementDecision,
} from '@/lib/db/utils/store-closing';


function normalizeOpenStatementDecision(
  value: unknown,
): StoreClosingOpenStatementDecision {
  // Accept older UI values too, so the submit does not fail during rollout.
  if (value === 'on_hold' || value === 'hold') return 'on_hold';
  if (value === 'post_statement' || value === 'done') return 'post_statement';
  return value as StoreClosingOpenStatementDecision;
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as {
      taskId?: number | string;
      patch?: AutoSaveStoreClosingPatch;
    };

    const taskId = Number(body.taskId);

    if (!taskId || Number.isNaN(taskId)) {
      return NextResponse.json(
        { success: false, error: 'taskId wajib berupa number.' },
        { status: 400 },
      );
    }

    const result = await autoSaveStoreClosing({
      taskId,
      userId: session.user.id,
      patch: body.patch ?? {},
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[PATCH /api/employee/tasks/store-closing]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to auto-save Store Closing task.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as {
      taskId?: number | string;
      scheduleId?: number | string;
      storeId?: number | string;
      geo?: GeoPoint;
      skipGeo?: boolean;
      // New payload
      eodZReportDone?: boolean;
      eodEdcSettlementPhoto?: string | null;

      // Backward-compatible payload from the previous Store Closing UI.
      zReportPhotos?: string[];

      edcSettlementDone?: boolean;
      edcSettlementNotes?: string;
      edcSummaryDone?: boolean;
      edcSummaryNotes?: string;
      openStatementDecision?: StoreClosingOpenStatementDecision;
      openStatementHoldReason?: string;
      notes?: string;
    };

    const scheduleId = Number(body.scheduleId);
    const storeId = Number(body.storeId);
    const taskId = body.taskId == null ? undefined : Number(body.taskId);

    if (!scheduleId || Number.isNaN(scheduleId)) {
      return NextResponse.json(
        { success: false, error: 'scheduleId wajib berupa number.' },
        { status: 400 },
      );
    }

    if (!storeId || Number.isNaN(storeId)) {
      return NextResponse.json(
        { success: false, error: 'storeId wajib berupa number.' },
        { status: 400 },
      );
    }

    if (!body.geo && !body.skipGeo) {
      return NextResponse.json(
        { success: false, error: 'Lokasi wajib dikirim untuk submit task.' },
        { status: 400 },
      );
    }

    const openStatementDecision = normalizeOpenStatementDecision(
      body.openStatementDecision,
    );

    const result = await submitStoreClosing({
      taskId: taskId && !Number.isNaN(taskId) ? taskId : undefined,
      scheduleId,
      userId: session.user.id,
      storeId,
      geo: body.geo ?? { lat: 0, lng: 0 },
      skipGeo: body.skipGeo,
      eodZReportDone: !!body.eodZReportDone,
      eodEdcSettlementPhoto:
        body.eodEdcSettlementPhoto ?? body.zReportPhotos?.[0] ?? null,
      edcSettlementDone: !!body.edcSettlementDone,
      edcSettlementNotes: body.edcSettlementNotes,
      edcSummaryDone: !!body.edcSummaryDone,
      edcSummaryNotes: body.edcSummaryNotes,
      openStatementDecision,
      openStatementHoldReason: body.openStatementHoldReason,
      notes: body.notes,
    });

    if (!result.success) {
      console.warn('[POST /api/employee/tasks/store-closing] rejected:', result.error);
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    console.error('[POST /api/employee/tasks/store-closing]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to submit Store Closing task.' },
      { status: 500 },
    );
  }
}
