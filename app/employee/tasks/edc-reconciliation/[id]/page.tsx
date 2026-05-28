'use client';
// app/employee/tasks/edc-reconciliation/[id]/page.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudOff,
  CreditCard,
  Landmark,
  Loader2,
  LogIn,
  Navigation,
  NavigationOff,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { SaveIndicator, TaskHeader, TaskSubmitBar } from '@/components/employee/tasks';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';
type TxType = 'qris' | 'debit' | 'credit';
type EdcName = 'BCA' | 'Mandiri' | 'BNI' | 'OCBC' | string;

const EDC_NAMES: EdcName[] = ['BCA', 'Mandiri', 'BNI', 'OCBC'];
const TX_TYPES: TxType[] = ['qris', 'debit', 'credit'];

const TX_LABELS: Record<TxType, string> = { qris: 'QRIS', debit: 'Debit', credit: 'Credit' };
const TX_ICONS: Record<TxType, React.ElementType> = { qris: QrCode, debit: Landmark, credit: CreditCard };

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface EdcTaskData {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day';
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  parentTaskId: number | null;
  isBalanced: boolean | null;
  expectedFetchedAt: string | null;
  discrepancyStartedAt: string | null;
  discrepancyResolvedAt: string | null;
  discrepancyDurationMinutes: number | null;
}

interface ExpectedRow {
  edcName: EdcName;
  transactionType: TxType;
  expectedAmount: number;
  expectedCount: number;
}

interface ExpectedSnapshot {
  rows: ExpectedRow[];
  generatedAt: string;
  seed: number;
}

interface ActualRow {
  id: number;
  edcTaskId: number;
  edcName: EdcName;
  transactionType: TxType;
  expectedAmount: string | null;
  expectedCount: number | null;
  actualAmount: string | null;
  actualCount: number | null;
  matches: boolean | null;
  notes: string | null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Convert Rupiah-ish values to raw integer digits.
 *
 * Why this is needed:
 * Drizzle/Postgres decimal values often arrive as strings like "1250000.00".
 * If we simply strip every non-digit, that becomes "125000000" and the UI
 * displays two extra zeros at the back.
 *
 * This helper removes only a real decimal tail first, then strips separators.
 * Examples:
 *   "1250000.00"     -> "1250000"
 *   "Rp 1.250.000"   -> "1250000"
 *   "Rp 1.250.000,00"-> "1250000"
 */
function toRupiahDigits(raw: string | number | null | undefined): string {
  if (raw == null || raw === '') return '0';

  let value = String(raw).trim().replace(/^Rp\s*/i, '').trim();

  // Remove a decimal fraction only when it is clearly a currency decimal tail.
  // This catches DB values like "1250000.00" and formatted values like
  // "1.250.000,00", but it will not break Indonesian thousand groups like
  // "1.000" because that has three digits after the separator.
  if (/[,.]\d{2}$/.test(value)) {
    value = value.slice(0, -3);
  }

  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits || '0';
}

/** Full Rupiah: Rp 1.250.000 */
function formatRupiahFull(raw: string | number | null | undefined): string {
  const n = Number(toRupiahDigits(raw));
  if (!Number.isFinite(n) || n === 0) return 'Rp 0';
  return 'Rp ' + n.toLocaleString('id-ID');
}

/** Short Rupiah: Rp 1,2jt / Rp 250rb */
function formatRupiahShort(raw: string | number | null | undefined): string {
  const n = Number(toRupiahDigits(raw));
  if (!Number.isFinite(n) || n === 0) return 'Rp 0';
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)}M`;
  if (n >= 1_000_000)     return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
  if (n >= 1_000)         return `Rp ${(n / 1_000).toFixed(0)}rb`;
  return 'Rp ' + n.toLocaleString('id-ID');
}

function parseRupiah(s: string): string {
  return toRupiahDigits(s);
}

// ─── Inline Input Sheet ───────────────────────────────────────────────────────

interface InputSheetProps {
  open: boolean;
  edcName: EdcName;
  txType: TxType;
  initialAmount: string;   // raw digits string e.g. "1250000"
  initialCount: string;
  onClose: () => void;
  onSave: (amount: string, count: number) => Promise<void>;
  onDelete?: () => Promise<void>;
  mode: 'add' | 'edit';
}

function InputSheet({
  open, edcName, txType, initialAmount, initialCount,
  onClose, onSave, onDelete, mode,
}: InputSheetProps) {
  // Store raw digit string internally; display formatted
  const [rawAmount, setRawAmount] = useState('0');
  const [count, setCount]         = useState('1');
  const [saving, setSaving]       = useState(false);
  const [deleting, setDeleting]   = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const Icon = TX_ICONS[txType];

  // Sync when sheet opens for a new target
  useEffect(() => {
    if (open) {
      // initialAmount is already raw digits; strip any stray non-digits just in case
      setRawAmount(parseRupiah(initialAmount) || '0');
      setCount(initialCount || '1');
      setTimeout(() => amountRef.current?.focus(), 120);
    }
  }, [open, initialAmount, initialCount]);

  // Lock scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Extract only digits from whatever the user typed / pasted
    const digits = e.target.value.replace(/\D/g, '');
    setRawAmount(digits || '0');
  }

  async function handleSave() {
    const amountNum = parseInt(rawAmount, 10);
    const countNum  = parseInt(count, 10);
    if (!amountNum || amountNum <= 0) { toast.error('Nominal harus lebih dari 0.'); return; }
    if (!countNum  || countNum  <= 0) { toast.error('Jumlah transaksi harus lebih dari 0.'); return; }
    setSaving(true);
    try {
      await onSave(rawAmount, countNum);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full mx-4 rounded-t-3xl bg-background shadow-2xl sm:mb-0 sm:rounded-3xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">
                EDC {edcName} · {TX_LABELS[txType]}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {mode === 'add' ? 'Input transaksi aktual' : 'Edit transaksi aktual'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:bg-border transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Inputs */}
        <div className="px-5 py-5 space-y-5">
          {/* Amount */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Nominal Aktual
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground">
                Rp
              </span>
              <input
                ref={amountRef}
                type="text"
                inputMode="numeric"
                value={rawAmount === '0' ? '' : parseInt(rawAmount, 10).toLocaleString('id-ID')}
                onChange={handleAmountChange}
                placeholder="0"
                className="w-full rounded-2xl border border-border bg-secondary pl-12 pr-4 py-3.5 text-xl font-bold tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {/* Live formatted preview */}
            {rawAmount !== '0' && rawAmount !== '' && (
              <p className="text-[11px] font-semibold text-primary/70 pl-1">
                {formatRupiahFull(rawAmount)}
              </p>
            )}
          </div>

          {/* Count */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Jumlah Transaksi
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCount((c) => String(Math.max(1, parseInt(c || '1', 10) - 1)))}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground transition-all hover:bg-border active:scale-95"
              >
                <span className="text-base font-bold leading-none">−</span>
              </button>

              <input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
                className="h-9 w-full rounded-xl border border-border bg-secondary px-2 text-center text-sm font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
              />

              <button
                type="button"
                onClick={() => setCount((c) => String(parseInt(c || '1', 10) + 1))}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-secondary text-muted-foreground transition-all hover:bg-border active:scale-95"
              >
                <span className="text-base font-bold leading-none">+</span>
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t border-border px-5 pb-6 pt-3">
          {mode === 'edit' && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || saving}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors active:scale-[0.97] disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary transition-colors active:scale-[0.98]"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || deleting}
            className="flex-1 flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={3} />}
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo() {
  const [geo, setGeo]         = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    setGeoReady(false); setGeoError(null);
    if (!navigator.geolocation) { setGeoError('Geolocation tidak didukung.'); setGeoReady(true); return; }
    navigator.geolocation.getCurrentPosition(
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoReady(true); },
      ()  => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { geo, geoError, geoReady, refresh };
}

function useAccessStatus(
  scheduleId: string, storeId: string,
  geo: { lat: number; lng: number } | null, geoReady: boolean, taskStatus: TaskStatus | undefined,
) {
  const [accessStatus, setAccessStatus]   = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' }); setAccessLoading(false); return;
    }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) { p.set('lat', String(geo.lat)); p.set('lng', String(geo.lng)); }
      const res = await fetch(`/api/employee/tasks/access?${p}`);
      setAccessStatus((await res.json()) as AccessStatus);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally  { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) fetchAccess(); }, [geoReady, fetchAccess]);
  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Access banner ────────────────────────────────────────────────────────────

function AccessBanner({ accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess }: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-secondary px-4 py-3">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
    </div>
  );
  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') return (
    <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
      <LogIn className="h-4 w-4 flex-shrink-0 text-red-600" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-red-700">Belum absen masuk</p>
        <p className="mt-0.5 text-[11px] text-red-500">Absen masuk dulu untuk melanjutkan</p>
      </div>
      <button onClick={onRefreshAccess} className="rounded-xl bg-red-100 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">Cek</button>
    </div>
  );

  if (accessStatus.status === 'outside_geofence') return (
    <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
      <NavigationOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-orange-700">Di luar area toko</p>
        <p className="mt-0.5 text-[11px] text-orange-500">{accessStatus.distanceM}m · batas {accessStatus.radiusM}m</p>
      </div>
      <button onClick={onRefreshGeo} className="rounded-xl bg-orange-100 px-3 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">Perbarui</button>
    </div>
  );

  if (accessStatus.status === 'geo_unavailable') return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <NavigationOff className="h-4 w-4 flex-shrink-0 text-amber-600" />
      <p className="text-xs text-amber-700">{geoError ?? 'Izin lokasi belum diberikan.'}</p>
    </div>
  );

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi OK · {geo?.lat.toFixed(4)}, {geo?.lng.toFixed(4)}
      </p>
    </div>
  );
}

// ─── EDC Group Card — collapsible ─────────────────────────────────────────────

function EdcGroupCard({
  edcName,
  expectedRows,
  actualRows,
  disabled,
  onTapRow,
  onTapAddCustom,
  onRemoveRow,
}: {
  edcName: EdcName;
  expectedRows: ExpectedRow[];
  actualRows: ActualRow[];
  disabled: boolean;
  onTapRow: (edcName: EdcName, txType: TxType, existingRow: ActualRow | null) => void;
  onTapAddCustom: (edcName: EdcName) => void;
  onRemoveRow: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const expectedByType = new Map(expectedRows.map(r => [r.transactionType, r]));
  const actualByType   = new Map(actualRows.map(r => [r.transactionType, r]));

  const allTypes = Array.from(new Set([
    ...TX_TYPES.filter(t => expectedByType.has(t)),
    ...actualRows.map(r => r.transactionType),
  ])) as TxType[];

  const totalExpected = expectedRows.reduce((s, r) => s + Number(r.expectedAmount), 0);
  const totalActual   = actualRows.reduce((s, r)   => s + Number(r.actualAmount ?? 0), 0);
  const filledCount   = allTypes.filter(t => actualByType.has(t)).length;
  const allFilled     = allTypes.length > 0 && allTypes.every(t => actualByType.has(t));
  const allMatch      = allFilled && actualRows.length > 0 && actualRows.every(r => r.matches === true);
  const hasMismatch   = actualRows.some(r => r.matches === false);

  // Status derived badge
  const statusBadge = allMatch
    ? { label: 'Balance', bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' }
    : hasMismatch
    ? { label: 'Beda', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
    : allFilled
    ? { label: 'Lengkap', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' }
    : { label: `${filledCount}/${allTypes.length}`, bg: 'bg-secondary', text: 'text-muted-foreground', border: 'border-border' };

  const cardBorderColor = allMatch
    ? 'border-green-200'
    : hasMismatch
    ? 'border-red-200'
    : allFilled
    ? 'border-amber-200'
    : 'border-border';

  const headerBg = allMatch
    ? 'bg-green-50/80'
    : hasMismatch
    ? 'bg-red-50/80'
    : allFilled
    ? 'bg-amber-50/60'
    : 'bg-muted/30';

  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-card shadow-sm transition-all duration-200', cardBorderColor)}>
      {/* ── Collapsible header ── */}
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors',
          headerBg,
          'border-b',
          cardBorderColor,
        )}
      >
        {/* Status dot */}
        <div className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl',
          allMatch ? 'bg-green-100' : hasMismatch ? 'bg-red-100' : allFilled ? 'bg-amber-100' : 'bg-muted',
        )}>
          {allMatch
            ? <Check className="h-4 w-4 text-green-600" strokeWidth={3} />
            : hasMismatch
            ? <AlertTriangle className="h-4 w-4 text-red-500" />
            : <CreditCard className="h-4 w-4 text-muted-foreground" />}
        </div>

        {/* Labels */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-foreground">EDC {edcName}</p>
            <span className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-bold',
              statusBadge.bg, statusBadge.text, statusBadge.border,
            )}>
              {statusBadge.label}
            </span>
          </div>
          {/* Summary line — always visible so user knows totals even when collapsed */}
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {totalExpected > 0 && (
              <span className="font-medium text-blue-600">{formatRupiahFull(totalExpected)}</span>
            )}
            {totalExpected > 0 && <span className="text-muted-foreground/40">·</span>}
            <span>
              {filledCount}/{allTypes.length} diisi
            </span>
            {allFilled && totalActual > 0 && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className={cn('font-semibold', allMatch ? 'text-green-600' : hasMismatch ? 'text-red-600' : 'text-amber-600')}>
                  Aktual {formatRupiahFull(totalActual)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown className={cn(
          'h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200',
          expanded && 'rotate-180',
        )} />
      </button>

      {/* ── Expandable body ── */}
      {expanded && (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-[1.2fr_1fr_1fr] border-b border-border/60 bg-muted/10 px-4 py-2">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Tipe</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-blue-500">Sistem</p>
            <p className="text-[9px] font-bold uppercase tracking-widest text-foreground/50">Aktual</p>
          </div>

          {/* Rows */}
          <div className="divide-y divide-border/40">
            {allTypes.map(txType => {
              const exp     = expectedByType.get(txType) ?? null;
              const actual  = actualByType.get(txType) ?? null;
              const Icon    = TX_ICONS[txType];
              const filled  = actual != null && actual.actualAmount != null;
              const match   = actual?.matches === true;
              const mismatch = actual?.matches === false;

              return (
                <div
                  key={txType}
                  className={cn(
                    'grid grid-cols-[1.2fr_1fr_1fr] items-stretch',
                    match   && 'bg-green-50/50',
                    mismatch && 'bg-red-50/50',
                  )}
                >
                  {/* Type label */}
                  <div className="flex items-center gap-2.5 px-4 py-3.5">
                    <div className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl',
                      match   ? 'bg-green-100'
                      : mismatch ? 'bg-red-100'
                      : 'bg-muted',
                    )}>
                      <Icon className={cn(
                        'h-3.5 w-3.5',
                        match   ? 'text-green-600'
                        : mismatch ? 'text-red-500'
                        : 'text-muted-foreground',
                      )} strokeWidth={2.5} />
                    </div>
                    <div>
                      <p className="text-[12px] font-bold text-foreground">{TX_LABELS[txType]}</p>
                      {filled && (
                        <p className={cn(
                          'mt-0.5 flex items-center gap-1 text-[10px] font-semibold',
                          match ? 'text-green-600' : mismatch ? 'text-red-500' : 'text-muted-foreground',
                        )}>
                          <span className={cn('inline-block h-1.5 w-1.5 rounded-full', match ? 'bg-green-500' : mismatch ? 'bg-red-400' : 'bg-muted-foreground')} />
                          {match ? 'Sesuai' : mismatch ? 'Beda' : '—'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Expected — full nominal shown clearly */}
                  <div className="flex flex-col justify-center border-l border-border/30 px-3 py-3.5">
                    {exp ? (
                      <>
                        <p className="text-[12px] font-bold tabular-nums text-blue-700 leading-tight">
                          {formatRupiahFull(exp.expectedAmount)}
                        </p>
                        <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                          {exp.expectedCount} transaksi
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-muted-foreground/40">—</p>
                    )}
                  </div>

                  {/* Actual — tappable */}
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onTapRow(edcName, txType, actual)}
                    className={cn(
                      'flex flex-col justify-center border-l border-border/30 px-3 py-3.5 text-left transition-colors',
                      !disabled && 'hover:bg-primary/5 active:bg-primary/10',
                      disabled && 'cursor-default',
                    )}
                  >
                    {filled ? (
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <p className={cn(
                            'text-[12px] font-bold tabular-nums leading-tight',
                            match   ? 'text-green-700'
                            : mismatch ? 'text-red-600'
                            : 'text-foreground',
                          )}>
                            {formatRupiahFull(actual!.actualAmount)}
                          </p>
                          <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                            {actual!.actualCount} transaksi
                          </p>
                        </div>
                        {!disabled && (
                          <Pencil className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn(
                          'text-[11px] font-semibold',
                          disabled ? 'text-muted-foreground/30' : 'text-primary/60',
                        )}>
                          {disabled ? '—' : 'Ketuk input'}
                        </p>
                        {!disabled && <ChevronRight className="h-3 w-3 text-primary/40" />}
                      </div>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Totals footer — only when both expected & actual filled */}
          {allFilled && totalExpected > 0 && (
            <div className={cn(
              'grid grid-cols-[1.2fr_1fr_1fr] border-t px-4 py-2.5',
              allMatch ? 'border-green-200 bg-green-50/70' : hasMismatch ? 'border-red-200 bg-red-50/60' : 'border-amber-200 bg-amber-50/60',
            )}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground self-center">Total</p>
              <div className="border-l border-border/30 pl-3 self-center">
                <p className="text-[11px] font-bold tabular-nums text-blue-700">{formatRupiahFull(totalExpected)}</p>
              </div>
              <div className="border-l border-border/30 pl-3 self-center">
                <p className={cn(
                  'text-[11px] font-bold tabular-nums',
                  allMatch ? 'text-green-700' : hasMismatch ? 'text-red-600' : 'text-amber-700',
                )}>
                  {formatRupiahFull(totalActual)}
                </p>
                {!allMatch && totalActual !== totalExpected && (
                  <p className={cn(
                    'text-[10px] font-semibold tabular-nums',
                    totalActual > totalExpected ? 'text-red-500' : 'text-amber-600',
                  )}>
                    {totalActual > totalExpected ? '+' : ''}
                    {formatRupiahFull(Math.abs(totalActual - totalExpected))}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Add custom row */}
          {!disabled && (
            <div className="border-t border-border/60 px-4 py-2.5">
              <button
                type="button"
                onClick={() => onTapAddCustom(edcName)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-primary transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah tipe lain untuk EDC {edcName}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Custom add sheet ─────────────────────────────────────────────────────────

function CustomAddSheet({
  open, edcName, usedTypes, onClose, onAdd,
}: {
  open: boolean;
  edcName: EdcName;
  usedTypes: TxType[];
  onClose: () => void;
  onAdd: (txType: TxType, amount: string, count: number) => Promise<void>;
}) {
  const [step, setStep]               = useState<'pick' | 'input'>('pick');
  const [selectedType, setSelectedType] = useState<TxType | null>(null);
  const availableTypes = TX_TYPES.filter(t => !usedTypes.includes(t));

  useEffect(() => {
    if (open) { setStep('pick'); setSelectedType(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  function pickType(t: TxType) { setSelectedType(t); setStep('input'); }

  if (step === 'input' && selectedType) {
    return (
      <InputSheet
        open={true}
        edcName={edcName}
        txType={selectedType}
        initialAmount="0"
        initialCount="1"
        onClose={onClose}
        mode="add"
        onSave={async (amount, count) => { await onAdd(selectedType, amount, count); }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-background shadow-2xl mb-16 sm:mb-0 sm:rounded-3xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden="true">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <p className="text-sm font-bold text-foreground">Tambah tipe untuk EDC {edcName}</p>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:bg-border transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-2.5">
          {availableTypes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Semua tipe sudah diinput.</p>
          ) : (
            availableTypes.map(t => {
              const Icon = TX_ICONS[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickType(t)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5 text-left hover:border-primary/30 hover:bg-primary/5 active:scale-[0.98] transition-all"
                >
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={2.5} />
                  </div>
                  <span className="text-sm font-semibold text-foreground">{TX_LABELS[t]}</span>
                  <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground/40" />
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-border px-5 pb-6 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EdcReconciliationDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const taskId  = String(params.id);

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<EdcTaskData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [expectedSnapshot,  setExpectedSnapshot]  = useState<ExpectedSnapshot | null>(null);
  const [fetchingExpected,  setFetchingExpected]  = useState(false);
  const [actualRows,        setActualRows]        = useState<ActualRow[]>([]);
  const [rowsLoading,       setRowsLoading]       = useState(true);
  const [notes,             setNotes]             = useState('');

  // Sheet state
  const [sheetTarget,  setSheetTarget]  = useState<{ edcName: EdcName; txType: TxType; existing: ActualRow | null } | null>(null);
  const [customTarget, setCustomTarget] = useState<EdcName | null>(null);

  // ── Load task ──────────────────────────────────────────────────────────────
  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tasks?: Array<{ type: string; data: EdcTaskData }> };
      const found = data.tasks?.find(t => t.type === 'edc_reconciliation' && String(t.data.id) === taskId);
      if (!found) { setTaskData(null); return; }
      setTaskData(found.data);
      setNotes(found.data.notes ?? '');
    } catch {
      toast.error('Gagal memuat data task.');
      setTaskData(null);
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { loadTask(); }, [loadTask]);

  const fetchExpected = useCallback(async () => {
    if (!taskData) return;
    setFetchingExpected(true);
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation/fetch-expected', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: Number(taskData.id) }),
      });
      const json = (await res.json()) as { success: boolean; data?: ExpectedSnapshot; error?: string };
      if (!res.ok || !json.success || !json.data) { toast.error(json.error ?? 'Gagal fetch expected data.'); return; }
      setExpectedSnapshot(json.data);
    } catch { toast.error('Koneksi gagal saat fetch expected data.'); }
    finally   { setFetchingExpected(false); }
  }, [taskData]);

  const loadRows = useCallback(async () => {
    if (!taskData) return;
    setRowsLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks/edc-reconciliation?taskId=${taskData.id}`, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as { success: boolean; data?: { rows: ActualRow[] } };
      if (json.success && json.data) setActualRows(json.data.rows ?? []);
    } catch { /* silent */ }
    finally   { setRowsLoading(false); }
  }, [taskData]);

  useEffect(() => {
    if (taskData) { fetchExpected(); loadRows(); }
  }, [taskData, fetchExpected, loadRows]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const scheduleId = taskData ? Number(taskData.scheduleId) : 0;
  const storeId    = taskData ? Number(taskData.storeId)    : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/edc-reconciliation',
    baseBody: { scheduleId },
    debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const locked     = !readonly && !!accessStatus && (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const disabled   = readonly || locked;

  // ── Group data ─────────────────────────────────────────────────────────────
  const edcGroups = useMemo(() => {
    const names = Array.from(new Set([
      ...(expectedSnapshot?.rows.map(r => r.edcName) ?? []),
      ...actualRows.map(r => r.edcName),
    ]));
    return names.map(edcName => ({
      edcName,
      expectedRows: expectedSnapshot?.rows.filter(r => r.edcName === edcName) ?? [],
      actualRows:   actualRows.filter(r => r.edcName === edcName),
    }));
  }, [expectedSnapshot, actualRows]);

  const totalSlots   = edcGroups.reduce((s, g) => s + Math.max(g.expectedRows.length, 1), 0);
  const filledSlots  = actualRows.filter(r => r.actualAmount != null).length;
  const matchedSlots = actualRows.filter(r => r.matches === true).length;

  // Grand total expected & actual
  const grandExpected = expectedSnapshot?.rows.reduce((s, r) => s + Number(r.expectedAmount), 0) ?? 0;
  const grandActual   = actualRows.reduce((s, r) => s + Number(r.actualAmount ?? 0), 0);

  // ── Row CRUD ───────────────────────────────────────────────────────────────
  async function handleSaveRow(edcName: EdcName, txType: TxType, amount: string, count: number) {
    if (!taskData) return;
    const existing = actualRows.find(r => r.edcName === edcName && r.transactionType === txType);

    const res = await fetch('/api/employee/tasks/edc-reconciliation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        op: existing ? 'update' : 'add',
        ...(existing ? { rowId: existing.id } : { taskId: Number(taskData.id) }),
        edcName, transactionType: txType,
        actualAmount: amount, actualCount: count,
      }),
    });

    const json = (await res.json()) as { success: boolean; data?: ActualRow; error?: string };
    if (!res.ok || !json.success || !json.data) { toast.error(json.error ?? 'Gagal menyimpan.'); throw new Error('save failed'); }

    setActualRows(prev => {
      const filtered = prev.filter(r => r.id !== (existing?.id ?? -1));
      return [...filtered, json.data!];
    });
    toast.success(existing ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.');
  }

  async function handleDeleteRow(rowId: number) {
    const res = await fetch('/api/employee/tasks/edc-reconciliation', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'delete', rowId }),
    });
    const json = (await res.json()) as { success: boolean; error?: string };
    if (!res.ok || !json.success) { toast.error(json.error ?? 'Gagal menghapus.'); throw new Error('delete failed'); }
    setActualRows(prev => prev.filter(r => r.id !== rowId));
    toast.success('Transaksi dihapus.');
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (!scheduleId || !storeId) { const m = 'Data task tidak valid.'; setSubmitError(m); toast.error(m); return; }
    if (actualRows.length === 0)  { const m = 'Minimal 1 transaksi EDC wajib diinput.'; setSubmitError(m); toast.error(m); return; }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, storeId, geo: geo ?? null, skipGeo: geo === null, notes: notes || undefined }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }
      const updated = (json.data ?? {}) as Partial<EdcTaskData>;
      if (updated.isBalanced === true) toast.success('EDC Reconciliation balance! ✓', { duration: 4000 });
      else toast.warning('Data tidak balance — status discrepancy.', { duration: 5000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  const canSubmit  = !locked && !readonly && actualRows.length > 0 && !!expectedSnapshot;
  const submitHint = !expectedSnapshot ? 'Menunggu data EDC dari sistem.'
    : actualRows.length === 0 ? 'Minimal 1 transaksi EDC wajib diinput.'
    : '';

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TaskHeader
        title="EDC Reconciliation"
        subtitle={taskData
          ? `${String(taskData.shift).replace('_', ' ')} shift · ${String(taskData.status).replace('_', ' ')}`
          : undefined}
        status={taskStatus}
        saveIndicator={!readonly && !loading && taskData
          ? <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
          : null}
      />

      <div className="flex-1 space-y-4 p-4 pb-36">

        {/* ── Access banner ── */}
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus} accessLoading={accessLoading}
            geoReady={geoReady} geo={geo} geoError={geoError}
            onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
          />
        )}

        {/* ── Discrepancy alert ── */}
        {taskStatus === 'discrepancy' && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div>
              <p className="text-xs font-bold text-amber-700">Status discrepancy</p>
              <p className="mt-0.5 text-xs text-amber-600">Cek row yang berbeda, lalu submit kembali.</p>
            </div>
          </div>
        )}

        {/* ── Submit error ── */}
        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 break-words text-xs text-red-600">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Auto-save error ── */}
        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {/* ── Skeleton ── */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-secondary" />)}
          </div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="space-y-4">

            {/* ── Expected data status bar ── */}
            <div className={cn(
              'flex items-center gap-3 rounded-xl border px-4 py-3 transition-colors',
              fetchingExpected  ? 'border-border bg-secondary'
              : expectedSnapshot ? 'border-blue-200 bg-blue-50'
              : 'border-amber-200 bg-amber-50',
            )}>
              {fetchingExpected ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">Memuat data EDC dari sistem…</p>
                </>
              ) : expectedSnapshot ? (
                <>
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-600" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-blue-700">Data sistem dimuat</p>
                    <p className="mt-0.5 text-[10px] text-blue-500">
                      {expectedSnapshot.rows.length} baris ·{' '}
                      {new Date(expectedSnapshot.generatedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={fetchExpected}
                    className="flex-shrink-0 rounded-lg bg-blue-100 p-1.5 text-blue-600 hover:bg-blue-200 transition-colors"
                    aria-label="Refresh"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />
                  <p className="flex-1 text-xs font-semibold text-amber-700">Data sistem belum tersedia</p>
                  <button
                    type="button"
                    onClick={fetchExpected}
                    className="flex-shrink-0 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
                  >
                    Coba lagi
                  </button>
                </>
              )}
            </div>

            {/* ── Grand total summary card ── */}
            {!rowsLoading && edcGroups.length > 0 && (
              <div className="rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
                {/* Progress bar */}
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Progress Input
                  </p>
                  <p className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {filledSlots}/{totalSlots} slot diisi · {matchedSlots} sesuai
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-500',
                      matchedSlots > 0 && matchedSlots === filledSlots ? 'bg-green-500'
                      : filledSlots > 0 ? 'bg-primary'
                      : 'bg-muted',
                    )}
                    style={{ width: totalSlots > 0 ? `${(filledSlots / totalSlots) * 100}%` : '0%' }}
                  />
                </div>

                {/* Grand totals */}
                {grandExpected > 0 && (
                  <div className="mt-3.5 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-blue-50 px-3 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-blue-400">Total Sistem</p>
                      <p className="mt-0.5 text-sm font-bold tabular-nums text-blue-700">
                        {formatRupiahFull(grandExpected)}
                      </p>
                    </div>
                    <div className={cn(
                      'rounded-xl px-3 py-2.5',
                      grandActual === 0 ? 'bg-muted'
                      : grandActual === grandExpected ? 'bg-green-50'
                      : 'bg-amber-50',
                    )}>
                      <p className={cn(
                        'text-[9px] font-bold uppercase tracking-widest',
                        grandActual === 0 ? 'text-muted-foreground'
                        : grandActual === grandExpected ? 'text-green-500'
                        : 'text-amber-500',
                      )}>
                        Total Aktual
                      </p>
                      <p className={cn(
                        'mt-0.5 text-sm font-bold tabular-nums',
                        grandActual === 0 ? 'text-muted-foreground'
                        : grandActual === grandExpected ? 'text-green-700'
                        : 'text-amber-700',
                      )}>
                        {grandActual > 0 ? formatRupiahFull(grandActual) : '—'}
                      </p>
                      {grandActual > 0 && grandActual !== grandExpected && (
                        <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-amber-500">
                          Selisih {formatRupiahFull(Math.abs(grandActual - grandExpected))}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── EDC Group cards ── */}
            {(fetchingExpected || rowsLoading) ? (
              <div className="space-y-3">
                {[1, 2].map(i => <div key={i} className="h-48 animate-pulse rounded-2xl bg-secondary" />)}
              </div>
            ) : edcGroups.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center">
                <CreditCard className="h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm font-semibold text-muted-foreground">Belum ada data EDC</p>
                <p className="text-xs text-muted-foreground/60">Data sistem akan muncul di sini.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {edcGroups.map(g => (
                  <EdcGroupCard
                    key={g.edcName}
                    edcName={g.edcName}
                    expectedRows={g.expectedRows}
                    actualRows={g.actualRows}
                    disabled={disabled}
                    onTapRow={(edcName, txType, existing) => setSheetTarget({ edcName, txType, existing })}
                    onTapAddCustom={edcName => setCustomTarget(edcName)}
                    onRemoveRow={handleDeleteRow}
                  />
                ))}
              </div>
            )}

            {/* ── Notes ── */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Catatan (opsional)
              </p>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                disabled={disabled}
                rows={3}
                placeholder="Tambahkan catatan jika ada…"
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </div>
          </div>
        )}
      </div>

      <TaskSubmitBar
        label="Submit EDC Reconciliation"
        onSubmit={handleSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        hidden={readonly || loading || !taskData}
        hint={!canSubmit ? submitHint : undefined}
      />

      {/* ── Input sheet ── */}
      {sheetTarget && (
        <InputSheet
          open={!!sheetTarget}
          edcName={sheetTarget.edcName}
          txType={sheetTarget.txType}
          initialAmount={sheetTarget.existing?.actualAmount ?? '0'}
          initialCount={sheetTarget.existing?.actualCount != null ? String(sheetTarget.existing.actualCount) : '1'}
          mode={sheetTarget.existing ? 'edit' : 'add'}
          onClose={() => setSheetTarget(null)}
          onSave={async (amount, count) => {
            await handleSaveRow(sheetTarget.edcName, sheetTarget.txType, amount, count);
          }}
          onDelete={sheetTarget.existing
            ? async () => { await handleDeleteRow(sheetTarget.existing!.id); }
            : undefined}
        />
      )}

      {/* ── Custom add sheet ── */}
      {customTarget && (
        <CustomAddSheet
          open={!!customTarget}
          edcName={customTarget}
          usedTypes={actualRows.filter(r => r.edcName === customTarget).map(r => r.transactionType)}
          onClose={() => setCustomTarget(null)}
          onAdd={async (txType, amount, count) => {
            await handleSaveRow(customTarget, txType, amount, count);
            setCustomTarget(null);
          }}
        />
      )}
    </div>
  );
}