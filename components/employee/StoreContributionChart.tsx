// components/employee/StoreContributionChart.tsx
"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  TrendingUp,
  Trophy,
  Target,
  Flame,
  Users,
  Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  employeeName: string;
  employeeMonthlySales: number | null | undefined;
  storeMonthlySales: number | null | undefined;
  /**
   * The store's TARGET for whatever period is being shown (daily or
   * monthly — the parent decides which numbers to pass in). Optional: when
   * omitted, the coach line just shows the store's actual, same as before.
   */
  storeTargetSales?: number | null;
  /** Employee's own sales target for the selected period. */
  employeeTargetSales?: number | null;
  /** Employee's ACTUAL share of the store's actual sales this period, 0–100. */
  contributionPct: number | null | undefined;
  /** Employee actual ÷ employee target, uncapped (e.g. 118 means 118%). */
  targetAchievementPct?: number | null;
  /**
   * Employee's TARGET share of the store's target this period, 0–100 — e.g.
   * an SA assigned a 40% daily allocation. For the monthly view this is
   * derived from (employee sales target / store sales target) × 100; for
   * the daily view it's simply today's allocation %. Omit/null when there's
   * no target yet — the target-related UI (marker + reach bar) just doesn't
   * render.
   */
  targetContributionPct?: number | null;
  /** e.g. "Juli 2026" or "Hari ini" — whatever period the numbers above represent. */
  periodLabel: string;
}

interface Motivation {
  headline: string;
  detail: string;
  Icon: typeof Flame;
  tone: "gold" | "emerald" | "sky" | "amber";
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TONE_STYLES = {
  gold: {
    bg: "bg-amber-500/15",
    text: "text-amber-200",
    iconBg: "bg-amber-400/30",
  },
  emerald: {
    bg: "bg-emerald-500/15",
    text: "text-emerald-200",
    iconBg: "bg-emerald-400/30",
  },
  sky: {
    bg: "bg-sky-500/15",
    text: "text-sky-200",
    iconBg: "bg-sky-400/30",
  },
  amber: {
    bg: "bg-amber-500/10",
    text: "text-amber-100",
    iconBg: "bg-amber-400/20",
  },
} as const;

const DONUT_SIZE = 168;
const DONUT_STROKE = 14;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;
const DONUT_CENTER = DONUT_SIZE / 2;

const ARC_TRANSITION = "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)";
const BAR_TRANSITION = "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toSafeNumber(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clampPct(value: number | null | undefined) {
  const n = toSafeNumber(value);
  return Math.max(0, Math.min(100, n));
}

function fmtCompact(value: number | null | undefined): string {
  const n = Math.max(0, toSafeNumber(value));

  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}rb`;

  return String(Math.round(n));
}

function fmtPct1(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return (Math.round(safe * 10) / 10).toLocaleString("id-ID");
}

/**
 * Point on the donut ring for a given 0–100 percentage. The <svg> itself is
 * rotated -90deg via CSS (so the progress arc starts at 12 o'clock and
 * sweeps clockwise) — computing the marker in this same UNROTATED
 * coordinate space means the CSS rotation lines it up automatically, no
 * extra transform math needed here.
 */
function pointOnRing(pct: number, radius: number) {
  const theta = (clampPct(pct) / 100) * 2 * Math.PI;
  return {
    x: DONUT_CENTER + radius * Math.cos(theta),
    y: DONUT_CENTER + radius * Math.sin(theta),
  };
}

/**
 * Motivational tone. When a target contribution % is available, tiers are
 * based on how close the employee is to THEIR OWN target (reach %) rather
 * than fixed absolute thresholds — a PIC1 assigned 7% and hitting 7.5% is
 * doing great, even though 7.5% would look tiny on an absolute scale built
 * for someone assigned 40%.
 */
function getMotivation(
  contributionPct: number,
  achievementPct: number,
  sales: number,
  hasEmployeeTarget: boolean,
): Motivation {
  if (sales === 0) {
    return {
      headline: "Mulai hari ini",
      detail: "Setiap transaksi membuat kontribusimu naik.",
      Icon: Flame,
      tone: "amber",
    };
  }

  if (hasEmployeeTarget) {
    if (achievementPct >= 100) {
      return {
        headline: "Target tercapai!",
        detail: "Penjualanmu sudah mencapai atau melebihi target karyawan.",
        Icon: Trophy,
        tone: "gold",
      };
    }
    if (achievementPct >= 75) {
      return {
        headline: "Hampir sampai",
        detail: "Sedikit lagi untuk mencapai target penjualanmu.",
        Icon: TrendingUp,
        tone: "emerald",
      };
    }
    if (achievementPct >= 40) {
      return {
        headline: "Terus kejar",
        detail: "Tambah beberapa transaksi lagi untuk mendekati target.",
        Icon: Crosshair,
        tone: "sky",
      };
    }
    return {
      headline: "Tetap semangat",
      detail: "Setiap penjualanmu mendekatkanmu ke target karyawan.",
      Icon: Flame,
      tone: "amber",
    };
  }

  // No target assigned yet — fall back to absolute contribution tiers.
  if (contributionPct >= 25) {
    return {
      headline: "Top kontributor!",
      detail: "Kamu salah satu penggerak utama toko.",
      Icon: Trophy,
      tone: "gold",
    };
  }
  if (contributionPct >= 15) {
    return {
      headline: "Momentum bagus",
      detail: "Sedikit lagi untuk masuk top kontributor toko.",
      Icon: TrendingUp,
      tone: "emerald",
    };
  }
  if (contributionPct >= 8) {
    return {
      headline: "Terus naik",
      detail: "Tambah beberapa transaksi lagi untuk dorong kontribusimu.",
      Icon: Target,
      tone: "sky",
    };
  }
  return {
    headline: "Tetap semangat",
    detail: "Setiap penjualanmu menambah kontribusi ke toko.",
    Icon: Flame,
    tone: "amber",
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StoreContributionChart({
  employeeName,
  employeeMonthlySales,
  storeMonthlySales,
  storeTargetSales,
  employeeTargetSales,
  contributionPct,
  targetAchievementPct,
  targetContributionPct,
  periodLabel,
}: Props) {
  const gradientId = useId();

  const safeEmployeeSales = useMemo(
    () => Math.max(0, toSafeNumber(employeeMonthlySales)),
    [employeeMonthlySales],
  );

  const safeStoreSales = useMemo(
    () => Math.max(0, toSafeNumber(storeMonthlySales)),
    [storeMonthlySales],
  );

  const safeContributionPct = useMemo(
    () => clampPct(contributionPct),
    [contributionPct],
  );

  const safeStoreTarget = Math.max(0, toSafeNumber(storeTargetSales));
  const hasStoreTarget = safeStoreTarget > 0;

  const safeEmployeeTarget = Math.max(0, toSafeNumber(employeeTargetSales));
  const hasEmployeeTarget = safeEmployeeTarget > 0;

  const hasTargetShare =
    typeof targetContributionPct === "number" && targetContributionPct > 0;
  const safeTargetSharePct = hasTargetShare
    ? clampPct(targetContributionPct)
    : 0;

  /**
   * Target achievement must use the employee's own currency target:
   * employee actual ÷ employee target. It must never be derived by dividing
   * actual contribution share by target contribution share, because those
   * ratios use different store denominators and can report a false 100%.
   */
  const safeAchievementPct = Math.max(0, toSafeNumber(targetAchievementPct));
  const reachPct = hasEmployeeTarget ? safeAchievementPct : null;
  const reachAchieved = reachPct != null && reachPct >= 100;

  const [animatedPct, setAnimatedPct] = useState(0);

  useEffect(() => {
    setAnimatedPct(0);

    const t = setTimeout(() => {
      setAnimatedPct(safeContributionPct);
    }, 80);

    return () => clearTimeout(t);
  }, [safeContributionPct]);

  const motivation = getMotivation(
    safeContributionPct,
    safeAchievementPct,
    safeEmployeeSales,
    hasEmployeeTarget,
  );
  const tone = TONE_STYLES[motivation.tone];

  const employeeFilled =
    DONUT_CIRCUMFERENCE * (Math.min(100, animatedPct) / 100);

  const storeShareOthers = Math.max(0, safeStoreSales - safeEmployeeSales);
  const animatedOthersPct = Math.max(0, 100 - animatedPct);

  // Target marker geometry — a short tick radiating across the ring at the
  // angle corresponding to the target %, so "where you are" (the filled
  // arc) and "where you're aiming" (this tick) sit on the same gauge.
  const markerInnerR = DONUT_RADIUS - DONUT_STROKE / 2 - 4;
  const markerOuterR = DONUT_RADIUS + DONUT_STROKE / 2 + 4;
  const markerInner = hasTargetShare
    ? pointOnRing(safeTargetSharePct, markerInnerR)
    : null;
  const markerOuter = hasTargetShare
    ? pointOnRing(safeTargetSharePct, markerOuterR)
    : null;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.10] via-white/[0.06] to-transparent p-5">
      {/* Soft glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-2xl" />

      {/* Header */}
      <div className="relative mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground/45">
            Kontribusi · {periodLabel}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-primary-foreground">
            {employeeName ? `${employeeName} di toko` : "Penjualanmu di toko"}
          </p>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1",
            tone.bg,
          )}
        >
          <motivation.Icon
            className={cn("h-3 w-3", tone.text)}
            strokeWidth={2.5}
          />
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider",
              tone.text,
            )}
          >
            {motivation.headline}
          </span>
        </div>
      </div>

      {/* Donut */}
      <div
        className="relative mx-auto flex items-center justify-center"
        style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
      >
        <svg
          width={DONUT_SIZE}
          height={DONUT_SIZE}
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          className="-rotate-90"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>

          <circle
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={DONUT_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={DONUT_STROKE}
          />

          <circle
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={DONUT_RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={DONUT_STROKE}
            strokeLinecap="round"
            strokeDasharray={DONUT_CIRCUMFERENCE}
            strokeDashoffset={DONUT_CIRCUMFERENCE - employeeFilled}
            style={{ transition: ARC_TRANSITION }}
          />

          {/* Target marker — "where you're aiming" on the same ring. */}
          {markerInner && markerOuter && (
            <line
              x1={markerInner.x}
              y1={markerInner.y}
              x2={markerOuter.x}
              y2={markerOuter.y}
              stroke="white"
              strokeWidth={3}
              strokeLinecap="round"
            />
          )}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary-foreground/35">
            Kontribusi
          </p>
          <p className="mt-1 text-5xl font-bold leading-none text-primary-foreground tabular-nums">
            {fmtPct1(animatedPct)}
            <span className="text-2xl text-primary-foreground/70">%</span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-amber-200 tabular-nums">
            Rp {fmtCompact(safeEmployeeSales)}
          </p>
          {hasTargetShare && (
            <p className="mt-1 flex items-center gap-1 text-[9px] font-semibold text-primary-foreground/40">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
              porsi target {fmtPct1(safeTargetSharePct)}%
            </p>
          )}
        </div>
      </div>

      {/* Stacked bar — same target marker, linear scale */}
      <div className="relative mt-5">
        <div className="relative flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full bg-gradient-to-r from-amber-300 to-amber-500"
            style={{
              width: `${Math.min(100, animatedPct)}%`,
              transition: BAR_TRANSITION,
            }}
          />
        </div>
        {hasTargetShare && (
          <div
            className="pointer-events-none absolute top-0 h-2.5 w-0.5 -translate-x-1/2 rounded-full bg-white"
            style={{ left: `${safeTargetSharePct}%` }}
            title={`Porsi target ${fmtPct1(safeTargetSharePct)}%`}
          />
        )}

        <div className="mt-1 flex justify-between text-[9px] font-medium text-primary-foreground/30 tabular-nums">
          <span>0%</span>
          <span>100% · seluruh toko</span>
        </div>
      </div>

      {/* Employee target achievement — actual employee sales vs employee target */}
      {hasEmployeeTarget && reachPct != null && (
        <div className="relative mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground/45">
              <Crosshair className="h-3 w-3" /> Pencapaian Target Karyawan
            </p>
            <span
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums",
                reachAchieved
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "bg-amber-500/15 text-amber-200",
              )}
            >
              {fmtPct1(reachPct)}%
            </span>
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-700",
                reachAchieved
                  ? "bg-gradient-to-r from-emerald-400 to-emerald-500"
                  : "bg-gradient-to-r from-sky-400 to-sky-500",
              )}
              style={{ width: `${Math.min(100, reachPct)}%` }}
            />
          </div>

          <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-primary-foreground/40 tabular-nums">
            <span>Aktual Rp {fmtCompact(safeEmployeeSales)}</span>
            <span>Target Rp {fmtCompact(safeEmployeeTarget)}</span>
          </div>
        </div>
      )}

      {/* Hero stat block + teammates */}
      <div className="relative mt-3 grid grid-cols-5 gap-2">
        <div className="col-span-3 rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-amber-500/5 px-3.5 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-gradient-to-br from-amber-300 to-amber-500" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-200/80">
              Kamu
            </p>
          </div>

          <p className="mt-1 truncate text-base font-bold text-amber-50 tabular-nums">
            Rp {fmtCompact(safeEmployeeSales)}
          </p>

          <p className="text-[10px] text-amber-200/50 tabular-nums">
            {fmtPct1(animatedPct)}% dari total toko
          </p>
        </div>

        <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <Users className="h-2.5 w-2.5 text-primary-foreground/40" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-primary-foreground/45">
              Rekan
            </p>
          </div>

          <p className="mt-1 truncate text-sm font-semibold text-primary-foreground/75 tabular-nums">
            Rp {fmtCompact(storeShareOthers)}
          </p>

          <p className="text-[10px] text-primary-foreground/35 tabular-nums">
            {Math.round(animatedOthersPct)}%
          </p>
        </div>
      </div>

      {/* Coach line */}
      <div
        className={cn(
          "relative mt-3 flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5",
          tone.bg,
        )}
      >
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-xl",
            tone.iconBg,
          )}
        >
          <motivation.Icon
            className={cn("h-3.5 w-3.5", tone.text)}
            strokeWidth={2.5}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn("text-[11px] leading-snug font-medium", tone.text)}>
            {motivation.detail}
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-primary-foreground/30 tabular-nums">
            Total toko Rp {fmtCompact(safeStoreSales)}
            {hasStoreTarget && (
              <> dari target Rp {fmtCompact(safeStoreTarget)}</>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
