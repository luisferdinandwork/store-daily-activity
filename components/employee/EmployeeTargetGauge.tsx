// components/employee/EmployeeTargetGauge.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, Trophy, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  /** This employee's own actual sales for the selected period. */
  employeeSales: number | null | undefined;
  /** This employee's own sales target for the selected period. */
  employeeTarget: number | null | undefined;
  /** Employee actual ÷ employee target, uncapped (e.g. 118 means 118%). */
  achievementPct: number | null | undefined;
  /** e.g. "Juli 2026" or "Hari ini". */
  periodLabel: string;
}

const GAUGE_SIZE = 152;
const GAUGE_STROKE = 13;
const GAUGE_RADIUS = (GAUGE_SIZE - GAUGE_STROKE) / 2;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const GAUGE_CENTER = GAUGE_SIZE / 2;

function toSafeNumber(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtRupiah(value: number): string {
  const n = Math.max(0, Math.round(toSafeNumber(value)));
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function fmtCompact(value: number | null | undefined): string {
  const n = Math.max(0, toSafeNumber(value));
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000) return `Rp ${Math.round(n / 1_000)}rb`;
  return `Rp ${Math.round(n)}`;
}

export function EmployeeTargetGauge({
  employeeSales,
  employeeTarget,
  achievementPct,
  periodLabel,
}: Props) {
  const safeSales = Math.max(0, toSafeNumber(employeeSales));
  const safeTarget = Math.max(0, toSafeNumber(employeeTarget));
  const hasTarget = safeTarget > 0;
  const safeAchievement = Math.max(0, toSafeNumber(achievementPct));
  const reached = hasTarget && safeAchievement >= 100;
  const remaining = Math.max(0, safeTarget - safeSales);
  const surplus = Math.max(0, safeSales - safeTarget);

  const [progress, setProgress] = useState(0);
  useEffect(() => {
    setProgress(0);
    const t = setTimeout(() => setProgress(1), 80);
    return () => clearTimeout(t);
  }, [safeAchievement, safeSales, safeTarget]);

  const ringPct = Math.min(100, safeAchievement) * progress;
  const dashLength = useMemo(
    () => GAUGE_CIRCUMFERENCE * (ringPct / 100),
    [ringPct],
  );

  if (!hasTarget) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-slate-300" />
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            My Target
          </p>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-500">
          No personal target has been set for you yet.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Ask your OPS manager to add you to the store roster.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          My Target
        </p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
          {periodLabel}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-5">
        {/* Radial gauge */}
        <div className="relative shrink-0" style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}>
          <svg
            viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
            className="h-full w-full -rotate-90"
          >
            <circle
              cx={GAUGE_CENTER}
              cy={GAUGE_CENTER}
              r={GAUGE_RADIUS}
              fill="none"
              stroke="#f1f5f9"
              strokeWidth={GAUGE_STROKE}
            />
            <circle
              cx={GAUGE_CENTER}
              cy={GAUGE_CENTER}
              r={GAUGE_RADIUS}
              fill="none"
              stroke={reached ? '#10b981' : '#7A5AF8'}
              strokeWidth={GAUGE_STROKE}
              strokeLinecap="round"
              strokeDasharray={`${dashLength} ${GAUGE_CIRCUMFERENCE - dashLength}`}
              style={{
                transition:
                  'stroke-dasharray 1s cubic-bezier(0.22,1,0.36,1), stroke 0.4s ease',
              }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">
              {Math.round(safeAchievement)}%
            </p>
            <p className="mt-1 text-[10px] font-semibold text-slate-400">of target</p>
          </div>
        </div>

        {/* Rp stats */}
        <div className="min-w-0 flex-1 space-y-2.5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Achieved
            </p>
            <p className="truncate text-base font-bold text-slate-900 tabular-nums">
              {fmtCompact(safeSales)}
            </p>
          </div>
          <div className="h-px bg-slate-100" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Target
            </p>
            <p className="truncate text-base font-bold text-slate-500 tabular-nums">
              {fmtCompact(safeTarget)}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          'mt-4 flex items-center gap-2.5 rounded-2xl px-3.5 py-3',
          reached ? 'bg-emerald-50' : 'bg-violet-50',
        )}
      >
        {reached ? (
          <Trophy className="h-4 w-4 shrink-0 text-emerald-600" />
        ) : (
          <TrendingUp className="h-4 w-4 shrink-0 text-violet-600" />
        )}
        <p
          className={cn(
            'text-xs font-semibold',
            reached ? 'text-emerald-700' : 'text-violet-700',
          )}
        >
          {reached
            ? `Target tercapai! Kelebihan ${fmtRupiah(surplus)}`
            : `${fmtRupiah(remaining)} lagi untuk capai target`}
        </p>
      </div>
    </div>
  );
}
