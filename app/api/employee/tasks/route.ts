// app/api/employee/tasks/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  schedules,
  shifts,
  shiftTasks,
  taskDefinitions,
  storeOpeningTasks,
  storeFrontTasks,
  setoranTasks,
  cekBinTasks,
  storeBins,
  cekBinTaskBins,
  vmChecklistTasks,
  marketingCheckTasks,
  briefingTasks,
  serahTerimaTasks,
  serahTerimaItems,
  storeClosingTasks,
  groomingTasks,
  itemDroppingTasks,
  itemDroppingEntries,
  itemReturnTasks,
  itemReturnEntries,
  cekUangModalTasks,
  cekUangModalDenominations,
} from "@/lib/db/schema";
import { eq, and, gte, lte, desc, inArray, asc } from "drizzle-orm";
import { todayInStoreTimezone } from "@/lib/schedule-utils";
import { getOrCreateSetoranForSchedule } from "@/lib/db/utils/setoran";
import { getOrCreateStoreOpeningForSchedule } from "@/lib/db/utils/store-opening";
import {
  getOrCreateStoreFrontForSchedule,
  claimStoreFrontTask,
} from "@/lib/db/utils/store-front";
import { getOrCreateCekBinForSchedule } from "@/lib/db/utils/cek-bin";
import { getOrCreateVmChecklistForSchedule } from "@/lib/db/utils/vm-checklist";
import { getOrCreateMarketingCheckForSchedule } from "@/lib/db/utils/marketing-check";
import { getOrCreateItemDroppingForSchedule } from "@/lib/db/utils/item-dropping";
import { getOrCreateItemReturnForSchedule } from "@/lib/db/utils/item-return";
import { getOrCreateCekUangModalForSchedule } from "@/lib/db/utils/cek-uang-modal";
import { getOrCreateGroomingForSchedule } from "@/lib/db/utils/grooming";
import { getOrCreateBriefingForSchedule } from "@/lib/db/utils/briefing";
import { getOrCreateSerahTerimaForSchedule } from "@/lib/db/utils/serah-terima";
import {
  getOrCreateStoreClosingForSchedule,
  getVisibleStoreClosingTasksForStores,
} from "@/lib/db/utils/store-closing";
// IMPORTANT:
// Do not import SHIFT_TASK_MAP here. The employee task page must use the
// admin-managed DB mapping from task_definitions + shift_tasks.
// The constants below are only the task types this API knows how to materialise/read.
const SUPPORTED_TASK_TYPES = [
  "store_opening",
  "store_front",
  "setoran",
  "cek_bin",
  "vm_checklist",
  "marketing_check",
  "item_dropping",
  "item_return",
  "cek_uang_modal",
  "briefing",
  "serah_terima",
  "store_closing",
  "grooming",
] as const;

type TaskType = (typeof SUPPORTED_TASK_TYPES)[number];

function isSupportedTaskType(value: string): value is TaskType {
  return (SUPPORTED_TASK_TYPES as readonly string[]).includes(value);
}

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

function parseJsonArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parsePhotos(raw: string | null | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v) => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type ShiftCode = string;

let _shiftCodeCache: Record<number, string> | null = null;

async function getShiftCodeMap(): Promise<Record<number, string>> {
  if (_shiftCodeCache) return _shiftCodeCache;

  const rows = await db
    .select({ id: shifts.id, code: shifts.code })
    .from(shifts);

  _shiftCodeCache = Object.fromEntries(rows.map((r) => [r.id, r.code]));
  return _shiftCodeCache;
}

type ShiftTaskConfig = {
  assignedTaskTypes: Set<TaskType>;
  // Task types per shift, in the IT-configured order (shift_tasks.sortOrder).
  // The employee task list sorts tasks using this array's index.
  shiftTaskMap: Record<string, TaskType[]>;
  // Whether each task type is required (mandatory for the shift) per
  // shift_tasks.isRequired. Independent from shiftTaskSequenced below.
  shiftTaskRequired: Record<string, Partial<Record<TaskType, boolean>>>;
  // Whether each task type is part of the shift's fixed, gated order per
  // shift_tasks.isSequenced (managed from OPS → Shift & Tasks → Fixed
  // Order). Sequenced tasks are locked until every earlier sequenced task
  // is completed/verified; everything else can be done anytime.
  shiftTaskSequenced: Record<string, Partial<Record<TaskType, boolean>>>;
  unsupportedTaskDefinitions: Array<{
    shiftId: number;
    shiftCode: string;
    code: string;
    label: string;
  }>;
};

async function getAssignedTaskTypesFromDb(
  shiftIds: number[],
  shiftCodeMap: Record<number, string>,
): Promise<ShiftTaskConfig> {
  if (!shiftIds.length) {
    return {
      assignedTaskTypes: new Set<TaskType>(),
      shiftTaskMap: {},
      shiftTaskRequired: {},
      shiftTaskSequenced: {},
      unsupportedTaskDefinitions: [],
    };
  }

  const rows = await db
    .select({
      shiftId: shiftTasks.shiftId,
      taskCode: taskDefinitions.code,
      taskLabel: taskDefinitions.label,
      taskSortOrder: taskDefinitions.sortOrder,
      assignmentSortOrder: shiftTasks.sortOrder,
      isRequired: shiftTasks.isRequired,
      isSequenced: shiftTasks.isSequenced,
    })
    .from(shiftTasks)
    .innerJoin(
      taskDefinitions,
      eq(taskDefinitions.id, shiftTasks.taskDefinitionId),
    )
    .where(
      and(
        inArray(shiftTasks.shiftId, shiftIds),
        eq(shiftTasks.isActive, true),
        eq(taskDefinitions.isActive, true),
      ),
    )
    .orderBy(
      asc(shiftTasks.shiftId),
      asc(shiftTasks.sortOrder),
      asc(taskDefinitions.sortOrder),
    );

  const assignedTaskTypes = new Set<TaskType>();
  const shiftTaskMap: Record<string, TaskType[]> = {};
  const shiftTaskRequired: Record<string, Partial<Record<TaskType, boolean>>> =
    {};
  const shiftTaskSequenced: Record<string, Partial<Record<TaskType, boolean>>> =
    {};
  const unsupportedTaskDefinitions: ShiftTaskConfig["unsupportedTaskDefinitions"] =
    [];

  for (const row of rows) {
    const shiftCode = shiftCodeMap[row.shiftId] ?? String(row.shiftId);

    if (!shiftTaskMap[shiftCode]) {
      shiftTaskMap[shiftCode] = [];
    }
    if (!shiftTaskRequired[shiftCode]) {
      shiftTaskRequired[shiftCode] = {};
    }
    if (!shiftTaskSequenced[shiftCode]) {
      shiftTaskSequenced[shiftCode] = {};
    }

    if (!isSupportedTaskType(row.taskCode)) {
      unsupportedTaskDefinitions.push({
        shiftId: row.shiftId,
        shiftCode,
        code: row.taskCode,
        label: row.taskLabel,
      });
      continue;
    }

    assignedTaskTypes.add(row.taskCode);

    if (!shiftTaskMap[shiftCode].includes(row.taskCode)) {
      shiftTaskMap[shiftCode].push(row.taskCode);
    }
    shiftTaskRequired[shiftCode][row.taskCode] = row.isRequired;
    shiftTaskSequenced[shiftCode][row.taskCode] = row.isSequenced;
  }

  return {
    assignedTaskTypes,
    shiftTaskMap,
    shiftTaskRequired,
    shiftTaskSequenced,
    unsupportedTaskDefinitions,
  };
}

function taskAllowedForEmployeeShift(
  taskType: TaskType,
  taskShift: string,
  employeeShiftCodes: string[],
  shiftTaskMap: Record<string, TaskType[]>,
) {
  // A task is visible when it belongs to one of the employee's scheduled shifts.
  // This supports custom shifts created from OPS because it reads shiftTaskMap from DB.
  return employeeShiftCodes.some((shiftCode) => {
    const allowedForShift = shiftTaskMap[shiftCode] ?? [];
    if (!allowedForShift.includes(taskType)) return false;

    // Store-level shared rows can be created on a different schedule/shift row.
    // When the task type is assigned to this employee's shift, let them see it.
    if (taskShift === shiftCode) return true;
    if (
      taskShift === "morning" ||
      taskShift === "evening" ||
      taskShift === "full_day"
    )
      return true;

    return taskShift === shiftCode;
  });
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    const targetDate = dateParam
      ? new Date(`${dateParam}T00:00:00`)
      : todayInStoreTimezone();
    const dayStart = startOfDay(targetDate);
    const dayEnd = endOfDay(targetDate);

    const todaySchedules = await db
      .select({
        id: schedules.id,
        shiftId: schedules.shiftId,
        storeId: schedules.storeId,
      })
      .from(schedules)
      .where(
        and(
          eq(schedules.userId, userId),
          eq(schedules.isHoliday, false),
          gte(schedules.date, dayStart),
          lte(schedules.date, dayEnd),
        ),
      );

    if (!todaySchedules.length) {
      return NextResponse.json({
        success: true,
        tasks: [],
        shift: null,
        scheduleIds: [],
      });
    }

    const shiftCodeMap = await getShiftCodeMap();
    const scheduleIds = todaySchedules.map((s) => s.id);
    const storeIds = [...new Set(todaySchedules.map((s) => s.storeId))];

    const shiftCodesRaw = [
      ...new Set(todaySchedules.map((s) => shiftCodeMap[s.shiftId] ?? "")),
    ].filter(Boolean) as ShiftCode[];

    const shiftIds = [...new Set(todaySchedules.map((s) => s.shiftId))];
    const {
      assignedTaskTypes: allowedTaskTypes,
      shiftTaskMap,
      shiftTaskRequired,
      shiftTaskSequenced,
      unsupportedTaskDefinitions,
    } = await getAssignedTaskTypesFromDb(shiftIds, shiftCodeMap);

    const shouldLoadTask = (taskType: TaskType) =>
      allowedTaskTypes.has(taskType);

    const primaryShift: ShiftCode | null = shiftCodesRaw[0] ?? null;
    const inStore = (storeId: number) => storeIds.includes(storeId);

    // Store-level shared tasks can be created by one employee but completed by another
    // employee from the same store/day. For AccessGuard + submit guards, the scheduleId
    // sent to the task detail page must be the logged-in employee's own scheduleId.
    const buildPreferredScheduleByStoreId = (preferredShiftCodes: string[]) => {
      const rank = (shiftId: number) => {
        const code = shiftCodeMap[shiftId] ?? "";
        const idx = preferredShiftCodes.indexOf(code);
        return idx === -1 ? preferredShiftCodes.length + 1 : idx;
      };

      const map = new Map<number, (typeof todaySchedules)[number]>();

      for (const schedule of todaySchedules) {
        const current = map.get(schedule.storeId);

        if (!current || rank(schedule.shiftId) < rank(current.shiftId)) {
          map.set(schedule.storeId, schedule);
        }
      }

      return map;
    };

    const morningScheduleByStoreId = buildPreferredScheduleByStoreId([
      "morning",
      "full_day",
    ]);

    const closingScheduleByStoreId = buildPreferredScheduleByStoreId([
      "evening",
      "full_day",
    ]);

    const morningSchedules = todaySchedules.filter((s) => {
      const code = shiftCodeMap[s.shiftId];
      return code === "morning" || code === "full_day";
    });

    const [
      openingRows,
      storeFrontRows,
      setoranRows,
      cekBinRows,
      vmChecklistRows,
      marketingCheckRows,
      itemDroppingRows,
      itemDroppingEntryRows,
      itemReturnRows,
      itemReturnEntryRows,
      cekUangModalRows,
      cekUangModalDenominationRows,
      storeClosingRows,
      briefingRows,
      serahTerimaRows,
      serahTerimaItemRows,
      groomingRows,
    ] = await Promise.all([
      shouldLoadTask("store_opening")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateStoreOpeningForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(storeOpeningTasks)
              .where(
                and(
                  inArray(storeOpeningTasks.storeId, storeIds),
                  gte(storeOpeningTasks.date, dayStart),
                  lte(storeOpeningTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(storeOpeningTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("store_front")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateStoreFrontForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(storeFrontTasks)
              .where(
                and(
                  inArray(storeFrontTasks.storeId, storeIds),
                  gte(storeFrontTasks.date, dayStart),
                  lte(storeFrontTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(storeFrontTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("setoran")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) => getOrCreateSetoranForSchedule(s.id)),
            );

            return db
              .select()
              .from(setoranTasks)
              .where(
                and(
                  inArray(setoranTasks.storeId, storeIds),
                  gte(setoranTasks.date, dayStart),
                  lte(setoranTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(setoranTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("cek_bin")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateCekBinForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(cekBinTasks)
              .where(
                and(
                  inArray(cekBinTasks.storeId, storeIds),
                  gte(cekBinTasks.date, dayStart),
                  lte(cekBinTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(cekBinTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("vm_checklist")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateVmChecklistForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(vmChecklistTasks)
              .where(
                and(
                  inArray(vmChecklistTasks.storeId, storeIds),
                  gte(vmChecklistTasks.date, dayStart),
                  lte(vmChecklistTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(vmChecklistTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("marketing_check")
        ? (async () => {
            await Promise.all(
              morningSchedules.map((s) =>
                getOrCreateMarketingCheckForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(marketingCheckTasks)
              .where(
                and(
                  inArray(marketingCheckTasks.storeId, storeIds),
                  gte(marketingCheckTasks.date, dayStart),
                  lte(marketingCheckTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(marketingCheckTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("item_dropping")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateItemDroppingForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(itemDroppingTasks)
              .where(
                and(
                  inArray(itemDroppingTasks.storeId, storeIds),
                  gte(itemDroppingTasks.date, dayStart),
                  lte(itemDroppingTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(itemDroppingTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("item_dropping")
        ? (async () => {
            const taskIds = await db
              .select({ id: itemDroppingTasks.id })
              .from(itemDroppingTasks)
              .where(
                and(
                  inArray(itemDroppingTasks.storeId, storeIds),
                  gte(itemDroppingTasks.date, dayStart),
                  lte(itemDroppingTasks.date, dayEnd),
                ),
              );

            if (!taskIds.length) return [];

            return db
              .select()
              .from(itemDroppingEntries)
              .where(
                inArray(
                  itemDroppingEntries.taskId,
                  taskIds.map((r) => r.id),
                ),
              )
              .orderBy(itemDroppingEntries.dropTime);
          })()
        : Promise.resolve([]),

      shouldLoadTask("item_return")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateItemReturnForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(itemReturnTasks)
              .where(
                and(
                  inArray(itemReturnTasks.storeId, storeIds),
                  gte(itemReturnTasks.date, dayStart),
                  lte(itemReturnTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(itemReturnTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("item_return")
        ? (async () => {
            const taskIds = await db
              .select({ id: itemReturnTasks.id })
              .from(itemReturnTasks)
              .where(
                and(
                  inArray(itemReturnTasks.storeId, storeIds),
                  gte(itemReturnTasks.date, dayStart),
                  lte(itemReturnTasks.date, dayEnd),
                ),
              );

            if (!taskIds.length) return [];

            return db
              .select()
              .from(itemReturnEntries)
              .where(
                inArray(
                  itemReturnEntries.taskId,
                  taskIds.map((r) => r.id),
                ),
              )
              .orderBy(itemReturnEntries.returnTime);
          })()
        : Promise.resolve([]),

      shouldLoadTask("cek_uang_modal")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateCekUangModalForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(cekUangModalTasks)
              .where(
                and(
                  inArray(cekUangModalTasks.storeId, storeIds),
                  gte(cekUangModalTasks.date, dayStart),
                  lte(cekUangModalTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(cekUangModalTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("cek_uang_modal")
        ? (async () => {
            const taskIds = await db
              .select({ id: cekUangModalTasks.id })
              .from(cekUangModalTasks)
              .where(
                and(
                  inArray(cekUangModalTasks.storeId, storeIds),
                  gte(cekUangModalTasks.date, dayStart),
                  lte(cekUangModalTasks.date, dayEnd),
                ),
              );

            if (!taskIds.length) return [];

            return db
              .select()
              .from(cekUangModalDenominations)
              .where(
                inArray(
                  cekUangModalDenominations.taskId,
                  taskIds.map((r) => r.id),
                ),
              )
              .orderBy(cekUangModalDenominations.denominationValue);
          })()
        : Promise.resolve([]),

      shouldLoadTask("store_closing")
        ? (async () => {
            const closingSchedules = todaySchedules.filter((s) => {
              const code = shiftCodeMap[s.shiftId];
              return code === "evening" || code === "full_day";
            });

            await Promise.all(
              closingSchedules.map((s) =>
                getOrCreateStoreClosingForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return getVisibleStoreClosingTasksForStores(storeIds, targetDate);
          })()
        : Promise.resolve([]),

      shouldLoadTask("briefing")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateBriefingForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(briefingTasks)
              .where(
                and(
                  inArray(briefingTasks.storeId, storeIds),
                  gte(briefingTasks.date, dayStart),
                  lte(briefingTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(briefingTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("serah_terima")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateSerahTerimaForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(serahTerimaTasks)
              .where(
                and(
                  inArray(serahTerimaTasks.storeId, storeIds),
                  gte(serahTerimaTasks.date, dayStart),
                  lte(serahTerimaTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(serahTerimaTasks.date));
          })()
        : Promise.resolve([]),

      shouldLoadTask("serah_terima")
        ? (async () => {
            const taskIds = await db
              .select({ id: serahTerimaTasks.id })
              .from(serahTerimaTasks)
              .where(
                and(
                  inArray(serahTerimaTasks.storeId, storeIds),
                  gte(serahTerimaTasks.date, dayStart),
                  lte(serahTerimaTasks.date, dayEnd),
                ),
              );

            if (!taskIds.length) return [];

            return db
              .select()
              .from(serahTerimaItems)
              .where(
                inArray(
                  serahTerimaItems.taskId,
                  taskIds.map((r) => r.id),
                ),
              )
              .orderBy(asc(serahTerimaItems.id));
          })()
        : Promise.resolve([]),

      shouldLoadTask("grooming")
        ? (async () => {
            await Promise.all(
              todaySchedules.map((s) =>
                getOrCreateGroomingForSchedule(
                  s.id,
                  userId,
                  s.storeId,
                  s.shiftId,
                  targetDate,
                ),
              ),
            );

            return db
              .select()
              .from(groomingTasks)
              .where(
                and(
                  eq(groomingTasks.userId, userId),
                  inArray(groomingTasks.storeId, storeIds),
                  gte(groomingTasks.date, dayStart),
                  lte(groomingTasks.date, dayEnd),
                ),
              )
              .orderBy(desc(groomingTasks.date));
          })()
        : Promise.resolve([]),
    ]);

    const cekBinTaskIds = cekBinRows.map((r) => r.id);

    const [availableBinRows, checkedBinRows] = await Promise.all([
      shouldLoadTask("cek_bin")
        ? db
            .select({
              id: storeBins.id,
              storeId: storeBins.storeId,
              bin: storeBins.bin,
              qtyBc: storeBins.qtyBc,
              qtySesuaiBin: storeBins.qtySesuaiBin,
              qtyTidakSesuaiBin: storeBins.qtyTidakSesuaiBin,
              nama: storeBins.nama,
            })
            .from(storeBins)
            .where(
              and(
                inArray(storeBins.storeId, storeIds),
                eq(storeBins.isActive, true),
              ),
            )
            .orderBy(asc(storeBins.storeId), asc(storeBins.bin))
        : Promise.resolve([]),

      cekBinTaskIds.length
        ? db
            .select({
              id: cekBinTaskBins.id,
              taskId: cekBinTaskBins.taskId,
              binId: cekBinTaskBins.binId,
              bin: cekBinTaskBins.bin,
              qtyBc: cekBinTaskBins.qtyBc,
              qtySesuaiBin: cekBinTaskBins.qtySesuaiBin,
              qtyTidakSesuaiBin: cekBinTaskBins.qtyTidakSesuaiBin,
              nama: cekBinTaskBins.nama,
              notes: cekBinTaskBins.notes,
            })
            .from(cekBinTaskBins)
            .where(inArray(cekBinTaskBins.taskId, cekBinTaskIds))
            .orderBy(asc(cekBinTaskBins.bin))
        : Promise.resolve([]),
    ]);

    const entriesByTaskId = new Map<number, typeof itemDroppingEntryRows>();
    for (const entry of itemDroppingEntryRows) {
      const bucket = entriesByTaskId.get(entry.taskId) ?? [];
      bucket.push(entry);
      entriesByTaskId.set(entry.taskId, bucket);
    }

    const returnEntriesByTaskId = new Map<number, typeof itemReturnEntryRows>();
    for (const entry of itemReturnEntryRows) {
      const bucket = returnEntriesByTaskId.get(entry.taskId) ?? [];
      bucket.push(entry);
      returnEntriesByTaskId.set(entry.taskId, bucket);
    }

    const uangModalDenominationsByTaskId = new Map<number, typeof cekUangModalDenominationRows>();
    for (const row of cekUangModalDenominationRows) {
      const bucket = uangModalDenominationsByTaskId.get(row.taskId) ?? [];
      bucket.push(row);
      uangModalDenominationsByTaskId.set(row.taskId, bucket);
    }

    const serahItemsByTaskId = new Map<number, typeof serahTerimaItemRows>();
    for (const item of serahTerimaItemRows) {
      const bucket = serahItemsByTaskId.get(item.taskId) ?? [];
      bucket.push(item);
      serahItemsByTaskId.set(item.taskId, bucket);
    }

    const availableBinsByStoreId = new Map<number, typeof availableBinRows>();
    for (const bin of availableBinRows) {
      const bucket = availableBinsByStoreId.get(bin.storeId) ?? [];
      bucket.push(bin);
      availableBinsByStoreId.set(bin.storeId, bucket);
    }

    const checkedBinsByTaskId = new Map<number, typeof checkedBinRows>();
    for (const bin of checkedBinRows) {
      const bucket = checkedBinsByTaskId.get(bin.taskId) ?? [];
      bucket.push(bin);
      checkedBinsByTaskId.set(bin.taskId, bucket);
    }

    const tasks = [
      ...openingRows
        .filter((r) => inStore(r.storeId))
        .map((t) => ({
          type: "store_opening" as const,
          shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
            date: t.date.toISOString(),

            loginPos: t.loginPos,
            checkAbsenSunfish: t.checkAbsenSunfish,
            tarikSohSales: t.tarikSohSales,
            fiveR: t.fiveR,

            fiveRAreaKasirPhotos: parsePhotos(t.fiveRAreaKasirPhotos),
            fiveRAreaDepanPhotos: parsePhotos(t.fiveRAreaDepanPhotos),
            fiveRAreaKananPhotos: parsePhotos(t.fiveRAreaKananPhotos),
            fiveRAreaKiriPhotos: parsePhotos(t.fiveRAreaKiriPhotos),
            fiveRAreaGudangPhotos: parsePhotos(t.fiveRAreaGudangPhotos),

            cekLamp: t.cekLamp,
            cekSoundSystem: t.cekSoundSystem,
            cashDrawerPhotos: parsePhotos(t.cashDrawerPhotos),

            loginPosBy: t.loginPosBy,
            loginPosAt: toIso(t.loginPosAt),
            checkAbsenSunfishBy: t.checkAbsenSunfishBy,
            checkAbsenSunfishAt: toIso(t.checkAbsenSunfishAt),
            tarikSohSalesBy: t.tarikSohSalesBy,
            tarikSohSalesAt: toIso(t.tarikSohSalesAt),
            fiveRBy: t.fiveRBy,
            fiveRAt: toIso(t.fiveRAt),
            fiveRAreaKasirBy: t.fiveRAreaKasirBy,
            fiveRAreaKasirAt: toIso(t.fiveRAreaKasirAt),
            fiveRAreaKasirPhotoActors: parseJsonArray(
              t.fiveRAreaKasirPhotoActors,
            ),
            fiveRAreaDepanBy: t.fiveRAreaDepanBy,
            fiveRAreaDepanAt: toIso(t.fiveRAreaDepanAt),
            fiveRAreaDepanPhotoActors: parseJsonArray(
              t.fiveRAreaDepanPhotoActors,
            ),
            fiveRAreaKananBy: t.fiveRAreaKananBy,
            fiveRAreaKananAt: toIso(t.fiveRAreaKananAt),
            fiveRAreaKananPhotoActors: parseJsonArray(
              t.fiveRAreaKananPhotoActors,
            ),
            fiveRAreaKiriBy: t.fiveRAreaKiriBy,
            fiveRAreaKiriAt: toIso(t.fiveRAreaKiriAt),
            fiveRAreaKiriPhotoActors: parseJsonArray(
              t.fiveRAreaKiriPhotoActors,
            ),
            fiveRAreaGudangBy: t.fiveRAreaGudangBy,
            fiveRAreaGudangAt: toIso(t.fiveRAreaGudangAt),
            fiveRAreaGudangPhotoActors: parseJsonArray(
              t.fiveRAreaGudangPhotoActors,
            ),
            cekLampBy: t.cekLampBy,
            cekLampAt: toIso(t.cekLampAt),
            cekSoundSystemBy: t.cekSoundSystemBy,
            cekSoundSystemAt: toIso(t.cekSoundSystemAt),
            cashDrawerBy: t.cashDrawerBy,
            cashDrawerAt: toIso(t.cashDrawerAt),
            completedBy: t.completedBy,
            completedByScheduleId: t.completedByScheduleId
              ? String(t.completedByScheduleId)
              : null,

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        })),

      ...storeFrontRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const actorSchedule = morningScheduleByStoreId.get(t.storeId);
          const actorScheduleId = actorSchedule?.id ?? t.scheduleId;
          const actorShiftId = actorSchedule?.shiftId ?? t.shiftId;
          const shift = (shiftCodeMap[actorShiftId] ?? "morning") as ShiftCode;

          return {
            type: "store_front" as const,
            shift,
            data: {
              id: String(t.id),
              // For shared store/day tasks, scheduleId must belong to the logged-in employee.
              // The original shared row schedule is kept as originalScheduleId for auditing.
              scheduleId: String(actorScheduleId),
              originalScheduleId: String(t.scheduleId),
              userId,
              assignedUserId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              storefrontPhotos: parsePhotos(t.storefrontPhotos),
              rollingDoorClosedPhoto: t.rollingDoorClosedPhoto,
              claimedBy: t.claimedBy,
              claimedAt: toIso(t.claimedAt),
              completedBy: t.completedBy,
              completedByScheduleId: t.completedByScheduleId
                ? String(t.completedByScheduleId)
                : null,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...setoranRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const actualReceivedAmount = t.expectedAmount;
          const storedAmount = t.amount;
          const previousUnpaidAmount = t.carriedDeficit;
          const requiredStoreAmount = (
            Number(actualReceivedAmount ?? 0) +
            Number(previousUnpaidAmount ?? 0)
          ).toFixed(2);

          return {
            type: "setoran" as const,
            shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
            data: {
              id: String(t.id),
              scheduleId: String(t.scheduleId),
              userId: t.userId,
              storeId: String(t.storeId),
              shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
              date: t.date.toISOString(),

              // Existing names kept for compatibility.
              amount: t.amount,
              expectedAmount: t.expectedAmount,
              carriedDeficit: t.carriedDeficit,
              carriedDeficitFetchedAt: toIso(t.carriedDeficitFetchedAt),
              unpaidAmount: t.unpaidAmount,

              // New clearer money-storage names.
              actualReceivedAmount,
              previousUnpaidAmount,
              requiredStoreAmount,
              storedAmount,

              resiPhoto: t.resiPhoto,
              atmCardSelfiePhoto: t.atmCardSelfiePhoto,

              actualReceivedAmountBy: (t as any).actualReceivedAmountBy ?? null,
              actualReceivedAmountAt: toIso((t as any).actualReceivedAmountAt),
              storedAmountBy: (t as any).storedAmountBy ?? null,
              storedAmountAt: toIso((t as any).storedAmountAt),
              resiPhotoBy: (t as any).resiPhotoBy ?? null,
              resiPhotoAt: toIso((t as any).resiPhotoAt),
              atmCardSelfiePhotoBy: (t as any).atmCardSelfiePhotoBy ?? null,
              atmCardSelfiePhotoAt: toIso((t as any).atmCardSelfiePhotoAt),
              notesBy: (t as any).notesBy ?? null,
              notesAt: toIso((t as any).notesAt),
              completedBy: (t as any).completedBy ?? null,
              completedByScheduleId: (t as any).completedByScheduleId
                ? String((t as any).completedByScheduleId)
                : null,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...cekBinRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const availableBins = (
            availableBinsByStoreId.get(t.storeId) ?? []
          ).map((bin) => ({
            id: String(bin.id),
            storeId: String(bin.storeId),
            bin: bin.bin,
            qtyBc: bin.qtyBc,
            qtySesuaiBin: bin.qtySesuaiBin,
            qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
            nama: bin.nama,
          }));

          const checkedBins = (checkedBinsByTaskId.get(t.id) ?? []).map(
            (bin) => ({
              id: String(bin.id),
              taskId: String(bin.taskId),
              binId: String(bin.binId),
              bin: bin.bin,
              qtyBc: bin.qtyBc,
              qtySesuaiBin: bin.qtySesuaiBin,
              qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin,
              nama: bin.nama,
              notes: bin.notes,
            }),
          );

          const totalStoreBins = t.totalStoreBins || availableBins.length;
          const minimumBinsToCheck =
            t.minimumBinsToCheck || Math.ceil(totalStoreBins * 0.3);
          const checkedBinsCount = t.checkedBinsCount || checkedBins.length;

          return {
            type: "cek_bin" as const,
            shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
            data: {
              id: String(t.id),
              scheduleId: String(t.scheduleId),
              userId: t.userId,
              storeId: String(t.storeId),
              shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
              date: t.date.toISOString(),

              totalStoreBins,
              minimumBinsToCheck,
              checkedBinsCount,
              availableBins,
              checkedBins,
              selectedBinIds: checkedBins.map((bin) => bin.binId),

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...vmChecklistRows
        .filter((r) => inStore(r.storeId))
        .map((t) => ({
          type: "vm_checklist" as const,
          shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
            date: t.date.toISOString(),

            shoeLaceShoeFillerPriceTagHangtagLabelK3L:
              t.shoeLaceShoeFillerPriceTagHangtagLabelK3L,
            lastPairAndPigskinHangtag: t.lastPairAndPigskinHangtag,
            popPromoUpdate: t.popPromoUpdate,
            displayTableWallShelvingShowcaseHangbarStackingPedestal:
              t.displayTableWallShelvingShowcaseHangbarStackingPedestal,
            floorDisplayCleanliness: t.floorDisplayCleanliness,
            vmToolsStorage: t.vmToolsStorage,

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        })),

      ...marketingCheckRows
        .filter((r) => inStore(r.storeId))
        .map((t) => ({
          type: "marketing_check" as const,
          shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode,
            date: t.date.toISOString(),

            promoName: t.promoName,
            promoPeriod: t.promoPeriod,
            promoMechanism: t.promoMechanism,
            randomShoeItems: t.randomShoeItems,
            randomNonShoeItems: t.randomNonShoeItems,
            sellTag: t.sellTag,

            promoNameBy: t.promoNameBy,
            promoNameAt: toIso(t.promoNameAt),
            promoPeriodBy: t.promoPeriodBy,
            promoPeriodAt: toIso(t.promoPeriodAt),
            promoMechanismBy: t.promoMechanismBy,
            promoMechanismAt: toIso(t.promoMechanismAt),
            randomShoeItemsBy: t.randomShoeItemsBy,
            randomShoeItemsAt: toIso(t.randomShoeItemsAt),
            randomNonShoeItemsBy: t.randomNonShoeItemsBy,
            randomNonShoeItemsAt: toIso(t.randomNonShoeItemsAt),
            sellTagBy: t.sellTagBy,
            sellTagAt: toIso(t.sellTagAt),
            notesBy: t.notesBy,
            notesAt: toIso(t.notesAt),
            completedBy: t.completedBy,
            completedByScheduleId: t.completedByScheduleId
              ? String(t.completedByScheduleId)
              : null,

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        })),

      ...itemDroppingRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const shift = (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode;

          const entries = (entriesByTaskId.get(t.id) ?? []).map((e) => ({
            id: String(e.id),
            taskId: String(e.taskId),
            userId: e.userId,
            storeId: String(e.storeId),
            toNumber: e.toNumber,
            quantity: e.quantity ?? 0,
            dropTime: toIso(e.dropTime),
            droppingPhotos: parsePhotos(e.droppingPhotos),
            notes: e.notes,
            createdAt: toIso(e.createdAt),
          }));

          return {
            type: "item_dropping" as const,
            shift,
            data: {
              id: String(t.id),
              scheduleId: String(t.scheduleId),
              userId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              hasDropping: t.hasDropping,
              entries,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...itemReturnRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const shift = (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode;

          const entries = (returnEntriesByTaskId.get(t.id) ?? []).map((e) => ({
            id: String(e.id),
            taskId: String(e.taskId),
            userId: e.userId,
            storeId: String(e.storeId),
            returnNumber: e.returnNumber,
            description: e.description,
            expectedAt: toIso(e.expectedAt),
            quantity: e.quantity ?? 0,
            returnTime: toIso(e.returnTime),
            returnPhotos: parsePhotos(e.returnPhotos),
            notes: e.notes,
            createdAt: toIso(e.createdAt),
          }));

          return {
            type: "item_return" as const,
            shift,
            data: {
              id: String(t.id),
              scheduleId: String(t.scheduleId),
              userId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              hasReturn: t.hasReturn,
              entries,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...cekUangModalRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const shift = (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode;

          const denominations = (uangModalDenominationsByTaskId.get(t.id) ?? []).map((d) => ({
            id: String(d.id),
            taskId: String(d.taskId),
            userId: d.userId,
            storeId: String(d.storeId),
            denominationValue: d.denominationValue,
            quantity: d.quantity ?? 0,
            amount: d.amount,
            notes: d.notes,
            createdAt: toIso(d.createdAt),
          }));

          return {
            type: "cek_uang_modal" as const,
            shift,
            data: {
              id: String(t.id),
              scheduleId: String(t.scheduleId),
              userId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              totalAmount: t.totalAmount,
              maxAmount: t.maxAmount,
              remainingAmount: t.remainingAmount,
              denominations,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...briefingRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          // Briefing is now a genuinely shift-scoped row (morning row / evening
          // row), so label + actor resolution follow the ROW's own shift, not
          // a forced "morning" default.
          const rowShiftCode = shiftCodeMap[t.shiftId] ?? "morning";
          const preferredMap =
            rowShiftCode === "evening" ? closingScheduleByStoreId : morningScheduleByStoreId;
          const actorSchedule = preferredMap.get(t.storeId);
          const actorScheduleId = actorSchedule?.id ?? t.scheduleId;
          const shift = rowShiftCode as ShiftCode;

          return {
            type: "briefing" as const,
            shift,
            data: {
              id: String(t.id),
              // Briefing is shared per store/shift/day. The row may have been
              // created by another employee on the same shift, but AccessGuard
              // checks attendance by scheduleId — send the logged-in
              // employee's own scheduleId here.
              scheduleId: String(actorScheduleId),
              originalScheduleId: String(t.scheduleId),
              userId,
              assignedUserId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              done: t.done,
              isBalanced: t.isBalanced,
              parentTaskId: t.parentTaskId,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...serahTerimaRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const items = (serahItemsByTaskId.get(t.id) ?? []).map((item) => ({
            id: String(item.id),
            taskId: String(item.taskId),
            receiverTaskId: item.receiverTaskId
              ? String(item.receiverTaskId)
              : null,
            message: item.message,
            isCompleted: item.isCompleted,
            completedBy: item.completedBy,
            completedAt: toIso(item.completedAt),
            createdAt: toIso(item.createdAt),
          }));

          // Serah Terima is now a genuinely shift-scoped row (morning row /
          // evening row), so label + actor resolution follow the ROW's own
          // shift, not a forced "morning" default.
          const rowShiftCode = shiftCodeMap[t.shiftId] ?? "morning";
          const preferredMap =
            rowShiftCode === "evening" ? closingScheduleByStoreId : morningScheduleByStoreId;
          const actorSchedule = preferredMap.get(t.storeId);
          const actorScheduleId = actorSchedule?.id ?? t.scheduleId;
          const shift = rowShiftCode as ShiftCode;

          return {
            type: "serah_terima" as const,
            shift,
            data: {
              id: String(t.id),
              // Serah Terima is shared per store/shift/day. The row may have
              // been created by another employee on the same shift, but
              // AccessGuard checks attendance by scheduleId — send the
              // logged-in employee's own scheduleId here.
              scheduleId: String(actorScheduleId),
              originalScheduleId: String(t.scheduleId),
              userId,
              assignedUserId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              handoverText: t.handoverText ?? "",
              items,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...storeClosingRows
        .filter((r) => inStore(r.storeId))
        .map((t) => {
          const actorSchedule = closingScheduleByStoreId.get(t.storeId);
          const actorScheduleId = actorSchedule?.id ?? t.scheduleId;
          const actorShiftId = actorSchedule?.shiftId ?? t.shiftId;
          const shift = (shiftCodeMap[actorShiftId] ?? "evening") as ShiftCode;

          return {
            type: "store_closing" as const,
            shift,
            data: {
              id: String(t.id),

              // IMPORTANT:
              // Store Closing is shared per store/day. The row may have been created
              // with another employee's scheduleId, but AccessGuard checks attendance
              // by scheduleId. Send the logged-in employee's own evening/full_day
              // scheduleId here, and keep the DB row schedule for audit/debug.
              scheduleId: String(actorScheduleId),
              originalScheduleId: String(t.scheduleId),
              userId,
              assignedUserId: t.userId,
              storeId: String(t.storeId),
              shift,
              date: t.date.toISOString(),

              eodZReportDone: t.eodZReportDone,
              eodZReportBy: t.eodZReportBy,
              eodZReportAt: toIso(t.eodZReportAt),

              eodEdcSettlementPhoto: t.eodEdcSettlementPhoto,
              eodEdcSettlementPhotoBy: t.eodEdcSettlementPhotoBy,
              eodEdcSettlementPhotoAt: toIso(t.eodEdcSettlementPhotoAt),

              edcSettlementDone: t.edcSettlementDone,
              edcSettlementNotes: t.edcSettlementNotes,
              edcSettlementBy: t.edcSettlementBy,
              edcSettlementAt: toIso(t.edcSettlementAt),

              edcSummaryDone: t.edcSummaryDone,
              edcSummaryNotes: t.edcSummaryNotes,
              edcSummaryBy: t.edcSummaryBy,
              edcSummaryAt: toIso(t.edcSummaryAt),

              openStatementDecision: t.openStatementDecision,
              openStatementHoldReason: t.openStatementHoldReason,
              openStatementBy: t.openStatementBy,
              openStatementAt: toIso(t.openStatementAt),

              isOnHold: t.isOnHold,
              holdIssueId: t.holdIssueId ? String(t.holdIssueId) : null,
              heldBy: t.heldBy,
              heldAt: toIso(t.heldAt),
              holdResolvedAt: toIso(t.holdResolvedAt),
              reopenedAt: toIso(t.reopenedAt),

              completedBy: t.completedBy,
              completedByScheduleId: t.completedByScheduleId
                ? String(t.completedByScheduleId)
                : null,

              status: t.status,
              notes: t.notes,
              completedAt: toIso(t.completedAt),
              verifiedBy: t.verifiedBy,
              verifiedAt: toIso(t.verifiedAt),
            },
          };
        }),

      ...groomingRows.map((t) => {
        const code = (shiftCodeMap[t.shiftId] ?? "morning") as ShiftCode;

        return {
          type: "grooming" as const,
          shift: code,
          data: {
            id: String(t.id),
            scheduleId: String(t.scheduleId),
            userId: t.userId,
            storeId: String(t.storeId),
            shift: code,
            date: t.date.toISOString(),

            uniformActive: t.uniformActive,
            hairActive: t.hairActive,
            smellActive: t.smellActive,
            makeUpActive: t.makeUpActive,
            shoeActive: t.shoeActive,
            nameTagActive: t.nameTagActive,

            uniformChecked: t.uniformChecked,
            hairChecked: t.hairChecked,
            smellChecked: t.smellChecked,
            makeUpChecked: t.makeUpChecked,
            shoeChecked: t.shoeChecked,
            nameTagChecked: t.nameTagChecked,

            selfiePhotos: parsePhotos(t.selfiePhotos),

            status: t.status,
            notes: t.notes,
            completedAt: toIso(t.completedAt),
            verifiedBy: t.verifiedBy,
            verifiedAt: toIso(t.verifiedAt),
          },
        };
      }),
    ];

    const visibleTasks = tasks.filter((task) => {
      if (!allowedTaskTypes.has(task.type)) return false;

      return taskAllowedForEmployeeShift(
        task.type,
        task.shift,
        shiftCodesRaw,
        shiftTaskMap,
      );
    });

    const STATUS_ORDER: Record<string, number> = {
      not_started: 0,
      in_progress: 1,
      pending: 2,
      completed: 3,
      verified: 4,
      rejected: 5,
    };

    const SHIFT_ORDER: Record<string, number> = {
      morning: 0,
      full_day: 1,
      evening: 2,
    };

    visibleTasks.sort((a, b) => {
      const statusSort =
        (STATUS_ORDER[a.data.status] ?? 9) - (STATUS_ORDER[b.data.status] ?? 9);

      if (statusSort !== 0) return statusSort;

      return (SHIFT_ORDER[a.shift] ?? 9) - (SHIFT_ORDER[b.shift] ?? 9);
    });

    return NextResponse.json({
      success: true,
      tasks: visibleTasks,
      shift: primaryShift,
      shifts: shiftCodesRaw,
      scheduleIds,
      shiftTaskMap,
      shiftTaskRequired,
      shiftTaskSequenced,
      assignedTaskTypes: [...allowedTaskTypes],
      unsupportedTaskDefinitions,
    });
  } catch (error) {
    console.error("[GET /api/employee/tasks]", error);
    return NextResponse.json(
      { success: false, error: "Failed to load employee tasks." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    const { taskId, taskType, status } = (await request.json()) as {
      taskId: string;
      taskType: string;
      status: string;
    };

    if (!taskId || !taskType || status !== "in_progress") {
      return NextResponse.json(
        { error: "taskId, taskType, and status=in_progress are required" },
        { status: 400 },
      );
    }

    const id = parseInt(taskId, 10);

    if (Number.isNaN(id)) {
      return NextResponse.json(
        { error: "taskId must be a number" },
        { status: 400 },
      );
    }

    const SHARED_TABLES: Record<
      string,
      {
        getRow: (id: number) => Promise<{ status: string | null } | undefined>;
        update: (id: number) => Promise<void>;
      }
    > = {
      store_opening: {
        getRow: async (id) =>
          (
            await db
              .select({ status: storeOpeningTasks.status })
              .from(storeOpeningTasks)
              .where(eq(storeOpeningTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(storeOpeningTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(storeOpeningTasks.id, id))
            .then(() => {}),
      },

      setoran: {
        getRow: async (id) =>
          (
            await db
              .select({ status: setoranTasks.status })
              .from(setoranTasks)
              .where(eq(setoranTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(setoranTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(setoranTasks.id, id))
            .then(() => {}),
      },

      cek_bin: {
        getRow: async (id) =>
          (
            await db
              .select({ status: cekBinTasks.status })
              .from(cekBinTasks)
              .where(eq(cekBinTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(cekBinTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(cekBinTasks.id, id))
            .then(() => {}),
      },

      vm_checklist: {
        getRow: async (id) =>
          (
            await db
              .select({ status: vmChecklistTasks.status })
              .from(vmChecklistTasks)
              .where(eq(vmChecklistTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(vmChecklistTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(vmChecklistTasks.id, id))
            .then(() => {}),
      },

      marketing_check: {
        getRow: async (id) =>
          (
            await db
              .select({ status: marketingCheckTasks.status })
              .from(marketingCheckTasks)
              .where(eq(marketingCheckTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(marketingCheckTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(marketingCheckTasks.id, id))
            .then(() => {}),
      },

      item_dropping: {
        getRow: async (id) =>
          (
            await db
              .select({ status: itemDroppingTasks.status })
              .from(itemDroppingTasks)
              .where(eq(itemDroppingTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(itemDroppingTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(itemDroppingTasks.id, id))
            .then(() => {}),
      },

      item_return: {
        getRow: async (id) =>
          (
            await db
              .select({ status: itemReturnTasks.status })
              .from(itemReturnTasks)
              .where(eq(itemReturnTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(itemReturnTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(itemReturnTasks.id, id))
            .then(() => {}),
      },

      cek_uang_modal: {
        getRow: async (id) =>
          (
            await db
              .select({ status: cekUangModalTasks.status })
              .from(cekUangModalTasks)
              .where(eq(cekUangModalTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(cekUangModalTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(cekUangModalTasks.id, id))
            .then(() => {}),
      },

      serah_terima: {
        getRow: async (id) =>
          (
            await db
              .select({ status: serahTerimaTasks.status })
              .from(serahTerimaTasks)
              .where(eq(serahTerimaTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(serahTerimaTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(serahTerimaTasks.id, id))
            .then(() => {}),
      },

      briefing: {
        getRow: async (id) =>
          (
            await db
              .select({ status: briefingTasks.status })
              .from(briefingTasks)
              .where(eq(briefingTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(briefingTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(briefingTasks.id, id))
            .then(() => {}),
      },

      store_closing: {
        getRow: async (id) =>
          (
            await db
              .select({ status: storeClosingTasks.status })
              .from(storeClosingTasks)
              .where(eq(storeClosingTasks.id, id))
              .limit(1)
          )[0],

        update: (id) =>
          db
            .update(storeClosingTasks)
            .set({ status: "in_progress", updatedAt: new Date() })
            .where(eq(storeClosingTasks.id, id))
            .then(() => {}),
      },
    };

    if (taskType === "store_front") {
      const [task] = await db
        .select({
          id: storeFrontTasks.id,
          storeId: storeFrontTasks.storeId,
          date: storeFrontTasks.date,
          status: storeFrontTasks.status,
        })
        .from(storeFrontTasks)
        .where(eq(storeFrontTasks.id, id))
        .limit(1);

      if (!task) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      if (task.status !== "not_started" && task.status !== "in_progress") {
        return NextResponse.json({ success: true });
      }

      const [ownSchedule] = await db
        .select({ id: schedules.id })
        .from(schedules)
        .where(
          and(
            eq(schedules.userId, userId),
            eq(schedules.storeId, task.storeId),
            eq(schedules.isHoliday, false),
            gte(schedules.date, startOfDay(task.date)),
            lte(schedules.date, endOfDay(task.date)),
          ),
        )
        .limit(1);

      if (!ownSchedule) {
        return NextResponse.json(
          { error: "No matching schedule for this employee." },
          { status: 403 },
        );
      }

      const claimed = await claimStoreFrontTask({
        taskId: id,
        userId,
        scheduleId: ownSchedule.id,
      });

      if (!claimed.success) {
        return NextResponse.json({ error: claimed.error }, { status: 400 });
      }

      return NextResponse.json({ success: true });
    }

    if (taskType === "grooming") {
      const [row] = await db
        .select({ userId: groomingTasks.userId, status: groomingTasks.status })
        .from(groomingTasks)
        .where(eq(groomingTasks.id, id))
        .limit(1);

      if (!row) {
        return NextResponse.json({ error: "Task not found" }, { status: 404 });
      }

      if (row.userId !== userId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (row.status !== "not_started") {
        return NextResponse.json({ success: true });
      }

      await db
        .update(groomingTasks)
        .set({ status: "in_progress", updatedAt: new Date() })
        .where(eq(groomingTasks.id, id));

      return NextResponse.json({ success: true });
    }

    const handler = SHARED_TABLES[taskType];

    if (!handler) {
      return NextResponse.json(
        { error: `Unknown taskType: ${taskType}` },
        { status: 400 },
      );
    }

    const row = await handler.getRow(id);

    if (!row) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (row.status !== "not_started") {
      return NextResponse.json({ success: true });
    }

    await handler.update(id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[PATCH /api/employee/tasks]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update employee task." },
      { status: 500 },
    );
  }
}
