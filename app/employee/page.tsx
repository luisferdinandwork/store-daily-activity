"use client";
// app/employee/page.tsx

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ChevronRight,
  ListChecks,
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
import { shiftLabel } from "@/components/employee/tasks";
import { Chip, ListGroup, NavRow, SectionLabel, SkeletonBlocks } from "@/components/employee/ui";

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
    <div className="relative flex h-9 w-[184px] shrink-0 overflow-hidden rounded-full bg-secondary p-1">
      {/* Sliding pill */}
      <span
        className="pointer-events-none absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-card shadow-sm transition-transform duration-300 ease-out"
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
            "relative z-10 flex flex-1 items-center justify-center text-[11px] font-semibold transition-colors",
            value === v
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
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
    <div className="min-w-0 flex-1 rounded-2xl border border-border bg-card p-3.5">
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl", iconBg)}>
        <Icon className={cn("h-4 w-4", iconColor)} strokeWidth={2.2} />
      </div>
      <p className="mt-2.5 truncate text-lg font-bold leading-none text-foreground tabular-nums">
        {value}
      </p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
      {pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              pct >= 100 ? "bg-emerald-500" : "bg-primary",
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
      <div className="relative overflow-hidden bg-primary px-5 pb-7 pt-5">
        {/* Decorative atmosphere */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl" />
        <div className="pointer-events-none absolute -left-10 top-32 h-40 w-40 rounded-full bg-amber-300/5 blur-3xl" />

        <div className="relative mx-auto max-w-md space-y-4">
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
              {shiftLabel(primaryShift) ?? "Shift"}
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
      <div className="mx-auto w-full max-w-md px-4 pt-5 pb-2">
        <SectionLabel
          className="mb-3"
          action={hasPerf ? <PeriodToggle value={period} onChange={setPeriod} /> : undefined}
        >
          Performance
        </SectionLabel>

        {loading ? (
          <SkeletonBlocks count={2} className="h-64 rounded-3xl" />
        ) : notScheduledToday ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-6">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
              <CalendarOff className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-foreground">
                Tidak ada jadwal hari ini
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
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
          <div className="rounded-2xl border border-dashed border-border bg-card px-5 py-8 text-center">
            <p className="text-xs font-medium text-muted-foreground">
              Data performa belum tersedia.
            </p>
          </div>
        )}
      </div>

      {/* ── Quick actions ─────────────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-md px-4 pt-5 pb-8">
        <SectionLabel>Quick Actions</SectionLabel>

        <ListGroup>
          <NavRow
            href="/employee/tasks"
            icon={ListChecks}
            title="My Tasks"
            description="Lihat dan selesaikan task shift hari ini"
          />
          <NavRow
            href="/employee/attendance"
            icon={CalendarDays}
            iconClassName={primaryAtt && !isOnBreak ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}
            title="Attendance"
            description={
              loading
                ? "Memuat…"
                : isOnBreak
                  ? "Sedang istirahat"
                  : primaryAtt
                    ? `${attCfg?.label} · ${primaryAtt.checkOutTime ? "Shift selesai" : "Absen pulang setelah selesai"}`
                    : attSlots.length > 0
                      ? "Ketuk untuk absen masuk"
                      : "Tidak ada shift hari ini"
            }
            trailing={
              !primaryAtt && !loading && attSlots.length > 0
                ? <Chip tone="warning">Perlu aksi</Chip>
                : undefined
            }
          />
          <NavRow
            href="/employee/profile"
            icon={UserCircle}
            iconClassName="bg-secondary text-muted-foreground"
            title="My Profile"
            description="Akun, foto profil & password"
          />
        </ListGroup>
      </div>
    </div>
  );
}
