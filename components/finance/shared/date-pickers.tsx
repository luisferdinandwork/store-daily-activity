'use client';
// components/finance/shared/date-pickers.tsx
//
// Calendar pickers for Finance's pages:
//
//   • DayNavigator — one day (Setoran Review, Uang Modal Review, Store Closing):
//     ‹ prev · [date ▾] · next ›, where the date opens a calendar to jump to any
//     past day. "Hari ini" snaps back to today.
//   • RangePicker — a period from–to (Petty Cash Transactions): two months side
//     by side, click a start day then an end day, with quick presets.
//
// Dates travel as plain "YYYY-MM-DD" strings (lib/finance/dates.ts);
// react-day-picker wants local Dates, so they are converted only at this edge.
// Nothing after today can be picked — there is no data to look at yet.

import { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import { id as idLocale } from 'react-day-picker/locale';
import { cn } from '@/lib/utils';
import { Calendar, CalendarDayButton } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dayKey, fmtDateLong, fmtRange, parseDay, shiftDate, todayJakarta } from '@/lib/finance/dates';

// ─── Calendar (Finance-themed) ───────────────────────────────────────────────

/** The shared calendar recoloured emerald (the app theme's primary is purple) and set to Indonesian. */
function FinanceDayButton({ className, ...props }: React.ComponentProps<typeof CalendarDayButton>) {
  return (
    <CalendarDayButton
      className={cn(
        'data-[selected-single=true]:bg-emerald-600 data-[selected-single=true]:text-white data-[selected-single=true]:hover:bg-emerald-700',
        'data-[range-start=true]:bg-emerald-600 data-[range-start=true]:text-white data-[range-start=true]:hover:bg-emerald-700',
        'data-[range-end=true]:bg-emerald-600 data-[range-end=true]:text-white data-[range-end=true]:hover:bg-emerald-700',
        'data-[range-middle=true]:bg-emerald-100 data-[range-middle=true]:text-emerald-900',
        className,
      )}
      {...props}
    />
  );
}

function FinanceCalendar(props: React.ComponentProps<typeof Calendar>) {
  const today = parseDay(todayJakarta());

  return (
    <Calendar
      locale={idLocale}
      captionLayout="dropdown"
      startMonth={new Date(today.getFullYear() - 2, 0)}
      endMonth={today}
      disabled={{ after: today }}
      formatters={{ formatMonthDropdown: (d) => d.toLocaleString('id-ID', { month: 'short' }) }}
      classNames={{
        today: 'rounded-md bg-emerald-50 text-emerald-800 data-[selected=true]:rounded-none',
        range_start: 'rounded-l-md bg-emerald-100',
        range_end: 'rounded-r-md bg-emerald-100',
      }}
      components={{ DayButton: FinanceDayButton }}
      {...props}
    />
  );
}

// ─── Single day ──────────────────────────────────────────────────────────────

export function DayNavigator({ date, onChange }: { date: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const today = todayJakarta();
  const isToday = date >= today;

  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white text-sm">
        <button
          type="button"
          onClick={() => onChange(shiftDate(date, -1))}
          aria-label="Hari sebelumnya"
          className="flex h-full w-8 items-center justify-center rounded-l-md text-slate-500 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Pilih tanggal"
              className="flex h-full min-w-44 items-center justify-center gap-2 border-x border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              {fmtDateLong(date)}
              <ChevronDown className={cn('h-3 w-3 text-slate-400 transition-transform', open && 'rotate-180')} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="center" sideOffset={8} className="w-auto p-0">
            <FinanceCalendar
              mode="single"
              required
              selected={parseDay(date)}
              defaultMonth={parseDay(date)}
              onSelect={(d) => {
                onChange(dayKey(d));
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => onChange(shiftDate(date, 1))}
          disabled={isToday}
          aria-label="Hari berikutnya"
          className="flex h-full w-8 items-center justify-center rounded-r-md text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {date !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Hari ini
        </button>
      )}
    </div>
  );
}

// ─── Period (range) ──────────────────────────────────────────────────────────

export interface DateRangeValue {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
}

/** This month so far — the period the range pages open on. */
export function thisMonthRange(): DateRangeValue {
  const today = todayJakarta();
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** First day of the month before `iso`'s — the left calendar, so the range's end month sits on the right. */
function monthBefore(iso: string): string {
  const prevMonthEnd = shiftDate(`${iso.slice(0, 8)}01`, -1);
  return `${prevMonthEnd.slice(0, 8)}01`;
}

function presetRanges(): { label: string; range: DateRangeValue }[] {
  const today = todayJakarta();
  const monthStart = `${today.slice(0, 8)}01`;
  const prevMonthEnd = shiftDate(monthStart, -1);

  return [
    { label: 'Hari ini', range: { from: today, to: today } },
    { label: '7 hari terakhir', range: { from: shiftDate(today, -6), to: today } },
    { label: '30 hari terakhir', range: { from: shiftDate(today, -29), to: today } },
    { label: 'Bulan ini', range: { from: monthStart, to: today } },
    { label: 'Bulan lalu', range: { from: `${prevMonthEnd.slice(0, 8)}01`, to: prevMonthEnd } },
  ];
}

export function RangePicker({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (range: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  // First click of a pick: the start day, waiting for the end day.
  const [anchor, setAnchor] = useState<Date | null>(null);

  const presets = presetRanges();

  function commit(range: DateRangeValue) {
    onChange(range);
    setAnchor(null);
    setOpen(false);
  }

  function onDayClick(day: Date) {
    if (!anchor) {
      setAnchor(day);
      return;
    }
    const [a, b] = day < anchor ? [day, anchor] : [anchor, day];
    commit({ from: dayKey(a), to: dayKey(b) });
  }

  const selected: DateRange = anchor
    ? { from: anchor, to: undefined }
    : { from: parseDay(value.from), to: parseDay(value.to) };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAnchor(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pilih periode"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
          <span className="whitespace-nowrap">{fmtRange(value.from, value.to)}</span>
          <ChevronDown className={cn('h-3 w-3 text-slate-400 transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="max-h-(--radix-popover-content-available-height) w-auto max-w-[calc(100vw-1rem)] overflow-y-auto p-0"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 border-b border-slate-200 p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            <p className="hidden px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:block">
              Pintasan
            </p>
            {presets.map(({ label, range }) => {
              const on = range.from === value.from && range.to === value.to;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => commit(range)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition-colors',
                    on ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div>
            <FinanceCalendar
              mode="range"
              numberOfMonths={2}
              selected={selected}
              defaultMonth={parseDay(monthBefore(value.to))}
              // react-day-picker only treats `selected` as controlled when an onSelect exists;
              // the two-click pick is handled in onDayClick, so this is a deliberate no-op.
              onSelect={() => {}}
              onDayClick={onDayClick}
            />
            <p className="border-t border-slate-200 px-3 py-2 text-[11px] text-slate-500">
              {anchor ? 'Sekarang pilih tanggal akhir.' : 'Klik tanggal awal, lalu tanggal akhir.'}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
