'use client';
// app/employee/page.tsx

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckSquare, ChevronRight, UserCircle,
  Sun, Moon, LogIn, CalendarDays,
  CheckCircle2, Clock, XCircle, AlertCircle, Zap,
  ShoppingBag, Receipt,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRupiah } from '@/lib/utils';

interface AttSlot {
  schedule: { shift: 'morning' | 'evening' | 'full_day' };
  attendance: {
    status: 'present' | 'late' | 'absent' | 'excused';
    checkInTime:  string | null;
    checkOutTime: string | null;
    onBreak: boolean;
  } | null;
}

interface PerformanceData {
  success:           boolean;
  employeeName:      string;
  storeName:         string;
  date:              string;
  salesAmount:       number;
  salesTarget:       number;
  salesPct:          number;
  transactionCount:  number;
  transactionTarget: number;
  transactionPct:    number;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fmtTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}rb`;
  return String(n);
}

const ATT_CFG = {
  present: { Icon: CheckCircle2, label: 'Present', textClass: 'text-green-400',  bg: 'bg-white/10' },
  late:    { Icon: Clock,        label: 'Late',    textClass: 'text-amber-300',  bg: 'bg-white/10' },
  absent:  { Icon: XCircle,      label: 'Absent',  textClass: 'text-red-400',    bg: 'bg-white/10' },
  excused: { Icon: AlertCircle,  label: 'Excused', textClass: 'text-white/60',   bg: 'bg-white/10' },
};

// ─── Metric card ──────────────────────────────────────────────────────────────

// Mini ring — same SVG technique as the task page RingProgress
function MiniRing({ pct, color }: { pct: number; color: string }) {
  const size   = 52;
  const r      = 22;
  const circ   = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, pct) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {/* Track */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={5} />
        {/* Progress arc */}
        <circle cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s ease' }}
        />
      </svg>
      {/* Centre label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold text-white">{pct}%</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon, label, value, sub, pct, accentColor,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  pct: number;
  accentColor: string;
}) {
  const ringColor = pct >= 100 ? '#4ade80' : pct >= 60 ? '#fbbf24' : 'rgba(255,255,255,0.4)';

  return (
    <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.08] p-3.5">
      {/* Top row: icon left, ring right */}
      <div className="flex items-start justify-between gap-2">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', accentColor)}>
          <Icon className="h-4 w-4 text-white" strokeWidth={2} />
        </div>
        <MiniRing pct={pct} color={ringColor} />
      </div>

      {/* Value + label */}
      <p className="mt-2.5 text-xl font-bold leading-none text-white">{value}</p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/50">{label}</p>
      <p className="mt-0.5 text-[10px] text-white/35">{sub}</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { data: session, status: sessionStatus } = useSession();

  const [attSlots, setAttSlots] = useState<AttSlot[]>([]);
  const [perf,     setPerf]     = useState<PerformanceData | null>(null);
  const [loading,  setLoading]  = useState(true);

  const user      = session?.user as any;
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated') { setLoading(false); return; }

    Promise.all([
      fetch('/api/employee/attendance').then(r => r.json()),
      fetch('/api/employee/performance').then(r => r.json()),
    ])
      .then(([attData, perfData]) => {
        if (attData.success && Array.isArray(attData.shifts)) setAttSlots(attData.shifts);
        if (perfData.success) setPerf(perfData as PerformanceData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionStatus]);

  const primaryShift = attSlots[0]?.schedule.shift ?? 'morning';
  const primaryAtt   = attSlots[0]?.attendance ?? null;
  const isOnBreak    = primaryAtt?.onBreak ?? false;
  const attCfg       = primaryAtt ? ATT_CFG[primaryAtt.status] : null;

  return (
    <div className="flex flex-col">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-7 pt-12">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 top-4 h-28 w-28 rounded-full bg-white/5" />

        <div className="relative space-y-5">

          {/* Greeting */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
              {greeting()}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">{firstName} 👋</h1>
            <p className="mt-1 text-xs text-primary-foreground/50">{todayLabel()}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              {/* Shift pill */}
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/80">
                {primaryShift === 'morning'  && <Sun  className="h-3 w-3" />}
                {primaryShift === 'evening'  && <Moon className="h-3 w-3" />}
                {primaryShift === 'full_day' && <Zap  className="h-3 w-3" />}
                {primaryShift === 'morning'  ? 'Morning shift'
                  : primaryShift === 'evening' ? 'Evening shift'
                  : 'Full Day shift'}
              </div>

              {/* Attendance pill */}
              {primaryAtt && attCfg ? (
                <div className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                  isOnBreak ? 'bg-amber-500/20 text-amber-200' : `${attCfg.bg} ${attCfg.textClass}`,
                )}>
                  {isOnBreak ? <Clock className="h-3 w-3" /> : <attCfg.Icon className="h-3 w-3" />}
                  {isOnBreak ? 'On Break' : attCfg.label}
                  {primaryAtt.checkInTime && !isOnBreak && (
                    <span className="opacity-70">· In {fmtTime(primaryAtt.checkInTime)}</span>
                  )}
                </div>
              ) : !loading && attSlots.length > 0 ? (
                <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/60">
                  <LogIn className="h-3 w-3" />
                  Not checked in
                </div>
              ) : null}
            </div>
          </div>

          {/* Performance */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary-foreground/40">
                Today's Performance
              </p>
              {perf && (
                <p className="text-[10px] text-primary-foreground/30">{perf.storeName}</p>
              )}
            </div>

            {loading ? (
              <div className="flex gap-3">
                <div className="h-[7.5rem] flex-1 animate-pulse rounded-2xl bg-white/10" />
                <div className="h-[7.5rem] flex-1 animate-pulse rounded-2xl bg-white/10" />
              </div>
            ) : perf ? (
              <div className="flex gap-3">
                <MetricCard
                  icon={ShoppingBag}
                  label="Sales"
                  value={`Rp ${fmtCompact(perf.salesAmount)}`}
                  sub={`target Rp ${fmtCompact(perf.salesTarget)}`}
                  pct={perf.salesPct}
                  accentColor="bg-blue-500/60"
                />
                <MetricCard
                  icon={Receipt}
                  label="Transaksi"
                  value={String(perf.transactionCount)}
                  sub={`target ${perf.transactionTarget}`}
                  pct={perf.transactionPct}
                  accentColor="bg-violet-500/60"
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-5 text-center">
                <p className="text-xs text-white/40">Data performa tidak tersedia</p>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-5 pb-8">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Quick Actions
        </p>

        <div className="space-y-2.5">
          <Link href="/employee/tasks">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CheckSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">My Tasks</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">View and complete today's shift tasks</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/employee/attendance">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  primaryAtt && !isOnBreak ? 'bg-green-100' : 'bg-amber-50',
                )}>
                  <CalendarDays className={cn('h-5 w-5', primaryAtt && !isOnBreak ? 'text-green-600' : 'text-amber-600')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Attendance</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {loading
                      ? 'Loading…'
                      : isOnBreak
                        ? 'Currently on break'
                        : primaryAtt
                          ? `${attCfg?.label} · ${primaryAtt.checkOutTime ? 'Shift complete' : 'Check-out when done'}`
                          : attSlots.length > 0
                            ? 'Tap to check in for your shift'
                            : 'No shift scheduled today'}
                  </p>
                </div>
                {!primaryAtt && !loading && attSlots.length > 0 && (
                  <Badge className="shrink-0 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">
                    Action needed
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/employee/profile">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">My Profile</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">View schedule &amp; account info</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}