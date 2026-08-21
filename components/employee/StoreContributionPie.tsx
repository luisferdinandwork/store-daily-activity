// components/employee/StoreContributionPie.tsx
'use client';

import { useMemo, useState } from 'react';
import { Check, PieChart } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmployeeContribution {
  userId: string;
  name: string;
  isCurrentUser: boolean;
  /** Actual sales ÷ store target, already capped at this employee's own target-share %. */
  contributionPct: number;
  /** This employee's assigned target ÷ store target — 0 if no target assigned. */
  targetSharePct: number;
  /** True once this employee's actual sales reach or exceed their own target share. */
  reachedGoal: boolean;
}

interface Props {
  employeeContributions: EmployeeContribution[] | null | undefined;
  /** e.g. "Juli 2026" or "Hari ini". */
  periodLabel: string;
}

const PIE_SIZE = 168;
const PIE_STROKE = 30;
const PIE_RADIUS = (PIE_SIZE - PIE_STROKE) / 2;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;
const PIE_CENTER = PIE_SIZE / 2;
const SEGMENT_GAP = 4;
const BADGE_RADIUS = PIE_RADIUS + PIE_STROKE / 2 + 2;

/** "You" always gets this color. Reserved — never assigned to a teammate. */
const CURRENT_USER_COLOR = '#fbbf24'; // amber-400
/** Reserved for the "goal reached" badge/ring — never assigned as a teammate identity color. */
const GOAL_COLOR = '#10b981'; // emerald-500

/** Fixed-order categorical palette for teammates. Amber/emerald excluded — reserved above. */
const TEAMMATE_PALETTE = [
  '#0ea5e9', // sky
  '#fb923c', // orange
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#d946ef', // fuchsia
  '#818cf8', // indigo
  '#f97316', // orange-deep
];

function toSafeNumber(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function clampPct(value: number | null | undefined) {
  return Math.max(0, Math.min(100, toSafeNumber(value)));
}

function fmtPct(value: number): string {
  return (Math.round(toSafeNumber(value) * 10) / 10).toLocaleString('id-ID');
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function polarPoint(radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: PIE_CENTER + radius * Math.cos(rad),
    y: PIE_CENTER + radius * Math.sin(rad),
  };
}

export function StoreContributionPie({ employeeContributions, periodLabel }: Props) {
  const ordered = useMemo(() => {
    const list = (employeeContributions ?? []).filter(
      (c) => c.contributionPct > 0 || c.targetSharePct > 0 || c.isCurrentUser,
    );
    return [...list].sort((a, b) => {
      if (a.isCurrentUser !== b.isCurrentUser) return a.isCurrentUser ? -1 : 1;
      return b.contributionPct - a.contributionPct;
    });
  }, [employeeContributions]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totalContributionPct = ordered.reduce(
    (sum, c) => sum + clampPct(c.contributionPct),
    0,
  );
  const unassignedPct = Math.max(0, 100 - totalContributionPct);

  const slices = useMemo(() => {
    return ordered.map((c, i) => ({
      userId: c.userId,
      name: c.name,
      isCurrentUser: c.isCurrentUser,
      contributionPct: clampPct(c.contributionPct),
      targetSharePct: clampPct(c.targetSharePct),
      reachedGoal: c.reachedGoal,
      color: c.isCurrentUser
        ? CURRENT_USER_COLOR
        : TEAMMATE_PALETTE[i % TEAMMATE_PALETTE.length],
    }));
  }, [ordered]);

  // Build stacked arcs, one per employee, plus a trailing gray "unassigned" arc.
  const { arcs, badges } = useMemo(() => {
    let cumulative = 0;
    const gap = slices.length > 1 ? SEGMENT_GAP : 0;
    const arcList: {
      key: string;
      color: string;
      dasharray: string;
      dashoffset: number;
      isCurrentUser: boolean;
    }[] = [];
    const badgeList: { key: string; x: number; y: number }[] = [];

    for (const s of slices) {
      const rawLength = PIE_CIRCUMFERENCE * (s.contributionPct / 100);
      const length = Math.max(0, rawLength - gap);
      arcList.push({
        key: s.userId,
        color: s.color,
        dasharray: `${length} ${PIE_CIRCUMFERENCE - length}`,
        dashoffset: -cumulative,
        isCurrentUser: s.isCurrentUser,
      });

      if (s.reachedGoal && length > 0) {
        const midAngle = ((cumulative + length / 2) / PIE_CIRCUMFERENCE) * 360;
        const pt = polarPoint(BADGE_RADIUS, midAngle);
        badgeList.push({ key: s.userId, x: pt.x, y: pt.y });
      }

      cumulative += rawLength;
    }

    if (unassignedPct > 0.4) {
      const rawLength = PIE_CIRCUMFERENCE * (unassignedPct / 100);
      const length = Math.max(0, rawLength - gap);
      arcList.push({
        key: '__unassigned',
        color: '#e2e8f0',
        dasharray: `${length} ${PIE_CIRCUMFERENCE - length}`,
        dashoffset: -cumulative,
        isCurrentUser: false,
      });
    }

    return { arcs: arcList, badges: badgeList };
  }, [slices, unassignedPct]);

  if (slices.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-5">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-slate-300" />
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            Store Achive
          </p>
        </div>
        <p className="mt-3 text-sm font-medium text-slate-500">
          No roster data available for this period yet.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Store Achive
        </p>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
          {periodLabel}
        </span>
      </div>

      <div className="mt-4 flex items-center justify-center">
        <div className="relative" style={{ width: PIE_SIZE, height: PIE_SIZE }}>
          <svg viewBox={`0 0 ${PIE_SIZE} ${PIE_SIZE}`} className="h-full w-full -rotate-90">
            {arcs.map((a) => {
              const isDimmed = selectedId !== null && selectedId !== a.key;
              return (
                <circle
                  key={a.key}
                  cx={PIE_CENTER}
                  cy={PIE_CENTER}
                  r={PIE_RADIUS}
                  fill="none"
                  stroke={a.color}
                  strokeWidth={a.isCurrentUser ? PIE_STROKE + 2 : PIE_STROKE}
                  strokeLinecap="butt"
                  strokeDasharray={a.dasharray}
                  strokeDashoffset={a.dashoffset}
                  style={{
                    opacity: isDimmed ? 0.25 : 1,
                    transition: 'opacity 0.2s ease',
                  }}
                />
              );
            })}
          </svg>

          {/* Goal-reached badges — a distinct visual channel from slice hue */}
          {badges.map((b) => (
            <div
              key={b.key}
              className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-sm"
              style={{ left: b.x, top: b.y, background: GOAL_COLOR }}
            >
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </div>
          ))}

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <p className="text-2xl font-bold leading-none text-slate-900 tabular-nums">
              {fmtPct(totalContributionPct)}%
            </p>
            <p className="mt-1 text-[10px] font-semibold leading-tight text-slate-400">
              of store target
              <br />
              filled by the team
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 mt-8">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
          Staff Achievement
        </p>
      </div>

      {/* Legend rows — full detail always visible, tap to highlight on the ring */}
      <div className="mt-4 space-y-1.5">
        {slices.map((s) => {
          const isSelected = selectedId === s.userId;
          const isDimmed = selectedId !== null && !isSelected;
          const barPct =
            s.targetSharePct > 0
              ? Math.min(100, (s.contributionPct / s.targetSharePct) * 100)
              : 0;

          return (
            <button
              key={s.userId}
              type="button"
              onClick={() => setSelectedId(isSelected ? null : s.userId)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors',
                isSelected ? 'bg-slate-50' : 'hover:bg-slate-50/60',
                isDimmed && 'opacity-40',
              )}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color }}
              />

              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                {firstName(s.name)}
              </span>

              {s.targetSharePct > 0 ? (
                <div className="hidden w-16 shrink-0 sm:block">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, background: s.color }}
                    />
                  </div>
                </div>
              ) : null}

              <span className="shrink-0 text-xs font-bold tabular-nums text-slate-500">
                {fmtPct(s.contributionPct)}%
              </span>

              {s.targetSharePct > 0 ? (
                s.reachedGoal ? (
                  <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    Reached
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                    In progress
                  </span>
                )
              ) : (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                  No target
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
