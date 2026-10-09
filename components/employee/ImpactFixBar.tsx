'use client';
// components/employee/ImpactFixBar.tsx
//
// The warning / motivation bar at the top of the employee dashboard (above
// Performance): how many of the "tidak" findings from Ops's Impact Visits are
// "Sudah diperbaiki" and how many are still "Belum diperbaiki" after Ops's
// re-checks — with a progress bar and a nudge that follows how far along the
// store is. Tapping it opens Impact Visit Result (the list of points to fix).
//
// Draws nothing while loading, when the store has no submitted visit yet, or on a
// fetch error — a dashboard should never show an empty warning. Numbers come from
// the same endpoint as that page (/api/employee/impact-visits), so the two agree.

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronRight, Sparkles, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import {
  impactFixMessage,
  impactFixOverview,
  type ImpactFixOverview,
  type ImpactVisitResultSummary,
} from '@/lib/impact-visit/results';

const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });

function Footnote({ o, className }: { o: ImpactFixOverview; className: string }) {
  return (
    <p className={cn('text-[10px] leading-snug', className)}>
      {o.lastCheckedAt ? `Cek ulang Ops terakhir: ${fmtDay(o.lastCheckedAt)}` : 'Belum ada cek ulang dari Ops'} · dari{' '}
      {o.visits} kunjungan terakhir
    </p>
  );
}

export default function ImpactFixBar({ enabled }: { enabled: boolean }) {
  const { data } = useApi<{ success?: boolean; visits?: ImpactVisitResultSummary[] }>(
    enabled ? '/api/employee/impact-visits' : null,
  );

  const visits = data?.success && Array.isArray(data.visits) ? data.visits : [];
  if (visits.length === 0) return null;

  const o = impactFixOverview(visits);
  const message = impactFixMessage(o);
  const clean = o.open === 0; // nothing found, or everything fixed

  return (
    <div className="mx-auto w-full max-w-md px-4 pt-5">
      <Link
        href="/employee/impact-visits"
        className={cn(
          'block rounded-2xl border p-3.5 shadow-sm transition active:scale-[0.99]',
          clean ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50',
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
              clean ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600',
            )}
          >
            {clean ? <Sparkles className="h-4.5 w-4.5" /> : <AlertTriangle className="h-4.5 w-4.5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn('text-sm font-bold', clean ? 'text-emerald-900' : 'text-amber-900')}>
              {o.total === 0
                ? 'Hasil Impact Visit bersih'
                : clean
                  ? 'Semua temuan Impact Visit sudah diperbaiki'
                  : `${o.open} poin Impact Visit belum diperbaiki`}
            </p>
            <p className={cn('mt-0.5 text-xs leading-snug', clean ? 'text-emerald-800/80' : 'text-amber-800/80')}>
              {message}
            </p>
          </div>
          <ChevronRight className={cn('mt-1 h-4 w-4 flex-shrink-0', clean ? 'text-emerald-400' : 'text-amber-400')} />
        </div>

        {o.total > 0 && (
          <>
            <div
              role="progressbar"
              aria-label="Poin Impact Visit yang sudah diperbaiki"
              aria-valuenow={o.fixed}
              aria-valuemin={0}
              aria-valuemax={o.total}
              className={cn('mt-3 h-2 overflow-hidden rounded-full', clean ? 'bg-emerald-200' : 'bg-amber-200/70')}
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${o.fixedPct}%` }}
              />
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {o.fixed} sudah diperbaiki
              </span>
              <span className={cn('inline-flex items-center gap-1', clean ? 'text-emerald-700/60' : 'text-amber-800')}>
                <Wrench className="h-3.5 w-3.5" />
                {o.open} belum diperbaiki
              </span>
            </div>
          </>
        )}

        <Footnote o={o} className={cn('mt-1.5', clean ? 'text-emerald-800/60' : 'text-amber-800/60')} />
      </Link>
    </div>
  );
}
