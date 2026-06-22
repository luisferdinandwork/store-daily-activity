// components/employee/StoreContributionChart.tsx
'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { TrendingUp, Trophy, Target, Flame, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  employeeName: string;
  employeeMonthlySales: number | null | undefined;
  storeMonthlySales: number | null | undefined;
  contributionPct: number | null | undefined; // 0–100
  monthLabel: string;
}

interface Motivation {
  headline: string;
  detail: string;
  Icon: typeof Flame;
  tone: 'gold' | 'emerald' | 'sky' | 'amber';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TONE_STYLES = {
  gold: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-200',
    iconBg: 'bg-amber-400/30',
  },
  emerald: {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-200',
    iconBg: 'bg-emerald-400/30',
  },
  sky: {
    bg: 'bg-sky-500/15',
    text: 'text-sky-200',
    iconBg: 'bg-sky-400/30',
  },
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-100',
    iconBg: 'bg-amber-400/20',
  },
} as const;

const DONUT_SIZE = 168;
const DONUT_STROKE = 14;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

const ARC_TRANSITION = 'stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)';
const BAR_TRANSITION = 'width 1.1s cubic-bezier(0.22, 1, 0.36, 1)';

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

function getMotivation(pct: number, sales: number): Motivation {
  if (sales === 0) {
    return {
      headline: 'Mulai hari ini',
      detail: 'Setiap transaksi membuat kontribusimu naik.',
      Icon: Flame,
      tone: 'amber',
    };
  }

  if (pct >= 25) {
    return {
      headline: 'Top kontributor!',
      detail: 'Kamu salah satu penggerak utama toko bulan ini.',
      Icon: Trophy,
      tone: 'gold',
    };
  }

  if (pct >= 15) {
    return {
      headline: 'Momentum bagus',
      detail: 'Sedikit lagi untuk masuk top kontributor toko.',
      Icon: TrendingUp,
      tone: 'emerald',
    };
  }

  if (pct >= 8) {
    return {
      headline: 'Terus naik',
      detail: 'Tambah beberapa transaksi lagi untuk dorong kontribusimu.',
      Icon: Target,
      tone: 'sky',
    };
  }

  return {
    headline: 'Tetap semangat',
    detail: 'Setiap penjualanmu menambah kontribusi ke toko.',
    Icon: Flame,
    tone: 'amber',
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StoreContributionChart({
  employeeName,
  employeeMonthlySales,
  storeMonthlySales,
  contributionPct,
  monthLabel,
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

  const [animatedPct, setAnimatedPct] = useState(0);

  useEffect(() => {
    setAnimatedPct(0);

    const t = setTimeout(() => {
      setAnimatedPct(safeContributionPct);
    }, 80);

    return () => clearTimeout(t);
  }, [safeContributionPct]);

  const motivation = getMotivation(safeContributionPct, safeEmployeeSales);
  const tone = TONE_STYLES[motivation.tone];

  const employeeFilled =
    DONUT_CIRCUMFERENCE * (Math.min(100, animatedPct) / 100);

  const storeShareOthers = Math.max(0, safeStoreSales - safeEmployeeSales);
  const animatedOthersPct = Math.max(0, 100 - animatedPct);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.10] via-white/[0.06] to-transparent p-5">
      {/* Soft glow */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/10 blur-2xl" />

      {/* Header */}
      <div className="relative mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary-foreground/45">
            Kontribusi · {monthLabel}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-primary-foreground">
            {employeeName ? `${employeeName} di toko` : 'Penjualanmu di toko'}
          </p>
        </div>

        <div
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1',
            tone.bg,
          )}
        >
          <motivation.Icon
            className={cn('h-3 w-3', tone.text)}
            strokeWidth={2.5}
          />
          <span
            className={cn(
              'text-[10px] font-bold uppercase tracking-wider',
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
            <linearGradient
              id={gradientId}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>
          </defs>

          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={DONUT_RADIUS}
            fill="none"
            stroke="rgba(255,255,255,0.10)"
            strokeWidth={DONUT_STROKE}
          />

          <circle
            cx={DONUT_SIZE / 2}
            cy={DONUT_SIZE / 2}
            r={DONUT_RADIUS}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={DONUT_STROKE}
            strokeLinecap="round"
            strokeDasharray={DONUT_CIRCUMFERENCE}
            strokeDashoffset={DONUT_CIRCUMFERENCE - employeeFilled}
            style={{ transition: ARC_TRANSITION }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-primary-foreground/35">
            Kontribusi
          </p>
          <p className="mt-1 text-5xl font-bold leading-none text-primary-foreground tabular-nums">
            {(Math.round(animatedPct * 10) / 10).toLocaleString('id-ID')}
            <span className="text-2xl text-primary-foreground/70">%</span>
          </p>
          <p className="mt-2 text-[11px] font-semibold text-amber-200 tabular-nums">
            Rp {fmtCompact(safeEmployeeSales)}
          </p>
        </div>
      </div>

      {/* Stacked bar */}
      <div className="relative mt-5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full bg-gradient-to-r from-amber-300 to-amber-500"
            style={{
              width: `${Math.min(100, animatedPct)}%`,
              transition: BAR_TRANSITION,
            }}
          />
        </div>

        <div className="mt-1 flex justify-between text-[9px] font-medium text-primary-foreground/30 tabular-nums">
          <span>0%</span>
          <span>100% · seluruh toko</span>
        </div>
      </div>

      {/* Hero stat block + teammates */}
      <div className="relative mt-4 grid grid-cols-5 gap-2">
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
            {(Math.round(animatedPct * 10) / 10).toLocaleString('id-ID')}% dari
            total toko
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
          'relative mt-3 flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5',
          tone.bg,
        )}
      >
        <div
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-xl',
            tone.iconBg,
          )}
        >
          <motivation.Icon
            className={cn('h-3.5 w-3.5', tone.text)}
            strokeWidth={2.5}
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className={cn('text-[11px] leading-snug font-medium', tone.text)}>
            {motivation.detail}
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-primary-foreground/30 tabular-nums">
            Total toko Rp {fmtCompact(safeStoreSales)}
          </p>
        </div>
      </div>
    </div>
  );
}