// lib/db/utils/tasks.ts
import { db }                               from '@/lib/db';
import { eq, and, gte, lte, inArray, sql }  from 'drizzle-orm';
import {
  schedules,
  stores,
  monthlySchedules,
  monthlyScheduleEntries,
  storeOpeningTasks,
  setoranTasks,
  cekBinTasks,
  productCheckTasks,
  receivingTasks,
  briefingTasks,
  edcSummaryTasks,
  edcSettlementTasks,
  eodZReportTasks,
  openStatementTasks,
  groomingTasks,
  type StoreOpeningTask,
  type SetoranTask,
  type ProductCheckTask,
  type ReceivingTask,
  type BriefingTask,
  type EdcSummaryTask,
  type EdcSettlementTask,
  type EodZReportTask,
  type OpenStatementTask,
  type GroomingTask,
} from '@/lib/db/schema';
import { canManageSchedule } from './schedule';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

const PENDING_STATUSES = ['pending', 'in_progress'] as const;

// ─── Public types ─────────────────────────────────────────────────────────────

export type TaskResult<T = void> =
  | { success: true;  data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface SubmitStoreOpeningInput {
  scheduleId:        number;
  userId:            string;
  storeId:           number;
  geo:               GeoPoint;
  loginPos:          boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales:     boolean;
  fiveR:             boolean;
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  storeFrontPhotos?: string[];
  cashDrawerPhotos?: string[];
  notes?:            string;
  skipGeo?:          boolean;
}

export interface SubmitSetoranInput {
  scheduleId:  number;
  userId:      string;
  storeId:     number;
  geo:         GeoPoint;
  amount:      string;
  linkSetoran: string;
  moneyPhotos: string[];
  notes?:      string;
  skipGeo?:    boolean;
}

export interface SubmitProductCheckInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  display:    boolean;
  price:      boolean;
  saleTag:    boolean;
  shoeFiller: boolean;
  labelIndo:  boolean;
  barcode:    boolean;
  notes?:     string;
  skipGeo?:   boolean;
}

export interface SubmitReceivingInput {
  scheduleId:       number;
  userId:           string;
  storeId:          number;
  geo:              GeoPoint;
  hasReceiving:     boolean;
  receivingPhotos?: string[];
  notes?:           string;
  skipGeo?:         boolean;
}

export interface SubmitBriefingInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  done:       boolean;
  notes?:     string;
  skipGeo?:   boolean;
}

/** Used by: EDC Summary, EDC Settlement, EOD Z-Report, Open Statement */
export interface SubmitPhotoTaskInput {
  scheduleId: number;
  userId:     string;
  storeId:    number;
  geo:        GeoPoint;
  photos:     string[];
  notes?:     string;
  skipGeo?:   boolean;
}

export interface SubmitGroomingInput {
  scheduleId:            number;
  userId:                string;
  storeId:               number;
  geo:                   GeoPoint;
  uniformComplete?:      boolean;
  hairGroomed?:          boolean;
  nailsClean?:           boolean;
  accessoriesCompliant?: boolean;
  shoeCompliant?:        boolean;
  selfiePhotos:          string[];
  notes?:                string;
  skipGeo?:              boolean;
}

export interface VerifyTaskInput {
  taskId:  number;
  actorId: string;
  storeId: number;
  approve: boolean;
  notes?:  string;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function assertInGeofence(
  storeId: number,
  geo:     GeoPoint,
): Promise<string | null> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store)                   return 'Store not found.';
  if (!store.lat || !store.lng) return null; // coordinates not configured — skip

  const dist   = haversineMetres(geo, { lat: parseFloat(store.lat), lng: parseFloat(store.lng) });
  const radius = store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `You are ${Math.round(dist)}m from the store (limit: ${radius}m). Please move closer and try again.`
    : null;
}

function jsonPhotos(paths: string[] | undefined): string | undefined {
  return paths && paths.length > 0 ? JSON.stringify(paths) : undefined;
}

/**
 * Shared verify logic expressed as callbacks so no table reference is passed
 * through a generic/union type parameter.
 *
 * Each `verify*` export supplies its own `fetchRow` and `updateRow` closures
 * that directly reference their table — keeping types fully concrete.
 */
type VerifyPatch = {
  status:     'verified' | 'rejected';
  verifiedBy: string;
  verifiedAt: Date;
  notes:      string | undefined;
  updatedAt:  Date;
};

async function runVerify(
  input:     VerifyTaskInput,
  fetchRow:  (taskId: number) => Promise<{ id: number; status: string | null } | undefined>,
  updateRow: (taskId: number, patch: VerifyPatch) => Promise<void>,
): Promise<TaskResult<void>> {
  try {
    const auth = await canManageSchedule(input.actorId, input.storeId);
    if (!auth.allowed) return { success: false, error: auth.reason! };

    const row = await fetchRow(input.taskId);
    if (!row)                       return { success: false, error: 'Task not found.' };
    if (row.status !== 'completed') return { success: false, error: `Cannot verify a task with status "${row.status}".` };

    await updateRow(input.taskId, {
      status:     input.approve ? 'verified' : 'rejected',
      verifiedBy: input.actorId,
      verifiedAt: new Date(),
      notes:      input.notes,
      updatedAt:  new Date(),
    });

    return { success: true, data: undefined };
  } catch (err) {
    return { success: false, error: `verifyTask: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATERIALISE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create all pending task rows for a newly materialised schedule row.
 * Safe to call multiple times — existence-checks skip rows that already exist.
 */
export async function materialiseTasksForSchedule(
  scheduleId: number,
): Promise<{ created: string[]; skipped: string[]; errors: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  const errors:  string[] = [];

  const [sched] = await db
    .select()
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);

  if (!sched) {
    errors.push(`Schedule ${scheduleId} not found.`);
    return { created, skipped, errors };
  }

  const typedShift = sched.shift as 'morning' | 'evening';
  const dayStart   = startOfDay(sched.date);
  const base       = {
    scheduleId,
    userId:  sched.userId,
    storeId: sched.storeId,
    shift:   typedShift,
    date:    dayStart,
    status:  'pending' as const,
  };

  /** Insert a shared task (one per store per day). */
  async function insertShared(
    name:     string,
    check:    () => Promise<{ id: number } | undefined>,
    insert:   () => Promise<unknown>,
  ) {
    try {
      if (await check()) { skipped.push(name); return; }
      await insert();
      created.push(name);
    } catch (err) {
      errors.push(`${name}: ${err}`);
    }
  }

  /** Insert a personal task (one per employee per schedule). */
  async function insertPersonal(
    name:   string,
    check:  () => Promise<{ id: number } | undefined>,
    insert: () => Promise<unknown>,
  ) {
    try {
      if (await check()) { skipped.push(name); return; }
      await insert();
      created.push(name);
    } catch (err) {
      errors.push(`${name}: ${err}`);
    }
  }

  const byStore = (col: { storeId: number; date: Date }) =>
    and(eq(storeOpeningTasks.storeId, sched.storeId), eq(storeOpeningTasks.date, dayStart));
  // (col parameter unused — each call references its own table directly)

  // ── Morning tasks ─────────────────────────────────────────────────────────
  if (typedShift === 'morning') {
    await insertShared(
      'storeOpening',
      () => db.select({ id: storeOpeningTasks.id }).from(storeOpeningTasks)
              .where(and(eq(storeOpeningTasks.storeId, sched.storeId), eq(storeOpeningTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(storeOpeningTasks).values(base),
    );
    await insertShared(
      'setoran',
      () => db.select({ id: setoranTasks.id }).from(setoranTasks)
              .where(and(eq(setoranTasks.storeId, sched.storeId), eq(setoranTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(setoranTasks).values(base),
    );
    await insertShared(
      'cekBin',
      () => db.select({ id: cekBinTasks.id }).from(cekBinTasks)
              .where(and(eq(cekBinTasks.storeId, sched.storeId), eq(cekBinTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(cekBinTasks).values(base),
    );
    await insertShared(
      'productCheck',
      () => db.select({ id: productCheckTasks.id }).from(productCheckTasks)
              .where(and(eq(productCheckTasks.storeId, sched.storeId), eq(productCheckTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(productCheckTasks).values(base),
    );
    await insertShared(
      'receiving',
      () => db.select({ id: receivingTasks.id }).from(receivingTasks)
              .where(and(eq(receivingTasks.storeId, sched.storeId), eq(receivingTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(receivingTasks).values(base),
    );
  }

  // ── Evening tasks ─────────────────────────────────────────────────────────
  if (typedShift === 'evening') {
    await insertShared(
      'briefing',
      () => db.select({ id: briefingTasks.id }).from(briefingTasks)
              .where(and(eq(briefingTasks.storeId, sched.storeId), eq(briefingTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(briefingTasks).values(base),
    );
    await insertShared(
      'edcSummary',
      () => db.select({ id: edcSummaryTasks.id }).from(edcSummaryTasks)
              .where(and(eq(edcSummaryTasks.storeId, sched.storeId), eq(edcSummaryTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(edcSummaryTasks).values(base),
    );
    await insertShared(
      'edcSettlement',
      () => db.select({ id: edcSettlementTasks.id }).from(edcSettlementTasks)
              .where(and(eq(edcSettlementTasks.storeId, sched.storeId), eq(edcSettlementTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(edcSettlementTasks).values(base),
    );
    await insertShared(
      'eodZReport',
      () => db.select({ id: eodZReportTasks.id }).from(eodZReportTasks)
              .where(and(eq(eodZReportTasks.storeId, sched.storeId), eq(eodZReportTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(eodZReportTasks).values(base),
    );
    await insertShared(
      'openStatement',
      () => db.select({ id: openStatementTasks.id }).from(openStatementTasks)
              .where(and(eq(openStatementTasks.storeId, sched.storeId), eq(openStatementTasks.date, dayStart)))
              .limit(1).then(r => r[0]),
      () => db.insert(openStatementTasks).values(base),
    );
  }

  // ── Personal task: grooming (both shifts) ─────────────────────────────────
  await insertPersonal(
    'grooming',
    () => db.select({ id: groomingTasks.id }).from(groomingTasks)
            .where(eq(groomingTasks.scheduleId, scheduleId))
            .limit(1).then(r => r[0]),
    () => db.insert(groomingTasks).values(base),
  );

  return { created, skipped, errors };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function materialiseTasksForMonth(
  storeId:   number,
  yearMonth: string,
): Promise<{ total: number; errors: string[] }> {
  const [ms] = await db
    .select({ id: monthlySchedules.id })
    .from(monthlySchedules)
    .where(and(eq(monthlySchedules.storeId, storeId), eq(monthlySchedules.yearMonth, yearMonth)))
    .limit(1);

  if (!ms) return { total: 0, errors: ['Monthly schedule not found.'] };

  const entries = await db
    .select({ scheduleId: schedules.id })
    .from(schedules)
    .innerJoin(monthlyScheduleEntries, eq(schedules.monthlyScheduleEntryId, monthlyScheduleEntries.id))
    .where(eq(monthlyScheduleEntries.monthlyScheduleId, ms.id));

  let total = 0;
  const errors: string[] = [];

  for (const { scheduleId } of entries) {
    const r = await materialiseTasksForSchedule(scheduleId);
    total += r.created.length;
    errors.push(...r.errors);
  }

  return { total, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE pending tasks when a schedule is removed / replaced
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteTasksForSchedule(scheduleId: number): Promise<void> {
  await Promise.all([
    db.delete(storeOpeningTasks) .where(and(eq(storeOpeningTasks.scheduleId,  scheduleId), inArray(storeOpeningTasks.status,  PENDING_STATUSES))),
    db.delete(setoranTasks)      .where(and(eq(setoranTasks.scheduleId,       scheduleId), inArray(setoranTasks.status,       PENDING_STATUSES))),
    db.delete(cekBinTasks)       .where(and(eq(cekBinTasks.scheduleId,        scheduleId), inArray(cekBinTasks.status,        PENDING_STATUSES))),
    db.delete(productCheckTasks) .where(and(eq(productCheckTasks.scheduleId,  scheduleId), inArray(productCheckTasks.status,  PENDING_STATUSES))),
    db.delete(receivingTasks)    .where(and(eq(receivingTasks.scheduleId,     scheduleId), inArray(receivingTasks.status,     PENDING_STATUSES))),
    db.delete(briefingTasks)     .where(and(eq(briefingTasks.scheduleId,      scheduleId), inArray(briefingTasks.status,      PENDING_STATUSES))),
    db.delete(edcSummaryTasks)   .where(and(eq(edcSummaryTasks.scheduleId,    scheduleId), inArray(edcSummaryTasks.status,    PENDING_STATUSES))),
    db.delete(edcSettlementTasks).where(and(eq(edcSettlementTasks.scheduleId, scheduleId), inArray(edcSettlementTasks.status, PENDING_STATUSES))),
    db.delete(eodZReportTasks)   .where(and(eq(eodZReportTasks.scheduleId,    scheduleId), inArray(eodZReportTasks.status,    PENDING_STATUSES))),
    db.delete(openStatementTasks).where(and(eq(openStatementTasks.scheduleId, scheduleId), inArray(openStatementTasks.status, PENDING_STATUSES))),
    db.delete(groomingTasks)     .where(and(eq(groomingTasks.scheduleId,      scheduleId), inArray(groomingTasks.status,      PENDING_STATUSES))),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBMIT
// ─────────────────────────────────────────────────────────────────────────────

export async function submitStoreOpening(
  input: SubmitStoreOpeningInput,
): Promise<TaskResult<StoreOpeningTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }

    const [existing] = await db
      .select()
      .from(storeOpeningTasks)
      .where(eq(storeOpeningTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'completed' || existing?.status === 'verified')
      return { success: false, error: 'Store opening task already submitted.' };

    const now    = new Date();
    const values = {
      scheduleId:        input.scheduleId,
      userId:            input.userId,
      storeId:           input.storeId,
      shift:             'morning' as const,
      date:              startOfDay(now),
      loginPos:          input.loginPos,
      checkAbsenSunfish: input.checkAbsenSunfish,
      tarikSohSales:     input.tarikSohSales,
      fiveR:             input.fiveR,
      cekLamp:           input.cekLamp,
      cekSoundSystem:    input.cekSoundSystem,
      storeFrontPhotos:  jsonPhotos(input.storeFrontPhotos),
      cashDrawerPhotos:  jsonPhotos(input.cashDrawerPhotos),
      submittedLat:      String(input.geo.lat),
      submittedLng:      String(input.geo.lng),
      notes:             input.notes,
      status:            'completed' as const,
      completedAt:       now,
      updatedAt:         now,
    };

    const row = existing
      ? (await db.update(storeOpeningTasks).set(values).where(eq(storeOpeningTasks.id, existing.id)).returning())[0]
      : (await db.insert(storeOpeningTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreOpening: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitSetoran(
  input: SubmitSetoranInput,
): Promise<TaskResult<SetoranTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }
    if (!input.moneyPhotos?.length)
      return { success: false, error: 'At least one photo of the money is required.' };
    if (!input.linkSetoran)
      return { success: false, error: 'Link setoran is required.' };

    const [existing] = await db
      .select()
      .from(setoranTasks)
      .where(eq(setoranTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Setoran already verified.' };

    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shift:        'morning' as const,
      date:         startOfDay(now),
      amount:       input.amount,
      linkSetoran:  input.linkSetoran,
      moneyPhotos:  jsonPhotos(input.moneyPhotos),
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(setoranTasks).set(values).where(eq(setoranTasks.id, existing.id)).returning())[0]
      : (await db.insert(setoranTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitSetoran: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitProductCheck(
  input: SubmitProductCheckInput,
): Promise<TaskResult<ProductCheckTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }

    const [existing] = await db
      .select()
      .from(productCheckTasks)
      .where(eq(productCheckTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Product check already verified.' };

    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shift:        'morning' as const,
      date:         startOfDay(now),
      display:      input.display,
      price:        input.price,
      saleTag:      input.saleTag,
      shoeFiller:   input.shoeFiller,
      labelIndo:    input.labelIndo,
      barcode:      input.barcode,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(productCheckTasks).set(values).where(eq(productCheckTasks.id, existing.id)).returning())[0]
      : (await db.insert(productCheckTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitProductCheck: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitReceiving(
  input: SubmitReceivingInput,
): Promise<TaskResult<ReceivingTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }
    if (input.hasReceiving && !input.receivingPhotos?.length)
      return { success: false, error: 'Photos are required when receiving is marked as yes.' };

    const [existing] = await db
      .select()
      .from(receivingTasks)
      .where(eq(receivingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Receiving already verified.' };

    const now    = new Date();
    const values = {
      scheduleId:      input.scheduleId,
      userId:          input.userId,
      storeId:         input.storeId,
      shift:           'morning' as const,
      date:            startOfDay(now),
      hasReceiving:    input.hasReceiving,
      receivingPhotos: jsonPhotos(input.receivingPhotos),
      submittedLat:    String(input.geo.lat),
      submittedLng:    String(input.geo.lng),
      notes:           input.notes,
      status:          'completed' as const,
      completedAt:     now,
      updatedAt:       now,
    };

    const row = existing
      ? (await db.update(receivingTasks).set(values).where(eq(receivingTasks.id, existing.id)).returning())[0]
      : (await db.insert(receivingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitReceiving: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitBriefing(
  input: SubmitBriefingInput,
): Promise<TaskResult<BriefingTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }

    const [existing] = await db
      .select()
      .from(briefingTasks)
      .where(eq(briefingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Briefing already verified.' };

    const now    = new Date();
    const values = {
      scheduleId:   input.scheduleId,
      userId:       input.userId,
      storeId:      input.storeId,
      shift:        'evening' as const,
      date:         startOfDay(now),
      done:         input.done,
      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes:        input.notes,
      status:       'completed' as const,
      completedAt:  now,
      updatedAt:    now,
    };

    const row = existing
      ? (await db.update(briefingTasks).set(values).where(eq(briefingTasks.id, existing.id)).returning())[0]
      : (await db.insert(briefingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitBriefing: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo-only evening tasks — each written out explicitly.
// No shared generic: Drizzle tables are nominally typed and cannot be
// passed through a single typed parameter without `as unknown as` hacks.
// ─────────────────────────────────────────────────────────────────────────────

export async function submitEdcSummary(input: SubmitPhotoTaskInput): Promise<TaskResult<EdcSummaryTask>> {
  try {
    if (!input.skipGeo) { const e = await assertInGeofence(input.storeId, input.geo); if (e) return { success: false, error: e }; }
    if (!input.photos?.length) return { success: false, error: 'At least one photo is required.' };

    const [existing] = await db.select().from(edcSummaryTasks).where(eq(edcSummaryTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task already verified.' };

    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shift: 'evening' as const, date: startOfDay(now), edcSummaryPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(edcSummaryTasks).set(v).where(eq(edcSummaryTasks.id, existing.id)).returning())[0] : (await db.insert(edcSummaryTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEdcSummary: ${err}` }; }
}

export async function submitEdcSettlement(input: SubmitPhotoTaskInput): Promise<TaskResult<EdcSettlementTask>> {
  try {
    if (!input.skipGeo) { const e = await assertInGeofence(input.storeId, input.geo); if (e) return { success: false, error: e }; }
    if (!input.photos?.length) return { success: false, error: 'At least one photo is required.' };

    const [existing] = await db.select().from(edcSettlementTasks).where(eq(edcSettlementTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task already verified.' };

    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shift: 'evening' as const, date: startOfDay(now), edcSettlementPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(edcSettlementTasks).set(v).where(eq(edcSettlementTasks.id, existing.id)).returning())[0] : (await db.insert(edcSettlementTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEdcSettlement: ${err}` }; }
}

export async function submitEodZReport(input: SubmitPhotoTaskInput): Promise<TaskResult<EodZReportTask>> {
  try {
    if (!input.skipGeo) { const e = await assertInGeofence(input.storeId, input.geo); if (e) return { success: false, error: e }; }
    if (!input.photos?.length) return { success: false, error: 'At least one photo is required.' };

    const [existing] = await db.select().from(eodZReportTasks).where(eq(eodZReportTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task already verified.' };

    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shift: 'evening' as const, date: startOfDay(now), zReportPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(eodZReportTasks).set(v).where(eq(eodZReportTasks.id, existing.id)).returning())[0] : (await db.insert(eodZReportTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitEodZReport: ${err}` }; }
}

export async function submitOpenStatement(input: SubmitPhotoTaskInput): Promise<TaskResult<OpenStatementTask>> {
  try {
    if (!input.skipGeo) { const e = await assertInGeofence(input.storeId, input.geo); if (e) return { success: false, error: e }; }
    if (!input.photos?.length) return { success: false, error: 'At least one photo is required.' };

    const [existing] = await db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, input.scheduleId)).limit(1);
    if (existing?.status === 'verified') return { success: false, error: 'Task already verified.' };

    const now = new Date();
    const v = { scheduleId: input.scheduleId, userId: input.userId, storeId: input.storeId, shift: 'evening' as const, date: startOfDay(now), openStatementPhotos: jsonPhotos(input.photos), submittedLat: String(input.geo.lat), submittedLng: String(input.geo.lng), notes: input.notes, status: 'completed' as const, completedAt: now, updatedAt: now };
    const row = existing ? (await db.update(openStatementTasks).set(v).where(eq(openStatementTasks.id, existing.id)).returning())[0] : (await db.insert(openStatementTasks).values(v).returning())[0];
    return { success: true, data: row };
  } catch (err) { return { success: false, error: `submitOpenStatement: ${err}` }; }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function submitGrooming(
  input: SubmitGroomingInput,
): Promise<TaskResult<GroomingTask>> {
  try {
    if (!input.skipGeo) {
      const geoErr = await assertInGeofence(input.storeId, input.geo);
      if (geoErr) return { success: false, error: geoErr };
    }
    if (!input.selfiePhotos?.length)
      return { success: false, error: 'A full-body selfie photo is required.' };

    const [existing] = await db
      .select()
      .from(groomingTasks)
      .where(eq(groomingTasks.scheduleId, input.scheduleId))
      .limit(1);

    if (existing?.status === 'verified')
      return { success: false, error: 'Grooming task already verified.' };

    const [sched] = await db
      .select({ shift: schedules.shift })
      .from(schedules)
      .where(eq(schedules.id, input.scheduleId))
      .limit(1);

    const now    = new Date();
    const values = {
      scheduleId:           input.scheduleId,
      userId:               input.userId,
      storeId:              input.storeId,
      shift:                (sched?.shift ?? 'morning') as 'morning' | 'evening',
      date:                 startOfDay(now),
      uniformComplete:      input.uniformComplete,
      hairGroomed:          input.hairGroomed,
      nailsClean:           input.nailsClean,
      accessoriesCompliant: input.accessoriesCompliant,
      shoeCompliant:        input.shoeCompliant,
      selfiePhotos:         jsonPhotos(input.selfiePhotos),
      submittedLat:         String(input.geo.lat),
      submittedLng:         String(input.geo.lng),
      notes:                input.notes,
      status:               'completed' as const,
      completedAt:          now,
      updatedAt:            now,
    };

    const row = existing
      ? (await db.update(groomingTasks).set(values).where(eq(groomingTasks.id, existing.id)).returning())[0]
      : (await db.insert(groomingTasks).values(values).returning())[0];

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitGrooming: ${err}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY — callbacks only, no table passed as parameter
// ─────────────────────────────────────────────────────────────────────────────

export const verifyStoreOpening = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: storeOpeningTasks.id, status: storeOpeningTasks.status }).from(storeOpeningTasks).where(eq(storeOpeningTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(storeOpeningTasks).set(p).where(eq(storeOpeningTasks.id, id)).then(() => {}),
);

export const verifySetoran = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: setoranTasks.id, status: setoranTasks.status }).from(setoranTasks).where(eq(setoranTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(setoranTasks).set(p).where(eq(setoranTasks.id, id)).then(() => {}),
);

export const verifyCekBin = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: cekBinTasks.id, status: cekBinTasks.status }).from(cekBinTasks).where(eq(cekBinTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(cekBinTasks).set(p).where(eq(cekBinTasks.id, id)).then(() => {}),
);

export const verifyProductCheck = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: productCheckTasks.id, status: productCheckTasks.status }).from(productCheckTasks).where(eq(productCheckTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(productCheckTasks).set(p).where(eq(productCheckTasks.id, id)).then(() => {}),
);

export const verifyReceiving = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: receivingTasks.id, status: receivingTasks.status }).from(receivingTasks).where(eq(receivingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(receivingTasks).set(p).where(eq(receivingTasks.id, id)).then(() => {}),
);

export const verifyBriefing = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: briefingTasks.id, status: briefingTasks.status }).from(briefingTasks).where(eq(briefingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(briefingTasks).set(p).where(eq(briefingTasks.id, id)).then(() => {}),
);

export const verifyEdcSummary = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: edcSummaryTasks.id, status: edcSummaryTasks.status }).from(edcSummaryTasks).where(eq(edcSummaryTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(edcSummaryTasks).set(p).where(eq(edcSummaryTasks.id, id)).then(() => {}),
);

export const verifyEdcSettlement = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: edcSettlementTasks.id, status: edcSettlementTasks.status }).from(edcSettlementTasks).where(eq(edcSettlementTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(edcSettlementTasks).set(p).where(eq(edcSettlementTasks.id, id)).then(() => {}),
);

export const verifyEodZReport = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: eodZReportTasks.id, status: eodZReportTasks.status }).from(eodZReportTasks).where(eq(eodZReportTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(eodZReportTasks).set(p).where(eq(eodZReportTasks.id, id)).then(() => {}),
);

export const verifyOpenStatement = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: openStatementTasks.id, status: openStatementTasks.status }).from(openStatementTasks).where(eq(openStatementTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(openStatementTasks).set(p).where(eq(openStatementTasks.id, id)).then(() => {}),
);

export const verifyGrooming = (i: VerifyTaskInput) => runVerify(i,
  id => db.select({ id: groomingTasks.id, status: groomingTasks.status }).from(groomingTasks).where(eq(groomingTasks.id, id)).limit(1).then(r => r[0]),
  (id, p) => db.update(groomingTasks).set(p).where(eq(groomingTasks.id, id)).then(() => {}),
);

// ─────────────────────────────────────────────────────────────────────────────
// READ helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function getTasksForSchedule(scheduleId: number) {
  const [
    opening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  ] = await Promise.all([
    db.select().from(storeOpeningTasks) .where(eq(storeOpeningTasks.scheduleId,  scheduleId)).limit(1),
    db.select().from(setoranTasks)      .where(eq(setoranTasks.scheduleId,       scheduleId)).limit(1),
    db.select().from(cekBinTasks)       .where(eq(cekBinTasks.scheduleId,        scheduleId)).limit(1),
    db.select().from(productCheckTasks) .where(eq(productCheckTasks.scheduleId,  scheduleId)).limit(1),
    db.select().from(receivingTasks)    .where(eq(receivingTasks.scheduleId,     scheduleId)).limit(1),
    db.select().from(briefingTasks)     .where(eq(briefingTasks.scheduleId,      scheduleId)).limit(1),
    db.select().from(edcSummaryTasks)   .where(eq(edcSummaryTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(edcSettlementTasks).where(eq(edcSettlementTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(eodZReportTasks)   .where(eq(eodZReportTasks.scheduleId,    scheduleId)).limit(1),
    db.select().from(openStatementTasks).where(eq(openStatementTasks.scheduleId, scheduleId)).limit(1),
    db.select().from(groomingTasks)     .where(eq(groomingTasks.scheduleId,      scheduleId)).limit(1),
  ]);

  return {
    storeOpening:  opening[0]       ?? null,
    setoran:       setoran[0]       ?? null,
    cekBin:        cekBin[0]        ?? null,
    productCheck:  productCheck[0]  ?? null,
    receiving:     receiving[0]     ?? null,
    briefing:      briefing[0]      ?? null,
    edcSummary:    edcSummary[0]    ?? null,
    edcSettlement: edcSettlement[0] ?? null,
    eodZReport:    eodZReport[0]    ?? null,
    openStatement: openStatement[0] ?? null,
    grooming:      grooming[0]      ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Count task rows by status for a store on a given date. Used by OPS dashboard. */
export async function getDailyTaskSummary(storeId: number, date: Date) {
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  // Each table queried with its own fully-typed columns — no shared table ref.
  function summarise(rows: { status: string | null; count: number }[]) {
    return {
      pending:    rows.find(r => r.status === 'pending')?.count     ?? 0,
      inProgress: rows.find(r => r.status === 'in_progress')?.count ?? 0,
      completed:  rows.find(r => r.status === 'completed')?.count   ?? 0,
      verified:   rows.find(r => r.status === 'verified')?.count    ?? 0,
      rejected:   rows.find(r => r.status === 'rejected')?.count    ?? 0,
    };
  }

  const [
    storeOpening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  ] = await Promise.all([
    db.select({ status: storeOpeningTasks.status,  count: sql<number>`count(*)::int` }).from(storeOpeningTasks) .where(and(eq(storeOpeningTasks.storeId,  storeId), gte(storeOpeningTasks.date,  dayStart), lte(storeOpeningTasks.date,  dayEnd))).groupBy(storeOpeningTasks.status) .then(summarise),
    db.select({ status: setoranTasks.status,       count: sql<number>`count(*)::int` }).from(setoranTasks)      .where(and(eq(setoranTasks.storeId,       storeId), gte(setoranTasks.date,       dayStart), lte(setoranTasks.date,       dayEnd))).groupBy(setoranTasks.status)      .then(summarise),
    db.select({ status: cekBinTasks.status,        count: sql<number>`count(*)::int` }).from(cekBinTasks)       .where(and(eq(cekBinTasks.storeId,        storeId), gte(cekBinTasks.date,        dayStart), lte(cekBinTasks.date,        dayEnd))).groupBy(cekBinTasks.status)       .then(summarise),
    db.select({ status: productCheckTasks.status,  count: sql<number>`count(*)::int` }).from(productCheckTasks) .where(and(eq(productCheckTasks.storeId,  storeId), gte(productCheckTasks.date,  dayStart), lte(productCheckTasks.date,  dayEnd))).groupBy(productCheckTasks.status) .then(summarise),
    db.select({ status: receivingTasks.status,     count: sql<number>`count(*)::int` }).from(receivingTasks)    .where(and(eq(receivingTasks.storeId,     storeId), gte(receivingTasks.date,     dayStart), lte(receivingTasks.date,     dayEnd))).groupBy(receivingTasks.status)    .then(summarise),
    db.select({ status: briefingTasks.status,      count: sql<number>`count(*)::int` }).from(briefingTasks)     .where(and(eq(briefingTasks.storeId,      storeId), gte(briefingTasks.date,      dayStart), lte(briefingTasks.date,      dayEnd))).groupBy(briefingTasks.status)     .then(summarise),
    db.select({ status: edcSummaryTasks.status,    count: sql<number>`count(*)::int` }).from(edcSummaryTasks)   .where(and(eq(edcSummaryTasks.storeId,    storeId), gte(edcSummaryTasks.date,    dayStart), lte(edcSummaryTasks.date,    dayEnd))).groupBy(edcSummaryTasks.status)   .then(summarise),
    db.select({ status: edcSettlementTasks.status, count: sql<number>`count(*)::int` }).from(edcSettlementTasks).where(and(eq(edcSettlementTasks.storeId, storeId), gte(edcSettlementTasks.date, dayStart), lte(edcSettlementTasks.date, dayEnd))).groupBy(edcSettlementTasks.status).then(summarise),
    db.select({ status: eodZReportTasks.status,    count: sql<number>`count(*)::int` }).from(eodZReportTasks)   .where(and(eq(eodZReportTasks.storeId,    storeId), gte(eodZReportTasks.date,    dayStart), lte(eodZReportTasks.date,    dayEnd))).groupBy(eodZReportTasks.status)   .then(summarise),
    db.select({ status: openStatementTasks.status, count: sql<number>`count(*)::int` }).from(openStatementTasks).where(and(eq(openStatementTasks.storeId, storeId), gte(openStatementTasks.date, dayStart), lte(openStatementTasks.date, dayEnd))).groupBy(openStatementTasks.status).then(summarise),
    db.select({ status: groomingTasks.status,      count: sql<number>`count(*)::int` }).from(groomingTasks)     .where(and(eq(groomingTasks.storeId,      storeId), gte(groomingTasks.date,      dayStart), lte(groomingTasks.date,      dayEnd))).groupBy(groomingTasks.status)     .then(summarise),
  ]);

  return {
    storeOpening, setoran, cekBin, productCheck, receiving,
    briefing, edcSummary, edcSettlement, eodZReport, openStatement,
    grooming,
  };
}