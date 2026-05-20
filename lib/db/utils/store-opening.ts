// lib/db/utils/store-opening.ts
import { db } from "@/lib/db";
import { eq, and, gte, lte } from "drizzle-orm";
import {
  storeOpeningTasks,
  stores,
  shifts,
  attendance,
  type StoreOpeningTask,
} from "@/lib/db/schema";

export const DEFAULT_GEOFENCE_RADIUS_M = 100;

export type TaskResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const FIVE_R_AREAS = [
  { key: "kasir", label: "Area Kasir" },
  { key: "depan", label: "Depan Toko" },
  { key: "kanan", label: "Sisi Kanan" },
  { key: "kiri", label: "Sisi Kiri" },
  { key: "gudang", label: "Gudang" },
] as const;

export type FiveRAreaKey = (typeof FIVE_R_AREAS)[number]["key"];

export interface SubmitStoreOpeningInput {
  taskId?: number;
  scheduleId: number;
  userId: string;
  storeId: number;
  geo: GeoPoint;

  loginPos: boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales: boolean;
  fiveR: boolean;

  fiveRAreaKasirPhotos?: string[];
  fiveRAreaDepanPhotos?: string[];
  fiveRAreaKananPhotos?: string[];
  fiveRAreaKiriPhotos?: string[];
  fiveRAreaGudangPhotos?: string[];

  cekLamp: boolean;
  cekSoundSystem: boolean;
  cashierDeskPhotos?: string[];

  notes?: string;
  skipGeo?: boolean;
}

export interface StoreOpeningAutoSavePatch {
  loginPos?: boolean;
  checkAbsenSunfish?: boolean;
  tarikSohSales?: boolean;
  fiveR?: boolean;

  fiveRAreaKasirPhotos?: string[];
  fiveRAreaDepanPhotos?: string[];
  fiveRAreaKananPhotos?: string[];
  fiveRAreaKiriPhotos?: string[];
  fiveRAreaGudangPhotos?: string[];

  cekLamp?: boolean;
  cekSoundSystem?: boolean;
  cashierDeskPhotos?: string[];
  notes?: string;
}

export interface AutoSaveStoreOpeningInput extends StoreOpeningAutoSavePatch {}

export const STORE_OPENING_PHOTO_RULES = {
  cashierDesk: { min: 1, max: 2 },
  fiveRArea: { min: 1, max: 2 },
} as const;

type StoreOpeningInsert = typeof storeOpeningTasks.$inferInsert;
type StoreOpeningUpdate = Partial<StoreOpeningInsert>;

type PhotoActor = {
  url: string;
  by: string;
  at: string;
};

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
  const R = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function jsonPhotos(paths: string[] | undefined): string {
  return JSON.stringify(Array.isArray(paths) ? paths : []);
}

function parsePhotoActors(raw: string | null | undefined): PhotoActor[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is PhotoActor => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.url === "string" &&
        typeof record.by === "string" &&
        typeof record.at === "string"
      );
    });
  } catch {
    return [];
  }
}

function mergePhotoActors(
  existingRaw: string | null | undefined,
  nextPhotos: string[] | undefined,
  userId: string,
  now: Date,
): string {
  const existingByUrl = new Map(
    parsePhotoActors(existingRaw).map((actor) => [actor.url, actor]),
  );
  const nowIso = now.toISOString();

  const actors = (nextPhotos ?? []).map((url) => {
    const existing = existingByUrl.get(url);
    return existing ?? { url, by: userId, at: nowIso };
  });

  return JSON.stringify(actors);
}

let morningShiftIdCache: number | null = null;
async function getMorningShiftId(): Promise<number> {
  if (morningShiftIdCache != null) return morningShiftIdCache;

  const [row] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(eq(shifts.code, "morning"))
    .limit(1);

  if (!row) throw new Error("Morning shift not found in shifts table.");
  morningShiftIdCache = row.id;
  return row.id;
}

async function findTodayRow(
  storeId: number,
  date: Date,
): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(
      and(
        eq(storeOpeningTasks.storeId, storeId),
        gte(storeOpeningTasks.date, startOfDay(date)),
        lte(storeOpeningTasks.date, endOfDay(date)),
      ),
    )
    .limit(1);

  return row ?? null;
}

async function findRowByTaskId(
  taskId: number,
): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.id, taskId))
    .limit(1);

  return row ?? null;
}

async function findRow(
  taskId: number | undefined,
  storeId: number,
  date = new Date(),
): Promise<StoreOpeningTask | null> {
  if (taskId) return findRowByTaskId(taskId);
  return findTodayRow(storeId, date);
}

async function assertCheckedIn(scheduleId: number): Promise<string | null> {
  const [att] = await db
    .select({ checkInTime: attendance.checkInTime })
    .from(attendance)
    .where(eq(attendance.scheduleId, scheduleId))
    .limit(1);

  if (!att?.checkInTime) {
    return "Kamu belum absen masuk. Lakukan absensi masuk terlebih dahulu sebelum mengerjakan task.";
  }

  return null;
}

async function assertInGeofence(
  storeId: number,
  geo: GeoPoint,
): Promise<string | null> {
  const [store] = await db
    .select({
      lat: stores.latitude,
      lng: stores.longitude,
      radius: stores.geofenceRadiusM,
    })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return "Toko tidak ditemukan.";
  if (!store.lat || !store.lng) return null;

  const dist = haversineMetres(geo, {
    lat: parseFloat(store.lat),
    lng: parseFloat(store.lng),
  });
  const radius = store.radius
    ? parseFloat(store.radius)
    : DEFAULT_GEOFENCE_RADIUS_M;

  return dist > radius
    ? `Kamu berada ${Math.round(dist)}m dari toko (batas: ${radius}m). Pastikan kamu berada di dalam toko dan coba lagi.`
    : null;
}

async function assertCanProgressTask(
  scheduleId: number,
  storeId: number,
  geo: GeoPoint,
  skipGeo?: boolean,
): Promise<string | null> {
  const checkInErr = await assertCheckedIn(scheduleId);
  if (checkInErr) return checkInErr;

  if (!skipGeo) {
    const geoErr = await assertInGeofence(storeId, geo);
    if (geoErr) return geoErr;
  }

  return null;
}

function photoCount(paths?: string[]): number {
  return Array.isArray(paths) ? paths.length : 0;
}

function validateStoreOpeningPayload(
  input: SubmitStoreOpeningInput,
): string | null {
  if (!input.loginPos)
    return 'Checklist "Log-in POS / Buka komputer kasir" belum ditandai.';
  if (!input.checkAbsenSunfish)
    return 'Checklist "Tarik & cek absen Sunfish" belum ditandai.';
  if (!input.tarikSohSales)
    return 'Checklist "Tarik SOH & Sales" belum ditandai.';
  if (!input.fiveR) return 'Checklist "5R" belum ditandai.';
  if (!input.cekLamp) return 'Checklist "Cek Lampu" belum ditandai.';
  if (!input.cekSoundSystem)
    return 'Checklist "Cek Sound System" belum ditandai.';

  const cashierCount = photoCount(input.cashierDeskPhotos);
  if (cashierCount < STORE_OPENING_PHOTO_RULES.cashierDesk.min) {
    return `Foto meja kasir wajib minimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.min}.`;
  }
  if (cashierCount > STORE_OPENING_PHOTO_RULES.cashierDesk.max) {
    return `Foto meja kasir maksimal ${STORE_OPENING_PHOTO_RULES.cashierDesk.max}.`;
  }

  const areaPhotoMap: Record<FiveRAreaKey, string[] | undefined> = {
    kasir: input.fiveRAreaKasirPhotos,
    depan: input.fiveRAreaDepanPhotos,
    kanan: input.fiveRAreaKananPhotos,
    kiri: input.fiveRAreaKiriPhotos,
    gudang: input.fiveRAreaGudangPhotos,
  };

  for (const { key, label } of FIVE_R_AREAS) {
    const count = photoCount(areaPhotoMap[key]);
    if (count < STORE_OPENING_PHOTO_RULES.fiveRArea.min) {
      return `5R "${label}": wajib minimal ${STORE_OPENING_PHOTO_RULES.fiveRArea.min} foto.`;
    }
    if (count > STORE_OPENING_PHOTO_RULES.fiveRArea.max) {
      return `5R "${label}": maksimal ${STORE_OPENING_PHOTO_RULES.fiveRArea.max} foto.`;
    }
  }

  return null;
}

function setFieldActorIfMissing(
  update: StoreOpeningUpdate,
  existing: StoreOpeningTask | null,
  byKey: keyof StoreOpeningInsert,
  atKey: keyof StoreOpeningInsert,
  userId: string,
  now: Date,
): void {
  const currentBy = existing?.[byKey as keyof StoreOpeningTask];
  if (currentBy) return;

  (update as Record<string, unknown>)[byKey as string] = userId;
  (update as Record<string, unknown>)[atKey as string] = now;
}

function applyActorForPatch(
  update: StoreOpeningUpdate,
  patch: StoreOpeningAutoSavePatch,
  existing: StoreOpeningTask | null,
  userId: string,
  now: Date,
): void {
  if ("loginPos" in patch && patch.loginPos === true) {
    setFieldActorIfMissing(
      update,
      existing,
      "loginPosBy",
      "loginPosAt",
      userId,
      now,
    );
  }

  if ("checkAbsenSunfish" in patch && patch.checkAbsenSunfish === true) {
    setFieldActorIfMissing(
      update,
      existing,
      "checkAbsenSunfishBy",
      "checkAbsenSunfishAt",
      userId,
      now,
    );
  }

  if ("tarikSohSales" in patch && patch.tarikSohSales === true) {
    setFieldActorIfMissing(
      update,
      existing,
      "tarikSohSalesBy",
      "tarikSohSalesAt",
      userId,
      now,
    );
  }

  if ("fiveR" in patch && patch.fiveR === true) {
    setFieldActorIfMissing(update, existing, "fiveRBy", "fiveRAt", userId, now);
  }

  if ("fiveRAreaKasirPhotos" in patch) {
    if (photoCount(patch.fiveRAreaKasirPhotos) > 0) {
      setFieldActorIfMissing(
        update,
        existing,
        "fiveRAreaKasirBy",
        "fiveRAreaKasirAt",
        userId,
        now,
      );
    }
    update.fiveRAreaKasirPhotoActors = mergePhotoActors(
      existing?.fiveRAreaKasirPhotoActors,
      patch.fiveRAreaKasirPhotos,
      userId,
      now,
    );
  }

  if ("fiveRAreaDepanPhotos" in patch) {
    if (photoCount(patch.fiveRAreaDepanPhotos) > 0) {
      setFieldActorIfMissing(
        update,
        existing,
        "fiveRAreaDepanBy",
        "fiveRAreaDepanAt",
        userId,
        now,
      );
    }
    update.fiveRAreaDepanPhotoActors = mergePhotoActors(
      existing?.fiveRAreaDepanPhotoActors,
      patch.fiveRAreaDepanPhotos,
      userId,
      now,
    );
  }

  if ("fiveRAreaKananPhotos" in patch) {
    if (photoCount(patch.fiveRAreaKananPhotos) > 0) {
      setFieldActorIfMissing(
        update,
        existing,
        "fiveRAreaKananBy",
        "fiveRAreaKananAt",
        userId,
        now,
      );
    }
    update.fiveRAreaKananPhotoActors = mergePhotoActors(
      existing?.fiveRAreaKananPhotoActors,
      patch.fiveRAreaKananPhotos,
      userId,
      now,
    );
  }

  if ("fiveRAreaKiriPhotos" in patch) {
    if (photoCount(patch.fiveRAreaKiriPhotos) > 0) {
      setFieldActorIfMissing(
        update,
        existing,
        "fiveRAreaKiriBy",
        "fiveRAreaKiriAt",
        userId,
        now,
      );
    }
    update.fiveRAreaKiriPhotoActors = mergePhotoActors(
      existing?.fiveRAreaKiriPhotoActors,
      patch.fiveRAreaKiriPhotos,
      userId,
      now,
    );
  }

  if ("fiveRAreaGudangPhotos" in patch) {
    if (photoCount(patch.fiveRAreaGudangPhotos) > 0) {
      setFieldActorIfMissing(
        update,
        existing,
        "fiveRAreaGudangBy",
        "fiveRAreaGudangAt",
        userId,
        now,
      );
    }
    update.fiveRAreaGudangPhotoActors = mergePhotoActors(
      existing?.fiveRAreaGudangPhotoActors,
      patch.fiveRAreaGudangPhotos,
      userId,
      now,
    );
  }

  if ("cekLamp" in patch && patch.cekLamp === true) {
    setFieldActorIfMissing(
      update,
      existing,
      "cekLampBy",
      "cekLampAt",
      userId,
      now,
    );
  }

  if ("cekSoundSystem" in patch && patch.cekSoundSystem === true) {
    setFieldActorIfMissing(
      update,
      existing,
      "cekSoundSystemBy",
      "cekSoundSystemAt",
      userId,
      now,
    );
  }

  if ("cashierDeskPhotos" in patch && photoCount(patch.cashierDeskPhotos) > 0) {
    setFieldActorIfMissing(
      update,
      existing,
      "cashDrawerBy",
      "cashDrawerAt",
      userId,
      now,
    );
  }
}

function makeSubmitActorUpdate(
  input: SubmitStoreOpeningInput,
  existing: StoreOpeningTask | null,
  now: Date,
): StoreOpeningUpdate {
  const actor: StoreOpeningUpdate = {};

  const setIfMissing = (
    condition: boolean,
    byKey: keyof StoreOpeningInsert,
    atKey: keyof StoreOpeningInsert,
  ) => {
    const currentBy = existing?.[byKey as keyof StoreOpeningTask];
    if (!condition || currentBy) return;

    (actor as Record<string, unknown>)[byKey as string] = input.userId;
    (actor as Record<string, unknown>)[atKey as string] = now;
  };

  setIfMissing(input.loginPos, "loginPosBy", "loginPosAt");
  setIfMissing(
    input.checkAbsenSunfish,
    "checkAbsenSunfishBy",
    "checkAbsenSunfishAt",
  );
  setIfMissing(input.tarikSohSales, "tarikSohSalesBy", "tarikSohSalesAt");
  setIfMissing(input.fiveR, "fiveRBy", "fiveRAt");

  setIfMissing(
    photoCount(input.fiveRAreaKasirPhotos) > 0,
    "fiveRAreaKasirBy",
    "fiveRAreaKasirAt",
  );
  setIfMissing(
    photoCount(input.fiveRAreaDepanPhotos) > 0,
    "fiveRAreaDepanBy",
    "fiveRAreaDepanAt",
  );
  setIfMissing(
    photoCount(input.fiveRAreaKananPhotos) > 0,
    "fiveRAreaKananBy",
    "fiveRAreaKananAt",
  );
  setIfMissing(
    photoCount(input.fiveRAreaKiriPhotos) > 0,
    "fiveRAreaKiriBy",
    "fiveRAreaKiriAt",
  );
  setIfMissing(
    photoCount(input.fiveRAreaGudangPhotos) > 0,
    "fiveRAreaGudangBy",
    "fiveRAreaGudangAt",
  );

  actor.fiveRAreaKasirPhotoActors = mergePhotoActors(
    existing?.fiveRAreaKasirPhotoActors,
    input.fiveRAreaKasirPhotos,
    input.userId,
    now,
  );
  actor.fiveRAreaDepanPhotoActors = mergePhotoActors(
    existing?.fiveRAreaDepanPhotoActors,
    input.fiveRAreaDepanPhotos,
    input.userId,
    now,
  );
  actor.fiveRAreaKananPhotoActors = mergePhotoActors(
    existing?.fiveRAreaKananPhotoActors,
    input.fiveRAreaKananPhotos,
    input.userId,
    now,
  );
  actor.fiveRAreaKiriPhotoActors = mergePhotoActors(
    existing?.fiveRAreaKiriPhotoActors,
    input.fiveRAreaKiriPhotos,
    input.userId,
    now,
  );
  actor.fiveRAreaGudangPhotoActors = mergePhotoActors(
    existing?.fiveRAreaGudangPhotoActors,
    input.fiveRAreaGudangPhotos,
    input.userId,
    now,
  );

  setIfMissing(input.cekLamp, "cekLampBy", "cekLampAt");
  setIfMissing(input.cekSoundSystem, "cekSoundSystemBy", "cekSoundSystemAt");
  setIfMissing(
    photoCount(input.cashierDeskPhotos) > 0,
    "cashDrawerBy",
    "cashDrawerAt",
  );

  actor.completedBy = input.userId;
  actor.completedByScheduleId = input.scheduleId;

  return actor;
}

export async function submitStoreOpening(
  input: SubmitStoreOpeningInput,
): Promise<TaskResult<StoreOpeningTask>> {
  try {
    const gateErr = await assertCanProgressTask(
      input.scheduleId,
      input.storeId,
      input.geo,
      input.skipGeo,
    );
    if (gateErr) return { success: false, error: gateErr };

    const validationErr = validateStoreOpeningPayload(input);
    if (validationErr) return { success: false, error: validationErr };

    const now = new Date();
    const existing = await findRow(input.taskId, input.storeId, now);

    if (existing?.status === "completed") {
      return { success: false, error: "Store opening task sudah disubmit." };
    }

    const morningShiftId = await getMorningShiftId();

    const values: StoreOpeningInsert = {
      scheduleId: input.scheduleId,
      userId: input.userId,
      storeId: input.storeId,
      shiftId: existing?.shiftId ?? morningShiftId,
      date: existing?.date ?? startOfDay(now),

      loginPos: input.loginPos,
      checkAbsenSunfish: input.checkAbsenSunfish,
      tarikSohSales: input.tarikSohSales,
      fiveR: input.fiveR,

      fiveRAreaKasirPhotos: jsonPhotos(input.fiveRAreaKasirPhotos),
      fiveRAreaDepanPhotos: jsonPhotos(input.fiveRAreaDepanPhotos),
      fiveRAreaKananPhotos: jsonPhotos(input.fiveRAreaKananPhotos),
      fiveRAreaKiriPhotos: jsonPhotos(input.fiveRAreaKiriPhotos),
      fiveRAreaGudangPhotos: jsonPhotos(input.fiveRAreaGudangPhotos),

      cekLamp: input.cekLamp,
      cekSoundSystem: input.cekSoundSystem,
      cashDrawerPhotos: jsonPhotos(input.cashierDeskPhotos),

      submittedLat: String(input.geo.lat),
      submittedLng: String(input.geo.lng),
      notes: input.notes,
      status: "completed" as const,
      completedAt: now,
      updatedAt: now,
      ...makeSubmitActorUpdate(input, existing ?? null, now),
    };

    const [row] = existing
      ? await db
          .update(storeOpeningTasks)
          .set(values)
          .where(eq(storeOpeningTasks.id, existing.id))
          .returning()
      : await db.insert(storeOpeningTasks).values(values).returning();

    return { success: true, data: row };
  } catch (err) {
    return { success: false, error: `submitStoreOpening: ${err}` };
  }
}

export async function autoSaveStoreOpening(
  taskIdOrStoreId: number,
  patch: StoreOpeningAutoSavePatch,
  userId?: string,
  scheduleId?: number,
  geo?: GeoPoint,
): Promise<TaskResult<{ saved: string[] }>> {
  try {
    const existingByTaskId = await findRowByTaskId(taskIdOrStoreId);
    const existing =
      existingByTaskId ?? (await findTodayRow(taskIdOrStoreId, new Date()));

    if (!existing)
      return { success: false, error: "Store opening task not found." };
    if (existing.status === "completed") {
      return { success: true, data: { saved: [] } };
    }

    if (scheduleId && geo) {
      const gateErr = await assertCanProgressTask(
        scheduleId,
        existing.storeId,
        geo,
        false,
      );
      if (gateErr) return { success: false, error: gateErr };
    }

    const now = new Date();
    const update: StoreOpeningUpdate = { updatedAt: now };

    if ("loginPos" in patch) update.loginPos = Boolean(patch.loginPos);
    if ("checkAbsenSunfish" in patch)
      update.checkAbsenSunfish = Boolean(patch.checkAbsenSunfish);
    if ("tarikSohSales" in patch)
      update.tarikSohSales = Boolean(patch.tarikSohSales);
    if ("fiveR" in patch) update.fiveR = Boolean(patch.fiveR);
    if ("cekLamp" in patch) update.cekLamp = Boolean(patch.cekLamp);
    if ("cekSoundSystem" in patch)
      update.cekSoundSystem = Boolean(patch.cekSoundSystem);
    if ("notes" in patch) update.notes = patch.notes;

    if ("cashierDeskPhotos" in patch)
      update.cashDrawerPhotos = jsonPhotos(patch.cashierDeskPhotos);
    if ("fiveRAreaKasirPhotos" in patch)
      update.fiveRAreaKasirPhotos = jsonPhotos(patch.fiveRAreaKasirPhotos);
    if ("fiveRAreaDepanPhotos" in patch)
      update.fiveRAreaDepanPhotos = jsonPhotos(patch.fiveRAreaDepanPhotos);
    if ("fiveRAreaKananPhotos" in patch)
      update.fiveRAreaKananPhotos = jsonPhotos(patch.fiveRAreaKananPhotos);
    if ("fiveRAreaKiriPhotos" in patch)
      update.fiveRAreaKiriPhotos = jsonPhotos(patch.fiveRAreaKiriPhotos);
    if ("fiveRAreaGudangPhotos" in patch)
      update.fiveRAreaGudangPhotos = jsonPhotos(patch.fiveRAreaGudangPhotos);

    if (userId) applyActorForPatch(update, patch, existing, userId, now);
    if (userId) update.userId = userId;
    if (scheduleId) update.scheduleId = scheduleId;
    if (existing.status === "pending") update.status = "in_progress";

    await db
      .update(storeOpeningTasks)
      .set(update)
      .where(eq(storeOpeningTasks.id, existing.id));

    return {
      success: true,
      data: { saved: Object.keys(update).filter((k) => k !== "updatedAt") },
    };
  } catch (err) {
    return { success: false, error: `autoSaveStoreOpening: ${err}` };
  }
}

export async function getStoreOpeningByStoreDate(
  storeId: number,
  date: Date,
): Promise<StoreOpeningTask | null> {
  return findTodayRow(storeId, date);
}

export async function getStoreOpeningBySchedule(
  scheduleId: number,
): Promise<StoreOpeningTask | null> {
  const [row] = await db
    .select()
    .from(storeOpeningTasks)
    .where(eq(storeOpeningTasks.scheduleId, scheduleId))
    .limit(1);

  return row ?? null;
}

export async function getStoreOpeningById(
  id: number,
): Promise<StoreOpeningTask | null> {
  return findRowByTaskId(id);
}

export async function getOrCreateStoreOpeningForSchedule(
  scheduleId: number,
  userId: string,
  storeId: number,
  date: Date,
): Promise<StoreOpeningTask> {
  const existing = await findTodayRow(storeId, date);
  if (existing) return existing;

  const morningShiftId = await getMorningShiftId();
  const [row] = await db
    .insert(storeOpeningTasks)
    .values({
      scheduleId,
      userId,
      storeId,
      shiftId: morningShiftId,
      date: startOfDay(date),
      status: "pending",
      updatedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();

  return row ?? (await findTodayRow(storeId, date))!;
}
