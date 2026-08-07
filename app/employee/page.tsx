"use client";
// app/employee/page.tsx

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckSquare,
  ChevronRight,
  UserCircle,
  Sun,
  Moon,
  LogIn,
  CalendarDays,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Zap,
  CalendarOff,
  Receipt,
  CircleDollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { EmployeeTargetGauge } from "@/components/employee/EmployeeTargetGauge";
import { StoreContributionPie } from "@/components/employee/StoreContributionPie";

interface AttSlot {
  schedule: {
    shift: "morning" | "evening" | "full_day";
    shiftLabel?: string | null;
    /** "HH:MM:SS", store-local wall-clock time. */
    startTime?: string | null;
  };
  attendance: {
    status: "present" | "late" | "absent" | "excused";
    checkInTime: string | null;
    checkOutTime: string | null;
    onBreak: boolean;
  } | null;
}

/** Combines today's date with a "HH:MM:SS" wall-clock time, same convention
 *  as the check-in "late" cutoff in lib/schedule-utils.ts (employeeCheckIn). */
function todayAt(time: string): Date {
  const [h, m, s] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, s || 0, 0);
  return d;
}

interface EmployeeContribution {
  userId: string;
  nik: string;
  name: string;
  isCurrentUser: boolean;
  contributionPct: number;
  targetSharePct: number;
  reachedGoal: boolean;
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

  /**
   * roster            — employee is on the store's target roster this month.
   * not_on_roster      — Ops hasn't added this employee to the roster yet.
   * no_store_target    — Ops hasn't set a monthly target for the store yet.
   */
  targetSource?: "roster" | "not_on_roster" | "no_store_target";

  /** PIC1 | PIC2 | SA — the employee's fixed roster role. */
  employeeTargetRoleCode?: string | null;
  /** Today's slot, e.g. "SA2" — null if not scheduled to work today. */
  employeeSlotCode?: string | null;
  /** Today's share of the store's daily target, as a %. 0 if not scheduled. */
  dailyAllocationPct?: number;
  /** Explicit aliases returned by the corrected performance API. */
  dailyTargetSharePct?: number;
  monthlyTargetSharePct?: number;
  /** False = employee has no shift today, so today's target is Rp 0 by design. */
  isScheduledToday?: boolean;

  salesAmount: number;
  /** Employee target for today. */
  salesTarget: number;
  employeeDailySalesTarget?: number;
  salesPct: number;
  dailySalesAchievementPct?: number;

  transactionCount: number;
  transactionTarget: number;
  transactionPct: number;

  monthlySalesAmount: number;
  /** Employee target for the month. */
  monthlySalesTarget: number;
  employeeMonthlySalesTarget?: number;
  monthlySalesPct: number;
  monthlySalesAchievementPct?: number;

  monthlyTransactionCount: number;
  monthlyTransactionTarget: number;
  monthlyTransactionPct: number;

  monthlyAtv: number;
  monthlyAtvTarget?: number;

  /** Store-wide actuals/target for TODAY — the daily counterpart to the storeMonthly* fields below. */
  storeDailySalesAmount?: number;
  storeDailyTransactionCount?: number;
  storeDailySalesTarget?: number;
  storeDailyTransactionTarget?: number;

  storeMonthlySalesAmount: number;
  storeMonthlySalesTarget: number;
  storeMonthlySalesPct: number;

  storeMonthlyTransactionCount: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyTransactionPct: number;

  storeMonthlyAtvTarget?: number;

  /** Employee's % of the store's ACTUAL sales TODAY. */
  employeeDailyContributionPct?: number;
  /** Employee's % of the store's ACTUAL sales this month. */
  employeeStoreContributionPct: number;

  /** Whole-roster contribution-to-target breakdown, each employee capped at
   *  their own target-allocation share. Powers the store contribution pie. */
  dailyEmployeeContributions?: EmployeeContribution[];
  monthlyEmployeeContributions?: EmployeeContribution[];

  warning?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Date().toLocaleDateString("en-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function monthLabelFromYm(ym: string | undefined) {
  if (!ym) {
    return new Date().toLocaleDateString("en-ID", {
      month: "long",
      year: "numeric",
    });
  }
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-ID", {
    month: "long",
    year: "numeric",
  });
}

function fmtTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculatePct(
  actual: number | null | undefined,
  target: number | null | undefined,
) {
  const safeActual = Number(actual ?? 0);
  const safeTarget = Number(target ?? 0);

  if (
    !Number.isFinite(safeActual) ||
    !Number.isFinite(safeTarget) ||
    safeTarget <= 0
  ) {
    return 0;
  }

  return Math.round((safeActual / safeTarget) * 1000) / 10;
}

function fmtCompactRp(value: number | null | undefined): string {
  const n = Math.max(0, Number(value ?? 0));
  if (!Number.isFinite(n)) return "Rp 0";
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)}rb`;
  return `Rp ${Math.round(n)}`;
}

const ATT_CFG = {
  present: {
    Icon: CheckCircle2,
    label: "Present",
    textClass: "text-green-400",
    bg: "bg-white/10",
  },
  late: {
    Icon: Clock,
    label: "Late",
    textClass: "text-amber-300",
    bg: "bg-white/10",
  },
  absent: {
    Icon: XCircle,
    label: "Absent",
    textClass: "text-red-400",
    bg: "bg-white/10",
  },
  excused: {
    Icon: AlertCircle,
    label: "Excused",
    textClass: "text-white/60",
    bg: "bg-white/10",
  },
};

// ─── PeriodToggle ─────────────────────────────────────────────────────────────

function PeriodToggle({
  value,
  onChange,
}: {
  value: "daily" | "monthly";
  onChange: (v: "daily" | "monthly") => void;
}) {
  return (
    <div className="relative flex h-9 w-[200px] shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-1">
      {/* Sliding pill */}
      <span
        className="pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white shadow-sm transition-transform duration-300 ease-out"
        style={{
          transform:
            value === "monthly"
              ? "translateX(calc(100% + 0px))"
              : "translateX(0%)",
        }}
      />
      {(["daily", "monthly"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "relative z-10 flex flex-1 items-center justify-center text-[11px] font-bold uppercase tracking-widest transition-colors",
            value === v
              ? "text-violet-700"
              : "text-slate-400 hover:text-slate-600",
          )}
        >
          {v === "daily" ? "Hari ini" : "Bulan ini"}
        </button>
      ))}
    </div>
  );
}

// ─── StatTile — small secondary metric card in the light Performance section ──

function StatTile({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
  pct,
}: {
  icon: typeof Receipt;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string;
  sub?: string;
  pct?: number | null;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} strokeWidth={2.2} />
      </div>
      <p className="mt-2.5 text-lg font-bold leading-none text-slate-900 tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
      {pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 100 ? "bg-emerald-500" : "bg-violet-500",
            )}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { data: session, status: sessionStatus } = useSession();

  const [attSlots, setAttSlots] = useState<AttSlot[]>([]);
  const [perf, setPerf] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");

  const user = session?.user as any;
  const firstName = user?.name?.split(" ")[0] ?? "there";

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "unauthenticated") {
      setLoading(false);
      return;
    }

    Promise.all([
      fetch("/api/employee/attendance").then((r) => r.json()),
      fetch("/api/employee/performance").then((r) => r.json()),
    ])
      .then(([attData, perfData]) => {
        if (attData.success && Array.isArray(attData.shifts))
          setAttSlots(attData.shifts);
        if (perfData.success) setPerf(perfData as PerformanceData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionStatus]);

  const primaryShift = attSlots[0]?.schedule.shift ?? "morning";
  const primaryAtt = attSlots[0]?.attendance ?? null;
  const isOnBreak = primaryAtt?.onBreak ?? false;
  const attCfg = primaryAtt ? ATT_CFG[primaryAtt.status] : null;

  // Shift(s) that have already started today but have no check-in at all yet.
  const missedCheckIns = attSlots.filter(
    (s) => !s.attendance && s.schedule.startTime && new Date() > todayAt(s.schedule.startTime),
  );

  const hasPerf = !!perf?.success;
  const monthLabel = monthLabelFromYm(perf?.yearMonth);
  const isDaily = period === "daily";

  // Only meaningful for the "Hari ini" tab — the store rollup / monthly
  // totals are unaffected by whether this employee has a shift today.
  const notScheduledToday = isDaily && perf?.isScheduledToday === false;

  // Keep concepts separate:
  // 1) contribution pie = whole roster's actual-vs-store-target breakdown,
  //    each employee capped at their own target-allocation share (computed
  //    server-side — see dailyEmployeeContributions/monthlyEmployeeContributions)
  // 2) target gauge = employee actual / employee target (personal card)
  const chartEmployeeSales = isDaily
    ? perf?.salesAmount
    : perf?.monthlySalesAmount;
  const chartEmployeeTargetSales = isDaily
    ? (perf?.employeeDailySalesTarget ?? perf?.salesTarget)
    : (perf?.employeeMonthlySalesTarget ?? perf?.monthlySalesTarget);
  const chartEmployeeContributions = isDaily
    ? perf?.dailyEmployeeContributions
    : perf?.monthlyEmployeeContributions;
  const chartAchievementPct = isDaily
    ? (perf?.dailySalesAchievementPct ??
      calculatePct(perf?.salesAmount, chartEmployeeTargetSales))
    : (perf?.monthlySalesAchievementPct ??
      calculatePct(perf?.monthlySalesAmount, chartEmployeeTargetSales));
  const chartPeriodLabel = isDaily ? "Hari ini" : monthLabel;

  // Secondary metrics — transactions & average transaction value
  const chartTransactionCount = isDaily
    ? perf?.transactionCount
    : perf?.monthlyTransactionCount;
  const chartTransactionTarget = isDaily
    ? perf?.transactionTarget
    : perf?.monthlyTransactionTarget;
  const chartTransactionPct = isDaily
    ? perf?.transactionPct
    : perf?.monthlyTransactionPct;
  const chartAtv = isDaily
    ? perf?.transactionCount
      ? (perf.salesAmount ?? 0) / perf.transactionCount
      : 0
    : perf?.monthlyAtv;

  return (
    <div className="flex flex-col">
      {/* ── Hero — greeting + shift status only ────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-7 pt-6">
        {/* Decorative atmosphere */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 top-32 h-40 w-40 rounded-full bg-amber-300/5 blur-3xl" />

        <div className="relative space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
              {greeting()}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">
              {firstName} 👋
            </h1>
            <p className="mt-1 text-xs text-primary-foreground/50">
              {todayLabel()}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Shift pill */}
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/80">
              {primaryShift === "morning" && <Sun className="h-3 w-3" />}
              {primaryShift === "evening" && <Moon className="h-3 w-3" />}
              {primaryShift === "full_day" && <Zap className="h-3 w-3" />}
              {primaryShift === "morning"
                ? "Morning shift"
                : primaryShift === "evening"
                  ? "Evening shift"
                  : "Full Day shift"}
            </div>

            {/* Attendance pill */}
            {primaryAtt && attCfg ? (
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                  isOnBreak
                    ? "bg-amber-500/20 text-amber-200"
                    : `${attCfg.bg} ${attCfg.textClass}`,
                )}
              >
                {isOnBreak ? (
                  <Clock className="h-3 w-3" />
                ) : (
                  <attCfg.Icon className="h-3 w-3" />
                )}
                {isOnBreak ? "On Break" : attCfg.label}
                {primaryAtt.checkInTime && !isOnBreak && (
                  <span className="opacity-70">
                    · In {fmtTime(primaryAtt.checkInTime)}
                  </span>
                )}
              </div>
            ) : !loading && attSlots.length > 0 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/60">
                <LogIn className="h-3 w-3" />
                Not checked in
              </div>
            ) : null}
          </div>

          {/* Missed check-in alert — shift already started, no attendance
              row at all yet. Computed live from the shifts already fetched
              above, so it's accurate the moment the dashboard loads (no
              cron/notification-table round trip needed). */}
          {!loading && missedCheckIns.length > 0 && (
            <Link
              href="/employee/attendance"
              className="flex items-center gap-3 rounded-2xl border border-rose-400/40 bg-rose-500/15 px-3.5 py-3 transition-colors active:scale-[0.99]"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-rose-500/20">
                <AlertCircle className="h-4 w-4 text-rose-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-rose-100">
                  Belum absen masuk
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-rose-200/80">
                  {missedCheckIns[0].schedule.shiftLabel ?? "Shift"} kamu sudah
                  dimulai. Ketuk untuk check-in sekarang.
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-rose-200/60" />
            </Link>
          )}

          {/* Warning banner — always shown when the API sends one (roster/
              target/schedule gaps), regardless of whether performance data
              below can still render. */}
          {!loading && perf?.warning && (
            <div className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-200" />
              <p className="text-xs font-medium leading-snug text-amber-100">
                {perf.warning}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Performance — target gauge + store contribution pie ──────────── */}
      <div className="bg-slate-50 px-4 pt-5 pb-2">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Performance
          </p>
          {hasPerf && <PeriodToggle value={period} onChange={setPeriod} />}
        </div>

        {loading ? (
          <div className="space-y-3">
            <div className="h-64 animate-pulse rounded-3xl bg-slate-200/60" />
            <div className="h-64 animate-pulse rounded-3xl bg-slate-200/60" />
          </div>
        ) : notScheduledToday ? (
          <div className="flex items-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-white px-4 py-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100">
              <CalendarOff className="h-4 w-4 text-slate-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-slate-600">
                Tidak ada jadwal hari ini
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Kontribusi harian butuh jadwal kerja hari itu — lihat
                kontribusi bulanan di tab &quot;Bulan ini&quot; di atas.
              </p>
            </div>
          </div>
        ) : hasPerf ? (
          <div className="space-y-3">
            <EmployeeTargetGauge
              employeeSales={chartEmployeeSales}
              employeeTarget={chartEmployeeTargetSales}
              achievementPct={chartAchievementPct}
              periodLabel={chartPeriodLabel}
            />

            <StoreContributionPie
              employeeContributions={chartEmployeeContributions}
              periodLabel={chartPeriodLabel}
            />

            <div className="flex gap-3">
              <StatTile
                icon={Receipt}
                iconBg="bg-violet-50"
                iconColor="text-violet-600"
                label="Transactions"
                value={String(chartTransactionCount ?? 0)}
                sub={
                  chartTransactionTarget
                    ? `of ${Math.round(chartTransactionTarget)} target`
                    : undefined
                }
                pct={chartTransactionPct ?? null}
              />
              <StatTile
                icon={CircleDollarSign}
                iconBg="bg-sky-50"
                iconColor="text-sky-600"
                label="Avg. Transaction"
                value={fmtCompactRp(chartAtv)}
                sub={
                  !isDaily && perf?.monthlyAtvTarget
                    ? `target ${fmtCompactRp(perf.monthlyAtvTarget)}`
                    : undefined
                }
              />
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center">
            <p className="text-xs font-medium text-slate-400">
              Data performa belum tersedia.
            </p>
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
            <Card className="cursor-pointer border-border shadow-sm transition-all hover:border-primary/25 hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CheckSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    My Tasks
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    View and complete today's shift tasks
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/employee/attendance">
            <Card className="cursor-pointer border-border shadow-sm transition-all hover:border-primary/25 hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                    primaryAtt && !isOnBreak ? "bg-green-100" : "bg-amber-50",
                  )}
                >
                  <CalendarDays
                    className={cn(
                      "h-5 w-5",
                      primaryAtt && !isOnBreak
                        ? "text-green-600"
                        : "text-amber-600",
                    )}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Attendance
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {loading
                      ? "Loading…"
                      : isOnBreak
                        ? "Currently on break"
                        : primaryAtt
                          ? `${attCfg?.label} · ${primaryAtt.checkOutTime ? "Shift complete" : "Check-out when done"}`
                          : attSlots.length > 0
                            ? "Tap to check in for your shift"
                            : "No shift scheduled today"}
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
            <Card className="cursor-pointer border-border shadow-sm transition-all hover:border-primary/25 hover:shadow-md active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    My Profile
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    View schedule &amp; account info
                  </p>
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
