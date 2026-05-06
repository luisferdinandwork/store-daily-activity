'use client';
// app/employee/tasks/store-front/[id]/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter }                      from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
  ImagePlus, Trash2,
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

interface StoreFrontData {
  id: string; scheduleId: string; userId: string; storeId: string;
  shift: string; date: string; status: TaskStatus; notes: string | null;
  completedAt: string | null; verifiedBy: string | null; verifiedAt: string | null;
  storefrontPhotos:       string[];
  rollingDoorClosedPhoto: string | null;
}

// ─── Photo rules ──────────────────────────────────────────────────────────────

const PHOTO_RULES = {
  storefront:   { min: 1, max: 3 },
  rollingDoor:  { min: 1, max: 1 },
} as const;

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo() {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
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

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(
  scheduleId: string, storeId: string,
  geo: { lat: number; lng: number } | null,
  geoReady: boolean, taskStatus: TaskStatus | undefined,
) {
  const [accessStatus, setAccessStatus]   = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' }); setAccessLoading(false); return;
    }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) { p.set('lat', String(geo.lat)); p.set('lng', String(geo.lng)); }
      setAccessStatus(await fetch(`/api/employee/tasks/access?${p}`).then(r => r.json()) as AccessStatus);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);
  useEffect(() => { if (geoReady) fetch_(); }, [geoReady, fetch_]);
  return { accessStatus, accessLoading, refreshAccess: fetch_ };
}

// ─── Access banner ────────────────────────────────────────────────────────────

function AccessBanner({ accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess }: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
    </div>
  );
  if (!accessStatus) return null;
  if (accessStatus.status === 'not_checked_in') return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
      <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
        <p className="mt-0.5 text-xs text-red-600">Kamu harus melakukan absensi masuk terlebih dahulu.</p>
      </div>
      <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Cek ulang
      </button>
    </div>
  );
  if (accessStatus.status === 'outside_geofence') return (
    <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
      <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
        <p className="mt-0.5 text-xs text-orange-600">Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).</p>
      </div>
      <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Perbarui
      </button>
    </div>
  );
  if (accessStatus.status === 'geo_unavailable') return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
        <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan tanpa rekaman lokasi.</p>
      </div>
      <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors">
        <RefreshCw className="h-3 w-3" />Coba lagi
      </button>
    </div>
  );
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

function SaveIndicator({ status, lastSaved }: { status: 'idle'|'saving'|'saved'|'error'; lastSaved: Date|null }) {
  if (status === 'idle') return null;
  return (
    <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50 text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50 text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}` : ''}</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

// ─── PhotoCheckItem — consistent tap-to-open-modal row ───────────────────────

function PhotoCheckItem({
  label, description, checked, photoCount, requiredCount, onClick, disabled,
}: {
  label:         string;
  description:   string;
  checked:       boolean;
  photoCount:    number;
  requiredCount: number;
  onClick:       () => void;
  disabled?:     boolean;
}) {
  const needsMore = !checked && photoCount > 0;
  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all active:scale-[0.99]',
        checked   && 'border-primary/30 bg-primary/5',
        !checked && photoCount === 0 && 'border-border bg-card hover:border-primary/20',
        needsMore && 'border-amber-400 bg-amber-50',
        disabled  && 'cursor-default opacity-60',
      )}
    >
      {/* Checkbox circle */}
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>

      {/* Text + badge */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-semibold leading-snug', checked ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0',
            photoCount === 0           ? 'bg-secondary text-muted-foreground'
            : photoCount >= requiredCount ? 'bg-green-100 text-green-700'
            :                              'bg-amber-100 text-amber-700',
          )}>
            <Camera className="h-2.5 w-2.5" />
            {photoCount}/{requiredCount}
          </span>
        </div>
        <p className={cn('mt-0.5 text-[11px] leading-relaxed',
          needsMore ? 'font-semibold text-amber-700' : 'text-muted-foreground',
        )}>
          {description}
        </p>

        {/* Thumbnail strip — shows uploaded photos inline */}
        {photoCount > 0 && (
          <div className="mt-2.5 flex gap-1.5">
            {Array.from({ length: photoCount }).map((_, i) => (
              <div key={i} className={cn(
                'h-12 w-12 rounded-lg border-2 flex items-center justify-center',
                checked ? 'border-primary/20 bg-primary/10' : 'border-amber-300 bg-amber-100',
              )}>
                <Camera className={cn('h-4 w-4', checked ? 'text-primary/50' : 'text-amber-500')} />
              </div>
            ))}
            {!checked && (
              <div className="h-12 flex items-center pl-1">
                <p className="text-[10px] font-semibold text-amber-600">
                  Ketuk untuk lihat / tambah
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── PhotoCheckItemWithPreview — shows actual image thumbnails inline ─────────
// Used so user can see their uploaded photos at a glance without opening modal

function PhotoCheckItemWithPreview({
  label, description, checked, photos, requiredCount, onClick, disabled,
}: {
  label:         string;
  description:   string;
  checked:       boolean;
  photos:        string[];
  requiredCount: number;
  onClick:       () => void;
  disabled?:     boolean;
}) {
  const photoCount = photos.length;
  const needsMore  = !checked && photoCount > 0;

  return (
    <button
      type="button"
      onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all active:scale-[0.99]',
        checked   && 'border-primary/30 bg-primary/5',
        !checked && photoCount === 0 && 'border-border bg-card hover:border-primary/20',
        needsMore && 'border-amber-400 bg-amber-50',
        disabled  && 'cursor-default opacity-60',
      )}
    >
      {/* Checkbox circle */}
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-semibold leading-snug', checked ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold flex-shrink-0',
            photoCount === 0            ? 'bg-secondary text-muted-foreground'
            : photoCount >= requiredCount ? 'bg-green-100 text-green-700'
            :                               'bg-amber-100 text-amber-700',
          )}>
            <Camera className="h-2.5 w-2.5" />
            {photoCount}/{requiredCount}
          </span>
        </div>

        <p className={cn('mt-0.5 text-[11px] leading-relaxed',
          needsMore ? 'font-semibold text-amber-700' : 'text-muted-foreground',
        )}>
          {description}
        </p>

        {/* Actual image thumbnail strip */}
        {photoCount > 0 && (
          <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5" onClick={e => e.stopPropagation()}>
            {photos.map((url, i) => (
              <div
                key={i}
                className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" />
                <div className="absolute bottom-0 left-0 right-0 flex justify-center bg-black/40 py-0.5">
                  <span className="text-[9px] font-bold text-white">{i + 1}</span>
                </div>
              </div>
            ))}
            {/* Add more hint */}
            {!disabled && (
              <div className="flex h-16 w-16 flex-shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground">
                <ImagePlus className="h-4 w-4" />
                <span className="text-[9px] font-semibold">Edit</span>
              </div>
            )}
          </div>
        )}

        {/* Empty state CTA */}
        {photoCount === 0 && !disabled && (
          <div className="mt-2.5 flex h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground">
            <Camera className="h-4 w-4" />
            <span className="text-[11px] font-semibold">Ketuk untuk ambil foto</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Progress summary bar ─────────────────────────────────────────────────────

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Progress
        </p>
        <p className="text-[10px] font-semibold text-muted-foreground">{done}/{total} foto wajib</p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-400' : 'bg-border',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// ─── Locked overlay ───────────────────────────────────────────────────────────

function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') return null;
  const isCheckIn = accessStatus.status === 'not_checked_in';
  return (
    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-10">
      <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', isCheckIn ? 'bg-red-100' : 'bg-orange-100')}>
        {isCheckIn ? <LogIn className="h-6 w-6 text-red-600" /> : <NavigationOff className="h-6 w-6 text-orange-600" />}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-orange-700')}>
        {isCheckIn ? 'Absen masuk dulu' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoreFrontDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,          setTaskData]          = useState<StoreFrontData | null>(null);
  const [loading,           setLoading]           = useState(true);
  const [submitting,        setSubmitting]        = useState(false);
  const [submitError,       setSubmitError]       = useState<string | null>(null);
  const [storefrontPhotos,  setStorefrontPhotos]  = useState<string[]>([]);
  const [rollingDoorPhotos, setRollingDoorPhotos] = useState<string[]>([]);
  const [notes,             setNotes]             = useState('');

  // Modals
  const [storefrontModalOpen,  setStorefrontModalOpen]  = useState(false);
  const [rollingDoorModalOpen, setRollingDoorModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: StoreFrontData }[] };
      const found = data.tasks?.find(t => t.type === 'store_front' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setStorefrontPhotos(d.storefrontPhotos ?? []);
        // Normalise single-photo field into array for modal compatibility
        setRollingDoorPhotos(d.rollingDoorClosedPhoto ? [d.rollingDoorClosedPhoto] : []);
        setNotes(d.notes ?? '');
      } else { setTaskData(null); }
    } catch (e) { console.error(e); toast.error('Gagal memuat data task.'); }
    finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const taskIdNum = taskData ? parseInt(taskData.id, 10) : 0;
  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/store-front', baseBody: { taskId: taskIdNum }, debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked     = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function confirmStorefront(photos: string[]) {
    setStorefrontPhotos(photos);
    autoSave({ storefrontPhotos: photos }, { immediate: true });
  }
  function clearStorefront() {
    setStorefrontPhotos([]);
    autoSave({ storefrontPhotos: [] }, { immediate: true });
  }

  function confirmRollingDoor(photos: string[]) {
    setRollingDoorPhotos(photos);
    // API expects a single string — send first photo or null
    autoSave({ rollingDoorClosedPhoto: photos[0] ?? null }, { immediate: true });
  }
  function clearRollingDoor() {
    setRollingDoorPhotos([]);
    autoSave({ rollingDoorClosedPhoto: null }, { immediate: true });
  }

  // ── Submit gate ───────────────────────────────────────────────────────────

  const storefrontSatisfied  = storefrontPhotos.length  >= PHOTO_RULES.storefront.min;
  const rollingDoorSatisfied = rollingDoorPhotos.length >= PHOTO_RULES.rollingDoor.min;
  const canSubmit = !locked && storefrontSatisfied && rollingDoorSatisfied;

  const totalRequired = PHOTO_RULES.storefront.min + PHOTO_RULES.rollingDoor.min;
  const totalDone     = (storefrontSatisfied ? PHOTO_RULES.storefront.min : storefrontPhotos.length)
                      + (rollingDoorSatisfied ? PHOTO_RULES.rollingDoor.min : rollingDoorPhotos.length);

  const submitHint = !storefrontSatisfied
    ? `Upload minimal ${PHOTO_RULES.storefront.min} foto storefront dengan 2 karyawan.`
    : !rollingDoorSatisfied
      ? 'Upload foto rolling door tertutup.'
      : '';

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/store-front', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: parseInt(taskData.scheduleId, 10),
          storeId:    parseInt(taskData.storeId, 10),
          geo:  geo  ?? null,
          skipGeo: geo === null,
          storefrontPhotos,
          rollingDoorClosedPhoto: rollingDoorPhotos[0] ?? null,
          notes: notes || undefined,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }
      toast.success('Store Front berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Header ── */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Store Front</p>
          {taskData && (
            <p className="text-[10px] capitalize text-muted-foreground">
              {taskData.shift} shift · {taskData.status.replace('_', ' ')}
            </p>
          )}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle  className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 space-y-4 p-4 pb-10">

        {/* Access banner */}
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus} accessLoading={accessLoading}
            geoReady={geoReady} geo={geo} geoError={geoError}
            onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
          />
        )}

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Save error */}
        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {/* Rejected note */}
        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        {/* Verified note */}
        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">
              {new Date(taskData.verifiedAt).toLocaleString('id-ID',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}
            </p>
          </div>
        )}

        {/* Auto-save hint */}
        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan.</p>
          </div>
        )}

        {/* ── Content ── */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-secondary" />)}
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

              {/* Progress bar */}
              {!readonly && (
                <ProgressBar done={totalDone} total={totalRequired} />
              )}

              {/* ── Photo section ─────────────────────────────────────── */}
              <Section title="Foto Wajib">
                <div className="space-y-2">

                  {/* Storefront — multi photo (min 1, max 3) */}
                  <PhotoCheckItemWithPreview
                    label="Foto Storefront"
                    description={
                      storefrontPhotos.length >= PHOTO_RULES.storefront.min
                        ? `${storefrontPhotos.length} foto · ketuk untuk edit`
                        : 'Kedua karyawan berdiri di depan toko. Min 1, maks 3 foto.'
                    }
                    checked={storefrontSatisfied}
                    photos={storefrontPhotos}
                    requiredCount={PHOTO_RULES.storefront.min}
                    onClick={() => setStorefrontModalOpen(true)}
                    disabled={dis}
                  />

                  {/* Rolling door — single photo */}
                  <PhotoCheckItemWithPreview
                    label="Rolling Door Tertutup"
                    description={
                      rollingDoorPhotos.length >= PHOTO_RULES.rollingDoor.min
                        ? 'Foto terambil · ketuk untuk ganti'
                        : 'Foto rolling door masih tertutup sebelum toko dibuka.'
                    }
                    checked={rollingDoorSatisfied}
                    photos={rollingDoorPhotos}
                    requiredCount={PHOTO_RULES.rollingDoor.min}
                    onClick={() => setRollingDoorModalOpen(true)}
                    disabled={dis}
                  />

                </div>
              </Section>

              {/* ── Notes ─────────────────────────────────────────────── */}
              <Section title="Catatan (opsional)">
                <textarea
                  value={notes}
                  disabled={dis}
                  rows={3}
                  onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                  placeholder="Tambahkan catatan jika ada…"
                  className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
              </Section>

              {/* ── Submit ────────────────────────────────────────────── */}
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
                      : <><CheckCircle2 className="h-4 w-4" />Submit Store Front</>}
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

      {/* ── Storefront modal ──────────────────────────────────────────────── */}
      <ChecklistPhotoModal
        open={storefrontModalOpen}
        onClose={() => setStorefrontModalOpen(false)}
        title="Foto Storefront"
        description="Foto kedua karyawan berdiri di depan toko sebelum membuka. Min 1, maks 3 foto."
        photoType="store_front"
        min={PHOTO_RULES.storefront.min}
        max={PHOTO_RULES.storefront.max}
        initialPhotos={storefrontPhotos}
        onConfirm={confirmStorefront}
        onClear={clearStorefront}
        disabled={dis}
      />

      {/* ── Rolling door modal ────────────────────────────────────────────── */}
      <ChecklistPhotoModal
        open={rollingDoorModalOpen}
        onClose={() => setRollingDoorModalOpen(false)}
        title="Rolling Door Tertutup"
        description="Foto kondisi rolling door masih tertutup sebelum toko dibuka."
        photoType="rolling_door_closed"
        min={PHOTO_RULES.rollingDoor.min}
        max={PHOTO_RULES.rollingDoor.max}
        initialPhotos={rollingDoorPhotos}
        onConfirm={confirmRollingDoor}
        onClear={clearRollingDoor}
        disabled={dis}
      />
    </div>
  );
}