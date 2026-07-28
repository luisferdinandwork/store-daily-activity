'use client';
// app/employee/tasks/cek-uang-modal/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  CloudOff,
  Loader2,
  LogIn,
  Navigation,
  NavigationOff,
  RefreshCw,
  Save,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'not_started'
  | 'in_progress'
  | 'completed'
  | 'pending'
  | 'verified'
  | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface CekUangModalDenomination {
  id?: string;
  taskId?: string;
  userId?: string;
  storeId?: string;
  denominationValue: number;
  quantity: number;
  amount?: string | null;
  notes?: string | null;
  createdAt?: string | null;
}

interface CekUangModalData {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day' | string;
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  totalAmount: string | null;
  maxAmount?: string | null;
  remainingAmount?: string | null;
  denominations: CekUangModalDenomination[];
}

const MAX_UANG_MODAL_TOTAL = 500_000;

const DEFAULT_DENOMINATIONS = [
  100_000,
  50_000,
  20_000,
  10_000,
  5_000,
  2_000,
  1_000,
  500,
  200,
  100,
] as const;

function formatRupiah(value: number | string | null | undefined) {
  const amount = Number(value ?? 0);
  return `Rp ${amount.toLocaleString('id-ID')}`;
}

function toQty(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function buildDenominationRows(
  existing: CekUangModalDenomination[] | undefined,
): CekUangModalDenomination[] {
  const byValue = new Map<number, CekUangModalDenomination>();

  for (const row of existing ?? []) {
    byValue.set(Number(row.denominationValue), {
      ...row,
      denominationValue: Number(row.denominationValue),
      quantity: toQty(row.quantity),
    });
  }

  return DEFAULT_DENOMINATIONS.map((denominationValue) => {
    const current = byValue.get(denominationValue);

    return {
      id: current?.id,
      taskId: current?.taskId,
      userId: current?.userId,
      storeId: current?.storeId,
      denominationValue,
      quantity: current?.quantity ?? 0,
      amount: current?.amount ?? String(denominationValue * (current?.quantity ?? 0)),
      notes: current?.notes ?? null,
      createdAt: current?.createdAt ?? null,
    };
  });
}

function payloadRows(rows: CekUangModalDenomination[]) {
  return rows.map((row) => ({
    denominationValue: row.denominationValue,
    quantity: toQty(row.quantity),
    notes: row.notes || undefined,
  }));
}

function totalRows(rows: CekUangModalDenomination[]) {
  return rows.reduce(
    (sum, row) => sum + row.denominationValue * toQty(row.quantity),
    0,
  );
}

function parseMoney(value: number | string | null | undefined, fallback: number) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}


function fmt(iso: string | null | undefined) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo(required: boolean) {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    if (!required) {
      setGeo(null);
      setGeoError(null);
      setGeoReady(true);
      return;
    }
    setGeoReady(false);
    setGeoError(null);

    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoReady(true);
      },
      () => {
        setGeoError('Lokasi tidak dapat diperoleh.');
        setGeoReady(true);
      },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { geo, geoError, geoReady, refresh };
}

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: { lat: number; lng: number } | null,
  geoReady: boolean,
  taskStatus: TaskStatus | undefined,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }

    if (!scheduleId || !storeId) return;

    setAccessLoading(true);

    try {
      const params = new URLSearchParams({ scheduleId, storeId });

      if (geo) {
        params.set('lat', String(geo.lat));
        params.set('lng', String(geo.lng));
      }

      const res = await fetch(`/api/employee/tasks/access?${params}`);
      const data = (await res.json()) as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => {
    if (geoReady) void fetchAccess();
  }, [geoReady, fetchAccess]);

  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Small UI components ──────────────────────────────────────────────────────

function AccessBanner({
  accessStatus,
  accessLoading,
  geoReady,
  geo,
  geoError,
  onRefreshGeo,
  onRefreshAccess,
}: {
  accessStatus: AccessStatus | null;
  accessLoading: boolean;
  geoReady: boolean;
  geo: { lat: number; lng: number } | null;
  geoError: string | null;
  onRefreshGeo: () => void;
  onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}
        </p>
      </div>
    );
  }

  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
        <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
          <p className="mt-0.5 text-xs text-red-600">
            Lakukan absensi masuk terlebih dahulu.
          </p>
        </div>
        <button
          onClick={onRefreshAccess}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200"
        >
          <RefreshCw className="h-3 w-3" />
          Cek ulang
        </button>
      </div>
    );
  }

  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).
          </p>
        </div>
        <button
          onClick={onRefreshGeo}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200"
        >
          <RefreshCw className="h-3 w-3" />
          Perbarui
        </button>
      </div>
    );
  }

  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">
            {geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan tanpa rekam lokasi.
          </p>
        </div>
        <button
          onClick={onRefreshGeo}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200"
        >
          <RefreshCw className="h-3 w-3" />
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}

function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') {
    return null;
  }

  const isCheckIn = accessStatus.status === 'not_checked_in';

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/70 backdrop-blur-[2px]">
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full',
          isCheckIn ? 'bg-red-100' : 'bg-orange-100',
        )}
      >
        {isCheckIn ? (
          <LogIn className="h-6 w-6 text-red-600" />
        ) : (
          <NavigationOff className="h-6 w-6 text-orange-600" />
        )}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-orange-700')}>
        {isCheckIn ? 'Absen masuk dulu' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}

function DenominationRow({
  row,
  disabled,
  maxQuantity,
  onQuantityChange,
}: {
  row: CekUangModalDenomination;
  disabled?: boolean;
  maxQuantity: number;
  onQuantityChange: (quantity: number) => void;
}) {
  const quantity = toQty(row.quantity);
  const amount = row.denominationValue * quantity;

  return (
    <div
      className={cn(
        'rounded-2xl border p-3 transition-colors',
        quantity > 0
          ? 'border-primary/30 bg-primary/5'
          : 'border-border bg-card',
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-secondary">
          <Wallet className="h-5 w-5 text-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">
            {formatRupiah(row.denominationValue)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Subtotal: {formatRupiah(amount)}
          </p>
          {!disabled && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Maks qty saat ini: {maxQuantity.toLocaleString('id-ID')}
            </p>
          )}
        </div>

        <div className="w-24 shrink-0">
          <label className="mb-1 block text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Qty
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max={maxQuantity}
            step="1"
            value={quantity === 0 ? '' : quantity}
            disabled={disabled}
            onChange={(e) => onQuantityChange(toQty(e.target.value))}
            placeholder="0"
            className="h-10 w-full rounded-xl border border-border bg-secondary px-3 text-right text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CekUangModalDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('cek_uang_modal');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData, setTaskData] = useState<CekUangModalData | null>(null);
  const [rows, setRows] = useState<CekUangModalDenomination[]>(buildDenominationRows([]));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const res = await fetch('/api/employee/tasks', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as {
        tasks?: Array<{ type: string; data: CekUangModalData }>;
      };

      const found = data.tasks?.find(
        (task) => task.type === 'cek_uang_modal' && task.data.id === taskId,
      );

      if (found) {
        const d = found.data;
        setTaskData(d);
        setRows(buildDenominationRows(d.denominations));
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[CekUangModalDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId ?? '',
    geo,
    geoReady,
    taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId = taskData ? parseInt(taskData.storeId, 10) : 0;
  const taskIdNum = taskData ? parseInt(taskData.id, 10) : 0;

  const {
    status: saveStatus,
    lastSaved,
    error: saveError,
    save: autoSave,
  } = useAutoSave({
    url: '/api/employee/tasks/cek-uang-modal',
    baseBody: { taskId: taskIdNum },
    debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked =
    !readonly &&
    !!accessStatus &&
    (accessStatus.status === 'not_checked_in' ||
      accessStatus.status === 'outside_geofence');

  const disabled = readonly || locked;
  const maxAmount = parseMoney(taskData?.maxAmount, MAX_UANG_MODAL_TOTAL);
  const totalAmount = totalRows(rows);
  const remainingAmount = Math.max(0, maxAmount - totalAmount);
  const totalPct = maxAmount > 0 ? Math.min(100, Math.round((totalAmount / maxAmount) * 100)) : 0;
  const filledRows = rows.filter((row) => toQty(row.quantity) > 0).length;
  const isOverLimit = totalAmount > maxAmount;
  const canSubmit = !locked && totalAmount > 0 && !isOverLimit;

  const submitHint = (() => {
    if (locked) return '';
    if (totalAmount <= 0) return 'Isi minimal satu pecahan uang terlebih dahulu.';
    if (isOverLimit) return `Total uang modal maksimal ${formatRupiah(maxAmount)}.`;
    return '';
  })();

  function updateQuantity(denominationValue: number, quantity: number) {
    setRows((prev) => {
      const otherTotal = prev.reduce((sum, row) => {
        if (row.denominationValue === denominationValue) return sum;
        return sum + row.denominationValue * toQty(row.quantity);
      }, 0);

      const maxQtyForRow = Math.max(
        0,
        Math.floor((maxAmount - otherTotal) / denominationValue),
      );
      const clampedQuantity = Math.min(quantity, maxQtyForRow);

      if (quantity > maxQtyForRow) {
        toast.error(`Maksimal uang modal ${formatRupiah(maxAmount)}. Qty pecahan ini dibatasi ke ${maxQtyForRow}.`);
      }

      const next = prev.map((row) =>
        row.denominationValue === denominationValue
          ? {
              ...row,
              quantity: clampedQuantity,
              amount: String(row.denominationValue * clampedQuantity),
            }
          : row,
      );

      autoSave({
        denominations: payloadRows(next),
        notes: notes || undefined,
      });

      return next;
    });
  }

  async function handleSubmit() {
    if (!taskData) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/employee/tasks/cek-uang-modal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId,
          storeId,
          lat: geo?.lat,
          lng: geo?.lng,
          skipGeo: geo === null,
          denominations: payloadRows(rows),
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        json = await res.json();
      }

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg);
        toast.error(msg, { duration: 6000 });
        return;
      }

      toast.success(`Cek Uang Modal selesai · ${formatRupiah(totalAmount)} ✓`, {
        duration: 4000,
      });
      router.back();
    } catch (e) {
      const msg =
        e instanceof Error
          ? `Koneksi gagal: ${e.message}`
          : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TaskHeader
        title="Cek Uang Modal"
        subtitle={
          taskData
            ? `${String(taskData.shift).replace('_', ' ')} shift · ${String(taskData.status).replace('_', ' ')}`
            : undefined
        }
        status={taskStatus}
        saveIndicator={
          !readonly && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
          ) : null
        }
      />

      <div className="flex-1 space-y-4 p-4 pb-10">
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus}
            accessLoading={accessLoading}
            geoReady={geoReady}
            geo={geo}
            geoError={geoError}
            onRefreshGeo={refreshGeo}
            onRefreshAccess={refreshAccess}
          />
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 break-words text-xs text-red-600">{submitError}</p>
            </div>
            <button
              onClick={() => setSubmitError(null)}
              className="shrink-0 text-red-400 hover:text-red-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">
                Silakan perbaiki dan submit ulang.
              </p>
            </div>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{fmt(taskData.verifiedAt)}</p>
          </div>
        )}

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan.</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />
            ))}
          </div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="relative">
            <LockedOverlay accessStatus={accessStatus} />

            <div className="space-y-6">
              <Section title="Ringkasan Uang Modal">
                <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10">
                      <Wallet className="h-6 w-6 text-primary" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-muted-foreground">
                        Total uang modal siap di kasir
                      </p>
                      <p className="mt-1 text-2xl font-black tracking-tight text-foreground">
                        {formatRupiah(totalAmount)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {filledRows} dari {rows.length} pecahan terisi
                      </p>
                      <div className="mt-3 space-y-2">
                        <div className="h-2 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all',
                              isOverLimit ? 'bg-red-500' : 'bg-primary',
                            )}
                            style={{ width: `${totalPct}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>Limit harian: {formatRupiah(maxAmount)}</span>
                          <span>Sisa: {formatRupiah(remainingAmount)}</span>
                        </div>
                      </div>
                    </div>

                    {readonly && (
                      <div className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700">
                        Selesai
                      </div>
                    )}
                  </div>

                  {taskData.completedAt && (
                    <div className="mt-4 border-t border-border pt-3">
                      <p className="text-[10px] text-muted-foreground">
                        Selesai: {fmt(taskData.completedAt)}
                      </p>
                    </div>
                  )}
                </div>

                {isOverLimit && (
                  <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-xs font-bold text-red-700">Melebihi limit uang modal</p>
                    <p className="mt-0.5 text-xs text-red-600">
                      Total maksimal {formatRupiah(maxAmount)}. Kurangi pecahan sebelum submit.
                    </p>
                  </div>
                )}
              </Section>

              <Section title="Pecahan Uang">
                <div className="space-y-2.5">
                  {rows.map((row) => (
                    <DenominationRow
                      key={row.denominationValue}
                      row={row}
                      disabled={disabled}
                      maxQuantity={Math.max(
                        toQty(row.quantity),
                        Math.floor((maxAmount - (totalAmount - row.denominationValue * toQty(row.quantity))) / row.denominationValue),
                      )}
                      onQuantityChange={(quantity) =>
                        updateQuantity(row.denominationValue, quantity)
                      }
                    />
                  ))}
                </div>
              </Section>

              <Section title="Catatan (opsional)">
                <textarea
                  value={notes}
                  disabled={disabled}
                  rows={3}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNotes(value);
                    autoSave({
                      denominations: payloadRows(rows),
                      notes: value || undefined,
                    });
                  }}
                  placeholder="Tambahkan catatan jika ada…"
                  className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
              </Section>

              <TaskSubmitBar
                label="Submit Cek Uang Modal"
                onSubmit={handleSubmit}
                submitting={submitting}
                disabled={!canSubmit}
                hidden={readonly}
                hint={!canSubmit ? submitHint : undefined}
              />

              {readonly && taskData.notes && (
                <Section title="Catatan">
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <p className="text-xs text-foreground">{taskData.notes}</p>
                  </div>
                </Section>
              )}

              {readonly && (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <p className="text-xs font-semibold">
                    Data pecahan uang modal sudah tersimpan.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
