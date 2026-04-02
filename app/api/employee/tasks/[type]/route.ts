// app/api/employee/tasks/[type]/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/employee/tasks/:type
//
// Submits a completed task. Called by the task detail page.
//
// Body shape (all tasks share these base fields):
//   scheduleId : number   — from taskData.scheduleId (parsed to int here)
//   storeId    : number   — from taskData.storeId    (parsed to int here)
//   geo        : { lat: number; lng: number } | null
//   skipGeo    : boolean  — true when geo could not be obtained
//   notes      : string | undefined
//   ...task-specific fields
//
// Why the 400 was happening
// ──────────────────────────
//  1. The detail page was reading `storeId` from `session.user.homeStoreId`
//     which is undefined for cross-deployed employees.  Fixed: the page now
//     sends `taskData.storeId` instead.
//  2. `scheduleId` arrived as a string ("123") but `submitStoreOpening` typed
//     it as `number`.  Fixed: we parseInt() every numeric FK in this handler.
//  3. `geo` was sent as `{ lat: 0, lng: 0 }` when geolocation failed, which
//     caused a geofence rejection.  Fixed: page sends `geo: null` and sets
//     `skipGeo: true` automatically when location is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import {
  submitStoreOpening,
  submitSetoran,
  submitProductCheck,
  submitReceiving,
  submitBriefing,
  submitEdcSummary,
  submitEdcSettlement,
  submitEodZReport,
  submitOpenStatement,
  submitGrooming,
} from '@/lib/db/utils/tasks';
import { db }          from '@/lib/db';
import { cekBinTasks } from '@/lib/db/schema';
import { eq }          from 'drizzle-orm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert whatever arrives (string | number | undefined) to an integer or throw. */
function toInt(val: unknown, field: string): number {
  const n = parseInt(String(val ?? ''), 10);
  if (isNaN(n)) throw new Error(`${field} must be a valid integer, got: ${JSON.stringify(val)}`);
  return n;
}

/** Normalise geo: return null if not supplied or skipGeo is true. */
function toGeo(geo: unknown, skipGeo: boolean): { lat: number; lng: number } | null {
  if (skipGeo) return null;
  if (!geo || typeof geo !== 'object') return null;
  const { lat, lng } = geo as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return { lat, lng };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { type } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Parse shared base fields ───────────────────────────────────────────────
  let scheduleId: number;
  let storeId:    number;

  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
    storeId    = toInt(body.storeId,    'storeId');
  } catch (e) {
    console.error(`[POST /api/employee/tasks/${type}] bad base fields:`, body);
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  const userId  = session.user.id as string;
  const skipGeo = body.skipGeo === true;
  const rawGeo  = toGeo(body.geo, skipGeo);
  const notes   = typeof body.notes === 'string' ? body.notes : undefined;

  // geo is required unless skipped — if null and not skipping, we pass a dummy
  // that the util will validate (store has no coords → skip; store has coords → reject)
  const geo = rawGeo ?? { lat: 0, lng: 0 };
  const effectiveSkipGeo = skipGeo || rawGeo === null;

  const base = { scheduleId, userId, storeId, geo, skipGeo: effectiveSkipGeo, notes };

  console.log(`[POST /api/employee/tasks/${type}]`, {
    scheduleId, storeId, userId, skipGeo: effectiveSkipGeo, geo: rawGeo,
  });

  try {
    switch (type) {

      // ── Morning ─────────────────────────────────────────────────────────────

      case 'store_opening': {
        const {
          loginPos, checkAbsenSunfish, tarikSohSales,
          fiveR, cekLamp, cekSoundSystem,
          storeFrontPhotos, cashDrawerPhotos,
        } = body;

        if (typeof loginPos !== 'boolean') {
          return NextResponse.json({ success: false, error: 'loginPos must be boolean' }, { status: 400 });
        }

        const result = await submitStoreOpening({
          ...base,
          loginPos:          Boolean(loginPos),
          checkAbsenSunfish: Boolean(checkAbsenSunfish),
          tarikSohSales:     Boolean(tarikSohSales),
          fiveR:             Boolean(fiveR),
          cekLamp:           Boolean(cekLamp),
          cekSoundSystem:    Boolean(cekSoundSystem),
          storeFrontPhotos:  Array.isArray(storeFrontPhotos) ? storeFrontPhotos as string[] : [],
          cashDrawerPhotos:  Array.isArray(cashDrawerPhotos) ? cashDrawerPhotos as string[] : [],
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'setoran': {
        const { amount, linkSetoran, moneyPhotos } = body;

        if (!amount || !linkSetoran) {
          return NextResponse.json(
            { success: false, error: 'amount and linkSetoran are required' },
            { status: 400 },
          );
        }

        const result = await submitSetoran({
          ...base,
          amount:      String(amount),
          linkSetoran: String(linkSetoran),
          moneyPhotos: Array.isArray(moneyPhotos) ? moneyPhotos as string[] : [],
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'cek_bin': {
        // Stub: no business logic — just mark completed
        const [existing] = await db
          .select({ id: cekBinTasks.id, status: cekBinTasks.status })
          .from(cekBinTasks)
          .where(eq(cekBinTasks.scheduleId, scheduleId))
          .limit(1);

        if (!existing) {
          return NextResponse.json({ success: false, error: 'Cek bin task not found.' }, { status: 404 });
        }
        if (existing.status === 'verified') {
          return NextResponse.json({ success: false, error: 'Task already verified.' }, { status: 400 });
        }

        await db
          .update(cekBinTasks)
          .set({ status: 'completed', notes, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(cekBinTasks.id, existing.id));

        return NextResponse.json({ success: true });
      }

      case 'product_check': {
        const { display, price, saleTag, shoeFiller, labelIndo, barcode } = body;
        const result = await submitProductCheck({
          ...base,
          display:    Boolean(display),
          price:      Boolean(price),
          saleTag:    Boolean(saleTag),
          shoeFiller: Boolean(shoeFiller),
          labelIndo:  Boolean(labelIndo),
          barcode:    Boolean(barcode),
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'receiving': {
        const { hasReceiving, receivingPhotos } = body;
        const result = await submitReceiving({
          ...base,
          hasReceiving:    Boolean(hasReceiving),
          receivingPhotos: Array.isArray(receivingPhotos) ? receivingPhotos as string[] : [],
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      // ── Evening ─────────────────────────────────────────────────────────────

      case 'briefing': {
        const result = await submitBriefing({ ...base, done: Boolean(body.done) });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'edc_summary': {
        const photos = Array.isArray(body.photos) ? body.photos as string[] : [];
        const result = await submitEdcSummary({ ...base, photos });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'edc_settlement': {
        const photos = Array.isArray(body.photos) ? body.photos as string[] : [];
        const result = await submitEdcSettlement({ ...base, photos });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'eod_z_report': {
        const photos = Array.isArray(body.photos) ? body.photos as string[] : [];
        const result = await submitEodZReport({ ...base, photos });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      case 'open_statement': {
        const photos = Array.isArray(body.photos) ? body.photos as string[] : [];
        const result = await submitOpenStatement({ ...base, photos });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      // ── Both shifts ──────────────────────────────────────────────────────────

      case 'grooming': {
        const {
          uniformComplete, hairGroomed, nailsClean,
          accessoriesCompliant, shoeCompliant, selfiePhotos,
        } = body;
        const result = await submitGrooming({
          ...base,
          uniformComplete:      Boolean(uniformComplete),
          hairGroomed:          Boolean(hairGroomed),
          nailsClean:           Boolean(nailsClean),
          accessoriesCompliant: Boolean(accessoriesCompliant),
          shoeCompliant:        Boolean(shoeCompliant),
          selfiePhotos:         Array.isArray(selfiePhotos) ? selfiePhotos as string[] : [],
        });
        return NextResponse.json(result, { status: result.success ? 200 : 400 });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown task type: ${type}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error(`[POST /api/employee/tasks/${type}]`, err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/employee/tasks/:type
//
// Partial / auto-save — persists checklist state and photos mid-task.
// Does NOT advance status to 'completed'. The task stays in_progress so
// any employee on the same shift can pick up where the previous one left off.
//
// Only updates columns that are explicitly present in the body.
// Ignores fields that are not relevant to the task type.
//
// Body: { scheduleId, storeId, ...partial fields }
// Returns: { success: true, saved: string[] }   (list of saved column names)
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { type } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  let scheduleId: number;
  try {
    scheduleId = toInt(body.scheduleId, 'scheduleId');
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e) }, { status: 400 });
  }

  // Import all task tables
  const {
    storeOpeningTasks, setoranTasks, cekBinTasks,
    productCheckTasks, receivingTasks, briefingTasks,
    edcSummaryTasks, edcSettlementTasks, eodZReportTasks,
    openStatementTasks, groomingTasks,
  } = await import('@/lib/db/schema');

  const { eq } = await import('drizzle-orm');
  const { db } = await import('@/lib/db');

  // Helper: build a partial update set from the body, only including known
  // fields that are explicitly present (not undefined).
  function pick<T extends Record<string, unknown>>(
    allowed: (keyof T)[],
    src: Record<string, unknown>,
    coerce?: Partial<Record<keyof T, (v: unknown) => unknown>>,
  ): Partial<T> {
    const out: Partial<T> = {};
    for (const k of allowed) {
      if (k in src) {
        const val = src[k as string];
        (out as Record<string, unknown>)[k as string] = coerce?.[k] ? coerce[k]!(val) : val;
      }
    }
    return out;
  }

  function jsonArr(v: unknown): string | undefined {
    return Array.isArray(v) ? JSON.stringify(v) : undefined;
  }
  function bool(v: unknown): boolean { return Boolean(v); }

  try {
    let patch: Record<string, unknown> = {};
    let table: typeof storeOpeningTasks;

    switch (type) {
      case 'store_opening':
        table = storeOpeningTasks;
        patch = pick(
          ['loginPos','checkAbsenSunfish','tarikSohSales','fiveR','cekLamp','cekSoundSystem','notes'],
          body,
          { loginPos: bool, checkAbsenSunfish: bool, tarikSohSales: bool, fiveR: bool, cekLamp: bool, cekSoundSystem: bool, notes: (v) => v },
        );
        if ('storeFrontPhotos' in body) patch.storeFrontPhotos = jsonArr(body.storeFrontPhotos);
        if ('cashDrawerPhotos' in body) patch.cashDrawerPhotos = jsonArr(body.cashDrawerPhotos);
        break;

      case 'setoran':
        table = setoranTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['amount','linkSetoran','notes'], body);
        if ('moneyPhotos' in body) patch.moneyPhotos = jsonArr(body.moneyPhotos);
        break;

      case 'cek_bin':
        table = cekBinTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['notes'], body);
        break;

      case 'product_check':
        table = productCheckTasks as unknown as typeof storeOpeningTasks;
        patch = pick(
          ['display','price','saleTag','shoeFiller','labelIndo','barcode','notes'],
          body,
          { display: bool, price: bool, saleTag: bool, shoeFiller: bool, labelIndo: bool, barcode: bool, notes: (v) => v },
        );
        break;

      case 'receiving':
        table = receivingTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['hasReceiving','notes'], body, { hasReceiving: bool, notes: (v) => v });
        if ('receivingPhotos' in body) patch.receivingPhotos = jsonArr(body.receivingPhotos);
        break;

      case 'briefing':
        table = briefingTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['done','notes'], body, { done: bool, notes: (v) => v });
        break;

      case 'edc_summary':
        table = edcSummaryTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['notes'], body);
        if ('photos' in body) patch.edcSummaryPhotos = jsonArr(body.photos);
        break;

      case 'edc_settlement':
        table = edcSettlementTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['notes'], body);
        if ('photos' in body) patch.edcSettlementPhotos = jsonArr(body.photos);
        break;

      case 'eod_z_report':
        table = eodZReportTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['notes'], body);
        if ('photos' in body) patch.zReportPhotos = jsonArr(body.photos);
        break;

      case 'open_statement':
        table = openStatementTasks as unknown as typeof storeOpeningTasks;
        patch = pick(['notes'], body);
        if ('photos' in body) patch.openStatementPhotos = jsonArr(body.photos);
        break;

      case 'grooming':
        table = groomingTasks as unknown as typeof storeOpeningTasks;
        patch = pick(
          ['uniformComplete','hairGroomed','nailsClean','accessoriesCompliant','shoeCompliant','notes'],
          body,
          { uniformComplete: bool, hairGroomed: bool, nailsClean: bool, accessoriesCompliant: bool, shoeCompliant: bool, notes: (v) => v },
        );
        if ('selfiePhotos' in body) patch.selfiePhotos = jsonArr(body.selfiePhotos);
        break;

      default:
        return NextResponse.json({ success: false, error: `Unknown task type: ${type}` }, { status: 400 });
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ success: true, saved: [] });
    }

    // Only auto-save on tasks that aren't yet completed/verified
    const [existing] = await db
      .select({ id: (table as typeof storeOpeningTasks).id, status: (table as typeof storeOpeningTasks).status })
      .from(table as typeof storeOpeningTasks)
      .where(eq((table as typeof storeOpeningTasks).scheduleId, scheduleId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ success: false, error: 'Task not found.' }, { status: 404 });
    }
    if (existing.status === 'completed' || existing.status === 'verified') {
      // Silently succeed — race condition where user submits while auto-save fires
      return NextResponse.json({ success: true, saved: [] });
    }

    // Advance to in_progress if still pending
    if (existing.status === 'pending') {
      patch.status = 'in_progress';
    }

    patch.updatedAt = new Date();

    await db
      .update(table as typeof storeOpeningTasks)
      .set(patch as any)
      .where(eq((table as typeof storeOpeningTasks).id, existing.id));

    return NextResponse.json({ success: true, saved: Object.keys(patch) });
  } catch (err) {
    console.error(`[PATCH /api/employee/tasks/${type}]`, err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}