'use client';
// app/employee/attendance/page.tsx

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2, Clock, LogIn, LogOut, Sun, Moon,
  AlertCircle, Loader2, XCircle, CalendarX, Info,
  Coffee, UtensilsCrossed, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttStatus = 'present' | 'late' | 'absent' | 'excused';
type Shift     = 'morning' | 'evening';
type BreakType = 'lunch' | 'dinner';

interface BreakSession {
  id:           number;
  breakType:    BreakType;
  breakOutTime: string;
  returnTime:   string | null;
}

interface AttRecord {
  attendanceId:  number;
  scheduleId:    number;
  status:        AttStatus;
  shift:         Shift;
  checkInTime:   string | null;
  checkOutTime:  string | null;
  onBreak:       boolean;
  notes:         string | null;
  breaks:        BreakSession[];
}

interface ShiftSlot {
  schedule: {
    scheduleId: number;
    shift:      Shift;
    storeId:    number;
    date:       string;
  };
  attendance: AttRecord | null;
}

interface AttResponse {
  success: boolean;
  shifts:  ShiftSlot[];
}

// ─── Shift config ─────────────────────────────────────────────────────────────
const SHIFT_CFG = {
  morning: { startTime: '08:00', endTime: '17:00', breakType: 'lunch'  as BreakType, breakLabel: 'Lunch'  },
  evening: { startTime: '13:00', endTime: '22:00', breakType: 'dinner' as BreakType, breakLabel: 'Dinner' },
};

// ─── Status config ────────────────────────────────────────────────────────────
const STATUS_CFG: Record<AttStatus, {
  label:     string;
  Icon:      React.ElementType;
  borderCls: string;
  bgCls:     string;
  ringCls:   string;
  textCls:   string;
}> = {
  present: {
    label: 'Present', Icon: CheckCircle2,
    borderCls: 'border-green-300', bgCls: 'bg-green-50',
    ringCls: 'ring-green-200',     textCls: 'text-green-600',
  },
  late: {
    label: 'Late', Icon: Clock,
    borderCls: 'border-amber-300', bgCls: 'bg-amber-50',
    ringCls: 'ring-amber-200',     textCls: 'text-amber-600',
  },
  absent: {
    label: 'Absent', Icon: XCircle,
    borderCls: 'border-red-300',   bgCls: 'bg-red-50',
    ringCls: 'ring-red-200',       textCls: 'text-destructive',
  },
  excused: {
    label: 'Excused', Icon: AlertCircle,
    borderCls: 'border-border',    bgCls: 'bg-secondary',
    ringCls: 'ring-border',        textCls: 'text-muted-foreground',
  },
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

function todayFull() {
  return new Date().toLocaleDateString('en-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

// ─── Per-shift card ───────────────────────────────────────────────────────────
function ShiftCard({ slot, onAction }: {
  slot:     ShiftSlot;
  onAction: (action: string, shift: Shift) => Promise<void>;
}) {
  const [acting, setActing] = useState(false);

  const { schedule, attendance: att } = slot;
  const shift    = schedule.shift;
  const shiftCfg = SHIFT_CFG[shift];

  const checkedIn    = Boolean(att?.checkInTime);
  const checkedOut   = Boolean(att?.checkOutTime);
  const onBreak      = Boolean(att?.onBreak);
  const hasBreakLeft = att ? (att.breaks ?? []).length === 0 : false;
  const openBreak    = att?.breaks?.find(b => !b.returnTime) ?? null;
  const cfg          = att ? STATUS_CFG[att.status] : null;

  async function act(action: string) {
    setActing(true);
    try { await onAction(action, shift); }
    finally { setActing(false); }
  }

  const shiftAccent = shift === 'morning'
    ? { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-800', sub: 'text-amber-600', Icon: Sun,  iconCls: 'text-amber-500' }
    : { border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-800', sub: 'text-violet-600', Icon: Moon, iconCls: 'text-violet-500' };

  return (
    <div className="space-y-3">
      {/* Shift header */}
      <div className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-3', shiftAccent.border, shiftAccent.bg)}>
        <shiftAccent.Icon className={cn('h-5 w-5 flex-shrink-0', shiftAccent.iconCls)} />
        <div className="flex-1">
          <p className={cn('text-sm font-semibold capitalize', shiftAccent.text)}>
            {shift} shift
          </p>
          <p className={cn('text-xs', shiftAccent.sub)}>
            {shiftCfg.startTime} – {shiftCfg.endTime} · {shiftCfg.breakLabel} break · Late after 30 min
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

      {/* Not yet checked in */}
      {!att && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2.5">
              <LogIn className="h-5 w-5 flex-shrink-0 text-primary/60" />
              <div>
                <p className="text-sm font-semibold text-foreground">Ready to start?</p>
                <p className="text-xs text-muted-foreground">
                  Tap below to check in for your {shift} shift
                </p>
              </div>
            </div>
            <Button
              className="h-12 w-full gap-2 text-sm font-bold tracking-wide"
              onClick={() => act('checkin')}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {acting ? 'Checking in…' : 'Check In Now'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Checked in */}
      {att && cfg && (
        <>
          {/* Big status block */}
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
              <div>
                <p className={cn('text-xl font-bold', onBreak ? 'text-amber-600' : cfg.textCls)}>
                  {onBreak ? `On ${shiftCfg.breakLabel}` : cfg.label}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {shift} shift
                  {onBreak && openBreak && <> · since {fmtTime(openBreak.breakOutTime)}</>}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* On-break return card */}
          {onBreak && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2.5">
                  <UtensilsCrossed className="h-5 w-5 flex-shrink-0 text-amber-600" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800">
                      Currently on {shiftCfg.breakLabel} break
                    </p>
                    <p className="text-xs text-amber-600">
                      Tap below when you&apos;re back and ready to work
                    </p>
                  </div>
                </div>
                <Button
                  className="h-12 w-full gap-2 bg-amber-500 text-sm font-bold text-white hover:bg-amber-600"
                  onClick={() => act('endbreak')}
                  disabled={acting}
                >
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  {acting ? 'Returning…' : 'Return from Break'}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Time record */}
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Time Record
              </p>
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
                      <span className={cn('text-sm font-semibold', primary ? 'text-primary' : 'text-muted-foreground')}>
                        {value}
                      </span>
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
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Break Record
                </p>
                <div className="space-y-1">
                  {att.breaks.map((b) => (
                    <div key={b.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Coffee className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
                        <span className="text-sm capitalize">{b.breakType} break</span>
                      </div>
                      <span className="text-sm font-semibold text-muted-foreground">
                        {fmtTime(b.breakOutTime)}
                        {b.returnTime
                          ? <> – {fmtTime(b.returnTime)} <span className="text-xs font-normal">({fmtDuration(b.breakOutTime, b.returnTime)})</span></>
                          : <span className="ml-1 text-xs font-medium text-amber-500">ongoing</span>}
                      </span>
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

          {/* Action buttons */}
          {checkedIn && !checkedOut && (
            <div className="space-y-2">
              {!onBreak && hasBreakLeft && (
                <Button
                  variant="outline"
                  className={cn(
                    'h-12 w-full gap-2 text-sm font-semibold',
                    shiftCfg.breakType === 'dinner'
                      ? 'border-violet-200 text-violet-700 hover:bg-violet-50'
                      : 'border-amber-200 text-amber-700 hover:bg-amber-50',
                  )}
                  onClick={() => act('startbreak')}
                  disabled={acting}
                >
                  {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Coffee className="h-4 w-4" />}
                  {acting ? 'Starting break…' : `Take ${shiftCfg.breakLabel} Break`}
                </Button>
              )}

              <Button
                variant="outline"
                className="h-12 w-full gap-2 border-border text-sm font-semibold"
                onClick={() => act('checkout')}
                disabled={acting || onBreak}
                title={onBreak ? 'Return from break before checking out' : undefined}
              >
                {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                {acting ? 'Checking out…' : 'Check Out'}
              </Button>

              {onBreak && (
                <p className="text-center text-xs text-muted-foreground">
                  Return from break first to enable check-out
                </p>
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

  const [shifts,  setShifts]  = useState<ShiftSlot[]>([]);
  const [loading, setLoading] = useState(true);

  // Derive a stable primitive so the effect dependency doesn't re-fire on
  // every session object re-render. Coerce to number since schema uses serial.
  const user        = session?.user as any;
  const homeStoreId = user?.homeStoreId != null ? Number(user.homeStoreId) : null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/attendance');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AttResponse = await res.json();
      setShifts(json.shifts ?? []);
    } catch (err) {
      console.error('[attendance load]', err);
      toast.error('Failed to load attendance data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Wait until next-auth has finished resolving the session
    if (sessionStatus === 'loading') return;

    if (sessionStatus === 'unauthenticated' || homeStoreId == null || isNaN(homeStoreId)) {
      // No valid session or no store assigned — stop spinner, show empty state
      setLoading(false);
      return;
    }

    load();
  }, [sessionStatus, homeStoreId, load]);

  async function handleAction(action: string, shift: Shift) {
    try {
      const res  = await fetch('/api/employee/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, shift }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      if (action === 'checkin') {
        if (json.action === 'returned_from_break') toast.success('Welcome back! Break ended.');
        else if (json.status === 'late')            toast.success('Checked in — marked as late.');
        else                                         toast.success('Checked in! Your tasks are ready.');
      } else if (action === 'checkout') {
        toast.success('Checked out. Great work!');
      } else if (action === 'startbreak') {
        const label = json.breakType === 'dinner' ? 'Dinner' : 'Lunch';
        toast.success(`${label} break started. Enjoy!`);
      } else if (action === 'endbreak') {
        toast.success('Welcome back from break!');
      }

      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  }

  // Show skeleton while next-auth is still resolving
  if (sessionStatus === 'loading') {
    return (
      <div className="space-y-3 p-4">
        {[1, 2].map(i => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Purple header */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 bottom-0 h-24 w-24 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
            Attendance
          </p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">Today</h1>
          <p className="mt-1 text-xs text-primary-foreground/50">{todayFull()}</p>
        </div>

        {shifts.length > 0 && (
          <div className="relative mt-4 flex flex-wrap gap-2">
            {shifts.map(({ schedule, attendance: att }) => (
              <span
                key={schedule.scheduleId}
                className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground"
              >
                {schedule.shift === 'morning'
                  ? <Sun  className="h-3 w-3" />
                  : <Moon className="h-3 w-3" />}
                <span className="capitalize">{schedule.shift}</span>
                {att && (
                  <>
                    <span className="opacity-40">·</span>
                    <span className={cn(
                      att.onBreak                ? 'text-amber-300'
                      : att.status === 'present' ? 'text-green-300'
                      : att.status === 'late'    ? 'text-amber-300'
                      :                            'text-red-300',
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
            {[1, 2].map(i => (
              <div key={i} className="h-40 animate-pulse rounded-xl bg-secondary" />
            ))}
          </div>
        )}

        {!loading && shifts.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center py-12 text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary">
                <CalendarX className="h-8 w-8 text-muted-foreground/40" />
              </div>
              <p className="text-base font-semibold text-foreground">Not scheduled today</p>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                You don&apos;t have a shift assigned for today. Contact your OPS manager if you
                believe this is incorrect.
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-700">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                Check-in is only available on scheduled shift days
              </div>
            </CardContent>
          </Card>
        )}

        {!loading && shifts.map(slot => (
          <ShiftCard
            key={slot.schedule.scheduleId}
            slot={slot}
            onAction={handleAction}
          />
        ))}
      </div>
    </div>
  );
}