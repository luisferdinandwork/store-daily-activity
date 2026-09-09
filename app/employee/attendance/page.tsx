'use client';
// app/employee/attendance/page.tsx
//
// Shift behaviour (breaks) and the shift glyph come from the `shifts` lookup,
// surfaced per slot by /api/employee/attendance. The page renders ANY shift the
// lookup provides — scheduling an employee on a shift row is enough for them to
// attend with the right break flow. No shift codes are hardcoded here; the
// LEGACY_* maps below are only a graceful fallback for a slot whose API
// response predates the lookup metadata.
//
// Visual language matches the employee dashboard: a `bg-primary` hero with soft
// decorative blur, then compact white cards on `bg-slate-50` with soft-tinted
// icon tiles (amber/violet/emerald 50-bg, 600-icon) and slim accent bars.

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, Clock, LogIn, LogOut, Sun, Moon, Sunrise,
  AlertCircle, Loader2, XCircle, CalendarX, Info,
  Coffee, UtensilsCrossed, RotateCcw, Zap, AlertTriangle,
} from 'lucide-react';
import { cn, formatRupiah } from '@/lib/utils';
import { toast } from 'sonner';
import CashCountCard, { type CashCountPayload } from '@/components/employee/CashCountCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttStatus  = 'present' | 'late' | 'absent' | 'excused';
type ShiftCode  = string;
type BreakType  = 'lunch' | 'dinner' | 'full_day_lunch' | 'full_day_dinner' | (string & {});

interface ShiftBreakDef {
  type:  BreakType;
  label: string;
}

interface BreakSession {
  id:           number;
  breakType:    BreakType;
  breakOutTime: string;
  returnTime:   string | null;
  cashOut:      number;
  cashIn:       number | null;
}

interface AttRecord {
  attendanceId:  number;
  scheduleId:    number;
  status:        AttStatus;
  shift:         ShiftCode;
  checkInTime:   string | null;
  checkOutTime:  string | null;
  onBreak:       boolean;
  notes:         string | null;
  breaks:        BreakSession[];
}

interface ShiftSlot {
  schedule: {
    scheduleId: number;
    shift:      ShiftCode;
    shiftLabel: string | null;
    startTime:  string | null;
    endTime:    string | null;
    storeId:    number;
    date:       string;
    icon?:      string | null;
    breaks?:    ShiftBreakDef[] | null;
  };
  attendance: AttRecord | null;
}

interface AttResponse {
  success:   boolean;
  shifts:    ShiftSlot[];
  cashCount?: CashCountPayload;
}

// ─── Shift glyph + soft accent ────────────────────────────────────────────────

const ICONS: Record<string, React.ElementType> = {
  sun: Sun, moon: Moon, zap: Zap, sunrise: Sunrise, clock: Clock, coffee: Coffee,
};

const LEGACY_ICON: Record<string, string> = { morning: 'sun', evening: 'moon', full_day: 'zap' };
const LEGACY_BREAKS: Record<string, ShiftBreakDef[]> = {
  morning:  [{ type: 'lunch',  label: 'Lunch'  }],
  evening:  [{ type: 'dinner', label: 'Dinner' }],
  full_day: [
    { type: 'full_day_lunch',  label: 'Lunch Break'  },
    { type: 'full_day_dinner', label: 'Dinner Break' },
  ],
};

interface Accent { tile: string; icon: string; bar: string; chip: string }
const SHIFT_ACCENT: Record<string, Accent> = {
  morning:  { tile: 'bg-amber-50',   icon: 'text-amber-600',   bar: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-700'     },
  evening:  { tile: 'bg-violet-50',  icon: 'text-violet-600',  bar: 'bg-violet-500',  chip: 'bg-violet-50 text-violet-700'   },
  full_day: { tile: 'bg-emerald-50', icon: 'text-emerald-600', bar: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
};
const NEUTRAL_ACCENT: Accent = { tile: 'bg-secondary', icon: 'text-muted-foreground', bar: 'bg-primary', chip: 'bg-secondary text-muted-foreground' };
const accentFor = (code: string): Accent => SHIFT_ACCENT[code] ?? NEUTRAL_ACCENT;

type ScheduleMeta = ShiftSlot['schedule'];
const iconNameOf = (s: ScheduleMeta): string => s.icon ?? LEGACY_ICON[s.shift] ?? 'clock';
const breaksOf   = (s: ScheduleMeta): ShiftBreakDef[] =>
  Array.isArray(s.breaks) ? s.breaks : (LEGACY_BREAKS[s.shift] ?? []);

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AttStatus, { label: string; Icon: React.ElementType; text: string; tile: string; dot: string }> = {
  present: { label: 'Present', Icon: CheckCircle2, text: 'text-emerald-600', tile: 'bg-emerald-50', dot: 'bg-emerald-500' },
  late:    { label: 'Late',    Icon: Clock,        text: 'text-amber-600',   tile: 'bg-amber-50',   dot: 'bg-amber-500'   },
  absent:  { label: 'Absent',  Icon: XCircle,      text: 'text-red-600',     tile: 'bg-red-50',     dot: 'bg-red-500'     },
  excused: { label: 'Excused', Icon: AlertCircle,  text: 'text-muted-foreground', tile: 'bg-secondary', dot: 'bg-muted-foreground' },
};
const BREAK_TILE = 'bg-amber-50';
const BREAK_TEXT = 'text-amber-600';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(inIso: string | null, outIso: string | null): string {
  if (!inIso || !outIso) return '—';
  const mins = Math.round((new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

function todayFull() {
  return new Date().toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function ShiftGlyph({ schedule, className }: { schedule: ScheduleMeta; className?: string }) {
  const I = ICONS[iconNameOf(schedule)] ?? Clock;
  return <I className={className ?? 'h-4 w-4'} strokeWidth={2.2} />;
}

function getMinutesElapsedSince(timeStr: string | null): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const now = new Date();
  const start = new Date(now);
  start.setHours(h, m, 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 60000);
}

// ─── Cash input field ─────────────────────────────────────────────────────────
// Compact bordered row: label + "Rp" prefix + number field. Raw digits while
// focused, thousand-separated on blur.

function CashInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const numericValue = parseFloat(value);
  const displayValue = !focused && value !== '' && !isNaN(numericValue)
    ? formatRupiah(numericValue, false)
    : value;

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      <div className="flex items-center overflow-hidden rounded-xl border border-border bg-background focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15">
        <span className="pl-3 pr-1 text-sm font-semibold text-muted-foreground">Rp</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={displayValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
          className="w-full bg-transparent py-2.5 pr-3 text-sm font-bold tabular-nums text-foreground outline-none"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ─── Per-shift card ───────────────────────────────────────────────────────────

function ShiftCard({ slot, cashCountBlocking, onAction }: {
  slot:              ShiftSlot;
  cashCountBlocking: boolean;
  onAction: (
    action:    string,
    shift:     ShiftCode,
    breakType?: BreakType,
    cashOut?:   number,
    cashIn?:    number,
  ) => Promise<void>;
}) {
  const [acting, setActing]               = useState<string | null>(null);
  const [cashOutInputs, setCashOutInputs] = useState<Partial<Record<string, string>>>({});
  const [cashInInput,   setCashInInput]   = useState('');

  const { schedule, attendance: att } = slot;
  const shift     = schedule.shift;
  const accent    = accentFor(shift);
  const breakDefs = breaksOf(schedule);

  const checkedIn  = Boolean(att?.checkInTime);
  const checkedOut = Boolean(att?.checkOutTime);
  const onBreak    = Boolean(att?.onBreak);
  const cfg        = att ? STATUS_CFG[att.status] : null;

  const minutesLate  = getMinutesElapsedSince(schedule.startTime);
  const isLateByTime = minutesLate !== null && minutesLate > 0;
  const timeStr      = [formatTime(schedule.startTime), formatTime(schedule.endTime)].filter(Boolean).join(' – ');

  const usedBreakTypes  = new Set((att?.breaks ?? []).map(b => b.breakType));
  const availableBreaks = breakDefs.filter(b => !usedBreakTypes.has(b.type));
  const openBreak       = att?.breaks?.find(b => !b.returnTime) ?? null;

  async function act(action: string, breakType?: BreakType, cashOut?: number, cashIn?: number) {
    setActing(breakType ?? action);
    try { await onAction(action, shift, breakType, cashOut, cashIn); }
    finally { setActing(null); }
  }

  const cashInNum   = parseFloat(cashInInput);
  const cashInValid = cashInInput !== '' && !isNaN(cashInNum) && cashInNum >= 0;

  const statusTile = onBreak ? BREAK_TILE : (cfg?.tile ?? 'bg-secondary');
  const statusText = onBreak ? BREAK_TEXT : (cfg?.text ?? 'text-foreground');
  const StatusIcon = onBreak ? Coffee : (cfg?.Icon ?? Clock);
  const statusLabel = onBreak
    ? `On Break${openBreak ? ` · ${openBreak.breakType.replace('full_day_', '').replace('_', ' ')}` : ''}`
    : (cfg?.label ?? '');

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-sm">
      {/* Accent bar */}
      <div className={cn('h-1', accent.bar)} />

      <CardContent className="space-y-3 p-3.5">
        {/* Shift header */}
        <div className="flex items-center gap-3">
          <div className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl', accent.tile)}>
            <ShiftGlyph schedule={schedule} className={cn('h-4 w-4', accent.icon)} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">{schedule.shiftLabel ?? shift}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {timeStr && <>{timeStr} · </>}
              {breakDefs.length > 0 ? `${breakDefs.map(b => b.label).join(' & ')}` : 'No break'}
            </p>
          </div>
          {cfg && (
            <span className={cn('inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold', onBreak ? 'bg-amber-50 text-amber-700' : `${cfg.tile} ${cfg.text}`)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', onBreak ? 'bg-amber-500' : cfg.dot)} />
              {onBreak ? 'On Break' : cfg.label}
            </span>
          )}
        </div>

        {/* ── Not yet checked in ───────────────────────────────────────────── */}
        {!att && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2.5">
              <LogIn className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Tap to check in for your <span className="font-semibold text-foreground">{schedule.shiftLabel ?? shift}</span> shift
              </p>
            </div>

            {isLateByTime && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <p className="text-[11px] text-amber-700">
                  Shift started {formatTime(schedule.startTime)} · {minutesLate!} min late. Check-in now records as <span className="font-bold">Late</span>.
                </p>
              </div>
            )}

            <Button className="h-11 w-full gap-2 text-sm font-bold" onClick={() => act('checkin')} disabled={acting !== null}>
              {acting === 'checkin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {acting === 'checkin' ? 'Checking in…' : 'Check In Now'}
            </Button>
          </div>
        )}

        {/* ── Checked in ───────────────────────────────────────────────────── */}
        {att && cfg && (
          <>
            {/* Status strip */}
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
              <div className={cn('flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl', statusTile)}>
                <StatusIcon className={cn('h-5 w-5', statusText)} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <p className={cn('text-base font-bold capitalize', statusText)}>{statusLabel}</p>
                <p className="text-[11px] text-muted-foreground">
                  In {fmtTime(att.checkInTime)}
                  {att.checkOutTime && <> · Out {fmtTime(att.checkOutTime)}</>}
                  {onBreak && openBreak && <> · break since {fmtTime(openBreak.breakOutTime)}</>}
                  {' · '}{fmtDuration(att.checkInTime, att.checkOutTime)}
                </p>
              </div>
            </div>

            {/* ── On-break return card ──────────────────────────────────────── */}
            {onBreak && (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2">
                  <UtensilsCrossed className="h-4 w-4 flex-shrink-0 text-amber-600" />
                  <p className="text-xs font-semibold text-amber-800">Enter cash brought back, then return</p>
                </div>
                <CashInput label="Cash brought back" value={cashInInput} onChange={setCashInInput} disabled={acting !== null} />
                <Button
                  className="h-11 w-full gap-2 bg-amber-500 text-sm font-bold text-white hover:bg-amber-600"
                  onClick={() => { act('endbreak', undefined, undefined, cashInNum); setCashInInput(''); }}
                  disabled={acting !== null || !cashInValid}
                >
                  {acting === 'endbreak' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {acting === 'endbreak' ? 'Returning…' : 'Return from Break'}
                </Button>
              </div>
            )}

            {/* Break history */}
            {(att.breaks ?? []).length > 0 && (
              <div className="rounded-xl border border-border p-3">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Break Record</p>
                <div className="divide-y divide-border">
                  {att.breaks.map(b => (
                    <div key={b.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
                        <Coffee className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
                        {b.breakType.replace('full_day_', '').replace('_', ' ')}
                      </span>
                      <span className="text-right text-muted-foreground">
                        <span className="font-semibold text-foreground">{fmtTime(b.breakOutTime)}</span>
                        {b.returnTime
                          ? <>–{fmtTime(b.returnTime)} · {formatRupiah(b.cashOut, false)}→{b.cashIn != null ? formatRupiah(b.cashIn, false) : '—'}</>
                          : <span className="ml-1 font-medium text-amber-600">ongoing</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* OPS note */}
            {att.notes && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="text-[11px] font-bold text-amber-800">Note from OPS</p>
                  <p className="text-xs text-amber-700">{att.notes}</p>
                </div>
              </div>
            )}

            {/* ── Action buttons ───────────────────────────────────────────── */}
            {checkedIn && !checkedOut && (
              <div className="space-y-2.5">
                {!onBreak && availableBreaks.map(bc => {
                  const inputVal   = cashOutInputs[bc.type] ?? '';
                  const cashOutNum = parseFloat(inputVal);
                  const isValid    = inputVal !== '' && !isNaN(cashOutNum) && cashOutNum >= 0;

                  return (
                    <div key={bc.type} className="space-y-2 rounded-xl border border-border p-3">
                      <CashInput
                        label={`Cash taken out · ${bc.label}`}
                        value={inputVal}
                        onChange={v => setCashOutInputs(prev => ({ ...prev, [bc.type]: v }))}
                        disabled={acting !== null}
                      />
                      <Button
                        variant="outline"
                        className="h-10 w-full gap-2 text-sm font-semibold"
                        onClick={() => { act('startbreak', bc.type, cashOutNum, undefined); setCashOutInputs(prev => ({ ...prev, [bc.type]: '' })); }}
                        disabled={acting !== null || !isValid}
                      >
                        {acting === bc.type ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coffee className="h-4 w-4" />}
                        {acting === bc.type ? 'Starting…' : `Take ${bc.label}`}
                      </Button>
                    </div>
                  );
                })}

                <Button
                  variant="outline"
                  className="h-11 w-full gap-2 border-border text-sm font-semibold"
                  onClick={() => act('checkout')}
                  disabled={acting !== null || onBreak}
                >
                  {acting === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                  {acting === 'checkout' ? 'Checking out…' : 'Check Out'}
                </Button>

                {onBreak && <p className="text-center text-[11px] text-muted-foreground">Return from break first to check out</p>}
                {!onBreak && cashCountBlocking && (
                  <p className="flex items-center justify-center gap-1 text-center text-[11px] font-medium text-amber-600">
                    <AlertTriangle className="h-3 w-3" /> Selesaikan Hitung Kas Kasir untuk absen pulang
                  </p>
                )}
              </div>
            )}

            {/* Completion banner */}
            {checkedOut && (
              <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700">Shift complete · {fmtDuration(att.checkInTime, att.checkOutTime)}</span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeeAttendancePage() {
  const { data: session, status: sessionStatus } = useSession();

  const [slots,     setSlots]     = useState<ShiftSlot[]>([]);
  const [cashCount, setCashCount] = useState<CashCountPayload | null>(null);
  const [loading,   setLoading]   = useState(true);

  const user        = session?.user as { homeStoreId?: string | number } | undefined;
  const homeStoreId = user?.homeStoreId != null ? Number(user.homeStoreId) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/attendance');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AttResponse = await res.json();
      setSlots(json.shifts ?? []);
      setCashCount(json.cashCount ?? null);
    } catch (err) {
      console.error('[attendance load]', err);
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated' || homeStoreId == null || isNaN(homeStoreId)) {
      setLoading(false);
      return;
    }
    load();
  }, [sessionStatus, homeStoreId, load]);

  async function handleAction(
    action:     string,
    shift:      ShiftCode,
    breakType?: BreakType,
    cashOut?:   number,
    cashIn?:    number,
  ) {
    try {
      const body: Record<string, string | number> = { action, shift };
      if (breakType)        body.breakType = breakType;
      if (cashOut != null)  body.cashOut   = cashOut;
      if (cashIn  != null)  body.cashIn    = cashIn;

      const res  = await fetch('/api/employee/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      if (action === 'checkin') {
        if (json.action === 'returned_from_break') toast.success('Welcome back! Break ended.');
        else if (json.status === 'late')           toast.success('Checked in — marked as late.');
        else                                        toast.success('Checked in! Your tasks are ready.');
      } else if (action === 'checkout') {
        toast.success('Checked out. Great work!');
      } else if (action === 'startbreak') {
        const lbl = breakType?.replace('full_day_', '').replace('_', ' ') ?? 'break';
        toast.success(`${lbl.charAt(0).toUpperCase() + lbl.slice(1)} break started. Enjoy!`);
      } else if (action === 'endbreak') {
        toast.success('Welcome back from break!');
      }

      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  }

  if (sessionStatus === 'loading') {
    return (
      <div className="space-y-3 p-4">
        {[1, 2].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-200/60" />)}
      </div>
    );
  }

  const cashCountBlocking = Boolean(cashCount?.required && !cashCount?.done);
  const showCashCount = Boolean(cashCount && (cashCount.required || cashCount.done));

  return (
    <div className="flex flex-col">
      {/* Hero */}
      <div className="relative overflow-hidden bg-primary px-6 pb-7 pt-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 top-24 h-40 w-40 rounded-full bg-amber-300/5 blur-3xl" />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">Attendance</p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">Today</h1>
          <p className="mt-1 text-xs text-primary-foreground/50">{todayFull()}</p>

          {slots.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {slots.map(({ schedule, attendance: att }) => (
                <span key={schedule.scheduleId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/90">
                  <ShiftGlyph schedule={schedule} className="h-3 w-3" />
                  <span>{schedule.shiftLabel ?? schedule.shift}</span>
                  {att && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className={cn(
                        'font-semibold',
                        att.onBreak                ? 'text-amber-300'
                        : att.status === 'present' ? 'text-green-300'
                        : att.status === 'late'    ? 'text-amber-300'
                        : att.status === 'absent'  ? 'text-red-300'
                        : 'text-primary-foreground/70',
                      )}>
                        {att.onBreak ? 'On Break' : att.status}
                      </span>
                    </>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="space-y-4 bg-slate-50 p-4 pb-10">
        {loading && (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-200/60" />)}
          </div>
        )}

        {!loading && slots.length === 0 && (
          <Card className="shadow-sm">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                <CalendarX className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <p className="text-base font-bold text-foreground">Not scheduled today</p>
              <p className="mt-1.5 max-w-xs text-sm text-muted-foreground">
                You don&apos;t have a shift assigned for today. Contact your OPS manager if this looks wrong.
              </p>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[11px] font-medium text-amber-700">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Check-in is only available on scheduled shift days
              </div>
            </CardContent>
          </Card>
        )}

        {/* Attendance first */}
        {!loading && (
          <div className="space-y-3">
            {slots.map(slot => (
              <ShiftCard
                key={slot.schedule.scheduleId}
                slot={slot}
                cashCountBlocking={cashCountBlocking}
                onAction={handleAction}
              />
            ))}
          </div>
        )}

        {/* Cashier cash-count — kept below the shift cards */}
        {!loading && showCashCount && cashCount && (
          <div className="space-y-2">
            <p className="px-1 text-[11px] font-bold uppercase tracking-widest text-slate-400">Kas Kasir</p>
            <CashCountCard cashCount={cashCount} onDone={load} />
          </div>
        )}
      </div>
    </div>
  );
}
