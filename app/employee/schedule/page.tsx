'use client';
// app/employee/schedule/page.tsx  (PIC — read-only calendar view)
//
// Pure viewing surface: shows the store's monthly schedule. All editing
// (add/edit entries, Excel import/template) lives in the PIC Panel at /pic.

import React, { useState, useEffect, useCallback } from 'react';
import { useSession }  from 'next-auth/react';
import { useRouter }   from 'next/navigation';
import {
  Loader2, Shield, Calendar, X, ChevronLeft, ChevronRight, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import EmployeeLogoMark from '@/components/employee/EmployeeLogoMark';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftCode = 'morning' | 'evening' | 'full_day' | string;

interface ShiftOption {
  id:        number;
  code:      string;
  label:     string;
  startTime: string | null;
  endTime:   string | null;
}

interface DayEntry {
  id:       string;
  userId:   string;
  userName: string | null;
  userType: string | null;
  date:     string;
  shiftId:  number | null;
  shift:    ShiftCode | null;
  isOff:    boolean;
  isLeave:  boolean;
}

interface MonthlySchedule {
  id:        string;
  storeId:   string;
  yearMonth: string;
  note:      string | null;
  createdAt: string;
  updatedAt: string;
  entries:   DayEntry[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_HEADER = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EMP_LABEL: Record<string, string> = { pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO' };

// Visual palette per shift code — extended for full_day, with a fallback
const SHIFT_PALETTE: Record<string, { label: string; bg: string; border: string; text: string; dot: string }> = {
  morning:  { label: 'E',  bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', dot: '#fb923c' },
  evening:  { label: 'L',  bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', dot: '#a78bfa' },
  full_day: { label: 'FD', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', dot: '#4ade80' },
  leave:    { label: 'AL', bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#818cf8' },
  off:      { label: '',   bg: 'transparent', border: 'transparent', text: '#cbd5e1', dot: '#e2e8f0' },
};

function shiftPalette(shift: ShiftCode | null, isOff: boolean, isLeave: boolean) {
  if (isLeave) return SHIFT_PALETTE.leave;
  if (isOff || !shift) return SHIFT_PALETTE.off;
  return SHIFT_PALETTE[shift] ?? { label: shift.toUpperCase().slice(0, 2), bg: '#f1f5f9', border: '#e2e8f0', text: '#475569', dot: '#94a3b8' };
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  // DB stores 'HH:MM:SS' — trim to HH:MM
  return t.slice(0, 5);
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

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildCalendarGrid(yearMonth: string): (Date | null)[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const first  = new Date(y, m - 1, 1);
  const days   = new Date(y, m, 0).getDate();
  const grid: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) grid.push(null);
  for (let d = 1; d <= days; d++) grid.push(new Date(y, m - 1, d));
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

// ─── DayDetailSheet (read-only) ───────────────────────────────────────────────

function DayDetailSheet({ date, entries, shiftOptions, onClose }: {
  date:         Date;
  entries:      DayEntry[];
  shiftOptions: ShiftOption[];
  onClose:      () => void;
}) {
  const label   = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const working = entries.filter(e => !e.isOff && !e.isLeave && e.shift);
  const leave   = entries.filter(e => e.isLeave);
  const off     = entries.filter(e => e.isOff && !e.isLeave);

  // Build a code→label map for shift display
  const shiftLabel: Record<string, string> = {};
  const shiftTime:  Record<string, string> = {};
  for (const s of shiftOptions) {
    shiftLabel[s.code] = s.label;
    shiftTime[s.code]  = [formatTime(s.startTime), formatTime(s.endTime)].filter(Boolean).join('–');
  }

  return (
    <div
      className="fixed inset-0 z-99 flex items-end justify-center"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white pb-10 shadow-2xl"
        style={{ animation: 'slideUp 0.28s cubic-bezier(0.34,1.4,0.64,1)', maxHeight: '80vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        <div className="flex items-start justify-between px-5 pb-4 pt-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Schedule</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{label}</p>
          </div>
          <button onClick={onClose} className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center px-6">
            <Calendar className="h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">No employees scheduled on this day.</p>
          </div>
        ) : (
          <div className="space-y-1 px-4">
            {working.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Working</p>
                {working.map(entry => {
                  const pal = shiftPalette(entry.shift, false, false);
                  return (
                    <div
                      key={entry.id}
                      className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 mb-2"
                      style={{ borderColor: pal.border, background: pal.bg }}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold" style={{ background: pal.dot + '30', color: pal.text }}>
                        {pal.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{entry.userName}</p>
                        <p className="text-[11px] text-slate-400">
                          {EMP_LABEL[entry.userType ?? ''] ?? entry.userType ?? '—'}
                          {entry.shift && shiftTime[entry.shift] ? ` · ${shiftTime[entry.shift]}` : ''}
                        </p>
                      </div>
                      <div className="rounded-lg px-2 py-0.5 text-[10px] font-bold" style={{ background: pal.dot + '20', color: pal.text }}>
                        {entry.shift ? (shiftLabel[entry.shift] ?? entry.shift) : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {leave.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">On Leave</p>
                {leave.map(entry => (
                  <div key={entry.id} className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 mb-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-extrabold text-indigo-600">AL</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
                    </div>
                    <span className="rounded-lg bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">Leave</span>
                  </div>
                ))}
              </div>
            )}

            {off.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Day Off</p>
                {off.map(entry => (
                  <div key={entry.id} className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 mb-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-400">—</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-500 truncate">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">Off</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}

// ─── CalendarGrid ─────────────────────────────────────────────────────────────

function CalendarGrid({ schedule, yearMonth, onDayPress }: {
  schedule:   MonthlySchedule;
  yearMonth:  string;
  onDayPress: (date: Date, entries: DayEntry[]) => void;
}) {
  const grid  = buildCalendarGrid(yearMonth);

  const [today, setToday] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const tick = () => setToday(isoDate(new Date()));
    const now  = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const t = setTimeout(() => {
      tick();
      const daily = setInterval(tick, 24 * 60 * 60 * 1000);
      return () => clearInterval(daily);
    }, nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(t);
  }, []);

  const dayMap = new Map<string, DayEntry[]>();
  for (const entry of schedule.entries) {
    const ds = toLocalDateKey(entry.date);
    if (!ds) continue;
    if (!dayMap.has(ds)) dayMap.set(ds, []);
    dayMap.get(ds)!.push(entry);
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAYS_HEADER.map((d, i) => (
          <div key={d} className="py-2 text-center text-[10px] font-bold uppercase tracking-wide" style={{ color: i === 0 || i === 6 ? '#fca5a5' : '#94a3b8' }}>
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((date, idx) => {
          if (!date) return <div key={`pad-${idx}`} className="aspect-square border-b border-r border-slate-50 last:border-r-0" />;

          const ds      = isoDate(date);
          const entries = dayMap.get(ds) ?? [];
          const dow     = date.getDay();
          const isWkd   = dow === 0 || dow === 6;
          const isTod   = ds === today;
          const isLastInRow = (idx + 1) % 7 === 0;

          // Collect shift codes present on this day for dots
          const shiftCodes = [...new Set(entries.filter(e => !e.isOff && !e.isLeave && e.shift).map(e => e.shift!))];
          const hasLeave   = entries.some(e => e.isLeave);
          const totalWork  = entries.filter(e => !e.isOff && !e.isLeave && e.shift).length;

          // Dot color per shift code
          const dotColor: Record<string, string> = {
            morning: '#fb923c', evening: '#a78bfa', full_day: '#4ade80',
          };

          return (
            <button
              key={ds}
              onClick={() => onDayPress(date, entries)}
              className={cn('relative flex flex-col items-center py-2 transition-colors active:bg-slate-50', 'border-b border-slate-50', !isLastInRow && 'border-r')}
              style={{ background: isTod ? '#eef2ff' : isWkd ? '#fafafa' : 'white' }}
            >
              <span
                className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold', isTod ? 'bg-indigo-500 text-white' : '')}
                style={{ color: isTod ? undefined : isWkd ? '#fca5a5' : '#334155' }}
              >
                {date.getDate()}
              </span>

              {totalWork > 0 && (
                <span className="mt-0.5 rounded-full px-1.5 text-[8px] font-bold" style={{ background: '#f1f5f9', color: '#64748b' }}>
                  {totalWork}
                </span>
              )}

              <div className="mt-1 flex gap-0.5">
                {shiftCodes.map(code => (
                  <span key={code} className="h-1.5 w-1.5 rounded-full" style={{ background: dotColor[code] ?? '#94a3b8' }} />
                ))}
                {hasLeave && <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#818cf8' }} />}
                {shiftCodes.length === 0 && !hasLeave && <span className="h-1.5 w-1.5 opacity-0" />}
              </div>
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

  const user         = session?.user as any;
  const employeeType = user?.employeeType as string | null;
  const storeId      = user?.homeStoreId  as string | null;

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);

  // Shifts from DB — fetched once, just for labels/legend
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);

  // Detail sheet state
  const [detailDate,    setDetailDate]    = useState<Date | null>(null);
  const [detailEntries, setDetailEntries] = useState<DayEntry[]>([]);

  const isPic1 = employeeType === 'pic_1' || employeeType === 'pic_2';

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isPic1)  router.replace('/employee');
  }, [authStatus, session, isPic1, router]);

  // ── Fetch shifts from DB ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isPic1) return;
    fetch('/api/pic/schedule/shifts')
      .then(r => r.json())
      .then(j => { if (j.success) setShiftOptions(j.shifts ?? []); })
      .catch(() => toast.error('Failed to load shift options'));
  }, [isPic1]);

  // ── Load schedule ──────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async (ym: string) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/pic/schedule/monthly?yearMonth=${ym}`);
      const json = await res.json();
      setSchedule(json.schedule ?? null);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (isPic1) loadSchedule(selectedMonth);
  }, [isPic1, selectedMonth, loadSchedule]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleMonthChange(ym: string) {
    setSelectedMonth(ym);
    setDetailDate(null);
  }

  function handleDayPress(date: Date, entries: DayEntry[]) {
    setDetailDate(date);
    setDetailEntries(entries);
  }

  // ── Auth loading ───────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isPic1) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only PIC can view the store schedule here.</p>
    </div>
  );

  const totalEmployees = schedule ? new Set(schedule.entries.map(e => e.userId)).size : 0;
  const workingDays    = schedule ? schedule.entries.filter(e => !e.isOff && !e.isLeave && e.shift).length : 0;
  const leaveDays      = schedule ? schedule.entries.filter(e => e.isLeave).length : 0;
  const [y, m]         = selectedMonth.split('-').map(Number);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">

      {/* Header */}
      <div className="relative overflow-hidden px-5 pb-6 pt-12" style={{ background: 'linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)' }}>
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />
        <div className="pointer-events-none absolute -left-4 bottom-0 h-24 w-24 rounded-full"  style={{ background: 'rgba(255,255,255,0.05)' }} />

        <div className="relative flex items-start justify-between">
          <div>
            <EmployeeLogoMark variant="white" className="mb-4 w-28" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">PIC · Schedule</p>
            <h1 className="mt-0.5 text-2xl font-bold text-white">Staff Schedule</h1>
          </div>
          <button onClick={() => loadSchedule(selectedMonth)} className="mt-1 flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {/* Month navigator */}
        <div className="relative mt-5 flex items-center justify-between">
          <button onClick={() => { const d = new Date(y, m - 2, 1); handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`); }} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-center">
            <p className="text-xl font-bold text-white">{MONTHS[m - 1]}</p>
            <p className="text-[11px] font-medium text-indigo-300">{y}</p>
          </div>
          <button onClick={() => { const d = new Date(y, m, 1); handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`); }} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20">
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3 p-4 pb-24">

        {loading && <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>}

        {!loading && schedule && (
          <div className="space-y-3">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Staff',       value: totalEmployees, color: '#6366f1' },
                { label: 'Work shifts', value: workingDays,    color: '#10b981' },
                { label: 'Leave days',  value: leaveDays,      color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-white px-3 py-3 text-center shadow-sm">
                  <p className="text-xl font-bold" style={{ color }}>{value}</p>
                  <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            {/* Dynamic legend from DB shifts */}
            <div className="flex items-center gap-3 px-1 flex-wrap">
              {shiftOptions.map(s => {
                const pal = SHIFT_PALETTE[s.code] ?? { dot: '#94a3b8' };
                return (
                  <div key={s.code} className="flex items-center gap-1 text-[10px] text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: pal.dot }} />
                    {s.label}
                  </div>
                );
              })}
              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <span className="h-2 w-2 rounded-full" style={{ background: '#818cf8' }} />
                Leave
              </div>
              <span className="ml-auto text-[10px] text-slate-400">Tap a day for details</span>
            </div>

            <CalendarGrid schedule={schedule} yearMonth={selectedMonth} onDayPress={handleDayPress} />

            {schedule.note && <p className="px-1 text-[11px] italic text-slate-400">Note: "{schedule.note}"</p>}
          </div>
        )}

        {!loading && !schedule && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl" style={{ background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)' }}>
              <Calendar className="h-8 w-8 text-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No schedule for {formatYearMonth(selectedMonth)}</p>
              <p className="mt-1 text-xs text-slate-400">Go to the PIC Panel to import or set up this month.</p>
            </div>
          </div>
        )}
      </div>

      {/* Detail sheet */}
      {detailDate && (
        <DayDetailSheet
          date={detailDate}
          entries={detailEntries}
          shiftOptions={shiftOptions}
          onClose={() => setDetailDate(null)}
        />
      )}
    </div>
  );
}
