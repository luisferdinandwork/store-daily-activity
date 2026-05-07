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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (Number.isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

function tryInt(val: unknown): number | null {
  if (val === undefined || val === null || val === '') return null;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Parse a money value from the request body into a plain numeric string.
 * Returns undefined when the key was not present / is completely absent.
 * Returns null when the value was explicitly cleared (empty string / null).
 */
function toMoneyString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;          // key not present — skip
  if (v === null || v === '') return null;         // explicit clear

  if (typeof v === 'number' && Number.isFinite(v)) return String(v);

  if (typeof v === 'string') {
    const cleaned = v
      .replace(/rp/gi, '')
      .replace(/\s/g, '')
      .replace(/,/g, '')
      .replace(/\.(?=\d{3}(\D|$))/g, '')
      .trim();
    return cleaned === '' ? null : cleaned;
  }

  return undefined;
}

/**
 * Parse a photo URL field.
 * Returns undefined when key absent, null when explicitly cleared, string when set.
 */
function toPhotoString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;          // key not present — skip
  if (v === null || v === '') return null;         // explicit clear (user removed photo)
  if (typeof v === 'string') return v;
  return undefined;
}

function toOptionalNotes(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' ? v : undefined;
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
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

async function resolveTask(body: Record<string, unknown>, userId: string) {
  const taskId = tryInt(body.taskId);
  if (!taskId) return null;

  const task = await getSetoranById(taskId);
  if (!task)            throw new Error(`Setoran task ${taskId} not found.`);
  if (task.userId !== userId) throw new Error('Forbidden');
  return task;
}

// ─── POST — final submit ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError('Unauthorized', 401);

  const parsed = await readJson(req);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  try {
    const task = await resolveTask(body, session.user.id);

    const scheduleId = tryInt(body.scheduleId) ?? task?.scheduleId;
    const storeId    = tryInt(body.storeId)    ?? task?.storeId;
    if (!scheduleId) return jsonError('scheduleId is required.');
    if (!storeId)    return jsonError('storeId is required.');

    // Prefer new field names; fall back to old names for backward compat
    const actualReceived = toMoneyString(body.actualReceivedAmount) ?? toMoneyString(body.expectedAmount);
    const stored         = toMoneyString(body.storedAmount)         ?? toMoneyString(body.amount);

    const result = await submitSetoran({
      scheduleId,
      userId: session.user.id,
      storeId,
      actualReceivedAmount: actualReceived ?? undefined,
      storedAmount:         stored         ?? undefined,
      // Keep old names for util compat
      expectedAmount:       actualReceived ?? undefined,
      amount:               stored         ?? undefined,
      resiPhoto:            typeof body.resiPhoto         === 'string' ? body.resiPhoto         : '',
      atmCardSelfiePhoto:   typeof body.atmCardSelfiePhoto === 'string' ? body.atmCardSelfiePhoto : '',
      notes: toOptionalNotes(body.notes),
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/employee/tasks/setoran]', err);
    return jsonError(msg, msg === 'Forbidden' ? 403 : 500);
  }
}

// ─── PATCH — auto-save ────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return jsonError('Unauthorized', 401);

  const parsed = await readJson(req);
  if (parsed instanceof NextResponse) return parsed;
  const body = parsed;

  try {
    const task       = await resolveTask(body, session.user.id);
    const scheduleId = tryInt(body.scheduleId) ?? task?.scheduleId;
    if (!scheduleId) return jsonError('scheduleId or taskId is required for Setoran autosave.');

    const patch: SetoranAutoSavePatch = {};

    // ── Money fields ──────────────────────────────────────────────────────────
    // New names take priority. Only write one set — avoid double-writing the
    // same DB columns via both old and new aliases in the same request.

    if ('actualReceivedAmount' in body) {
      const v = toMoneyString(body.actualReceivedAmount);
      if (v !== undefined) {
        patch.actualReceivedAmount = v;
        patch.expectedAmount       = v;   // keep DB column in sync (same column)
      }
    } else if ('expectedAmount' in body) {
      const v = toMoneyString(body.expectedAmount);
      if (v !== undefined) {
        patch.expectedAmount       = v;
        patch.actualReceivedAmount = v;
      }
    }

    if ('storedAmount' in body) {
      const v = toMoneyString(body.storedAmount);
      if (v !== undefined) {
        patch.storedAmount = v;
        patch.amount       = v;           // keep DB column in sync
      }
    } else if ('amount' in body) {
      const v = toMoneyString(body.amount);
      if (v !== undefined) {
        patch.amount       = v;
        patch.storedAmount = v;
      }
    }

    // ── Photo fields ──────────────────────────────────────────────────────────
    // Only include in patch when the key was actually present in the request.
    // This prevents overwriting a saved photo with null on every auto-save.

    if ('resiPhoto' in body) {
      const v = toPhotoString(body.resiPhoto);
      if (v !== undefined) patch.resiPhoto = v;   // null = explicit clear, string = set
    }

    if ('atmCardSelfiePhoto' in body) {
      const v = toPhotoString(body.atmCardSelfiePhoto);
      if (v !== undefined) patch.atmCardSelfiePhoto = v;
    }

    // ── Notes ─────────────────────────────────────────────────────────────────

    if ('notes' in body) {
      const v = toOptionalNotes(body.notes);
      if (v !== undefined) patch.notes = v;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: true, data: { saved: [] } });
    }

    const result = await autoSaveSetoran(scheduleId, patch);

    if (!result.success) {
      console.warn('[PATCH /api/employee/tasks/setoran] autosave failed:', result.error, { scheduleId });
    }

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[PATCH /api/employee/tasks/setoran]', err);
    return jsonError(msg, msg === 'Forbidden' ? 403 : 500);
  }
}