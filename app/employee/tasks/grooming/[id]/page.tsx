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
import { CloudOff } from 'lucide-react';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel,
} from '@/components/employee/tasks';
import {
  CheckRow, EmptyState, ListGroup, Notice, NotesField, PageBody, Section,
  SkeletonBlocks, TaskReviewNotices,
} from '@/components/employee/ui';
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

  const CHECKS = [
    { label: 'Uniform',  checked: uniformChecked, toggle: setChk('uniformChecked', setUniformChecked) },
    { label: 'Hair',     checked: hairChecked,    toggle: setChk('hairChecked', setHairChecked) },
    { label: 'Smell',    checked: smellChecked,   toggle: setChk('smellChecked', setSmellChecked) },
    { label: 'Make up',  checked: makeUpChecked,  toggle: setChk('makeUpChecked', setMakeUpChecked) },
    { label: 'Shoes',    checked: shoeChecked,    toggle: setChk('shoeChecked', setShoeChecked) },
    { label: 'Name Tag', checked: nameTagChecked, toggle: setChk('nameTagChecked', setNameTagChecked) },
  ];

  return (
    <>
      <TaskHeader
        title="Grooming"
        subtitle={shiftLabel(taskData?.shift)}
        status={taskStatus}
        saveIndicator={
          !readonly && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved ?? null} />
          ) : null
        }
      />

      <PageBody bottomBar={!readonly && !!taskData}>
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus}
            accessLoading={accessLoading}
            geoReady={geoReady}
            geo={geo}
            geoError={geoError}
            onRefreshGeo={refreshGeo}
            onRefreshAccess={refreshAccess}
            requireGeo={requiresLocation}
            allowWithoutGeo
          />
        )}

        {submitError && (
          <Notice tone="error" title="Submit gagal" onDismiss={() => setSubmitError(null)}>
            {submitError}
          </Notice>
        )}

        {saveError && !readonly && (
          <Notice tone="warning" icon={CloudOff}>Auto-save gagal: {saveError}</Notice>
        )}

        <TaskReviewNotices status={taskStatus} notes={taskData?.notes} verifiedAt={taskData?.verifiedAt} />

        {loading ? (
          <SkeletonBlocks count={4} className="h-14" />
        ) : !taskData ? (
          <EmptyState title="Task tidak ditemukan" description="Task mungkin sudah tidak tersedia." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            <div className="space-y-5">
              <Section title="Penampilan diri" meta={`${CHECKS.filter(c => c.checked).length}/${CHECKS.length}`}>
                <ListGroup>
                  {CHECKS.map(c => (
                    <CheckRow
                      key={c.label}
                      label={c.label}
                      checked={c.checked}
                      onToggle={() => c.toggle(!c.checked)}
                      disabled={dis}
                    />
                  ))}
                </ListGroup>
              </Section>

              {/* Selfie Photo — inline uploader */}
              <Section title="Foto selfie" meta={`${selfiePhotos.length}/${PHOTO_RULES.selfie.min}`}>
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

              <NotesField
                value={notes}
                onChange={(v) => { setNotes(v); autoSave({ notes: v }); }}
                disabled={dis}
                rows={3}
              />
            </div>
          </div>
        )}
      </PageBody>

      {taskData && (
        <TaskSubmitBar
          label="Submit Grooming"
          onSubmit={handleSubmit}
          submitting={submitting}
          disabled={!canSubmit}
          hidden={readonly}
          hint={!canSubmit ? submitHint : undefined}
        />
      )}
    </>
  );
}
