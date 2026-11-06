// app/employee/pettycash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  Banknote,
  CalendarDays,
  Camera,
  Check,
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
  PETTY_CASH_CATEGORY_NOTE,
  PETTY_CASH_REASON_MAX,
  pettyCashDescription,
  type PettyCashCategoryOption,
} from '@/lib/petty-cash-categories';
import { RE_REQUEST_LABEL, fmtRequestDate, type ReRequestable } from '@/lib/petty-cash-re-request';
import { addMonths, periodLabel, periodMonthName, type DeadlineStatus } from '@/lib/petty-cash-period';
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
import { EmptyState, Notice, SectionLabel, Segmented, SkeletonBlocks } from '@/components/employee/ui';
import CameraCapture from '@/components/shared/CameraCapture';
import DocumentScanner from '@/components/shared/DocumentScanner';

// ─── Types ────────────────────────────────────────────────────────────────────

type PettyCashStatus = 'pending_ops' | 'ops_approved' | 'completed' | 'ops_rejected';

type TxRow = {
  id: number;
  amount: string;
  actualAmount: string | null;
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  status: PettyCashStatus | string;
  imageUrl: string | null;
  /** What may be done about the receipt photo: replace (not finished yet), add the first one, or nothing (locked). */
  receiptAction: 'replace' | 'add' | 'locked' | 'none';
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
  /** The period a Re-request of it would be counted in (always after its own) and what that period has left. */
  reRequestTarget: { month: string; balance: number } | null;
};

type PageData = {
  storeName: string;
  /**
   * Set while the refill of an earlier period is on its way (or was turned down): that period is closed and new
   * requests are counted in the one in use (`month`). Nothing is blocked.
   */
  closedPeriod?: { month: string; refillState: string } | null;
  /**
   * The Refill of the period before the one in use that has not been received yet. `balance` already leaves it
   * out — it only turns up in the balance once PIC 1 has uploaded the proof photos.
   */
  refillPending?: { month: string; amount: number } | null;
  /** What can be spent: the period's balance minus `refillPending`. */
  balance: string;
  openingBalance?: string;
  closingBalance?: string | null;
  periodStatus?: 'open' | 'closed' | 'upcoming' | string;
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

function balanceHealth(balance: number) {
  if (balance <= 0) return { label: 'Habis', textClass: 'text-rose-600' };
  if (balance < 250_000) return { label: 'Kritis', textClass: 'text-rose-600' };
  if (balance < 500_000) return { label: 'Mulai Menipis', textClass: 'text-amber-600' };
  return { label: 'Aman', textClass: 'text-emerald-600' };
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

/** The banner under the balance card once a period's refill has been sent (the period itself is closed). */
function closedPeriodText(closed: { month: string; refillState: string }, usageMonth: string) {
  const closedName = periodLabel(closed.month);
  const usageName = periodLabel(usageMonth);

  if (closed.refillState === 'rejected') {
    return `Refill ${closedName} ditolak OPS, tapi periodenya tetap tertutup — ajukan Refill lagi di tab Refill. Request baru masuk ke periode ${usageName}.`;
  }

  const where =
    closed.refillState === 'pending'
      ? 'menunggu persetujuan OPS'
      : closed.refillState === 'awaiting_finance'
        ? 'menunggu Finance memprosesnya'
        : 'sudah diproses Finance — tinggal foto bukti penerimaan';

  return `Refill ${closedName} ${where}. Kamu tetap bisa membuat request — request baru dihitung di periode ${usageName}.`;
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

/** The one line under an opened request: OPS's reason when it turned the request down (the state pill says the rest). */
function requestNote(tx: TxRow): string | null {
  if (tx.status === 'ops_rejected' && tx.rejectionReason) return `Alasan: ${tx.rejectionReason}`;
  return null;
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
  refillPending,
  month,
  isHolder,
}: {
  balance: number;
  storeName: string;
  totalApprovedSpend: number;
  pendingAmount: number;
  awaitingConfirmAmount: number;
  /** A Refill not received yet — the balance rises by this once the proof photos are in. */
  refillPending: { month: string; amount: number } | null;
  /** The petty cash period in use (YYYY-MM). */
  month: string;
  isHolder: boolean;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));
  const health = balanceHealth(balance);

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

        </div>
        <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wide', health.textClass)}>
          {health.label}
        </span>
      </div>

      <p className={cn('text-4xl font-bold tracking-tight', balanceColor(balance))}>
        {idr(balance)}
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

      {refillPending && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-indigo-700">
            Refill {periodLabel(refillPending.month)} {idr(refillPending.amount)} belum diterima
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            Saldo bertambah setelah foto bukti Refill diunggah.
          </p>
        </div>
      )}

      {pendingAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-sky-700">
            Request menunggu OPS: {idr(pendingAmount)}
          </p>
        </div>
      )}

      {awaitingConfirmAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-indigo-700">
            OPS sudah menyetujui, menunggu konfirmasi {isHolder ? 'kamu' : 'PIC 1'}: {idr(awaitingConfirmAmount)}
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
  /** The period (YYYY-MM) this Refill settles — it closed when the Refill was sent. */
  yearMonth: string;
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

// ─── Refill: PIC 1 sends it, everyone at the store sees where it stands ─────────
// Sending a Refill closes the period it covers (what was used is fixed — that is what Finance transfers) and the
// next period opens at once, so requests carry on while the Refill goes OPS → Finance → PIC 1's receipt photos.
// It is due before the 15th of the period's month; later is still accepted but marked "Terlambat"
// (lib/petty-cash-period.ts).

type RefillOverviewData = {
  /** The period new requests are counted in right now. */
  usageMonth: string;
  /** What a Refill sent now would cover; null while another Refill is on its way. */
  settle: { month: string; balance: number; refill: number; closed: boolean } | null;
  deadline: DeadlineStatus | null;
  canRequest: boolean;
  blockedReason: string | null;
};

const REFILL_STEPS = ['Diajukan', 'OPS', 'Finance', 'Foto bukti'] as const;

/** The step a Refill is waiting on (0-based); 4 = all done. A rejected one stops at OPS. */
function refillStep(request: RefillRequestRow): number {
  if (request.balanceAfter) return REFILL_STEPS.length;
  if (request.status === 'rejected' || request.status === 'pending') return 1;
  return request.financeVerifiedAt ? 3 : 2;
}

/** A Refill still on its way: not turned down and not received yet. */
const isLiveRefill = (request: RefillRequestRow): boolean => request.status !== 'rejected' && !request.balanceAfter;

function RefillStepper({ request }: { request: RefillRequestRow }) {
  const current = refillStep(request);
  const failed = request.status === 'rejected';

  return (
    <ol className="mt-3 flex items-start" aria-label="Tahap Refill">
      {REFILL_STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center gap-1.5">
            {i > 0 && (
              <span
                aria-hidden
                className={cn('absolute right-1/2 top-3 h-0.5 w-full -translate-y-1/2', i <= current ? 'bg-emerald-400' : 'bg-border')}
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-card',
                done && 'bg-emerald-500 text-white',
                active && !failed && 'bg-indigo-600 text-white',
                active && failed && 'bg-rose-500 text-white',
                !done && !active && 'bg-secondary text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3 w-3" /> : active && failed ? <X className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={cn(
                'text-[10px] font-semibold',
                active ? (failed ? 'text-rose-600' : 'text-foreground') : done ? 'text-emerald-700' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The 15th line of the new-Refill card: how long PIC 1 has, or that it is late (still allowed). */
function refillDeadlineLine(d: DeadlineStatus, periodMonth: string): { text: string; tone: 'ok' | 'soon' | 'late' } | null {
  if (!d.applies) return null;
  const day = `${Number(d.deadline.slice(8))} ${periodMonthName(periodMonth)}`;

  if (d.late) {
    return {
      tone: 'late',
      text: `Batas kirim Refill ${periodLabel(periodMonth)} (${day}) sudah lewat. Tetap bisa diajukan, tapi ditandai Terlambat untuk OPS dan Finance.`,
    };
  }
  if (d.daysLeft === 0) return { tone: 'soon', text: `Hari ini batas terakhir kirim Refill (${day}).` };
  if (d.daysLeft <= 3) return { tone: 'soon', text: `Tinggal ${d.daysLeft} hari — kirim Refill sebelum ${day}.` };
  return { tone: 'ok', text: `Kirim Refill sebelum ${day} (${d.daysLeft} hari lagi).` };
}

const DEADLINE_TONE = {
  ok: 'bg-secondary/60 text-muted-foreground',
  soon: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  late: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
} as const;

function RefillRequestCard({
  request,
  overview,
  isHolder,
  requesting,
  lastBank,
  onRequest,
  uploadingKind,
  onUploadProof,
  onViewImage,
}: {
  /** The Refill on its way, else the latest one; null = the store never sent one. */
  request: RefillRequestRow | null;
  overview: RefillOverviewData | null;
  isHolder: boolean;
  requesting: boolean;
  lastBank: BankDetails | null;
  onRequest: (bank: BankDetails) => void;
  uploadingKind: RefillProofKind | null;
  onUploadProof: (kind: RefillProofKind, file: File) => void;
  onViewImage: (url: string) => void;
}) {
  // ── A Refill is on its way: where it stands, and what is left for PIC 1 ──────
  if (request && isLiveRefill(request)) {
    const waitingOps = request.status === 'pending';
    const waitingFinance = request.status === 'approved' && !request.financeVerifiedAt;
    const photoUrls: Record<RefillProofKind, string | null> = {
      drawer: request.drawerPhotoUrl,
      signature: request.signaturePhotoUrl,
    };

    return (
      <div className="mx-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Refill periode</p>
            <p className="text-sm font-bold text-foreground">{periodLabel(request.yearMonth)}</p>
          </div>
          {request.transferAmount != null && (
            <p className="shrink-0 text-right text-[11px] text-muted-foreground">
              Ditransfer
              <span className="block text-sm font-bold tabular-nums text-foreground">
                Rp {Number(request.transferAmount).toLocaleString('id-ID')}
              </span>
            </p>
          )}
        </div>

        <RefillStepper request={request} />

        <div className="mt-4 flex items-start gap-2">
          {waitingOps || waitingFinance ? (
            <Clock3 className="mt-px h-4 w-4 shrink-0 text-sky-600" />
          ) : (
            <Banknote className="mt-px h-4 w-4 shrink-0 text-indigo-600" />
          )}
          <p className={cn('text-xs font-bold', waitingOps || waitingFinance ? 'text-sky-700' : 'text-indigo-700')}>
            {waitingOps
              ? 'Menunggu persetujuan OPS'
              : waitingFinance
                ? 'OPS sudah menyetujui — menunggu Finance memprosesnya'
                : isHolder
                  ? 'Finance sudah memproses — ambil foto bukti setelah menerima uangnya'
                  : 'Finance sudah memproses — menunggu PIC 1 mengunggah foto bukti'}
          </p>
        </div>

        <RefillBankLine request={request} />

        {request.rejectedCount > 0 && (
          <p className="mt-2 text-[11px] font-medium text-rose-600">
            {request.rejectedCount} request ditolak Finance (Rp {Number(request.rejectedAmount ?? 0).toLocaleString('id-ID')})
            tidak ditransfer
          </p>
        )}

        {request.financeVerifiedAt && (
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
        )}

        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-secondary/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <CalendarDays className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            Periode {periodLabel(request.yearMonth)} sudah ditutup. Request baru tetap bisa dibuat — dihitung di periode{' '}
            {periodLabel(overview?.usageMonth ?? addMonths(request.yearMonth, 1))}. Saldo baru bertambah setelah Refill diterima
            (foto bukti diunggah).
          </span>
        </p>
      </div>
    );
  }

  // ── Nothing on its way ───────────────────────────────────────────────────────
  const settle = overview?.settle ?? null;
  const received = Boolean(request?.balanceAfter);

  if (!isHolder) {
    return (
      <div className="mx-4 rounded-2xl border border-dashed border-border bg-card p-4 text-center">
        <p className="text-xs font-bold text-foreground">Tidak ada Refill yang sedang berjalan</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {received && request
            ? `Refill ${periodLabel(request.yearMonth)} sudah diterima toko. Refill diajukan oleh PIC 1.`
            : 'Refill diajukan oleh PIC 1. Statusnya akan tampil di sini.'}
        </p>
      </div>
    );
  }

  const deadline = settle && overview?.deadline ? refillDeadlineLine(overview.deadline, settle.month) : null;
  const nextMonth = settle ? addMonths(settle.month, 1) : null;

  return (
    <div className="mx-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <Banknote className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-foreground">
            {settle ? `Refill periode ${periodLabel(settle.month)}` : 'Ajukan Refill'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Refill mengembalikan saldo ke Rp 1.000.000 sebesar yang sudah terpakai.
          </p>
        </div>
      </div>

      {request?.status === 'rejected' && (
        <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">
          Refill terakhir ditolak OPS{request.rejectionReason ? `: ${request.rejectionReason}` : '.'} Ajukan lagi dengan data yang benar.
        </p>
      )}

      {received && request && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">
          Refill {periodLabel(request.yearMonth)} sudah diterima toko.
        </p>
      )}

      {settle && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-secondary/60 px-3 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground">Sisa saldo</p>
            <p className="text-sm font-bold tabular-nums text-foreground">{idr(settle.balance)}</p>
          </div>
          <div className="rounded-xl bg-indigo-50 px-3 py-2 ring-1 ring-indigo-200">
            <p className="text-[10px] font-semibold text-indigo-600">Refill (yang terpakai)</p>
            <p className="text-sm font-bold tabular-nums text-indigo-700">{idr(settle.refill)}</p>
          </div>
        </div>
      )}

      {deadline && (
        <p className={cn('mt-3 flex items-start gap-1.5 rounded-xl px-3 py-2 text-[11px] font-medium leading-relaxed', DEADLINE_TONE[deadline.tone])}>
          <Clock3 className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>{deadline.text}</span>
        </p>
      )}

      {overview && !overview.canRequest ? (
        <p className="mt-3 rounded-xl bg-secondary/60 px-3 py-2 text-[11px] text-muted-foreground">
          {overview.blockedReason ?? 'Refill belum bisa diajukan.'}
        </p>
      ) : (
        <>
          {settle && nextMonth && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <CalendarDays className="mt-px h-3 w-3 shrink-0" aria-hidden />
              <span>
                {settle.closed
                  ? `Periode ${periodLabel(settle.month)} sudah ditutup.`
                  : `Begitu dikirim, periode ${periodLabel(settle.month)} ditutup dan periode ${periodLabel(nextMonth)} dibuka.`}{' '}
                Kamu tetap bisa membuat request — masuk ke periode {periodLabel(nextMonth)}, walau Refill belum diproses.
                Saldo tidak langsung kembali ke Rp 1.000.000; saldo baru bertambah setelah Refill diterima.
              </span>
            </p>
          )}
          <RefillBankForm lastBank={lastBank} requesting={requesting} onSubmit={onRequest} />
        </>
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
      <p className="mt-1 text-[11px] font-medium text-indigo-800">Diminta {idr(tx.amount)}</p>

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
          Foto struk
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
        Diterima Finance
      </p>
    );
  }

  if (outcome === 'needs_fix') {
    return (
      <div className="rounded-xl bg-orange-50 px-3 py-2.5 ring-1 ring-orange-200">
        <p className="text-[11px] font-bold text-orange-700">Perlu Perbaikan</p>
        {comment && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-orange-950">{comment}</p>
        )}
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
      {comment && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-rose-900">{comment}</p>
      )}
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

/** What the sheet starts from: the request, its category and where the re-request would be counted. */
type ReRequestSource = ReRequestable & {
  categoryId: number | null;
  /** The period the Re-request is counted in (after the original's) and what that period has left. */
  target: { month: string; balance: number } | null;
};

function toReRequestable(tx: TxRow): ReRequestSource {
  return {
    categoryId: tx.categoryId,
    target: tx.reRequestTarget,
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
  categories,
  balance,
  storeName,
  onClose,
  onDone,
}: {
  source: ReRequestSource;
  /** The categories PIC 1 can pick today — the original's may have been hidden since. */
  categories: PettyCashCategoryOption[];
  /** The period in use — a fallback when the sheet doesn't know the target period's balance. */
  balance: number;
  storeName: string;
  onClose: () => void;
  onDone: (periodMonth: string | null) => void;
}) {
  const today = jakartaTodayKey();
  // The Re-request is counted in a later period than the original (never one already closed), and is cut from
  // THAT period's balance — not the one shown on the page.
  const available = source.target?.balance ?? balance;
  // Starts on the original's category (by id, else by name); empty when it is no longer on offer, so PIC 1 picks.
  const [categoryId, setCategoryId] = useState<number | null>(
    () =>
      (categories.find((c) => c.id === source.categoryId) ??
        categories.find((c) => c.name.trim().toUpperCase() === (source.categoryName ?? '').trim().toUpperCase()))?.id ??
      null,
  );
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;
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
    if (!selectedCategory) { setError('Pilih kategori petty cash.'); return; }
    if (!requestDate) { setError('Isi tanggal request.'); return; }
    if (requestDate > today) { setError('Tanggal request tidak boleh di masa depan.'); return; }
    if (!description.trim()) { setError('Keterangan wajib diisi.'); return; }
    if (description.length > PETTY_CASH_REASON_MAX) {
      setError(`Keterangan maksimal ${PETTY_CASH_REASON_MAX} karakter (sekarang ${description.length}). Persingkat dulu.`);
      return;
    }
    if (!amountNum) { setError('Masukkan jumlah terpakai yang valid.'); return; }
    if (amountNum > available) {
      setError(`Jumlah melebihi saldo periode ${source.target ? periodLabel(source.target.month) : 'ini'} (${idr(available)}).`);
      return;
    }
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
          categoryId: selectedCategory.id,
          requestDate,
          description,
          actualAmount: amountNum,
          imageUrl,
          imageKey,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Gagal mengajukan ulang.');

      onDone(typeof body.periodMonth === 'string' ? body.periodMonth : null);
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
            {source.financeComment && (
              <p className="mt-1 whitespace-pre-wrap break-words text-[12px] text-orange-950">{source.financeComment}</p>
            )}
          </div>

          {source.target && (
            <div className="rounded-xl bg-violet-50 px-3 py-2.5 ring-1 ring-violet-200">
              <p className="text-[11px] font-bold text-violet-700">
                Dihitung di periode {periodLabel(source.target.month)}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-violet-900">
                Finance sudah memeriksa periode {periodLabel(source.month)}, jadi {RE_REQUEST_LABEL} baru dinilai di
                pemeriksaan periode berikutnya. Jumlah terpakai dipotong dari saldo periode itu.
              </p>
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Kategori</label>
            {categories.length === 0 ? (
              <Notice tone="warning">Kategori petty cash belum diatur. Hubungi OPS.</Notice>
            ) : (
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const active = c.id === categoryId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setCategoryId(c.id); setError(null); }}
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
            {!selectedCategory && source.categoryName && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Kategori sebelumnya ({source.categoryName}) sudah tidak dipakai — pilih kategori yang baru.
              </p>
            )}
            {selectedCategory?.definition && (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{selectedCategory.definition}</p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Tanggal request</label>
            <input
              type="date"
              value={requestDate}
              max={today}
              onChange={(e) => setRequestDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3.5 text-base text-foreground focus:border-primary focus:outline-none"
            />
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
            <p className={cn('mt-1.5 text-right text-xs font-semibold', amountNum > available ? 'text-rose-500' : 'text-muted-foreground')}>
              Saldo {source.target ? `periode ${periodMonthName(source.target.month)} ` : ''}setelah dikirim:{' '}
              {idr(Math.max(0, available - amountNum))}
              {amountNum > available && ' · melebihi saldo'}
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
  const note = requestNote(tx);

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
                #{tx.id} · diajukan {fmtDate(tx.createdAt)} · periode {monthLabel(tx.month)}
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
                <p className="mt-1 font-medium text-rose-600">{note}</p>
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
          {/* The photo can be swapped only until the request is Selesai (the confirm form above). Once it is
              finished it is simply locked: no button, no message. A Re-request is the way to change it. */}

          <FinanceReviewNote tx={tx} isHolder={isHolder} onReRequest={onReRequest} />
        </div>
      )}
    </li>
  );
}

// ─── "!" help: what each category means ─────────────────────────────────────
// Kategori · Pengertian · Contoh Pengeluaran, straight from the category list
// IT keeps — so PIC 1 picks the right one without a preset Keterangan.

function CategoryHelpSheet({
  categories,
  onClose,
}: {
  categories: PettyCashCategoryOption[];
  onClose: () => void;
}) {
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[88vh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        <SheetHeader className="border-b border-border px-4 py-3 pr-12">
          <SheetTitle className="text-base">Kategori Pengeluaran</SheetTitle>
          <SheetDescription>Pilih kategori yang paling sesuai untuk setiap request.</SheetDescription>
        </SheetHeader>

        <ol className="space-y-3 px-4 py-4">
          {categories.map((c, i) => (
            <li key={c.id} className="rounded-2xl border border-border bg-card p-3.5">
              <div className="flex items-start gap-2.5">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
                  {i + 1}
                </span>
                <p className="min-w-0 text-sm font-bold leading-snug text-foreground">{c.name}</p>
              </div>

              {c.definition && (
                <div className="mt-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pengertian</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-foreground">{c.definition}</p>
                </div>
              )}

              {c.examples && (
                <div className="mt-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Contoh Pengeluaran
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{c.examples}</p>
                </div>
              )}
            </li>
          ))}
        </ol>

        <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Catatan: </span>
          {PETTY_CASH_CATEGORY_NOTE}
        </p>
      </SheetContent>
    </Sheet>
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
  // Two tabs so PIC 1 can focus on one thing at a time; the "!" button opens the category guide.
  const [tab, setTab] = useState<'request' | 'refill'>('request');
  const [helpOpen, setHelpOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [uploadingTxId, setUploadingTxId] = useState<number | null>(null);
  const [confirmingTxId, setConfirmingTxId] = useState<number | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // The Perlu Perbaikan request PIC 1 is filing again.
  const [reRequesting, setReRequesting] = useState<ReRequestSource | null>(null);
  // The request list's search / filter / sort.
  const [list, setList] = useState<RequestListState>(() => ({
    ...DEFAULT_LIST_STATE,
    month: jakartaYearMonth(Date.now()),
  }));

  // The list starts on the period in use — after a Refill that is the NEXT period, not the calendar month, and a
  // request filed a moment ago must not be hidden by the default filter. Only the first load decides; after that the
  // month picker is PIC 1's.
  const monthSeeded = useRef(false);

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
  const [refillOverview, setRefillOverview] = useState<RefillOverviewData | null>(null);
  const [lastBank, setLastBank] = useState<BankDetails | null>(null);
  const [bankLoaded, setBankLoaded] = useState(false);
  const [requestingRefill, setRequestingRefill] = useState(false);
  const [uploadingProofKind, setUploadingProofKind] = useState<RefillProofKind | null>(null);

  const categories = data?.categories ?? [];
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;

  // Picking a category only sets the category — Keterangan is always the PIC's own words.
  function selectCategory(next: PettyCashCategoryOption) {
    setCategoryId(next.id);
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
        if (!monthSeeded.current && typeof body.month === 'string') {
          monthSeeded.current = true;
          setList((l) => ({ ...l, month: body.month }));
        }
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
        setRefillOverview(body.overview ?? null);
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
      const sentFor: string = body.periodMonth ?? body.request?.yearMonth;
      const next: string | undefined = body.nextMonth ?? (sentFor ? addMonths(sentFor, 1) : undefined);
      setSuccessMessage(
        sentFor && next
          ? `Refill periode ${periodLabel(sentFor)} diajukan${body.late ? ' (terlambat)' : ''} — menunggu OPS. Periode ditutup; request baru dihitung di periode ${periodLabel(next)}.`
          : 'Refill diajukan — akan ditinjau oleh OPS.',
      );
      // Sending the Refill closed its period and opened the next: the balance, banner and list all change.
      void load({ silent: true });
      void loadRefillStatus();
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
      // With both photos in the Refill is received: the banner and what a next Refill covers change.
      void loadRefillStatus();
      void load({ silent: true });
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

  const summary = useMemo(() => {
    return {
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
  }, [periodTxs, needsActualAmountTxs]);

  // The request list: every request once. Chip counts follow the search + month, not the chip itself.
  const allCounts = useMemo(() => countByFilter(transactions), [transactions]);
  const chipCounts = useMemo(() => countByFilter(filterExceptChip(transactions, list)), [transactions, list]);
  const visibleTxs = useMemo(
    () => sortRequests(filterRequests(transactions, list), list.sort),
    [transactions, list],
  );
  const currentMonth = data?.currentMonth ?? jakartaYearMonth(Date.now());
  const months = useMemo(
    () => listMonths([...transactions, { month: currentMonth }, ...(data?.month ? [{ month: data.month }] : [])]),
    [transactions, currentMonth, data?.month],
  );
  // Finance has sent the cash: PIC 1 still has the proof photos to take.
  const refillNeedsAction =
    isHolder &&
    refillRequest?.status === 'approved' &&
    Boolean(refillRequest.financeVerifiedAt) &&
    !refillRequest.balanceAfter;
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
          categories={categories}
          balance={balance}
          storeName={data.storeName}
          onClose={() => setReRequesting(null)}
          onDone={(periodMonth) => {
            setSuccessMessage(
              `${RE_REQUEST_LABEL} dikirim ke Finance — dihitung di periode ${periodLabel(periodMonth ?? reRequesting.target?.month ?? data.month)}, jumlah terpakai sudah dipotong dari saldo periode itu.`,
            );
            setTimeout(() => setSuccessMessage(null), 5000);
            void load({ silent: true });
          }}
        />
      )}

      {helpOpen && categories.length > 0 && (
        <CategoryHelpSheet categories={categories} onClose={() => setHelpOpen(false)} />
      )}

      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Petty Cash
          </p>
          <p className="mt-0.5 text-base font-bold leading-tight text-foreground">
            {data?.storeName ?? '…'}
          </p>
        </div>

        {!loading && !loadError && categories.length > 0 && (
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            aria-label="Lihat kategori pengeluaran"
            title="Kategori pengeluaran"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-base font-black leading-none text-foreground shadow-sm transition active:scale-95"
          >
            !
          </button>
        )}
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
            totalApprovedSpend={summary.approvedSpend}
            pendingAmount={summary.pendingAmount}
            awaitingConfirmAmount={summary.awaitingConfirmAmount}
            refillPending={data?.refillPending ?? null}
            isHolder={isHolder}
          />
        )}

        {!loading && !loadError && (
          <div className="px-4">
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                {
                  value: 'request' as const,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <ReceiptText className="h-4 w-4" />
                      Request
                    </span>
                  ),
                  count: isHolder ? allCounts.action : 0,
                },
                {
                  value: 'refill' as const,
                  label: (
                    <span className="flex items-center gap-1.5">
                      <Banknote className="h-4 w-4" />
                      Refill
                    </span>
                  ),
                  count: refillNeedsAction ? 1 : 0,
                },
              ]}
            />
          </div>
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

        {!loading && !loadError && tab === 'refill' && (
          bankLoaded ? (
            <RefillRequestCard
              request={refillRequest}
              overview={refillOverview}
              isHolder={isHolder}
              requesting={requestingRefill}
              lastBank={lastBank}
              onRequest={handleRequestRefill}
              uploadingKind={uploadingProofKind}
              onUploadProof={handleUploadProof}
              onViewImage={setLightboxSrc}
            />
          ) : (
            <div className="px-4"><SkeletonBlocks count={1} className="h-24" /></div>
          )
        )}

        {!loading && !loadError && tab === 'request' && isHolder && (allCounts.action > 0 || reRequestableCount > 0) && (
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

        {!loading && !loadError && tab === 'request' && data?.closedPeriod && (
          <section className="px-4">
            <Notice tone="info" title={`Periode ${periodLabel(data.closedPeriod.month)} sudah ditutup`}>
              {closedPeriodText(data.closedPeriod, data.month)}
            </Notice>
          </section>
        )}

        {!loading && !loadError && tab === 'request' && isHolder && (
          <section className="px-4">
            <SectionLabel>Request petty cash baru</SectionLabel>

            <form onSubmit={handleSubmit} className="space-y-4">
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

                {selectedCategory?.definition && (
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    {selectedCategory.definition}
                  </p>
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

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Keterangan
                </label>

                <textarea
                  value={description}
                  onChange={(e) => setDescription(pettyCashDescription(e.target.value))}
                  rows={3}
                  maxLength={PETTY_CASH_REASON_MAX}
                  placeholder="Tulis untuk apa request ini, misal: lakban & kertas HVS untuk label harga…"
                  className="w-full resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
                <ReasonCounter value={description} />
              </div>

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
            </form>
          </section>
        )}

        {!loading && !loadError && tab === 'request' && transactions.length > 0 && (
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
          </section>
        )}

        {!loading && !loadError && tab === 'request' && transactions.length === 0 && (
          <section className="px-4">
            <div className="rounded-2xl border border-dashed border-border">
              <EmptyState
                icon={ReceiptText}
                title="Belum ada Request Petty Cash"
                className="py-8"
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
