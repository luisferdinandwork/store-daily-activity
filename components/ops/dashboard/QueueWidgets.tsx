'use client';
// components/ops/dashboard/QueueWidgets.tsx
//
// The "waiting on Ops" cards of the Ops Dashboard, longest-waiting first. All of them read
// one feed — GET /api/ops/dashboard/queues (lib/ops-dashboard-queues.ts) — and are used by both
// the desktop layout and the phone layout.
//
//   PettyCashQueue     requests + refills waiting for Ops to approve (area + Ops Area shown to HO)
//   IssueQueue         reported issues nobody has reviewed yet
//   TransferQueue      Item Return · On Delivery · Item Receiving that are still open
//   VisitQueue         Ops HO / IT only: stores that still need a visit this week (+ area + Ops Area)

import { AlertTriangle, CalendarClock, Package, PackageCheck, Truck, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONE as VISIT_TONE } from '@/components/ops/store-visits/tones';
import {
  rupiah,
  weekRangeLabel,
  type DashboardQueues,
  type PettyCashWaitingRow,
  type TransferWaitingRow,
  type VisitWaitingRow,
} from '@/lib/ops-dashboard-queues';
import { cycleName } from '@/lib/store-visit/cycles';
import { daysLeftLabel, deadlineLabel } from '@/lib/store-visit/upcoming';
import type { Tone } from '@/lib/status-theme';
import {
  AreaLine,
  CountChip,
  DashCard,
  MoreLink,
  QueueEmpty,
  QueueRow,
  QueueSkeleton,
  StoreName,
  WaitChip,
} from './widgets';

type Queues = DashboardQueues | null;

// ─── Petty cash ──────────────────────────────────────────────────────────────

const PETTY_KIND: Record<PettyCashWaitingRow['kind'], { label: string; tone: Tone; href: string }> = {
  request: { label: 'Request', tone: 'neutral', href: '/ops/petty-cash/requests' },
  refill: { label: 'Refill', tone: 'active', href: '/ops/petty-cash/refills' },
};

export function PettyCashQueue({ queues, loading, showArea }: { queues: Queues; loading: boolean; showArea: boolean }) {
  const q = queues?.pettyCash;
  // Whichever kind has something waiting is where "View all" goes.
  const href = q && q.requests === 0 && q.refills > 0 ? PETTY_KIND.refill.href : PETTY_KIND.request.href;

  return (
    <DashCard
      icon={Wallet}
      tone="warning"
      title="Petty Cash Need Approval"
      subtitle={
        q && q.total > 0
          ? `${q.requests} request · ${q.refills} refill — longest waiting first`
          : 'Requests and refills waiting for Ops'
      }
      count={q?.total}
      href={href}
    >
      {loading || !q ? (
        <QueueSkeleton />
      ) : q.items.length === 0 ? (
        <QueueEmpty>Tidak ada petty cash yang menunggu persetujuan</QueueEmpty>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {q.items.map((row) => {
              const kind = PETTY_KIND[row.kind];
              return (
                <QueueRow key={row.key} href={kind.href}>
                  <div className="flex items-center gap-3">
                    <StoreName storeNo={row.store.storeNo} name={row.store.name} className="min-w-0 flex-1" />
                    <WaitChip since={row.since} />
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <CountChip tone={kind.tone}>{kind.label}</CountChip>
                    <span className="shrink-0 font-semibold tabular-nums text-slate-800">{rupiah(row.amount)}</span>
                    <span className="truncate">{row.note}</span>
                  </p>
                  {showArea && <AreaLine store={row.store} className="mt-1" />}
                </QueueRow>
              );
            })}
          </ul>
          <MoreLink href={href} count={q.total - q.items.length} noun="waiting" />
        </>
      )}
    </DashCard>
  );
}

// ─── Issues ──────────────────────────────────────────────────────────────────

export function IssueQueue({ queues, loading }: { queues: Queues; loading: boolean }) {
  const q = queues?.issues;

  return (
    <DashCard
      icon={AlertTriangle}
      tone="danger"
      title="Unreviewed Issues"
      subtitle="Reported, not reviewed yet — longest waiting first"
      count={q?.total}
      href="/ops/issues"
    >
      {loading || !q ? (
        <QueueSkeleton />
      ) : q.items.length === 0 ? (
        <QueueEmpty>Semua issue sudah direview</QueueEmpty>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {q.items.map((row) => (
              <QueueRow key={row.id} href="/ops/issues">
                <div className="flex items-center gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{row.title}</p>
                  <WaitChip since={row.since} />
                </div>
                <StoreName storeNo={row.store.storeNo} name={row.store.name} className="mt-0.5 text-xs" />
                <p className="mt-0.5 truncate text-[11px] text-slate-400">Dilaporkan oleh {row.reporterName}</p>
              </QueueRow>
            ))}
          </ul>
          <MoreLink href="/ops/issues" count={q.total - q.items.length} noun="unreviewed" />
        </>
      )}
    </DashCard>
  );
}

// ─── Transfer orders ─────────────────────────────────────────────────────────

// The same phases (and tones) as the Transfer Order page's PHASE_CFG.
const TRANSFER_KIND = {
  return: { title: 'Item Return', subtitle: 'Waiting for pickup', tone: 'warning' as Tone, icon: Package, empty: 'Tidak ada Item Return yang menunggu diambil' },
  shipping: { title: 'On Delivery', subtitle: 'On the road to the store', tone: 'info' as Tone, icon: Truck, empty: 'Tidak ada kiriman yang sedang di perjalanan' },
  receiving: { title: 'Item Receiving', subtitle: 'Waiting for BC to post the receipt', tone: 'active' as Tone, icon: PackageCheck, empty: 'Tidak ada Item Receiving yang menunggu BC' },
} as const;

export function TransferQueue({
  kind,
  queues,
  loading,
}: {
  kind: keyof typeof TRANSFER_KIND;
  queues: Queues;
  loading: boolean;
}) {
  const cfg = TRANSFER_KIND[kind];
  const q = queues?.transfers[kind];

  return (
    <DashCard
      icon={cfg.icon}
      tone={cfg.tone}
      title={cfg.title}
      subtitle={cfg.subtitle}
      count={q?.total}
      href="/ops/transfer-order"
    >
      {loading || !q ? (
        <QueueSkeleton />
      ) : q.items.length === 0 ? (
        <QueueEmpty>{cfg.empty}</QueueEmpty>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {q.items.map((row: TransferWaitingRow) => (
              <QueueRow key={row.id} href="/ops/transfer-order">
                <div className="flex items-center gap-3">
                  <StoreName storeNo={row.store.storeNo} name={row.store.name} className="min-w-0 flex-1" />
                  <WaitChip since={row.since} />
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  <span className="font-medium text-slate-600">{row.toaNo}</span>
                  <span className="text-slate-300"> · </span>
                  {row.otherEnd}
                  <span className="text-slate-300"> · </span>
                  {row.qty.toLocaleString('id-ID')} pcs
                </p>
              </QueueRow>
            ))}
          </ul>
          <MoreLink href="/ops/transfer-order" count={q.total - q.items.length} noun="open" />
        </>
      )}
    </DashCard>
  );
}

// ─── Store visits (Ops HO / IT) ──────────────────────────────────────────────

function VisitRow({ row, className }: { row: VisitWaitingRow; className?: string }) {
  const tone = VISIT_TONE[row.tone];
  return (
    <QueueRow href="/ops/store-visits/upcoming" className={className}>
      <div className="flex items-center gap-3">
        <StoreName storeNo={row.store.storeNo} name={row.store.name} className="min-w-0 flex-1" />
        <span
          title={`Batas kunjungan: ${deadlineLabel(row.deadline)}`}
          className={cn(
            'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset',
            tone.pill,
          )}
        >
          {daysLeftLabel(row.daysLeft)}
        </span>
      </div>
      <AreaLine store={row.store} className="mt-1" />
      {row.intervalDays !== 7 && (
        <p className="mt-0.5 text-[11px] text-slate-400">
          {cycleName(row.intervalDays)} · sampai {deadlineLabel(row.deadline)}
        </p>
      )}
    </QueueRow>
  );
}

export function VisitQueue({ visits, limit }: { visits: NonNullable<DashboardQueues['visits']>; limit: number }) {
  const shown = visits.items.slice(0, limit);
  const rest = visits.total - shown.length;

  return (
    <DashCard
      icon={CalendarClock}
      tone="active"
      title="Stores That Still Need a Visit This Week"
      subtitle={`${weekRangeLabel({ start: visits.weekStart, end: visits.weekEnd })} — nearest deadline first`}
      count={visits.total}
      href="/ops/store-visits/upcoming"
    >
      {shown.length === 0 ? (
        <QueueEmpty>Semua toko sudah dikunjungi minggu ini</QueueEmpty>
      ) : (
        <div className="@container">
          {/* Two columns once the card is wide enough: a long list reads as a short one. */}
          <ul className="grid grid-cols-1 divide-y divide-slate-100 @2xl:grid-cols-2 @2xl:gap-x-6 @2xl:divide-y-0 @2xl:px-2">
            {shown.map((row) => (
              <VisitRow
                key={row.store.id}
                row={row}
                className="@2xl:border-b @2xl:border-slate-100 @2xl:[&:nth-last-child(-n+2)]:border-b-0"
              />
            ))}
          </ul>
          <MoreLink href="/ops/store-visits/upcoming" count={rest} noun={rest === 1 ? 'store' : 'stores'} />
        </div>
      )}
    </DashCard>
  );
}
