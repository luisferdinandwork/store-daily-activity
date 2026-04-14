'use client';
// app/employee/tasks/eod-z-report/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated detail page for the EOD Z-Report task.
//
// Fields:
//   • totalNominal  — total from the printed Z-Report (Rupiah-formatted input)
//   • zReportPhotos — photo(s) of the printed receipt (min 1, max 3)
//                     opened via ChecklistPhotoModal in single-bucket mode
//
// This task is the source of truth — NOT discrepancy-capable.
// Uses check-in + geofence guards like store-opening.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
  Receipt,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface EodZReportData {
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
  totalNominal:  string | null;
  zReportPhotos: string[];
}

// ─── Rupiah formatter ─────────────────────────────────────────────────────────

function formatRupiah(raw: string): string {
  const digits = raw.replace(/\D/g, '');
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
  scheduleId: string,
  storeId:    string,
  geo:        { lat: number; lng: number } | null,
  geoReady:   boolean,
  taskStatus: TaskStatus | undefined,
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

// ─── Access banner ────────────────────────────────────────────────────────────

function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError,
  onRefreshGeo, onRefreshAccess,
}: {
  accessStatus:    AccessStatus | null;
  accessLoading:   boolean;
  geoReady:        boolean;
  geo:             { lat: number; lng: number } | null;
  geoError:        string | null;
  onRefreshGeo:    () => void;
  onRefreshAccess: () => void;
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
          <p className="mt-0.5 text-xs text-red-600">Kamu harus melakukan absensi masuk terlebih dahulu sebelum dapat mengerjakan task.</p>
        </div>
        <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200">
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
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200">
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
          <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'}</p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200">
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

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ status, lastSaved }: {
  status: 'idle' | 'saving' | 'saved' | 'error'; lastSaved: Date | null;
}) {
  if (status === 'idle') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50  text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50   text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud    className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}` : ''}</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

// ─── Photo tile ──────────────────────────────────────────────────────────────

function PhotoTile({
  photos, onClick, disabled, min, max,
}: {
  photos:   string[];
  onClick:  () => void;
  disabled?: boolean;
  min:      number;
  max:      number;
}) {
  const hasPhotos = photos.length > 0;
  const meetsMin  = photos.length >= min;

  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        meetsMin ? 'border-primary/30 bg-primary/5' : 'border-amber-400 bg-amber-50',
        disabled && 'cursor-default opacity-60',
      )}
    >
      {hasPhotos ? (
        <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-secondary">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0]} alt="Z-Report" className="h-full w-full object-cover" />
        </div>
      ) : (
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-amber-400 bg-amber-100">
          <Camera className="h-5 w-5 text-amber-600" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-semibold', meetsMin ? 'text-foreground' : 'text-amber-800')}>
          Foto Struk Z-Report
        </p>
        <p className={cn('mt-0.5 text-[11px]', meetsMin ? 'text-muted-foreground' : 'text-amber-700')}>
          {hasPhotos
            ? `${photos.length}/${max} foto · ketuk untuk mengubah`
            : `Min ${min}, max ${max} foto · ketuk untuk upload`}
        </p>
      </div>

      {hasPhotos && (
        <span className={cn(
          'flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold',
          meetsMin ? 'bg-green-100 text-green-700' : 'bg-amber-200 text-amber-800',
        )}>
          {photos.length}/{max}
        </span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') return null;
  const isCheckIn = accessStatus.status === 'not_checked_in';
  return (
    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-10">
      <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', isCheckIn ? 'bg-red-100' : 'bg-orange-100')}>
        {isCheckIn
          ? <LogIn className="h-6 w-6 text-red-600" />
          : <NavigationOff className="h-6 w-6 text-orange-600" />}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-orange-700')}>
        {isCheckIn ? 'Absen masuk dulu' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EodZReportDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,       setTaskData]       = useState<EodZReportData | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [submitting,     setSubmitting]     = useState(false);
  const [submitError,    setSubmitError]    = useState<string | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  const [totalNominal, setTotalNominal] = useState('0');
  const [zReportPhotos, setZReportPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: EodZReportData }[] };
      const found = data.tasks?.find(t => t.type === 'eod_z_report' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setTotalNominal(d.totalNominal ? parseRupiah(d.totalNominal) : '0');
        setZReportPhotos(d.zReportPhotos ?? []);
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[EodZReportDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId    ?? '',
    geo,
    geoReady,
    taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url:        '/api/employee/tasks/eod-z-report',
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

  function confirmPhotos(photos: string[]) {
    setZReportPhotos(photos);
    autoSave({ zReportPhotos: photos }, { immediate: true });
  }
  function clearPhotos() {
    setZReportPhotos([]);
    autoSave({ zReportPhotos: [] }, { immediate: true });
  }

  const nominalValid = isFinite(Number(totalNominal)) && Number(totalNominal) > 0;
  const photosValid  = zReportPhotos.length >= 1;
  const canSubmit    = !locked && nominalValid && photosValid;

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/eod-z-report', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId, storeId,
          geo: geo ?? null, skipGeo: geo === null,
          totalNominal, zReportPhotos,
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
      toast.success('EOD Z-Report berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  const submitHint = (() => {
    if (locked) return '';
    if (!nominalValid) return 'Total nominal wajib diisi dengan angka positif.';
    if (!photosValid)  return 'Minimal 1 foto struk Z-Report wajib diupload.';
    return '';
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">EOD Z-Report</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {taskData.status.replace('_',' ')}</p>}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle  className="h-3 w-3" />Ditolak</span>}
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

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="relative">
            <LockedOverlay accessStatus={accessStatus} />

            <div className="space-y-6">
              <Section title="Total Nominal Z-Report">
                <input
                  type="text"
                  inputMode="numeric"
                  value={formatRupiah(totalNominal)}
                  disabled={dis}
                  placeholder="Rp 0"
                  onChange={e => {
                    const raw = parseRupiah(e.target.value);
                    setTotalNominal(raw);
                    autoSave({ totalNominal: raw });
                  }}
                  onFocus={e => {
                    const el  = e.target;
                    const len = el.value.length;
                    requestAnimationFrame(() => el.setSelectionRange(len, len));
                  }}
                  className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
                <p className="text-[10px] text-muted-foreground">
                  Masukkan total nominal dari struk Z-Report yang tercetak.
                </p>
              </Section>

              <Section title="Foto Struk Z-Report">
                <PhotoTile
                  photos={zReportPhotos}
                  onClick={() => setPhotoModalOpen(true)}
                  disabled={dis}
                  min={1}
                  max={3}
                />
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
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
                      : <><Receipt className="h-4 w-4" />Submit Z-Report</>}
                  </button>
                  {!canSubmit && submitHint && (
                    <p className="text-center text-[11px] text-muted-foreground">{submitHint}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <ChecklistPhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        title="Foto Struk Z-Report"
        description="Upload 1-3 foto struk Z-Report yang tercetak."
        photoType="z_report"
        min={1}
        max={3}
        initialPhotos={zReportPhotos}
        onConfirm={confirmPhotos}
        onClear={clearPhotos}
        disabled={dis}
      />
    </div>
  );
}