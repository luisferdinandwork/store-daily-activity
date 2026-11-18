'use client';
// components/ops/petty-cash/StoreDetailSheet.tsx
//
// Ops · Petty Cash · Stores — one store opened from the list: its cash, the period in use, PIC 1, the latest
// Refills and the requests of the period in use + the one before (and anything still open from earlier).
// Read-only: approving / rejecting stays on the Requests and Refills pages, linked at the bottom.
// Data: GET /api/ops/petty-cash/stores/[storeId].

import Link from 'next/link';
import { AlertTriangle, ArrowRight, ImageOff, Loader2, Receipt, Wallet } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { periodMonthName, periodRangeLabel } from '@/lib/petty-cash-period';
import { FINANCE_REVIEW_LABEL, isFinanceReview, leavesOutOfTransfer } from '@/lib/petty-cash-review';
import {
  storeStatusOf,
  type PettyCashStoreDetailResponse,
  type PettyCashStoreRow,
  type StoreDetailRequest,
} from '@/lib/ops-petty-cash-stores';
import { LateBadge } from '@/components/petty-cash/PeriodBadge';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import { RefillStateChip, TxStatusChip, fmtDay, fmtWhen, rp, useJsonFeed } from './shared';
import { BalanceCell, OpenCounts, RefillCell, StoreStatusChip } from './store-pieces';

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function RequestLine({ r }: { r: StoreDetailRequest }) {
  const review = isFinanceReview(r.financeReview) ? r.financeReview : null;
  const leftOut = r.status === 'completed' && review != null && leavesOutOfTransfer(review);
  const amount = r.actualAmount ?? r.amount;

  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      {r.imageUrl ? (
        <a
          href={r.imageUrl}
          target="_blank"
          rel="noreferrer"
          title="Open receipt"
          className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-300 bg-slate-100 hover:border-indigo-500"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.imageUrl} alt="Receipt" loading="lazy" className="h-full w-full object-cover" />
        </a>
      ) : (
        <span
          title="No photo"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50"
        >
          <ImageOff className="h-3.5 w-3.5 text-slate-300" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1">
          {r.categoryName && (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{r.categoryName}</span>
          )}
          <TxStatusChip status={r.status} />
          {r.isReRequest && <ReRequestBadge />}
          {review && r.status === 'completed' && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
                leftOut ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-slate-50 text-slate-600 ring-slate-200',
              )}
              title={leftOut ? 'Finance decision — not counted as used' : 'Finance decision'}
            >
              {FINANCE_REVIEW_LABEL[review]}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-slate-800" title={r.description}>
          {r.description}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {fmtWhen(r.createdAt)} · {r.submittedByName}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className={cn('text-[13px] font-semibold tabular-nums', leftOut || r.status === 'ops_rejected' ? 'text-slate-400 line-through' : 'text-slate-900')}>
          {rp(amount)}
        </p>
        {r.actualAmount == null && r.status !== 'ops_rejected' && (
          <p className="text-[10px] text-slate-400">requested</p>
        )}
      </div>
    </li>
  );
}

function Body({ storeId, maxBalance }: { storeId: number; maxBalance: number }) {
  const feed = useJsonFeed<PettyCashStoreDetailResponse>(`/api/ops/petty-cash/stores/${storeId}`);
  const data = feed.data;

  if (!data) {
    return feed.error ? (
      <div className="m-5 flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
        <p className="text-sm font-medium text-rose-700">{feed.error}</p>
      </div>
    ) : (
      <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const s = data.store;
  // Requests grouped by period: the period in use first, then the one before, then anything older still open.
  const months = [...new Set(data.requests.map((r) => r.periodMonth))].sort((a, b) => b.localeCompare(a));

  return (
    <div className={cn('min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5', feed.loading && 'opacity-60')}>
      {/* Numbers */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-slate-300 bg-slate-300 sm:grid-cols-3">
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Balance (cash)</p>
          <div className="mt-1.5">
            <BalanceCell row={s} max={maxBalance} wide />
          </div>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Used this period</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{rp(s.used)}</p>
          <p className="text-[11px] text-slate-500">
            {s.completedCount} completed request{s.completedCount === 1 ? '' : 's'}
          </p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Period in use</p>
          <p className="mt-0.5 text-lg font-bold text-slate-900">{periodMonthName(s.periodMonth)}</p>
          <p className="text-[11px] text-slate-500">{periodRangeLabel(s.periodMonth)}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="PIC 1 (petty cash holder)">
          {s.pic1.length === 0 ? (
            <p className="text-sm italic text-slate-400">No active PIC 1 at this store.</p>
          ) : (
            <ul className="space-y-1">
              {s.pic1.map((p) => (
                <li key={p.id} className="text-sm text-slate-800">
                  {p.name} <span className="font-mono text-[11px] text-slate-400">{p.nik}</span>
                </li>
              ))}
              {s.pic1.length > 1 && (
                <li className="text-[11px] font-semibold text-rose-600">More than one PIC 1 — only one should hold the cash.</li>
              )}
            </ul>
          )}
        </Section>
        <Section title="Open now">
          <OpenCounts row={s} className="text-sm" />
        </Section>
      </div>

      <Section title="Refill" aside={<RefillCell refill={s.refill} />}>
        {data.refills.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">
            This store hasn’t sent a Refill yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
            {data.refills.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800">Periode {periodMonthName(r.month)}</p>
                  <p className="truncate text-[11px] text-slate-400">
                    Sent {fmtDay(r.requestedAt)}
                    {r.requestedByName ? ` · ${r.requestedByName}` : ''}
                  </p>
                </div>
                <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {r.late && <LateBadge month={r.month} />}
                  <RefillStateChip state={r.state} />
                </span>
                <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-slate-900">{rp(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {months.length === 0 ? (
        <Section title="Requests">
          <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-xs text-slate-400">
            No requests in {periodMonthName(s.periodMonth)} or the period before.
          </p>
        </Section>
      ) : (
        months.map((m) => {
          const rows = data.requests.filter((r) => r.periodMonth === m);
          return (
            <Section
              key={m}
              title={`Requests · Periode ${periodMonthName(m)}${m === s.periodMonth ? ' (in use)' : ''}`}
              aside={<span className="text-[11px] text-slate-400">{periodRangeLabel(m)}</span>}
            >
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-md border border-slate-200 bg-white">
                {rows.map((r) => (
                  <RequestLine key={r.id} r={r} />
                ))}
              </ul>
            </Section>
          );
        })
      )}

      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
        <Link
          href="/ops/petty-cash/requests"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Receipt className="h-3.5 w-3.5" /> Requests page <ArrowRight className="h-3 w-3" />
        </Link>
        <Link
          href="/ops/petty-cash/refills"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Wallet className="h-3.5 w-3.5" /> Refills page <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

export function StoreDetailSheet({
  store,
  maxBalance,
  showArea,
  onClose,
}: {
  /** The row it was opened from (drawn in the header straight away); null = closed. */
  store: PettyCashStoreRow | null;
  maxBalance: number;
  showArea: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!store} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 bg-slate-50 p-0 sm:max-w-2xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate text-base font-bold text-slate-900">{store?.storeName ?? 'Store'}</SheetTitle>
            {store && <StoreStatusChip status={storeStatusOf(store)} />}
          </div>
          <SheetDescription className="truncate text-xs text-slate-500">
            {store && (
              <>
                <span className="font-mono font-semibold text-slate-600">{store.storeNo}</span>
                {showArea && <> · {store.areaName}</>} · Petty cash, periode {periodMonthName(store.periodMonth)}
              </>
            )}
          </SheetDescription>
        </div>
        {store && <Body key={store.storeId} storeId={store.storeId} maxBalance={maxBalance} />}
      </SheetContent>
    </Sheet>
  );
}
