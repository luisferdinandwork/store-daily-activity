'use client';
// components/ops/dashboard/QueueWidgets.tsx
//
// The "waiting on Ops" cards of the Ops Dashboard, longest-waiting first. All of them read
// one feed — GET /api/ops/dashboard/queues (lib/ops-dashboard-queues.ts) — and are used by both
// the desktop layout and the phone layout.
//
//   PettyCashQueue     requests + refills waiting for Ops to approve (area + Ops Area shown to HO)
//   IssueQueue         reported issues nobody has reviewed yet
//   TransferAverage    Item Return · Item Receiving · Item Delivery: stores slower than this month's average
//   VisitQueue         Ops HO / IT only: stores that still need a visit this week (+ area + Ops Area)

import { AlertTriangle, CalendarClock, Package, PackageCheck, Truck, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { TONE as VISIT_TONE } from '@/components/ops/store-visits/tones';
import {
  rupiah,
  weekRangeLabel,
  type DashboardQueues,
  type PettyCashWaitingRow,
  type VisitWaitingRow,
} from '@/lib/ops-dashboard-queues';
import { formatMinutes } from '@/lib/transfer-order-metrics';
import type { Process } from '@/lib/transfer-order-report';
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

// The same tones as the Transfer Order page's phases; each opens its TO Report page on "Bulanan".
const TRANSFER_KIND: Record<Process, { title: string; range: string; tone: Tone; icon: typeof Package }> = {
  return: { title: 'Item Return', range: 'TO Dibuat → Foto Serah Terima', tone: 'warning', icon: Package },
  receiving: { title: 'Item Receiving', range: 'Terima Fisik → WR Diposting', tone: 'active', icon: PackageCheck },
  delivery: { title: 'Item Delivery', range: 'Foto Serah Terima → Terima Fisik', tone: 'info', icon: Truck },
};

const MONTH_NAME = (yearMonth: string) =>
  new Date(`${yearMonth}-01T00:00:00Z`).toLocaleDateString('id-ID', { month: 'long', timeZone: 'UTC' });

/** One process: the stores whose average this month is above the month's average, slowest first. */
export function TransferAverage({ kind, queues, loading }: { kind: Process; queues: Queues; loading: boolean }) {
  const cfg = TRANSFER_KIND[kind];
  const t = queues?.transfers;
  const q = t?.[kind];
  const href = `/ops/transfer-order/report/${kind}?period=monthly`;

  return (
    <DashCard
      icon={cfg.icon}
      tone={cfg.tone}
      title={cfg.title}
      subtitle={
        q && t && q.monthAvgMinutes != null
          ? `Above ${MONTH_NAME(t.month)} average · ${formatMinutes(q.monthAvgMinutes)}`
          : 'Stores slower than this month\'s average'
      }
      count={q?.total}
      href={href}
    >
      {loading || !q ? (
        <QueueSkeleton />
      ) : q.monthAvgMinutes == null ? (
        <QueueEmpty>Belum ada {cfg.title} yang selesai bulan ini</QueueEmpty>
      ) : q.items.length === 0 ? (
        <QueueEmpty>Tidak ada toko di atas rata-rata bulan ini</QueueEmpty>
      ) : (
        <>
          <ul className="divide-y divide-slate-100">
            {q.items.map((row) => (
              <QueueRow key={row.store.id} href={href}>
                <div className="flex items-center gap-3">
                  <StoreName storeNo={row.store.storeNo} name={row.store.name} className="min-w-0 flex-1" />
                  <span
                    title={`Rata-rata ${cfg.range} dari ${row.timed} proses selesai`}
                    className={cn(
                      'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums',
                      TONES[cfg.tone].chip,
                    )}
                  >
                    {formatMinutes(row.avgMinutes)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                  Rata-rata dari {row.timed} selesai
                </p>
              </QueueRow>
            ))}
          </ul>
          <MoreLink href={href} count={q.total - q.items.length} noun={q.total - q.items.length === 1 ? 'store' : 'stores'} />
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
