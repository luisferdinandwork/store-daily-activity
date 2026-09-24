// app/employee/pettycash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Banknote,
  Camera,
  Clock3,
  Info,
  Loader2,
  ReceiptText,
  ShieldCheck,
  UploadCloud,
  Wallet,
  X,
  XCircle,
  ZoomIn,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { EmptyState, Notice, SectionLabel, SkeletonBlocks } from '@/components/employee/ui';
import CameraCapture from '@/components/shared/CameraCapture';

// ─── Types ────────────────────────────────────────────────────────────────────

type PettyCashStatus = 'pending_ops' | 'ops_approved' | 'completed' | 'ops_rejected';

type TxRow = {
  id: number;
  amount: string;
  actualAmount: string | null;
  description: string;
  status: PettyCashStatus | string;
  imageUrl: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
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

// Balance health uses its own emerald/amber/rose "fuel gauge" scale — kept
// separate from the sky/indigo/emerald/rose status-badge language below so
// the two systems never overload the same color with two different meanings
// (e.g. amber never means both "low balance" AND "waiting on someone else").
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

function balanceHealth(balance: number, isPic: boolean) {
  if (balance <= 0) {
    return {
      label: 'Habis',
      detail: isPic
        ? 'Ajukan Refill sebelum mengirim Request baru.'
        : 'Minta PIC untuk mengajukan Refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 250_000) {
    return {
      label: 'Kritis',
      detail: isPic
        ? 'Saldo sangat menipis — ajukan Refill sekarang.'
        : 'Saldo sangat menipis — minta PIC untuk mengajukan Refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 500_000) {
    return {
      label: 'Mulai Menipis',
      detail: isPic
        ? 'Pertimbangkan untuk mengajukan Refill.'
        : 'PIC mungkin perlu mengajukan Refill segera.',
      textClass: 'text-amber-600',
    };
  }
  return { label: 'Aman', detail: null, textClass: 'text-emerald-600' };
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

// Needs the PIC to confirm what was actually spent — the requested amount
// was only ever an estimate. Nothing is deducted from the balance until this
// happens.
function needsActualAmount(tx: TxRow) {
  return tx.status === 'ops_approved';
}

function needsReceipt(tx: TxRow) {
  return (tx.status === 'ops_approved' || tx.status === 'completed') && !tx.imageUrl;
}

// One consistent status language across the whole page:
//   sky    = waiting on someone else to act
//   indigo = action needed from you
//   emerald = done / approved
//   rose   = rejected / problem
function statusMeta(tx: TxRow) {
  if (tx.status === 'pending_ops') {
    return {
      label: 'Menunggu Persetujuan OPS',
      icon: Clock3,
      className: 'bg-sky-50 text-sky-700 ring-sky-200',
      note: 'Request kamu sudah dikirim ke OPS untuk disetujui.',
    };
  }

  if (tx.status === 'ops_rejected') {
    return {
      label: 'Ditolak OPS',
      icon: XCircle,
      className: 'bg-rose-50 text-rose-700 ring-rose-200',
      note: tx.rejectionReason || 'Request ini ditolak oleh OPS.',
    };
  }

  if (needsActualAmount(tx)) {
    return {
      label: 'Konfirmasi Jumlah Terpakai',
      icon: UploadCloud,
      className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      note: 'OPS sudah menyetujui request ini. Konfirmasi jumlah uang yang benar-benar terpakai untuk dipotong dari saldo.',
    };
  }

  if (needsReceipt(tx)) {
    return {
      label: 'Unggah Struk',
      icon: UploadCloud,
      className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      note: 'Unggah foto struk untuk arsip.',
    };
  }

  return {
    label: 'Selesai',
    icon: ShieldCheck,
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    note: 'Jumlah yang terpakai sudah dipotong dari saldo.',
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
        alt="Struk"
        className="max-h-[88vh] max-w-[92vw] rounded-xl object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// ─── Balance card ─────────────────────────────────────────────────────────────
// Left as the one intentionally-colorful element on the page (like the
// schedule page's header) — the gradient is the balance-health signal
// itself (low/warning/healthy), not decoration, so it's doing real work.

function BalanceCard({
  balance,
  storeName,
  totalApprovedSpend,
  pendingAmount,
  awaitingConfirmAmount,
  month,
  isPic,
}: {
  balance: number;
  storeName: string;
  totalApprovedSpend: number;
  pendingAmount: number;
  awaitingConfirmAmount: number;
  month: string;
  isPic: boolean;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));
  const health = balanceHealth(balance, isPic);

  return (
    <div className={cn('mx-4 rounded-2xl bg-gradient-to-br p-5 shadow-sm', balanceBg(balance))}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground">
            {storeName} · {monthLabel(month)}
          </p>
        </div>
        <span className={cn('text-[10px] font-bold uppercase tracking-wide', health.textClass)}>
          {health.label}
        </span>
      </div>

      <p className={cn('text-4xl font-bold tracking-tight', balanceColor(balance))}>
        {idr(balance)}
      </p>

      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Sisa saldo setelah jumlah terpakai dikonfirmasi
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

      <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{pct}% tersisa dari Rp 1.000.000</span>
        <span>Pengeluaran disetujui {idr(totalApprovedSpend)}</span>
      </div>

      {health.detail && (
        <p className={cn('mt-2 text-[11px] font-semibold', health.textClass)}>
          {health.detail}
        </p>
      )}

      {pendingAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-sky-700">
            Request menunggu OPS: {idr(pendingAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Jumlah ini belum dipotong sampai disetujui OPS.
          </p>
        </div>
      )}

      {awaitingConfirmAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-indigo-700">
            OPS sudah menyetujui, menunggu konfirmasi kamu: {idr(awaitingConfirmAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Ini masih perkiraan awal — belum dipotong sampai kamu konfirmasi jumlah yang benar-benar terpakai.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Refill request (PIC requests; every employee can see status) ───────────

type RefillProofKind = 'drawer' | 'signature';

type RefillRequestRow = {
  id: number;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  approvedAt: string | null;
  balanceAfter: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  drawerPhotoUrl: string | null;
  signaturePhotoUrl: string | null;
};

const PROOF_STEPS: { kind: RefillProofKind; label: string }[] = [
  { kind: 'drawer', label: 'Laci Petty Cash' },
  { kind: 'signature', label: 'Surat Terima Petty Cash' },
];

function RefillProofCapture({
  label,
  imageUrl,
  uploading,
  onConfirm,
  onView,
}: {
  label: string;
  imageUrl: string | null;
  uploading: boolean;
  onConfirm: (file: File) => void;
  onView: (url: string) => void;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
      {imageUrl ? (
        <button
          type="button"
          onClick={() => onView(imageUrl)}
          className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-border bg-secondary">
          <Camera className="h-4 w-4 text-muted-foreground/50" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground">{label}</p>
        <p className={cn('text-[10px] font-semibold', imageUrl ? 'text-emerald-600' : 'text-muted-foreground')}>
          {imageUrl ? 'Sudah diunggah' : 'Belum diunggah'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={uploading}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition active:scale-[0.98] disabled:opacity-60',
          imageUrl ? 'border border-border text-muted-foreground' : 'bg-indigo-600 text-white',
        )}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {imageUrl ? 'Ambil Ulang' : 'Ambil Foto'}
      </button>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
        title={label}
      />
    </div>
  );
}

function RefillRequestCard({
  request,
  isPic,
  requesting,
  onRequest,
  uploadingKind,
  onUploadProof,
  onViewImage,
}: {
  request: RefillRequestRow | null;
  isPic: boolean;
  requesting: boolean;
  onRequest: () => void;
  uploadingKind: RefillProofKind | null;
  onUploadProof: (kind: RefillProofKind, file: File) => void;
  onViewImage: (url: string) => void;
}) {
  // Card shells are neutral now (card / border) — status still reads
  // clearly from the icon + heading color and, for "approved", from the
  // action itself (proof capture rows). Colored fills stayed only in the
  // small elements whose entire job is to signal status.
  if (request?.status === 'pending') {
    return (
      <div className="mx-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-sky-600" />
          <p className="text-xs font-bold text-sky-700">Request Refill menunggu persetujuan OPS</p>
        </div>
      </div>
    );
  }

  const toppedUp = Boolean(request?.balanceAfter);

  // Once a refill is fully received (both proof photos in), it stops
  // appearing here at all — the topped-up balance applies to NEXT month, so
  // there's nothing left to action on this month's view. The request itself
  // stays intact for Ops/Finance; PIC can fall through to request a fresh one.
  if (request?.status === 'approved' && !toppedUp) {
    const photoUrls: Record<RefillProofKind, string | null> = {
      drawer: request.drawerPhotoUrl,
      signature: request.signaturePhotoUrl,
    };

    return (
      <div className="mx-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-indigo-600" />
          <p className="text-xs font-bold text-indigo-700">
            OPS sudah menyetujui — ambil foto bukti setelah menerima uangnya
          </p>
        </div>

        <p className="mt-1.5 text-[11px] text-indigo-600/80">
          Saat Finance menyerahkan uangnya, ambil foto laci petty cash dan Surat Terima Petty Cash di bawah ini. Saldo akan diperbarui setelah kedua foto terkirim.
        </p>

        <div className="mt-3 space-y-2">
          {PROOF_STEPS.map((step) => (
            <RefillProofCapture
              key={step.kind}
              label={step.label}
              imageUrl={photoUrls[step.kind]}
              uploading={uploadingKind === step.kind}
              onConfirm={(file) => onUploadProof(step.kind, file)}
              onView={onViewImage}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!isPic) {
    return null;
  }

  return (
    <div className="mx-4 rounded-2xl border border-dashed border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <Banknote className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground">Saldo keseluruhan mulai menipis?</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Refill mengembalikan seluruh petty cash toko ke Rp 1.000.000.
            Ini terpisah dari Request penggunaan — ditinjau dan disetujui oleh OPS.
          </p>
          {request?.status === 'rejected' && (
            <p className="mt-1.5 text-[11px] font-medium text-rose-600">
              Request terakhir ditolak{request.rejectionReason ? `: ${request.rejectionReason}` : '.'} Kamu bisa mengajukan lagi.
            </p>
          )}
        </div>
      </div>
      {/* Outline style — a secondary action, visually distinct from the
          filled primary "Kirim Request ke OPS" button below the page. */}
      <button
        type="button"
        onClick={onRequest}
        disabled={requesting}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-card text-xs font-bold text-indigo-700 transition active:scale-[0.99] disabled:opacity-60"
      >
        {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
        Ajukan Refill
      </button>
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
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={uploading}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white transition active:scale-[0.99] disabled:opacity-60"
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Mengunggah…
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" />
            Ambil Foto Struk
          </>
        )}
      </button>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
        title="Foto Struk"
      />
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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
            <UploadCloud className="h-3 w-3" />
            Perlu Tindakan
          </span>

          <p className="mt-2 truncate text-sm font-semibold text-foreground">
            {tx.description}
          </p>

          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Disetujui {fmtDate(tx.createdAt)}
          </p>
        </div>

        <span className="shrink-0 text-sm font-bold text-rose-500">
          −{idr(tx.actualAmount ?? tx.amount)}
        </span>
      </div>

      <p className="mt-2 text-[11px] font-medium text-indigo-700">
        Unggah foto struk untuk arsip.
      </p>

      <ReceiptCapture uploading={uploading} onConfirm={(file) => onUpload(tx, file)} />
    </div>
  );
}

// ─── Confirm actual amount used (requests are estimates; this is what
// actually gets cut from the balance) ────────────────────────────────────

function ConfirmAmountCard({
  tx,
  confirming,
  onConfirm,
  uploading,
  onUploadReceipt,
  onViewImage,
}: {
  tx: TxRow;
  confirming: boolean;
  onConfirm: (tx: TxRow, actualAmount: number) => void;
  uploading: boolean;
  onUploadReceipt: (tx: TxRow, file: File) => void;
  onViewImage: (url: string) => void;
}) {
  const [amount, setAmount] = useState(() => String(Math.round(Number(tx.amount))));
  const amountNum = Number(amount.replace(/[^0-9]/g, ''));

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
            <Banknote className="h-3 w-3" />
            Perlu Tindakan
          </span>

          <p className="mt-2 truncate text-sm font-semibold text-foreground">
            {tx.description}
          </p>

          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Diminta {idr(tx.amount)} · Disetujui {fmtDate(tx.createdAt)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] font-medium text-indigo-700">
        OPS sudah menyetujui request ini. Masukkan jumlah yang benar-benar
        terpakai — ini yang akan dipotong dari saldo, bukan jumlah yang diminta.
      </p>

      <div className="mt-3">
        <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
          Jumlah terpakai (Rp)
        </label>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">
            Rp
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={amountNum ? amountNum.toLocaleString('id-ID') : ''}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="0"
            className="h-11 w-full rounded-xl border border-border bg-secondary/40 pl-10 pr-4 text-right text-base font-bold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onConfirm(tx, amountNum)}
        disabled={confirming || !amountNum}
        className={cn(
          'mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold transition active:scale-[0.99] disabled:opacity-60',
          confirming || !amountNum ? 'bg-secondary text-muted-foreground' : 'bg-indigo-600 text-white',
        )}
      >
        {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
        Konfirmasi & Potong {amountNum ? idr(amountNum) : ''}
      </button>

      <div className="mt-3 border-t border-border pt-3">
        <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          Foto struk {tx.imageUrl ? '(sudah diunggah)' : '(opsional, untuk arsip)'}
        </p>
        {tx.imageUrl ? (
          <button
            type="button"
            onClick={() => onViewImage(tx.imageUrl!)}
            className="h-11 w-11 overflow-hidden rounded-lg border border-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
          </button>
        ) : (
          <ReceiptCapture uploading={uploading} onConfirm={(file) => onUploadReceipt(tx, file)} />
        )}
      </div>
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
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {tx.imageUrl ? (
          <button
            type="button"
            onClick={() => onViewImage(tx.imageUrl!)}
            className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-active:bg-black/20">
              <ZoomIn className="h-4 w-4 text-white opacity-0 group-active:opacity-100" />
            </div>
          </button>
        ) : (
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-secondary">
            <ReceiptText className="h-5 w-5 text-muted-foreground/50" />
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

          <p className="mt-2 truncate text-sm font-semibold text-foreground">
            {tx.description}
          </p>

          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {fmtDate(tx.createdAt)}
          </p>

          <p
            className={cn(
              'mt-1 text-[11px] font-medium',
              tx.status === 'ops_rejected' ? 'text-rose-600' : 'text-muted-foreground',
            )}
          >
            {meta.note}
          </p>
        </div>

        <span
          className={cn(
            'shrink-0 text-sm font-bold',
            tx.status === 'ops_rejected' ? 'text-muted-foreground line-through' : 'text-rose-500',
          )}
        >
          −{idr(tx.actualAmount ?? tx.amount)}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeePettyCashPage() {
  const { data: session } = useSession();
  const employeeType = (session?.user as any)?.employeeType as string | undefined;
  const isPic = employeeType === 'pic_1' || employeeType === 'pic_2';

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [uploadingTxId, setUploadingTxId] = useState<number | null>(null);
  const [confirmingTxId, setConfirmingTxId] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);

  const [refillRequest, setRefillRequest] = useState<RefillRequestRow | null>(null);
  const [requestingRefill, setRequestingRefill] = useState(false);
  const [uploadingProofKind, setUploadingProofKind] = useState<RefillProofKind | null>(null);

  // `silent` skips the full-page loading skeleton — used for background
  // refreshes after an action. Without this, the "Needs Your Action" section
  // (gated on `!loading`) briefly unmounts on every refresh, which resets
  // any local input state inside it (e.g. a typed actual-amount value) back
  // to its default. Only the very first load should show the skeleton.
  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch('/api/employee/petty-cash', {
        cache: 'no-store',
      });

      const body = await res.json();

      if (body.success) {
        setData(body);
      } else {
        setLoadError(body.error ?? 'Gagal memuat data petty cash.');
      }
    } catch {
      setLoadError('Terjadi kesalahan jaringan.');
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const loadRefillStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/employee/petty-cash/refill-request', { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setRefillRequest(body.request ?? null);
    } catch {
      // Non-critical — the request button just won't show a status yet.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadRefillStatus();
  }, [loadRefillStatus]);

  async function handleRequestRefill() {
    setRequestingRefill(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/employee/petty-cash/refill-request', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Gagal mengajukan Refill.');
      setRefillRequest(body.request);
      setSuccessMessage('Refill diajukan — akan ditinjau oleh OPS.');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Gagal mengajukan Refill.');
    } finally {
      setRequestingRefill(false);
    }
  }

  async function handleUploadProof(kind: RefillProofKind, file: File) {
    setActionError(null);
    setSuccessMessage(null);

    if (!refillRequest) return;

    if (file.size > 5 * 1024 * 1024) {
      setActionError('Foto harus kurang dari 5 MB.');
      return;
    }

    if (!data?.storeName) {
      setActionError('Data toko belum termuat.');
      return;
    }

    setUploadingProofKind(kind);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('storeName', data.storeName);
      form.append('kind', kind);

      const uploadRes = await fetch('/api/upload/petty-cash', { method: 'POST', body: form });
      const uploadBody = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadBody.error ?? 'Gagal mengunggah foto.');

      const patchRes = await fetch('/api/employee/petty-cash/refill-request', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: refillRequest.id, kind, imageUrl: uploadBody.url }),
      });
      const patchBody = await patchRes.json();
      if (!patchRes.ok || !patchBody.success) throw new Error(patchBody.error ?? 'Gagal melampirkan foto.');

      setRefillRequest(patchBody.request);
      setSuccessMessage('Foto berhasil diunggah.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal mengunggah foto. Coba lagi.');
    } finally {
      setUploadingProofKind(null);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    setFormError(null);
    setActionError(null);
    setSuccessMessage(null);

    const amt = Number(amount.replace(/[^0-9]/g, ''));

    if (!amt || amt <= 0) {
      setFormError('Masukkan jumlah yang valid.');
      return;
    }

    if (!description.trim()) {
      setFormError('Keterangan wajib diisi.');
      return;
    }

    const balance = Number(data?.balance ?? 0);

    if (amt > balance) {
      setFormError(`Jumlah melebihi saldo yang tersedia saat ini (${idr(balance)}).`);
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
        setFormError(body.error ?? 'Request gagal.');
        return;
      }

      setAmount('');
      setDescription('');
      setSuccessMessage('Request sudah dikirim ke OPS untuk disetujui.');
      setTimeout(() => setSuccessMessage(null), 4000);

      await load({ silent: true });
    } catch {
      setFormError('Terjadi kesalahan jaringan. Coba lagi.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadReceipt(tx: TxRow, file: File) {
    setActionError(null);
    setSuccessMessage(null);

    if (file.size > 5 * 1024 * 1024) {
      setActionError('Foto struk harus kurang dari 5 MB.');
      return;
    }

    if (!data?.storeName) {
      setActionError('Data toko belum termuat.');
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
        throw new Error(uploadBody.error ?? 'Gagal mengunggah struk.');
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
        throw new Error(patchBody.error ?? 'Gagal melampirkan struk.');
      }

      setSuccessMessage('Struk berhasil diunggah dan disimpan.');
      setTimeout(() => setSuccessMessage(null), 4000);

      await load({ silent: true });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengunggah struk. Coba lagi.',
      );
    } finally {
      setUploadingTxId(null);
    }
  }

  async function handleConfirmActualAmount(tx: TxRow, actualAmount: number) {
    setActionError(null);
    setSuccessMessage(null);

    if (!actualAmount || actualAmount <= 0) {
      setActionError('Masukkan jumlah terpakai yang valid.');
      return;
    }

    setConfirmingTxId(tx.id);

    try {
      const res = await fetch('/api/employee/petty-cash', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txId: tx.id, actualAmount }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        throw new Error(body.error ?? 'Gagal mengonfirmasi jumlah terpakai.');
      }

      setSuccessMessage('Jumlah terpakai berhasil dikonfirmasi dan dipotong dari saldo.');
      setTimeout(() => setSuccessMessage(null), 4000);

      await load({ silent: true });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengonfirmasi jumlah terpakai. Coba lagi.',
      );
    } finally {
      setConfirmingTxId(null);
    }
  }

  const balance = Number(data?.balance ?? 0);

  const amountNum = Number(amount.replace(/[^0-9]/g, ''));
  const afterAmount = balance - (amountNum || 0);

  const transactions = data?.transactions ?? [];
  const needsActualAmountTxs = useMemo(
    () => transactions.filter(needsActualAmount),
    [transactions],
  );
  const needsReceiptTxs = useMemo(
    () => transactions.filter(needsReceipt),
    [transactions],
  );
  const historyTxs = useMemo(
    () => transactions.filter((tx) => !needsReceipt(tx) && !needsActualAmount(tx)),
    [transactions],
  );

  const summary = useMemo(() => {
    return {
      pendingOps: transactions.filter((tx) => tx.status === 'pending_ops').length,
      waitingConfirm: needsActualAmountTxs.length,
      waitingReceipt: needsReceiptTxs.length,
      completed: transactions.filter((tx) => tx.status === 'completed').length,
      rejected: transactions.filter((tx) => tx.status === 'ops_rejected').length,
      pendingAmount: transactions
        .filter((tx) => tx.status === 'pending_ops')
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
      // OPS approved but the PIC hasn't confirmed the actual amount yet — this
      // is still just the requested estimate, and still not deducted.
      awaitingConfirmAmount: needsActualAmountTxs.reduce((sum, tx) => sum + Number(tx.amount), 0),
      approvedSpend: transactions
        .filter((tx) => tx.status === 'completed')
        .reduce((sum, tx) => sum + Number(tx.actualAmount ?? tx.amount), 0),
    };
  }, [transactions, needsActualAmountTxs, needsReceiptTxs]);

  return (
    <div className="mx-auto w-full max-w-md">
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Request Petty Cash
        </p>
        <p className="mt-0.5 text-base font-bold leading-tight text-foreground">
          {data?.storeName ?? '…'}
        </p>
      </div>

      {showInfo && (
        <div className="mx-4 mt-4">
          <Notice tone="neutral" icon={Info} onDismiss={() => setShowInfo(false)}>
            <p>
              <span className="font-bold text-foreground">Request</span> — pakai
              uang untuk keperluan tertentu. Diajukan ke OPS untuk disetujui.
            </p>
            <p className="mt-1">
              <span className="font-bold text-foreground">Refill</span> — mengembalikan
              seluruh saldo ke Rp 1.000.000 saat mulai menipis. Diajukan ke OPS
              untuk disetujui.
            </p>
          </Notice>
        </div>
      )}

      <div className="space-y-5 pb-8 pt-5">
        {loading ? (
          <div className="px-4"><SkeletonBlocks count={1} className="h-36" /></div>
        ) : loadError ? (
          <div className="px-4"><Notice tone="error">{loadError}</Notice></div>
        ) : (
          <BalanceCard
            balance={balance}
            storeName={data?.storeName ?? ''}
            month={data?.month ?? ''}
            totalApprovedSpend={summary.approvedSpend}
            pendingAmount={summary.pendingAmount}
            awaitingConfirmAmount={summary.awaitingConfirmAmount}
            isPic={isPic}
          />
        )}

        {!loading && !loadError && (isPic || refillRequest) && (
          <RefillRequestCard
            request={refillRequest}
            isPic={isPic}
            requesting={requestingRefill}
            onRequest={handleRequestRefill}
            uploadingKind={uploadingProofKind}
            onUploadProof={handleUploadProof}
            onViewImage={setLightboxSrc}
          />
        )}

        {!loading && !loadError && (
          <section className="grid grid-cols-4 gap-2 px-4">
            <div className="min-w-0 rounded-2xl border border-border bg-card px-2 py-3 text-center">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-sky-600">
                OPS
              </p>
              <p className="mt-1 text-xl font-black text-sky-700">
                {summary.pendingOps}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-border bg-card px-2 py-3 text-center">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                Konfirmasi
              </p>
              <p className="mt-1 text-xl font-black text-indigo-700">
                {summary.waitingConfirm}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-border bg-card px-2 py-3 text-center">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                Struk
              </p>
              <p className="mt-1 text-xl font-black text-indigo-700">
                {summary.waitingReceipt}
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-border bg-card px-2 py-3 text-center">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                Selesai
              </p>
              <p className="mt-1 text-xl font-black text-emerald-700">
                {summary.completed}
              </p>
            </div>
          </section>
        )}

        {!loading && !loadError && actionError && (
          <section className="px-4">
            <Notice tone="error" onDismiss={() => setActionError(null)}>{actionError}</Notice>
          </section>
        )}

        {!loading && !loadError && successMessage && (
          <section className="px-4">
            <Notice tone="success">{successMessage}</Notice>
          </section>
        )}

        {!loading && !loadError && isPic && (needsActualAmountTxs.length > 0 || needsReceiptTxs.length > 0) && (
          <section className="px-4">
            <SectionLabel meta={`${needsActualAmountTxs.length + needsReceiptTxs.length} request`}>
              Perlu tindakan kamu
            </SectionLabel>

            <div className="space-y-2.5">
              {needsActualAmountTxs.map((tx) => (
                <ConfirmAmountCard
                  key={tx.id}
                  tx={tx}
                  confirming={confirmingTxId === tx.id}
                  onConfirm={handleConfirmActualAmount}
                  uploading={uploadingTxId === tx.id}
                  onUploadReceipt={handleUploadReceipt}
                  onViewImage={setLightboxSrc}
                />
              ))}
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

        {!loading && !loadError && !isPic && (
          <section className="px-4">
            <Notice tone="neutral" title="Hanya PIC yang bisa mengirim Request Petty Cash">
              Kamu bisa melihat status Request di sini. Minta PIC toko untuk mengirim Request baru.
            </Notice>
          </section>
        )}

        {!loading && !loadError && isPic && (
          <section className="px-4">
            <SectionLabel>Request petty cash baru</SectionLabel>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Notice tone="info" title="Foto struk belum diperlukan sekarang.">
                Kirim Request terlebih dahulu. Setelah disetujui OPS, kamu akan
                melihatnya di &quot;Perlu Tindakan Kamu&quot; untuk mengunggah struk.
              </Notice>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Jumlah (Rp)
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
                    className="h-12 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-right text-lg font-bold tabular-nums text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
                  />
                </div>

                {amountNum > 0 && (
                  <p
                    className={cn(
                      'mt-1.5 text-right text-xs font-semibold',
                      afterAmount < 0 ? 'text-rose-500' : 'text-muted-foreground',
                    )}
                  >
                    Saldo setelah disetujui OPS: {idr(Math.max(0, afterAmount))}
                    {afterAmount < 0 && ' · melebihi saldo'}
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Keterangan
                </label>

                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={200}
                  placeholder="Request ini untuk apa? misal: alat kebersihan, tinta printer…"
                  className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {formError && <Notice tone="error">{formError}</Notice>}

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
                    Mengirim request…
                  </>
                ) : balance <= 0 ? (
                  'Saldo habis'
                ) : (
                  'Kirim Request ke OPS'
                )}
              </button>

              {balance <= 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Saldo habis. Ajukan Refill terlebih dahulu.
                </p>
              )}
            </form>
          </section>
        )}

        {!loading && !loadError && historyTxs.length > 0 && (
          <section className="px-4">
            <SectionLabel meta={`${historyTxs.length} data`}>Request bulan ini</SectionLabel>

            <div className="space-y-2.5">
              {historyTxs.map((tx) => (
                <TxItem key={tx.id} tx={tx} onViewImage={setLightboxSrc} />
              ))}
            </div>

            <p className="mt-3 text-center text-[10px] text-muted-foreground">
              Foto struk disimpan secara permanen setelah diunggah.
            </p>
          </section>
        )}

        {!loading && !loadError && transactions.length === 0 && (
          <section className="px-4">
            <div className="rounded-2xl border border-dashed border-border">
              <EmptyState
                icon={ReceiptText}
                title="Belum ada Request Petty Cash bulan ini"
                description={isPic ? 'Isi formulir di atas untuk mengirim Request pertamamu ke OPS.' : undefined}
                className="py-8"
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}