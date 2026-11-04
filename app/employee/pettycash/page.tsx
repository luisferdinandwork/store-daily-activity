// app/employee/pettycash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Banknote,
  CalendarDays,
  Camera,
  ChevronDown,
  Clock3,
  Landmark,
  Loader2,
  ReceiptText,
  RotateCcw,
  Search,
  UploadCloud,
  Wallet,
  X,
  ZoomIn,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ReviewOutcome } from '@/lib/petty-cash-review';
import {
  PETTY_CASH_REASON_MAX,
  pettyCashDefaultDescription,
  pettyCashDescription,
  type PettyCashCategoryOption,
} from '@/lib/petty-cash-categories';
import { RE_REQUEST_LABEL, fmtRequestDate, type ReRequestable } from '@/lib/petty-cash-re-request';
import { jakartaDateKey, jakartaTodayKey, jakartaYearMonth } from '@/lib/day-bucket';
import {
  DEFAULT_LIST_STATE,
  FILTER_LABEL,
  FILTER_ORDER,
  GROUP_LABEL,
  countByFilter,
  filterExceptChip,
  filterRequests,
  isNarrowed,
  listMonths,
  requestAmount,
  requestGroup,
  sortRequests,
  type RequestFilter,
  type RequestGroup,
  type RequestListState,
} from '@/lib/employee-petty-cash-view';
import { ReRequestBadge } from '@/components/petty-cash/ReRequestBadge';
import { PettyCashSortControl } from '@/components/employee/PettyCashSortControl';
import {
  PETTY_CASH_ACCOUNT_HOLDER_MAX,
  PETTY_CASH_ACCOUNT_NUMBER_MAX,
  PETTY_CASH_BANKS,
  PETTY_CASH_BANK_NAME_MAX,
  PETTY_CASH_BANK_OTHER,
  normalizeBankDetails,
  type BankDetails,
} from '@/lib/petty-cash-bank';
import { EmptyState, Notice, SectionLabel, SkeletonBlocks } from '@/components/employee/ui';
import CameraCapture from '@/components/shared/CameraCapture';
import DocumentScanner from '@/components/shared/DocumentScanner';

// ─── Types ────────────────────────────────────────────────────────────────────

type PettyCashStatus = 'pending_ops' | 'ops_approved' | 'completed' | 'ops_rejected';

type TxRow = {
  id: number;
  amount: string;
  actualAmount: string | null;
  description: string;
  categoryName: string | null;
  status: PettyCashStatus | string;
  imageUrl: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  /** The petty cash period it belongs to (YYYY-MM) — the list covers every period. */
  month: string;
  /** Finance's decision on it (Perlu Perbaikan / Ditolak / Diterima). */
  reviewOutcome: ReviewOutcome;
  financeComment: string | null;
  /** A Perlu Perbaikan request filed again, and the day PIC 1 gave as the day it was made (YYYY-MM-DD). */
  isReRequest: boolean;
  requestDate: string | null;
  /** For a re-request: the request it files again. */
  reRequestOfId: number | null;
  /** For a Perlu Perbaikan request: the re-request that filed it again. */
  reRequestedAs: number | null;
  /** Perlu Perbaikan, finished, and not filed again yet. */
  canReRequest: boolean;
};

type PageData = {
  storeName: string;
  balance: string;
  openingBalance?: string;
  closingBalance?: string | null;
  periodStatus?: 'open' | 'closed' | string;
  /** The petty cash period in use (YYYY-MM). */
  month: string;
  /** Today's calendar month (YYYY-MM). */
  currentMonth?: string;
  categories: PettyCashCategoryOption[];
  /** Every request of the store, any month, newest first. */
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

function balanceHealth(balance: number, isHolder: boolean) {
  if (balance <= 0) {
    return {
      label: 'Habis',
      detail: isHolder
        ? 'Ajukan Refill sebelum mengirim Request baru.'
        : 'Minta PIC 1 untuk mengajukan Refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 250_000) {
    return {
      label: 'Kritis',
      detail: isHolder
        ? 'Saldo sangat menipis — ajukan Refill sekarang.'
        : 'Saldo sangat menipis — minta PIC 1 untuk mengajukan Refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 500_000) {
    return {
      label: 'Mulai Menipis',
      detail: isHolder
        ? 'Pertimbangkan untuk mengajukan Refill.'
        : 'PIC 1 mungkin perlu mengajukan Refill segera.',
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

/** "2 Nov 2026" — the day only, for the compact list. */
function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
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
  // A request Finance sent back or turned down has nothing left to upload.
  return (
    (tx.status === 'ops_approved' || tx.status === 'completed') &&
    !tx.imageUrl &&
    tx.reviewOutcome !== 'needs_fix' &&
    tx.reviewOutcome !== 'rejected'
  );
}

// One consistent status language across the whole page:
//   sky     = waiting on someone else to act
//   indigo  = action needed from you now
//   orange  = Perlu Perbaikan (file it again as a Re-request)
//   emerald = done / approved
//   rose    = Ditolak
//   violet  = Re-request
// `isHolder` = the viewer is PIC 1 (the one who acts); everyone else reads a
// status line about PIC 1 instead of an instruction.
const GROUP_DOT: Record<RequestGroup, string> = {
  action: 'bg-indigo-500',
  pending_ops: 'bg-sky-500',
  done: 'bg-emerald-500',
  needs_fix: 'bg-orange-500',
  rejected: 'bg-rose-500',
};

const GROUP_PILL: Record<RequestGroup, string> = {
  action: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  pending_ops: 'bg-sky-50 text-sky-700 ring-sky-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  needs_fix: 'bg-orange-50 text-orange-700 ring-orange-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
};

/** The one line under an opened request: where it stands (null when Finance's card says it all). */
function requestNote(tx: TxRow, isHolder: boolean): string | null {
  if (tx.status === 'pending_ops') {
    return isHolder
      ? 'Request kamu sudah dikirim ke OPS untuk disetujui.'
      : 'Request PIC 1 sedang menunggu persetujuan OPS.';
  }
  if (tx.status === 'ops_rejected') {
    return tx.rejectionReason ? `Alasan: ${tx.rejectionReason}` : 'Request ini ditolak.';
  }
  if (needsActualAmount(tx)) {
    return isHolder
      ? 'OPS sudah menyetujui request ini. Konfirmasi jumlah uang yang benar-benar terpakai untuk dipotong dari saldo.'
      : 'OPS sudah menyetujui — menunggu PIC 1 mengonfirmasi jumlah yang terpakai.';
  }
  if (tx.reviewOutcome === 'needs_fix' || tx.reviewOutcome === 'rejected') return null;
  if (needsReceipt(tx)) {
    return isHolder ? 'Unggah foto struk untuk arsip.' : 'Menunggu PIC 1 mengunggah foto struk.';
  }
  return 'Jumlah yang terpakai sudah dipotong dari saldo.';
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
  currentMonth,
  isHolder,
}: {
  balance: number;
  storeName: string;
  totalApprovedSpend: number;
  pendingAmount: number;
  awaitingConfirmAmount: number;
  /** The petty cash period in use (YYYY-MM). */
  month: string;
  /** Today's calendar month (YYYY-MM), to flag a carried-over / next period. */
  currentMonth?: string;
  isHolder: boolean;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));
  const health = balanceHealth(balance, isHolder);

  // The period isn't always this calendar month: an unrefilled balance keeps
  // carrying forward, and a received refill already opens next month's.
  const periodNote =
    currentMonth && month && month !== currentMonth
      ? month < currentMonth
        ? `Masih memakai saldo ${monthLabel(month)} — belum ada Refill sejak itu.`
        : `Saldo ${monthLabel(month)} sudah aktif setelah Refill diterima.`
      : null;

  return (
    <div className={cn('mx-4 rounded-2xl bg-gradient-to-br p-5 shadow-sm', balanceBg(balance))}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="truncate text-xs font-semibold text-muted-foreground">{storeName}</p>
          </div>

          {/* The month whose petty cash is in use — highlighted on purpose. */}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 shadow-sm ring-1 ring-black/5">
            <CalendarDays className="h-3.5 w-3.5 text-foreground/70" />
            <span className="text-[11px] font-medium text-muted-foreground">Saldo bulan</span>
            <span className="text-xs font-bold text-foreground">{monthLabel(month)}</span>
          </div>

          {periodNote && (
            <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">{periodNote}</p>
          )}
        </div>
        <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wide', health.textClass)}>
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
            OPS sudah menyetujui, menunggu konfirmasi {isHolder ? 'kamu' : 'PIC 1'}: {idr(awaitingConfirmAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Ini masih perkiraan awal — belum dipotong sampai {isHolder ? 'kamu' : 'PIC 1'} konfirmasi jumlah yang benar-benar terpakai.
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
  // Set when Finance has verified the refill — until then PIC 1 can't confirm receipt.
  financeVerifiedAt: string | null;
  balanceAfter: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  // Frozen when Finance verified: the cash sent, and the requests Finance rejected (not covered —
  // paid by the employee outside the system). Null before verification.
  transferAmount: string | null;
  rejectedCount: number;
  rejectedAmount: string | null;
  drawerPhotoUrl: string | null;
  signaturePhotoUrl: string | null;
  // Null on requests made before bank details were required.
  bankName: string | null;
  accountNumber: string | null;
  accountHolderName: string | null;
};

/** The account the request asked Finance to pay — so PIC 1 can spot a typo. */
function RefillBankLine({ request }: { request: RefillRequestRow }) {
  if (!request.bankName || !request.accountNumber) return null;

  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
      <Landmark className="mt-px h-3 w-3 shrink-0" />
      <span>
        Rekening tujuan: <span className="font-semibold text-foreground">{request.bankName}</span>{' '}
        <span className="font-mono tabular-nums">{request.accountNumber}</span>
        {request.accountHolderName && <> a.n. {request.accountHolderName}</>}
      </span>
    </p>
  );
}

// The signed letter is paper (document scanner); the drawer is a plain photo.
const PROOF_STEPS: { kind: RefillProofKind; label: string; isDocument: boolean }[] = [
  { kind: 'drawer', label: 'Laci Petty Cash', isDocument: false },
  { kind: 'signature', label: 'Surat Terima Petty Cash', isDocument: true },
];

function RefillProofCapture({
  label,
  isDocument,
  imageUrl,
  uploading,
  readOnly,
  onConfirm,
  onView,
}: {
  label: string;
  /** Paper to flatten + clean up (scanner) rather than a plain photo. */
  isDocument: boolean;
  imageUrl: string | null;
  uploading: boolean;
  /** Not PIC 1 — show the photo status only, no camera. */
  readOnly: boolean;
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

      {!readOnly && (
      <>
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

      {isDocument ? (
        <DocumentScanner
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
          title={label}
        />
      ) : (
        <CameraCapture
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
          title={label}
        />
      )}
      </>
      )}
    </div>
  );
}

// ─── Bank details PIC 1 gives with a Refill request ─────────────────────────
// Finance sends the cash to this account, so it's required up front — and
// pre-filled from the PIC's last request so it isn't retyped every month.

function RefillBankForm({
  lastBank,
  requesting,
  onSubmit,
}: {
  lastBank: BankDetails | null;
  requesting: boolean;
  onSubmit: (bank: BankDetails) => void;
}) {
  const knownBank = (name: string | undefined) =>
    (PETTY_CASH_BANKS as readonly string[]).includes(name ?? '');

  const [open, setOpen] = useState(false);
  const [bankChoice, setBankChoice] = useState(
    lastBank ? (knownBank(lastBank.bankName) ? lastBank.bankName : PETTY_CASH_BANK_OTHER) : '',
  );
  const [customBank, setCustomBank] = useState(
    lastBank && !knownBank(lastBank.bankName) ? lastBank.bankName : '',
  );
  const [accountNumber, setAccountNumber] = useState(lastBank?.accountNumber ?? '');
  const [holderName, setHolderName] = useState(lastBank?.accountHolderName ?? '');
  const [error, setError] = useState<string | null>(null);

  const inputCls =
    'h-11 w-full rounded-xl border border-border bg-background px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none';

  function submit() {
    const bankName = bankChoice === PETTY_CASH_BANK_OTHER ? customBank : bankChoice;
    const parsed = normalizeBankDetails({ bankName, accountNumber, accountHolderName: holderName });

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    onSubmit(parsed.value);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-card text-xs font-bold text-indigo-700 transition active:scale-[0.99]"
      >
        <Banknote className="h-3.5 w-3.5" />
        Ajukan Refill
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="flex items-start gap-2">
        <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
        <div>
          <p className="text-xs font-bold text-foreground">Rekening tujuan Refill</p>
          <p className="text-[11px] text-muted-foreground">
            Finance akan mentransfer uang Refill ke rekening ini. Pastikan datanya benar.
          </p>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Bank</label>
        <select
          value={bankChoice}
          onChange={(e) => { setBankChoice(e.target.value); setError(null); }}
          className={cn(inputCls, 'appearance-none')}
        >
          <option value="" disabled>Pilih bank…</option>
          {PETTY_CASH_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
          <option value={PETTY_CASH_BANK_OTHER}>Bank lainnya…</option>
        </select>

        {bankChoice === PETTY_CASH_BANK_OTHER && (
          <input
            type="text"
            value={customBank}
            onChange={(e) => { setCustomBank(e.target.value); setError(null); }}
            maxLength={PETTY_CASH_BANK_NAME_MAX}
            placeholder="Nama bank"
            className={cn(inputCls, 'mt-2')}
          />
        )}
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Nomor rekening</label>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={accountNumber}
          onChange={(e) => { setAccountNumber(e.target.value.replace(/[^\d\s.-]/g, '')); setError(null); }}
          maxLength={PETTY_CASH_ACCOUNT_NUMBER_MAX + 6}
          placeholder="Contoh: 1234567890"
          className={cn(inputCls, 'font-mono tabular-nums')}
        />
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
          Nama pemilik rekening
        </label>
        <input
          type="text"
          autoComplete="off"
          value={holderName}
          onChange={(e) => { setHolderName(e.target.value); setError(null); }}
          maxLength={PETTY_CASH_ACCOUNT_HOLDER_MAX}
          placeholder="Sesuai buku tabungan"
          className={cn(inputCls, 'uppercase')}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setError(null); }}
          disabled={requesting}
          className="h-10 shrink-0 rounded-xl border border-border bg-card px-4 text-xs font-bold text-muted-foreground disabled:opacity-60"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={requesting}
          className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-xs font-bold text-white transition active:scale-[0.99] disabled:opacity-60"
        >
          {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
          Kirim Request Refill
        </button>
      </div>
    </div>
  );
}

function RefillRequestCard({
  request,
  isHolder,
  requesting,
  lastBank,
  onRequest,
  uploadingKind,
  onUploadProof,
  onViewImage,
}: {
  request: RefillRequestRow | null;
  isHolder: boolean;
  requesting: boolean;
  lastBank: BankDetails | null;
  onRequest: (bank: BankDetails) => void;
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
        <RefillBankLine request={request} />
      </div>
    );
  }

  const toppedUp = Boolean(request?.balanceAfter);

  // Once a refill is fully received (both proof photos in), it stops
  // appearing here at all — the topped-up balance applies to NEXT month, so
  // there's nothing left to action on this month's view. The request itself
  // stays intact for Ops/Finance; PIC can fall through to request a fresh one.
  // OPS approved, but Finance hasn't sent/verified the cash yet — there is
  // nothing to confirm receiving, so no camera here. The server enforces the
  // same rule (attachRefillProof).
  if (request?.status === 'approved' && !toppedUp && !request.financeVerifiedAt) {
    return (
      <div className="mx-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-sky-600" />
          <p className="text-xs font-bold text-sky-700">OPS sudah menyetujui Refill — menunggu Finance memprosesnya</p>
        </div>

        <RefillBankLine request={request} />

        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {isHolder
            ? 'Konfirmasi penerimaan (foto laci petty cash dan Surat Terima) baru bisa dilakukan setelah Finance memverifikasi bahwa uangnya sudah dikirim. Kamu akan mendapat notifikasi.'
            : 'PIC 1 bisa mengonfirmasi penerimaan setelah Finance memverifikasi Refill ini.'}
        </p>
      </div>
    );
  }

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
            {isHolder
              ? 'Finance sudah memproses Refill — ambil foto bukti setelah menerima uangnya'
              : 'Finance sudah memproses Refill — menunggu PIC 1 mengunggah foto bukti'}
          </p>
        </div>

        <RefillBankLine request={request} />

        {request.transferAmount != null && (
          <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-foreground">
            <p>
              Ditransfer Finance:{' '}
              <span className="font-bold tabular-nums">Rp {Number(request.transferAmount).toLocaleString('id-ID')}</span>
            </p>
            {request.rejectedCount > 0 && (
              <p className="mt-1 font-medium text-rose-600">
                {request.rejectedCount} request ditolak Finance (Rp {Number(request.rejectedAmount ?? 0).toLocaleString('id-ID')})
                tidak dihitung terpakai dan tidak ditransfer — nominal itu dibayar sendiri di luar sistem.
              </p>
            )}
          </div>
        )}

        {isHolder && (
          <p className="mt-1.5 text-[11px] text-indigo-600/80">
            Saat Finance menyerahkan uangnya, ambil foto laci petty cash dan Surat Terima Petty Cash di bawah ini. Saldo akan diperbarui setelah kedua foto terkirim.
          </p>
        )}

        <div className="mt-3 space-y-2">
          {PROOF_STEPS.map((step) => (
            <RefillProofCapture
              key={step.kind}
              label={step.label}
              isDocument={step.isDocument}
              imageUrl={photoUrls[step.kind]}
              uploading={uploadingKind === step.kind}
              readOnly={!isHolder}
              onConfirm={(file) => onUploadProof(step.kind, file)}
              onView={onViewImage}
            />
          ))}
        </div>
      </div>
    );
  }

  if (!isHolder) {
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
          filled primary "Kirim Request ke OPS" button below the page. It
          opens the bank-details form; the request is only sent from there. */}
      <RefillBankForm lastBank={lastBank} requesting={requesting} onSubmit={onRequest} />
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
  replace = false,
}: {
  uploading: boolean;
  onConfirm: (file: File) => void;
  /** A photo is already saved — this button takes a new one in its place. */
  replace?: boolean;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={uploading}
        className={cn(
          'flex h-11 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold transition active:scale-[0.99] disabled:opacity-60',
          replace
            ? 'border border-indigo-200 bg-white text-indigo-700'
            : 'mt-3 bg-indigo-600 text-white',
        )}
      >
        {uploading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Mengunggah…
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" />
            {replace ? 'Ganti Foto Struk' : 'Ambil Foto Struk'}
          </>
        )}
      </button>

      <DocumentScanner
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
        title="Foto Struk"
      />
    </>
  );
}

// ─── What PIC 1 does about a request (shown inside its row once it is opened) ─
// Every request is one row of the list below — these are its action forms, so nothing is listed twice.

function ReceiptAction({
  tx,
  uploading,
  onUpload,
}: {
  tx: TxRow;
  uploading: boolean;
  onUpload: (tx: TxRow, file: File) => void;
}) {
  return (
    <div className="rounded-xl bg-indigo-50 px-3 py-2.5 ring-1 ring-indigo-200">
      <p className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700">
        <UploadCloud className="h-3 w-3" />
        Perlu tindakan
      </p>
      <p className="mt-1 text-[11px] font-medium text-indigo-800">Unggah foto struk untuk arsip.</p>
      <ReceiptCapture uploading={uploading} onConfirm={(file) => onUpload(tx, file)} />
    </div>
  );
}

// Requests are estimates; this is what actually gets cut from the balance.
function ConfirmAmountAction({
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
    <div className="rounded-xl bg-indigo-50 px-3 py-3 ring-1 ring-indigo-200">
      <p className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700">
        <Banknote className="h-3 w-3" />
        Perlu tindakan
      </p>
      <p className="mt-1 text-[11px] font-medium text-indigo-800">
        Diminta {idr(tx.amount)}. OPS sudah menyetujui request ini — masukkan jumlah yang benar-benar
        terpakai, ini yang akan dipotong dari saldo.
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
            className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-4 text-right text-base font-bold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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

      <div className="mt-3 border-t border-indigo-200 pt-3">
        <p className="mb-1.5 text-[11px] font-semibold text-muted-foreground">
          Foto struk {tx.imageUrl ? '(sudah diunggah)' : '(opsional, untuk arsip)'}
        </p>
        {tx.imageUrl ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onViewImage(tx.imageUrl!)}
              className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border"
              aria-label="Lihat foto struk"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={tx.imageUrl} alt="" className="h-full w-full object-cover" />
            </button>
            <div className="min-w-0 flex-1">
              <ReceiptCapture replace uploading={uploading} onConfirm={(file) => onUploadReceipt(tx, file)} />
            </div>
          </div>
        ) : (
          <ReceiptCapture uploading={uploading} onConfirm={(file) => onUploadReceipt(tx, file)} />
        )}
      </div>
    </div>
  );
}

// ─── Finance's decision on a finished request ───────────────────────────────
// Finance checks once a month. Perlu Perbaikan = PIC 1 files it again as a Re-request; Ditolak = final, it can
// not be re-requested (lib/petty-cash-review.ts, lib/petty-cash-re-request.ts).

function FinanceReviewNote({
  tx,
  isHolder,
  onReRequest,
}: {
  tx: TxRow;
  isHolder: boolean;
  onReRequest: (txId: number) => void;
}) {
  const outcome = tx.reviewOutcome;
  if (outcome === 'none') return null;

  const comment = tx.financeComment;

  if (outcome === 'accepted') {
    return (
      <p className="rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
        Diterima Finance — request ini ikut dihitung di Refill.
      </p>
    );
  }

  if (outcome === 'needs_fix') {
    return (
      <div className="rounded-xl bg-orange-50 px-3 py-2.5 ring-1 ring-orange-200">
        <p className="text-[11px] font-bold text-orange-700">Perlu Perbaikan</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-orange-950">
          {comment ?? <span className="italic text-orange-700">Finance tidak menulis komentar.</span>}
        </p>
        <p className="mt-1.5 text-[11px] text-orange-700">
          Nominal ini belum dihitung terpakai dan tidak ikut ditransfer. Ajukan ulang lewat {RE_REQUEST_LABEL} dengan
          data yang sudah diperbaiki.
        </p>
        {tx.reRequestedAs != null ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-700">
            <RotateCcw className="h-3 w-3" />
            Sudah diajukan ulang ({RE_REQUEST_LABEL} #{tx.reRequestedAs})
          </p>
        ) : (
          isHolder &&
          tx.canReRequest && (
            <button
              type="button"
              onClick={() => onReRequest(tx.id)}
              className="mt-2.5 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-xs font-bold text-white transition active:scale-[0.99]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Ajukan ulang ({RE_REQUEST_LABEL})
            </button>
          )
        )}
      </div>
    );
  }

  // outcome === 'rejected' — Ditolak, final
  return (
    <div className="rounded-xl bg-rose-50 px-3 py-2.5 ring-1 ring-rose-200">
      <p className="text-[11px] font-bold text-rose-700">Ditolak</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-rose-900">
        {comment ?? <span className="italic text-rose-700">Finance tidak menulis komentar.</span>}
      </p>
      <p className="mt-1.5 text-[11px] text-rose-700">
        Nominal ini tidak dihitung terpakai dan tidak ikut ditransfer — dibayar sendiri di luar sistem. Request yang
        Ditolak tidak bisa diajukan ulang.
      </p>
    </div>
  );
}

/** "n/100" under a Keterangan box — rose once it is over the limit (an older request can be longer). */
function ReasonCounter({ value }: { value: string }) {
  return (
    <p className={cn('mt-1 text-right text-[11px] tabular-nums', value.length > PETTY_CASH_REASON_MAX ? 'font-semibold text-rose-600' : 'text-muted-foreground')}>
      {value.length}/{PETTY_CASH_REASON_MAX}
    </p>
  );
}

// ─── Re-request ───────────────────────────────────────────────────────────────
// A request Finance sent back with Perlu Perbaikan is filed again, usually next month: say which day the request
// was made, correct Keterangan / what was spent / the receipt. There is no OPS step — it goes straight to
// Finance, marked Re-request, and today's date is recorded automatically (lib/petty-cash-re-request.ts).

/** What the sheet starts from. */
function toReRequestable(tx: TxRow): ReRequestable {
  return {
    id: tx.id,
    categoryName: tx.categoryName,
    description: tx.description,
    amount: Math.round(requestAmount(tx)),
    imageUrl: tx.imageUrl,
    createdAt: tx.createdAt,
    month: tx.month,
    financeComment: tx.financeComment,
    filedOn: jakartaDateKey(tx.createdAt),
    isReRequest: tx.isReRequest,
  };
}

/** Bottom sheet: file a Perlu Perbaikan request again — the day it was made, Keterangan, what was spent, the receipt. */
function ReRequestSheet({
  source,
  balance,
  storeName,
  onClose,
  onDone,
}: {
  source: ReRequestable;
  balance: number;
  storeName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = jakartaTodayKey();
  const [requestDate, setRequestDate] = useState(source.filedOn);
  const [description, setDescription] = useState(pettyCashDescription(source.description));
  const [amount, setAmount] = useState(String(source.amount));
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount.replace(/[^0-9]/g, ''));
  const previewUrl = photo?.preview ?? source.imageUrl;

  // Free the object URL of a retaken / discarded photo.
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  async function submit() {
    setError(null);
    if (!requestDate) { setError('Isi tanggal request.'); return; }
    if (requestDate > today) { setError('Tanggal request tidak boleh di masa depan.'); return; }
    if (!description.trim()) { setError('Keterangan wajib diisi.'); return; }
    if (description.length > PETTY_CASH_REASON_MAX) {
      setError(`Keterangan maksimal ${PETTY_CASH_REASON_MAX} karakter (sekarang ${description.length}). Persingkat dulu.`);
      return;
    }
    if (!amountNum) { setError('Masukkan jumlah terpakai yang valid.'); return; }
    if (amountNum > balance) { setError(`Jumlah melebihi saldo yang tersedia saat ini (${idr(balance)}).`); return; }
    if (!previewUrl) { setError('Foto struk wajib ada.'); return; }

    setBusy(true);
    try {
      let imageUrl: string | undefined;
      let imageKey: string | undefined;
      if (photo) {
        if (photo.file.size > 5 * 1024 * 1024) throw new Error('Foto struk harus kurang dari 5 MB.');
        const form = new FormData();
        form.append('file', photo.file);
        form.append('storeName', storeName);
        const up = await fetch('/api/upload/petty-cash', { method: 'POST', body: form });
        const upBody = await up.json();
        if (!up.ok) throw new Error(upBody.error ?? 'Gagal mengunggah struk.');
        imageUrl = upBody.url;
        imageKey = upBody.key;
      }

      const res = await fetch('/api/employee/petty-cash/re-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalTxId: source.id,
          requestDate,
          description,
          actualAmount: amountNum,
          imageUrl,
          imageKey,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Gagal mengajukan ulang.');

      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal mengajukan ulang. Coba lagi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[92vh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        <SheetHeader className="border-b border-border px-4 py-3 pr-12">
          <SheetTitle className="text-base">Ajukan ulang ({RE_REQUEST_LABEL})</SheetTitle>
          <SheetDescription>
            {source.categoryName ?? 'Request petty cash'} · {monthLabel(source.month)}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 py-4">
          <div className="rounded-xl bg-orange-50 px-3 py-2.5 ring-1 ring-orange-200">
            <p className="text-[11px] font-bold text-orange-700">Perlu Perbaikan</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-orange-950">
              {source.financeComment ?? <span className="italic text-orange-700">Finance tidak menulis komentar.</span>}
            </p>
          </div>

          <Notice tone="info" title="Tanpa persetujuan OPS">
            Perbaiki Keterangan, jumlah, atau foto struk sesuai catatan Finance. Jumlah terpakai langsung dipotong dari
            saldo bulan ini dan dikirim ke Finance, ditandai {RE_REQUEST_LABEL}. Tanggal pengajuan (hari ini) tercatat otomatis.
          </Notice>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Tanggal request</label>
            <input
              type="date"
              value={requestDate}
              max={today}
              onChange={(e) => setRequestDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground focus:border-primary focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Tanggal request ini dibuat{requestDate ? ` — ${fmtRequestDate(requestDate)}` : ''}. Asalnya: {fmtRequestDate(source.filedOn)}.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Keterangan</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(pettyCashDescription(e.target.value))}
              rows={3}
              maxLength={PETTY_CASH_REASON_MAX}
              className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-base text-foreground focus:border-primary focus:outline-none"
            />
            <ReasonCounter value={description} />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Jumlah terpakai (Rp)</label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground">Rp</span>
              <input
                type="text"
                inputMode="numeric"
                value={amountNum ? amountNum.toLocaleString('id-ID') : ''}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="0"
                className="h-11 w-full rounded-xl border border-border bg-secondary/40 pl-10 pr-4 text-right text-base font-bold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <p className={cn('mt-1.5 text-right text-xs font-semibold', amountNum > balance ? 'text-rose-500' : 'text-muted-foreground')}>
              Saldo setelah dikirim: {idr(Math.max(0, balance - amountNum))}
              {amountNum > balance && ' · melebihi saldo'}
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Foto struk</p>
            <div className="flex items-center gap-3">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Foto struk" className="h-20 w-20 rounded-xl border border-border object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-border bg-secondary">
                  <ReceiptText className="h-6 w-6 text-muted-foreground/50" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  disabled={busy}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-card text-xs font-bold text-foreground disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" />
                  {photo ? 'Ambil ulang foto' : 'Ganti foto struk'}
                </button>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {photo ? 'Foto baru akan dikirim.' : 'Foto struk request sebelumnya dipakai kalau tidak diganti.'}
                </p>
              </div>
            </div>
          </div>

          {error && <Notice tone="error">{error}</Notice>}

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-xs font-bold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Kirim {RE_REQUEST_LABEL} ke Finance
          </button>
        </div>

        <DocumentScanner
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onCapture={(file) => {
            setCameraOpen(false);
            setPhoto({ file, preview: URL.createObjectURL(file) });
          }}
          title="Foto Struk"
        />
      </SheetContent>
    </Sheet>
  );
}

// ─── Request list: search · filter · sort, one compact row per request ──────

function RequestListControls({
  state,
  onChange,
  counts,
  months,
}: {
  state: RequestListState;
  onChange: (next: RequestListState) => void;
  /** Per chip, for the current search + month. */
  counts: Record<RequestFilter, number>;
  months: string[];
}) {
  const set = (patch: Partial<RequestListState>) => onChange({ ...state, ...patch });

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={state.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Cari keterangan, kategori, nominal, #nomor…"
          aria-label="Cari request"
          enterKeyHint="search"
          className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-10 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {state.query && (
          <button
            type="button"
            onClick={() => set({ query: '' })}
            aria-label="Hapus pencarian"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground active:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="tablist" aria-label="Filter status">
        {FILTER_ORDER.filter((f) => f === 'all' || counts[f] > 0 || state.filter === f).map((f) => {
          const active = state.filter === f;
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => set({ filter: f })}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card text-foreground active:bg-secondary',
              )}
            >
              {FILTER_LABEL[f]}
              <span className={cn('tabular-nums', active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                {counts[f]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex h-16 min-w-0 flex-col justify-center gap-1 rounded-xl border border-border bg-background px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            Periode
          </span>
          <select
            value={state.month}
            onChange={(e) => set({ month: e.target.value })}
            aria-label="Periode"
            className="w-full min-w-0 cursor-pointer bg-transparent text-sm font-semibold text-foreground focus:outline-none"
          >
            <option value="all">Semua bulan</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <PettyCashSortControl value={state.sort} onChange={(sort) => set({ sort })} />
      </div>
    </div>
  );
}

/**
 * One request, one compact line (what · when · state · amount). Tap it open for the receipt, the full
 * Keterangan, Finance's comment and whatever PIC 1 can do about it.
 */
function RequestRow({
  tx,
  isHolder,
  defaultOpen,
  confirming,
  uploading,
  onConfirm,
  onUploadReceipt,
  onViewImage,
  onReRequest,
}: {
  tx: TxRow;
  isHolder: boolean;
  defaultOpen: boolean;
  confirming: boolean;
  uploading: boolean;
  onConfirm: (tx: TxRow, actualAmount: number) => void;
  onUploadReceipt: (tx: TxRow, file: File) => void;
  onViewImage: (url: string) => void;
  onReRequest: (txId: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const group = requestGroup(tx);
  // A request nobody counts (Ditolak / Perlu Perbaikan) is struck through.
  const counted = group !== 'rejected' && group !== 'needs_fix';
  const note = requestNote(tx, isHolder);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors active:bg-secondary/60"
      >
        <span className={cn('mt-[7px] h-2 w-2 shrink-0 rounded-full', GROUP_DOT[group])} aria-hidden />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {tx.categoryName ?? tx.description}
            {tx.categoryName && <span className="font-normal text-muted-foreground"> · {tx.description}</span>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <span>{fmtDay(tx.createdAt)}</span>
            <span className={cn('rounded-full px-1.5 py-px text-[10px] font-bold ring-1', GROUP_PILL[group])}>
              {GROUP_LABEL[group]}
            </span>
            {tx.isReRequest && <ReRequestBadge className="rounded-full" />}
          </span>
        </span>

        <span
          className={cn(
            'shrink-0 text-[13px] font-bold tabular-nums',
            counted ? 'text-rose-500' : 'text-muted-foreground line-through',
          )}
        >
          −{idr(requestAmount(tx))}
        </span>
        <ChevronDown
          className={cn('mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-2.5 pb-3.5 pl-[34px] pr-3.5">
          <div className="flex items-start gap-3">
            {tx.imageUrl ? (
              <button
                type="button"
                onClick={() => onViewImage(tx.imageUrl!)}
                className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-border"
                aria-label="Lihat foto struk"
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

            <div className="min-w-0 flex-1 text-[11px] text-muted-foreground">
              <p className="whitespace-pre-wrap break-words text-[12px] text-foreground">{tx.description}</p>
              <p className="mt-1">
                #{tx.id} · diajukan {fmtDate(tx.createdAt)} · {monthLabel(tx.month)}
              </p>
              {tx.isReRequest && (
                <p className="text-violet-700">
                  {tx.requestDate ? `Request dibuat ${fmtRequestDate(tx.requestDate)}` : 'Re-request'}
                  {tx.reRequestOfId != null && ` · mengajukan ulang #${tx.reRequestOfId}`}
                </p>
              )}
              {tx.actualAmount != null && Number(tx.actualAmount) !== Number(tx.amount) && (
                <p>Diminta {idr(tx.amount)}</p>
              )}
              {note && (
                <p className={cn('mt-1 font-medium', tx.status === 'ops_rejected' && 'text-rose-600')}>{note}</p>
              )}
            </div>
          </div>

          {isHolder && needsActualAmount(tx) && (
            <ConfirmAmountAction
              tx={tx}
              confirming={confirming}
              onConfirm={onConfirm}
              uploading={uploading}
              onUploadReceipt={onUploadReceipt}
              onViewImage={onViewImage}
            />
          )}
          {isHolder && needsReceipt(tx) && !needsActualAmount(tx) && (
            <ReceiptAction tx={tx} uploading={uploading} onUpload={onUploadReceipt} />
          )}
          {/* Wrong or blurry photo already saved: PIC 1 can swap it until Finance has made a decision. */}
          {isHolder && tx.status === 'completed' && tx.imageUrl && tx.reviewOutcome === 'none' && (
            <ReceiptCapture replace uploading={uploading} onConfirm={(file) => onUploadReceipt(tx, file)} />
          )}

          <FinanceReviewNote tx={tx} isHolder={isHolder} onReRequest={onReRequest} />
        </div>
      )}
    </li>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EmployeePettyCashPage() {
  const { data: session } = useSession();
  const employeeType = session?.user?.employeeType;
  // PIC 1 holds the store's petty cash: request, confirm the actual amount,
  // upload receipts, refill. Everyone else (PIC 2, SA) only views the status.
  const isHolder = employeeType === 'pic_1';

  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [description, setDescription] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [uploadingTxId, setUploadingTxId] = useState<number | null>(null);
  const [confirmingTxId, setConfirmingTxId] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // The Perlu Perbaikan request PIC 1 is filing again.
  const [reRequesting, setReRequesting] = useState<ReRequestable | null>(null);
  // The request list's search / filter / sort.
  const [list, setList] = useState<RequestListState>(() => ({
    ...DEFAULT_LIST_STATE,
    month: jakartaYearMonth(Date.now()),
  }));

  function startReRequest(txId: number) {
    const tx = data?.transactions.find((t) => t.id === txId);
    if (tx?.canReRequest) setReRequesting(toReRequestable(tx));
  }

  // A shortcut from the banners: show only that kind of request, and scroll to the list.
  function showOnly(filter: RequestFilter) {
    setList({ ...DEFAULT_LIST_STATE, filter });
    requestAnimationFrame(() =>
      document.getElementById('daftar-request')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  const [refillRequest, setRefillRequest] = useState<RefillRequestRow | null>(null);
  const [lastBank, setLastBank] = useState<BankDetails | null>(null);
  const [bankLoaded, setBankLoaded] = useState(false);
  const [requestingRefill, setRequestingRefill] = useState(false);
  const [uploadingProofKind, setUploadingProofKind] = useState<RefillProofKind | null>(null);

  const categories = data?.categories ?? [];
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;

  // Picking a category pre-fills Keterangan with its default reason — unless
  // the PIC already typed their own text (anything other than the previous
  // category's default), which is kept.
  function selectCategory(next: PettyCashCategoryOption) {
    const untouched =
      !description.trim() || description === pettyCashDefaultDescription(selectedCategory?.defaultReason);
    setCategoryId(next.id);
    if (untouched) {
      setDescription(next.requiresCustomReason ? '' : pettyCashDefaultDescription(next.defaultReason));
    }
    setFormError(null);
  }

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
      if (body.success) {
        setRefillRequest(body.request ?? null);
        setLastBank(body.lastBankDetails ?? null);
      }
    } catch {
      // Non-critical — the request button just won't show a status yet.
    } finally {
      // The form seeds its fields from lastBank once at mount, so it must
      // not render before this settles (see the RefillRequestCard gate below).
      setBankLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadRefillStatus();
  }, [loadRefillStatus]);

  async function handleRequestRefill(bank: BankDetails) {
    setRequestingRefill(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/employee/petty-cash/refill-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bank),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Gagal mengajukan Refill.');
      setRefillRequest(body.request);
      setLastBank(bank);
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

    if (!selectedCategory) {
      setFormError('Pilih kategori terlebih dahulu.');
      return;
    }

    if (!amt || amt <= 0) {
      setFormError('Masukkan jumlah yang valid.');
      return;
    }

    if (!description.trim()) {
      setFormError(
        selectedCategory.requiresCustomReason
          ? `Tulis keterangan untuk kategori ${selectedCategory.name}.`
          : 'Keterangan wajib diisi.',
      );
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
          categoryId: selectedCategory.id,
          description: description.trim(),
        }),
      });

      const body = await res.json();

      if (!res.ok || !body.success) {
        setFormError(body.error ?? 'Request gagal.');
        return;
      }

      setAmount('');
      setCategoryId(null);
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

  const transactions = useMemo(() => data?.transactions ?? [], [data]);

  // The counters and the balance are about the petty cash period in use; the list below covers every month.
  const periodTxs = useMemo(
    () => transactions.filter((tx) => tx.month === data?.month),
    [transactions, data?.month],
  );
  const needsActualAmountTxs = useMemo(() => periodTxs.filter(needsActualAmount), [periodTxs]);
  const needsReceiptTxs = useMemo(() => periodTxs.filter(needsReceipt), [periodTxs]);

  const summary = useMemo(() => {
    return {
      pendingOps: periodTxs.filter((tx) => tx.status === 'pending_ops').length,
      waitingConfirm: needsActualAmountTxs.length,
      waitingReceipt: needsReceiptTxs.length,
      completed: periodTxs.filter((tx) => tx.status === 'completed').length,
      pendingAmount: periodTxs
        .filter((tx) => tx.status === 'pending_ops')
        .reduce((sum, tx) => sum + Number(tx.amount), 0),
      // OPS approved but the PIC hasn't confirmed the actual amount yet — this
      // is still just the requested estimate, and still not deducted.
      awaitingConfirmAmount: needsActualAmountTxs.reduce((sum, tx) => sum + Number(tx.amount), 0),
      // A request Finance sent back or turned down doesn't count as used until it is accepted again.
      approvedSpend: periodTxs
        .filter((tx) => tx.status === 'completed' && tx.reviewOutcome !== 'needs_fix' && tx.reviewOutcome !== 'rejected')
        .reduce((sum, tx) => sum + Number(tx.actualAmount ?? tx.amount), 0),
    };
  }, [periodTxs, needsActualAmountTxs, needsReceiptTxs]);

  // The request list: every request once. Chip counts follow the search + month, not the chip itself.
  const allCounts = useMemo(() => countByFilter(transactions), [transactions]);
  const chipCounts = useMemo(() => countByFilter(filterExceptChip(transactions, list)), [transactions, list]);
  const visibleTxs = useMemo(
    () => sortRequests(filterRequests(transactions, list), list.sort),
    [transactions, list],
  );
  const currentMonth = data?.currentMonth ?? jakartaYearMonth(Date.now());
  const months = useMemo(
    () => listMonths([...transactions, { month: currentMonth }]),
    [transactions, currentMonth],
  );
  const reRequestableCount = useMemo(() => transactions.filter((tx) => tx.canReRequest).length, [transactions]);

  return (
    <div className="mx-auto w-full max-w-md">
      {lightboxSrc && (
        <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}

      {reRequesting && data && (
        <ReRequestSheet
          key={reRequesting.id}
          source={reRequesting}
          balance={balance}
          storeName={data.storeName}
          onClose={() => setReRequesting(null)}
          onDone={() => {
            setSuccessMessage(`${RE_REQUEST_LABEL} dikirim ke Finance — jumlah terpakai sudah dipotong dari saldo.`);
            setTimeout(() => setSuccessMessage(null), 5000);
            void load({ silent: true });
          }}
        />
      )}

      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Request Petty Cash
        </p>
        <p className="mt-0.5 text-base font-bold leading-tight text-foreground">
          {data?.storeName ?? '…'}
        </p>
      </div>

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
            currentMonth={data?.currentMonth}
            totalApprovedSpend={summary.approvedSpend}
            pendingAmount={summary.pendingAmount}
            awaitingConfirmAmount={summary.awaitingConfirmAmount}
            isHolder={isHolder}
          />
        )}

        {!loading && !loadError && bankLoaded && (isHolder || refillRequest) && (
          <RefillRequestCard
            request={refillRequest}
            isHolder={isHolder}
            requesting={requestingRefill}
            lastBank={lastBank}
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

        {!loading && !loadError && isHolder && (allCounts.action > 0 || reRequestableCount > 0) && (
          <section className="space-y-2 px-4">
            {allCounts.action > 0 && (
              <button
                type="button"
                onClick={() => showOnly('action')}
                className="flex w-full items-center justify-between gap-3 rounded-xl bg-indigo-50 px-3.5 py-2.5 text-left text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200 active:scale-[0.99]"
              >
                <span>{allCounts.action} request menunggu tindakanmu (konfirmasi jumlah / unggah struk)</span>
                <span className="shrink-0 text-indigo-600">Lihat ›</span>
              </button>
            )}
            {reRequestableCount > 0 && (
              <button
                type="button"
                onClick={() => showOnly('needs_fix')}
                className="flex w-full items-center justify-between gap-3 rounded-xl bg-orange-50 px-3.5 py-2.5 text-left text-xs font-semibold text-orange-800 ring-1 ring-orange-200 active:scale-[0.99]"
              >
                <span>{reRequestableCount} request Perlu Perbaikan — ajukan ulang lewat {RE_REQUEST_LABEL}</span>
                <span className="shrink-0 text-orange-600">Lihat ›</span>
              </button>
            )}
          </section>
        )}

        {!loading && !loadError && !isHolder && (
          <section className="px-4">
            <Notice tone="neutral" title="Petty cash dikelola oleh PIC 1">
              Request, konfirmasi jumlah terpakai, foto struk, dan Refill hanya bisa dilakukan
              PIC 1. Kamu bisa melihat saldo dan status Request di sini.
            </Notice>
          </section>
        )}

        {!loading && !loadError && isHolder && (
          <section className="px-4">
            <SectionLabel>Request petty cash baru</SectionLabel>

            <form onSubmit={handleSubmit} className="space-y-4">
              <Notice tone="info" title="Foto struk belum diperlukan sekarang.">
                Kirim Request terlebih dahulu. Setelah disetujui OPS, request-nya muncul di Daftar
                request dengan tanda &quot;Perlu tindakan&quot; — buka untuk mengunggah struk.
              </Notice>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Kategori
                </label>

                {categories.length === 0 ? (
                  <Notice tone="warning">
                    Kategori petty cash belum diatur. Hubungi OPS.
                  </Notice>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {categories.map((c) => {
                      const active = c.id === categoryId;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => selectCategory(c)}
                          aria-pressed={active}
                          className={cn(
                            'rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background text-foreground active:bg-secondary',
                          )}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

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

              {selectedCategory && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    Keterangan{selectedCategory.requiresCustomReason && ' (wajib diisi)'}
                  </label>

                  <textarea
                    value={description}
                    onChange={(e) => setDescription(pettyCashDescription(e.target.value))}
                    rows={3}
                    maxLength={PETTY_CASH_REASON_MAX}
                    placeholder={
                      selectedCategory.requiresCustomReason
                        ? 'Jelaskan untuk apa request ini, misal: perbaikan engsel pintu gudang…'
                        : 'Keterangan request…'
                    }
                    className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                  />
                  <ReasonCounter value={description} />

                  {!selectedCategory.requiresCustomReason && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Terisi otomatis dari kategori {selectedCategory.name}. Boleh diubah atau
                      ditambah detail.
                    </p>
                  )}
                </div>
              )}

              {formError && <Notice tone="error">{formError}</Notice>}

              <button
                type="submit"
                disabled={submitting || balance <= 0 || categories.length === 0}
                className={cn(
                  'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors',
                  submitting || balance <= 0 || categories.length === 0
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

        {!loading && !loadError && transactions.length > 0 && (
          <section id="daftar-request" className="scroll-mt-4 px-4">
            <SectionLabel
              meta={
                isNarrowed(list)
                  ? `${visibleTxs.length} dari ${transactions.length}`
                  : `${transactions.length} request`
              }
            >
              Daftar request
            </SectionLabel>

            <RequestListControls state={list} onChange={setList} counts={chipCounts} months={months} />

            {visibleTxs.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-dashed border-border px-4 py-7 text-center">
                <p className="text-sm font-semibold text-foreground">Tidak ada request yang cocok</p>
                <button
                  type="button"
                  onClick={() => setList(DEFAULT_LIST_STATE)}
                  className="mt-2 text-xs font-bold text-primary"
                >
                  Hapus pencarian &amp; filter
                </button>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                {visibleTxs.map((tx) => (
                  <RequestRow
                    // A new filter starts the rows closed again — except where the row is what the filter is for.
                    key={`${list.filter}-${tx.id}`}
                    tx={tx}
                    isHolder={isHolder}
                    defaultOpen={list.filter === 'action' || list.filter === 'needs_fix'}
                    confirming={confirmingTxId === tx.id}
                    uploading={uploadingTxId === tx.id}
                    onConfirm={handleConfirmActualAmount}
                    onUploadReceipt={handleUploadReceipt}
                    onViewImage={setLightboxSrc}
                    onReRequest={startReRequest}
                  />
                ))}
              </ul>
            )}

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
                title="Belum ada Request Petty Cash"
                description={isHolder ? 'Isi formulir di atas untuk mengirim Request pertamamu ke OPS.' : undefined}
                className="py-8"
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
