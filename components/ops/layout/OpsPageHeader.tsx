'use client';
// components/ops/layout/OpsPageHeader.tsx
//
// Reusable page header for Ops pages.
// Use it inside app/ops/* pages. The shared app/ops/layout.tsx already renders
// OpsNavbar above this header, so this header only owns the page title/actions.

import { useMemo, useState, type ElementType, type ReactNode } from 'react';
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  RefreshCw,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Period = 'daily' | 'weekly' | 'monthly';

export interface PeriodProps {
  /** Currently selected period. Omit onPeriodChange to hide period tabs. */
  period?: Period;
  onPeriodChange?: (period: Period) => void;
  /** YYYY-MM-DD anchor date. Weekly snaps to Monday; monthly snaps to date 01. */
  date?: string;
  onDateChange?: (dateKey: string) => void;
}

interface OpsPageHeaderProps {
  /** Small label above title, e.g. "OPS · Head Office". */
  scope?: string;
  title: string;
  subtitle?: ReactNode;
  periodProps?: PeriodProps;
  onRefresh?: () => void;
  refreshing?: boolean;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function fromKey(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function todayKey() {
  return toKey(new Date());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfISOWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function fmtMonthLabel(d: Date) {
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function keyToCalendarDate(key: string, period: Period): Date {
  const d = fromKey(key);
  if (period === 'weekly') return startOfISOWeek(d);
  if (period === 'monthly') return new Date(d.getFullYear(), d.getMonth(), 1);
  return d;
}

// ─── Period tabs ──────────────────────────────────────────────────────────────

const PERIOD_TABS: { id: Period; label: string; icon: ElementType }[] = [
  { id: 'daily', label: 'Harian', icon: CalendarDays },
  { id: 'weekly', label: 'Mingguan', icon: CalendarRange },
  { id: 'monthly', label: 'Bulanan', icon: LayoutGrid },
];

function PeriodTabs({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
      {PERIOD_TABS.map((tab) => {
        const active = tab.id === value;
        const Icon = tab.icon;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition',
              active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Range navigator ──────────────────────────────────────────────────────────

function RangeNavigator({
  period,
  date,
  setDate,
}: {
  period: Period;
  date: string;
  setDate: (dateKey: string) => void;
}) {
  const [calOpen, setCalOpen] = useState(false);
  const cur = fromKey(date);

  const label = useMemo(() => {
    if (period === 'daily') {
      return cur.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
    }

    if (period === 'weekly') {
      const start = startOfISOWeek(cur);
      const end = addDays(start, 6);
      const sameMonth = start.getMonth() === end.getMonth();
      const s = start.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: sameMonth ? undefined : 'short',
      });
      const e = end.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
      return `${s} – ${e}`;
    }

    return fmtMonthLabel(cur);
  }, [period, cur]);

  const goPrev = () => {
    if (period === 'daily') setDate(toKey(addDays(cur, -1)));
    if (period === 'weekly') setDate(toKey(addDays(cur, -7)));
    if (period === 'monthly') setDate(toKey(new Date(cur.getFullYear(), cur.getMonth() - 1, 1)));
  };

  const goNext = () => {
    if (period === 'daily') setDate(toKey(addDays(cur, 1)));
    if (period === 'weekly') setDate(toKey(addDays(cur, 7)));
    if (period === 'monthly') setDate(toKey(new Date(cur.getFullYear(), cur.getMonth() + 1, 1)));
  };

  const goToday = () => {
    const today = fromKey(todayKey());
    if (period === 'weekly') setDate(toKey(startOfISOWeek(today)));
    else if (period === 'monthly') setDate(toKey(new Date(today.getFullYear(), today.getMonth(), 1)));
    else setDate(toKey(today));
  };

  const handleCalendarSelect = (picked: Date | undefined) => {
    if (!picked) return;

    if (period === 'weekly') setDate(toKey(startOfISOWeek(picked)));
    else if (period === 'monthly') setDate(toKey(new Date(picked.getFullYear(), picked.getMonth(), 1)));
    else setDate(toKey(picked));

    setCalOpen(false);
  };

  const calendarValue = keyToCalendarDate(date, period);

  return (
    <div className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={goPrev}
        aria-label="Previous"
        className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 transition hover:bg-slate-50"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex items-center gap-2 border-x border-slate-200 px-2">
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Pick date"
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50"
            >
              <CalendarDays className="h-4 w-4 text-slate-400" />
              <span className="whitespace-nowrap text-xs font-bold text-slate-700">{label}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="center" sideOffset={8}>
            <div className="p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {period === 'daily' && 'Pilih hari'}
                {period === 'weekly' && 'Pilih minggu'}
                {period === 'monthly' && 'Pilih bulan'}
              </p>
              <Calendar
                mode="single"
                selected={calendarValue}
                onSelect={handleCalendarSelect}
                className="rounded-lg"
                {...(period === 'monthly'
                  ? {
                      captionLayout: 'dropdown' as const,
                      startMonth: new Date(2020, 0),
                      endMonth: new Date(2030, 11),
                    }
                  : {})}
              />
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={goToday}
          className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 transition hover:bg-slate-200"
        >
          Hari ini
        </button>
      </div>

      <button
        type="button"
        onClick={goNext}
        aria-label="Next"
        className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 transition hover:bg-slate-50"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OpsPageHeader({
  scope,
  title,
  subtitle,
  periodProps,
  onRefresh,
  refreshing = false,
  actions,
  className,
  contentClassName,
}: OpsPageHeaderProps) {
  const [internalDate, setInternalDate] = useState(todayKey());

  const hasPeriod = !!periodProps;
  const period: Period = periodProps?.period ?? 'daily';
  const date = periodProps?.date ?? internalDate;

  const handleDateChange = (dateKey: string) => {
    if (periodProps?.onDateChange) periodProps.onDateChange(dateKey);
    else setInternalDate(dateKey);
  };

  return (
    <div className={cn('sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur', className)}>
      <div className={cn('mx-auto px-4 py-4 sm:px-6 lg:px-8', contentClassName)}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            {scope && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                {scope}
              </p>
            )}
            <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {title}
            </h1>
            {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
          </div>

          {(hasPeriod || onRefresh || actions) && (
            <div className="flex flex-wrap items-center gap-2">
              {hasPeriod && periodProps?.onPeriodChange && (
                <PeriodTabs value={period} onChange={periodProps.onPeriodChange} />
              )}

              {hasPeriod && (
                <RangeNavigator period={period} date={date} setDate={handleDateChange} />
              )}

              {onRefresh && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="h-10 gap-2 rounded-xl border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                  Refresh
                </Button>
              )}

              {actions}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OpsPageHeader;
