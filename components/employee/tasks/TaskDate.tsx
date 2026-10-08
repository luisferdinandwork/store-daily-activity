'use client';
// components/employee/tasks/TaskDate.tsx
//
// Which day a task belongs to — for tasks that can carry forward past their own
// day (Store Closing on hold / reopened), so staff can tell yesterday's closing
// from today's. The task `date` is a Jakarta day bucket (lib/day-bucket.ts), so
// it's read with jakartaDateKey(), never the browser's own timezone.
//
//   CalendarTile  month strip + day number (+ weekday) — the task card's icon slot
//   TaskDayChip   "Hari ini" / "Lanjutan · 2 hari lalu"
//   TaskDateCard  tile + full date + chip, for the top of a task detail page

import { History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { jakartaDateKey, jakartaTodayKey } from '@/lib/day-bucket';

const DAY_MS = 86_400_000;

export interface TaskDayInfo {
  /** "YYYY-MM-DD" (Jakarta). */
  key: string;
  /** Days before today (0 = today, 1 = yesterday; negative = a future day). */
  daysAgo: number;
  /** Earlier than today — a task carried forward to today's list. */
  isCarryForward: boolean;
  /** "Hari ini" / "Kemarin" / "3 hari lalu". */
  relative: string;
  /** "Rab, 7 Okt" */
  short: string;
  /** "Rabu, 7 Oktober 2026" */
  long: string;
  /** Pieces for a calendar tile: "OKT" / "7" / "Rab". */
  month: string;
  day: string;
  weekday: string;
}

function fmt(key: string, options: Intl.DateTimeFormatOptions): string {
  // Noon UTC of the day key, formatted in UTC — the same calendar day in any browser zone.
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('id-ID', { ...options, timeZone: 'UTC' });
}

function relativeLabel(daysAgo: number): string {
  if (daysAgo === 0) return 'Hari ini';
  if (daysAgo === 1) return 'Kemarin';
  if (daysAgo === -1) return 'Besok';
  return daysAgo > 0 ? `${daysAgo} hari lalu` : `${-daysAgo} hari lagi`;
}

/** Day info for a day bucket or a real timestamp (both read as their Jakarta day). */
export function taskDayInfo(date: string | null | undefined): TaskDayInfo | null {
  if (!date) return null;
  const key = jakartaDateKey(date);
  if (!key) return null;

  const daysAgo = Math.round(
    (Date.parse(`${jakartaTodayKey()}T00:00:00Z`) - Date.parse(`${key}T00:00:00Z`)) / DAY_MS,
  );

  return {
    key,
    daysAgo,
    isCarryForward: daysAgo > 0,
    relative: relativeLabel(daysAgo),
    short: fmt(key, { weekday: 'short', day: 'numeric', month: 'short' }),
    long: fmt(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    month: fmt(key, { month: 'short' }).replace('.', '').toUpperCase(),
    day: fmt(key, { day: 'numeric' }),
    weekday: fmt(key, { weekday: 'short' }),
  };
}

const TILE_TONE = {
  primary: { box: 'border-border bg-background', strip: 'bg-primary' },
  amber:   { box: 'border-amber-300 bg-white',   strip: 'bg-amber-500' },
  muted:   { box: 'border-border bg-background', strip: 'bg-slate-400' },
} as const;

/**
 * A tear-off calendar page: month strip, big day number, weekday under it.
 * `sm` fits the 40px icon slot of a task card; `md` heads a detail card.
 */
export function CalendarTile({
  info, size = 'md', tone = 'primary', className,
}: {
  info: TaskDayInfo;
  size?: 'sm' | 'md';
  tone?: keyof typeof TILE_TONE;
  className?: string;
}) {
  const t = TILE_TONE[tone];
  const sm = size === 'sm';

  return (
    <div
      aria-hidden
      className={cn(
        'flex flex-shrink-0 flex-col overflow-hidden rounded-xl border text-center shadow-sm',
        sm ? 'w-11' : 'w-14',
        t.box,
        className,
      )}
    >
      <span className={cn('font-bold tracking-wider text-white', sm ? 'py-px text-[8px]' : 'py-0.5 text-[10px]', t.strip)}>
        {info.month}
      </span>
      <span className={cn('font-bold leading-none tabular-nums text-foreground', sm ? 'pt-0.5 text-base' : 'pt-1 text-xl')}>
        {info.day}
      </span>
      <span className={cn('font-medium text-muted-foreground', sm ? 'pb-0.5 text-[8px]' : 'pb-1 pt-0.5 text-[10px]')}>
        {info.weekday}
      </span>
    </div>
  );
}

/** "Hari ini" (green) or "Lanjutan · 2 hari lalu" (amber) for an earlier day. */
export function TaskDayChip({ info, className }: { info: TaskDayInfo; className?: string }) {
  const carry = info.isCarryForward;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold leading-tight',
        carry ? 'bg-amber-500 text-white' : 'bg-emerald-50 text-emerald-700',
        className,
      )}
    >
      {carry && <History className="h-2.5 w-2.5" />}
      {carry ? `Lanjutan · ${info.relative}` : info.relative}
    </span>
  );
}

/**
 * Calendar tile + "Rabu, 7 Oktober 2026". For an earlier day it turns amber and
 * says it's a carried-forward task, so it can't be mistaken for today's.
 */
export function TaskDateCard({
  date, label = 'Tanggal task', className,
}: {
  date: string | null | undefined;
  /** Small caption above the date, e.g. "Store Closing untuk tanggal". */
  label?: string;
  className?: string;
}) {
  const info = taskDayInfo(date);
  if (!info) return null;
  const carry = info.isCarryForward;

  return (
    <div
      className={cn(
        'flex items-center gap-3.5 rounded-2xl border p-3',
        carry ? 'border-amber-200 bg-amber-50' : 'border-border bg-card',
        className,
      )}
    >
      <CalendarTile info={info} tone={carry ? 'amber' : 'primary'} />

      <div className="min-w-0 flex-1">
        <p className={cn('text-[11px] font-medium', carry ? 'text-amber-700' : 'text-muted-foreground')}>{label}</p>
        <p className="mt-0.5 text-sm font-bold leading-snug text-foreground">{info.long}</p>
        <TaskDayChip info={info} className="mt-1.5" />
      </div>
    </div>
  );
}
