'use client';
// app/employee/schedule/page.tsx  (all employee types — personal read-only list view)
//
// Pure viewing surface: a scrollable, day-by-day list of the logged-in
// employee's own monthly shifts, with attendance (check-in/out) shown for
// days that have already happened. All editing (add/edit entries, Excel
// import/template) lives in the PIC Panel at /pic.

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession }  from 'next-auth/react';
import { useRouter }   from 'next/navigation';
import {
  Loader2, Calendar, ChevronLeft, ChevronRight, RefreshCw,
  LogIn, LogOut, Clock, CircleAlert, CircleCheck, CalendarOff, CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftCode = 'morning' | 'evening' | 'full_day' | string;

interface AttendanceInfo {
  status:       string;
  checkInTime:  string | null;
  checkOutTime: string | null;
  onBreak:      boolean;
}

interface DayEntry {
  id:           string;
  date:         string;
  shiftId:      number | null;
  shift:        ShiftCode | null;
  shiftLabel:   string | null;
  startTime:    string | null;
  endTime:      string | null;
  isOff:        boolean;
  isLeave:      boolean;
  attendance:   AttendanceInfo | null;
}

interface MonthlySchedule {
  id:        string;
  storeId:   string;
  yearMonth: string;
  note:      string | null;
  entries:   DayEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS    = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Title-text and attendance-badge colors still carry meaning (shift type /
// attendance outcome), but the row itself no longer gets a tinted
// background or border — that coloring made the list noisy and hard to
// scan. Only the text label keeps its shift color now.
const SHIFT_TEXT_COLOR: Record<string, string> = {
  morning:  '#b45309',
  evening:  '#1d4ed8',
  full_day: '#c2410c',
  leave:    '#5b3fd6',
  off:      '#94a3b8',
};

const SHIFT_SHORT: Record<string, string> = { morning: 'E', evening: 'L', full_day: 'FD' };

function shiftTextColor(shift: ShiftCode | null, isOff: boolean, isLeave: boolean) {
  if (isLeave) return SHIFT_TEXT_COLOR.leave;
  if (isOff || !shift) return SHIFT_TEXT_COLOR.off;
  return SHIFT_TEXT_COLOR[shift] ?? '#475569';
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  // DB stores 'HH:MM:SS' — trim to HH:MM
  return t.slice(0, 5);
}

function formatClock(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function currentYearMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function formatYearMonth(ym: string | null | undefined): string {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

// ─── Attendance status for a given day ─────────────────────────────────────────

type AttendanceBadge = {
  label: string;
  sub:   string;
  color: string;
  bg:    string;
  Icon:  typeof LogIn;
} | null;

function attendanceBadge(entry: DayEntry, dateKey: string, todayKey: string): AttendanceBadge {
  if (entry.isOff || entry.isLeave) return null;
  if (dateKey > todayKey) return null; // future shift — nothing to report yet

  const att = entry.attendance;

  if (att?.checkInTime && att?.checkOutTime) {
    return {
      label: att.status === 'late' ? 'Late, then completed' : 'Completed',
      sub:   `${formatClock(att.checkInTime)} – ${formatClock(att.checkOutTime)}`,
      color: '#15803d', bg: '#f0fdf4', Icon: LogOut,
    };
  }
  if (att?.checkInTime) {
    return {
      label: att.status === 'late' ? 'Checked in late' : 'Checked in',
      sub:   `${formatClock(att.checkInTime)}${att.onBreak ? ' · on break' : ' · not checked out yet'}`,
      color: '#c2410c', bg: '#fff7ed', Icon: LogIn,
    };
  }
  if (att?.status === 'excused') {
    return { label: 'Excused', sub: 'Marked excused by Ops.', color: '#1d4ed8', bg: '#eff6ff', Icon: Clock };
  }
  if (att?.status === 'absent') {
    return { label: 'Absent', sub: 'Marked absent.', color: '#b91c1c', bg: '#fef2f2', Icon: CircleAlert };
  }
  if (dateKey === todayKey) {
    return { label: 'Not checked in yet', sub: 'Shift is today.', color: '#64748b', bg: '#f8fafc', Icon: Clock };
  }
  return { label: 'No check-in recorded', sub: 'Nothing logged for this shift.', color: '#b91c1c', bg: '#fef2f2', Icon: CircleAlert };
}

// ─── DayRow ───────────────────────────────────────────────────────────────────

function DayRow({
  date, entry, isToday, isWeekend, innerRef,
}: {
  date: Date;
  entry: DayEntry | null;
  isToday: boolean;
  isWeekend: boolean;
  innerRef: (el: HTMLDivElement | null) => void;
}) {
  const isOff   = !entry || entry.isOff;
  const isLeave = !!entry?.isLeave;
  const textColor = shiftTextColor(entry?.shift ?? null, isOff, isLeave);
  const short   = isLeave ? 'AL' : (entry?.shift ? SHIFT_SHORT[entry.shift] ?? entry.shift.slice(0, 2).toUpperCase() : '');

  const timeRange = entry?.startTime && entry?.endTime
    ? `${formatTime(entry.startTime)} – ${formatTime(entry.endTime)}`
    : '';

  const title = isLeave
    ? 'On Leave'
    : isOff
      ? 'Day Off'
      : entry?.shiftLabel ?? entry?.shift ?? 'Shift';

  const dateKey = entry ? toLocalDateKey(entry.date) : toLocalDateKey(date);
  const todayKey = toLocalDateKey(new Date());
  const badge = entry ? attendanceBadge(entry, dateKey, todayKey) : null;

  return (
    <div
      ref={innerRef}
      className={cn(
        'group flex items-center gap-3 rounded-2xl border bg-white px-3 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all duration-200',
        isToday ? 'border-primary/30 bg-primary/[0.03]' : 'border-slate-200 hover:border-slate-300 hover:shadow-[0_2px_10px_rgba(15,23,42,0.06)]',
      )}
    >
      <div
        className={cn(
          'relative flex w-11 shrink-0 flex-col items-center justify-center rounded-xl py-1.5',
          isToday ? 'bg-primary' : 'bg-slate-100',
        )}
      >
        <span
          className="text-[9px] font-bold uppercase tracking-wide"
          style={{ color: isToday ? 'rgba(255,255,255,0.7)' : isWeekend ? '#fb7185' : '#94a3b8' }}
        >
          {WEEKDAYS[date.getDay()].slice(0, 3)}
        </span>
        <span className="text-base font-extrabold tabular-nums" style={{ color: isToday ? 'white' : '#1e293b' }}>
          {date.getDate()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-bold tracking-tight" style={{ color: isOff && !isLeave ? '#94a3b8' : textColor }}>{title}</p>
          {isToday && <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-primary">Today</span>}
        </div>
        {timeRange && <p className="text-[11px] font-medium tabular-nums text-slate-400">{timeRange}</p>}

        {badge && (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: badge.bg }}>
            <badge.Icon className="h-3 w-3 shrink-0" style={{ color: badge.color }} />
            <p className="truncate text-[10px] font-semibold" style={{ color: badge.color }}>
              {badge.label}{badge.sub ? ` · ${badge.sub}` : ''}
            </p>
          </div>
        )}
      </div>

      {short && (
        <div className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-extrabold tracking-wide text-slate-500 transition-transform duration-200 group-hover:scale-105">
          {short}
        </div>
      )}
    </div>
  );
}

// ─── WeekDivider ────────────────────────────────────────────────────────────────

function WeekDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pb-0.5 pt-3 first:pt-0">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
      <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

// ─── DateStrip ──────────────────────────────────────────────────────────────────
// A tappable horizontal strip of every day in the month being viewed, pinned
// under the header. Lets you jump straight to any day instead of scrolling
// the whole list to find it.

function DateStrip({
  days, todayKey, activeKey, onSelect,
}: {
  days: { date: Date; entry: DayEntry | null }[];
  todayKey: string;
  activeKey: string | null;
  onSelect: (dateKey: string) => void;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const todayPillRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    todayPillRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [days]);

  return (
    <div ref={stripRef} className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-2.5">
      {days.map(({ date, entry }) => {
        const dateKey = toLocalDateKey(date);
        const isToday = dateKey === todayKey;
        const isActive = dateKey === activeKey;
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

        return (
          <button
            key={dateKey}
            ref={isToday ? todayPillRef : undefined}
            type="button"
            onClick={() => onSelect(dateKey)}
            className={cn(
              'flex w-10 shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 transition-colors',
              isToday ? 'bg-primary' : isActive ? 'bg-primary/10' : 'bg-white hover:bg-slate-100',
            )}
            style={!isToday ? { border: isActive ? '1px solid transparent' : '1px solid #e2e8f0' } : undefined}
          >
            <span
              className="text-[8px] font-bold uppercase tracking-wide"
              style={{ color: isToday ? 'rgba(255,255,255,0.7)' : isWeekend ? '#fb7185' : '#94a3b8' }}
            >
              {WEEKDAYS[date.getDay()].slice(0, 1)}
            </span>
            <span className="text-xs font-extrabold tabular-nums" style={{ color: isToday ? 'white' : '#1e293b' }}>
              {date.getDate()}
            </span>
            <span className="h-1 w-1 rounded-full" style={{ background: isToday ? 'white' : entry && !entry.isOff ? '#cbd5e1' : 'transparent' }} />
          </button>
        );
      })}
    </div>
  );
}

// ─── MonthYearPicker ──────────────────────────────────────────────────────────
// Replaces "click prev/next N times" with a direct jump: tap the month
// title to open a small month grid + year stepper, tap a month, done.

function MonthYearPicker({
  year, month, onSelect,
}: {
  year: number;
  month: number;
  onSelect: (year: number, month: number) => void;
}) {
  const [viewYear, setViewYear] = useState(year);

  return (
    <div className="absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-xl shadow-slate-900/10">
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          onClick={() => setViewYear((y) => y - 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-bold text-slate-700">{viewYear}</span>
        <button
          type="button"
          onClick={() => setViewYear((y) => y + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS.map((label, idx) => {
          const isSelected = viewYear === year && idx + 1 === month;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onSelect(viewYear, idx + 1)}
              className={cn(
                'rounded-lg py-1.5 text-xs font-semibold transition-colors',
                isSelected ? 'bg-primary text-primary-foreground' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {label.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user    = session?.user as any;
  const storeId = user?.homeStoreId as string | null;

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [pickerOpen,    setPickerOpen]    = useState(false);
  // Whether today's row is currently scrolled into view — drives whether
  // the floating "Today" shortcut needs to show at all. Starts false so it
  // doesn't flash in before the first layout pass confirms visibility.
  const [todayVisible,  setTodayVisible]  = useState(true);

  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pickerWrapRef = useRef<HTMLDivElement | null>(null);
  // true means "scroll to today as soon as the current month finishes
  // loading" — starts true so the very first load lands on today, and gets
  // re-armed by the Today shortcut when it has to switch month first.
  const pendingTodayScrollRef = useRef(true);

  const scrollToDay = useCallback((dateKey: string, behavior: ScrollBehavior = 'smooth') => {
    dayRefs.current.get(dateKey)?.scrollIntoView({ behavior, block: 'center' });
  }, []);

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
  }, [authStatus, session, router]);

  // ── Load schedule ──────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async (ym: string) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/employee/schedule/monthly?yearMonth=${ym}`);
      const json = await res.json();
      setSchedule(json.schedule ?? null);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (storeId) loadSchedule(selectedMonth);
    // storeId (not `session`) is the real dependency here — next-auth hands
    // back a new `session` object reference on every background poll/focus
    // refetch, which was re-triggering a full reload (and its loading-state
    // skeleton) on a stable page, resetting scroll to the top mid-browse.
  }, [storeId, selectedMonth, loadSchedule]);

  // Land on today's row once the current month finishes loading — on first
  // mount, and again whenever the Today shortcut had to switch month first.
  useEffect(() => {
    if (loading || !schedule) return;
    if (selectedMonth !== currentYearMonth()) return;
    if (!pendingTodayScrollRef.current) return;
    scrollToDay(toLocalDateKey(new Date()), 'auto');
    pendingTodayScrollRef.current = false;
  }, [loading, schedule, selectedMonth, scrollToDay]);

  // Close the month/year picker on an outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [pickerOpen]);

  // Track whether today's row is on-screen so the floating "Today"
  // shortcut only appears when it's actually useful — i.e. you're looking
  // at a different month, or you've scrolled away from today in this one.
  useEffect(() => {
    if (selectedMonth !== currentYearMonth()) {
      setTodayVisible(false);
      return;
    }
    const todayKeyNow = toLocalDateKey(new Date());
    const el = dayRefs.current.get(todayKeyNow);
    if (!el) { setTodayVisible(false); return; }

    const observer = new IntersectionObserver(
      ([e]) => setTodayVisible(e.isIntersecting),
      { root: null, threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [selectedMonth, schedule, loading]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleMonthChange(ym: string) {
    setSelectedMonth(ym);
  }

  function goToToday() {
    const cm = currentYearMonth();
    if (selectedMonth !== cm) {
      pendingTodayScrollRef.current = true;
      setSelectedMonth(cm);
    } else {
      scrollToDay(toLocalDateKey(new Date()), 'smooth');
    }
  }

  function handlePickMonth(year: number, month: number) {
    setPickerOpen(false);
    handleMonthChange(`${year}-${String(month).padStart(2, '0')}`);
  }

  // Derived values + the summary memo must stay above the auth-loading early
  // return below, so every render calls the exact same hooks in the same
  // order (an early return before a hook call desyncs the hook count the
  // moment auth resolves, which React treats as a hard error, not a warning).
  const [y, m] = selectedMonth.split('-').map(Number);
  const todayKey = toLocalDateKey(new Date());
  const isCurrentMonth = selectedMonth === currentYearMonth();

  // Memoized so its identity only changes when the underlying schedule data
  // actually changes — not on every render (e.g. the "today visible" state
  // toggling from scrolling). DateStrip's scroll-to-today effect depends on
  // this array, and an unstable identity was re-firing that scroll on
  // every scroll-driven re-render, fighting the user's own scrolling.
  const days = useMemo(() => {
    const list: { date: Date; entry: DayEntry | null }[] = [];
    if (schedule) {
      const entryByDate = new Map(schedule.entries.map(e => [toLocalDateKey(e.date), e]));
      const daysInMonth = new Date(y, m, 0).getDate();
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(y, m - 1, d);
        list.push({ date, entry: entryByDate.get(toLocalDateKey(date)) ?? null });
      }
    }
    return list;
  }, [schedule, y, m]);

  const summary = useMemo(() => {
    let completed = 0, upcoming = 0, off = 0;
    for (const { date, entry } of days) {
      const dateKey = toLocalDateKey(date);
      if (!entry || entry.isOff || entry.isLeave) { off++; continue; }
      if (dateKey > todayKey) { upcoming++; continue; }
      if (entry.attendance?.checkInTime && entry.attendance?.checkOutTime) completed++;
    }
    return { completed, upcoming, off };
  }, [days, todayKey]);

  // ── Auth loading ───────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">

      {/* Header */}
      <div className="relative overflow-hidden bg-primary px-5 pb-4 pt-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -left-6 bottom-0 h-28 w-28 rounded-full bg-white/5" />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/60">My Schedule</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-primary-foreground">This Month's Shifts</h1>
          </div>
          <div className="mt-1 flex items-center gap-2">
            {/* Always-available shortcut back to the current month + today,
                independent of scroll position — the floating pill below is
                just a scroll-aware reminder of the same action. */}
            {!isCurrentMonth && (
              <button
                onClick={goToToday}
                className="flex h-9 items-center gap-1 rounded-xl bg-white/10 px-2.5 text-white/70 transition-colors hover:bg-white/20 active:scale-95"
              >
                <CalendarDays className="h-4 w-4" />
                <span className="text-[11px] font-bold">Today</span>
              </button>
            )}
            <button
              onClick={() => loadSchedule(selectedMonth)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 transition-colors hover:bg-white/20 active:scale-95"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        {/* Month navigator — chevrons for one-step moves, or tap the month
            name to jump straight to any month/year via the picker. */}
        <div ref={pickerWrapRef} className="relative mt-5 flex items-center justify-between">
          <button onClick={() => { const d = new Date(y, m - 2, 1); handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`); }} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 transition-colors hover:bg-white/20 active:scale-95">
            <ChevronLeft className="h-5 w-5" />
          </button>

          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex flex-col items-center rounded-xl px-3 py-1 text-center transition-colors hover:bg-white/10 active:scale-95"
          >
            <p className="text-xl font-bold tracking-tight text-primary-foreground">{MONTHS[m - 1]}</p>
            <p className="text-[11px] font-medium text-primary-foreground/60">{y}</p>
          </button>

          <button onClick={() => { const d = new Date(y, m, 1); handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`); }} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 transition-colors hover:bg-white/20 active:scale-95">
            <ChevronRight className="h-5 w-5" />
          </button>

          {pickerOpen && (
            <MonthYearPicker year={y} month={m} onSelect={handlePickMonth} />
          )}
        </div>

        {/* Monthly summary strip */}
        {!loading && schedule && (
          <div className="relative mt-5 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-1 text-green-300"><CircleCheck className="h-3 w-3" /><span className="text-[9px] font-bold uppercase tracking-wide">Completed</span></div>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-primary-foreground">{summary.completed}</p>
            </div>
            <div className="rounded-xl bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-1 text-amber-200"><Clock className="h-3 w-3" /><span className="text-[9px] font-bold uppercase tracking-wide">Upcoming</span></div>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-primary-foreground">{summary.upcoming}</p>
            </div>
            <div className="rounded-xl bg-white/10 px-2.5 py-2 backdrop-blur-sm">
              <div className="flex items-center gap-1 text-slate-300"><CalendarOff className="h-3 w-3" /><span className="text-[9px] font-bold uppercase tracking-wide">Off / Leave</span></div>
              <p className="mt-0.5 text-lg font-extrabold tabular-nums text-primary-foreground">{summary.off}</p>
            </div>
          </div>
        )}
      </div>

      {/* Date strip — jump straight to any day in the month being viewed */}
      {schedule && days.length > 0 && (
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 backdrop-blur-sm">
          <DateStrip days={days} todayKey={todayKey} activeKey={null} onSelect={(dateKey) => scrollToDay(dateKey)} />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 space-y-2 p-4 pb-24">

        {/* Skeleton only for the very first load — once a schedule is on
            screen, a background refresh (e.g. a session refetch) keeps the
            existing list mounted instead of swapping it for a short skeleton,
            which was collapsing page height and snapping scroll to the top. */}
        {loading && !schedule && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[64px] animate-pulse rounded-2xl border border-slate-100 bg-white" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        )}

        {schedule && (
          <div className="space-y-1">
            {days.map(({ date, entry }, i) => {
              const dateKey = toLocalDateKey(date);
              const isToday = dateKey === todayKey;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const showWeekDivider = i === 0 || date.getDay() === 1;
              return (
                <React.Fragment key={dateKey}>
                  {showWeekDivider && (
                    <WeekDivider label={`Week of ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`} />
                  )}
                  <DayRow
                    date={date}
                    entry={entry}
                    isToday={isToday}
                    isWeekend={isWeekend}
                    innerRef={(el) => {
                      if (el) dayRefs.current.set(dateKey, el);
                      else dayRefs.current.delete(dateKey);
                    }}
                  />
                </React.Fragment>
              );
            })}

            {schedule.note && (
              <div className="mt-3 rounded-xl border border-primary/20 border-dashed bg-primary/5 px-3 py-2">
                <p className="text-[11px] italic text-primary">Note: "{schedule.note}"</p>
              </div>
            )}
          </div>
        )}

        {!loading && !schedule && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Calendar className="h-8 w-8 text-primary/60" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No schedule for {formatYearMonth(selectedMonth)}</p>
              <p className="mt-1 text-xs text-slate-400">Ask your PIC or Ops team to set up this month's schedule.</p>
            </div>
          </div>
        )}
      </div>

      {/* Floating "Today" shortcut — only appears when today's row isn't
          already visible (different month, or scrolled away), so it doesn't
          sit on screen as clutter when there's nothing useful for it to do. */}
      {!todayVisible && (
        <button
          onClick={goToToday}
          className="fixed bottom-24 right-4 z-40 flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2.5 text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95 md:bottom-6"
        >
          <Calendar className="h-4 w-4" />
          <span className="text-xs font-bold">{isCurrentMonth ? 'Jump to Today' : 'Go to Today'}</span>
        </button>
      )}
    </div>
  );
}