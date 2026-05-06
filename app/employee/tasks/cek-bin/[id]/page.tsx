'use client';
// app/employee/tasks/cek-bin/[id]/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertCircle,
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Loader2,
  LogIn,
  Navigation,
  NavigationOff,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface BinItem {
  id: string;
  storeId: string;
  bin: string;
  qtyBc: number;
  qtySesuaiBin: number;
  qtyTidakSesuaiBin: number;
  nama: string;
}

interface CheckedBin {
  id: string;
  taskId: string;
  binId: string;
  bin: string;
  qtyBc: number;
  qtySesuaiBin: number;
  qtyTidakSesuaiBin: number;
  nama: string;
  notes: string | null;
}

interface SelectedBinDraft {
  binId: number;
  qtyBc: number;
  qtySesuaiBin: number;
  qtyTidakSesuaiBin: number;
  notes?: string;
}

interface CekBinData {
  id: string;
  scheduleId: string;
  userId?: string;
  storeId: string;
  shift: string;
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy?: string | null;
  verifiedAt: string | null;
  totalStoreBins: number;
  minimumBinsToCheck: number;
  checkedBinsCount: number;
  availableBins: BinItem[];
  checkedBins: CheckedBin[];
  selectedBinIds: string[];
}

function useGeo() {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
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
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { geo, geoError, geoReady, refresh };
}

function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: { lat: number; lng: number } | null,
  geoReady: boolean,
  taskStatus?: TaskStatus,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const check = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }

    if (!scheduleId || !storeId) return;

    setAccessLoading(true);

    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) {
        p.set('lat', String(geo.lat));
        p.set('lng', String(geo.lng));
      }

      const data = await fetch(`/api/employee/tasks/access?${p}`).then((r) => r.json()) as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) check(); }, [geoReady, check]);

  return { accessStatus, accessLoading, refreshAccess: check };
}

function toNonNegativeInt(value: string): number {
  if (value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function SaveIndicator({ status, lastSaved }: { status: 'idle' | 'saving' | 'saved' | 'error'; lastSaved: Date | null }) {
  if (status === 'idle') return null;

  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-secondary text-muted-foreground',
      status === 'saved' && 'bg-secondary text-foreground',
      status === 'error' && 'bg-red-50 text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved' && <><Cloud className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : ''}</>}
      {status === 'error' && <><CloudOff className="h-3 w-3" />Gagal</>}
    </div>
  );
}

function AccessBanner({ accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess }: {
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
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}
      </div>
    );
  }

  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
        <LogIn className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
        <p className="flex-1 text-xs text-red-700">Lakukan absensi masuk terlebih dahulu.</p>
        <button onClick={onRefreshAccess} className="rounded-xl border border-red-200 bg-white/70 px-3 py-2 text-[11px] font-semibold text-red-700">Cek</button>
      </div>
    );
  }

  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-secondary px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <p className="flex-1 text-xs text-foreground">Di luar area toko — {accessStatus.distanceM}m dari toko. Batas: {accessStatus.radiusM}m.</p>
        <button onClick={onRefreshGeo} className="rounded-xl border border-border bg-card px-3 py-2 text-[11px] font-semibold">Perbarui</button>
      </div>
    );
  }

  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
        <NavigationOff className="h-3.5 w-3.5" />
        {geoError ?? 'Lokasi tidak terdeteksi.'}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-secondary px-4 py-3 text-xs text-muted-foreground">
      <Navigation className="h-3.5 w-3.5" />
      Lokasi terdeteksi — {geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)}
    </div>
  );
}

function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-3xl bg-background/75 backdrop-blur-[2px]">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary">
        {accessStatus.status === 'not_checked_in' ? <LogIn className="h-5 w-5" /> : <NavigationOff className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-foreground">
        {accessStatus.status === 'not_checked_in' ? 'Absen masuk dulu' : 'Di luar area toko'}
      </p>
    </div>
  );
}

function QuantityInput({ label, value, onChange, disabled }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
      <input
        type="number"
        min="0"
        inputMode="numeric"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(toNonNegativeInt(e.target.value))}
        className="h-11 w-full rounded-xl border border-border bg-secondary px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-60"
      />
    </label>
  );
}

export default function CekBinDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData, setTaskData] = useState<CekBinData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedBins, setSelectedBins] = useState<SelectedBinDraft[]>([]);
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [expandedBinId, setExpandedBinId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: { type: string; data: CekBinData }[] };
      const found = data.tasks?.find((t) => t.type === 'cek_bin' && t.data.id === taskId);

      if (!found) {
        setTaskData(null);
        return;
      }

      const d = found.data;
      setTaskData(d);
      setNotes(d.notes ?? '');

      const restored = d.checkedBins.map((bin) => ({
        binId: Number(bin.binId),
        qtyBc: bin.qtyBc ?? 0,
        qtySesuaiBin: bin.qtySesuaiBin ?? 0,
        qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin ?? 0,
        notes: bin.notes ?? undefined,
      }));

      setSelectedBins(restored);
      setExpandedBinId(restored[0]?.binId ?? null);
    } catch (e) {
      console.error('[CekBinDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId ?? '',
    geo,
    geoReady,
    taskData?.status,
  );

  const taskIdNum = taskData ? Number(taskData.id) : 0;

  const { status: saveStatus, lastSaved, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/cek-bin',
    baseBody: { taskId: taskIdNum },
    debounceMs: 700,
  });

  const taskStatus = taskData?.status;
  const readonly = taskStatus === 'completed' || taskStatus === 'verified';
  const locked = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const disabled = readonly || locked;

  const selectedById = useMemo(() => {
    return new Map(selectedBins.map((bin) => [bin.binId, bin]));
  }, [selectedBins]);

  const totalStoreBins = taskData?.totalStoreBins || taskData?.availableBins.length || 0;
  const minimumBinsToCheck = taskData?.minimumBinsToCheck || Math.ceil(totalStoreBins * 0.3);
  const selectedCount = selectedBins.length;

  const filteredBins = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bins = taskData?.availableBins ?? [];
    if (!q) return bins;

    return bins.filter((bin) =>
      bin.bin.toLowerCase().includes(q) ||
      bin.nama.toLowerCase().includes(q),
    );
  }, [taskData?.availableBins, search]);

  const canSubmit = !locked &&
    !!taskData &&
    totalStoreBins > 0 &&
    selectedCount >= minimumBinsToCheck &&
    selectedBins.every((bin) =>
      Number.isInteger(bin.qtyBc) && bin.qtyBc >= 0 &&
      Number.isInteger(bin.qtySesuaiBin) && bin.qtySesuaiBin >= 0 &&
      Number.isInteger(bin.qtyTidakSesuaiBin) && bin.qtyTidakSesuaiBin >= 0,
    );

  function persistSelected(next: SelectedBinDraft[]) {
    setSelectedBins(next);
    autoSave({ selectedBins: next });
  }

  function toggleBin(bin: BinItem) {
    if (disabled) return;

    const id = Number(bin.id);
    const current = selectedById.get(id);

    if (current) {
      const next = selectedBins.filter((item) => item.binId !== id);
      persistSelected(next);
      if (expandedBinId === id) setExpandedBinId(next[0]?.binId ?? null);
      return;
    }

    const nextItem: SelectedBinDraft = {
      binId: id,
      qtyBc: bin.qtyBc ?? 0,
      qtySesuaiBin: bin.qtySesuaiBin ?? 0,
      qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin ?? 0,
    };

    const next = [...selectedBins, nextItem];
    persistSelected(next);
    setExpandedBinId(id);
  }

  function updateSelectedBin(binId: number, patch: Partial<SelectedBinDraft>) {
    const next = selectedBins.map((item) => item.binId === binId ? { ...item, ...patch } : item);
    persistSelected(next);
  }

  async function handleSubmit() {
    if (!taskData) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const scheduleId = Number(taskData.scheduleId);
      const storeId = Number(taskData.storeId);

      const res = await fetch('/api/employee/tasks/cek-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId,
          storeId,
          geo: geo ?? null,
          skipGeo: geo === null,
          selectedBins,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg);
        toast.error(msg, { duration: 6000 });
        return;
      }

      toast.success('Cek BIN berhasil disubmit.', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  function fmtLong(iso: string | null) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const submitHint = (() => {
    if (locked) return '';
    if (!taskData) return '';
    if (totalStoreBins === 0) return 'Belum ada data BIN aktif untuk store ini.';
    if (selectedCount < minimumBinsToCheck) return `Pilih dan isi minimal ${minimumBinsToCheck} BIN dari total ${totalStoreBins} BIN aktif.`;
    return '';
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-border bg-secondary active:scale-95"
            aria-label="Kembali"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Cek BIN</p>
            {taskData && (
              <p className="truncate text-[11px] capitalize text-muted-foreground">
                {taskData.shift} shift · {taskData.status.replace('_', ' ')}
              </p>
            )}
          </div>

          {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
          {taskStatus === 'completed' && <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold">Selesai</span>}
          {taskStatus === 'verified' && <span className="rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold text-background">Verified</span>}
          {taskStatus === 'rejected' && <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-semibold text-red-700">Ditolak</span>}
        </div>
      </div>

      <main className="flex-1 space-y-4 px-4 py-4 pb-32">
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
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <p className="flex-1 text-xs text-red-700">{submitError}</p>
            <button onClick={() => setSubmitError(null)} className="text-red-400"><X className="h-4 w-4" /></button>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-2xl border border-border bg-secondary px-4 py-3">
            <p className="text-xs font-semibold text-foreground">Terverifikasi</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtLong(taskData.verifiedAt)}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-3xl bg-secondary" />)}
          </div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Box className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="relative space-y-4">
            <LockedOverlay accessStatus={accessStatus} />

            <section className="rounded-3xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-foreground">Progress Cek BIN</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Pilih minimal 30% dari total BIN aktif, lalu isi quantity untuk setiap BIN yang dicek.
                  </p>
                </div>
                <div className={cn(
                  'rounded-2xl px-3 py-2 text-center text-xs font-bold',
                  selectedCount >= minimumBinsToCheck ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground',
                )}>
                  {selectedCount}/{minimumBinsToCheck}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-secondary p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground">Total BIN</p>
                  <p className="mt-1 text-lg font-bold">{totalStoreBins}</p>
                </div>
                <div className="rounded-2xl bg-secondary p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground">Minimum</p>
                  <p className="mt-1 text-lg font-bold">{minimumBinsToCheck}</p>
                </div>
                <div className="rounded-2xl bg-secondary p-3">
                  <p className="text-[10px] font-semibold text-muted-foreground">Dipilih</p>
                  <p className="mt-1 text-lg font-bold">{selectedCount}</p>
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2.5">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari BIN atau nama barang…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>

              {taskData.availableBins.length === 0 ? (
                <div className="flex flex-col items-center rounded-3xl border border-border bg-secondary px-4 py-10 text-center">
                  <Box className="mb-2 h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm font-semibold text-foreground">Belum ada BIN aktif</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">Hubungi admin/OPS untuk mengisi data BIN master store ini.</p>
                  <button onClick={load} className="mt-4 flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold">
                    <RefreshCw className="h-3.5 w-3.5" />Muat ulang
                  </button>
                </div>
              ) : filteredBins.length === 0 ? (
                <div className="rounded-3xl border border-border bg-secondary px-4 py-8 text-center text-sm text-muted-foreground">
                  Tidak ada BIN yang cocok dengan pencarian.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredBins.map((bin) => {
                    const id = Number(bin.id);
                    const selected = selectedById.get(id);
                    const isOpen = expandedBinId === id;

                    return (
                      <article
                        key={bin.id}
                        className={cn(
                          'overflow-hidden rounded-3xl border bg-card shadow-sm transition-colors',
                          selected ? 'border-foreground/60' : 'border-border',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleBin(bin)}
                          disabled={disabled}
                          className="flex w-full items-center gap-3 px-4 py-4 text-left disabled:opacity-60"
                        >
                          <div className={cn(
                            'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border',
                            selected ? 'border-foreground bg-foreground text-background' : 'border-border bg-secondary',
                          )}>
                            {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-mono text-sm font-bold text-foreground">{bin.bin}</p>
                              {selected && <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Dicek</span>}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{bin.nama}</p>
                          </div>

                          {selected && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedBinId(isOpen ? null : id);
                              }}
                              className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary"
                              aria-label="Buka detail quantity"
                            >
                              <ChevronDown className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')} />
                            </button>
                          )}
                        </button>

                        <div className="grid grid-cols-3 gap-2 border-t border-border bg-secondary/40 px-4 py-3 text-center">
                          <div>
                            <p className="text-[9px] font-semibold text-muted-foreground">QTY BC</p>
                            <p className="mt-0.5 text-xs font-bold">{bin.qtyBc}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-semibold text-muted-foreground">SESUAI</p>
                            <p className="mt-0.5 text-xs font-bold">{bin.qtySesuaiBin}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-semibold text-muted-foreground">TIDAK SESUAI</p>
                            <p className="mt-0.5 text-xs font-bold">{bin.qtyTidakSesuaiBin}</p>
                          </div>
                        </div>

                        {selected && isOpen && (
                          <div className="space-y-3 border-t border-border px-4 py-4">
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                              <QuantityInput
                                label="QTY BC"
                                value={selected.qtyBc}
                                disabled={disabled}
                                onChange={(value) => updateSelectedBin(id, { qtyBc: value })}
                              />
                              <QuantityInput
                                label="QTY SESUAI BIN"
                                value={selected.qtySesuaiBin}
                                disabled={disabled}
                                onChange={(value) => updateSelectedBin(id, { qtySesuaiBin: value })}
                              />
                              <QuantityInput
                                label="QTY TIDAK SESUAI BIN"
                                value={selected.qtyTidakSesuaiBin}
                                disabled={disabled}
                                onChange={(value) => updateSelectedBin(id, { qtyTidakSesuaiBin: value })}
                              />
                            </div>

                            <label className="block space-y-1">
                              <span className="text-[10px] font-semibold text-muted-foreground">Catatan BIN ini</span>
                              <textarea
                                value={selected.notes ?? ''}
                                disabled={disabled}
                                rows={2}
                                onChange={(e) => updateSelectedBin(id, { notes: e.target.value })}
                                placeholder="Opsional…"
                                className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-foreground/20 disabled:opacity-60"
                              />
                            </label>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                Catatan Task <span className="font-normal text-muted-foreground">(opsional)</span>
              </label>
              <textarea
                value={notes}
                disabled={disabled}
                rows={3}
                onChange={(e) => {
                  setNotes(e.target.value);
                  autoSave({ notes: e.target.value });
                }}
                placeholder="Tambahkan catatan umum jika ada…"
                className="w-full resize-none rounded-2xl border border-border bg-secondary px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/20 disabled:opacity-60"
              />
            </section>
          </div>
        )}
      </main>

      {!readonly && !loading && taskData && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex h-13 min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] disabled:opacity-40"
          >
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
              : <><CheckCircle2 className="h-4 w-4" />Submit Cek BIN</>}
          </button>
          {!canSubmit && submitHint && <p className="mt-2 text-center text-[11px] text-muted-foreground">{submitHint}</p>}
        </div>
      )}
    </div>
  );
}
