// app/employee/pettycash/page.tsx

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle,
  Banknote,
  Camera,
  CheckCircle2,
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
import CameraCapture from '@/components/shared/CameraCapture';

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
      label: 'Empty',
      detail: isPic
        ? 'Request a refill before sending new requests.'
        : 'Ask your PIC to request a refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 250_000) {
    return {
      label: 'Critical',
      detail: isPic
        ? 'Running very low — request a refill now.'
        : 'Running very low — ask your PIC to request a refill.',
      textClass: 'text-rose-600',
    };
  }
  if (balance < 500_000) {
    return {
      label: 'Getting low',
      detail: isPic
        ? 'Consider requesting a refill soon.'
        : 'Your PIC may want to request a refill soon.',
      textClass: 'text-amber-600',
    };
  }
  return { label: 'Healthy', detail: null, textClass: 'text-emerald-600' };
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
  return tx.status === 'ops_approved' && !tx.imageUrl;
}

// One consistent status language across the whole page:
//   sky    = waiting on someone else to act
//   indigo = action needed from you
//   emerald = done / approved
//   rose   = rejected / problem
function statusMeta(tx: TxRow) {
  if (tx.status === 'pending_ops') {
    return {
      label: 'Waiting OPS Approval',
      icon: Clock3,
      className: 'bg-sky-50 text-sky-700 ring-sky-200',
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

  if (needsReceipt(tx)) {
    return {
      label: 'Upload Receipt',
      icon: UploadCloud,
      className: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
      note: 'OPS approved this request. Upload the receipt photo for your records.',
    };
  }

  return {
    label: 'Approved',
    icon: ShieldCheck,
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    note: 'Approved by OPS. Money can be used.',
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
// Left as the one intentionally-colorful element on the page (like the
// schedule page's header) — the gradient is the balance-health signal
// itself (low/warning/healthy), not decoration, so it's doing real work.

function BalanceCard({
  balance,
  storeName,
  totalApprovedSpend,
  pendingAmount,
  month,
  isPic,
}: {
  balance: number;
  storeName: string;
  totalApprovedSpend: number;
  pendingAmount: number;
  month: string;
  isPic: boolean;
}) {
  const pct = Math.min(100, Math.round((balance / 1_000_000) * 100));
  const health = balanceHealth(balance, isPic);

  return (
    <div className={cn('mx-4 rounded-2xl bg-gradient-to-br p-5 shadow-sm', balanceBg(balance))}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-slate-500" />
          <p className="text-xs font-semibold text-slate-500">
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

      {health.detail && (
        <p className={cn('mt-2 text-[11px] font-semibold', health.textClass)}>
          {health.detail}
        </p>
      )}

      {pendingAmount > 0 && (
        <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
          <p className="text-[11px] font-semibold text-sky-700">
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
  { kind: 'drawer', label: 'Petty Cash Drawer' },
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
    <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-2.5">
      {imageUrl ? (
        <button
          type="button"
          onClick={() => onView(imageUrl)}
          className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-slate-100"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </button>
      ) : (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50">
          <Camera className="h-4 w-4 text-slate-300" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-700">{label}</p>
        <p className={cn('text-[10px] font-semibold', imageUrl ? 'text-emerald-600' : 'text-slate-400')}>
          {imageUrl ? 'Uploaded' : 'Not uploaded yet'}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        disabled={uploading}
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition active:scale-[0.98] disabled:opacity-60',
          imageUrl ? 'border border-slate-200 text-slate-500' : 'bg-indigo-600 text-white',
        )}
      >
        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        {imageUrl ? 'Retake' : 'Take Photo'}
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
  // Card shells are neutral now (white / slate-200) — status still reads
  // clearly from the icon + heading color and, for "approved", from the
  // action itself (proof capture rows). Colored fills stayed only in the
  // small elements whose entire job is to signal status.
  if (request?.status === 'pending') {
    return (
      <div className="mx-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-sky-600" />
          <p className="text-xs font-bold text-sky-700">Refill request pending Finance approval</p>
        </div>
      </div>
    );
  }

  if (request?.status === 'approved') {
    const photoUrls: Record<RefillProofKind, string | null> = {
      drawer: request.drawerPhotoUrl,
      signature: request.signaturePhotoUrl,
    };
    const toppedUp = Boolean(request.balanceAfter);

    // Once the refill is fully received (both proof photos in), the topped-up
    // balance applies to NEXT month, not the current one — this month's
    // balance keeps reflecting what's actually been spent. So there's nothing
    // left to action here; replace the card with a simple status note instead
    // of leaving the (now-redundant) approve/photo-capture UI on screen.
    if (toppedUp) {
      return (
        <div className="mx-4 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <p className="text-xs font-bold text-emerald-700">This month&apos;s petty cash has already been refilled</p>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">
            The refill has been received and will top up next month&apos;s balance. The next refill can be requested starting next month.
          </p>
        </div>
      );
    }

    return (
      <div className="mx-4 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Banknote className="h-4 w-4 text-indigo-600" />
          <p className="text-xs font-bold text-indigo-700">
            Finance approved — take proof photos to receive the cash
          </p>
        </div>

        <p className="mt-1.5 text-[11px] text-indigo-600/80">
          When Finance hands over the cash, take a photo of the petty cash drawer and the Surat Terima Petty Cash below. The balance updates once both photos are submitted.
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
    <div className="mx-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50">
          <Banknote className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-slate-800">Running low on the whole balance?</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            A refill tops the store's whole petty cash back up to Rp 1.000.000.
            It's separate from a spending request — Finance reviews and approves it.
          </p>
          {request?.status === 'rejected' && (
            <p className="mt-1.5 text-[11px] font-medium text-rose-600">
              Last request was rejected{request.rejectionReason ? `: ${request.rejectionReason}` : '.'} You can request again.
            </p>
          )}
        </div>
      </div>
      {/* Outline style — a secondary action, visually distinct from the
          filled primary "Send Request to OPS" button below the page. */}
      <button
        type="button"
        onClick={onRequest}
        disabled={requesting}
        className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white text-xs font-bold text-indigo-700 transition active:scale-[0.99] disabled:opacity-60"
      >
        {requesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Banknote className="h-3.5 w-3.5" />}
        Request Refill
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
            Uploading…
          </>
        ) : (
          <>
            <Camera className="h-4 w-4" />
            Take Receipt Photo
          </>
        )}
      </button>

      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => { setCameraOpen(false); onConfirm(file); }}
        title="Receipt Photo"
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
        OPS approved this request. Upload the receipt photo for your records.
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

  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);

  const [refillRequest, setRefillRequest] = useState<RefillRequestRow | null>(null);
  const [requestingRefill, setRequestingRefill] = useState(false);
  const [uploadingProofKind, setUploadingProofKind] = useState<RefillProofKind | null>(null);

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
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Failed to request refill.');
      setRefillRequest(body.request);
      setSuccessMessage('Refill requested — Finance will review it.');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to request refill.');
    } finally {
      setRequestingRefill(false);
    }
  }

  async function handleUploadProof(kind: RefillProofKind, file: File) {
    setActionError(null);
    setSuccessMessage(null);

    if (!refillRequest) return;

    if (file.size > 5 * 1024 * 1024) {
      setActionError('Photo must be less than 5 MB.');
      return;
    }

    if (!data?.storeName) {
      setActionError('Store data is not loaded.');
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
      if (!uploadRes.ok) throw new Error(uploadBody.error ?? 'Photo upload failed.');

      const patchRes = await fetch('/api/employee/petty-cash/refill-request', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: refillRequest.id, kind, imageUrl: uploadBody.url }),
      });
      const patchBody = await patchRes.json();
      if (!patchRes.ok || !patchBody.success) throw new Error(patchBody.error ?? 'Failed to attach photo.');

      setRefillRequest(patchBody.request);
      setSuccessMessage('Photo uploaded.');
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Photo upload failed. Try again.');
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

      setSuccessMessage('Receipt uploaded and saved.');
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
      approved: transactions.filter((tx) => tx.status === 'ops_approved').length,
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

      <div className="px-4 pt-5">
        <p className="text-xs font-semibold text-muted-foreground">
          Petty Cash Request
        </p>
        <p className="text-sm font-bold leading-none text-foreground">
          {data?.storeName ?? '…'}
        </p>
      </div>

      {showInfo && (
        <div className="mx-4 mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-[11px] leading-snug text-slate-600">
                <span className="font-bold text-slate-800">Request</span> — spend
                money on something specific. Goes to OPS for approval.
              </p>
              <p className="text-[11px] leading-snug text-slate-600">
                <span className="font-bold text-slate-800">Refill</span> — top the
                whole balance back up to Rp 1.000.000 when it's running low. Goes
                to Finance for approval.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInfo(false)}
              className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-200/60"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

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
          <section className="grid grid-cols-3 gap-2 px-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-600">
                OPS
              </p>
              <p className="mt-1 text-xl font-black text-sky-700">
                {summary.pendingOps}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-600">
                Receipt
              </p>
              <p className="mt-1 text-xl font-black text-indigo-700">
                {summary.waitingReceipt}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600">
                Approved
              </p>
              <p className="mt-1 text-xl font-black text-emerald-700">
                {summary.approved}
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

        {!loading && !loadError && isPic && needsReceiptTxs.length > 0 && (
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

        {!loading && !loadError && !isPic && (
          <section className="px-4">
            <div className="rounded-2xl border border-dashed border-slate-200 bg-secondary/30 p-4">
              <p className="text-xs font-bold text-slate-700">Only PIC can send petty cash requests</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                You can view request status here. Ask your store&apos;s PIC to submit a new request.
              </p>
            </div>
          </section>
        )}

        {!loading && !loadError && isPic && (
          <section className="px-4">
            <h2 className="mb-3 text-sm font-bold text-foreground">
              New Petty Cash Request
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-bold text-slate-700">
                  Receipt photo is not required yet.
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
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