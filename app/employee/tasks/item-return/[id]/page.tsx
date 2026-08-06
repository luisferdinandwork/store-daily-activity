'use client';
// app/employee/tasks/item-return/[id]/page.tsx
//
// BC-driven Item Return task: every open transfer order (fetched live from
// Business Central every time this page loads — see
// app/api/employee/tasks/item-return/[id]/route.ts) gets its own inline
// "Confirm hand-off to courier" action (qty counted + courier-signed-paper
// photo), submitted independently per transfer order so its pickup timer
// freezes at the exact hand-off moment.

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  CheckCircle2, Loader2, AlertCircle,
  LogIn, Navigation, NavigationOff, RefreshCw,
  Store, Clock, Package, Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import TaskHeader from '@/components/employee/tasks/TaskHeader';
import PhotoUploadGrid from '@/components/shared/PhotoUploadGrid';
import { uploadTaskPhoto } from '@/lib/tasks-upload';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'not_started' | 'in_progress' | 'completed'
  | 'pending' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface StoreRef {
  id: number;
  name: string;
  storeNo: string;
}

interface ItemReturnEntryData {
  id: string;
  toaNo: string;
  qtyOrdered: number;
  qtyCounted: number | null;
  courierSignPhoto: string | null;
  submittedAt: string | null;
  fromStore: StoreRef | null;
  toStore: StoreRef | null;
  transferFromCode: string | null;
  transferToCode: string | null;
  bcStatus: string | null;
  returnDetectedAt: string | null;
}

interface ItemReturnTaskData {
  id: string;
  status: TaskStatus;
  hasReturn: boolean;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  storeId: string;
  date: string;
}

interface LoadResponse {
  success: boolean;
  error?: string;
  scheduleId?: number;
  task?: ItemReturnTaskData;
  entries?: ItemReturnEntryData[];
  syncWarning?: string | null;
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
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoReady(true); },
      () => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);

  useEffect(() => { refresh(); }, [refresh]);
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
      if (geo) { params.set('lat', String(geo.lat)); params.set('lng', String(geo.lng)); }
      const res = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) fetchAccess(); }, [geoReady, fetchAccess]);
  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Access banner ────────────────────────────────────────────────────────────

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
          <p className="mt-0.5 text-xs text-red-600">Lakukan absensi masuk terlebih dahulu.</p>
        </div>
        <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Cek ulang
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).
          </p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Perbarui
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan tanpa rekam lokasi.</p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Coba lagi
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

// ─── Elapsed time ─────────────────────────────────────────────────────────────

function useTicking(intervalMs = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

function formatElapsedSince(fromIso: string | null): string {
  if (!fromIso) return '—';
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60_000));
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

function formatDurationBetween(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const diffMin = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

// ─── Store pill ───────────────────────────────────────────────────────────────

function StorePill({ store, code }: { store: StoreRef | null; code: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground">
      <Store className="h-3 w-3 text-muted-foreground" />
      {store ? store.name : (code ?? '—')}
      {store && <span className="font-mono text-[10px] text-muted-foreground">({store.storeNo})</span>}
    </span>
  );
}

// ─── Open entry card ──────────────────────────────────────────────────────────

function OpenReturnEntryCard({
  entry, disabled, confirming, onConfirm,
}: {
  entry: ItemReturnEntryData;
  disabled: boolean;
  confirming: boolean;
  onConfirm: (entryId: string, qtyCounted: number, courierSignPhoto: string) => void;
}) {
  useTicking();
  const [expanded, setExpanded] = useState(false);
  const [qtyCounted, setQtyCounted] = useState(String(entry.qtyOrdered));
  const [photos, setPhotos] = useState<string[]>([]);

  const canConfirm = qtyCounted.trim() !== '' && Number(qtyCounted) >= 0 && photos.length >= 1;

  return (
    <div className="overflow-hidden rounded-2xl border-2 border-amber-300 bg-amber-50/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <Package className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-foreground">{entry.toaNo}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Ke</span>
            <StorePill store={entry.toStore} code={entry.transferToCode} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Qty pesanan: {entry.qtyOrdered}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <div className="flex items-center gap-1 text-amber-700">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-xs font-bold">{formatElapsedSince(entry.returnDetectedAt)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">menunggu diambil</p>
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-amber-200 bg-card px-4 py-3.5">
          <div>
            <label className="text-xs font-semibold text-foreground">Jumlah dihitung</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qtyCounted}
              onChange={(e) => setQtyCounted(e.target.value)}
              disabled={disabled}
              className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>

          <PhotoUploadGrid
            label="Foto bukti tanda tangan kurir"
            hint="Foto surat jalan yang sudah ditandatangani kurir."
            photos={photos}
            onChange={setPhotos}
            min={1}
            max={1}
            disabled={disabled}
            upload={(file) => uploadTaskPhoto(file, 'item_return_courier_sign')}
          />

          <button
            type="button"
            disabled={disabled || !canConfirm || confirming}
            onClick={() => onConfirm(entry.id, Number(qtyCounted), photos[0])}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Konfirmasi Serah Terima ke Kurir
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Confirmed entry card ─────────────────────────────────────────────────────

function ConfirmedReturnEntryCard({ entry }: { entry: ItemReturnEntryData }) {
  return (
    <div className="rounded-2xl border border-green-200 bg-green-50/50 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-700">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-foreground">{entry.toaNo}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Ke</span>
            <StorePill store={entry.toStore} code={entry.transferToCode} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Qty pesanan {entry.qtyOrdered} · dihitung {entry.qtyCounted ?? '—'}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-bold text-green-700">
            {formatDurationBetween(entry.returnDetectedAt, entry.submittedAt)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {entry.submittedAt
              ? new Date(entry.submittedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
              : ''}
          </p>
        </div>
      </div>
      {entry.courierSignPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.courierSignPhoto}
          alt="Bukti tanda tangan kurir"
          className="mt-3 h-20 w-20 rounded-xl border border-border object-cover"
        />
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItemReturnDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('item_return');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData, setTaskData] = useState<ItemReturnTaskData | null>(null);
  const [entries, setEntries] = useState<ItemReturnEntryData[]>([]);
  const [scheduleId, setScheduleId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks/item-return/${taskId}`, { cache: 'no-store' });
      const data = await res.json() as LoadResponse;
      if (!data.success || !data.task) {
        toast.error(data.error ?? 'Gagal memuat data task.');
        setTaskData(null);
        return;
      }
      setTaskData(data.task);
      setEntries(data.entries ?? []);
      setScheduleId(String(data.scheduleId ?? ''));
      setSyncWarning(data.syncWarning ?? null);
    } catch (e) {
      console.error('[ItemReturnDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    scheduleId, taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const locked = requiresLocation
    ? accessLoading || !accessStatus || accessStatus.status !== 'ok'
    : false;

  const handleConfirm = useCallback(async (entryId: string, qtyCounted: number, courierSignPhoto: string) => {
    if (locked) {
      toast.warning('Belum bisa konfirmasi — periksa status akses di atas.');
      return;
    }
    setConfirmingId(entryId);
    try {
      const res = await fetch(`/api/employee/tasks/item-return/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: Number(entryId),
          qtyCounted,
          courierSignPhoto,
          lat: geo?.lat,
          lng: geo?.lng,
          skipGeo: !requiresLocation,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Gagal konfirmasi.');
      toast.success('Serah terima ke kurir dikonfirmasi.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal konfirmasi.');
    } finally {
      setConfirmingId(null);
    }
  }, [taskId, geo, requiresLocation, locked, load]);

  if (loading && !taskData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!taskData) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <TaskHeader title="Item Return" onBack={() => router.back()} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">Task tidak ditemukan</p>
        </div>
      </div>
    );
  }

  const openEntries = entries.filter((e) => !e.submittedAt);
  const confirmedEntries = entries.filter((e) => e.submittedAt);

  return (
    <div className="flex min-h-screen flex-col bg-background pb-28">
      <TaskHeader
        title="Item Return"
        subtitle={openEntries.length > 0 ? `${openEntries.length} menunggu konfirmasi` : undefined}
        status={taskData.status}
        onBack={() => router.back()}
      />

      <div className="space-y-4 p-4">
        <AccessBanner
          accessStatus={accessStatus}
          accessLoading={accessLoading}
          geoReady={geoReady}
          geo={geo}
          geoError={geoError}
          onRefreshGeo={refreshGeo}
          onRefreshAccess={refreshAccess}
        />

        {syncWarning && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-red-700">Gagal sinkronisasi dengan Business Central</p>
              <p className="mt-0.5 text-[11px] text-red-600">{syncWarning}</p>
              <p className="mt-0.5 text-[11px] text-red-600">Data yang ditampilkan mungkin belum terbaru.</p>
            </div>
            <button
              onClick={load}
              className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200"
            >
              <RefreshCw className="h-3 w-3" />Coba lagi
            </button>
          </div>
        )}

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-secondary px-4 py-10 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">Belum ada item return</p>
            <p className="text-xs text-muted-foreground">
              Task ini akan otomatis terisi begitu Business Central mengirim transfer order dari toko ini.
            </p>
          </div>
        ) : (
          <>
            {openEntries.length > 0 && (
              <section className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">
                  Menunggu diambil kurir · {openEntries.length}
                </p>
                {openEntries.map((entry) => (
                  <OpenReturnEntryCard
                    key={entry.id}
                    entry={entry}
                    disabled={locked}
                    confirming={confirmingId === entry.id}
                    onConfirm={handleConfirm}
                  />
                ))}
              </section>
            )}

            {confirmedEntries.length > 0 && (
              <section className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Sudah dikonfirmasi · {confirmedEntries.length}
                </p>
                {confirmedEntries.map((entry) => (
                  <ConfirmedReturnEntryCard key={entry.id} entry={entry} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
