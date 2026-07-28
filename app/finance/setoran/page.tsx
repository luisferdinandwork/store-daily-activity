'use client';
// app/finance/setoran/page.tsx
//
// Finance · Setoran Monitor
//
// Status / color logic:
//   • 'not_submitted' (red)   — morning shift exists but task is still not_started/in_progress
//                               by end of the window. Staff haven't stored anything yet.
//   • 'pending'      (red)    — task.status === 'pending' (unresolved discrepancy)
//   • 'short'        (amber)  — completed but storedAmount < requiredStoreAmount by more
//                               than a configurable rounding threshold (default Rp 100.000).
//                               This is a genuine gap beyond normal rounding.
//   • 'completed'    (green)  — stored, and any remainder is within the rounding threshold.
//   • 'in_progress'  (blue)   — draft in progress, not yet submitted.
//   • 'not_started'  (slate)  — task created but untouched.
//   • 'no_data'      (slate)  — no schedule / no task row at all.
//
// The unpaidAmount carry-forward (e.g. Rp 67.700 from Rp 4.567.700 → Rp 4.500.000)
// is NORMAL and shown informatively in teal, NOT flagged red.
// Only a genuine missing submission or a large shortfall is red.

import {
  useCallback,
  useEffect,
  useState,
} from 'react';
import {
  AlertTriangle,
  Banknote,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  ImageOff,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  X,
  ZoomIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  SetoranStoreRow,
  SetoranTransactionEntry,
} from '@/app/api/finance/setoran/route';

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Rounding gap below this value is considered normal (daily rounding remainder).
 * Anything above is flagged amber as a genuine shortfall.
 * Adjust to your business rule — default Rp 100.000.
 */
const ROUNDING_THRESHOLD = 100_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const idr = (v: string | number | null | undefined) =>
  v != null && v !== '' && !isNaN(Number(v)) ? IDR.format(Number(v)) : '—';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function shiftDay(iso: string, delta: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}

function fmtTs(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Status derivation ────────────────────────────────────────────────────────

type UiStatus =
  | 'not_submitted'   // red   — not_started/in_progress (staff never stored)
  | 'pending'         // red   — task.status === pending (unresolved discrepancy)
  | 'short'           // amber — stored but gap > ROUNDING_THRESHOLD
  | 'completed'       // green — stored, gap within normal rounding
  | 'in_progress'     // blue  — draft, not yet submitted
  | 'not_started'     // slate — task exists but untouched
  | 'no_data';        // slate — no schedule / no task

interface StatusMeta {
  dot: string;
  badge: string;
  label: string;
  priority: number;
}

function deriveUiStatus(row: SetoranStoreRow): UiStatus {
  if (row.status === 'no_data')       return 'no_data';
  if (row.status === 'pending')       return 'pending';
  if (row.status === 'not_started')   return 'not_started';
  if (row.status === 'in_progress')   return 'in_progress';

  // completed — check whether the gap is just normal rounding or a real shortfall
  if (row.status === 'completed') {
    const required = Number(row.requiredStoreAmount ?? row.actualReceivedAmount ?? 0);
    const stored   = Number(row.storedAmount ?? 0);
    const gap      = Math.max(0, required - stored);
    return gap > ROUNDING_THRESHOLD ? 'short' : 'completed';
  }

  return 'no_data';
}

const STATUS_META: Record<UiStatus, StatusMeta> = {
  not_submitted: { dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',         label: 'Belum setor',     priority: 0 },
  pending:       { dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',         label: 'Pending',         priority: 1 },
  short:         { dot: 'bg-amber-400',   badge: 'bg-amber-50 text-amber-700 ring-amber-200',       label: 'Kurang setor',    priority: 2 },
  in_progress:   { dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          label: 'In progress',     priority: 3 },
  not_started:   { dot: 'bg-slate-300',   badge: 'bg-slate-100 text-slate-500 ring-slate-200',      label: 'Not Started',     priority: 4 },
  completed:     { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Selesai',         priority: 5 },
  no_data:       { dot: 'bg-slate-200',   badge: 'bg-slate-50 text-slate-400 ring-slate-200',       label: 'Tidak ada data',  priority: 6 },
};

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function Lightbox({ src, label, onClose }: { src: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <div className="flex flex-col items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
          {label}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={label}
          className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

// ─── Photo thumb ──────────────────────────────────────────────────────────────

function PhotoThumb({
  url,
  label,
  onView,
}: {
  url: string | null | undefined;
  label: string;
  onView: (url: string, label: string) => void;
}) {
  if (!url) {
    return (
      <div
        title={`No ${label}`}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50"
      >
        <ImageOff className="h-3.5 w-3.5 text-slate-300" />
      </div>
    );
  }
  return (
    <button
      onClick={() => onView(url, label)}
      title={`Lihat ${label}`}
      className="group relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 transition hover:border-blue-300"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="h-full w-full object-cover" />
      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/30">
        <ZoomIn className="h-3.5 w-3.5 text-white opacity-0 transition group-hover:opacity-100" />
      </div>
    </button>
  );
}

// ─── Money breakdown panel ────────────────────────────────────────────────────

function MoneyBreakdown({ row }: { row: SetoranStoreRow }) {
  const required = Number(row.requiredStoreAmount ?? row.actualReceivedAmount ?? 0);
  const stored   = Number(row.storedAmount ?? 0);
  const gap      = Math.max(0, required - stored);
  const isShortfall = gap > ROUNDING_THRESHOLD;
  const carry    = Number(row.priorCarryForward ?? 0);

  const cells = [
    {
      label:   'Uang diterima',
      value:   idr(row.actualReceivedAmount),
      sub:     null,
      accent:  false,
      warn:    false,
    },
    {
      label:   'Sisa kemarin',
      value:   carry > 0 ? idr(carry) : '—',
      sub:     carry > 0 ? 'dibawa dari hari lalu' : 'tidak ada',
      accent:  false,
      // carry-forward is teal / informational — NOT a warning
      warn:    false,
      teal:    carry > 0,
    },
    {
      label:   'Wajib disetor',
      value:   idr(row.requiredStoreAmount ?? row.actualReceivedAmount),
      sub:     carry > 0 ? 'diterima + sisa kemarin' : null,
      accent:  true,
      warn:    false,
    },
    {
      label:   'Disetor',
      value:   idr(row.storedAmount),
      sub:     row.status === 'completed' ? fmtTs(row.completedAt) : null,
      accent:  false,
      warn:    false,
    },
    {
      label:   'Sisa hari ini',
      value:   gap > 0 ? idr(gap) : '—',
      sub:     gap > 0
                 ? (isShortfall ? 'melebihi batas pembulatan' : 'pembulatan normal')
                 : 'lunas',
      accent:  false,
      // only warn if it's a genuine shortfall, not normal rounding
      warn:    isShortfall,
      teal:    !isShortfall && gap > 0,
    },
  ] as const;

  return (
    <div className="grid grid-cols-5 gap-px border-b border-slate-100 bg-slate-100">
      {cells.map((c) => (
        <div key={c.label} className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {c.label}
          </p>
          <p className={cn(
            'mt-1 text-[15px] font-bold tabular-nums',
            c.warn      ? 'text-amber-600' :
            (c as any).teal  ? 'text-teal-600'  :
            c.accent    ? 'text-slate-900'  : 'text-slate-700',
          )}>
            {c.value}
          </p>
          {c.sub && (
            <p className={cn(
              'mt-0.5 text-[10px]',
              c.warn      ? 'text-amber-500' :
              (c as any).teal  ? 'text-teal-500'  : 'text-slate-400',
            )}>
              {c.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Transaction rows ─────────────────────────────────────────────────────────

function TxRow({
  tx,
  onVerify,
  verifying,
}: {
  tx: SetoranTransactionEntry;
  onVerify: (id: number) => void;
  verifying: boolean;
}) {
  return (
    <div className={cn(
      'grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4',
      'border-b border-slate-100/70 px-12 py-3 text-sm last:border-0',
      tx.verifiedAt ? 'bg-white' : 'bg-amber-50/20',
    )}>
      <span className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        tx.verifiedAt ? 'bg-emerald-400' : 'bg-amber-400',
      )} />

      <div className="min-w-0">
        <p className="font-medium text-slate-800">{tx.description}</p>
        <p className="text-[11px] text-slate-400">
          {tx.submittedBy}
          {tx.verifiedAt && tx.verifiedBy && (
            <>
              {' · '}
              <span className="text-emerald-600">
                Verified by {tx.verifiedBy} · {fmtTs(tx.verifiedAt)}
              </span>
            </>
          )}
        </p>
      </div>

      <span className="shrink-0 font-semibold tabular-nums text-slate-700">
        {idr(tx.amount)}
      </span>

      <div className="w-28 shrink-0 text-right">
        {tx.verifiedAt ? (
          <span className="flex items-center justify-end gap-1 text-[10px] font-bold text-emerald-600">
            <ShieldCheck className="h-3.5 w-3.5" />
            Verified
          </span>
        ) : tx.canVerify ? (
          <button
            onClick={() => onVerify(tx.id)}
            disabled={verifying}
            className="flex h-7 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[11px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {verifying
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <CircleCheck className="h-3 w-3" />}
            Verifikasi
          </button>
        ) : (
          <span className="text-[10px] text-slate-400">Belum submit</span>
        )}
      </div>
    </div>
  );
}

// ─── Store row ────────────────────────────────────────────────────────────────

function StoreRow({
  row,
  expanded,
  onToggle,
  onReload,
}: {
  row: SetoranStoreRow;
  expanded: boolean;
  onToggle: () => void;
  onReload: () => void;
}) {
  const [lightbox, setLightbox]       = useState<{ src: string; label: string } | null>(null);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const uiStatus = deriveUiStatus(row);
  const meta     = STATUS_META[uiStatus];

  const carry    = Number(row.priorCarryForward ?? 0);
  const required = Number(row.requiredStoreAmount ?? row.actualReceivedAmount ?? 0);
  const stored   = Number(row.storedAmount ?? 0);
  const gap      = Math.max(0, required - stored);
  const isShortfall = gap > ROUNDING_THRESHOLD;

  async function handleVerify(txId: number) {
    if (!row.taskId) return;
    setActionError(null);
    setVerifyingId(txId);
    try {
      const res  = await fetch(`/api/finance/setoran/${row.taskId}/verify`, { method: 'POST' });
      const body = await res.json();
      if (!body.success) setActionError(body.error ?? 'Verifikasi gagal.');
      else onReload();
    } catch {
      setActionError('Network error.');
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <>
      {lightbox && (
        <Lightbox
          src={lightbox.src}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* ── Header row ── */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className={cn(
          'group grid cursor-pointer select-none border-b border-slate-100',
          'grid-cols-[auto_1fr_9rem_9rem_7rem_9rem_auto] items-center gap-x-3',
          'px-4 py-3 transition-colors',
          expanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/60',
        )}
      >
        {/* Chevron */}
        <div className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors',
          expanded ? 'bg-slate-200 text-slate-700' : 'text-slate-300 group-hover:bg-slate-100 group-hover:text-slate-500',
        )}>
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5" />
            : <ChevronRight className="h-3.5 w-3.5" />}
        </div>

        {/* Store name + area + staff */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />
            <span className="truncate font-semibold text-slate-900">{row.storeName}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-500">
              {row.storeNo}
            </span>
          </div>
          <p className="ml-4 mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
            <span>{row.areaName}</span>
            {row.scheduledStaff.length > 0 && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {row.scheduledStaff.map((s) => s.name).join(', ')}
              </span>
            )}
          </p>
        </div>

        {/* Received */}
        <div>
          <p className="text-sm font-semibold tabular-nums text-slate-700">
            {idr(row.actualReceivedAmount)}
          </p>
          <p className="text-[10px] text-slate-400">diterima</p>
        </div>

        {/* Stored */}
        <div>
          <p className={cn(
            'text-sm font-semibold tabular-nums',
            uiStatus === 'not_submitted' ? 'text-rose-500' :
            uiStatus === 'short'         ? 'text-amber-600' : 'text-slate-700',
          )}>
            {idr(row.storedAmount)}
          </p>
          <p className="text-[10px] text-slate-400">
            {row.status === 'completed' ? 'disetor' :
             row.status === 'in_progress' ? 'draft' : '—'}
          </p>
        </div>

        {/* Carry-forward — teal, informational */}
        <div>
          {carry > 0 ? (
            <>
              <p className="text-sm font-semibold tabular-nums text-teal-600">
                {idr(carry)}
              </p>
              <p className="text-[10px] text-teal-500">sisa lalu</p>
            </>
          ) : (
            <p className="text-[11px] text-slate-300">—</p>
          )}
        </div>

        {/* Status badge */}
        <div>
          <span className={cn(
            'inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset',
            meta.badge,
          )}>
            {/* For shortfall show the gap amount */}
            {uiStatus === 'short' && isShortfall
              ? `Kurang ${idr(gap)}`
              : meta.label}
          </span>
        </div>

        {/* Photos — stop propagation so clicks don't toggle the accordion */}
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <PhotoThumb
            url={row.resiPhoto}
            label="Foto resi"
            onView={(src, lbl) => setLightbox({ src, label: lbl })}
          />
          <PhotoThumb
            url={row.atmCardSelfiePhoto}
            label="Foto ATM"
            onView={(src, lbl) => setLightbox({ src, label: lbl })}
          />
        </div>
      </div>

      {/* ── Error toast ── */}
      {actionError && (
        <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-12 py-2">
          <p className="text-xs font-medium text-rose-700">⚠ {actionError}</p>
          <button
            onClick={() => setActionError(null)}
            className="text-xs font-semibold text-rose-600 underline"
          >
            Tutup
          </button>
        </div>
      )}

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-b border-slate-100 bg-slate-50/40">

          {/* Money breakdown */}
          <MoneyBreakdown row={row} />

          {/* Submission meta */}
          {(row.submittedBy || row.notes) && (
            <div className="flex flex-wrap items-center gap-5 border-b border-slate-100 bg-white px-12 py-2 text-[11px] text-slate-500">
              {row.submittedBy && (
                <span>
                  <span className="font-semibold text-slate-700">Disubmit oleh:</span>{' '}
                  {row.submittedBy}
                </span>
              )}
              {row.completedAt && (
                <span>
                  <span className="font-semibold text-slate-700">Waktu:</span>{' '}
                  {fmtTs(row.completedAt)}
                </span>
              )}
              {row.actualReceivedAmountBy && row.actualReceivedAmountBy !== row.submittedBy && (
                <span>
                  <span className="font-semibold text-slate-700">Input nominal:</span>{' '}
                  {row.actualReceivedAmountBy}
                  {row.actualReceivedAmountAt && ` · ${fmtTs(row.actualReceivedAmountAt)}`}
                </span>
              )}
              {row.notes && (
                <span>
                  <span className="font-semibold text-slate-700">Catatan:</span>{' '}
                  {row.notes}
                </span>
              )}
            </div>
          )}

          {/* Transactions */}
          {row.transactions.length === 0 ? (
            <div className="px-12 py-5 text-sm italic text-slate-400">
              Belum ada setoran yang disubmit hari ini.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 border-b border-slate-100 px-12 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                <span />
                <span>Keterangan</span>
                <span>Jumlah disetor</span>
                <span className="w-28 text-right">Verifikasi</span>
              </div>

              {row.transactions.map((tx) => (
                <TxRow
                  key={tx.id}
                  tx={tx}
                  onVerify={handleVerify}
                  verifying={verifyingId === tx.id}
                />
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}

// ─── Summary strip ────────────────────────────────────────────────────────────

function SummaryStrip({ rows }: { rows: SetoranStoreRow[] }) {
  const withData   = rows.filter((r) => r.status !== 'no_data');

  const countStatus = (s: UiStatus) => rows.filter((r) => deriveUiStatus(r) === s).length;

  const pills = [
    { label: 'Selesai',        value: countStatus('completed'),     dot: 'bg-emerald-500' },
    { label: 'In progress',    value: countStatus('in_progress'),   dot: 'bg-blue-400' },
    { label: 'Pending',        value: countStatus('not_started') + countStatus('no_data'), dot: 'bg-slate-300' },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {pills.map(({ label, value, dot }) => (
        <div
          key={label}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
        >
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
          <div>
            <p className="text-lg font-bold leading-none text-slate-900">{value}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {label}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceSetoranPage() {
  const [date, setDate]                 = useState(todayStr);
  const [allRows, setAllRows]           = useState<SetoranStoreRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [expandedIds, setExpandedIds]   = useState<Set<number>>(new Set());
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [areaFilter, setAreaFilter]     = useState('');

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/finance/setoran?date=${d}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) {
        setAllRows(body.data);
        // Auto-expand the first store that genuinely hasn't submitted
        const firstProblem = body.data.find(
          (r: SetoranStoreRow) =>
            deriveUiStatus(r) === 'not_submitted' ||
            deriveUiStatus(r) === 'short' ||
            deriveUiStatus(r) === 'pending',
        );
        setExpandedIds(firstProblem ? new Set([firstProblem.storeId]) : new Set());
      } else {
        setError(body.error ?? 'Gagal memuat data.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [load, date]);

  const areas  = [...new Set(allRows.map((r) => r.areaName))].sort();
  const isToday = date === todayStr();

  const filtered = allRows.filter((r) => {
    const q = search.toLowerCase();
    const matchQ = !q ||
      r.storeName.toLowerCase().includes(q) ||
      r.storeNo.toLowerCase().includes(q) ||
      r.areaName.toLowerCase().includes(q) ||
      r.scheduledStaff.some((s) => s.name.toLowerCase().includes(q));
    const matchStatus = !statusFilter || deriveUiStatus(r) === statusFilter;
    const matchArea   = !areaFilter   || r.areaName === areaFilter;
    return matchQ && matchStatus && matchArea;
  });

  const toggle = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="min-h-full bg-slate-50">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Kas Operasional
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
                Monitor Setoran Harian
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white">
                <button
                  onClick={() => setDate((d) => shiftDay(d, -1))}
                  className="flex h-full w-8 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50"
                  aria-label="Hari sebelumnya"
                >
                  ‹
                </button>
                <span className="border-x border-slate-200 px-3 text-xs font-bold text-slate-700">
                  {fmtDate(date)}
                </span>
                <button
                  onClick={() => setDate((d) => shiftDay(d, 1))}
                  disabled={isToday}
                  className="flex h-full w-8 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Hari berikutnya"
                >
                  ›
                </button>
              </div>

              {!isToday && (
                <button
                  onClick={() => setDate(todayStr())}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Hari ini
                </button>
              )}

              <button
                onClick={() => load(date)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6 lg:px-8">

        {!loading && !error && <SummaryStrip rows={allRows} />}

        {/* ── Filters ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Nama toko, kode, area, staf…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none"
          >
            <option value="">Semua status</option>
            <option value="not_submitted">Belum setor</option>
            <option value="short">Kurang setor</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In progress</option>
            <option value="not_started">Not Started</option>
            <option value="completed">Selesai</option>
            <option value="no_data">Tidak ada data</option>
          </select>

          <select
            value={areaFilter}
            onChange={(e) => setAreaFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none"
          >
            <option value="">Semua area</option>
            {areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          {(search || statusFilter || areaFilter) && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); setAreaFilter(''); }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
            >
              Reset filter
            </button>
          )}

          <span className="ml-auto text-xs text-slate-400">
            {filtered.length} dari {allRows.length} toko
          </span>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* ── Carry-forward note ── */}
        {!loading && !error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-xs text-teal-700">
            <Banknote className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
            <p>
              <span className="font-semibold">Sisa harian (carry-forward)</span> ditampilkan
              dalam warna teal dan bukan masalah — ini adalah pembulatan normal setoran.
              Yang ditandai <span className="font-semibold text-rose-600">merah</span> adalah
              toko yang belum melakukan setoran sama sekali.
              Yang ditandai <span className="font-semibold text-amber-600">kuning</span> adalah
              toko yang setoran kurang melebihi Rp {ROUNDING_THRESHOLD.toLocaleString('id-ID')}.
            </p>
          </div>
        )}

        {/* ── Table ── */}
        {loading ? (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-11 animate-pulse bg-slate-100" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-slate-100 px-4 py-3.5 last:border-0"
              >
                <div className="h-6 w-6 animate-pulse rounded-md bg-slate-100" />
                <div className="h-8 flex-1 animate-pulse rounded-lg bg-slate-50" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
                <div className="h-4 w-16 animate-pulse rounded bg-slate-100" />
                <div className="h-6 w-24 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-9 w-9 animate-pulse rounded-lg bg-slate-100" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <Banknote className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">
              {search || statusFilter || areaFilter
                ? 'Tidak ada toko yang cocok dengan filter.'
                : 'Tidak ada data setoran untuk hari ini.'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Column header */}
            <div className="grid grid-cols-[auto_1fr_9rem_9rem_7rem_9rem_auto] items-center gap-x-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <span className="w-6" />
              <span>Toko / Staf</span>
              <span>Diterima</span>
              <span>Disetor</span>
              <span>Sisa lalu</span>
              <span>Status</span>
              <span>Foto</span>
            </div>

            {filtered.map((r) => (
              <StoreRow
                key={r.storeId}
                row={r}
                expanded={expandedIds.has(r.storeId)}
                onToggle={() => toggle(r.storeId)}
                onReload={() => load(date)}
              />
            ))}
          </div>
        )}

        {/* ── Legend ── */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
          <span className="font-semibold uppercase tracking-wide">Status:</span>
          {(Object.entries(STATUS_META) as [UiStatus, StatusMeta][]).map(([key, m]) => (
            <span key={key} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', m.dot)} />
              <span>{m.label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-teal-400" />
            <span>Sisa carry-forward (pembulatan normal)</span>
          </span>
        </div>

      </div>
    </div>
  );
}