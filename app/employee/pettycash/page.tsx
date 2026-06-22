// app/employee/pettycash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Loader2,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  Wallet,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';

import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type PettyCashStatus = 'pending_ops' | 'ops_approved' | 'ops_rejected';

type TxRow = {
  id: number;
  amount: string;
  description: string;
  status: PettyCashStatus | string;
  imageUrl: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

type PageData = {
  storeName: string;
  balance: string;
  openingBalance?: string;
  closingBalance?: string | null;
  periodStatus?: 'open' | 'closed' | string;
  month: string;
  transactions: TxRow[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const idr = (v: string | number) => IDR.format(Number(v));

function balanceColor(balance: number) {
  if (balance <= 0) return 'text-rose-500';
  if (balance < 250_000) return 'text-rose-400';
  if (balance < 500_000) return 'text-amber-500';
  return 'text-emerald-500';
}

function balanceBg(balance: number) {
  if (balance <= 0) return 'from-rose-50 to-red-50';
  if (balance < 250_000) return 'from-rose-50 to-orange-50';
  if (balance < 500_000) return 'from-amber-50 to-yellow-50';
  return 'from-emerald-50 to-teal-50';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function monthLabel(ym?: string) {
  if (!ym) return '';
  const [year, month] = ym.split('-').map(Number);

  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
  });
}

function needsReceipt(tx: TxRow) {
  return tx.status === 'ops_approved' && !tx.imageUrl && !tx.verifiedAt;
}

function statusMeta(tx: TxRow) {
  if (tx.status === 'pending_ops') {
    return {
      label: 'Waiting OPS Approval',
      icon: Clock3,
      className: 'bg-amber-50 text-amber-700 ring-amber-200',
      note: 'Your request has been sent to OPS for approval.',
    };
  }

  if (tx.status === 'ops_rejected') {
    return {
      label: 'Rejected by OPS',
      icon: XCircle,
      className: 'bg-rose-50 text-rose-700 ring-rose-200',
      note: tx.rejectionReason || 'This request was rejected by OPS.',
    };
  }

  if (tx.verifiedAt) {
    return {
      label: 'Verified by Finance',
      icon: ShieldCheck,
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      note: 'Receipt has been verified by Finance.',
    };
  }

  if (needsReceipt(tx)) {
    return {
      label: 'Upload Receipt',
      icon: UploadCloud,
      className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      note: 'OPS approved this request. Upload the receipt photo now.',
    };
  }

  return {
    label: 'Waiting Finance',
    icon: CheckCircle2,
    className: 'bg-violet-50 text-violet-700 ring-violet-200',
    note: 'Receipt uploaded. Waiting for Finance verification.',
  };
}

// ─── Image lightbox ───────────────────────────────────────────────────────────

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();

    window.addEventListener('keydown', h);

    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white"
      >
        <X className="h-5 w-5" />
      </button>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Receipt"
        className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Balance card ─────────────────────────────────────────────────────────────

function BalanceCard({
  balance,
  storeName,
  totalApprovedSpend,
  pendingAmount,
  month,
}: {
  balance: number;
  storeName: string;
  totalApprovedSpend: number;
  pendingAmount: number;
  month: string;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));

  return (
    <div className={cn('mx-4 rounded-2xl bg-gradient-to-br p-5 shadow-sm', balanceBg(balance))}>
      <div className="mb-1 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-slate-500" />
        <p className="text-xs font-semibold text-slate-500">
          {storeName} · {monthLabel(month)}
        </p>
      </div>

      <p className={cn('text-4xl font-bold tracking-tight', balanceColor(balance))}>
        {idr(balance)}
      </p>

      <p className="mt-0.5 text-[11px] text-slate-400">
        Remaining balance after OPS-approved requests
      </p>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/60">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            pct < 25 ? 'bg-rose-400' : pct < 50 ? 'bg-amber-400' : 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
        <span>{pct}% remaining of Rp 1.000.000</span>
        <span>Approved spend {idr(totalApprovedSpend)}</span>
      </div>

      {pendingAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-amber-700">
            Pending OPS request: {idr(pendingAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            This amount is not deducted until OPS approves it.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Receipt capture: pick → preview → confirm ───────────────────────────────
// Splitting capture into its own step (rather than uploading the instant a
// file is picked) means a blurry or wrong photo never silently goes to
// Finance — the person sees exactly what they're about to submit first.

function ReceiptCapture({
  uploading,
  onConfirm,
}: {
  uploading: boolean;
  onConfirm: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
  }

  function retake() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  if (preview) {
    return (
      <div className="mt-3">
        <div className="overflow-hidden rounded-xl border border-indigo-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="Receipt preview" className="h-44 w-full object-cover" />
        </div>

        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={retake}
            disabled={uploading}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-600 transition active:scale-[0.99] disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retake
          </button>

          <button
            type="button"
            onClick={() => onConfirm(preview.file)}
            disabled={uploading}
            className={cn(
              'flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition active:scale-[0.99]',
              uploading ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white',
            )}
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Use This Photo
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={pick}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white transition active:scale-[0.99]"
      >
        <Camera className="h-4 w-4" />
        Take or Choose Receipt Photo
      </button>
    </>
  );
}

// ─── Needs-action card (pulled out of history, given its own section) ───────

function NeedsReceiptCard({
  tx,
  uploading,
  onUpload,
}: {
  tx: TxRow;
  uploading: boolean;
  onUpload: (tx: TxRow, file: File) => void;
}) {
  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
            <UploadCloud className="h-3 w-3" />
            Action needed
          </span>

          <p className="mt-2 truncate text-sm font-semibold text-slate-800">
            {tx.description}
          </p>

          <p className="mt-0.5 text-[11px] text-slate-400">
            Approved {fmtDate(tx.createdAt)}
          </p>
        </div>

        <span className="shrink-0 text-sm font-bold text-rose-500">−{idr(tx.amount)}</span>
      </div>

      <p className="mt-2 text-[11px] font-medium text-indigo-700">
        OPS approved this request. Upload the receipt photo to send it to Finance.
      </p>

      <ReceiptCapture uploading={uploading} onConfirm={(file) => onUpload(tx, file)} />
    </div>
  );
}

// ─── Transaction history item ─────────────────────────────────────────────────

function TxItem({
  tx,
  onViewImage,
}: {
  tx: TxRow;
  onViewImage: (url: string) => void;
}) {
  const meta = statusMeta(tx);
  const Icon = meta.icon;

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {tx.imageUrl ? (
          <button
            type="button"
            onClick={() => onViewImage(tx.imageUrl!)}
            className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-100"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-active:bg-black/20">
              <ZoomIn className="h-4 w-4 text-white opacity-0 group-active:opacity-100" />
            </div>
          </button>
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
            <ReceiptText className="h-5 w-5 text-slate-300" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1',
                meta.className,
              )}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
          </div>

          <p className="mt-2 truncate text-sm font-semibold text-slate-800">
            {tx.description}
          </p>

          <p className="mt-0.5 text-[11px] text-slate-400">
            {fmtDate(tx.createdAt)}
          </p>

          <p
            className={cn(
              'mt-1 text-[11px] font-medium',
              tx.status === 'ops_rejected' ? 'text-rose-600' : 'text-slate-500',
            )}
          >
            {meta.note}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 text-sm font-bold',
            tx.status === 'ops_rejected' ? 'text-slate-400 line-through' : 'text-rose-500',
          )}
        >
          −{idr(tx.amount)}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeePettyCashPage() {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [uploadingTxId, setUploadingTxId] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch('/api/employee/petty-cash', {
        cache: 'no-store',
      });

      const body = await res.json();

      if (body.success) {
        setData(body);
      } else {
        setLoadError(body.error ?? 'Failed to load petty cash.');
      }
    } catch {
      setLoadError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setFormError(null);
    setActionError(null);
    setSuccessMessage(null);

    const amt = Number(amount.replace(/[^0-9]/g, ''));

    if (!amt || amt <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }

    if (!description.trim()) {
      setFormError('Description is required.');
      return;
    }

    const balance = Number(data?.balance ?? 0);

    if (amt > balance) {
      setFormError(`Amount exceeds current available balance (${idr(balance)}).`);
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/employee/petty-cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          description: description.trim(),
        }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        setFormError(body.error ?? 'Request failed.');
        return;
      }

      setAmount('');
      setDescription('');
      setSuccessMessage('Request sent to OPS for approval.');
      setTimeout(() => setSuccessMessage(null), 4000);

      await load();
    } catch {
      setFormError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadReceipt(tx: TxRow, file: File) {
    setActionError(null);
    setSuccessMessage(null);

    if (file.size > 5 * 1024 * 1024) {
      setActionError('Receipt photo must be less than 5 MB.');
      return;
    }

    if (!data?.storeName) {
      setActionError('Store data is not loaded.');
      return;
    }

    setUploadingTxId(tx.id);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('storeName', data.storeName);

      const uploadRes = await fetch('/api/upload/petty-cash', {
        method: 'POST',
        body: form,
      });

      const uploadBody = await uploadRes.json();

      if (!uploadRes.ok) {
        throw new Error(uploadBody.error ?? 'Receipt upload failed.');
      }

      const patchRes = await fetch('/api/employee/petty-cash', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txId: tx.id,
          imageUrl: uploadBody.url,
          imageKey: uploadBody.key,
        }),
      });

      const patchBody = await patchRes.json();

      if (!patchRes.ok || !patchBody.success) {
        throw new Error(patchBody.error ?? 'Failed to attach receipt.');
      }

      setSuccessMessage('Receipt uploaded. Waiting for Finance verification.');
      setTimeout(() => setSuccessMessage(null), 4000);

      await load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Receipt upload failed. Try again.',
      );
    } finally {
      setUploadingTxId(null);
    }
  }

  const balance = Number(data?.balance ?? 0);

  const amountNum = Number(amount.replace(/[^0-9]/g, ''));
  const afterAmount = balance - (amountNum || 0);

  const transactions = data?.transactions ?? [];
  const needsReceiptTxs = useMemo(
    () => transactions.filter(needsReceipt),
    [transactions],
  );
  const historyTxs = useMemo(
    () => transactions.filter((tx) => !needsReceipt(tx)),
    [transactions],
  );

  const summary = useMemo(() => {
    return {
      pendingOps: transactions.filter((tx) => tx.status === 'pending_ops').length,
      waitingReceipt: needsReceiptTxs.length,
      waitingFinance: transactions.filter(
        (tx) => tx.status === 'ops_approved' && tx.imageUrl && !tx.verifiedAt,
      ).length,
      verified: transactions.filter((tx) => Boolean(tx.verifiedAt)).length,
      rejected: transactions.filter((tx) => tx.status === 'ops_rejected').length,
      pendingAmount: transactions
        .filter((tx) => tx.status === 'pending_ops')
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
      approvedSpend: transactions
        .filter((tx) => tx.status === 'ops_approved')
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
    };
  }, [transactions, needsReceiptTxs]);

  return (
    <>
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <Link
          href="/employee"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>

        <div>
          <p className="text-xs font-semibold text-muted-foreground">
            Petty Cash Request
          </p>
          <p className="text-sm font-bold leading-none text-foreground">
            {data?.storeName ?? '…'}
          </p>
        </div>
      </div>

      <div className="space-y-5 py-5">
        {loading ? (
          <div className="mx-4 h-36 animate-pulse rounded-2xl bg-slate-100" />
        ) : loadError ? (
          <div className="mx-4 flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{loadError}</p>
          </div>
        ) : (
          <BalanceCard
            balance={balance}
            storeName={data?.storeName ?? ''}
            month={data?.month ?? ''}
            totalApprovedSpend={summary.approvedSpend}
            pendingAmount={summary.pendingAmount}
          />
        )}

        {!loading && !loadError && (
          <section className="grid grid-cols-3 gap-2 px-4">
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600">
                OPS
              </p>
              <p className="mt-1 text-xl font-black text-amber-700">
                {summary.pendingOps}
              </p>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                Receipt
              </p>
              <p className="mt-1 text-xl font-black text-indigo-700">
                {summary.waitingReceipt}
              </p>
            </div>

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                Verified
              </p>
              <p className="mt-1 text-xl font-black text-emerald-700">
                {summary.verified}
              </p>
            </div>
          </section>
        )}

        {!loading && !loadError && actionError && (
          <section className="px-4">
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-sm text-rose-700">{actionError}</p>
            </div>
          </section>
        )}

        {!loading && !loadError && successMessage && (
          <section className="px-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <p className="text-sm font-medium text-emerald-700">{successMessage}</p>
            </div>
          </section>
        )}

        {!loading && !loadError && needsReceiptTxs.length > 0 && (
          <section className="px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">
                Needs Your Action
              </h2>
              <span className="text-xs text-muted-foreground">
                {needsReceiptTxs.length} request
                {needsReceiptTxs.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-2.5">
              {needsReceiptTxs.map((tx) => (
                <NeedsReceiptCard
                  key={tx.id}
                  tx={tx}
                  uploading={uploadingTxId === tx.id}
                  onUpload={handleUploadReceipt}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && !loadError && (
          <section className="px-4">
            <h2 className="mb-3 text-sm font-bold text-foreground">
              New Petty Cash Request
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                <p className="text-xs font-bold text-indigo-700">
                  Receipt photo is not required yet.
                </p>
                <p className="mt-1 text-[11px] text-indigo-600">
                  Send the request first. After OPS approves it, you&apos;ll see it under
                  &quot;Needs Your Action&quot; to upload the receipt.
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Amount (Rp)
                </label>

                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    Rp
                  </span>

                  <input
                    type="text"
                    inputMode="numeric"
                    value={amount ? Number(amount).toLocaleString('id-ID') : ''}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="0"
                    className="h-12 w-full rounded-xl border border-border bg-secondary/40 pl-10 pr-4 text-right text-lg font-bold tabular-nums text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                {amountNum > 0 && (
                  <p
                    className={cn(
                      'mt-1.5 text-right text-xs font-semibold',
                      afterAmount < 0 ? 'text-rose-500' : 'text-muted-foreground',
                    )}
                  >
                    Balance after OPS approval: {idr(Math.max(0, afterAmount))}
                    {afterAmount < 0 && ' · exceeds balance'}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Description
                </label>

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="What is this request for? e.g. Cleaning supplies, printer ink…"
                  className="w-full resize-none rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {formError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  <p className="text-sm text-rose-700">{formError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || balance <= 0}
                className={cn(
                  'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors',
                  submitting || balance <= 0
                    ? 'bg-secondary text-muted-foreground'
                    : 'bg-primary text-primary-foreground active:opacity-80',
                )}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending request…
                  </>
                ) : balance <= 0 ? (
                  'No balance remaining'
                ) : (
                  'Send Request to OPS'
                )}
              </button>

              {balance <= 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Balance is empty. Finance needs to issue a refill first.
                </p>
              )}
            </form>
          </section>
        )}

        {!loading && !loadError && historyTxs.length > 0 && (
          <section className="px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">
                This Month&apos;s Requests
              </h2>

              <span className="text-xs text-muted-foreground">
                {historyTxs.length} record{historyTxs.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-2.5">
              {historyTxs.map((tx) => (
                <TxItem key={tx.id} tx={tx} onViewImage={setLightboxSrc} />
              ))}
            </div>

            <p className="mt-3 text-center text-[10px] text-muted-foreground">
              Receipt images are stored permanently after upload.
            </p>
          </section>
        )}

        {!loading && !loadError && transactions.length === 0 && (
          <section className="px-4">
            <div className="rounded-2xl border border-dashed border-border bg-secondary/30 py-10 text-center">
              <ReceiptText className="mx-auto mb-2 h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">
                No petty cash requests this month
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Fill the form above to send your first request to OPS.
              </p>
            </div>
          </section>
        )}
      </div>
    </>
  );
}