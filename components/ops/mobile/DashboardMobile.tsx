'use client';
// components/ops/mobile/DashboardMobile.tsx
//
// The Ops Dashboard on a phone (below `md`; app/ops/page.tsx renders the desktop panel above it
// from the same data). Top to bottom: a greeting card, today's two rates with the stores that
// need attention, the trend, what is waiting for approval / review, the transfer orders held up
// in each phase, and — Ops HO / IT only — the stores that still need a visit this week.

import { useSession } from 'next-auth/react';
import { RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { DashboardData } from '@/lib/ops-dashboard';
import type { DashboardQueues } from '@/lib/ops-dashboard-queues';
import { MobileSectionTitle } from './MobileKit';
import TrendChart from '@/components/ops/dashboard/TrendChart';
import TodayCards from '@/components/ops/dashboard/TodayCards';
import { IssueQueue, PettyCashQueue, TransferQueue, VisitQueue } from '@/components/ops/dashboard/QueueWidgets';

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date()),
  );
  if (hour < 11) return 'Good morning';
  if (hour < 15) return 'Good afternoon';
  if (hour < 19) return 'Good evening';
  return 'Good night';
}

export default function DashboardMobile({
  data,
  queues,
  loading,
  queuesLoading,
  refreshing,
  lastUpdated,
  onRefresh,
}: {
  data: DashboardData | null;
  queues: DashboardQueues | null;
  loading: boolean;
  queuesLoading: boolean;
  refreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const { data: session } = useSession();
  const firstName = (session?.user?.name ?? '').split(' ')[0] || 'Ops';

  const scopeLabel = data
    ? `${data.scope === 'all_areas' ? 'All areas' : 'Your area'} · ${data.storeCount} store${data.storeCount === 1 ? '' : 's'}`
    : 'Loading…';

  return (
    <div className="min-h-full bg-slate-50 pb-8 md:hidden">
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-5 text-white shadow-lg shadow-indigo-600/20">
          <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 -left-8 h-44 w-44 rounded-full bg-white/5" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-indigo-100">{greeting()},</p>
              <p className="truncate text-2xl font-bold tracking-tight">{firstName}</p>
              <p className="mt-0.5 text-[11px] text-indigo-100">
                {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/20 transition active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-white/15 px-2.5 py-1 font-semibold ring-1 ring-white/20">{scopeLabel}</span>
            {lastUpdated && (
              <span className="text-indigo-100">
                Updated {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Today ────────────────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle>Today&apos;s Stores Needing Attention</MobileSectionTitle>
        <TodayCards data={data} loading={loading} />
      </section>

      {/* ── Trend ─────────────────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <TrendChart className="p-4" />
      </section>

      {/* ── Approvals & reviews ──────────────────────────────────────────── */}
      <section className="space-y-4 px-4 pt-6">
        <MobileSectionTitle>Approvals &amp; Reviews</MobileSectionTitle>
        <PettyCashQueue queues={queues} loading={queuesLoading} showArea={queues?.scope === 'all_areas'} />
        <IssueQueue queues={queues} loading={queuesLoading} />
      </section>

      {/* ── Transfer orders ──────────────────────────────────────────────── */}
      <section className="space-y-4 px-4 pt-6">
        <MobileSectionTitle>Transfer Orders</MobileSectionTitle>
        <TransferQueue kind="return" queues={queues} loading={queuesLoading} />
        <TransferQueue kind="shipping" queues={queues} loading={queuesLoading} />
        <TransferQueue kind="receiving" queues={queues} loading={queuesLoading} />
      </section>

      {/* ── Ops HO / IT: this week's visits ──────────────────────────────── */}
      {queues?.visits && (
        <section className="px-4 pt-6">
          <MobileSectionTitle>Store Visits</MobileSectionTitle>
          <VisitQueue visits={queues.visits} limit={5} />
        </section>
      )}
    </div>
  );
}
