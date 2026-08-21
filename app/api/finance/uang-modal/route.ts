// app/api/finance/uang-modal/route.ts
//
// GET /api/finance/uang-modal?month=YYYY-MM&storeId=optional
//
// Returns a calendar-month summary of Cek Uang Modal (cashier opening float)
// submissions across all stores, for the "Daily Uang Modal" finance page.
//
//   • One row per calendar day in the requested month
//   • Each day aggregates totalAmount across all stores/tasks submitted that day
//   • Per-day breakdown by store (used when a day card is clicked)
//   • Auth: finance role or admin only (resolveFinanceScope)

import { NextResponse } from 'next/server';
import { and, eq, gte, lt, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import {
  cekUangModalTasks,
  cekUangModalDenominations,
  schedules,
  stores,
  areas,
  users,
  type CekUangModalTask,
} from '@/lib/db/schema';
import { CEK_UANG_MODAL_MAX_TOTAL } from '@/lib/db/utils/cek-uang-modal';
import { getMorningShiftId, getFullDayShiftId } from '@/lib/db/utils/shift-lookup';
import { resolveFinanceScope } from '@/lib/finance/scope';

// ─── Response types ───────────────────────────────────────────────────────────

export interface UangModalDenominationRow {
  denominationValue: number;
  quantity: number;
  amount: number;
}

export interface UangModalStoreEntry {
  taskId: number;
  storeId: number;
  storeName: string;
  storeNo: string;
  areaName: string;

  /**
   * 'pending' means the store was scheduled to report (morning/full-day
   * shift) for a day that has already ended, and no completed task exists —
   * i.e. the employee didn't do it. That's the only status the finance page
   * renders in red. 'not_started'/'in_progress' are only used for today,
   * while the day is still ongoing.
   */
  status: 'not_started' | 'in_progress' | 'completed' | 'pending';
  /** True when no task row exists at all — synthesized purely from the schedule. */
  isMissing: boolean;

  totalAmount: number;
  maxAmount: number;
  remainingAmount: number;

  submittedBy: string | null;
  submittedByUserId: string | null;
  completedAt: string | null;
  notes: string | null;

  denominations: UangModalDenominationRow[];
}

export interface UangModalDayCell {
  /** YYYY-MM-DD */
  date: string;
  dayOfMonth: number;
  /** Sum of totalAmount across every store's completed task that day */
  totalAmount: number;
  /** Stores that submitted (status completed) */
  submittedCount: number;
  /** Stores with a task created but not completed (not_started/in_progress) — only possible for today */
  pendingCount: number;
  /** Stores scheduled to report that day but didn't — day already ended (red) */
  notDoneCount: number;
  /** Total stores expected to report that day (scheduled morning/full-day shift) */
  totalStoreCount: number;
  hasData: boolean;
}

export interface UangModalDayDetail extends UangModalDayCell {
  stores: UangModalStoreEntry[];
}

export interface UangModalMonthResponse {
  success: true;
  month: string; // YYYY-MM
  maxAmountPerStore: number;
  days: UangModalDayCell[];
  /** Full per-store breakdown for every day — page can index by date client-side */
  detail: Record<string, UangModalDayDetail>;
}

export interface UangModalErrorResponse {
  success: false;
  error: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function toDateStr(d: Date): string {
  return startOfDay(d).toISOString().slice(0, 10);
}

function getMonthRange(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

function getDaysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/** "Today" in Jakarta time — a day only counts as fully over (and thus
 * eligible for a red "not done") once it's actually past in the timezone
 * the stores operate in, not the server's own clock. */
function jakartaTodayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year  = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day   = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(
  request: Request,
): Promise<NextResponse<UangModalMonthResponse | UangModalErrorResponse>> {
  try {
    const scope = await resolveFinanceScope();
    if (!scope.ok) {
      return NextResponse.json(
        { success: false, error: scope.error },
        { status: scope.status },
      );
    }

    const { searchParams } = new URL(request.url);
    const monthParam   = searchParams.get('month');
    const storeIdParam = searchParams.get('storeId');

    const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : new Date().toISOString().slice(0, 7);

    const { start, end } = getMonthRange(month);
    const daysInMonth = getDaysInMonth(month);

    // ── 1. Fetch all cek_uang_modal tasks in this month ────────────────────────
    const taskRows = await db
      .select()
      .from(cekUangModalTasks)
      .where(
        and(
          gte(cekUangModalTasks.date, start),
          lt(cekUangModalTasks.date, end),
          storeIdParam ? eq(cekUangModalTasks.storeId, Number(storeIdParam)) : undefined,
        ),
      );

    // ── 1b. Fetch which stores were even scheduled to report that day ─────────
    // A store only "owes" a Cek Uang Modal for a day if someone had a
    // morning/full-day shift there — that's exactly when a task row gets
    // created (see getOrCreateCekUangModalForSchedule). Without this, a store
    // that never opened the task at all (no row ever created) would be
    // invisible instead of flagged as not done.
    const morningShiftId  = await getMorningShiftId();
    const fullDayShiftId  = await getFullDayShiftId();

    const scheduleRows = await db
      .select({ storeId: schedules.storeId, date: schedules.date })
      .from(schedules)
      .where(
        and(
          gte(schedules.date, start),
          lt(schedules.date, end),
          inArray(schedules.shiftId, [morningShiftId, fullDayShiftId]),
          eq(schedules.isHoliday, false),
          storeIdParam ? eq(schedules.storeId, Number(storeIdParam)) : undefined,
        ),
      );

    const expectedByDate = new Map<string, Set<number>>();
    for (const s of scheduleRows) {
      const dateStr = toDateStr(s.date);
      if (!expectedByDate.has(dateStr)) expectedByDate.set(dateStr, new Set());
      expectedByDate.get(dateStr)!.add(s.storeId);
    }

    // ── 2. Resolve stores + areas referenced ───────────────────────────────────
    const storeIds = [
      ...new Set([...taskRows.map((t) => t.storeId), ...scheduleRows.map((s) => s.storeId)]),
    ];

    const storeRows = storeIds.length > 0
      ? await db
          .select({
            id:       stores.id,
            name:     stores.name,
            storeNo:  stores.storeNo,
            areaName: areas.name,
          })
          .from(stores)
          .innerJoin(areas, eq(areas.id, stores.areaId))
          .where(inArray(stores.id, storeIds))
      : [];

    const storeMap = new Map(storeRows.map((s) => [s.id, s]));

    // ── 3. Resolve submitter display names ─────────────────────────────────────
    const actorIds = [
      ...new Set(taskRows.map((t) => t.userId).filter(Boolean)),
    ] as string[];

    const userRows = actorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];

    const userMap = new Map(userRows.map((u) => [u.id, u.name]));
    const userName = (id: string | null | undefined) =>
      id ? (userMap.get(id) ?? id) : null;

    // ── 4. Fetch all denomination rows for these tasks ────────────────────────
    const taskIds = taskRows.map((t) => t.id);

    const denomRows = taskIds.length > 0
      ? await db
          .select()
          .from(cekUangModalDenominations)
          .where(inArray(cekUangModalDenominations.taskId, taskIds))
      : [];

    const denomByTask = new Map<number, UangModalDenominationRow[]>();
    for (const d of denomRows) {
      if (!denomByTask.has(d.taskId)) denomByTask.set(d.taskId, []);
      denomByTask.get(d.taskId)!.push({
        denominationValue: d.denominationValue,
        quantity:          d.quantity,
        amount:            Number(d.amount),
      });
    }
    // Sort each task's denominations descending by value (100rb → 100)
    for (const rows of denomByTask.values()) {
      rows.sort((a, b) => b.denominationValue - a.denominationValue);
    }

    // ── 5. Group tasks by date string ──────────────────────────────────────────
    const tasksByDate = new Map<string, CekUangModalTask[]>();
    for (const t of taskRows) {
      const dateStr = toDateStr(t.date);
      if (!tasksByDate.has(dateStr)) tasksByDate.set(dateStr, []);
      tasksByDate.get(dateStr)!.push(t);
    }

    // ── 6. Build day cells + detail for every day in the month ────────────────
    const days: UangModalDayCell[] = [];
    const detail: Record<string, UangModalDayDetail> = {};
    const todayStr = jakartaTodayStr();

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(start.getFullYear(), start.getMonth(), day);
      const dateStr = toDateStr(d);
      const dayTasks = tasksByDate.get(dateStr) ?? [];
      const taskByStore = new Map(dayTasks.map((t) => [t.storeId, t]));

      // A day only "grades" stores once it has actually ended — a store
      // still mid-shift today isn't flagged red just because it hasn't
      // finished yet, and a future scheduled day has nothing to grade at all.
      const dayHasEnded = dateStr < todayStr;
      const expectedStoreIds = dateStr <= todayStr ? expectedByDate.get(dateStr) ?? new Set<number>() : new Set<number>();

      const allStoreIds = new Set<number>([...taskByStore.keys(), ...expectedStoreIds]);

      const storeEntries: UangModalStoreEntry[] = [...allStoreIds]
        .map((storeId) => {
          const store = storeMap.get(storeId);
          const t = taskByStore.get(storeId);

          const baseInfo = {
            storeId,
            storeName: store?.name ?? `Store ${storeId}`,
            storeNo:   store?.storeNo ?? '—',
            areaName:  store?.areaName ?? '—',
          };

          if (t) {
            // Task row exists — completed stays completed; anything else
            // (not_started/in_progress) only turns red once the day's over.
            const status = t.status === 'completed'
              ? 'completed'
              : dayHasEnded ? 'pending' : t.status;

            return {
              ...baseInfo,
              taskId: t.id,
              status,
              isMissing: false,

              totalAmount:     Number(t.totalAmount),
              maxAmount:       Number(t.maxAmount),
              remainingAmount: Number(t.remainingAmount),

              submittedBy:       userName(t.userId),
              submittedByUserId: t.userId,
              completedAt:       t.completedAt ? t.completedAt.toISOString() : null,
              notes:             t.notes,

              denominations: denomByTask.get(t.id) ?? [],
            } satisfies UangModalStoreEntry;
          }

          // No task row at all — scheduled to report, but the employee never
          // even opened the task. Red once the day's over; a quiet
          // "not started" placeholder while today is still in progress.
          return {
            ...baseInfo,
            taskId: -storeId, // synthetic — no real row backs this entry
            status: dayHasEnded ? 'pending' : 'not_started',
            isMissing: true,

            totalAmount:     0,
            maxAmount:       CEK_UANG_MODAL_MAX_TOTAL,
            remainingAmount: CEK_UANG_MODAL_MAX_TOTAL,

            submittedBy:       null,
            submittedByUserId: null,
            completedAt:       null,
            notes:             null,

            denominations: [],
          } satisfies UangModalStoreEntry;
        })
        .sort((a, b) => a.storeName.localeCompare(b.storeName, 'id'));

      const submittedCount = storeEntries.filter((e) => e.status === 'completed').length;
      const notDoneCount   = storeEntries.filter((e) => e.status === 'pending').length;
      const pendingCount   = storeEntries.filter((e) => e.status === 'not_started' || e.status === 'in_progress').length;
      const totalAmount    = storeEntries.reduce((sum, e) => sum + (e.status === 'completed' ? e.totalAmount : 0), 0);

      const cell: UangModalDayCell = {
        date:            dateStr,
        dayOfMonth:      day,
        totalAmount,
        submittedCount,
        pendingCount,
        notDoneCount,
        totalStoreCount: storeEntries.length,
        hasData:         storeEntries.length > 0,
      };
      days.push(cell);

      detail[dateStr] = { ...cell, stores: storeEntries };
    }

    return NextResponse.json({
      success:           true,
      month,
      maxAmountPerStore: CEK_UANG_MODAL_MAX_TOTAL,
      days,
      detail,
    });
  } catch (err) {
    console.error('[GET /api/finance/uang-modal]', err);
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 },
    );
  }
}