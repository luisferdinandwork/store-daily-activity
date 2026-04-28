'use client';
// app/employee/tasks/grooming/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated detail page for the Grooming task.
//
// This is a PERSONAL task — each employee submits their own grooming check.
//
// Checklist logic (conditional):
//   • Each item has an "active" toggle.
//   • If active → the compliance checkbox must be marked true.
//   • If inactive → it is ignored during validation.
//
// Photos:
//   • selfiePhotos → inline PhotoUploader section (min 1)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface GroomingData {
  id:                   string;
  scheduleId:           string;
  userId:               string;
  storeId:              string;
  shift:                'morning' | 'evening' | 'full_day';
  date:                 string;
  status:               TaskStatus;
  notes:                string | null;
  completedAt:          string | null;
  verifiedBy:           string | null;
  verifiedAt:           string | null;
  uniformActive:        boolean;
  hairActive:           boolean;
  nailsActive:          boolean;
  accessoriesActive:    boolean;
  shoeActive:           boolean;
  uniformComplete:      boolean | null;
  hairGroomed:          boolean | null;
  nailsClean:           boolean | null;
  accessoriesCompliant: boolean | null;
  shoeCompliant:        boolean | null;
  selfiePhotos:         string[];
}

// ─── Photo rules (mirrors server) ─────────────────────────────────────────────

const PHOTO_RULES = {
  selfie: { min: 1, max: 3 },
} as const;

// ─── Geo hook ─────────────────────────────────────────────────────────────────

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

// ─── Access hook ──────────────────────────────────────────────────────────────

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
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m). Pastikan kamu berada di dalam toko.
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
          <p className="mt-0.5 text-xs text-amber-600">
            {geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan, namun lokasi tidak akan direkam.
          </p>
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

// ─── Inline PhotoUploader (for Selfie) ────────────────────────────────────────

function PhotoUploader({
  label, photoType, photos, onChange, min, max, disabled, hint,
}: {
  label:      string;
  photoType:  string;
  photos:     string[];
  onChange:   (urls: string[]) => void;
  min?:       number;
  max:        number;
  disabled?:  boolean;
  hint?:      string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const needed = min ? Math.max(0, min - photos.length) : 0;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length >= max) { toast.error(`Maksimal ${max} foto`); return; }
    setUploading(true);
    try {
      const toUpload = Array.from(files).slice(0, max - photos.length);
      const urls: string[] = [];
      for (const file of toUpload) {
        const form = new FormData();
        form.append('file', file);
        form.append('photoType', photoType);
        const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload gagal');
        urls.push(data.url);
      }
      onChange([...photos, ...urls]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {needed > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            Butuh {needed} lagi
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={i} className="relative h-24 w-24 overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!disabled && (
              <button
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={`Hapus foto ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {!disabled && photos.length < max && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            {uploading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <><Camera className="h-5 w-5" /><span className="text-[9px] font-semibold">Tambah</span></>}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple={max > 1}
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <p className="text-[10px] text-muted-foreground">
        {photos.length}/{max} foto{min ? ` · minimal ${min}` : ''}
      </p>
    </div>
  );
}

// ─── Conditional Check Item (Toggle + Compliance Check) ──────────────────────

function ConditionalCheckItem({
  label, active, onActiveChange, compliant, onCompliantChange, disabled,
}: {
  label: string;
  active: boolean;
  onActiveChange: (v: boolean) => void;
  compliant: boolean;
  onCompliantChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 transition-all',
      active ? 'border-primary/30 bg-primary/5' : 'border-border bg-card',
      disabled && 'cursor-default opacity-60',
    )}>
      {/* Active Toggle */}
      <button type="button" onClick={() => !disabled && onActiveChange(!active)} className="flex-shrink-0">
        <div className={cn(
          'relative h-6 w-11 rounded-full transition-colors',
          active ? 'bg-primary' : 'bg-border',
        )}>
          <div className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            active && 'translate-x-5',
          )} />
        </div>
      </button>

      {/* Label */}
      <span className={cn('flex-1 text-sm font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>

      {/* Compliance Checkbox (only visible if active) */}
      {active && (
        <button 
          type="button" 
          onClick={() => !disabled && onCompliantChange(!compliant)} 
          className="flex-shrink-0 flex items-center gap-1.5"
          aria-label="Tandai sesuai"
        >
          <div className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border-2 transition-colors',
            compliant ? 'border-green-600 bg-green-600' : 'border-border',
          )}>
            {compliant && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
          </div>
          <span className={cn(
            'text-[10px] font-semibold',
            compliant ? 'text-green-700' : 'text-muted-foreground'
          )}>
            Sesuai
          </span>
        </button>
      )}
    </div>
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

export default function GroomingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<GroomingData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form state - Active Toggles
  const [uniformActive,     setUniformActive]     = useState(true);
  const [hairActive,        setHairActive]        = useState(true);
  const [nailsActive,       setNailsActive]       = useState(true);
  const [accessoriesActive, setAccessoriesActive] = useState(true);
  const [shoeActive,        setShoeActive]        = useState(true);

  // Form state - Compliance Checks
  const [uniformComplete,      setUniformComplete]      = useState(false);
  const [hairGroomed,          setHairGroomed]          = useState(false);
  const [nailsClean,           setNailsClean]           = useState(false);
  const [accessoriesCompliant, setAccessoriesCompliant] = useState(false);
  const [shoeCompliant,        setShoeCompliant]        = useState(false);

  // Form state - Photos & Notes
  const [selfiePhotos, setSelfiePhotos] = useState<string[]>([]);
  const [notes,        setNotes]        = useState('');

  // Load initial task state
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: GroomingData }[] };
      const found = data.tasks?.find(t => t.type === 'grooming' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setUniformActive(d.uniformActive);
        setHairActive(d.hairActive);
        setNailsActive(d.nailsActive);
        setAccessoriesActive(d.accessoriesActive);
        setShoeActive(d.shoeActive);
        setUniformComplete(d.uniformComplete === true);
        setHairGroomed(d.hairGroomed === true);
        setNailsClean(d.nailsClean === true);
        setAccessoriesCompliant(d.accessoriesCompliant === true);
        setShoeCompliant(d.shoeCompliant === true);
        setSelfiePhotos(d.selfiePhotos ?? []);
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[GroomingDetailPage] load error:', e);
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
    url:        '/api/employee/tasks/grooming',
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

  // ── Handlers for Active Toggle + Compliance ──────────────────────────────
  // Turning OFF an active toggle automatically clears its compliance state
  function handleToggleActive(
    activeField: string, 
    setActive: (v: boolean) => void, 
    compField: string, 
    setComp: (v: boolean) => void, 
    currentComp: boolean
  ) {
    return (v: boolean) => {
      setActive(v);
      if (!v) setComp(false);
      autoSave({ [activeField]: v, [compField]: v ? currentComp : false });
    };
  }

  function handleSetCompliance(compField: string, setComp: (v: boolean) => void) {
    return (v: boolean) => {
      setComp(v); 
      autoSave({ [compField]: v });
    };
  }

  // ── Submit gate ───────────────────────────────────────────────────────────
  const isUniformValid = !uniformActive || uniformComplete;
  const isHairValid    = !hairActive || hairGroomed;
  const isNailsValid   = !nailsActive || nailsClean;
  const isAccValid     = !accessoriesActive || accessoriesCompliant;
  const isShoeValid    = !shoeActive || shoeCompliant;

  const allChecklistValid = isUniformValid && isHairValid && isNailsValid && isAccValid && isShoeValid;
  const selfieValid       = selfiePhotos.length >= PHOTO_RULES.selfie.min;

  const canSubmit = !locked && allChecklistValid && selfieValid;

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/grooming', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId, storeId,
          geo: geo ?? null, skipGeo: geo === null,
          uniformActive, hairActive, nailsActive, accessoriesActive, shoeActive,
          uniformComplete, hairGroomed, nailsClean, accessoriesCompliant, shoeCompliant,
          selfiePhotos,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const serverMsg =
          (typeof json.error   === 'string' && json.error)   ||
          (typeof json.message === 'string' && json.message) || `HTTP ${res.status}`;
        setSubmitError(serverMsg);
        toast.error(serverMsg, { duration: 6000 });
        return;
      }

      toast.success('Grooming berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  // Reason text below submit button when disabled
  const submitHint = (() => {
    if (locked) return '';
    if (!isUniformValid) return 'Lengkapi "Seragam Lengkap" atau nonaktifkan itemnya.';
    if (!isHairValid)    return 'Lengkapi "Rambut Rapih" atau nonaktifkan itemnya.';
    if (!isNailsValid)   return 'Lengkapi "Kuku Bersih" atau nonaktifkan itemnya.';
    if (!isAccValid)     return 'Lengkapi "Aksesoris Sesuai" atau nonaktifkan itemnya.';
    if (!isShoeValid)    return 'Lengkapi "Sepatu Sesuai" atau nonaktifkan itemnya.';
    if (!selfieValid)    return `Upload min ${PHOTO_RULES.selfie.min} foto selfie.`;
    return '';
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Grooming</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift.replace('_', ' ')} shift · {taskData.status.replace('_', ' ')}</p>}
        </div>

        {!readonly && !loading && taskData && (
          <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
        )}

        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle  className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
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
              <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{new Date(taskData.verifiedAt).toLocaleString('id-ID',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
            <p className="mt-1 text-xs text-muted-foreground">Task mungkin sudah tidak tersedia.</p>
          </div>
        ) : (
          <div className="relative">
            <LockedOverlay accessStatus={accessStatus} />

            <div className="space-y-6">
              <Section title="Penampilan Diri">
                <div className="space-y-2">
                  <ConditionalCheckItem
                    label="Seragam Lengkap"
                    active={uniformActive}
                    onActiveChange={handleToggleActive('uniformActive', setUniformActive, 'uniformComplete', setUniformComplete, uniformComplete)}
                    compliant={uniformComplete}
                    onCompliantChange={handleSetCompliance('uniformComplete', setUniformComplete)}
                    disabled={dis}
                  />

                  <ConditionalCheckItem
                    label="Rambut Rapih"
                    active={hairActive}
                    onActiveChange={handleToggleActive('hairActive', setHairActive, 'hairGroomed', setHairGroomed, hairGroomed)}
                    compliant={hairGroomed}
                    onCompliantChange={handleSetCompliance('hairGroomed', setHairGroomed)}
                    disabled={dis}
                  />

                  <ConditionalCheckItem
                    label="Kuku Bersih"
                    active={nailsActive}
                    onActiveChange={handleToggleActive('nailsActive', setNailsActive, 'nailsClean', setNailsClean, nailsClean)}
                    compliant={nailsClean}
                    onCompliantChange={handleSetCompliance('nailsClean', setNailsClean)}
                    disabled={dis}
                  />

                  <ConditionalCheckItem
                    label="Aksesoris Sesuai"
                    active={accessoriesActive}
                    onActiveChange={handleToggleActive('accessoriesActive', setAccessoriesActive, 'accessoriesCompliant', setAccessoriesCompliant, accessoriesCompliant)}
                    compliant={accessoriesCompliant}
                    onCompliantChange={handleSetCompliance('accessoriesCompliant', setAccessoriesCompliant)}
                    disabled={dis}
                  />

                  <ConditionalCheckItem
                    label="Sepatu Sesuai"
                    active={shoeActive}
                    onActiveChange={handleToggleActive('shoeActive', setShoeActive, 'shoeCompliant', setShoeCompliant, shoeCompliant)}
                    compliant={shoeCompliant}
                    onCompliantChange={handleSetCompliance('shoeCompliant', setShoeCompliant)}
                    disabled={dis}
                  />
                </div>
              </Section>

              {/* Selfie Photo — inline uploader */}
              <Section title="Foto Selfie">
                <PhotoUploader
                  label="Selfie Penampilan"
                  photoType="grooming_selfie"
                  photos={selfiePhotos}
                  min={PHOTO_RULES.selfie.min}
                  max={PHOTO_RULES.selfie.max}
                  disabled={dis}
                  hint="Foto selfie untuk verifikasi penampilan (wajah terlihat jelas)."
                  onChange={urls => {
                    setSelfiePhotos(urls);
                    autoSave({ selfiePhotos: urls }, { immediate: true });
                  }}
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
                      : <><CheckCircle2 className="h-4 w-4" />Submit Grooming</>}
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
    </div>
  );
}