'use client';
// app/employee/tasks/store-front/[id]/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter }                      from 'next/navigation';
import { CloudOff, DoorClosed, Save, Store } from 'lucide-react';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel,
} from '@/components/employee/tasks';
import {
  EmptyState, ListGroup, Notice, NotesField, PageBody, PhotoSetRow, Section,
  SkeletonBlocks, TaskReviewNotices,
} from '@/components/employee/ui';
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected';

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

function useGeo(required: boolean) {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const refresh = useCallback(() => {
    if (!required) { setGeo(null); setGeoError(null); setGeoReady(true); return; }
    setGeoReady(false); setGeoError(null);
    if (!navigator.geolocation) { setGeoError('Geolocation tidak didukung.'); setGeoReady(true); return; }
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoreFrontDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const { requiresLocation } = useTaskLocationSetting('store_front');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

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

  const photosDone = (storefrontSatisfied ? 1 : 0) + (rollingDoorSatisfied ? 1 : 0);

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
    <>
      <TaskHeader
        title="Store Front"
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
            accessStatus={accessStatus} accessLoading={accessLoading}
            geoReady={geoReady} geo={geo} geoError={geoError}
            onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
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

        {!readonly && !locked && !loading && taskData && (
          <Notice tone="info" icon={Save}>Perubahan otomatis tersimpan.</Notice>
        )}

        {loading ? (
          <SkeletonBlocks count={3} className="h-24" />
        ) : !taskData ? (
          <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            <div className="space-y-5">
              <Section title="Foto wajib" meta={`${photosDone}/2`}>
                <ListGroup>
                  {/* Storefront — multi photo (min 1, max 3) */}
                  <PhotoSetRow
                    title="Foto Storefront"
                    hint={
                      storefrontSatisfied
                        ? 'Ketuk untuk lihat / ubah foto'
                        : 'Kedua karyawan di depan toko · maks 3 foto'
                    }
                    photos={storefrontPhotos}
                    required={PHOTO_RULES.storefront.min}
                    onClick={() => setStorefrontModalOpen(true)}
                    disabled={dis}
                    icon={<Store className="h-4 w-4" />}
                  />
                  {/* Rolling door — single photo */}
                  <PhotoSetRow
                    title="Rolling Door Tertutup"
                    hint={
                      rollingDoorSatisfied
                        ? 'Ketuk untuk ganti foto'
                        : 'Sebelum toko dibuka'
                    }
                    photos={rollingDoorPhotos}
                    required={PHOTO_RULES.rollingDoor.min}
                    onClick={() => setRollingDoorModalOpen(true)}
                    disabled={dis}
                    icon={<DoorClosed className="h-4 w-4" />}
                  />
                </ListGroup>
              </Section>

              <NotesField
                value={notes}
                disabled={dis}
                rows={3}
                onChange={(v) => { setNotes(v); autoSave({ notes: v }); }}
              />
            </div>
          </div>
        )}
      </PageBody>

      {taskData && (
        <TaskSubmitBar
          label="Submit Store Front"
          onSubmit={handleSubmit}
          submitting={submitting}
          disabled={!canSubmit}
          hidden={readonly}
          hint={!canSubmit ? submitHint : undefined}
        />
      )}

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
    </>
  );
}