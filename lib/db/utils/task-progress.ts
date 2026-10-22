// lib/db/utils/task-progress.ts
//
// "Tasks × stores × days" — the data behind the IT Task Progress pages
// (/it/task-progress, GET /api/it/task-progress) and the Ops task board
// (/ops/tasks/progress, GET /api/ops/tasks/board). Read-only: no task row is
// created for a store nobody has opened; scheduled-but-unopened slots come back
// as placeholders (see task-expectations.ts), exactly as the Ops progress does.

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/lib/db';
import {
  areas,
  briefingTasks,
  cekBinTasks,
  cekUangModalTasks,
  groomingTasks,
  marketingCheckTasks,
  serahTerimaEntries,
  setoranTasks,
  stores,
  storeClosingTasks,
  storeFrontTasks,
  storeOpeningTasks,
  users,
  vmChecklistTasks,
} from '@/lib/db/schema';
import { addDaysKey, jakartaDateKey, jakartaDaysRange, jakartaTodayKey } from '@/lib/day-bucket';
import { baseShiftCode, type TaskType } from '@/lib/shift-tasks';
import { getShiftCodeById } from '@/lib/db/utils/shift-lookup';
import { getExpectedTaskSlots, missingTaskSlots, storeDayKey } from '@/lib/db/utils/task-expectations';
import {
  BOARD_TASK,
  isDoneStatus,
  summariseStore,
  type BoardStore,
  type RangeCell,
  type TaskProgressSlot,
  type TaskProgressStore,
  type TaskRangeStore,
} from '@/lib/task-progress';

// The per-day task tables. Serah Terima is a rolling board, handled separately.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DAILY_TABLES: Partial<Record<TaskType, any>> = {
  store_front: storeFrontTasks,
  setoran: setoranTasks,
  store_opening: storeOpeningTasks,
  cek_uang_modal: cekUangModalTasks,
  cek_bin: cekBinTasks,
  grooming: groomingTasks,
  vm_checklist: vmChecklistTasks,
  marketing_check: marketingCheckTasks,
  briefing: briefingTasks,
  store_closing: storeClosingTasks,
};

export const DAILY_PROGRESS_TYPES = Object.keys(DAILY_TABLES) as TaskType[];

/** An open Serah Terima item older than this has gone stale (same bar as the Ops board). */
const STALE_MS = 24 * 60 * 60 * 1000;

export type StoreMeta = Omit<TaskProgressStore, 'slots'>;

/** Active stores (only `storeIds` when given), by area then name. */
export async function loadActiveStores(storeIds?: number[]): Promise<StoreMeta[]> {
  if (storeIds && !storeIds.length) return [];
  return db
    .select({
      storeId: stores.id,
      storeNo: stores.storeNo,
      name: stores.name,
      areaId: stores.areaId,
      areaName: areas.name,
    })
    .from(stores)
    .leftJoin(areas, eq(areas.id, stores.areaId))
    .where(and(eq(stores.status, 'active'), storeIds ? inArray(stores.id, storeIds) : undefined))
    .orderBy(asc(areas.name), asc(stores.name));
}

function toIso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

/**
 * Every active store's slots for `types` on each Jakarta day `fromKey`..`toKey`
 * (Map type → storeDayKey(storeId, day) → slots; a store-day with no slot is
 * absent). Placeholders only exist up to today — later shifts haven't happened.
 */
export async function getTaskSlotsForRange(
  fromKey: string,
  toKey: string,
  types: TaskType[],
  storeIds?: number[],
): Promise<{ stores: StoreMeta[]; byType: Map<TaskType, Map<string, TaskProgressSlot[]>> }> {
  const storeList = await loadActiveStores(storeIds);
  const ids = storeList.map((s) => s.storeId);
  const byType = new Map<TaskType, Map<string, TaskProgressSlot[]>>();
  const wanted = types.filter((t): t is TaskType => t in DAILY_TABLES);
  if (!ids.length || !wanted.length) return { stores: storeList, byType };

  const { start, end } = jakartaDaysRange(fromKey, toKey);
  const completer = alias(users, 'completer');
  const [shiftCodeById, expected] = await Promise.all([
    getShiftCodeById(),
    getExpectedTaskSlots(ids, fromKey, toKey),
  ]);

  const placeholderUserIds = new Set<string>();
  const pending: { type: TaskType; bucket: string; slot: TaskProgressSlot; userIds: string[] }[] = [];

  await Promise.all(
    wanted.map(async (type) => {
      const table = DAILY_TABLES[type];
      const hasCompletedBy = 'completedBy' in table;
      const hasParent = 'parentTaskId' in table;

      const fields: Record<string, unknown> = {
        id: table.id,
        storeId: table.storeId,
        date: table.date,
        shiftId: table.shiftId,
        userId: table.userId,
        status: table.status,
        completedAt: table.completedAt,
        userName: users.name,
      };
      if (hasParent) fields.parentTaskId = table.parentTaskId;
      if (hasCompletedBy) fields.completedByName = completer.name;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = db.select(fields as never).from(table).leftJoin(users, eq(users.id, table.userId));
      if (hasCompletedBy) query = query.leftJoin(completer, eq(completer.id, table.completedBy));
      const rows: {
        id: number;
        storeId: number;
        date: Date;
        shiftId: number | null;
        userId: string;
        status: string | null;
        completedAt: Date | null;
        userName: string | null;
        parentTaskId?: number | null;
        completedByName?: string | null;
      }[] = await query.where(and(inArray(table.storeId, ids), gte(table.date, start), lt(table.date, end)));

      // A "Lanjutan" row replaces the task it continues — judge the store by the live one.
      const superseded = new Set(rows.map((r) => r.parentTaskId).filter((id): id is number => id != null));

      const perBucket = new Map<string, TaskProgressSlot[]>();
      const rowsByBucket = new Map<string, { type: string; shift: string | null; userId: string }[]>();
      for (const r of rows) {
        if (superseded.has(r.id)) continue;
        const bucket = storeDayKey(r.storeId, jakartaDateKey(r.date));
        const shift = r.shiftId != null ? baseShiftCode(shiftCodeById.get(r.shiftId)) || null : null;
        const status = r.status ?? 'not_started';
        const slot: TaskProgressSlot = {
          key: `${type}-${r.id}`,
          id: r.id,
          shift,
          status,
          doneBy: status === 'not_started' ? null : (r.completedByName ?? r.userName ?? null),
          scheduledNames: [],
          completedAt: toIso(r.completedAt),
          note: null,
          isPlaceholder: false,
        };
        perBucket.set(bucket, [...(perBucket.get(bucket) ?? []), slot]);
        rowsByBucket.set(bucket, [...(rowsByBucket.get(bucket) ?? []), { type, shift, userId: r.userId }]);
      }
      byType.set(type, perBucket);

      // Scheduled slots nobody has opened yet.
      for (const [bucket, slots] of expected) {
        const ofType = slots.filter((x) => x.type === type);
        for (const slot of missingTaskSlots(ofType, rowsByBucket.get(bucket) ?? [])) {
          slot.userIds.forEach((id) => placeholderUserIds.add(id));
          pending.push({
            type,
            bucket,
            userIds: slot.userIds,
            slot: {
              key: `${type}-slot-${bucket}-${slot.key}`,
              id: null,
              shift: slot.shift,
              status: 'not_started',
              doneBy: null,
              scheduledNames: [],
              completedAt: null,
              note: null,
              isPlaceholder: true,
            },
          });
        }
      }
    }),
  );

  if (pending.length) {
    const nameRows = placeholderUserIds.size
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [...placeholderUserIds]))
      : [];
    const nameById = new Map(nameRows.map((u) => [u.id, u.name]));
    for (const { type, bucket, slot, userIds } of pending) {
      slot.scheduledNames = userIds.map((id) => nameById.get(id) ?? id);
      const perBucket = byType.get(type) ?? new Map<string, TaskProgressSlot[]>();
      perBucket.set(bucket, [...(perBucket.get(bucket) ?? []), slot]);
      byType.set(type, perBucket);
    }
  }

  return { stores: storeList, byType };
}

/**
 * Every active store's slots for `types` on Jakarta day `dayKey`
 * (Map type → storeId → slots; a store with no slot is simply absent).
 */
export async function getTaskProgressForDay(
  dayKey: string,
  types: TaskType[],
  storeIds?: number[],
): Promise<{ stores: StoreMeta[]; byType: Map<TaskType, Map<number, TaskProgressSlot[]>> }> {
  const { stores: storeList, byType: byBucket } = await getTaskSlotsForRange(dayKey, dayKey, types, storeIds);
  const byType = new Map<TaskType, Map<number, TaskProgressSlot[]>>();
  for (const [type, perBucket] of byBucket) {
    const perStore = new Map<number, TaskProgressSlot[]>();
    for (const s of storeList) {
      const slots = perBucket.get(storeDayKey(s.storeId, dayKey));
      if (slots) perStore.set(s.storeId, slots);
    }
    byType.set(type, perStore);
  }
  return { stores: storeList, byType };
}

/** Stores joined to their slots for one task type. */
export async function getTaskProgressByType(dayKey: string, type: TaskType): Promise<TaskProgressStore[]> {
  const { stores: storeList, byType } = await getTaskProgressForDay(dayKey, [type]);
  const perStore = byType.get(type);
  return storeList.map((s) => ({ ...s, slots: perStore?.get(s.storeId) ?? [] }));
}

/**
 * Serah Terima — the shared handover board. Each store's open (not yet received)
 * items are its slots: on hold or older than a day = needs attention.
 */
export async function getSerahTerimaProgress(storeIds?: number[]): Promise<TaskProgressStore[]> {
  const storeList = await loadActiveStores(storeIds);
  const ids = storeList.map((s) => s.storeId);
  if (!ids.length) return [];

  const rows = await db
    .select({
      id: serahTerimaEntries.id,
      storeId: serahTerimaEntries.storeId,
      message: serahTerimaEntries.message,
      createdAt: serahTerimaEntries.createdAt,
      isOnHold: serahTerimaEntries.isOnHold,
      createdByName: users.name,
    })
    .from(serahTerimaEntries)
    .leftJoin(users, eq(users.id, serahTerimaEntries.createdByUserId))
    .where(and(eq(serahTerimaEntries.isCompleted, false), inArray(serahTerimaEntries.storeId, ids)))
    .orderBy(asc(serahTerimaEntries.createdAt));

  const now = Date.now();
  const perStore = new Map<number, TaskProgressSlot[]>();
  for (const r of rows) {
    const stale = now - r.createdAt.getTime() > STALE_MS;
    const slot: TaskProgressSlot = {
      key: `${BOARD_TASK}-${r.id}`,
      id: r.id,
      shift: null,
      status: r.isOnHold || stale ? 'pending' : 'in_progress',
      doneBy: r.createdByName ?? null,
      scheduledNames: [],
      completedAt: r.createdAt.toISOString(),
      note: r.message,
      isPlaceholder: false,
    };
    perStore.set(r.storeId, [...(perStore.get(r.storeId) ?? []), slot]);
  }
  return storeList.map((s) => ({ ...s, slots: perStore.get(s.storeId) ?? [] }));
}

/** Every task (+ the Serah Terima board) for each active store on one day. */
export async function getTaskBoard(dayKey: string, storeIds?: number[]): Promise<BoardStore[]> {
  const [{ stores: storeList, byType }, handover] = await Promise.all([
    getTaskProgressForDay(dayKey, DAILY_PROGRESS_TYPES, storeIds),
    getSerahTerimaProgress(storeIds),
  ]);
  const handoverByStore = new Map(handover.map((s) => [s.storeId, s.slots]));
  return storeList.map((s) => ({
    ...s,
    tasks: Object.fromEntries([
      ...DAILY_PROGRESS_TYPES.map((t) => [t, byType.get(t)?.get(s.storeId) ?? []] as const),
      [BOARD_TASK, handoverByStore.get(s.storeId) ?? []] as const,
    ]),
  }));
}

/** Days `from`..`to` inclusive (Jakarta keys). */
function daysBetweenKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysKey(d, 1)) out.push(d);
  return out;
}

/** One task, every active store, each day of a range: how the store did that day. */
export async function getTaskRange(type: TaskType, from: string, to: string, storeIds?: number[]): Promise<TaskRangeStore[]> {
  const { stores: storeList, byType } = await getTaskSlotsForRange(from, to, [type], storeIds);
  const perBucket = byType.get(type);
  const today = jakartaTodayKey();
  const days = daysBetweenKeys(from, to);
  return storeList.map((s) => {
    const cells: Record<string, RangeCell> = {};
    for (const day of days) {
      const slots = perBucket?.get(storeDayKey(s.storeId, day));
      if (!slots?.length) continue;
      const p = summariseStore(slots, day < today);
      cells[day] = { key: p.key, done: p.done, total: p.total };
    }
    return { ...s, days: cells };
  });
}

/** Every daily task, each day of a range: slots done / slots scheduled across the stores. */
export async function getOverviewRange(from: string, to: string, storeIds?: number[]) {
  const { byType } = await getTaskSlotsForRange(from, to, DAILY_PROGRESS_TYPES, storeIds);
  return DAILY_PROGRESS_TYPES.map((type) => {
    const days: Record<string, { done: number; total: number }> = {};
    for (const [bucket, slots] of byType.get(type) ?? []) {
      const day = bucket.slice(bucket.indexOf('::') + 2);
      const cell = days[day] ?? { done: 0, total: 0 };
      cell.total += slots.length;
      cell.done += slots.filter((x) => isDoneStatus(x.status)).length;
      days[day] = cell;
    }
    return { type, days };
  });
}
