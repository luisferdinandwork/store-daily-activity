'use client';
// app/employee/pettycash/page.tsx
//
// Employee Petty Cash
//
// Shows:
//   1. Current store balance (large, prominent)
//   2. Submit form — description + amount + receipt photo
//   3. This month's transaction history
//
// Fits inside app/employee/layout.tsx:
//   - Mobile-only shell with pb-16 for the bottom nav
//   - Full-width, no horizontal padding needed on the shell itself

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type TxRow = {
  id: number;
  amount: string;
  description: string;
  imageUrl: string | null;
  verifiedAt: string | null;
  createdAt: string;
};

type PageData = {
  storeName: string;
  balance: string;
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
  if (balance <= 0)       return 'text-rose-500';
  if (balance < 250_000)  return 'text-rose-400';
  if (balance < 500_000)  return 'text-amber-500';
  return 'text-emerald-500';
}

function balanceBg(balance: number) {
  if (balance <= 0)       return 'from-rose-50 to-red-50';
  if (balance < 250_000)  return 'from-rose-50 to-orange-50';
  if (balance < 500_000)  return 'from-amber-50 to-yellow-50';
  return 'from-emerald-50 to-teal-50';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    day:    '2-digit',
    month:  'short',
    hour:   '2-digit',
    minute: '2-digit',
  });
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
  totalSpent,
}: {
  balance: number;
  storeName: string;
  totalSpent: number;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));

  return (
    <div className={cn('mx-4 rounded-2xl bg-gradient-to-br p-5 shadow-sm', balanceBg(balance))}>
      <div className="mb-1 flex items-center gap-2">
        <Wallet className="h-4 w-4 text-slate-500" />
        <p className="text-xs font-semibold text-slate-500">{storeName} · Petty Cash</p>
      </div>

      <p className={cn('text-4xl font-bold tracking-tight', balanceColor(balance))}>
        {idr(balance)}
      </p>
      <p className="mt-0.5 text-[11px] text-slate-400">Remaining balance</p>

      {/* Balance bar */}
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
        <span>Spent {idr(totalSpent)} this month</span>
      </div>
    </div>
  );
}

// ─── Photo picker ─────────────────────────────────────────────────────────────

function PhotoPicker({
  preview,
  uploading,
  onPick,
  onRemove,
}: {
  preview: string | null;
  uploading: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState(false);

  return (
    <>
      {lightbox && preview && (
        <Lightbox src={preview} onClose={() => setLightbox(false)} />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />

      {preview ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => setLightbox(true)}
            className="group relative flex h-36 w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-emerald-200 bg-slate-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Receipt preview"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/20 transition-colors">
              <ZoomIn className="h-7 w-7 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-rose-500 text-white shadow-md"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <p className="mt-1.5 text-center text-[10px] text-slate-400">
            Tap photo to preview · tap ✕ to remove
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className={cn(
            'flex h-36 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed transition-colors',
            uploading
              ? 'border-slate-200 bg-slate-50 opacity-60'
              : 'border-slate-300 bg-slate-50 active:border-emerald-400 active:bg-emerald-50',
          )}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          ) : (
            <Camera className="h-8 w-8 text-slate-400" />
          )}
          <span className="text-sm font-medium text-slate-500">
            {uploading ? 'Uploading…' : 'Take photo or choose from gallery'}
          </span>
          <span className="text-[10px] text-slate-400">
            Receipt or proof of purchase · max 5 MB
          </span>
        </button>
      )}
    </>
  );
}

// ─── Transaction history item ─────────────────────────────────────────────────

function TxItem({ tx, onViewImage }: { tx: TxRow; onViewImage: (url: string) => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      {/* Photo thumbnail */}
      {tx.imageUrl ? (
        <button
          onClick={() => onViewImage(tx.imageUrl!)}
          className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-100"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-active:bg-black/20 transition-colors">
            <ZoomIn className="h-4 w-4 text-white opacity-0 group-active:opacity-100" />
          </div>
        </button>
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50">
          <ReceiptText className="h-5 w-5 text-slate-300" />
        </div>
      )}

      {/* Details */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-800">{tx.description}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{fmtDate(tx.createdAt)}</p>

        {tx.verifiedAt && (
          <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
            <ShieldCheck className="h-3 w-3" />
            Verified by Finance
          </span>
        )}
      </div>

      {/* Amount */}
      <span className="shrink-0 text-sm font-bold text-rose-500">
        −{idr(tx.amount)}
      </span>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeePettyCashPage() {
  const [data, setData]             = useState<PageData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);

  // Form state
  const [amount, setAmount]         = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl]     = useState<string | null>(null);
  const [imageKey, setImageKey]     = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError]   = useState<string | null>(null);
  const [success, setSuccess]       = useState(false);

  // Lightbox for history
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // ── Load ──

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res  = await fetch('/api/employee/petty-cash', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setData(body);
      else setLoadError(body.error ?? 'Failed to load.');
    } catch {
      setLoadError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── Upload photo ──

  async function handlePickPhoto(file: File) {
    if (!data?.storeName) return;
    setUploading(true);
    setFormError(null);

    // Local preview immediately
    const localUrl = URL.createObjectURL(file);
    setImagePreview(localUrl);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('storeName', data.storeName);

      const res  = await fetch('/api/upload/petty-cash', { method: 'POST', body: form });
      const body = await res.json();

      if (!res.ok) {
        setFormError(body.error ?? 'Upload failed.');
        setImagePreview(null);
        return;
      }

      setImageUrl(body.url);
      setImageKey(body.key);
      // Replace blob URL with the real one
      URL.revokeObjectURL(localUrl);
      setImagePreview(body.url);
    } catch {
      setFormError('Upload failed. Check your connection.');
      setImagePreview(null);
    } finally {
      setUploading(false);
    }
  }

  function handleRemovePhoto() {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageUrl(null);
    setImageKey(null);
  }

  // ── Submit transaction ──

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccess(false);

    const amt = Number(amount.replace(/[^0-9]/g, ''));
    if (!amt || amt <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (!description.trim()) {
      setFormError('Description is required.');
      return;
    }
    if (!imageUrl) {
      setFormError('Please take a photo of the receipt first.');
      return;
    }

    const balance = Number(data?.balance ?? 0);
    if (amt > balance) {
      setFormError(`Amount exceeds balance (${idr(balance)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/petty-cash', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ amount: amt, description: description.trim(), imageUrl, imageKey }),
      });
      const body = await res.json();

      if (!body.success) {
        setFormError(body.error ?? 'Submission failed.');
        return;
      }

      // Reset form
      setAmount('');
      setDescription('');
      handleRemovePhoto();
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);

      // Reload data to show updated balance + new transaction
      await load();
    } catch {
      setFormError('Network error. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived ──

  const balance     = Number(data?.balance ?? 0);
  const totalSpent  = (data?.transactions ?? []).reduce((s, t) => s + Number(t.amount), 0);
  const amountNum   = Number(amount.replace(/[^0-9]/g, ''));
  const afterAmount = balance - (amountNum || 0);

  // ── Render ──

  return (
    <>
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {/* ── Header ── */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-3.5 backdrop-blur">
        <Link
          href="/employee"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Petty Cash</p>
          <p className="text-sm font-bold text-foreground leading-none">
            {data?.storeName ?? '…'}
          </p>
        </div>
      </div>

      <div className="space-y-5 py-5">

        {/* ── Balance card ── */}
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
            totalSpent={totalSpent}
          />
        )}

        {/* ── Submit form ── */}
        {!loading && !loadError && (
          <section className="px-4">
            <h2 className="mb-3 text-sm font-bold text-foreground">New Transaction</h2>

            <form onSubmit={handleSubmit} className="space-y-4">

              {/* Amount */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Amount (Rp)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
                    Rp
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={balance}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="h-12 w-full rounded-xl border border-border bg-secondary/40 pl-10 pr-4 text-right text-lg font-bold tabular-nums text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>

                {/* After-amount preview */}
                {amountNum > 0 && (
                  <p className={cn(
                    'mt-1.5 text-right text-xs font-semibold',
                    afterAmount < 0 ? 'text-rose-500' : 'text-muted-foreground',
                  )}>
                    Balance after: {idr(Math.max(0, afterAmount))}
                    {afterAmount < 0 && ' · exceeds balance'}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="What was this for? e.g. Cleaning supplies, printer ink…"
                  className="w-full resize-none rounded-xl border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground placeholder-muted-foreground/40 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Photo */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Receipt Photo <span className="text-rose-400">*</span>
                </label>
                <PhotoPicker
                  preview={imagePreview}
                  uploading={uploading}
                  onPick={handlePickPhoto}
                  onRemove={handleRemovePhoto}
                />
              </div>

              {/* Error */}
              {formError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                  <p className="text-sm text-rose-700">{formError}</p>
                </div>
              )}

              {/* Success */}
              {success && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <p className="text-sm font-medium text-emerald-700">
                    Transaction recorded successfully.
                  </p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={submitting || uploading || balance <= 0}
                className={cn(
                  'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors',
                  submitting || uploading || balance <= 0
                    ? 'bg-secondary text-muted-foreground'
                    : 'bg-primary text-primary-foreground active:opacity-80',
                )}
              >
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</>
                  : balance <= 0
                  ? 'No balance remaining'
                  : 'Submit Transaction'}
              </button>

              {balance <= 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Balance is empty. Finance needs to issue a refill first.
                </p>
              )}
            </form>
          </section>
        )}

        {/* ── Transaction history ── */}
        {!loading && !loadError && (data?.transactions.length ?? 0) > 0 && (
          <section className="px-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground">This Month's Transactions</h2>
              <span className="text-xs text-muted-foreground">
                {data!.transactions.length} record{data!.transactions.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="space-y-2.5">
              {data!.transactions.map((tx) => (
                <TxItem
                  key={tx.id}
                  tx={tx}
                  onViewImage={setLightboxSrc}
                />
              ))}
            </div>

            <p className="mt-3 text-center text-[10px] text-muted-foreground">
              Records from previous months are automatically removed after verification.
            </p>
          </section>
        )}

        {/* Empty history state */}
        {!loading && !loadError && (data?.transactions.length ?? 0) === 0 && !success && (
          <section className="px-4">
            <div className="rounded-2xl border border-dashed border-border bg-secondary/30 py-10 text-center">
              <ReceiptText className="mx-auto mb-2 h-9 w-9 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No transactions this month</p>
              <p className="mt-0.5 text-xs text-muted-foreground/60">
                Fill the form above to record your first one.
              </p>
            </div>
          </section>
        )}

      </div>
    </>
  );
}