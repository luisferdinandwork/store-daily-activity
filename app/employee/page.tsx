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
  ShoppingBag, Receipt, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

import { StoreContributionChart } from '@/components/employee/StoreContributionChart';
import { PerformanceMetricCard }  from '@/components/employee/PerformanceMetricCard';

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
  success: boolean;

  employeeId: string;
  employeeNik: string;
  employeeName: string;
  salesStaffCode: string;

  storeId: number | null;
  storeNo: string | null;
  storeName: string;

  date: string;
  yearMonth: string;

  scheduledDaysInMonth: number;
  targetSource?: 'employee' | 'store_split' | 'none';

  salesAmount: number;
  salesTarget: number;
  salesPct: number;

  transactionCount: number;
  transactionTarget: number;
  transactionPct: number;

  monthlySalesAmount: number;
  monthlySalesTarget: number;
  monthlySalesPct: number;

  monthlyTransactionCount: number;
  monthlyTransactionTarget: number;
  monthlyTransactionPct: number;

  monthlyAtv: number;
  monthlyAtvTarget?: number;

  storeMonthlySalesAmount: number;
  storeMonthlySalesTarget: number;
  storeMonthlySalesPct: number;

  storeMonthlyTransactionCount: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyTransactionPct: number;

  storeMonthlyAtvTarget?: number;

  employeeStoreContributionPct: number;

  warning?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });
}

function monthLabelFromYm(ym: string | undefined) {
  if (!ym) {
    return new Date().toLocaleDateString('en-ID', { month: 'long', year: 'numeric' });
  }
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-ID', { month: 'long', year: 'numeric' });
}

function fmtTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)         return `${Math.round(n / 1_000)}rb`;
  return String(n);
}

const ATT_CFG = {
  present: { Icon: CheckCircle2, label: 'Present', textClass: 'text-green-400',  bg: 'bg-white/10' },
  late:    { Icon: Clock,        label: 'Late',    textClass: 'text-amber-300',  bg: 'bg-white/10' },
  absent:  { Icon: XCircle,      label: 'Absent',  textClass: 'text-red-400',    bg: 'bg-white/10' },
  excused: { Icon: AlertCircle,  label: 'Excused', textClass: 'text-white/60',   bg: 'bg-white/10' },
};

// ─── PeriodToggle ─────────────────────────────────────────────────────────────

function PeriodToggle({
  value, onChange,
}: {
  value: 'daily' | 'monthly';
  onChange: (v: 'daily' | 'monthly') => void;
}) {
  return (
    <div className="relative flex h-9 w-full overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-1">
      {/* Sliding pill */}
      <span
        className="pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-out"
        style={{ transform: value === 'monthly' ? 'translateX(calc(100% + 0px))' : 'translateX(0%)' }}
      />
      {(['daily', 'monthly'] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            'relative z-10 flex flex-1 items-center justify-center text-[11px] font-bold uppercase tracking-widest transition-colors',
            value === v ? 'text-violet-700' : 'text-slate-400 hover:text-slate-600',
          )}
        >
          {v === 'daily' ? 'Hari ini' : 'Bulan ini'}
        </button>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { data: session, status: sessionStatus } = useSession();

  const [attSlots, setAttSlots] = useState<AttSlot[]>([]);
  const [perf,     setPerf]     = useState<PerformanceData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [period,   setPeriod]   = useState<'daily' | 'monthly'>('daily');

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

  const hasPerf      = !!perf?.success;
  const monthLabel   = monthLabelFromYm(perf?.yearMonth);

  return (
    <div className="flex flex-col">

      {/* ── Hero — greeting + shift status only ────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-10">
        {/* Decorative atmosphere */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 top-32 h-40 w-40 rounded-full bg-amber-300/5 blur-3xl" />

        <div className="relative space-y-4">
          {/* Greeting */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
              {greeting()}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">{firstName} 👋</h1>
            <p className="mt-1 text-xs text-primary-foreground/50">{todayLabel()}</p>

            <div className="mt-3 flex flex-wrap gap-2">
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
          {/* Store contribution chart */}
          {loading ? (
            <div className="h-56 animate-pulse rounded-2xl border " />
          ) : hasPerf ? (
            <div className="rounded-2xl">
              <StoreContributionChart
                employeeName={perf!.employeeName}
                employeeMonthlySales={perf!.monthlySalesAmount}
                storeMonthlySales={perf!.storeMonthlySalesAmount}
                contributionPct={perf!.employeeStoreContributionPct}
                monthLabel={monthLabel}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed px-5 py-8 text-center">
              <p className="text-xs font-medium text-slate-400">
                {perf?.warning && (
                  <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    {perf.warning}
                  </div>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Performance section — white background ──────────────────────── */}
      <div className="bg-white px-4 pt-5 pb-4">

        {/* Section header */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Performa
          </p>
          {hasPerf && (
            <p className="text-[10px] font-medium text-slate-400 truncate max-w-[55%] text-right">
              {perf!.storeName}
            </p>
          )}
        </div>

        

        {/* Period toggle + metric cards */}
        {hasPerf && (
          <div className="mt-4 space-y-3">
            {/* Period label + toggle */}
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {period === 'daily' ? 'Hari ini' : monthLabel}
              </p>
            </div>

            <PeriodToggle value={period} onChange={setPeriod} />

            {/* Metric cards */}
            <div key={period} className="space-y-3 animate-in fade-in duration-300">
              <div className="flex gap-3">
                {period === 'daily' ? (
                  <>
                    <MetricCardLight
                      icon={ShoppingBag}
                      iconBg="bg-violet-100"
                      iconColor="text-violet-600"
                      label="Sales"
                      value={`Rp ${fmtCompact(perf!.salesAmount)}`}
                      sub={`target Rp ${fmtCompact(perf!.salesTarget)}`}
                      pct={perf!.salesPct}
                      pctColor="bg-violet-500"
                    />
                    <MetricCardLight
                      icon={Receipt}
                      iconBg="bg-blue-100"
                      iconColor="text-blue-600"
                      label="Transaksi"
                      value={String(perf!.transactionCount)}
                      sub={`target ${perf!.transactionTarget}`}
                      pct={perf!.transactionPct}
                      pctColor="bg-blue-500"
                    />
                  </>
                ) : (
                  <>
                    <MetricCardLight
                      icon={ShoppingBag}
                      iconBg="bg-violet-100"
                      iconColor="text-violet-600"
                      label="Sales"
                      value={`Rp ${fmtCompact(perf!.monthlySalesAmount)}`}
                      sub={perf!.monthlySalesTarget
                        ? `target Rp ${fmtCompact(perf!.monthlySalesTarget)}`
                        : undefined}
                      pct={perf!.monthlySalesPct ?? 0}
                      pctColor="bg-violet-500"
                    />
                    <MetricCardLight
                      icon={Receipt}
                      iconBg="bg-blue-100"
                      iconColor="text-blue-600"
                      label="Transaksi"
                      value={String(perf!.monthlyTransactionCount)}
                      sub={perf!.monthlyTransactionTarget
                        ? `target ${perf!.monthlyTransactionTarget}`
                        : undefined}
                      pct={perf!.monthlyTransactionPct ?? 0}
                      pctColor="bg-blue-500"
                    />
                  </>
                )}
              </div>

              {period === 'monthly' && (
                <AtvCard atv={perf!.monthlyAtv} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="bg-slate-50 px-4 pt-5 pb-8">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-400">
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

// ─── Light MetricCard (for white bg section) ──────────────────────────────────

function MetricCardLight({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
  pct,
  pctColor,
}: {
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctColor: string;
}) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex-1 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', iconBg)}>
          <Icon className={cn('h-4 w-4', iconColor)} strokeWidth={2.2} />
        </div>
        <span className="text-[10px] font-bold tabular-nums text-slate-500">
          {Math.round(clamped)}%
        </span>
      </div>
      <p className="mt-2.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
      {/* Progress bar */}
      <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn('h-full rounded-full transition-all', pctColor)}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

// ─── ATV card (monthly only) ──────────────────────────────────────────────────

function AtvCard({ atv }: { atv: number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
        <Wallet className="h-4 w-4 text-emerald-600" strokeWidth={2.2} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ATV · Rata-rata transaksi</p>
        <p className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
          Rp {fmtCompact(atv)}
        </p>
      </div>
      <p className="text-[10px] text-slate-400 max-w-[35%] text-right leading-tight">
        Sales ÷ transaksi
      </p>
    </div>
  );
}