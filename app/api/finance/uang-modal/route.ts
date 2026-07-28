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
  stores,
  areas,
  users,
  type CekUangModalTask,
} from '@/lib/db/schema';
import { CEK_UANG_MODAL_MAX_TOTAL } from '@/lib/db/utils/cek-uang-modal';
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

  status: 'not_started' | 'in_progress' | 'completed' | 'pending';

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
  /** Stores with a task created but not completed (not_started/in_progress) */
  pendingCount: number;
  /** Total stores expected to report (all stores with a task row that day) */
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

    // ── 2. Resolve stores + areas referenced ───────────────────────────────────
    const storeIds = [...new Set(taskRows.map((t) => t.storeId))];

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

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(start.getFullYear(), start.getMonth(), day);
      const dateStr = toDateStr(d);
      const dayTasks = tasksByDate.get(dateStr) ?? [];

      const completedTasks = dayTasks.filter((t) => t.status === 'completed');
      const pendingTasks   = dayTasks.filter((t) => t.status === 'not_started' || t.status === 'in_progress');

      const totalAmount = completedTasks.reduce((sum, t) => sum + Number(t.totalAmount), 0);

      const cell: UangModalDayCell = {
        date:            dateStr,
        dayOfMonth:      day,
        totalAmount,
        submittedCount:  completedTasks.length,
        pendingCount:    pendingTasks.length,
        totalStoreCount: dayTasks.length,
        hasData:         dayTasks.length > 0,
      };
      days.push(cell);

      const storeEntries: UangModalStoreEntry[] = dayTasks
        .map((t) => {
          const store = storeMap.get(t.storeId);
          return {
            taskId:            t.id,
            storeId:           t.storeId,
            storeName:         store?.name    ?? `Store ${t.storeId}`,
            storeNo:           store?.storeNo ?? '—',
            areaName:          store?.areaName ?? '—',

            status:            t.status,

            totalAmount:       Number(t.totalAmount),
            maxAmount:         Number(t.maxAmount),
            remainingAmount:   Number(t.remainingAmount),

            submittedBy:       userName(t.userId),
            submittedByUserId: t.userId,
            completedAt:       t.completedAt ? t.completedAt.toISOString() : null,
            notes:             t.notes,

            denominations:     denomByTask.get(t.id) ?? [],
          } satisfies UangModalStoreEntry;
        })
        .sort((a, b) => a.storeName.localeCompare(b.storeName, 'id'));

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