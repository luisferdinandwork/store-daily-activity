// app/api/employee/tasks/setoran/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  submitSetoran,
  autoSaveSetoran,
  getSetoranById,
  type SetoranAutoSavePatch,
} from '@/lib/db/utils/setoran';

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (Number.isNaN(n)) {
    throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  }
  return n;
}

function tryInt(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
}

function toMoneyString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);

  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return '';

    // Accept plain values like "150000", "150000.50", and also UI formatted values
    // like "Rp 150.000" or "150,000" by stripping non-number separators.
    const normalized = trimmed
      .replace(/rp/gi, '')
      .replace(/\s/g, '')
      .replace(/,/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '');

    return normalized;
  }

  return undefined;
}

function toOptionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function jsonError(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error, ...(extra ?? {}) }, { status });
}

async function readJson(req: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object') return jsonError('JSON body must be an object.');
    return body as Record<string, unknown>;
  } catch {
    return jsonError('Invalid JSON body');
  }
}

async function resolveTaskFromBody(body: Record<string, unknown>, userId: string) {
  const taskId = tryInt(body.taskId);

  if (!taskId) return null;

  const task = await getSetoranById(taskId);
  if (!task) {
    throw new Error(`Setoran task ${taskId} not found.`);
  }

  if (task.userId !== userId) {
    throw new Error('Forbidden');
  }

  return task;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError('Unauthorized', 401);
  }

  const parsed = await readJson(req);
  if (parsed instanceof NextResponse) return parsed;

  const body = parsed;

  try {
    const task = await resolveTaskFromBody(body, session.user.id);

    const scheduleId = tryInt(body.scheduleId) ?? task?.scheduleId;
    const storeId = tryInt(body.storeId) ?? task?.storeId;

    if (!scheduleId) return jsonError('scheduleId is required.');
    if (!storeId) return jsonError('storeId is required.');

    const result = await submitSetoran({
      scheduleId,
      userId: session.user.id,
      storeId,

      // New names:
      actualReceivedAmount: toMoneyString(body.actualReceivedAmount),
      storedAmount: toMoneyString(body.storedAmount),

      // Backward-compatible old names:
      expectedAmount: toMoneyString(body.expectedAmount),
      amount: toMoneyString(body.amount),

      resiPhoto: toOptionalString(body.resiPhoto) ?? '',
      atmCardSelfiePhoto: toOptionalString(body.atmCardSelfiePhoto) ?? '',
      notes: toOptionalString(body.notes),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Forbidden' ? 403 : 500;
    console.error('[POST /api/employee/tasks/setoran]', err);
    return jsonError(message, status);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonError('Unauthorized', 401);
  }

  const parsed = await readJson(req);
  if (parsed instanceof NextResponse) return parsed;

  const body = parsed;

  try {
    const task = await resolveTaskFromBody(body, session.user.id);
    const scheduleId = tryInt(body.scheduleId) ?? task?.scheduleId;

    if (!scheduleId) {
      return jsonError('scheduleId or taskId is required for Setoran autosave.');
    }

    const patch: SetoranAutoSavePatch = {};

    if ('actualReceivedAmount' in body) {
      patch.actualReceivedAmount = toMoneyString(body.actualReceivedAmount) ?? null;
    }
    if ('storedAmount' in body) {
      patch.storedAmount = toMoneyString(body.storedAmount) ?? null;
    }

    // Backward-compatible old names:
    if ('expectedAmount' in body) {
      patch.expectedAmount = toMoneyString(body.expectedAmount) ?? null;
    }
    if ('amount' in body) {
      patch.amount = toMoneyString(body.amount) ?? null;
    }

    if ('resiPhoto' in body) {
      patch.resiPhoto = toOptionalString(body.resiPhoto) ?? null;
    }
    if ('atmCardSelfiePhoto' in body) {
      patch.atmCardSelfiePhoto = toOptionalString(body.atmCardSelfiePhoto) ?? null;
    }
    if ('notes' in body) {
      patch.notes = toOptionalString(body.notes);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: { saved: [] } });
    }

    const result = await autoSaveSetoran(scheduleId, patch);

    if (!result.success) {
      console.warn('[PATCH /api/employee/tasks/setoran] autosave failed:', result.error, {
        scheduleId,
        taskId: body.taskId,
      });
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Forbidden' ? 403 : 500;
    console.error('[PATCH /api/employee/tasks/setoran]', err);
    return jsonError(message, status);
  }
}
