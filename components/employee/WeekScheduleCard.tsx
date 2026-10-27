'use client';
// components/employee/WeekScheduleCard.tsx
//
// "Jadwal Minggu Ini" on the employee Home: this Monday–Sunday at a glance — one
// cell per day with the shift code, today ringed — and a plain line under it for
// today and tomorrow. The full month is one tap away (Schedule, in the More menu).
// Data: GET /api/employee/schedule/week.

import Link from 'next/link';
import { CalendarOff, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import { SHIFT_ROSTER_CODE, type ShiftCode } from '@/lib/shift-tasks';
import { shiftHours, type WeekDay, type WeekScheduleResponse } from '@/lib/employee-week';
import { SectionLabel, SkeletonBlocks } from '@/components/employee/ui';

const WEEKDAY = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const WEEKDAY_LONG = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// One tint per kind of shift (chips on a calendar, not statuses — the shift colours
// of the Schedule page, softened).
const SHIFT_TINT: Record<string, string> = {
  morning: 'bg-amber-50 text-amber-700 ring-amber-200',
  jkp_morning: 'bg-amber-50 text-amber-700 ring-amber-200',
  evening: 'bg-sky-50 text-sky-700 ring-sky-200',
  jkp_evening: 'bg-sky-50 text-sky-700 ring-sky-200',
  full_day: 'bg-orange-50 text-orange-700 ring-orange-200',
  middle: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  dinas: 'bg-slate-100 text-slate-600 ring-slate-200',
};

function dow(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function dom(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDate();
}

function chip(day: WeekDay): { text: string; cls: string } {
  if (day.kind === 'shift' && day.shift) {
    return {
      text: SHIFT_ROSTER_CODE[day.shift as ShiftCode] ?? (day.shiftLabel ?? '•').slice(0, 2).toUpperCase(),
      cls: SHIFT_TINT[day.shift] ?? 'bg-secondary text-foreground ring-border',
    };
  }
  if (day.kind === 'leave') return { text: 'Cuti', cls: 'bg-violet-50 text-violet-700 ring-violet-200' };
  if (day.kind === 'off') return { text: 'OFF', cls: 'bg-secondary text-muted-foreground ring-border' };
  return { text: '–', cls: 'bg-transparent text-muted-foreground/50 ring-transparent' };
}

/** "Hari ini: Morning · 08:00–16:00" / "Hari ini libur" / "Hari ini belum ada jadwal". */
function sentence(label: string, day: WeekDay | undefined): string | null {
  if (!day) return null;
  if (day.kind === 'shift') {
    const hours = shiftHours(day);
    return `${label}: ${day.shiftLabel ?? 'Shift'}${hours ? ` · ${hours}` : ''}`;
  }
  if (day.kind === 'leave') return `${label}: cuti`;
  if (day.kind === 'off') return `${label}: libur`;
  return `${label}: belum ada jadwal`;
}

export default function WeekScheduleCard({ enabled = true }: { enabled?: boolean }) {
  const { data, loading } = useApi<WeekScheduleResponse>(enabled ? '/api/employee/schedule/week' : null);

  return (
    // pb-24: the last thing on Home, so it can scroll clear of the floating More button.
    <section className="mx-auto w-full max-w-md px-4 pb-24 pt-1">
      <SectionLabel
        action={(
          <Link href="/employee/schedule" className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary active:opacity-70">
            Lihat jadwal <ChevronRight className="h-3 w-3" />
          </Link>
        )}
      >
        Jadwal Minggu Ini
      </SectionLabel>

      {loading ? (
        <SkeletonBlocks count={1} className="h-36 rounded-2xl" />
      ) : !data?.success ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center text-xs text-muted-foreground">
          Jadwal belum bisa dimuat.
        </div>
      ) : data.days.every((d) => d.kind === 'none') ? (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
            <CalendarOff className="h-4 w-4 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-bold text-foreground">Belum ada jadwal minggu ini</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Jadwal diatur oleh Ops / PIC toko.</p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <div className="grid grid-cols-7 gap-1">
            {data.days.map((day) => {
              const isToday = day.date === data.today;
              const past = day.date < data.today;
              const c = chip(day);
              const weekend = dow(day.date) === 0 || dow(day.date) === 6;
              return (
                <div
                  key={day.date}
                  aria-label={`${WEEKDAY_LONG[dow(day.date)]} ${dom(day.date)}: ${day.kind === 'shift' ? (day.shiftLabel ?? 'shift') : day.kind === 'leave' ? 'cuti' : day.kind === 'off' ? 'libur' : 'belum ada jadwal'}`}
                  className={cn(
                    'flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-0.5 py-2 transition-colors',
                    isToday ? 'bg-primary/8 ring-1 ring-primary/25' : '',
                    past && !isToday && 'opacity-55',
                  )}
                >
                  <span className={cn('text-[10px] font-medium', weekend ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
                    {WEEKDAY[dow(day.date)]}
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold tabular-nums',
                      isToday ? 'bg-primary text-primary-foreground' : 'text-foreground',
                    )}
                  >
                    {dom(day.date)}
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-full max-w-[2.5rem] items-center justify-center rounded-md px-1 text-[10px] font-bold leading-none ring-1 ring-inset',
                      c.cls,
                    )}
                  >
                    {c.text}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Today + tomorrow in words — what people actually want to know */}
          <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
            {(() => {
              const todayIdx = data.days.findIndex((d) => d.date === data.today);
              const today = sentence('Hari ini', data.days[todayIdx]);
              const tomorrow = todayIdx >= 0 ? sentence('Besok', data.days[todayIdx + 1]) : null;
              return (
                <>
                  {today && <p className="font-semibold text-foreground">{today}</p>}
                  {tomorrow && <p className="text-muted-foreground">{tomorrow}</p>}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}
