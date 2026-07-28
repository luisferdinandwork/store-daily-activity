// components/employee/StoreContributionChart.tsx
"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  TrendingUp,
  Trophy,
  Target,
  Flame,
  Crosshair,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface EmployeeContribution {
  userId: string;
  name: string;
  isCurrentUser: boolean;
  /** Actual sales ÷ store target, already capped at this employee's own target-share %. */
  contributionPct: number;
  /**
   * This employee's assigned target ÷ store target — the FULL slice size
   * (their goal), independent of how much they've actually achieved.
   * Falls back to `contributionPct` when omitted, in which case the ring
   * shows only the achieved portion for that employee (no low-opacity
   * "remaining" wedge).
   */
  targetSharePct?: number | null;
}

interface Props {
  /** This employee's own actual sales for the selected period. */
  employeeMonthlySales: number | null | undefined;
  /** The store's TARGET for the selected period — the "100%" the ring measures against. */
  storeTargetSales: number | null | undefined;
  /** Employee's own sales target for the selected period. */
  employeeTargetSales?: number | null;
  /** Employee actual ÷ employee target, uncapped (e.g. 118 means 118%). */
  targetAchievementPct?: number | null;
  /** Whole roster's contribution-to-target breakdown — one entry per employee, each already capped at their own target share. Powers the multi-color ring. */
  employeeContributions: EmployeeContribution[] | null | undefined;
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

const SEGMENT_TRANSITION =
  "stroke-dasharray 1.1s cubic-bezier(0.22, 1, 0.36, 1), stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1), filter 0.4s ease";

/** Visual breathing room (in circumference px) between adjacent employees' slices, only used once there's more than one employee. Flat (butt) caps mean this gap is the full visible separation, no cap rounding to fill it in. There's no gap between an employee's own achieved/remaining pair — those stay visually contiguous. */
const SEGMENT_GAP = 5;

/** Opacity of the "remaining target" wedge relative to its achieved counterpart's full color. */
const REMAINING_OPACITY = 0.25;

/** One-time keyframes for the "you" segment's glow and the reveal sweep — injected inline so this component stays self-contained. */
const DONUT_STYLE_TAG = `
@keyframes scc-you-glow {
  0%, 100% { filter: drop-shadow(0 0 2px rgba(251,191,36,0.55)); }
  50% { filter: drop-shadow(0 0 7px rgba(251,191,36,0.9)); }
}
@keyframes scc-achieved-ring {
  0%, 100% { box-shadow: 0 0 0 0 rgba(52,211,153,0.35); }
  50% { box-shadow: 0 0 0 8px rgba(52,211,153,0); }
}
`;

/** "You" is always gold; teammates cycle through the rest of this palette by roster order. */
const CURRENT_USER_COLOR = "#fbbf24";
const TEAMMATE_PALETTE = [
  "#34d399", // emerald
  "#60a5fa", // sky
  "#f472b6", // pink
  "#a78bfa", // violet
  "#fb923c", // orange
  "#22d3ee", // cyan
  "#facc15", // yellow
  "#f87171", // red
  "#4ade80", // green
  "#818cf8", // indigo
  "#e879f9", // fuchsia
];

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

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
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
  employeeMonthlySales,
  storeTargetSales,
  employeeTargetSales,
  targetAchievementPct,
  employeeContributions,
  periodLabel,
}: Props) {
  const safeEmployeeSales = useMemo(
    () => Math.max(0, toSafeNumber(employeeMonthlySales)),
    [employeeMonthlySales],
  );

  const safeStoreTarget = Math.max(0, toSafeNumber(storeTargetSales));

  // Current user first (their slice always starts at 12 o'clock), then
  // teammates ordered by size so the biggest slices read clearly.
  const orderedContributions = useMemo(() => {
    const list = (employeeContributions ?? []).filter(
      (c) => c.contributionPct > 0 || (c.targetSharePct ?? 0) > 0 || c.isCurrentUser,
    );
    return [...list].sort((a, b) => {
      if (a.isCurrentUser !== b.isCurrentUser) return a.isCurrentUser ? -1 : 1;
      return b.contributionPct - a.contributionPct;
    });
  }, [employeeContributions]);

  const myContributionPct = clampPct(
    orderedContributions.find((c) => c.isCurrentUser)?.contributionPct,
  );

  const safeEmployeeTarget = Math.max(0, toSafeNumber(employeeTargetSales));
  const hasEmployeeTarget = safeEmployeeTarget > 0;

  /**
   * Target achievement must use the employee's own currency target:
   * employee actual ÷ employee target. It must never be derived by dividing
   * actual contribution share by target contribution share, because those
   * ratios use different store denominators and can report a false 100%.
   */
  const safeAchievementPct = Math.max(0, toSafeNumber(targetAchievementPct));
  const reachPct = hasEmployeeTarget ? safeAchievementPct : null;
  const reachAchieved = reachPct != null && reachPct >= 100;
  /** Rp still needed to hit the personal target — the actionable number, instead of a % of what's already earned. */
  const remainingToFill = Math.max(0, safeEmployeeTarget - safeEmployeeSales);
  /** Rp earned beyond target, once achieved. */
  const surplusOverTarget = Math.max(0, safeEmployeeSales - safeEmployeeTarget);

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);

    const t = setTimeout(() => {
      setProgress(1);
    }, 80);

    return () => clearTimeout(t);
  }, [orderedContributions]);

  // ── Hover state — which employee's slice is active, and where to float the tooltip.
  // `hoveredId` drives dimming everywhere (ring + legend); the floating tooltip only
  // shows while hovering the ring itself, since it's positioned off the cursor.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const hoveredContribution = orderedContributions.find((c) => c.userId === hoveredId) ?? null;

  const handleRingMouseMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const motivation = getMotivation(
    myContributionPct,
    safeAchievementPct,
    safeEmployeeSales,
    hasEmployeeTarget,
  );
  const tone = TONE_STYLES[motivation.tone];

  const hasMultipleSlices = orderedContributions.length > 1;

  // Each employee's slice size is their real target share of the store
  // target (e.g. 10%) — the filled (full-color) portion of that slice is
  // exactly how much of it they've actually achieved (e.g. 60% of that 10%
  // = 6%), and the low-opacity remainder is the gap left to hit their own
  // target (4%). These are the real percentages, not stretched or rescaled —
  // if every employee's target share happens to add up to the full store
  // target, the ring closes on its own; if not, the leftover arc stays as
  // plain background, which honestly reflects unassigned store target.
  const sliceStats = useMemo(() => {
    return orderedContributions.map((c, i) => {
      const achievedPct = clampPct(c.contributionPct);
      // A slice can never be smaller than what's already achieved.
      const fullPct = Math.max(achievedPct, clampPct(c.targetSharePct ?? c.contributionPct));
      return {
        userId: c.userId,
        name: c.name,
        isCurrentUser: c.isCurrentUser,
        color: c.isCurrentUser
          ? CURRENT_USER_COLOR
          : TEAMMATE_PALETTE[i % TEAMMATE_PALETTE.length],
        achievedRaw: achievedPct,
        fullRaw: fullPct,
        achievedPct,
        fullPct,
      };
    });
  }, [orderedContributions]);

  // Build stacked ring arcs — each employee contributes two adjacent arcs
  // (achieved in full color, remaining target in low opacity), animated in
  // together via `progress`. An immutable fold (not a mutated outer
  // accumulator) so each step's running length is just that step's return
  // value.
  const segments = sliceStats.reduce<{
    list: {
      key: string;
      part: "achieved" | "remaining";
      name: string;
      color: string;
      isCurrentUser: boolean;
      dasharray: string;
      dashoffset: number;
    }[];
    cumulativeLength: number;
  }>(
    (state, s) => {
      const rawFullLength = DONUT_CIRCUMFERENCE * (s.fullPct / 100) * progress;
      const gap = hasMultipleSlices ? SEGMENT_GAP : 0;
      const fullLength = Math.max(0, rawFullLength - gap);
      const achievedLength =
        s.fullPct > 0 ? fullLength * (s.achievedPct / s.fullPct) : 0;
      const remainingLength = Math.max(0, fullLength - achievedLength);

      const achievedSeg = {
        key: s.userId,
        part: "achieved" as const,
        name: s.name,
        color: s.color,
        isCurrentUser: s.isCurrentUser,
        dasharray: `${achievedLength} ${DONUT_CIRCUMFERENCE - achievedLength}`,
        dashoffset: -state.cumulativeLength,
      };
      const remainingSeg = {
        key: s.userId,
        part: "remaining" as const,
        name: s.name,
        color: s.color,
        isCurrentUser: s.isCurrentUser,
        dasharray: `${remainingLength} ${DONUT_CIRCUMFERENCE - remainingLength}`,
        dashoffset: -(state.cumulativeLength + achievedLength),
      };

      return {
        list: [...state.list, achievedSeg, remainingSeg],
        cumulativeLength: state.cumulativeLength + rawFullLength,
      };
    },
    { list: [], cumulativeLength: 0 },
  ).list;

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.10] via-white/[0.06] to-transparent p-4 sm:p-5">
      <style>{DONUT_STYLE_TAG}</style>

      {/* Soft glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-2xl" />

      {/* Header — one line, icon-only mood indicator (no headline text) */}
      <div className="relative mb-4 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground/45">
          Kontribusi · {periodLabel}
        </p>

        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
            tone.bg,
          )}
          title={motivation.headline}
        >
          <motivation.Icon className={cn("h-3 w-3", tone.text)} strokeWidth={2.5} />
        </div>
      </div>

      {/* Donut — one achieved + remaining arc pair per employee, stacked
          around the ring at their real target-share size. Sized as a
          fluid aspect-square capped at DONUT_SIZE so it scales down
          gracefully on narrow phones instead of clipping the card. */}
      <div
        className={cn(
          "relative mx-auto aspect-square w-full transition-shadow duration-700",
          reachAchieved && "rounded-full [animation:scc-achieved-ring_2.6s_ease-out_1]",
        )}
        style={{ maxWidth: DONUT_SIZE }}
      >
        <svg
          viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
          className="h-full w-full -rotate-90"
          onMouseMove={handleRingMouseMove}
          onMouseLeave={() => { setHoveredId(null); setTooltipVisible(false); }}
        >
          <circle
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={DONUT_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={DONUT_STROKE}
          />

          {segments.map((s) => {
            const isHovered = hoveredId === s.key;
            const isDimmed = hoveredId !== null && !isHovered;
            const baseOpacity = s.part === "achieved" ? 1 : REMAINING_OPACITY;
            const opacity = isDimmed ? baseOpacity * 0.5 : baseOpacity;

            return (
              <circle
                key={`${s.key}-${s.part}`}
                cx={DONUT_CENTER}
                cy={DONUT_CENTER}
                r={DONUT_RADIUS}
                fill="none"
                stroke={s.color}
                strokeWidth={
                  (s.isCurrentUser ? DONUT_STROKE + 1.5 : DONUT_STROKE) + (isHovered ? 3 : 0)
                }
                strokeLinecap="butt"
                strokeDasharray={s.dasharray}
                strokeDashoffset={s.dashoffset}
                onMouseEnter={() => { setHoveredId(s.key); setTooltipVisible(true); }}
                className="cursor-pointer"
                style={{
                  pointerEvents: "stroke",
                  opacity,
                  transition: `${SEGMENT_TRANSITION}, opacity 0.25s ease, stroke-width 0.25s ease`,
                  animation:
                    s.part === "achieved" && s.isCurrentUser && progress === 1 && !hoveredId
                      ? "scc-you-glow 2.6s ease-in-out infinite"
                      : undefined,
                }}
              />
            );
          })}
        </svg>

        <div
          className={cn(
            "absolute inset-0 flex flex-col items-center justify-center text-center px-2 transition-opacity duration-200",
            hoveredId && "opacity-0",
          )}
        >
          <p className="leading-none text-primary-foreground tabular-nums">
            <span className="text-[2.5rem] font-bold sm:text-5xl">
              {fmtPct1(myContributionPct * progress)}%
            </span>
            <span className="ml-1 text-base font-semibold text-primary-foreground/40 sm:text-lg">
              /100%
            </span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-amber-200 tabular-nums">
            Rp {fmtCompact(safeEmployeeSales)}
            <span className="text-primary-foreground/35"> / {fmtCompact(safeStoreTarget)}</span>
          </p>
        </div>

        {/* Hover tooltip — employee name + achieved vs. target share, floats near the cursor */}
        {tooltipVisible && hoveredContribution && (() => {
          const stat = sliceStats.find((s) => s.userId === hoveredContribution.userId);
          return (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg border border-white/10 bg-slate-900/95 px-2.5 py-1.5 text-center shadow-lg backdrop-blur-sm"
              style={{ left: tooltipPos.x, top: tooltipPos.y }}
            >
              <p className="text-[11px] font-bold text-white">
                {hoveredContribution.isCurrentUser ? "Kamu" : hoveredContribution.name}
              </p>
              <p className="text-[10px] font-semibold tabular-nums" style={{ color: stat?.color }}>
                {fmtPct1(stat?.achievedRaw ?? 0)}% / {fmtPct1(stat?.fullRaw ?? 0)}% target
              </p>
              <div className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-slate-900/95" />
            </div>
          );
        })()}
      </div>

      {/* Legend — dots for every employee on the ring; % only for "Kamu",
          since teammates' share is already legible from arc size. */}
      {orderedContributions.length > 0 && (
        <div className="relative mt-4 -mx-4 px-4 sm:mx-0 sm:px-0">
          <div
            className="flex items-center gap-x-3 gap-y-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] sm:flex-wrap sm:justify-center sm:overflow-visible [&::-webkit-scrollbar]:hidden"
          >
            {orderedContributions.map((c, i) => {
              const color = c.isCurrentUser
                ? CURRENT_USER_COLOR
                : TEAMMATE_PALETTE[i % TEAMMATE_PALETTE.length];
              const isDimmed = hoveredId !== null && hoveredId !== c.userId;
              return (
                <button
                  key={c.userId}
                  type="button"
                  onMouseEnter={() => setHoveredId(c.userId)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-0.5 transition-opacity duration-200",
                    isDimmed && "opacity-40",
                  )}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span
                    className={cn(
                      "whitespace-nowrap text-[10px] tabular-nums",
                      c.isCurrentUser
                        ? "font-bold text-primary-foreground"
                        : "font-medium text-primary-foreground/45",
                    )}
                  >
                    {c.isCurrentUser ? `Kamu ${fmtPct1(c.contributionPct)}%` : firstName(c.name)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Personal target — one compact row + bar. Shows the Rp amount still
          needed to hit target (not a % of what's already been earned), so
          it reads as an actionable number rather than a scoreboard. */}
      {hasEmployeeTarget && reachPct != null && (
        <div className="relative mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-primary-foreground/50">
            <span className="flex items-center gap-1">
              <Crosshair className="h-3 w-3" /> Target kamu
            </span>
            <span className={cn("tabular-nums", reachAchieved ? "text-emerald-300" : "text-amber-200")}>
              {reachAchieved
                ? `Tercapai · +Rp ${fmtCompact(surplusOverTarget)}`
                : `Rp ${fmtCompact(remainingToFill)} lagi`}
            </span>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
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
        </div>
      )}

    </div>
  );
}