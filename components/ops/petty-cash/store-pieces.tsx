'use client';
// components/ops/petty-cash/store-pieces.tsx
//
// Small pieces of Ops · Petty Cash · Stores, shared by the desktop sheet, the phone cards and the store
// slide-over: the one status chip per store, the balance (cash PIC 1 can spend, with a bar against the maximum),
// the Refill cell and the "what is open" line. Words + colours: lib/ops-petty-cash-stores.ts and TONES.

import { AlertTriangle, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { TONES } from '@/lib/status-theme';
import { periodMonthName } from '@/lib/petty-cash-period';
import {
  PETTY_CASH_MAX,
  STORE_STATUS_META,
  balanceBand,
  balancePct,
  type PettyCashStoreRow,
  type StoreRefill,
  type StoreStatusKey,
} from '@/lib/ops-petty-cash-stores';
import { LateBadge } from '@/components/petty-cash/PeriodBadge';
import { RefillStateChip, fmtDay, num, rp } from './shared';

export function StoreStatusChip({ status, className }: { status: StoreStatusKey; className?: string }) {
  const meta = STORE_STATUS_META[status];
  return (
    <span
      title={meta.hint}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold',
        TONES[meta.tone].chip,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', TONES[meta.tone].dot)} />
      {meta.label}
    </span>
  );
}

const BAND_TEXT = { low: TONES.danger.strong, watch: TONES.warning.strong, ok: 'text-slate-900' } as const;
const BAND_BAR = { low: TONES.danger.dot, watch: TONES.warning.dot, ok: TONES.success.dot } as const;

/** What PIC 1 can spend, a bar against the maximum, and the Refill the box is still waiting for. */
export function BalanceCell({ row, max = PETTY_CASH_MAX, wide }: { row: PettyCashStoreRow; max?: number; wide?: boolean }) {
  const band = balanceBand(row, max);
  const pct = balancePct(row, max);
  return (
    <div className={cn('min-w-0', wide ? 'w-full' : 'w-36')}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn('font-semibold tabular-nums', BAND_TEXT[band])}>{num(row.spendable)}</span>
        <span className="text-[10px] tabular-nums text-slate-400">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        <div className={cn('h-full rounded-full', BAND_BAR[band])} style={{ width: `${pct}%` }} />
      </div>
      {row.owed > 0 && (
        <p
          className="mt-1 truncate text-[10px] leading-snug text-slate-500"
          title={`The cash box is still waiting for the previous period's Refill (${rp(row.owed)}).`}
        >
          Refill not received: {rp(row.owed)}
        </p>
      )}
    </div>
  );
}

/** Where the store's Refill stands. */
export function RefillCell({ refill }: { refill: StoreRefill }) {
  switch (refill.kind) {
    case 'live':
      return (
        <div className="space-y-1">
          <span className="flex flex-wrap items-center gap-1">
            <RefillStateChip state={refill.state} />
            {refill.late && <LateBadge month={refill.month} />}
          </span>
          <p className="whitespace-nowrap text-[11px] text-slate-500">
            {periodMonthName(refill.month)} · {rp(refill.amount)}
          </p>
        </div>
      );
    case 'overdue':
      return (
        <div className="space-y-1">
          <span
            title={`The ${periodMonthName(refill.month)} period has ended and its Refill hasn't been sent — PIC 1 can't file new requests until it is.`}
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold',
              TONES.danger.chip,
            )}
          >
            <AlertTriangle className="h-3 w-3" />
            Not sent
          </span>
          <p className="whitespace-nowrap text-[11px] text-slate-500">
            {periodMonthName(refill.month)} · {rp(refill.amount)}
          </p>
        </div>
      );
    case 'due_soon':
      return (
        <div className="space-y-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold',
              TONES.warning.chip,
            )}
          >
            <Clock className="h-3 w-3" />
            {refill.daysLeft <= 0 ? 'Due today' : `Due in ${refill.daysLeft} day${refill.daysLeft === 1 ? '' : 's'}`}
          </span>
          <p className="whitespace-nowrap text-[11px] text-slate-500">
            {periodMonthName(refill.month)} · {rp(refill.amount)}
          </p>
        </div>
      );
    case 'last':
      return (
        <div className="space-y-1">
          <RefillStateChip state={refill.state} />
          <p className="whitespace-nowrap text-[11px] text-slate-500">
            {periodMonthName(refill.month)} · {fmtDay(refill.requestedAt)}
          </p>
        </div>
      );
    case 'none':
      return <span className="text-[11px] text-slate-300">No refill yet</span>;
  }
}

/** "2 waiting OPS · 1 awaiting amount · 1 being fixed", or a dash. */
export function OpenCounts({ row, className }: { row: PettyCashStoreRow; className?: string }) {
  const parts = [
    row.waitingOps > 0 ? { n: row.waitingOps, label: 'waiting OPS', tone: TONES.warning.strong } : null,
    row.awaitingActual > 0 ? { n: row.awaitingActual, label: 'awaiting amount', tone: TONES.info.strong } : null,
    row.fixing > 0 ? { n: row.fixing, label: 'being fixed', tone: TONES.info.strong } : null,
  ].filter((p): p is { n: number; label: string; tone: string } => p != null);

  if (parts.length === 0) return <span className={cn('text-slate-300', className)}>–</span>;
  return (
    <span className={cn('flex flex-col gap-0.5 text-[11px]', className)}>
      {parts.map((p) => (
        <span key={p.label} className="whitespace-nowrap">
          <span className={cn('font-bold tabular-nums', p.tone)}>{p.n}</span>{' '}
          <span className="text-slate-500">{p.label}</span>
        </span>
      ))}
    </span>
  );
}

/** PIC 1 name(s); two or more is flagged (one PIC 1 per store — lib/store-pic1.ts). */
export function Pic1Cell({ pic1 }: { pic1: PettyCashStoreRow['pic1'] }) {
  if (pic1.length === 0) return <span className="text-[11px] italic text-slate-400">No PIC 1</span>;
  return (
    <div className="min-w-0">
      <p className="max-w-40 truncate leading-snug text-slate-800" title={pic1.map((p) => `${p.name} (${p.nik})`).join(', ')}>
        {pic1[0].name}
      </p>
      <p className="font-mono text-[11px] leading-snug text-slate-400">
        {pic1[0].nik}
        {pic1.length > 1 && (
          <span className={cn('ml-1 font-sans font-semibold', TONES.danger.strong)} title="More than one PIC 1 at this store">
            +{pic1.length - 1}
          </span>
        )}
      </p>
    </div>
  );
}
