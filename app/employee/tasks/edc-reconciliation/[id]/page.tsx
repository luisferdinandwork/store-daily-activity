'use client';
// app/employee/tasks/edc-reconciliation/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated detail page for the EDC Reconciliation task.
//
// Flow:
//   1. On mount → POST /fetch-expected to get the expected snapshot
//      (idempotent; stable across re-opens).
//   2. Show the expected snapshot as a read-only reference table.
//   3. Employee adds transaction rows via a form:
//        [type dropdown]  [amount Rp]  [count]  [+ Add]
//      Each added row is sent via PUT op=add and appended to the list.
//      Rows can be deleted (PUT op=delete).
//   4. Submit → POST to compare + set discrepancy.
//   5. After submit, rows display with green/amber highlights based on
//      `matches` flag, and discrepancy duration is shown if present.
//
// Discrepancy behavior mirrors item dropping: when the task is in
// 'discrepancy' status, the timer banner shows how long it's been open;
// once resolved, the stored duration is shown.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, X, Loader2, AlertCircle, AlertTriangle,
  Cloud, CloudOff, Save, LogIn, Navigation, NavigationOff, RefreshCw,
  Plus, Trash2, Clock, CircleCheck, CircleX, CreditCard,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
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

// ─── Rupiah helpers ───────────────────────────────────────────────────────────

function formatRupiah(raw: string | number | null | undefined): string {
  if (raw == null) return 'Rp 0';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return 'Rp 0';
  return 'Rp ' + parseInt(digits, 10).toLocaleString('id-ID');
}

function parseRupiah(formatted: string): string {
  const digits = formatted.replace(/\D/g, '');
  return digits || '0';
}

// ─── Geo + Access hooks ──────────────────────────────────────────────────────

function useGeo() {
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    setGeoReady(false);
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }
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
  geo: { lat: number; lng: number } | null,
  geoReady: boolean, taskStatus: TaskStatus | undefined,
) {
  const [accessStatus,  setAccessStatus]  = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }
    if (!scheduleId || !storeId) return;

    setAccessLoading(true);
    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      if (geo) { params.set('lat', String(geo.lat)); params.set('lng', String(geo.lng)); }
      const res  = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) fetch_(); }, [geoReady, fetch_]);
  return { accessStatus, accessLoading, refreshAccess: fetch_ };
}

// ─── Access banner (same as z-report page) ──────────────────────────────────

function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess,
}: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
      </div>
    );
  }
  if (!accessStatus) return null;
  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
        <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
          <p className="mt-0.5 text-xs text-red-600">Kamu harus absen masuk dulu.</p>
        </div>
        <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700"><RefreshCw className="h-3 w-3" />Cek ulang</button>
      </div>
    );
  }
  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">{accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).</p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700"><RefreshCw className="h-3 w-3" />Perbarui</button>
      </div>
    );
  }
  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})</p>
    </div>
  );
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50 text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50 text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud className="h-3 w-3" />Tersimpan</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Gagal</>}
    </div>
  );
}

// ─── Section helper ──────────────────────────────────────────────────────────

function Section({ title, children, right }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
        {right}
      </div>
      {children}
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

  // "Add row" form state
  const [newType,   setNewType]   = useState<TxType>('credit');
  const [newAmount, setNewAmount] = useState('0');
  const [newCount,  setNewCount]  = useState('1');
  const [addingRow, setAddingRow] = useState(false);

  const [notes, setNotes] = useState('');

  // ─── Load task metadata from /api/employee/tasks ──────────────────────────
  const loadTask = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: EdcTaskData }[] };
      const found = data.tasks?.find(t => t.type === 'edc_reconciliation' && t.data.id === taskId);
      if (found) {
        setTaskData(found.data);
        setNotes(found.data.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[EdcRecon] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { loadTask(); }, [loadTask]);

  // ─── Fetch expected snapshot on task open ──────────────────────────────────
  const fetchExpected = useCallback(async () => {
    if (!taskData) return;
    setFetchingExpected(true);
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation/fetch-expected', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId: Number(taskData.id) }),
      });
      const json = await res.json() as { success: boolean; data?: ExpectedSnapshot; error?: string };
      if (!json.success || !json.data) {
        toast.error(json.error ?? 'Gagal fetch expected data.');
        return;
      }
      setExpectedSnapshot(json.data);
    } catch (e) {
      console.error('[EdcRecon] fetchExpected error:', e);
      toast.error('Koneksi gagal saat fetch expected data.');
    } finally {
      setFetchingExpected(false);
    }
  }, [taskData]);

  // ─── Load existing actual rows for this task ───────────────────────────────
  // We piggyback on /api/employee/tasks/edc-reconciliation/fetch-expected by
  // triggering a simultaneous rows fetch — simplest is a dedicated route, but
  // to avoid another file we include rows in the task list refresh via the
  // backend: here we instead GET all task rows via the detail endpoint.
  //
  // Since there is no dedicated GET-rows endpoint, we call PUT op=add with a
  // probing request? No — instead, we persist rows through the PUT endpoint
  // and keep an optimistic in-memory list. Re-opens will lose optimistic
  // state, so we need a real GET. We'll add one: the server returns rows via
  // the existing fetchExpected endpoint's side data? Cleaner: add a GET on
  // the same path. For now we do a one-shot fetch on mount that the server
  // returns in `fetchExpected` response? Let's keep it simple and just use
  // the existing edc_reconciliation list endpoint via /api/employee/tasks
  // which doesn't include rows. We'll instead introduce a GET on the
  // detail endpoint.
  const loadRows = useCallback(async () => {
    if (!taskData) return;
    setRowsLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks/edc-reconciliation?taskId=${taskData.id}`, {
        method: 'GET',
      });
      if (res.ok) {
        const json = await res.json() as { success: boolean; data?: { rows: ActualRow[] } };
        if (json.success && json.data) setActualRows(json.data.rows);
      }
    } catch (e) {
      console.warn('[EdcRecon] rows GET not available, starting empty', e);
    } finally {
      setRowsLoading(false);
    }
  }, [taskData]);

  useEffect(() => {
    if (taskData) {
      fetchExpected();
      loadRows();
    }
  }, [taskData, fetchExpected, loadRows]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '',
    geo, geoReady, taskData?.status,
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
  const locked =
    !readonly &&
    !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  // ─── Row CRUD ──────────────────────────────────────────────────────────────

  async function addRow() {
    if (!taskData) return;
    const amountNum = Number(newAmount);
    const countNum  = parseInt(newCount, 10);
    if (!isFinite(amountNum) || amountNum <= 0) {
      toast.error('Nominal harus angka positif.'); return;
    }
    if (!isFinite(countNum) || countNum <= 0) {
      toast.error('Jumlah transaksi harus angka positif.'); return;
    }

    setAddingRow(true);
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          op:              'add',
          taskId:          Number(taskData.id),
          transactionType: newType,
          actualAmount:    newAmount,
          actualCount:     countNum,
        }),
      });
      const json = await res.json() as { success: boolean; data?: ActualRow; error?: string };
      if (!json.success || !json.data) {
        toast.error(json.error ?? 'Gagal menambah row.'); return;
      }
      setActualRows(prev => [...prev, json.data!]);
      setNewAmount('0');
      setNewCount('1');
      toast.success('Row ditambahkan.');
    } catch (e) {
      console.error('[EdcRecon] addRow error:', e);
      toast.error('Koneksi gagal.');
    } finally {
      setAddingRow(false);
    }
  }

  async function removeRow(rowId: number) {
    try {
      const res = await fetch('/api/employee/tasks/edc-reconciliation', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ op: 'delete', rowId }),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (!json.success) {
        toast.error(json.error ?? 'Gagal menghapus row.'); return;
      }
      setActualRows(prev => prev.filter(r => r.id !== rowId));
    } catch (e) {
      console.error('[EdcRecon] removeRow error:', e);
      toast.error('Koneksi gagal.');
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────

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
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId, storeId,
          geo: geo ?? null, skipGeo: geo === null,
          notes: notes || undefined,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const serverMsg =
          (typeof json.error   === 'string' && json.error) ||
          (typeof json.message === 'string' && json.message) || `HTTP ${res.status}`;
        setSubmitError(serverMsg);
        toast.error(serverMsg, { duration: 6000 });
        return;
      }
      const updated = (json.data ?? {}) as EdcTaskData;
      if (updated?.isBalanced === true) {
        toast.success('EDC Reconciliation balanced! ✓', { duration: 4000 });
      } else {
        toast.warning('Data tidak balance — task masuk ke status discrepancy.', { duration: 5000 });
      }
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !locked && actualRows.length > 0 && !!expectedSnapshot;

  // ─── Derived: expected-by-type lookup for row comparison ──────────────────
  const expectedByType = new Map<TxType, ExpectedRow>();
  expectedSnapshot?.rows.forEach(r => expectedByType.set(r.transactionType, r));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">EDC Reconciliation</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {taskData.status.replace('_',' ')}</p>}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} />}
        {taskStatus === 'discrepancy' && <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" />Discrepancy</span>}
        {taskStatus === 'completed'   && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'    && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'    && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 p-4 pb-10">
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
            'flex items-start gap-3 rounded-xl border px-4 py-3',
            taskData.discrepancyResolvedAt
              ? 'border-green-200 bg-green-50'
              : 'border-amber-300 bg-amber-50',
          )}>
            <Clock className={cn('mt-0.5 h-5 w-5 flex-shrink-0', taskData.discrepancyResolvedAt ? 'text-green-600' : 'text-amber-600')} />
            <div className="flex-1 min-w-0">
              <p className={cn('text-sm font-bold', taskData.discrepancyResolvedAt ? 'text-green-700' : 'text-amber-700')}>
                {taskData.discrepancyResolvedAt ? 'Discrepancy terselesaikan' : 'Task dalam status discrepancy'}
              </p>
              <p className={cn('mt-0.5 text-xs', taskData.discrepancyResolvedAt ? 'text-green-600' : 'text-amber-600')}>
                Dimulai: {taskData.discrepancyStartedAt ? new Date(taskData.discrepancyStartedAt).toLocaleString('id-ID') : '-'}
                {taskData.discrepancyResolvedAt && (
                  <> · Selesai: {new Date(taskData.discrepancyResolvedAt).toLocaleString('id-ID')}</>
                )}
                {taskData.discrepancyDurationMinutes != null && (
                  <> · Durasi: {taskData.discrepancyDurationMinutes} menit</>
                )}
              </p>
            </div>
          </div>
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <>
            {/* Expected snapshot (read-only reference) */}
            <Section
              title="Data Sistem (Expected)"
              right={
                fetchingExpected
                  ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  : expectedSnapshot
                    ? <span className="text-[10px] text-muted-foreground">{expectedSnapshot.rows.length} tipe</span>
                    : null
              }
            >
              {!expectedSnapshot ? (
                <div className="rounded-xl border border-border bg-secondary px-4 py-6 text-center">
                  <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  <p className="mt-2 text-xs text-muted-foreground">Mengambil data dari sistem…</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary">
                      <tr>
                        <th className="px-3 py-2 text-left font-bold text-muted-foreground">Tipe</th>
                        <th className="px-3 py-2 text-right font-bold text-muted-foreground">Nominal</th>
                        <th className="px-3 py-2 text-right font-bold text-muted-foreground">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expectedSnapshot.rows.map(r => (
                        <tr key={r.transactionType} className="border-t border-border">
                          <td className="px-3 py-2 font-semibold">{TX_LABELS[r.transactionType]}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(r.expectedAmount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.expectedCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Data di atas diambil dari sistem back-office. Input data dari mesin EDC di bawah dan pastikan cocok.
              </p>
            </Section>

            {/* Actual rows */}
            <Section
              title="Input dari Mesin EDC (Actual)"
              right={<span className="text-[10px] text-muted-foreground">{actualRows.length} row</span>}
            >
              {rowsLoading ? (
                <div className="h-14 animate-pulse rounded-xl bg-secondary" />
              ) : actualRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center">
                  <CreditCard className="mx-auto h-5 w-5 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">Belum ada row. Tambah di bawah.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {actualRows.map(row => {
                    const exp       = expectedByType.get(row.transactionType);
                    const submitted = row.matches != null;
                    const matches   = row.matches === true;
                    return (
                      <div
                        key={row.id}
                        className={cn(
                          'flex items-center gap-3 rounded-xl border px-3 py-3',
                          submitted
                            ? matches
                              ? 'border-green-200 bg-green-50'
                              : 'border-amber-300 bg-amber-50'
                            : 'border-border bg-card',
                        )}
                      >
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-secondary">
                          {submitted ? (
                            matches
                              ? <CircleCheck className="h-5 w-5 text-green-600" />
                              : <CircleX    className="h-5 w-5 text-amber-600" />
                          ) : (
                            <CreditCard className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{TX_LABELS[row.transactionType]}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                            {formatRupiah(row.actualAmount)} · {row.actualCount ?? 0} tx
                          </p>
                          {submitted && !matches && exp && (
                            <p className="mt-0.5 text-[10px] text-amber-700">
                              Expected: {formatRupiah(exp.expectedAmount)} · {exp.expectedCount} tx
                            </p>
                          )}
                        </div>
                        {!dis && (
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add row form */}
              {!dis && (
                <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tambah Row</p>
                  <select
                    value={newType}
                    onChange={e => setNewType(e.target.value as TxType)}
                    className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {(Object.keys(TX_LABELS) as TxType[]).map(t => (
                      <option key={t} value={t}>{TX_LABELS[t]}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatRupiah(newAmount)}
                      onChange={e => setNewAmount(parseRupiah(e.target.value))}
                      onFocus={e => {
                        const el = e.target;
                        const len = el.value.length;
                        requestAnimationFrame(() => el.setSelectionRange(len, len));
                      }}
                      placeholder="Rp 0"
                      className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <input
                      type="number"
                      min={1}
                      value={newCount}
                      onChange={e => setNewCount(e.target.value)}
                      placeholder="Jumlah"
                      className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={addRow}
                    disabled={addingRow}
                    className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary/10 text-sm font-bold text-primary hover:bg-primary/20 disabled:opacity-40"
                  >
                    {addingRow
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Menambah…</>
                      : <><Plus className="h-4 w-4" />Tambah Row</>}
                  </button>
                </div>
              )}
            </Section>

            <Section title="Catatan (opsional)">
              <textarea
                value={notes}
                onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                disabled={dis}
                rows={3}
                placeholder="Tambahkan catatan jika ada…"
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </Section>

            {!readonly && (
              <>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || submitting}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40"
                >
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Memeriksa…</>
                    : <><CheckCircle2 className="h-4 w-4" />Submit & Bandingkan</>}
                </button>
                {!canSubmit && !locked && actualRows.length === 0 && (
                  <p className="text-center text-[11px] text-muted-foreground">Tambah minimal 1 row untuk submit.</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}