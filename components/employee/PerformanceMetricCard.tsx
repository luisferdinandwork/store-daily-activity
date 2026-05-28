// components/employee/PerformanceMetricCard.tsx
'use client';

import type { ElementType } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  icon: ElementType;
  label: string;
  value: string;
  /** Sub line shown beneath the label — usually the target. */
  sub?: string;
  /** 0–100. When omitted, ring is not rendered. */
  pct?: number;
  iconBg: string;
  /** Optional 3rd line for monthly view. */
  footnote?: string;
}

function clampPct(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function MiniRing({ pct }: { pct: number }) {
  const safePct = clampPct(pct);

  const size = 48;
  const r = 20;
  const stroke = 4.5;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - safePct / 100);

  const color =
    safePct >= 100 ? '#4ade80' :
    safePct >= 60  ? '#fbbf24' :
                     'rgba(255,255,255,0.45)';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold tabular-nums text-white">
          {Math.round(safePct)}%
        </span>
      </div>
    </div>
  );
}

export function PerformanceMetricCard({
  icon: Icon,
  label,
  value,
  sub,
  pct,
  iconBg,
  footnote,
}: Props) {
  return (
    <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-2">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', iconBg)}>
          <Icon className="h-4 w-4 text-white" strokeWidth={2.2} />
        </div>

        {pct != null && <MiniRing pct={pct} />}
      </div>

      <p className="mt-3 text-xl font-bold leading-none text-white tabular-nums">
        {value}
      </p>

      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
        {label}
      </p>

      {sub && <p className="mt-0.5 text-[10px] text-white/35">{sub}</p>}
      {footnote && <p className="mt-0.5 text-[10px] font-medium text-white/40">{footnote}</p>}
    </div>
  );
}