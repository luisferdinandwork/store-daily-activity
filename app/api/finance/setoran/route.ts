// app/api/finance/setoran/route.ts
//
// GET /api/finance/setoran?date=YYYY-MM-DD
//
// Returns one SetoranStoreRow per store that has a morning/full_day schedule
// on the requested day, enriched with:
//   • the setoran task (pending/in_progress/completed) if it exists
//   • the money-storage ledger entry if the task was submitted
//   • the prior-day unpaid carry-forward even when no task exists yet
//   • resolved display names for all actor user IDs
//   • area name joined from the `areas` table via stores.areaId

import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  schedules,
  stores,
  users,
  areas,
  setoranTasks,
  setoranMoneyStorage,
} from '@/lib/db/schema';
import { shifts } from '@/lib/db/schema/lookups';
import { getPriorUnpaidForStore } from '@/lib/db/utils/setoran';

// ─── Public response types ────────────────────────────────────────────────────
//
// Imported by the page component so types stay in sync with the API.

export interface SetoranTransactionEntry {
  /** setoranMoneyStorage.id */
  id: number;
  description: string;
  /** display name of the person who submitted */
  submittedBy: string;
  submittedByUserId: string;
  /** setoranMoneyStorage.storedAmount */
  amount: string;
  /** ISO string or null */
  verifiedAt: string | null;
  /** display name of the finance reviewer, or null */
  verifiedBy: string | null;
  /** true when status === 'completed' and verifiedAt is null */
  canVerify: boolean;
}

export interface SetoranStoreRow {
  storeId: number;
  storeName: string;
  storeNo: string;
  areaName: string;

  /** null when no setoranTask exists yet for this day */
  taskId: number | null;

  /**
   * 'no_data' is a UI-only concept — the task table uses taskStatusEnum
   * ('pending' | 'in_progress' | 'completed' | 'discrepancy').
   * We add 'no_data' here for stores that have a schedule but no task row yet.
   */
  status: 'pending' | 'in_progress' | 'completed' | 'discrepancy' | 'no_data';

  // ── Money fields — all null when task/storage doesn't exist yet ──────────
  /** From setoranMoneyStorage.actualReceivedAmount, falls back to task.expectedAmount */
  actualReceivedAmount: string | null;
  /** From setoranMoneyStorage.previousUnpaidAmount, falls back to task.carriedDeficit */
  previousUnpaidAmount: string | null;
  /** From setoranMoneyStorage.requiredStoreAmount (only available after submit) */
  requiredStoreAmount: string | null;
  /** From setoranMoneyStorage.storedAmount, falls back to task.amount */
  storedAmount: string | null;
  /** From setoranMoneyStorage.unpaidAmount, falls back to task.unpaidAmount */
  unpaidAmount: string | null;

  /**
   * Carry-forward fetched directly via getPriorUnpaidForStore.
   * Always present — '0.00' when there is no prior unpaid balance.
   * For pending/in_progress tasks this may differ from task.carriedDeficit
   * if another store paid something yesterday.
   */
  priorCarryForward: string;

  // ── Evidence photos ───────────────────────────────────────────────────────
  resiPhoto: string | null;
  atmCardSelfiePhoto: string | null;

  // ── Submission actor trail ────────────────────────────────────────────────
  /** Display name of task.completedBy user */
  submittedBy: string | null;
  submittedByUserId: string | null;
  /** ISO string */
  completedAt: string | null;
  notes: string | null;

  /** Display name of task.actualReceivedAmountBy */
  actualReceivedAmountBy: string | null;
  actualReceivedAmountAt: string | null;
  /** Display name of task.storedAmountBy */
  storedAmountBy: string | null;
  storedAmountAt: string | null;

  // ── Staff scheduled for that day (morning/full_day shifts only) ───────────
  scheduledStaff: { userId: string; name: string; scheduleId: number }[];

  // ── Transaction entries ───────────────────────────────────────────────────
  transactions: SetoranTransactionEntry[];
}

export interface SetoranDayResponse {
  success: true;
  date: string;
  data: SetoranStoreRow[];
}

export interface SetoranErrorResponse {
  success: false;
  error: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

/** Safely formats a DB decimal value for the response. Returns null for empty/null. */
function fmtMoney(v: string | number | null | undefined): string | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

function isoOrNull(d: Date | null | undefined): string | null {
  return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
): Promise<NextResponse<SetoranDayResponse | SetoranErrorResponse>> {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');

    // Parse date — default to today when omitted
    const rawDate = dateParam ? new Date(dateParam) : new Date();
    if (isNaN(rawDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid date parameter. Expected YYYY-MM-DD.' },
        { status: 400 },
      );
    }
    const dayStart = startOfDay(rawDate);
    // YYYY-MM-DD string for the response envelope
    const dateStr = dayStart.toISOString().slice(0, 10);

    // ── 1. Find morning/full_day schedules for this day ───────────────────────
    //
    // We join schedules → shifts so we can filter by shift.code without a
    // separate lookup. Only 'morning' and 'full_day' shifts own a setoran task.

    const morningScheduleRows = await db
      .select({
        scheduleId: schedules.id,
        userId:     schedules.userId,
        storeId:    schedules.storeId,
        shiftCode:  shifts.code,
      })
      .from(schedules)
      .innerJoin(shifts, eq(shifts.id, schedules.shiftId))
      .where(
        and(
          eq(schedules.date, dayStart),
          inArray(shifts.code, ['morning', 'full_day']),
        ),
      );

    if (morningScheduleRows.length === 0) {
      return NextResponse.json({ success: true, date: dateStr, data: [] });
    }

    const storeIds = [...new Set(morningScheduleRows.map((r) => r.storeId))];
    const staffUserIds = [...new Set(morningScheduleRows.map((r) => r.userId))];

    // ── 2. Bulk-fetch stores + their areas ────────────────────────────────────
    //
    // stores.areaId → areas.id → areas.name
    // We join here so we don't need a separate areas query.

    const storeRows = await db
      .select({
        id:      stores.id,
        name:    stores.name,
        storeNo: stores.storeNo,
        areaId:  stores.areaId,
        areaName: areas.name,
      })
      .from(stores)
      .innerJoin(areas, eq(areas.id, stores.areaId))
      .where(inArray(stores.id, storeIds));

    // keyed by storeId for O(1) lookup
    const storeMap = new Map(storeRows.map((s) => [s.id, s]));

    // ── 3. Bulk-fetch display names for scheduled staff ───────────────────────

    const staffRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, staffUserIds));

    // We'll grow this map later with actor IDs found in task/storage rows
    const userNameMap = new Map(staffRows.map((u) => [u.id, u.name]));

    // ── 4. Bulk-fetch today's setoran tasks + money storage for these stores ──

    const [taskRows, storageRows] = await Promise.all([
      db
        .select()
        .from(setoranTasks)
        .where(
          and(
            inArray(setoranTasks.storeId, storeIds),
            eq(setoranTasks.date, dayStart),
          ),
        ),
      db
        .select()
        .from(setoranMoneyStorage)
        .where(
          and(
            inArray(setoranMoneyStorage.storeId, storeIds),
            eq(setoranMoneyStorage.date, dayStart),
          ),
        ),
    ]);

    // ── 5. Resolve any actor user IDs not already in userNameMap ─────────────

    const actorIds = [
      ...new Set(
        [
          ...taskRows.flatMap((t) => [
            t.completedBy,
            t.verifiedBy,
            t.actualReceivedAmountBy,
            t.storedAmountBy,
            t.resiPhotoBy,
            t.atmCardSelfiePhotoBy,
          ]),
          ...storageRows.map((s) => s.completedBy),
        ].filter((id): id is string => typeof id === 'string' && !userNameMap.has(id)),
      ),
    ];

    if (actorIds.length > 0) {
      const actorRows = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, actorIds));
      for (const u of actorRows) userNameMap.set(u.id, u.name);
    }

    const userName = (id: string | null | undefined): string | null => {
      if (!id) return null;
      return userNameMap.get(id) ?? id; // fall back to raw ID if user row missing
    };

    // ── 6. Index tasks and storage by storeId ─────────────────────────────────

    const taskByStore    = new Map(taskRows.map((t) => [t.storeId, t]));
    const storageByStore = new Map(storageRows.map((s) => [s.storeId, s]));

    // ── 7. Fetch prior carry-forwards for stores that have no task yet ────────
    //
    // For stores that already have a task, task.carriedDeficit is the cached
    // carry-forward (kept fresh by refreshPendingCarryForward). We still call
    // getPriorUnpaidForStore for stores with no task row so the UI can show
    // what will carry in once the task is created.

    const storesWithoutTask = storeIds.filter((id) => !taskByStore.has(id));

    const carryForwardMap = new Map<number, string>();
    await Promise.all(
      storesWithoutTask.map(async (storeId) => {
        const carry = await getPriorUnpaidForStore(storeId, dayStart);
        carryForwardMap.set(storeId, carry);
      }),
    );

    // ── 8. Group scheduled staff by store ─────────────────────────────────────

    const staffByStore = new Map<
      number,
      { userId: string; name: string; scheduleId: number }[]
    >();
    for (const row of morningScheduleRows) {
      if (!staffByStore.has(row.storeId)) staffByStore.set(row.storeId, []);
      staffByStore.get(row.storeId)!.push({
        userId:     row.userId,
        name:       userName(row.userId) ?? row.userId,
        scheduleId: row.scheduleId,
      });
    }

    // ── 9. Build response ─────────────────────────────────────────────────────

    const data: SetoranStoreRow[] = storeIds.map((storeId) => {
      const store   = storeMap.get(storeId);
      const task    = taskByStore.get(storeId);
      const storage = storageByStore.get(storeId);
      const staff   = staffByStore.get(storeId) ?? [];

      // The carry-forward to show:
      //   • task exists  → use task.carriedDeficit (kept up to date by the util)
      //   • no task yet  → use the value we just fetched
      const priorCarryForward =
        task?.carriedDeficit != null
          ? fmtMoney(task.carriedDeficit) ?? '0.00'
          : (carryForwardMap.get(storeId) ?? '0.00');

      // Map task status to our extended status type
      const status: SetoranStoreRow['status'] = task
        ? (task.status as 'pending' | 'in_progress' | 'completed' | 'discrepancy')
        : 'no_data';

      // Money fields: prefer the ledger (storage) over the task draft columns
      // because storage is written atomically on submit and is the source of truth.
      const actualReceivedAmount = fmtMoney(storage?.actualReceivedAmount ?? task?.expectedAmount);
      const previousUnpaidAmount = fmtMoney(storage?.previousUnpaidAmount ?? task?.carriedDeficit);
      const requiredStoreAmount  = fmtMoney(storage?.requiredStoreAmount); // only in storage
      const storedAmount         = fmtMoney(storage?.storedAmount ?? task?.amount);
      const unpaidAmount         = fmtMoney(storage?.unpaidAmount ?? task?.unpaidAmount);

      // Build transaction entries.
      // The current model writes one ledger row per submitted setoran.
      // Extend this array if you ever support multi-entry setoran.
      const transactions: SetoranTransactionEntry[] = [];
      if (storage) {
        transactions.push({
          id:                 storage.id,
          description:        'Setoran harian',
          submittedBy:        userName(storage.completedBy) ?? '—',
          submittedByUserId:  storage.completedBy ?? '',
          amount:             storage.storedAmount,
          // verification lives on the task row (setoranMoneyStorage has no verifiedAt)
          verifiedAt:         isoOrNull(task?.verifiedAt),
          verifiedBy:         userName(task?.verifiedBy),
          canVerify:          task?.status === 'completed' && !task.verifiedAt,
        });
      }

      return {
        storeId,
        storeName:  store?.name    ?? `Store ${storeId}`,
        storeNo:    store?.storeNo ?? '—',
        areaName:   store?.areaName ?? '—',

        taskId: task?.id ?? null,
        status,

        actualReceivedAmount,
        previousUnpaidAmount,
        requiredStoreAmount,
        storedAmount,
        unpaidAmount,

        priorCarryForward,

        resiPhoto:          task?.resiPhoto          ?? null,
        atmCardSelfiePhoto: task?.atmCardSelfiePhoto  ?? null,

        submittedBy:       userName(task?.completedBy),
        submittedByUserId: task?.completedBy ?? null,
        completedAt:       isoOrNull(task?.completedAt),
        notes:             task?.notes ?? null,

        actualReceivedAmountBy: userName(task?.actualReceivedAmountBy),
        actualReceivedAmountAt: isoOrNull(task?.actualReceivedAmountAt),
        storedAmountBy:         userName(task?.storedAmountBy),
        storedAmountAt:         isoOrNull(task?.storedAmountAt),

        scheduledStaff: staff,
        transactions,
      };
    });

    // Sort priority: discrepancy → unpaid-completed → in_progress → pending → completed → no_data
    const SORT_ORDER: Record<SetoranStoreRow['status'], number> = {
      discrepancy: 0,
      completed:   1, // within completed, unpaid goes first (secondary sort below)
      in_progress: 2,
      pending:     3,
      no_data:     4,
    };

    data.sort((a, b) => {
      const ao = SORT_ORDER[a.status];
      const bo = SORT_ORDER[b.status];
      if (ao !== bo) return ao - bo;
      // Both completed — put unpaid balance stores first
      if (a.status === 'completed' && b.status === 'completed') {
        return Number(b.unpaidAmount ?? 0) - Number(a.unpaidAmount ?? 0);
      }
      return a.storeName.localeCompare(b.storeName, 'id');
    });

    return NextResponse.json({ success: true, date: dateStr, data });
  } catch (err) {
    console.error('[GET /api/finance/setoran]', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}