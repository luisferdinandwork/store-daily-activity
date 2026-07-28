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

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, X, Loader2,
  AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import { TaskHeader, TaskSubmitBar, SaveIndicator } from '@/components/employee/tasks';
import PhotoUploadGrid from '@/components/shared/PhotoUploadGrid';
import { uploadTaskPhoto } from '@/lib/tasks-upload';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface GroomingData {
  id:             string;
  scheduleId:     string;
  userId:         string;
  storeId:        string;
  shift:          'morning' | 'evening' | 'full_day';
  date:           string;
  status:         TaskStatus;
  notes:          string | null;
  completedAt:    string | null;
  verifiedBy:     string | null;
  verifiedAt:     string | null;

  uniformActive:  boolean;
  hairActive:     boolean;
  smellActive:    boolean;
  makeUpActive:   boolean;
  shoeActive:     boolean;
  nameTagActive:  boolean;

  uniformChecked: boolean | null;
  hairChecked:    boolean | null;
  smellChecked:   boolean | null;
  makeUpChecked:  boolean | null;
  shoeChecked:    boolean | null;
  nameTagChecked: boolean | null;

  selfiePhotos:   string[];
}

// ─── Photo rules (mirrors server) ─────────────────────────────────────────────

const PHOTO_RULES = {
  selfie: { min: 1, max: 3 },
} as const;

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo(required: boolean) {
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
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
      ()  => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);

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
  return (
    <PhotoUploadGrid
      label={label}
      hint={hint}
      photos={photos}
      onChange={onChange}
      min={min}
      max={max}
      disabled={disabled}
      tileSize="lg"
      facingMode="user"
      upload={file => uploadTaskPhoto(file, photoType)}
    />
  );
}

// ─── Simple checklist item (matches other task pages) ─────────────────────────

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

  const { requiresLocation } = useTaskLocationSetting('grooming');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData,    setTaskData]    = useState<GroomingData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form state - Checklist
  const [uniformChecked, setUniformChecked] = useState(false);
  const [hairChecked, setHairChecked] = useState(false);
  const [smellChecked, setSmellChecked] = useState(false);
  const [makeUpChecked, setMakeUpChecked] = useState(false);
  const [shoeChecked, setShoeChecked] = useState(false);
  const [nameTagChecked, setNameTagChecked] = useState(false);

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
        setUniformChecked(d.uniformChecked === true);
        setHairChecked(d.hairChecked === true);
        setSmellChecked(d.smellChecked === true);
        setMakeUpChecked(d.makeUpChecked === true);
        setShoeChecked(d.shoeChecked === true);
        setNameTagChecked(d.nameTagChecked === true);
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

  // ── Checklist handler ────────────────────────────────────────────────────
  const setChk = (field: string, setter: (v: boolean) => void) => (v: boolean) => {
    setter(v);
    autoSave({ [field]: v });
  };

  // ── Submit gate ───────────────────────────────────────────────────────────
  const isUniformValid = uniformChecked;
  const isHairValid    = hairChecked;
  const isSmellValid   = smellChecked;
  const isMakeUpValid  = makeUpChecked;
  const isShoeValid    = shoeChecked;
  const isNameTagValid = nameTagChecked;

  const allChecklistValid =
    isUniformValid &&
    isHairValid &&
    isSmellValid &&
    isMakeUpValid &&
    isShoeValid &&
    isNameTagValid;
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
          scheduleId,
          storeId,
          geo: geo ?? null,
          skipGeo: geo === null,

          uniformChecked,
          hairChecked,
          smellChecked,
          makeUpChecked,
          shoeChecked,
          nameTagChecked,

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
    if (!isUniformValid) return 'Centang "Uniform".';
    if (!isHairValid) return 'Centang "Hair".';
    if (!isSmellValid) return 'Centang "Smell".';
    if (!isMakeUpValid) return 'Centang "Make up".';
    if (!isShoeValid) return 'Centang "Shoes".';
    if (!isNameTagValid) return 'Centang "Name Tag".';
    if (!selfieValid) return `Upload min ${PHOTO_RULES.selfie.min} foto selfie.`;
    return '';
  })();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <TaskHeader
        title="Grooming"
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
                  <SimpleCheckItem
                    label="Uniform"
                    checked={uniformChecked}
                    onChange={setChk('uniformChecked', setUniformChecked)}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Hair"
                    checked={hairChecked}
                    onChange={setChk('hairChecked', setHairChecked)}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Smell"
                    checked={smellChecked}
                    onChange={setChk('smellChecked', setSmellChecked)}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Make up"
                    checked={makeUpChecked}
                    onChange={setChk('makeUpChecked', setMakeUpChecked)}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Shoes"
                    checked={shoeChecked}
                    onChange={setChk('shoeChecked', setShoeChecked)}
                    disabled={dis}
                  />

                  <SimpleCheckItem
                    label="Name Tag"
                    checked={nameTagChecked}
                    onChange={setChk('nameTagChecked', setNameTagChecked)}
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

              <TaskSubmitBar
                  label="Submit Grooming"
                  onSubmit={handleSubmit}
                  submitting={submitting}
                  disabled={!canSubmit}
                  hidden={readonly}
                  hint={!canSubmit ? submitHint : undefined}
                />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}