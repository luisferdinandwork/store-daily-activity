'use client';
// app/employee/attendance/page.tsx

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, Clock, LogIn, LogOut, Sun, Moon,
  AlertCircle, Loader2, XCircle, CalendarX, Info,
  Coffee, UtensilsCrossed, RotateCcw, Zap, AlertTriangle,
  Banknote,
} from 'lucide-react';
import { cn, formatRupiah } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttStatus  = 'present' | 'late' | 'absent' | 'excused';
type ShiftCode  = 'morning' | 'evening' | 'full_day' | string;
type BreakType  = 'lunch' | 'dinner' | 'full_day_lunch' | 'full_day_dinner';

interface BreakSession {
  id:           number;
  breakType:    BreakType;
  breakOutTime: string;
  returnTime:   string | null;
  cashOut:      number;        // amount taken out — always present
  cashIn:       number | null; // amount brought back — null until returned
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
  };
  attendance: AttRecord | null;
}

interface AttResponse {
  success: boolean;
  shifts:  ShiftSlot[];
}

// ─── Break config per shift ───────────────────────────────────────────────────

interface BreakConfig {
  breakType:  BreakType;
  label:      string;
  accentCls:  string;
  bgCls:      string;
  isAmber:    boolean;
}

const SHIFT_BREAKS: Record<string, BreakConfig[]> = {
  morning:  [{ breakType: 'lunch',            label: 'Lunch',         accentCls: 'border-amber-200 text-amber-700',  bgCls: 'hover:bg-amber-50',  isAmber: true  }],
  evening:  [{ breakType: 'dinner',           label: 'Dinner',        accentCls: 'border-violet-200 text-violet-700', bgCls: 'hover:bg-violet-50', isAmber: false }],
  full_day: [
    { breakType: 'full_day_lunch',  label: 'Lunch Break',  accentCls: 'border-amber-200 text-amber-700',  bgCls: 'hover:bg-amber-50',  isAmber: true  },
    { breakType: 'full_day_dinner', label: 'Dinner Break', accentCls: 'border-violet-200 text-violet-700', bgCls: 'hover:bg-violet-50', isAmber: false },
  ],
};

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<AttStatus, { label: string; Icon: React.ElementType; borderCls: string; bgCls: string; ringCls: string; textCls: string }> = {
  present: { label: 'Present', Icon: CheckCircle2, borderCls: 'border-green-300', bgCls: 'bg-green-50',   ringCls: 'ring-green-200',  textCls: 'text-green-600'        },
  late:    { label: 'Late',    Icon: Clock,        borderCls: 'border-amber-300', bgCls: 'bg-amber-50',   ringCls: 'ring-amber-200',  textCls: 'text-amber-600'        },
  absent:  { label: 'Absent',  Icon: XCircle,      borderCls: 'border-red-300',   bgCls: 'bg-red-50',     ringCls: 'ring-red-200',    textCls: 'text-destructive'      },
  excused: { label: 'Excused', Icon: AlertCircle,  borderCls: 'border-border',    bgCls: 'bg-secondary',  ringCls: 'ring-border',     textCls: 'text-muted-foreground' },
};

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


function shiftIcon(code: ShiftCode) {
  if (code === 'morning')  return <Sun  className="h-5 w-5 flex-shrink-0 text-amber-500" />;
  if (code === 'evening')  return <Moon className="h-5 w-5 flex-shrink-0 text-violet-500" />;
  if (code === 'full_day') return <Zap  className="h-5 w-5 flex-shrink-0 text-emerald-500" />;
  return <Clock className="h-5 w-5 flex-shrink-0 text-slate-500" />;
}

function shiftAccent(code: ShiftCode) {
  if (code === 'morning')  return { border: 'border-amber-200',   bg: 'bg-amber-50',   text: 'text-amber-800',   sub: 'text-amber-600'   };
  if (code === 'evening')  return { border: 'border-violet-200',  bg: 'bg-violet-50',  text: 'text-violet-800',  sub: 'text-violet-600'  };
  if (code === 'full_day') return { border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-800', sub: 'text-emerald-600' };
  return { border: 'border-slate-200', bg: 'bg-slate-50', text: 'text-slate-800', sub: 'text-slate-600' };
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

function CashInput({
  label,
  value,
  onChange,
  isAmber,
  disabled,
  required = true,
}: {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  isAmber:  boolean;
  disabled: boolean;
  required?: boolean;
}) {
  const border  = isAmber ? 'border-amber-200'  : 'border-violet-200';
  const bg      = isAmber ? 'bg-amber-50'       : 'bg-violet-50';
  const text    = isAmber ? 'text-amber-800'    : 'text-violet-800';
  const subtext = isAmber ? 'text-amber-600'    : 'text-violet-600';
  const ring    = isAmber ? 'focus:ring-amber-200' : 'focus:ring-violet-200';
  const inputTx = isAmber ? 'text-amber-900 placeholder:text-amber-300' : 'text-violet-900 placeholder:text-violet-300';

  // While focused: raw digits so the user can edit freely.
  // On blur: Rupiah-formatted number (dots as thousand separators, e.g. "150.000").
  const [focused, setFocused] = useState(false);
  const numericValue = parseFloat(value);
  const displayValue = !focused && value !== '' && !isNaN(numericValue)
    ? formatRupiah(numericValue, false)
    : value;

  return (
    <div className={cn('rounded-xl border px-3.5 py-3 space-y-2', border, bg)}>
      <div className="flex items-center gap-2">
        <Banknote className={cn('h-4 w-4 flex-shrink-0', isAmber ? 'text-amber-500' : 'text-violet-500')} />
        <p className={cn('text-sm font-semibold flex-1', text)}>{label}</p>
        {required && (
          <span className={cn('text-xs font-medium', subtext)}>Required</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={cn('text-sm font-bold', isAmber ? 'text-amber-700' : 'text-violet-700')}>Rp</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={displayValue}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={e => {
            // Keep only digits in state so numeric parsing stays clean
            const digits = e.target.value.replace(/\D/g, '');
            onChange(digits);
          }}
          className={cn(
            'flex-1 rounded-lg border bg-white px-3 py-2 text-sm font-semibold outline-none transition focus:ring-2',
            border, inputTx, ring,
          )}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ─── Per-shift card ───────────────────────────────────────────────────────────

function ShiftCard({ slot, onAction }: {
  slot:     ShiftSlot;
  onAction: (
    action:    string,
    shift:     ShiftCode,
    breakType?: BreakType,
    cashOut?:   number,
    cashIn?:    number,
  ) => Promise<void>;
}) {
  const [acting, setActing]           = useState<string | null>(null);
  const [cashOutInputs, setCashOutInputs] = useState<Partial<Record<BreakType, string>>>({});
  const [cashInInput,   setCashInInput]   = useState('');

  useEffect(() => {
    const interval = setInterval(() => {}, 60000);
    return () => clearInterval(interval);
  }, []);

  const { schedule, attendance: att } = slot;
  const shift     = schedule.shift;
  const accent    = shiftAccent(shift);
  const breakCfgs = SHIFT_BREAKS[shift] ?? SHIFT_BREAKS['morning'];

  const checkedIn  = Boolean(att?.checkInTime);
  const checkedOut = Boolean(att?.checkOutTime);
  const onBreak    = Boolean(att?.onBreak);
  const cfg        = att ? STATUS_CFG[att.status] : null;

  const minutesLate  = getMinutesElapsedSince(schedule.startTime);
  const isLateByTime = minutesLate !== null && minutesLate > 0;
  const timeStr      = [formatTime(schedule.startTime), formatTime(schedule.endTime)].filter(Boolean).join(' – ');

  const usedBreakTypes    = new Set((att?.breaks ?? []).map(b => b.breakType));
  const availableBreaks   = breakCfgs.filter(bc => !usedBreakTypes.has(bc.breakType));
  const openBreak         = att?.breaks?.find(b => !b.returnTime) ?? null;

  async function act(action: string, breakType?: BreakType, cashOut?: number, cashIn?: number) {
    setActing(breakType ?? action);
    try { await onAction(action, shift, breakType, cashOut, cashIn); }
    finally { setActing(null); }
  }

  // cashIn validation
  const cashInNum   = parseFloat(cashInInput);
  const cashInValid = cashInInput !== '' && !isNaN(cashInNum) && cashInNum >= 0;

  return (
    <div className="space-y-3">
      {/* Shift header */}
      <div className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-3', accent.border, accent.bg)}>
        {shiftIcon(shift)}
        <div className="flex-1">
          <p className={cn('text-sm font-semibold', accent.text)}>
            {schedule.shiftLabel ?? shift}
          </p>
          <p className={cn('text-xs', accent.sub)}>
            {timeStr && <>{timeStr} · </>}
            {breakCfgs.map(b => b.label).join(' & ')} break
          </p>
        </div>
        {cfg && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
            onBreak ? 'bg-amber-100 text-amber-700' : `${cfg.bgCls} ${cfg.textCls}`,
          )}>
            {onBreak
              ? <><Coffee className="h-3 w-3" /> On Break</>
              : <><cfg.Icon className="h-3 w-3" /> {cfg.label}</>}
          </span>
        )}
      </div>

      {/* ── Not yet checked in ─────────────────────────────────────────────── */}
      {!att && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2.5">
              <LogIn className="h-5 w-5 flex-shrink-0 text-primary/60" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Ready to start?</p>
                <p className="text-xs text-muted-foreground">Tap below to check in for your {schedule.shiftLabel ?? shift} shift</p>
              </div>
            </div>

            {isLateByTime && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <p className="text-xs font-medium text-amber-700">
                  Shift started at {formatTime(schedule.startTime)}. You are {minutesLate!} minutes late.
                  Checking in now will be recorded as <span className="font-bold">Late</span>.
                </p>
              </div>
            )}

            <Button
              className="h-12 w-full gap-2 text-sm font-bold tracking-wide"
              onClick={() => act('checkin')}
              disabled={acting !== null}
            >
              {acting === 'checkin' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {acting === 'checkin' ? 'Checking in…' : 'Check In Now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Checked in ────────────────────────────────────────────────────── */}
      {att && cfg && (
        <>
          {/* Status block */}
          <Card className={cn('border-2', onBreak ? 'border-amber-300' : cfg.borderCls)}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className={cn(
                'flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl ring-4',
                onBreak ? 'bg-amber-50 ring-amber-200' : `${cfg.bgCls} ${cfg.ringCls}`,
              )}>
                {onBreak
                  ? <Coffee className="h-7 w-7 text-amber-500" strokeWidth={2} />
                  : <cfg.Icon className={cn('h-7 w-7', cfg.textCls)} strokeWidth={2} />}
              </div>
              <div className="flex-1">
                <p className={cn('text-xl font-bold', onBreak ? 'text-amber-600' : cfg.textCls)}>
                  {onBreak
                    ? `On Break${openBreak ? ` · ${openBreak.breakType.replace('full_day_', '').replace('_', ' ')}` : ''}`
                    : cfg.label}
                </p>
                <p className="text-xs text-muted-foreground">
                  {schedule.shiftLabel ?? shift} shift
                  {onBreak && openBreak && <> · since {fmtTime(openBreak.breakOutTime)}</>}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── On-break return card (with cashIn input) ────────────────── */}
          {onBreak && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2.5">
                  <UtensilsCrossed className="h-5 w-5 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">Currently on break</p>
                    <p className="text-xs text-amber-600">Enter the cash you're bringing back, then tap return</p>
                  </div>
                </div>

                <CashInput
                  label="Cash brought back"
                  value={cashInInput}
                  onChange={setCashInInput}
                  isAmber={true}
                  disabled={acting !== null}
                  required={true}
                />

                <Button
                  className="h-12 w-full gap-2 bg-amber-500 text-sm font-bold text-white hover:bg-amber-600"
                  onClick={() => {
                    act('endbreak', undefined, undefined, cashInNum);
                    setCashInInput('');
                  }}
                  disabled={acting !== null || !cashInValid}
                  title={!cashInValid ? 'Enter cash amount to continue' : undefined}
                >
                  {acting === 'endbreak' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {acting === 'endbreak' ? 'Returning…' : 'Return from Break'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Time record */}
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Time Record</p>
              <div>
                {([
                  { label: 'Check-in',  value: fmtTime(att.checkInTime),  Icon: LogIn,  primary: Boolean(att.checkInTime)  },
                  { label: 'Check-out', value: fmtTime(att.checkOutTime), Icon: LogOut, primary: Boolean(att.checkOutTime) },
                  { label: 'Duration',  value: fmtDuration(att.checkInTime, att.checkOutTime), Icon: Clock, primary: false },
                ] as const).map(({ label, value, Icon, primary }, i, arr) => (
                  <div key={label}>
                    <div className="flex items-center justify-between py-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                        <span className="text-sm">{label}</span>
                      </div>
                      <span className={cn('text-sm font-semibold', primary ? 'text-primary' : 'text-muted-foreground')}>{value}</span>
                    </div>
                    {i < arr.length - 1 && <div className="h-px bg-border" />}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Break history */}
          {(att.breaks ?? []).length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Break Record</p>
                <div className="space-y-1">
                  {att.breaks.map((b, i, arr) => (
                    <div key={b.id}>
                      <div className="py-2 space-y-1.5">
                        {/* Time row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Coffee className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                            <span className="text-sm capitalize">
                              {b.breakType.replace('full_day_', '').replace('_', ' ')} break
                            </span>
                          </div>
                          <span className="text-sm font-semibold text-muted-foreground">
                            {fmtTime(b.breakOutTime)}
                            {b.returnTime
                              ? <> – {fmtTime(b.returnTime)} <span className="text-xs font-normal">({fmtDuration(b.breakOutTime, b.returnTime)})</span></>
                              : <span className="ml-1 text-xs font-medium text-amber-500">ongoing</span>}
                          </span>
                        </div>

                        {/* Cash row */}
                        <div className="flex items-center justify-between pl-6">
                          <div className="flex items-center gap-1.5">
                            <Banknote className="h-3.5 w-3.5 text-muted-foreground/60" strokeWidth={1.75} />
                            <span className="text-xs text-muted-foreground">
                              Out: <span className="font-semibold text-foreground">{formatRupiah(b.cashOut)}</span>
                            </span>
                          </div>
                          {b.cashIn != null
                            ? (
                              <span className="text-xs text-muted-foreground">
                                In: <span className="font-semibold text-foreground">{formatRupiah(b.cashIn)}</span>
                              </span>
                            )
                            : (
                              <span className="text-xs font-medium text-amber-500">awaiting return</span>
                            )}
                        </div>
                      </div>
                      {i < arr.length - 1 && <div className="h-px bg-border" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* OPS note */}
          {att.notes && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="flex items-start gap-2.5 p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div>
                  <p className="text-xs font-semibold text-amber-800">Note from OPS</p>
                  <p className="mt-0.5 text-sm text-amber-700">{att.notes}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Action buttons ─────────────────────────────────────────────── */}
          {checkedIn && !checkedOut && (
            <div className="space-y-3">
              {/* Break buttons — one per available break type, each with cash input */}
              {!onBreak && availableBreaks.map(bc => {
                const inputVal   = cashOutInputs[bc.breakType] ?? '';
                const cashOutNum = parseFloat(inputVal);
                const isValid    = inputVal !== '' && !isNaN(cashOutNum) && cashOutNum >= 0;

                return (
                  <div key={bc.breakType} className="space-y-2">
                    <CashInput
                      label={`Cash taken out — ${bc.label}`}
                      value={inputVal}
                      onChange={v => setCashOutInputs(prev => ({ ...prev, [bc.breakType]: v }))}
                      isAmber={bc.isAmber}
                      disabled={acting !== null}
                      required={true}
                    />

                    <Button
                      variant="outline"
                      className={cn('h-12 w-full gap-2 text-sm font-semibold', bc.accentCls, bc.bgCls)}
                      onClick={() => {
                        act('startbreak', bc.breakType, cashOutNum, undefined);
                        // Clear this input after submitting
                        setCashOutInputs(prev => ({ ...prev, [bc.breakType]: '' }));
                      }}
                      disabled={acting !== null || !isValid}
                      title={!isValid ? 'Enter cash amount to continue' : undefined}
                    >
                      {acting === bc.breakType
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Coffee className="h-4 w-4" />}
                      {acting === bc.breakType ? 'Starting break…' : `Take ${bc.label}`}
                    </Button>
                  </div>
                );
              })}

              <Button
                variant="outline"
                className="h-12 w-full gap-2 border-border text-sm font-semibold"
                onClick={() => act('checkout')}
                disabled={acting !== null || onBreak}
                title={onBreak ? 'Return from break before checking out' : undefined}
              >
                {acting === 'checkout' ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                {acting === 'checkout' ? 'Checking out…' : 'Check Out'}
              </Button>

              {onBreak && (
                <p className="text-center text-xs text-muted-foreground">Return from break first to enable check-out</p>
              )}
            </div>
          )}

          {/* Completion banner */}
          {checkedOut && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 py-4">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">
                Shift complete · {fmtDuration(att.checkInTime, att.checkOutTime)}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeeAttendancePage() {
  const { data: session, status: sessionStatus } = useSession();

  const [slots,   setSlots]   = useState<ShiftSlot[]>([]);
  const [loading, setLoading] = useState(true);

  const user        = session?.user as any;
  const homeStoreId = user?.homeStoreId != null ? Number(user.homeStoreId) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/attendance');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AttResponse = await res.json();
      setSlots(json.shifts ?? []);
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
      if (breakType)           body.breakType = breakType;
      if (cashOut  != null)    body.cashOut   = cashOut;
      if (cashIn   != null)    body.cashIn    = cashIn;

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
        {[1, 2].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 bottom-0 h-24 w-24 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">Attendance</p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">Today</h1>
          <p className="mt-1 text-xs text-primary-foreground/50">{todayFull()}</p>
        </div>

        {slots.length > 0 && (
          <div className="relative mt-4 flex flex-wrap gap-2">
            {slots.map(({ schedule, attendance: att }) => (
              <span
                key={schedule.scheduleId}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                {schedule.shift === 'morning'
                  ? <Sun  className="h-3 w-3" />
                  : schedule.shift === 'evening'
                    ? <Moon className="h-3 w-3" />
                    : <Zap  className="h-3 w-3" />}
                <span>{schedule.shiftLabel ?? schedule.shift}</span>
                {att && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className={cn(
                      att.onBreak          ? 'text-amber-300'
                      : att.status === 'present' ? 'text-green-300'
                      : att.status === 'late'    ? 'text-amber-300'
                      : 'text-red-300',
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

      {/* Body */}
      <div className="space-y-6 p-4 pb-10">
        {loading && (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary" />)}
          </div>
        )}

        {!loading && slots.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <CalendarX className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-base font-semibold text-foreground">Not scheduled today</p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                You don&apos;t have a shift assigned for today. Contact your OPS manager if you believe this is incorrect.
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-700">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Check-in is only available on scheduled shift days
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && slots.map(slot => (
          <ShiftCard key={slot.schedule.scheduleId} slot={slot} onAction={handleAction} />
        ))}
      </div>
    </div>
  );
}