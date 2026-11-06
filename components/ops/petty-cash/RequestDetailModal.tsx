'use client';
// components/ops/petty-cash/RequestDetailModal.tsx
//
// Ops · Petty Cash · Requests: a request opened from its row, laid out like
// Finance's TxDetailModal (components/finance/petty-cash/TxDetailModal.tsx) so a
// request reads the same in either panel — the receipt in a zoomable stage on the
// left, what the PIC filled in on the right. ‹ › (or the arrow keys) step through
// the rows of the page. A request still waiting on Ops can be approved or rejected
// right here (same actions as the row's buttons).

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { cn } from '@/lib/utils';
import { PeriodBadge } from '@/components/petty-cash/PeriodBadge';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import { reviewOutcome } from '@/lib/petty-cash-review';
import type { OpsRequestRow } from '@/lib/ops-petty-cash';
import { DecisionButtons, TxStatusChip, rp } from './shared';

const fmtFull = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  );
}

export function RequestDetailModal({
  rows,
  index,
  showArea,
  busy,
  onIndex,
  onClose,
  onApprove,
  onReject,
}: {
  /** The rows of the page, in the order the table shows them. */
  rows: OpsRequestRow[];
  index: number;
  /** HO sees the area of each store. */
  showArea: boolean;
  busy: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
  onApprove: (row: OpsRequestRow) => void;
  onReject: (row: OpsRequestRow, reason: string) => void;
}) {
  const count = rows.length;
  const r = rows[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      else if (e.key === 'ArrowRight' && index < count - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, count, onIndex]);

  if (!r) return null;

  const waiting = r.status === 'pending_ops';
  const actual = r.actualAmount;
  const outcome = reviewOutcome(r.financeReview);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="flex h-[min(92vh,880px)] w-[min(96vw,1360px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        // The close icon would sit on the dark photo stage — the header has its own.
        showCloseButton={false}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base text-slate-900">
              {r.categoryName ?? 'Request petty cash'}
            </DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs">
              {r.storeNo} · {r.storeName} · request #{r.id}
            </DialogDescription>
          </div>

          {count > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onIndex(index - 1)}
                disabled={index === 0}
                aria-label="Previous request"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="w-14 text-center text-xs font-semibold tabular-nums text-slate-500">
                {index + 1} / {count}
              </span>
              <button
                type="button"
                onClick={() => onIndex(index + 1)}
                disabled={index === count - 1}
                aria-label="Next request"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Receipt — zoomable */}
          {r.imageUrl ? (
            <ZoomableImage key={r.id} src={r.imageUrl} alt={`Receipt of request #${r.id}`} className="min-h-[280px] flex-1" />
          ) : (
            <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-2 bg-slate-100 text-slate-400">
              <ImageOff className="h-10 w-10" />
              <p className="text-sm font-medium text-slate-500">No receipt photo yet</p>
              <p className="max-w-xs text-center text-xs">PIC 1 uploads the receipt after Ops approves the request.</p>
            </div>
          )}

          {/* What the staff filled in */}
          <aside className="flex max-h-[45vh] w-full shrink-0 flex-col overflow-y-auto border-t border-slate-200 bg-white lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
            <section className="border-b border-slate-200 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Keterangan dari staff</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-900">{r.description}</p>
            </section>

            <dl className="divide-y divide-slate-100 px-4 py-1">
              <Field label="Status">
                <span className="inline-flex flex-wrap items-center justify-end gap-1">
                  <TxStatusChip status={r.status} />
                  {r.isReRequest && <ReRequestBadge />}
                </span>
              </Field>
              <Field label="Category">{r.categoryName ?? '–'}</Field>
              <Field label="Period">
                <PeriodBadge month={r.periodMonth} />
              </Field>
              <Field label="Requested">
                <span className={cn('tabular-nums', r.status === 'ops_rejected' && 'text-slate-400 line-through')}>{rp(r.amount)}</span>
              </Field>
              <Field label="Actual">
                {actual == null ? (
                  <span className="text-xs font-normal italic text-slate-400">not filled in by PIC yet</span>
                ) : (
                  <span className="tabular-nums">
                    {rp(actual)}
                    {actual !== r.amount && (
                      <span className={cn('ml-2 text-xs font-semibold', actual > r.amount ? 'text-rose-600' : 'text-emerald-600')}>
                        {actual > r.amount ? '+' : '−'}{rp(Math.abs(actual - r.amount))}
                      </span>
                    )}
                  </span>
                )}
              </Field>
              <Field label="Submitted by">{r.submittedByName}</Field>
              <Field label="Store">
                {r.storeName}
                <span className="block text-[11px] font-normal text-slate-400">
                  {r.storeNo}{showArea ? ` · ${r.areaName}` : ''}
                </span>
              </Field>
              <Field label={r.isReRequest ? 'Re-filed at' : 'Filed at'}>
                <span className="text-xs">{fmtFull(r.createdAt)}</span>
              </Field>
              {r.approvedAt && (
                <Field label="Approved by Ops">
                  <span className="text-xs">{fmtFull(r.approvedAt)}</span>
                </Field>
              )}
              {r.rejectedAt && (
                <Field label="Rejected by Ops">
                  <span className="text-xs">{fmtFull(r.rejectedAt)}</span>
                </Field>
              )}
            </dl>

            {r.rejectionReason && (
              <p className="mx-4 mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <span className="font-semibold">Rejection reason: </span>
                {r.rejectionReason}
              </p>
            )}

            {(outcome === 'needs_fix' || outcome === 'rejected') && (
              <p
                className={cn(
                  'mx-4 mb-4 rounded-md border px-3 py-2 text-xs',
                  outcome === 'needs_fix' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-rose-200 bg-rose-50 text-rose-800',
                )}
              >
                <span className="font-semibold">Finance: {outcome === 'needs_fix' ? 'Perlu Perbaikan' : 'Ditolak'}</span> — not counted as used.
              </p>
            )}

            {waiting && (
              <section className="mt-auto space-y-2 border-t border-slate-200 p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Decision</h3>
                <p className="text-xs text-slate-500">This request is waiting for Ops.</p>
                <DecisionButtons busy={busy} onApprove={() => onApprove(r)} onReject={(reason) => onReject(r, reason)} />
              </section>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
