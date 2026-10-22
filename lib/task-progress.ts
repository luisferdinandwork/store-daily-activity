// lib/task-progress.ts
//
// View logic for the IT "Task Progress" pages (/it/task-progress): for ONE task,
// where does every store stand on a day — and which stores need attention first.
// Pure + client-safe; the data comes from lib/db/utils/task-progress.ts.

import { SHIFT_LABELS, TASK_CATALOG, type ShiftCode, type TaskCatalogEntry } from '@/lib/shift-tasks';
import { jakartaTodayKey } from '@/lib/day-bucket';

// ─── Shapes shared by the API and the pages ──────────────────────────────────

export interface TaskProgressSlot {
  key: string;
  /** Task row id — null while nobody has opened the task (a scheduled placeholder). */
  id: number | null;
  /** Base shift the slot belongs to (JKP reports under morning/evening). */
  shift: string | null;
  /** not_started | in_progress | pending | completed | verified | rejected */
  status: string;
  /** Who did it: whoever completed the task, else whoever opened it. null while untouched. */
  doneBy: string | null;
  /** Employees scheduled for a slot nobody has opened yet. */
  scheduledNames: string[];
  completedAt: string | null;
  /** Serah Terima: the handover note itself. */
  note: string | null;
  isPlaceholder: boolean;
}

export interface TaskProgressStore {
  storeId: number;
  storeNo: string;
  name: string;
  areaId: number | null;
  areaName: string | null;
  slots: TaskProgressSlot[];
}

export interface TaskProgressResponse {
  success: boolean;
  error?: string;
  type: string;
  date: string;
  /** Serah Terima is a rolling board, not a per-day task: `date` is ignored. */
  board: boolean;
  stores: TaskProgressStore[];
}

export type StoreGroup = 'attention' | 'running' | 'done' | 'none';

export interface TaskOverviewRow {
  type: string;
  /** Stores per group. */
  counts: Record<StoreGroup, number>;
}

export interface TaskOverviewResponse {
  success: boolean;
  error?: string;
  date: string;
  tasks: TaskOverviewRow[];
}

// ─── The tasks, in the order IT should walk them ─────────────────────────────

export const PROGRESS_TASKS: TaskCatalogEntry[] = [...TASK_CATALOG].sort((a, b) => a.sortOrder - b.sortOrder);

export function progressTaskOf(code: string): TaskCatalogEntry | undefined {
  return PROGRESS_TASKS.find((t) => t.code === code);
}

export function progressTaskHref(code?: string): string {
  return code ? `/it/task-progress/${code}` : '/it/task-progress';
}

/** Serah Terima is a shared handover board per store, with no day of its own. */
export const BOARD_TASK = 'serah_terima';

// ─── Per-store roll-up of a task's slots ─────────────────────────────────────

export type StoreProgressKey = 'pending' | 'not_started' | 'partial' | 'in_progress' | 'completed' | 'none';

export interface StoreProgress {
  key: StoreProgressKey;
  group: StoreGroup;
  done: number;
  total: number;
  /** Sort rank — lower = needs attention sooner. */
  rank: number;
}

const isDone = (status: string) => status === 'completed' || status === 'verified';
const isFlagged = (status: string) => status === 'pending' || status === 'rejected';

/**
 * Where one store stands for a task. `isPast`: the day is over, so a slot nobody
 * did is missed rather than "not started yet". `emptyIsDone`: a store with no slots
 * is fine (Serah Terima: nothing waiting) instead of "not scheduled".
 */
export function summariseStore(slots: TaskProgressSlot[], isPast: boolean, emptyIsDone = false): StoreProgress {
  const total = slots.length;
  const done = slots.filter((s) => isDone(s.status)).length;

  if (total === 0) {
    return emptyIsDone
      ? { key: 'completed', group: 'done', done: 0, total: 0, rank: 5 }
      : { key: 'none', group: 'none', done: 0, total: 0, rank: 6 };
  }
  if (slots.some((s) => isFlagged(s.status))) return { key: 'pending', group: 'attention', done, total, rank: 0 };
  if (done === total) return { key: 'completed', group: 'done', done, total, rank: 5 };
  if (slots.some((s) => s.status === 'in_progress')) return { key: 'in_progress', group: 'running', done, total, rank: 3 };
  if (done > 0) {
    return isPast
      ? { key: 'partial', group: 'attention', done, total, rank: 2 }
      : { key: 'partial', group: 'running', done, total, rank: 4 };
  }
  return { key: 'not_started', group: 'attention', done, total, rank: 1 };
}

export function isPastDay(dateKey: string): boolean {
  return dateKey < jakartaTodayKey();
}

export function isFutureDay(dateKey: string): boolean {
  return dateKey > jakartaTodayKey();
}

// ─── Words ───────────────────────────────────────────────────────────────────

export const GROUP_LABELS: Record<StoreGroup, string> = {
  attention: 'Perlu perhatian',
  running: 'Sedang berjalan',
  done: 'Selesai',
  none: 'Tidak terjadwal',
};

export const GROUP_ORDER: StoreGroup[] = ['attention', 'running', 'done', 'none'];

/** Badge text for a store's roll-up. Serah Terima reads differently (a board, not a to-do). */
export function storeProgressLabel(p: StoreProgress, isPast: boolean, board = false): string {
  if (board) {
    switch (p.key) {
      case 'pending': return 'Tertahan';
      case 'in_progress': return 'Menunggu diterima';
      case 'completed': return 'Tidak ada yang menunggu';
      default: return 'Tidak ada data';
    }
  }
  switch (p.key) {
    case 'pending': return 'Pending';
    case 'not_started': return isPast ? 'Tidak dikerjakan' : 'Belum mulai';
    case 'partial': return `Sebagian ${p.done}/${p.total}`;
    case 'in_progress': return 'Aktif';
    case 'completed': return 'Selesai';
    default: return 'Tidak terjadwal';
  }
}

export function storeProgressBadgeClass(key: StoreProgressKey, isPast: boolean): string {
  switch (key) {
    case 'pending': return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'not_started': return isPast ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-600 border-amber-200';
    case 'partial': return isPast ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'in_progress': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'completed': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    default: return 'bg-slate-50 text-slate-400 border-slate-200';
  }
}

export function shiftLabel(shift: string | null | undefined): string {
  if (!shift) return '—';
  return SHIFT_LABELS[shift as ShiftCode] ?? shift.replaceAll('_', ' ');
}

/** "Andi, Budi +1" — distinct names, capped. */
export function nameList(names: (string | null | undefined)[], max = 2): string {
  const unique = [...new Set(names.filter((n): n is string => !!n))];
  if (unique.length === 0) return '—';
  return unique.length <= max ? unique.join(', ') : `${unique.slice(0, max).join(', ')} +${unique.length - max}`;
}

/** Roll-up ordering inside one group: worst first, then area, then store name. */
export function byAttention(
  a: { progress: StoreProgress; store: TaskProgressStore },
  b: { progress: StoreProgress; store: TaskProgressStore },
): number {
  return (
    a.progress.rank - b.progress.rank ||
    (a.store.areaName ?? '').localeCompare(b.store.areaName ?? '') ||
    a.store.name.localeCompare(b.store.name)
  );
}

export function countGroups(stores: TaskProgressStore[], isPast: boolean, emptyIsDone = false): Record<StoreGroup, number> {
  const counts: Record<StoreGroup, number> = { attention: 0, running: 0, done: 0, none: 0 };
  for (const store of stores) counts[summariseStore(store.slots, isPast, emptyIsDone).group]++;
  return counts;
}

// ─── Board (stores × tasks, one day) and ranges (× days) ─────────────────────

/** One store on the task board: its slots per task for the day (Serah Terima = open board items). */
export interface BoardStore extends Omit<TaskProgressStore, 'slots'> {
  tasks: Record<string, TaskProgressSlot[]>;
}

export interface BoardResponse {
  success: boolean;
  error?: string;
  date: string;
  scope?: 'area' | 'all_areas';
  areaName?: string | null;
  stores: BoardStore[];
}

/** How one store did on one task over one day (a range view's cell). */
export interface RangeCell {
  key: StoreProgressKey;
  done: number;
  total: number;
}

export interface TaskRangeStore extends Omit<TaskProgressStore, 'slots'> {
  /** Jakarta day → cell; days with nothing scheduled are absent. */
  days: Record<string, RangeCell>;
}

export interface TaskRangeResponse {
  success: boolean;
  error?: string;
  type: string;
  from: string;
  to: string;
  stores: TaskRangeStore[];
}

export interface OverviewRangeResponse {
  success: boolean;
  error?: string;
  from: string;
  to: string;
  /** Per task, per day: slots done / slots scheduled across every store. */
  tasks: { type: string; days: Record<string, { done: number; total: number }> }[];
}

export type ProgressPeriod = 'daily' | 'weekly' | 'monthly';

/** The Jakarta days a weekly (Monday–Sunday) or monthly view of `dateKey` covers. */
export function periodDays(period: ProgressPeriod, dateKey: string): string[] {
  const d = new Date(`${dateKey}T00:00:00Z`);
  if (period === 'daily') return [dateKey];
  if (period === 'weekly') {
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(monday);
      x.setUTCDate(monday.getUTCDate() + i);
      return x.toISOString().slice(0, 10);
    });
  }
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month, i + 1)).toISOString().slice(0, 10));
}

/** The longest range the range endpoints accept (a month and a bit). */
export const MAX_RANGE_DAYS = 31;

export const isDoneStatus = isDone;
