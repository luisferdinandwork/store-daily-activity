'use client';
// app/finance/page.tsx
//
// Finance Dashboard — entry point for the Finance panel.
//
// Shows three summary cards:
//   1. Pending petty-cash transactions (awaiting approval)
//   2. Daily reports that need verification (status = 'submitted')
//   3. Open issues routed to Finance role
//
// Each card links to its dedicated Finance sub-page.
// Data is fetched from dedicated Finance API routes (to be implemented).

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  FileText,
  RefreshCw,
  Wallet,
  WalletCards,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardData = {
  pendingPettyCash: number;
  pendingDailyReports: number;
  openIssues: number;
};

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon: Icon,
  label,
  value,
  href,
  accent,
  urgent,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  href: string;
  accent: string;
  urgent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col gap-4 rounded-2xl border bg-white p-6 shadow-sm transition-shadow hover:shadow-md',
        urgent && Number(value) > 0 ? 'border-amber-200' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-xl', accent)}>
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-400" />
      </div>

      <div>
        <p className="text-3xl font-bold tabular-nums text-slate-900">{value}</p>
        <p className="mt-1 text-sm text-slate-500">{label}</p>
      </div>

      {urgent && Number(value) > 0 && (
        <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Needs attention
        </span>
      )}
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceDashboardPage() {
  const [data, setData]       = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/finance/dashboard', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setData(body.data);
      else setError(body.error ?? 'Failed to load dashboard.');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const now = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="min-h-full bg-slate-50">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-5xl px-6 py-4 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Overview
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Dashboard
              </h1>
              <p className="mt-1 text-sm text-slate-500">{now}</p>
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8 lg:px-8">

        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl bg-slate-100" />
            ))
          ) : (
            <>
              <SummaryCard
                icon={Wallet}
                label="Petty Cash awaiting approval"
                value={data?.pendingPettyCash ?? 0}
                href="/finance/petty-cash"
                accent="bg-emerald-50 text-emerald-600"
                urgent
              />
              <SummaryCard
                icon={FileText}
                label="Daily Reports pending verification"
                value={data?.pendingDailyReports ?? 0}
                href="/finance/daily-reports"
                accent="bg-sky-50 text-sky-600"
                urgent
              />
              <SummaryCard
                icon={AlertTriangle}
                label="Open issues routed to Finance"
                value={data?.openIssues ?? 0}
                href="/finance/issues"
                accent="bg-amber-50 text-amber-600"
                urgent
              />
            </>
          )}
        </div>

        {/* Quick-access links */}
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">
            Quick access
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { href: '/finance/setoran',       label: 'Setoran Review',   icon: WalletCards,   desc: 'Review money-storage discrepancies' },
              { href: '/finance/daily-reports',  label: 'Daily Reports',    icon: FileText,      desc: 'Verify submitted EOD reports' },
              { href: '/finance/petty-cash',     label: 'Petty Cash',       icon: Wallet,        desc: 'Approve or reject cash requests' },
            ].map(({ href, label, icon: Icon, desc }) => (
              <Link
                key={href}
                href={href}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-emerald-200 hover:shadow-md"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 transition group-hover:bg-emerald-100">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{label}</p>
                  <p className="truncate text-[11px] text-slate-500">{desc}</p>
                </div>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-500" />
              </Link>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}