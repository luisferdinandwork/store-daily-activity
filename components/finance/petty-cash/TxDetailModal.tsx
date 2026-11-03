'use client';
// components/finance/petty-cash/TxDetailModal.tsx
//
// Finance · Petty Cash Monitoring: a request opened from a store's row. The
// receipt photo sits on the left in a zoomable stage; everything the PIC filled
// in (Keterangan, category, amounts, who and when) stays on the right, so Finance
// can check one against the other without leaving the page. ‹ › (or the arrow
// keys) step through the store's other requests. A completed request can be turned down here
// (comment optional) until Finance verifies the store's refill — "Perlu Perbaikan" (PIC 1 files it again
// next month as a re-request, which this modal marks and links back to the original) or "Ditolak" (final,
// can't be re-requested) — lib/petty-cash-review.ts.

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, Loader2, Lock, RotateCcw, ThumbsDown, Wrench } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { cn } from '@/lib/utils';
import { TX_STATUS_LABEL, type TxStatus } from '@/lib/petty-cash-transactions';
import { FINANCE_COMMENT_MAX, reviewOutcome } from '@/lib/petty-cash-review';
import { RE_REQUEST_LABEL, fmtRequestDate } from '@/lib/petty-cash-re-request';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import type { PettyCashTxRow } from '@/app/api/finance/petty-cash/route';
import { rp } from './shared';

const STATUS_CHIP: Record<string, string> = {
  pending_ops: 'bg-amber-50 text-amber-700 ring-amber-200',
  ops_approved: 'bg-sky-50 text-sky-700 ring-sky-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ops_rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

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

/** Perlu Perbaikan / Ditolak / take a decision back, as the page's API call: resolves true when it went through. */
export type ReviewHandler = (txId: number, action: 'revise' | 'reject' | 'accept', comment?: string) => Promise<boolean>;

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

const monthName = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

/** Finance's decision on one request: its state, and the buttons that apply to it. */
function ReviewPanel({ tx, onReview }: { tx: PettyCashTxRow; onReview: ReviewHandler }) {
  // Which of the two turn-downs the comment form is open for.
  const [asking, setAsking] = useState<'revise' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const outcome = reviewOutcome(tx.financeReview);
  const reRequested = tx.reRequestedAs != null;

  async function run(action: 'revise' | 'reject' | 'accept') {
    setBusy(true);
    const ok = await onReview(tx.id, action, action === 'accept' ? undefined : comment);
    setBusy(false);
    if (ok) {
      setAsking(null);
      setComment('');
    }
  }

  const btn = 'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold disabled:opacity-60';

  const revising = asking === 'revise';
  const commentForm = asking && (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-slate-600">
        Komentar untuk PIC 1 <span className="font-normal text-slate-400">(boleh dikosongkan)</span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={FINANCE_COMMENT_MAX}
          rows={3}
          placeholder={
            revising
              ? 'mis. Foto struk buram — mohon ambil ulang dan cek nominalnya.'
              : 'mis. Struk bukan untuk keperluan toko.'
          }
          className={cn(
            'mt-1 w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2',
            revising ? 'focus:border-amber-400 focus:ring-amber-500/20' : 'focus:border-rose-400 focus:ring-rose-500/20',
          )}
        />
      </label>
      <p className="text-[11px] leading-snug text-slate-500">
        {revising
          ? `Nominalnya tidak ikut ditransfer. PIC 1 mengajukannya lagi bulan depan lewat ${RE_REQUEST_LABEL}.`
          : `Ditolak bersifat final — tidak bisa diajukan ulang. Nominalnya tidak ikut ditransfer.`}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-slate-400">{comment.length}/{FINANCE_COMMENT_MAX}</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAsking(null)}
            disabled={busy}
            className={cn(btn, 'border border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => run(asking)}
            disabled={busy}
            className={cn(btn, revising ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-rose-600 text-white hover:bg-rose-700')}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : revising ? <Wrench className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
            {revising ? 'Kirim: Perlu Perbaikan' : 'Tolak request'}
          </button>
        </div>
      </div>
    </div>
  );

  const reviseBtn = (
    <button
      type="button"
      onClick={() => setAsking('revise')}
      disabled={busy}
      className={cn(btn, 'border border-amber-300 bg-white text-amber-700 hover:bg-amber-50')}
    >
      <Wrench className="h-3.5 w-3.5" />
      Perlu Perbaikan
    </button>
  );
  const rejectBtn = (
    <button
      type="button"
      onClick={() => setAsking('reject')}
      disabled={busy}
      className={cn(btn, 'border border-rose-300 bg-white text-rose-700 hover:bg-rose-50')}
    >
      <ThumbsDown className="h-3.5 w-3.5" />
      Ditolak
    </button>
  );

  return (
    <section className="space-y-3 border-t border-slate-200 p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Keputusan Finance</h3>

      {outcome === 'needs_fix' && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <p className="font-semibold">Perlu Perbaikan</p>
          <p className="mt-0.5 text-amber-700">{tx.financeReviewAt && fmtShort(tx.financeReviewAt)}</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words">
            {tx.financeComment ?? <span className="italic text-amber-700">Tanpa komentar.</span>}
          </p>
          <p className="mt-1.5 text-amber-700">
            Nominalnya tidak ikut ditransfer.{' '}
            {reRequested
              ? `Sudah diajukan ulang sebagai ${RE_REQUEST_LABEL} #${tx.reRequestedAs}.`
              : `PIC 1 bisa mengajukannya lagi bulan depan lewat ${RE_REQUEST_LABEL}.`}
          </p>
        </div>
      )}

      {outcome === 'rejected' && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-900">
          <p className="font-semibold">Ditolak</p>
          <p className="mt-0.5 text-rose-700">{tx.financeReviewAt && fmtShort(tx.financeReviewAt)}</p>
          <p className="mt-1.5 whitespace-pre-wrap break-words">
            {tx.financeComment ?? <span className="italic text-rose-700">Tanpa komentar.</span>}
          </p>
          <p className="mt-1.5 text-rose-700">Nominalnya tidak ikut ditransfer. Request yang Ditolak tidak bisa diajukan ulang.</p>
        </div>
      )}

      {outcome === 'accepted' && (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">
          Diterima — ikut dihitung di Refill.
        </p>
      )}

      {/* Actions */}
      {tx.status !== 'completed' ? (
        <p className="text-xs text-slate-400">Request bisa diputuskan setelah PIC 1 mengisi jumlah terpakai.</p>
      ) : tx.locked ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Lock className="h-3.5 w-3.5" /> Refill sudah diverifikasi — nominal terkunci, keputusan tidak bisa diubah lagi.
        </p>
      ) : reRequested ? (
        <p className="text-xs text-slate-400">Sudah diajukan ulang — keputusan ini tidak bisa diubah.</p>
      ) : asking ? (
        commentForm
      ) : (
        <div className="flex flex-wrap gap-2">
          {(outcome === 'needs_fix' || outcome === 'rejected') && (
            <button
              type="button"
              onClick={() => run('accept')}
              disabled={busy}
              className={cn(btn, 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {outcome === 'needs_fix' ? 'Batalkan Perlu Perbaikan' : 'Batalkan penolakan'}
            </button>
          )}
          {(outcome === 'none' || outcome === 'accepted') && (
            <>
              {reviseBtn}
              {rejectBtn}
            </>
          )}
          {outcome === 'needs_fix' && rejectBtn}
        </div>
      )}
    </section>
  );
}

export function TxDetailModal({
  store,
  transactions,
  index,
  onIndex,
  onClose,
  onReview,
}: {
  store: { storeNo: string; storeName: string };
  /** The store's requests for the month, in the order the list shows them. */
  transactions: PettyCashTxRow[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onReview: ReviewHandler;
}) {
  const count = transactions.length;
  const tx = transactions[index];

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

  if (!tx) return null;

  const amount = Number(tx.amount);
  const actual = tx.actualAmount == null ? null : Number(tx.actualAmount);
  const statusLabel = TX_STATUS_LABEL[tx.status as TxStatus] ?? tx.status;

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
              {tx.categoryName ?? 'Request petty cash'}
            </DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs">
              {store.storeNo} · {store.storeName} · request #{tx.id}
            </DialogDescription>
          </div>

          {count > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onIndex(index - 1)}
                disabled={index === 0}
                aria-label="Request sebelumnya"
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
                aria-label="Request berikutnya"
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
            Tutup
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* Receipt — zoomable */}
          {tx.imageUrl ? (
            <ZoomableImage
              key={tx.id}
              src={tx.imageUrl}
              alt={`Struk request #${tx.id}`}
              className="min-h-[280px] flex-1"
            />
          ) : (
            <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-2 bg-slate-100 text-slate-400">
              <ImageOff className="h-10 w-10" />
              <p className="text-sm font-medium text-slate-500">Belum ada foto struk</p>
              <p className="max-w-xs text-center text-xs">
                PIC 1 mengunggah struk setelah OPS menyetujui request.
              </p>
            </div>
          )}

          {/* What the staff filled in */}
          <aside className="flex max-h-[45vh] w-full shrink-0 flex-col overflow-y-auto border-t border-slate-200 bg-white lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
            <section className="border-b border-slate-200 p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Keterangan dari staff</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-900">
                {tx.description}
              </p>
            </section>

            <dl className="divide-y divide-slate-100 px-4 py-1">
              <Field label="Status">
                <span
                  className={cn(
                    'inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                    STATUS_CHIP[tx.status] ?? STATUS_CHIP.pending_ops,
                  )}
                >
                  {statusLabel}
                </span>
                {tx.isReRequest && <ReRequestBadge className="ml-1.5" />}
              </Field>
              <Field label="Kategori">{tx.categoryName ?? '–'}</Field>
              <Field label="Jumlah diajukan">
                <span className="tabular-nums">{rp(amount)}</span>
              </Field>
              <Field label="Jumlah terpakai">
                {actual == null ? (
                  <span className="text-xs font-normal italic text-slate-400">belum diisi PIC</span>
                ) : (
                  <span className="tabular-nums">
                    {rp(actual)}
                    {actual !== amount && (
                      <span className={cn('ml-2 text-xs font-semibold', actual > amount ? 'text-rose-600' : 'text-emerald-600')}>
                        {actual > amount ? '+' : '−'}{rp(Math.abs(actual - amount))}
                      </span>
                    )}
                  </span>
                )}
              </Field>
              <Field label="Diajukan oleh">{tx.submittedBy}</Field>
              {tx.isReRequest && tx.requestDate && (
                <Field label="Tanggal request">
                  <span className="text-xs">{fmtRequestDate(tx.requestDate)}</span>
                </Field>
              )}
              <Field label={tx.isReRequest ? 'Diajukan ulang pada' : 'Diajukan pada'}>
                <span className="text-xs">{fmtFull(tx.createdAt)}</span>
              </Field>
              {tx.approvedAt && (
                <Field label="Disetujui OPS">
                  <span className="text-xs">{fmtFull(tx.approvedAt)}</span>
                </Field>
              )}
              {tx.rejectedAt && (
                <Field label="Ditolak OPS">
                  <span className="text-xs">{fmtFull(tx.rejectedAt)}</span>
                </Field>
              )}
            </dl>

            {tx.rejectionReason && (
              <p className="mx-4 mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                <span className="font-semibold">Alasan penolakan OPS: </span>
                {tx.rejectionReason}
              </p>
            )}

            {tx.isReRequest && (
              <section className="space-y-1.5 border-t border-slate-200 bg-violet-50/40 p-4 text-xs">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-violet-600">Request asal</h3>
                {tx.reRequestOf ? (
                  <>
                    <p className="font-semibold text-slate-800">
                      #{tx.reRequestOf.id} · {tx.reRequestOf.categoryName ?? 'Request petty cash'} · {monthName(tx.reRequestOf.month)}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-slate-600">{tx.reRequestOf.description}</p>
                    <p className="tabular-nums text-slate-600">
                      {rp(Number(tx.reRequestOf.amount))} · diajukan {fmtShort(tx.reRequestOf.createdAt)}
                    </p>
                    <p className="text-amber-700">
                      <span className="font-semibold">Perlu Perbaikan{tx.reRequestOf.financeReviewAt ? ` ${fmtShort(tx.reRequestOf.financeReviewAt)}` : ''}: </span>
                      {tx.reRequestOf.financeComment ?? <span className="italic">tanpa komentar</span>}
                    </p>
                  </>
                ) : (
                  <p className="italic text-slate-500">Request asalnya sudah dihapus.</p>
                )}
              </section>
            )}

            <ReviewPanel key={tx.id} tx={tx} onReview={onReview} />
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
