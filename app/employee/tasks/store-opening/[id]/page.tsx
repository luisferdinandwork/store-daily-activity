'use client';
// app/employee/tasks/store-opening/[id]/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CloudOff, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, TaskSubmitBar, SaveIndicator, shiftLabel,
} from '@/components/employee/tasks';
import {
  CheckRow, ListGroup, Notice, NotesField, PageBody, PhotoCheckRow, Section,
  SkeletonBlocks, EmptyState, TaskReviewNotices,
} from '@/components/employee/ui';
import ChecklistPhotoModal from '@/components/tasks/ChecklistPhotoModal';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected';

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
  shift:             'morning' | 'evening' | 'full_day';
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
  // Per-area 5R photos
  fiveRAreaKasirPhotos:  string[];
  fiveRAreaDepanPhotos:  string[];
  fiveRAreaKananPhotos:  string[];
  fiveRAreaKiriPhotos:   string[];
  fiveRAreaGudangPhotos: string[];
  cekLamp:           boolean;
  cekSoundSystem:    boolean;
  cashDrawerPhotos:  string[];

  // Backend field-level actor tracking. These are intentionally optional here
  // because the employee page does not need to render them; OPS monitor uses them.
  loginPosBy?: string | null;
  loginPosAt?: string | null;
  checkAbsenSunfishBy?: string | null;
  checkAbsenSunfishAt?: string | null;
  tarikSohSalesBy?: string | null;
  tarikSohSalesAt?: string | null;
  fiveRBy?: string | null;
  fiveRAt?: string | null;
  fiveRAreaKasirBy?: string | null;
  fiveRAreaKasirAt?: string | null;
  fiveRAreaDepanBy?: string | null;
  fiveRAreaDepanAt?: string | null;
  fiveRAreaKananBy?: string | null;
  fiveRAreaKananAt?: string | null;
  fiveRAreaKiriBy?: string | null;
  fiveRAreaKiriAt?: string | null;
  fiveRAreaGudangBy?: string | null;
  fiveRAreaGudangAt?: string | null;
  cekLampBy?: string | null;
  cekLampAt?: string | null;
  cekSoundSystemBy?: string | null;
  cekSoundSystemAt?: string | null;
  cashDrawerBy?: string | null;
  cashDrawerAt?: string | null;
  completedBy?: string | null;
  completedByScheduleId?: string | null;
}

// ─── 5R area config ───────────────────────────────────────────────────────────

const FIVE_R_AREAS = [
  { key: 'kasir',  label: 'Area Kasir',  photoType: 'five_r_kasir'  },
  { key: 'depan',  label: 'Depan Toko',  photoType: 'five_r_depan'  },
  { key: 'kanan',  label: 'Sisi Kanan',  photoType: 'five_r_kanan'  },
  { key: 'kiri',   label: 'Sisi Kiri',   photoType: 'five_r_kiri'   },
  { key: 'gudang', label: 'Gudang',      photoType: 'five_r_gudang' },
] as const;

type FiveRAreaKey = typeof FIVE_R_AREAS[number]['key'];

type FiveRPhotos = Record<FiveRAreaKey, string[]>;

const EMPTY_FIVE_R: FiveRPhotos = {
  kasir: [], depan: [], kanan: [], kiri: [], gudang: [],
};

// ─── Photo rules ──────────────────────────────────────────────────────────────

const PHOTO_RULES = {
  cashierDesk: { min: 1, max: 2 },
  fiveRArea:   { min: 1, max: 2 },   // per area
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StoreOpeningDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('store_opening');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData,    setTaskData]    = useState<StoreOpeningData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Modals
  const [loginPosModalOpen, setLoginPosModalOpen] = useState(false);
  const [fiveRModalOpen,    setFiveRModalOpen]    = useState(false);

  // Form state
  const [loginPos,          setLoginPos]          = useState(false);
  const [checkAbsenSunfish, setCheckAbsenSunfish] = useState(false);
  const [tarikSohSales,     setTarikSohSales]     = useState(false);
  const [fiveR,             setFiveR]             = useState(false);
  const [fiveRPhotos,       setFiveRPhotos]       = useState<FiveRPhotos>(EMPTY_FIVE_R);
  const [cekLamp,           setCekLamp]           = useState(false);
  const [cekSoundSystem,    setCekSoundSystem]    = useState(false);
  const [cashierDeskPhotos, setCashierDeskPhotos] = useState<string[]>([]);
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
        setFiveRPhotos({
          kasir:  d.fiveRAreaKasirPhotos  ?? [],
          depan:  d.fiveRAreaDepanPhotos  ?? [],
          kanan:  d.fiveRAreaKananPhotos  ?? [],
          kiri:   d.fiveRAreaKiriPhotos   ?? [],
          gudang: d.fiveRAreaGudangPhotos ?? [],
        });
        setCekLamp(d.cekLamp);
        setCekSoundSystem(d.cekSoundSystem);
        setCashierDeskPhotos(d.cashDrawerPhotos ?? []);
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

  const { status: saveStatus, lastSaved, error: saveError, save: rawAutoSave } = useAutoSave({
    url:        '/api/employee/tasks/store-opening',
    // Keep scheduleId/storeId for compatibility and include taskId so the
    // backend can update the exact shared store-opening row and record
    // field-level actor metadata correctly.
    baseBody:   { taskId: taskData ? Number(taskData.id) : 0, scheduleId, storeId },
    debounceMs: 800,
  });

  const autoSave = useCallback((patch: Record<string, unknown>, options?: { immediate?: boolean }) => {
    if (!taskData || !scheduleId || !storeId) {
      toast.error('Data task belum siap. Coba ulangi setelah halaman selesai dimuat.');
      return;
    }

    if (!geo) {
      toast.error('Lokasi wajib aktif sebelum menyimpan Store Opening.');
      return;
    }

    // Always include the latest ids in the PATCH body. This avoids stale baseBody
    // from useAutoSave when the first render had taskId: 0.
    rawAutoSave({
      taskId: Number(taskData.id),
      scheduleId,
      storeId,
      ...patch,
      geo,
      skipGeo: false,
    }, options);
  }, [geo, rawAutoSave, scheduleId, storeId, taskData]);

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const locationBlocked = requiresLocation && (!geoReady || !geo || accessStatus?.status === 'geo_unavailable');
  const locked =
    !readonly &&
    (accessLoading ||
      locationBlocked ||
      accessStatus?.status === 'not_checked_in' ||
      accessStatus?.status === 'outside_geofence');
  const dis = readonly || locked;

  // Simple checklist setter + auto-save
  const setChk = (field: string, setter: (v: boolean) => void) => (v: boolean) => {
    setter(v); autoSave({ [field]: v });
  };

  // ── Login POS modal ────────────────────────────────────────────────────────
  function syncLoginPosPhotos(photos: string[]) {
    const nextPhotos = Array.isArray(photos) ? photos : [];
    const done = nextPhotos.length >= PHOTO_RULES.cashierDesk.min;

    setCashierDeskPhotos(nextPhotos);
    setLoginPos(done);

    // Save immediately on every add/remove from the modal, so closing and
    // reopening the modal keeps the latest photos without needing Confirm.
    autoSave(
      { cashierDeskPhotos: nextPhotos, loginPos: done },
      { immediate: true },
    );
  }

  function confirmLoginPos(photos: string[]) {
    syncLoginPosPhotos(photos);
  }

  function clearLoginPos() {
    syncLoginPosPhotos([]);
  }

  // ── 5R modal ───────────────────────────────────────────────────────────────
  function normalizeFiveRPhotos(results: Record<string, string[]>): FiveRPhotos {
    return {
      kasir:  Array.isArray(results.kasir)  ? results.kasir  : [],
      depan:  Array.isArray(results.depan)  ? results.depan  : [],
      kanan:  Array.isArray(results.kanan)  ? results.kanan  : [],
      kiri:   Array.isArray(results.kiri)   ? results.kiri   : [],
      gudang: Array.isArray(results.gudang) ? results.gudang : [],
    };
  }

  function syncFiveRPhotos(results: Record<string, string[]>) {
    const next = normalizeFiveRPhotos(results);
    const allDone = FIVE_R_AREAS.every(
      a => (next[a.key]?.length ?? 0) >= PHOTO_RULES.fiveRArea.min,
    );

    setFiveRPhotos(next);
    setFiveR(allDone);

    // Save immediately on every bucket photo add/remove from the modal.
    // This makes each 5R area persist as soon as it changes.
    autoSave(
      {
        fiveRAreaKasirPhotos:  next.kasir,
        fiveRAreaDepanPhotos:  next.depan,
        fiveRAreaKananPhotos:  next.kanan,
        fiveRAreaKiriPhotos:   next.kiri,
        fiveRAreaGudangPhotos: next.gudang,
        fiveR: allDone,
      },
      { immediate: true },
    );
  }

  function confirmFiveR(results: Record<string, string[]>) {
    syncFiveRPhotos(results);
  }

  function clearFiveR() {
    syncFiveRPhotos(EMPTY_FIVE_R);
  }

  // ── Submit gate ───────────────────────────────────────────────────────────
  const cashierDeskSatisfied   = cashierDeskPhotos.length >= PHOTO_RULES.cashierDesk.min;
  const fiveRAllAreasSatisfied = FIVE_R_AREAS.every(
    a => (fiveRPhotos[a.key]?.length ?? 0) >= PHOTO_RULES.fiveRArea.min,
  );
  const fiveRTotalPhotos = FIVE_R_AREAS.reduce(
    (s, a) => s + (fiveRPhotos[a.key]?.length ?? 0), 0,
  );

  const allSimpleChecked =
    checkAbsenSunfish && tarikSohSales && cekLamp && cekSoundSystem;
  const allLinkedChecked =
    loginPos && cashierDeskSatisfied &&
    fiveR    && fiveRAllAreasSatisfied;

  const canSubmit = !locked && !!geo && accessStatus?.status === 'ok' && allSimpleChecked && allLinkedChecked;

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }
    if (!geo) {
      const msg = 'Lokasi wajib aktif untuk submit Store Opening.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/store-opening', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskData.id),
          scheduleId, storeId,
          geo, skipGeo: false,
          loginPos, checkAbsenSunfish, tarikSohSales,
          fiveR,
          fiveRAreaKasirPhotos:  fiveRPhotos.kasir,
          fiveRAreaDepanPhotos:  fiveRPhotos.depan,
          fiveRAreaKananPhotos:  fiveRPhotos.kanan,
          fiveRAreaKiriPhotos:   fiveRPhotos.kiri,
          fiveRAreaGudangPhotos: fiveRPhotos.gudang,
          cekLamp, cekSoundSystem,
          cashierDeskPhotos,
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

  // Hint below disabled submit button
  const submitHint = (() => {
    if (locked) return '';
    if (!loginPos || !cashierDeskSatisfied)
      return `Lengkapi "Log-in POS" — upload min ${PHOTO_RULES.cashierDesk.min} foto meja kasir.`;
    if (!fiveRAllAreasSatisfied) {
      const missing = FIVE_R_AREAS.find(a => (fiveRPhotos[a.key]?.length ?? 0) < PHOTO_RULES.fiveRArea.min);
      return missing ? `5R: upload min 1 foto untuk area "${missing.label}".` : '';
    }
    if (!allSimpleChecked) return 'Lengkapi semua checklist lain.';
    return '';
  })();

  return (
    <>
      <TaskHeader
        title="Store Opening"
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
          <Notice tone="info" icon={Save}>
            Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.
          </Notice>
        )}

        {loading ? (
          <SkeletonBlocks count={4} className="h-14" />
        ) : !taskData ? (
          <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} />}

            <div className="space-y-5">
              <Section title="Checklist Pembukaan" meta={`${[loginPos && cashierDeskSatisfied, checkAbsenSunfish, tarikSohSales, fiveR && fiveRAllAreasSatisfied, cekLamp, cekSoundSystem].filter(Boolean).length}/6`}>
                <ListGroup>
                  {/* Log-in POS — opens modal for cashier desk photos */}
                  <PhotoCheckRow
                    label="Log-in POS / Buka Komputer Kasir"
                    hint="Ketuk untuk upload foto meja kasir."
                    checked={loginPos}
                    photoCount={cashierDeskPhotos.length}
                    requiredCount={PHOTO_RULES.cashierDesk.min}
                    onClick={() => setLoginPosModalOpen(true)}
                    disabled={dis}
                  />
                  <CheckRow
                    label="Tarik & cek absen di Sunfish"
                    checked={checkAbsenSunfish}
                    onToggle={() => setChk('checkAbsenSunfish', setCheckAbsenSunfish)(!checkAbsenSunfish)}
                    disabled={dis}
                  />
                  <CheckRow
                    label="Tarik SOH & Sales"
                    checked={tarikSohSales}
                    onToggle={() => setChk('tarikSohSales', setTarikSohSales)(!tarikSohSales)}
                    disabled={dis}
                  />
                  {/* 5R — opens multi-bucket modal */}
                  <PhotoCheckRow
                    label="5R — Kebersihan Toko"
                    hint="Foto per area: kasir, depan, kanan, kiri, gudang."
                    checked={fiveR && fiveRAllAreasSatisfied}
                    photoCount={fiveRTotalPhotos}
                    requiredCount={FIVE_R_AREAS.length * PHOTO_RULES.fiveRArea.min}
                    onClick={() => setFiveRModalOpen(true)}
                    disabled={dis}
                  />
                  <CheckRow
                    label="Cek semua lampu menyala"
                    checked={cekLamp}
                    onToggle={() => setChk('cekLamp', setCekLamp)(!cekLamp)}
                    disabled={dis}
                  />
                  <CheckRow
                    label="Cek sound system"
                    checked={cekSoundSystem}
                    onToggle={() => setChk('cekSoundSystem', setCekSoundSystem)(!cekSoundSystem)}
                    disabled={dis}
                  />
                </ListGroup>
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
          label="Submit Store Opening"
          onSubmit={handleSubmit}
          submitting={submitting}
          disabled={!canSubmit}
          hidden={readonly}
          hint={!canSubmit ? submitHint : undefined}
        />
      )}

      {/* ── Login POS modal ───────────────────────────────────────────────── */}
      <ChecklistPhotoModal
        open={loginPosModalOpen}
        onClose={() => setLoginPosModalOpen(false)}
        title="Log-in POS / Buka Komputer Kasir"
        description="Foto meja kasir sebagai bukti POS sudah aktif dan siap."
        photoType="cashier_desk"
        min={PHOTO_RULES.cashierDesk.min}
        max={PHOTO_RULES.cashierDesk.max}
        initialPhotos={cashierDeskPhotos}
        onConfirm={confirmLoginPos}
        onChange={syncLoginPosPhotos}
        onClear={clearLoginPos}
        disabled={dis}
      />

      {/* ── 5R modal ──────────────────────────────────────────────────────── */}
      <ChecklistPhotoModal
        open={fiveRModalOpen}
        onClose={() => setFiveRModalOpen(false)}
        title="5R — Kebersihan Toko"
        description="Upload min 1 foto per area sebagai bukti 5R."
        buckets={FIVE_R_AREAS.map(area => ({
          key:           area.key,
          label:         area.label,
          photoType:     area.photoType,
          min:           PHOTO_RULES.fiveRArea.min,
          max:           PHOTO_RULES.fiveRArea.max,
          initialPhotos: fiveRPhotos[area.key] ?? [],
        }))}
        onConfirmMulti={confirmFiveR}
        onChangeMulti={syncFiveRPhotos}
        onClearMulti={clearFiveR}
        disabled={dis}
      />
    </>
  );
}
