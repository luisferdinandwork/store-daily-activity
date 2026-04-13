'use client';
// app/employee/tasks/store-opening/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Dedicated detail page for the Store Opening task.
//
// Checklist ↔ photo coupling:
//   • loginPos  → opens modal for min 1 cashier desk photo
//   • fiveR     → opens modal for min 3 photos
//   • cekPromo  → opens MULTI-bucket modal for 1 storefront + 1 desk promo
//   • storeFront→ inline PhotoUploader section below the checklist (min 1)
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
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface StoreOpeningData {
  id:                string;
  scheduleId:        string;
  userId:            string;
  storeId:           string;
  shift:             'morning' | 'evening';
  date:              string;
  status:            TaskStatus;
  notes:             string | null;
  completedAt:       string | null;
  verifiedBy:        string | null;
  verifiedAt:        string | null;
  loginPos:          boolean;
  checkAbsenSunfish: boolean;
  tarikSohSales:     boolean;
  fiveR:             boolean;
  cekPromo:          boolean;
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  storeFrontPhotos:  string[];
  /** Cashier desk photos live in the cash_drawer_photos column (repurposed). */
  cashDrawerPhotos:  string[];
  fiveRPhotos:       string[];
  cekPromoStorefrontPhotos: string[];
  cekPromoDeskPhotos:       string[];
}

// ─── Photo rules (mirrors server) ─────────────────────────────────────────────

const PHOTO_RULES = {
  storeFront:         { min: 1, max: 3 },
  cashierDesk:        { min: 1, max: 2 },
  fiveR:              { min: 3, max: 5 },
  cekPromoStorefront: { min: 1, max: 1 },
  cekPromoDesk:       { min: 1, max: 1 },
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

// ─── Inline PhotoUploader (for Store Front — no checklist) ───────────────────

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
          <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
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
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50"
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

// ─── Simple (non-photo) checklist item ───────────────────────────────────────

function SimpleCheckItem({
  label, checked, onChange, disabled,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:border-primary/20',
        disabled && 'cursor-default opacity-60',
      )}>
      <div className={cn(
        'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>
      <span className={cn('text-sm font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </button>
  );
}

// ─── Photo-linked checklist item (opens modal on tap) ────────────────────────

function PhotoCheckItem({
  label, description, checked, photoCount, requiredCount, onClick, disabled,
}: {
  label:         string;
  description:   string;
  checked:       boolean;
  /** Total photos already attached across all required buckets for this item. */
  photoCount:    number;
  /** Minimum total photos needed across all buckets to satisfy this item. */
  requiredCount: number;
  onClick:       () => void;
  disabled?:     boolean;
}) {
  const needsMore = checked && photoCount < requiredCount;
  return (
    <button type="button" onClick={() => !disabled && onClick()}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        checked && !needsMore && 'border-primary/30 bg-primary/5',
        !checked               && 'border-border bg-card hover:border-primary/20',
        needsMore              && 'border-amber-400 bg-amber-50',
        disabled && 'cursor-default opacity-60',
      )}>
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked && !needsMore ? 'border-primary bg-primary' : 'border-border',
      )}>
        {checked && !needsMore && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-medium', checked && !needsMore ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
            photoCount === 0
              ? 'bg-secondary text-muted-foreground'
              : photoCount >= requiredCount
                ? 'bg-green-100 text-green-700'
                : 'bg-amber-100 text-amber-700',
          )}>
            <Camera className="h-2.5 w-2.5" />
            {photoCount}/{requiredCount}
          </span>
        </div>
        <p className={cn('mt-0.5 text-[10px]', needsMore ? 'font-semibold text-amber-700' : 'text-muted-foreground')}>
          {description}
        </p>
      </div>
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

// ─── Modal identity ──────────────────────────────────────────────────────────

type PhotoModalKey = 'loginPos' | 'fiveR' | 'cekPromo';

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoreOpeningDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<StoreOpeningData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Active modal (null = closed)
  const [activeModal, setActiveModal] = useState<PhotoModalKey | null>(null);

  // Form state
  const [loginPos,          setLoginPos]          = useState(false);
  const [checkAbsenSunfish, setCheckAbsenSunfish] = useState(false);
  const [tarikSohSales,     setTarikSohSales]     = useState(false);
  const [fiveR,             setFiveR]             = useState(false);
  const [cekPromo,          setCekPromo]          = useState(false);
  const [cekLamp,           setCekLamp]           = useState(false);
  const [cekSoundSystem,    setCekSoundSystem]    = useState(false);
  const [storeFrontPhotos,  setStoreFrontPhotos]  = useState<string[]>([]);
  const [cashierDeskPhotos, setCashierDeskPhotos] = useState<string[]>([]);
  const [fiveRPhotos,       setFiveRPhotos]       = useState<string[]>([]);
  const [promoStorefrontPhotos, setPromoStorefrontPhotos] = useState<string[]>([]);
  const [promoDeskPhotos,       setPromoDeskPhotos]       = useState<string[]>([]);
  const [notes,             setNotes]             = useState('');

  // Load initial task state
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: StoreOpeningData }[] };
      const found = data.tasks?.find(t => t.type === 'store_opening' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setLoginPos(d.loginPos);
        setCheckAbsenSunfish(d.checkAbsenSunfish);
        setTarikSohSales(d.tarikSohSales);
        setFiveR(d.fiveR);
        setCekPromo(d.cekPromo);
        setCekLamp(d.cekLamp);
        setCekSoundSystem(d.cekSoundSystem);
        setStoreFrontPhotos(d.storeFrontPhotos ?? []);
        setCashierDeskPhotos(d.cashDrawerPhotos ?? []);
        setFiveRPhotos(d.fiveRPhotos ?? []);
        setPromoStorefrontPhotos(d.cekPromoStorefrontPhotos ?? []);
        setPromoDeskPhotos(d.cekPromoDeskPhotos ?? []);
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[StoreOpeningDetailPage] load error:', e);
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
    url:        '/api/employee/tasks/store-opening',
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

  // Simple checklist setter + auto-save
  const setChk = (field: string, setter: (v: boolean) => void) => (v: boolean) => {
    setter(v); autoSave({ [field]: v });
  };

  // ── Modal confirm/clear handlers ──────────────────────────────────────────
  function confirmLoginPos(photos: string[]) {
    setCashierDeskPhotos(photos);
    setLoginPos(true);
    autoSave({ cashierDeskPhotos: photos, loginPos: true }, { immediate: true });
  }
  function clearLoginPos() {
    setCashierDeskPhotos([]);
    setLoginPos(false);
    autoSave({ cashierDeskPhotos: [], loginPos: false }, { immediate: true });
  }

  function confirmFiveR(photos: string[]) {
    setFiveRPhotos(photos);
    setFiveR(true);
    autoSave({ fiveRPhotos: photos, fiveR: true }, { immediate: true });
  }
  function clearFiveR() {
    setFiveRPhotos([]);
    setFiveR(false);
    autoSave({ fiveRPhotos: [], fiveR: false }, { immediate: true });
  }

  function confirmCekPromo(results: Record<string, string[]>) {
    const sf   = results.storefront ?? [];
    const desk = results.desk       ?? [];
    setPromoStorefrontPhotos(sf);
    setPromoDeskPhotos(desk);
    setCekPromo(true);
    autoSave({
      cekPromoStorefrontPhotos: sf,
      cekPromoDeskPhotos:       desk,
      cekPromo:                 true,
    }, { immediate: true });
  }
  function clearCekPromo() {
    setPromoStorefrontPhotos([]);
    setPromoDeskPhotos([]);
    setCekPromo(false);
    autoSave({
      cekPromoStorefrontPhotos: [],
      cekPromoDeskPhotos:       [],
      cekPromo:                 false,
    }, { immediate: true });
  }

  // ── Submit gate ───────────────────────────────────────────────────────────
  const cashierDeskSatisfied = cashierDeskPhotos.length    >= PHOTO_RULES.cashierDesk.min;
  const storeFrontSatisfied  = storeFrontPhotos.length     >= PHOTO_RULES.storeFront.min;
  const fiveRSatisfied       = fiveRPhotos.length          >= PHOTO_RULES.fiveR.min;
  const promoSfSatisfied     = promoStorefrontPhotos.length >= PHOTO_RULES.cekPromoStorefront.min;
  const promoDeskSatisfied   = promoDeskPhotos.length      >= PHOTO_RULES.cekPromoDesk.min;
  const cekPromoSatisfied    = promoSfSatisfied && promoDeskSatisfied;

  const allSimpleChecked =
    checkAbsenSunfish && tarikSohSales && cekLamp && cekSoundSystem;
  const allLinkedChecked =
    loginPos && cashierDeskSatisfied &&
    fiveR    && fiveRSatisfied &&
    cekPromo && cekPromoSatisfied;

  const canSubmit = !locked && allSimpleChecked && allLinkedChecked && storeFrontSatisfied;

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/store-opening', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId, storeId,
          geo: geo ?? null, skipGeo: geo === null,
          loginPos, checkAbsenSunfish, tarikSohSales,
          fiveR, fiveRPhotos,
          cekPromo,
          cekPromoStorefrontPhotos: promoStorefrontPhotos,
          cekPromoDeskPhotos:       promoDeskPhotos,
          cekLamp, cekSoundSystem,
          storeFrontPhotos, cashierDeskPhotos,
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

      toast.success('Store Opening berhasil disubmit! ✓', { duration: 4000 });
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
    if (!loginPos || !cashierDeskSatisfied) return `Lengkapi "Log-in POS" — upload min ${PHOTO_RULES.cashierDesk.min} foto meja kasir.`;
    if (!fiveR || !fiveRSatisfied)           return `Lengkapi "5R" — upload min ${PHOTO_RULES.fiveR.min} foto.`;
    if (!cekPromo || !cekPromoSatisfied)     return `Lengkapi "Cek Promo" — upload 1 foto promo depan toko + 1 foto promo meja kasir.`;
    if (!allSimpleChecked)                   return 'Lengkapi semua checklist lain.';
    if (!storeFrontSatisfied)                return `Upload min ${PHOTO_RULES.storeFront.min} foto tampak depan toko.`;
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
          <p className="truncate text-sm font-bold text-foreground">Store Opening</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {taskData.status.replace('_', ' ')}</p>}
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

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.</p>
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
              <Section title="Checklist Pembukaan">
                <div className="space-y-2">
                  {/* Log-in POS — opens modal for cashier desk photos */}
                  <PhotoCheckItem
                    label="Log-in POS / Buka Komputer Kasir"
                    description="Ketuk untuk upload foto meja kasir."
                    checked={loginPos}
                    photoCount={cashierDeskPhotos.length}
                    requiredCount={PHOTO_RULES.cashierDesk.min}
                    onClick={() => setActiveModal('loginPos')}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Tarik & cek absen di Sunfish"
                    checked={checkAbsenSunfish}
                    onChange={setChk('checkAbsenSunfish', setCheckAbsenSunfish)}
                    disabled={dis}
                  />
                  <SimpleCheckItem
                    label="Tarik SOH & Sales"
                    checked={tarikSohSales}
                    onChange={setChk('tarikSohSales', setTarikSohSales)}
                    disabled={dis}
                  />

                  {/* 5R — opens modal for 5R photos */}
                  <PhotoCheckItem
                    label="5R — Kebersihan Toko"
                    description="Ketuk untuk upload foto 5R."
                    checked={fiveR}
                    photoCount={fiveRPhotos.length}
                    requiredCount={PHOTO_RULES.fiveR.min}
                    onClick={() => setActiveModal('fiveR')}
                    disabled={dis}
                  />

                  {/* Cek Promo — opens multi-bucket modal */}
                  <PhotoCheckItem
                    label="Cek Promo"
                    description="Ketuk untuk upload foto promo depan toko & meja kasir."
                    checked={cekPromo}
                    photoCount={promoStorefrontPhotos.length + promoDeskPhotos.length}
                    requiredCount={PHOTO_RULES.cekPromoStorefront.min + PHOTO_RULES.cekPromoDesk.min}
                    onClick={() => setActiveModal('cekPromo')}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Cek semua lampu menyala"
                    checked={cekLamp}
                    onChange={setChk('cekLamp', setCekLamp)}
                    disabled={dis}
                  />
                  <SimpleCheckItem
                    label="Cek sound system"
                    checked={cekSoundSystem}
                    onChange={setChk('cekSoundSystem', setCekSoundSystem)}
                    disabled={dis}
                  />
                </div>
              </Section>

              {/* Store Front — inline uploader (not a checklist item) */}
              <Section title="Foto Tampak Depan Toko">
                <PhotoUploader
                  label="Store Front"
                  photoType="store_front"
                  photos={storeFrontPhotos}
                  min={PHOTO_RULES.storeFront.min}
                  max={PHOTO_RULES.storeFront.max}
                  disabled={dis}
                  hint="Foto tampak depan toko dari luar (toko sudah dibuka)."
                  onChange={urls => {
                    setStoreFrontPhotos(urls);
                    autoSave({ storeFrontPhotos: urls }, { immediate: true });
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
                      : <><CheckCircle2 className="h-4 w-4" />Submit Store Opening</>}
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

      {/* ── Photo modals ─────────────────────────────────────────────────── */}

      {/* Log-in POS — single bucket */}
      <ChecklistPhotoModal
        open={activeModal === 'loginPos'}
        onClose={() => setActiveModal(null)}
        title="Log-in POS / Buka Komputer Kasir"
        description="Foto meja kasir sebagai bukti POS sudah aktif dan siap."
        photoType="cashier_desk"
        min={PHOTO_RULES.cashierDesk.min}
        max={PHOTO_RULES.cashierDesk.max}
        initialPhotos={cashierDeskPhotos}
        onConfirm={confirmLoginPos}
        onClear={clearLoginPos}
        disabled={dis}
      />

      {/* 5R — single bucket */}
      <ChecklistPhotoModal
        open={activeModal === 'fiveR'}
        onClose={() => setActiveModal(null)}
        title="5R — Kebersihan Toko"
        description="Foto area berbeda sebagai bukti 5R (ringkas, rapi, resik, rawat, rajin)."
        photoType="five_r"
        min={PHOTO_RULES.fiveR.min}
        max={PHOTO_RULES.fiveR.max}
        initialPhotos={fiveRPhotos}
        onConfirm={confirmFiveR}
        onClear={clearFiveR}
        disabled={dis}
      />

      {/* Cek Promo — MULTI bucket (storefront promo + desk promo) */}
      <ChecklistPhotoModal
        open={activeModal === 'cekPromo'}
        onClose={() => setActiveModal(null)}
        title="Cek Promo"
        description="Upload 1 foto promo di depan toko dan 1 foto promo di meja kasir."
        buckets={[
          {
            key:           'storefront',
            label:         'Promo di Depan Toko',
            hint:          'Foto materi promo yang terpasang di area depan toko.',
            photoType:     'promo_storefront',
            min:           PHOTO_RULES.cekPromoStorefront.min,
            max:           PHOTO_RULES.cekPromoStorefront.max,
            initialPhotos: promoStorefrontPhotos,
          },
          {
            key:           'desk',
            label:         'Promo di Meja Kasir',
            hint:          'Foto materi promo yang terpasang di meja kasir.',
            photoType:     'promo_desk',
            min:           PHOTO_RULES.cekPromoDesk.min,
            max:           PHOTO_RULES.cekPromoDesk.max,
            initialPhotos: promoDeskPhotos,
          },
        ]}
        onConfirmMulti={confirmCekPromo}
        onClearMulti={clearCekPromo}
        disabled={dis}
      />
    </div>
  );
}