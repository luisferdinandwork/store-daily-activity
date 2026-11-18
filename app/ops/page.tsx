'use client';
// app/ops/page.tsx
//
// Ops Dashboard. Two data feeds, two layouts: the desktop panel below, and the phone layout
// (components/ops/mobile/DashboardMobile.tsx) below `md`.
//
//   /api/ops/dashboard          today's Attendance Rate + Completion Rate, every store's figure
//   /api/ops/dashboard/queues   what is waiting on Ops, longest first: petty cash, issues,
//                               transfer orders — and, for Ops HO / IT only, store visits
//
// Top to bottom: the stores that need attention today, the trend, approvals & reviews,
// transfer orders, and (HO) the stores that still need a visit this week.

import { useCallback, useEffect } from 'react';

import { useApi } from '@/lib/client/use-api';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import DashboardMobile from '@/components/ops/mobile/DashboardMobile';
import TrendChart from '@/components/ops/dashboard/TrendChart';
import TodayCards from '@/components/ops/dashboard/TodayCards';
import { IssueQueue, PettyCashQueue, TransferQueue, VisitQueue } from '@/components/ops/dashboard/QueueWidgets';
import { SectionHeading } from '@/components/ops/dashboard/widgets';
import type { DashboardData } from '@/lib/ops-dashboard';
import type { DashboardQueues } from '@/lib/ops-dashboard-queues';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayFull() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function timeShort(d: Date) {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

// Cards sit in a fluid grid: as many columns as fit, never narrower than the minimum — the Ops
// sidebar takes a quarter of the screen, so the viewport width says little about the room left.
const GRID_2 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-5';
const GRID_3 = 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,18.5rem),1fr))] gap-5';

export default function OpsDashboardPage() {
  // Cached + background-revalidated (lib/client/use-api.ts): returning to the
  // dashboard shows the last numbers instantly while fresh ones load.
  const dash = useApi<DashboardData & { success?: boolean }>(`/api/ops/dashboard?date=${todayKey()}`);
  const queuesApi = useApi<DashboardQueues | { success: false; error?: string }>('/api/ops/dashboard/queues');

  const data = dash.data?.success ? dash.data : null;
  const queues = queuesApi.data?.success ? (queuesApi.data as DashboardQueues) : null;
  const loading = dash.loading;
  const queuesLoading = queuesApi.loading;
  const refreshing = (dash.validating || queuesApi.validating) && !dash.loading;
  const lastUpdated = dash.updatedAt ? new Date(dash.updatedAt) : null;
  const refreshDash = dash.refresh;
  const refreshQueues = queuesApi.refresh;
  const load = useCallback(() => {
    void refreshDash();
    void refreshQueues();
  }, [refreshDash, refreshQueues]);

  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Area + Ops Area are for HO: an Ops Area user is looking at their own area already.
  const showArea = queues?.scope === 'all_areas';

  const scopeLabel = data
    ? `${data.scope === 'all_areas' ? 'All areas' : 'Area'} · ${data.storeCount} store${data.storeCount === 1 ? '' : 's'}`
    : '';

  return (
    <>
      <DashboardMobile
        data={data}
        queues={queues}
        loading={loading}
        queuesLoading={queuesLoading}
        refreshing={refreshing}
        lastUpdated={lastUpdated}
        onRefresh={load}
      />

      <div className="hidden min-h-full bg-slate-50 md:block">
        <OpsPageHeader
          scope="OPS · Overview"
          title="Dashboard"
          subtitle={todayFull()}
          onRefresh={load}
          refreshing={refreshing}
          contentClassName="w-full"
        />

        <div className="space-y-10 p-6 lg:p-10">
          {/* ── Today: the two rates, and the stores that need attention ───── */}
          <section>
            <SectionHeading
              right={
                data && (
                  <span>
                    {scopeLabel}
                    {lastUpdated && <> · Updated {timeShort(lastUpdated)}</>}
                  </span>
                )
              }
            >
              Today&apos;s Stores Needing Attention
            </SectionHeading>
            <TodayCards data={data} loading={loading} />
          </section>

          {/* ── Trend: task completion + attendance over a period ─────────── */}
          <TrendChart />

          {/* ── Waiting for Ops to approve / review ──────────────────────── */}
          <section>
            <SectionHeading right="Longest waiting first">Approvals &amp; Reviews</SectionHeading>
            <div className={GRID_2}>
              <PettyCashQueue queues={queues} loading={queuesLoading} showArea={showArea} />
              <IssueQueue queues={queues} loading={queuesLoading} />
            </div>
          </section>

          {/* ── Transfer orders held up in each phase ────────────────────── */}
          <section>
            <SectionHeading right="Still open, longest first">Transfer Orders</SectionHeading>
            <div className={GRID_3}>
              <TransferQueue kind="return" queues={queues} loading={queuesLoading} />
              <TransferQueue kind="shipping" queues={queues} loading={queuesLoading} />
              <TransferQueue kind="receiving" queues={queues} loading={queuesLoading} />
            </div>
          </section>

          {/* ── Ops HO / IT only: the week's visits still to make ────────── */}
          {queues?.visits && (
            <section>
              <SectionHeading right="Ops HO">Store Visits</SectionHeading>
              <VisitQueue visits={queues.visits} limit={10} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}
