'use client';
// app/employee/tasks/edc-reconciliation/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, X, Loader2, AlertCircle, AlertTriangle,
  Cloud, CloudOff, LogIn, Navigation, NavigationOff, RefreshCw,
  Plus, Trash2, Clock, CreditCard, ChevronRight, TriangleAlert,
  Banknote,
  Landmark,
  QrCode,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';
type TxType = 'credit' | 'debit' | 'qris' | 'ewallet' | 'cash';

const TX_LABELS: Record<TxType, string> = {
  credit:  'Kartu Kredit',
  debit:   'Kartu Debit',
  qris:    'QRIS',
  ewallet: 'E-Wallet',
  cash:    'Tunai',
};

const TX_ICONS: Record<TxType, React.ElementType> = {
  credit:  CreditCard,
  debit:   Landmark,
  qris:    QrCode,
  ewallet: Wallet,
  cash:    Banknote,
};

const TX_SHORT_LABELS: Record<TxType, string> = {
  credit:  'Kredit',
  debit:   'Debit',
  qris:    'QRIS',
  ewallet: 'E-Wallet',
  cash:    'Tunai',
};

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface EdcTaskData {
  id:          string;
  scheduleId:  string;
  userId:      string;
  storeId:     string;
  shift:       'morning' | 'evening';
  date:        string;
  status:      TaskStatus;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
  parentTaskId: number | null;
  isBalanced:  boolean | null;
  expectedFetchedAt:          string | null;
  discrepancyStartedAt:       string | null;
  discrepancyResolvedAt:      string | null;
  discrepancyDurationMinutes: number | null;
}

interface ExpectedRow {
  transactionType: TxType;
  expectedAmount:  number;
  expectedCount:   number;
}
interface ExpectedSnapshot {
  rows: ExpectedRow[];
  generatedAt: string;
  seed: number;
}

interface ActualRow {
  id:              number;
  edcTaskId:       number;
  transactionType: TxType;
  expectedAmount:  string | null;
  expectedCount:   number | null;
  actualAmount:    string | null;
  actualCount:     number | null;
  matches:         boolean | null;
  notes:           string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRupiah(raw: string | number | null | undefined): string {
  if (raw == null) return 'Rp 0';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 'Rp 0';
  const num = parseInt(digits, 10);
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(1)}jt`;
  if (num >= 1_000)     return `Rp ${(num / 1_000).toFixed(0)}rb`;
  return 'Rp ' + num.toLocaleString('id-ID');
}

function formatRupiahFull(raw: string | number | null | undefined): string {
  if (raw == null) return 'Rp 0';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 'Rp 0';
  return 'Rp ' + parseInt(digits, 10).toLocaleString('id-ID');
}

function parseRupiah(formatted: string): string {
  return formatted.replace(/\D/g, '') || '0';
}

// ─── Geo hooks ─────────────────────────────────────────────────────────────────

function useGeo() {
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
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
  const [accessStatus,  setAccessStatus]  = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' }); setAccessLoading(false); return;
    }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      if (geo) { params.set('lat', String(geo.lat)); params.set('lng', String(geo.lng)); }
      const res  = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally   { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) fetch_(); }, [geoReady, fetch_]);
  return { accessStatus, accessLoading, refreshAccess: fetch_ };
}

// ─── Access Banner ────────────────────────────────────────────────────────────

function AccessBanner({ accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess }: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
    </div>
  );
  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') return (
    <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-red-100">
        <LogIn className="h-4 w-4 text-red-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-red-700">Belum absen masuk</p>
        <p className="text-[11px] text-red-500 mt-0.5">Absen masuk dulu untuk melanjutkan</p>
      </div>
      <button onClick={onRefreshAccess} className="flex items-center gap-1 rounded-xl bg-red-100 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Cek
      </button>
    </div>
  );

  if (accessStatus.status === 'outside_geofence') return (
    <div className="flex items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-orange-100">
        <NavigationOff className="h-4 w-4 text-orange-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-orange-700">Di luar area toko</p>
        <p className="text-[11px] text-orange-500 mt-0.5">{accessStatus.distanceM}m · batas {accessStatus.radiusM}m</p>
      </div>
      <button onClick={onRefreshGeo} className="flex items-center gap-1 rounded-xl bg-orange-100 px-3 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Perbarui
      </button>
    </div>
  );

  if (accessStatus.status === 'geo_unavailable') return (
    <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <NavigationOff className="h-4 w-4 text-amber-600 flex-shrink-0" />
      <p className="text-xs text-amber-700">{geoError ?? 'Izin lokasi belum diberikan.'}</p>
    </div>
  );

  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi OK · {geo?.lat.toFixed(4)}, {geo?.lng.toFixed(4)}
      </p>
    </div>
  );
}

// ─── Unified Comparison Table ─────────────────────────────────────────────────

interface ComparisonRowData {
  type: TxType;
  expected: ExpectedRow | null;
  actual: ActualRow | null;
}

function ComparisonTable({
  expectedSnapshot,
  actualRows,
  fetchingExpected,
  rowsLoading,
  dis,
  onRemoveRow,
}: {
  expectedSnapshot: ExpectedSnapshot | null;
  actualRows: ActualRow[];
  fetchingExpected: boolean;
  rowsLoading: boolean;
  dis: boolean;
  onRemoveRow: (id: number) => void;
}) {
  const allTypes = Array.from(new Set([
    ...(expectedSnapshot?.rows.map(r => r.transactionType) ?? []),
    ...actualRows.map(r => r.transactionType),
  ])) as TxType[];

  const rows: ComparisonRowData[] = allTypes.map(type => ({
    type,
    expected: expectedSnapshot?.rows.find(r => r.transactionType === type) ?? null,
    actual:   actualRows.find(r => r.transactionType === type) ?? null,
  }));

  if (fetchingExpected || rowsLoading) {
    return (
      <div className="space-y-2">
        {[1,2,3].map(i => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/60" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border py-10 text-center">
        <CreditCard className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-sm font-medium text-muted-foreground">Belum ada data</p>
        <p className="text-xs text-muted-foreground/60">Tambah transaksi di bawah</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Column headers */}
      <div className="grid grid-cols-[88px_1fr_1fr] border-b border-border bg-muted/40">
        <div className="px-2.5 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tipe</p>
        </div>
        <div className="border-l border-border px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-blue-600/70">Sistem</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">Nominal · Jml</p>
        </div>
        <div className="border-l border-border px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-foreground/70">Aktual EDC</p>
          <p className="text-[9px] text-muted-foreground/60 mt-0.5">Nominal · Jml</p>
        </div>
      </div>

      {/* Rows */}
      {rows.map((row, idx) => {
        const submitted = row.actual?.matches != null;
        const matches   = row.actual?.matches === true;
        const hasActual = row.actual != null;

        const rowBg = submitted
          ? matches
            ? 'bg-green-50/60'
            : 'bg-amber-50/60'
          : '';

        return (
          <div
            key={row.type}
            className={cn(
              'grid grid-cols-[88px_1fr_1fr] transition-colors',
              idx !== 0 && 'border-t border-border/60',
              rowBg,
            )}
          >
            {/* Type */}
            <div className="flex items-center gap-1.5 px-2.5 py-3">
              {(() => {
                const Icon = TX_ICONS[row.type];
                return (
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-3 w-3 text-muted-foreground" strokeWidth={2.5} />
                  </div>
                );
              })()}
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-foreground leading-tight truncate">
                  {TX_SHORT_LABELS[row.type]}
                </p>
                {submitted && (
                  <div className={cn(
                    'mt-0.5 flex items-center gap-0.5 text-[9px] font-semibold',
                    matches ? 'text-green-600' : 'text-amber-600',
                  )}>
                    <div className={cn('h-1 w-1 rounded-full', matches ? 'bg-green-500' : 'bg-amber-500')} />
                    {matches ? 'OK' : 'Beda'}
                  </div>
                )}
              </div>
            </div>

            {/* Expected */}
            <div className={cn(
              'flex items-center border-l border-border/60 px-3 py-3',
              !row.expected && 'opacity-30',
            )}>
              {row.expected ? (
                <div>
                  <p className="text-[11px] font-semibold tabular-nums text-blue-700">
                    {formatRupiah(row.expected.expectedAmount)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                    {row.expected.expectedCount} tx
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">—</p>
              )}
            </div>

            {/* Actual */}
            <div className="flex items-center border-l border-border/60 px-3 py-3">
              {hasActual ? (
                <div className="flex w-full items-center justify-between gap-1">
                  <div>
                    <p className={cn(
                      'text-[11px] font-semibold tabular-nums',
                      submitted ? (matches ? 'text-green-700' : 'text-amber-700') : 'text-foreground',
                    )}>
                      {formatRupiah(row.actual!.actualAmount)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {row.actual!.actualCount ?? 0} tx
                    </p>
                  </div>
                  {!dis && (
                    <button
                      type="button"
                      onClick={() => onRemoveRow(row.actual!.id)}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground/40 hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/40 italic">Belum diinput</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Summary footer — only when there are submitted rows */}
      {actualRows.some(r => r.matches != null) && (
        <div className="border-t border-border bg-muted/30 px-4 py-2.5">
          <div className="flex items-center gap-3">
            {(() => {
              const matched  = actualRows.filter(r => r.matches === true).length;
              const total    = actualRows.filter(r => r.matches != null).length;
              const allMatch = matched === total && total > 0;
              return (
                <>
                  <div className={cn('h-2 flex-1 overflow-hidden rounded-full bg-muted', )}>
                    <div
                      className={cn('h-full rounded-full transition-all', allMatch ? 'bg-green-500' : 'bg-amber-400')}
                      style={{ width: total > 0 ? `${(matched / total) * 100}%` : '0%' }}
                    />
                  </div>
                  <p className="text-[10px] font-bold tabular-nums text-muted-foreground">
                    {matched}/{total} sesuai
                  </p>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Row Form ─────────────────────────────────────────────────────────────

function AddRowForm({ onAdd, disabled }: {
  onAdd: (type: TxType, amount: string, count: number) => Promise<void>;
  disabled: boolean;
}) {
  const [newType,   setNewType]   = useState<TxType>('credit');
  const [newAmount, setNewAmount] = useState('0');
  const [newCount,  setNewCount]  = useState('1');
  const [adding,    setAdding]    = useState(false);

  async function handleAdd() {
    const amountNum = Number(newAmount);
    const countNum  = parseInt(newCount, 10);
    if (!isFinite(amountNum) || amountNum <= 0) { toast.error('Nominal harus angka positif.'); return; }
    if (!isFinite(countNum)  || countNum  <= 0) { toast.error('Jumlah transaksi harus angka positif.'); return; }
    setAdding(true);
    try {
      await onAdd(newType, newAmount, countNum);
      setNewAmount('0');
      setNewCount('1');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Tambah Transaksi
      </p>

      {/* Type selector as chips */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(TX_LABELS) as TxType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setNewType(t)}
            className={cn(
              'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all',
              newType === t
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/60 text-muted-foreground hover:bg-muted',
            )}
          >
            {(() => {
              const Icon = TX_ICONS[t];
              return <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />;
            })()}
            {TX_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground">Nominal</label>
          <input
            type="text"
            inputMode="numeric"
            value={formatRupiahFull(newAmount)}
            onChange={e => setNewAmount(parseRupiah(e.target.value))}
            onFocus={e => { const el = e.target; const len = el.value.length; requestAnimationFrame(() => el.setSelectionRange(len, len)); }}
            className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-muted-foreground">Jumlah tx</label>
          <input
            type="number"
            min={1}
            value={newCount}
            onChange={e => setNewCount(e.target.value)}
            className="w-full rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 transition-shadow"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleAdd}
        disabled={adding || disabled}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40 hover:opacity-90 shadow-sm"
      >
        {adding
          ? <><Loader2 className="h-4 w-4 animate-spin" />Menambah…</>
          : <><Plus className="h-4 w-4" />Tambah ke Tabel</>}
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EdcReconciliationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<EdcTaskData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [expectedSnapshot, setExpectedSnapshot] = useState<ExpectedSnapshot | null>(null);
  const [fetchingExpected, setFetchingExpected] = useState(false);

  const [actualRows, setActualRows] = useState<ActualRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(true);

  const [notes, setNotes] = useState('');

  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: EdcTaskData }[] };
      const found = data.tasks?.find(t => t.type === 'edc_reconciliation' && t.data.id === taskId);
      if (found) { setTaskData(found.data); setNotes(found.data.notes ?? ''); }
      else        { setTaskData(null); }
    } catch (e) {
      console.error('[EdcRecon] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { loadTask(); }, [loadTask]);

  const fetchExpected = useCallback(async () => {
    if (!taskData) return;
    setFetchingExpected(true);
    try {
      const res  = await fetch('/api/employee/tasks/edc-reconciliation/fetch-expected', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: Number(taskData.id) }),
      });
      const json = await res.json() as { success: boolean; data?: ExpectedSnapshot; error?: string };
      if (!json.success || !json.data) { toast.error(json.error ?? 'Gagal fetch expected data.'); return; }
      setExpectedSnapshot(json.data);
    } catch (e) {
      console.error('[EdcRecon] fetchExpected error:', e);
      toast.error('Koneksi gagal saat fetch expected data.');
    } finally { setFetchingExpected(false); }
  }, [taskData]);

  const loadRows = useCallback(async () => {
    if (!taskData) return;
    setRowsLoading(true);
    try {
      const res  = await fetch(`/api/employee/tasks/edc-reconciliation?taskId=${taskData.id}`);
      if (res.ok) {
        const json = await res.json() as { success: boolean; data?: { rows: ActualRow[] } };
        if (json.success && json.data) setActualRows(json.data.rows);
      }
    } catch (e) { console.warn('[EdcRecon] rows GET not available, starting empty', e); }
    finally     { setRowsLoading(false); }
  }, [taskData]);

  useEffect(() => {
    if (taskData) { fetchExpected(); loadRows(); }
  }, [taskData, fetchExpected, loadRows]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  const { status: saveStatus, error: saveError, save: autoSave } = useAutoSave({
    url:        '/api/employee/tasks/edc-reconciliation',
    baseBody:   { scheduleId },
    debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked     =
    !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  async function addRow(type: TxType, amount: string, count: number) {
    if (!taskData) return;
    const res  = await fetch('/api/employee/tasks/edc-reconciliation', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'add', taskId: Number(taskData.id), transactionType: type, actualAmount: amount, actualCount: count }),
    });
    const json = await res.json() as { success: boolean; data?: ActualRow; error?: string };
    if (!json.success || !json.data) { toast.error(json.error ?? 'Gagal menambah row.'); return; }
    setActualRows(prev => [...prev, json.data!]);
    toast.success('Transaksi ditambahkan.');
  }

  async function removeRow(rowId: number) {
    try {
      const res  = await fetch('/api/employee/tasks/edc-reconciliation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'delete', rowId }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) { toast.error(json.error ?? 'Gagal menghapus row.'); return; }
      setActualRows(prev => prev.filter(r => r.id !== rowId));
    } catch (e) { console.error('[EdcRecon] removeRow error:', e); toast.error('Koneksi gagal.'); }
  }

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (actualRows.length === 0) {
      const msg = 'Minimal 1 transaksi wajib diinput.';
      setSubmitError(msg); toast.error(msg); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, storeId, geo: geo ?? null, skipGeo: geo === null, notes: notes || undefined }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const serverMsg = (typeof json.error === 'string' && json.error) || (typeof json.message === 'string' && json.message) || `HTTP ${res.status}`;
        setSubmitError(serverMsg); toast.error(serverMsg, { duration: 6000 }); return;
      }
      const updated = (json.data ?? {}) as EdcTaskData;
      if (updated?.isBalanced === true) toast.success('EDC Reconciliation balanced! ✓', { duration: 4000 });
      else                               toast.warning('Data tidak balance — masuk status discrepancy.', { duration: 5000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  const canSubmit = !locked && actualRows.length > 0 && !!expectedSnapshot;

  // Status chip
  const statusChip = () => {
    if (taskStatus === 'discrepancy') return (
      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
        <AlertTriangle className="h-3 w-3" />Discrepancy
      </span>
    );
    if (taskStatus === 'completed') return (
      <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700">
        <CheckCircle2 className="h-3 w-3" />Selesai
      </span>
    );
    if (taskStatus === 'verified') return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />Terverifikasi
      </span>
    );
    if (taskStatus === 'rejected') return (
      <span className="flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-700">
        <AlertCircle className="h-3 w-3" />Ditolak
      </span>
    );
    return null;
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-border/60 bg-card/80 backdrop-blur-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-muted/60 text-foreground hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <p className="truncate text-sm font-bold text-foreground">EDC Reconciliation</p>
            </div>
            {taskData && (
              <p className="text-[10px] capitalize text-muted-foreground mt-0.5">
                Shift {taskData.shift === 'morning' ? 'Pagi' : 'Sore'} · {taskData.date}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Save indicator */}
            {!readonly && !loading && taskData && saveStatus !== 'idle' && (
              <div className={cn(
                'flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold',
                saveStatus === 'saving' && 'text-blue-600',
                saveStatus === 'saved'  && 'text-green-700',
                saveStatus === 'error'  && 'text-red-600',
              )}>
                {saveStatus === 'saving' && <Loader2 className="h-3 w-3 animate-spin" />}
                {saveStatus === 'saved'  && <Cloud className="h-3 w-3" />}
                {saveStatus === 'error'  && <CloudOff className="h-3 w-3" />}
              </div>
            )}
            {statusChip()}
          </div>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 space-y-4 p-4 pb-10 max-w-lg mx-auto w-full">

        {/* Access banner */}
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus} accessLoading={accessLoading}
            geoReady={geoReady} geo={geo} geoError={geoError}
            onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
          />
        )}

        {/* Discrepancy banner */}
        {taskData && (taskData.discrepancyStartedAt || taskStatus === 'discrepancy') && (
          <div className={cn(
            'rounded-2xl border px-4 py-3.5',
            taskData.discrepancyResolvedAt
              ? 'border-green-200 bg-green-50'
              : 'border-amber-200 bg-amber-50',
          )}>
            <div className="flex items-start gap-3">
              <div className={cn(
                'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl',
                taskData.discrepancyResolvedAt ? 'bg-green-100' : 'bg-amber-100',
              )}>
                <Clock className={cn('h-4 w-4', taskData.discrepancyResolvedAt ? 'text-green-600' : 'text-amber-600')} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('text-xs font-bold', taskData.discrepancyResolvedAt ? 'text-green-700' : 'text-amber-700')}>
                  {taskData.discrepancyResolvedAt ? 'Discrepancy terselesaikan' : 'Task dalam status discrepancy'}
                </p>
                <div className={cn('mt-1.5 space-y-0.5 text-[11px]', taskData.discrepancyResolvedAt ? 'text-green-600' : 'text-amber-600')}>
                  {taskData.discrepancyStartedAt && (
                    <p>Dimulai: {new Date(taskData.discrepancyStartedAt).toLocaleString('id-ID')}</p>
                  )}
                  {taskData.discrepancyResolvedAt && (
                    <p>Selesai: {new Date(taskData.discrepancyResolvedAt).toLocaleString('id-ID')}</p>
                  )}
                  {taskData.discrepancyDurationMinutes != null && (
                    <p className="font-semibold">Durasi: {taskData.discrepancyDurationMinutes} menit</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        {submitError && (
          <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-[11px] text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="text-red-300 hover:text-red-500 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {saveError && !readonly && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-500" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
            <p className="mt-1 text-[11px] text-red-600">{taskData.notes}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/60" />)}
          </div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-24 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-semibold text-muted-foreground">Task tidak ditemukan</p>
          </div>
        ) : (
          <>
            {/* ── Unified Comparison Table ─────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Rekonsiliasi EDC
                </p>
                {expectedSnapshot && (
                  <p className="text-[10px] text-muted-foreground">
                    {actualRows.length} dari {expectedSnapshot.rows.length} tipe diinput
                  </p>
                )}
              </div>

              <ComparisonTable
                expectedSnapshot={expectedSnapshot}
                actualRows={actualRows}
                fetchingExpected={fetchingExpected}
                rowsLoading={rowsLoading}
                dis={dis}
                onRemoveRow={removeRow}
              />

              {expectedSnapshot && (
                <p className="text-[10px] text-muted-foreground/60 px-1">
                  Data sistem diambil per {new Date(expectedSnapshot.generatedAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}.
                  Input nominal dari mesin EDC pada kolom Aktual.
                </p>
              )}
            </div>

            {/* ── Add Row Form ─────────────────────────────────────────── */}
            {!dis && (
              <AddRowForm onAdd={addRow} disabled={!expectedSnapshot} />
            )}

            {/* ── Notes ────────────────────────────────────────────────── */}
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Catatan <span className="font-normal normal-case">(opsional)</span>
              </p>
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                disabled={dis}
                rows={3}
                placeholder="Tambahkan catatan jika ada perbedaan atau kondisi khusus…"
                className="w-full resize-none rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 transition-shadow"
              />
            </div>

            {/* ── Submit ───────────────────────────────────────────────── */}
            {!readonly && (
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm transition-all active:scale-[0.98] disabled:opacity-40 hover:opacity-90"
                >
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Memeriksa…</>
                    : <><CheckCircle2 className="h-4 w-4" />Submit & Bandingkan</>}
                </button>

                {!canSubmit && !locked && actualRows.length === 0 && (
                  <p className="text-center text-[11px] text-muted-foreground">
                    Tambah minimal 1 transaksi untuk submit.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}