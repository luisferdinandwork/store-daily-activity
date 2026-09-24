'use client';
// app/employee/tasks/vm-checklist/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter }             from 'next/navigation';
import { CloudOff, Save } from 'lucide-react';
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

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface VmChecklistData {
  id: string; scheduleId: string; userId: string; storeId: string;
  shift: string; date: string; status: TaskStatus; notes: string | null;
  completedAt: string | null; verifiedBy: string | null; verifiedAt: string | null;
  shoeLaceShoeFillerPriceTagHangtagLabelK3L:               boolean;
  lastPairAndPigskinHangtag:                               boolean;
  popPromoUpdate:                                          boolean;
  displayTableWallShelvingShowcaseHangbarStackingPedestal: boolean;
  floorDisplayCleanliness:                                 boolean;
  vmToolsStorage:                                          boolean;
}

const CHECKLIST_ITEMS = [
  { key: 'shoeLaceShoeFillerPriceTagHangtagLabelK3L',               label: 'Shoe Lace, Shoe Filler, Price Tag, Hangtag, Label K3L',                        description: 'Kelengkapan atribut produk sepatu telah dicek.' },
  { key: 'lastPairAndPigskinHangtag',                               label: 'Last Pair & Pigskin Hangtag',                                                    description: 'Hangtag last pair dan pigskin sudah terpasang dengan benar.' },
  { key: 'popPromoUpdate',                                          label: 'POP / Promo Update',                                                              description: 'Materi POP dan promo telah diperbarui sesuai periode berjalan.' },
  { key: 'displayTableWallShelvingShowcaseHangbarStackingPedestal', label: 'Display: Table, Wall, Shelving, Showcase, Hangbar, Stacking, Pedestal',          description: 'Semua area display produk tersusun rapi dan sesuai standar VM.' },
  { key: 'floorDisplayCleanliness',                                 label: 'Floor Display Cleanliness',                                                       description: 'Area lantai display bersih dan bebas dari kotoran.' },
  { key: 'vmToolsStorage',                                          label: 'VM Tools Storage',                                                                description: 'Peralatan VM disimpan di tempat yang benar setelah digunakan.' },
] as const;

// ─── Hooks ────────────────────────────────────────────────────────────────────

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
      () => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);
  useEffect(() => { refresh(); }, [refresh]);
  return { geo, geoError, geoReady, refresh };
}

function useAccessStatus(scheduleId: string, storeId: string, geo: { lat: number; lng: number } | null, geoReady: boolean, taskStatus: TaskStatus | undefined) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const fetch_ = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) { setAccessStatus({ status: 'ok' }); setAccessLoading(false); return; }
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

// ─── Shared UI (identical to Store Opening) ───────────────────────────────────

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VmChecklistDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const { requiresLocation } = useTaskLocationSetting('vm_checklist');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData,   setTaskData]   = useState<VmChecklistData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [notes,  setNotes]  = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: VmChecklistData }[] };
      const found = data.tasks?.find(t => t.type === 'vm_checklist' && t.data.id === taskId);
      if (found) {
        const d = found.data; setTaskData(d); setNotes(d.notes ?? '');
        const init: Record<string, boolean> = {};
        for (const item of CHECKLIST_ITEMS) init[item.key] = Boolean((d as any)[item.key]);
        setChecks(init);
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
    url: '/api/employee/tasks/vm-checklist', baseBody: { taskId: taskIdNum }, debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const locked     = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  const checkedCount = CHECKLIST_ITEMS.filter(i => checks[i.key]).length;
  const allChecked   = checkedCount === CHECKLIST_ITEMS.length;
  const canSubmit    = !locked && allChecked;

  function handleCheck(key: string, value: boolean) {
    setChecks(prev => ({ ...prev, [key]: value }));
    autoSave({ [key]: value });
  }

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/vm-checklist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: parseInt(taskData.scheduleId, 10),
          storeId:    parseInt(taskData.storeId,    10),
          geo: geo ?? null, skipGeo: geo === null,
          ...checks, notes: notes || undefined,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }
      toast.success('VM Checklist berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  return (
    <>
      <TaskHeader
        title="VM Checklist"
        subtitle={shiftLabel(taskData?.shift)}
        status={taskStatus}
        saveIndicator={
          !readonly && !loading && taskData ? (
            <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
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
          <Notice tone="info" icon={Save}>
            Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.
          </Notice>
        )}

        {loading ? (
          <SkeletonBlocks count={6} className="h-16" />
        ) : !taskData ? (
          <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            <div className="space-y-5">
              <Section title="Checklist VM" meta={`${checkedCount}/${CHECKLIST_ITEMS.length}`}>
                <ListGroup>
                  {CHECKLIST_ITEMS.map(item => (
                    <CheckRow
                      key={item.key}
                      label={item.label}
                      hint={item.description}
                      checked={Boolean(checks[item.key])}
                      disabled={dis}
                      onToggle={() => handleCheck(item.key, !checks[item.key])}
                    />
                  ))}
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
          label="Submit VM Checklist"
          onSubmit={handleSubmit}
          submitting={submitting}
          disabled={!canSubmit}
          hidden={readonly}
          hint={!canSubmit && !locked ? `Centang semua ${CHECKLIST_ITEMS.length} item untuk melanjutkan.` : undefined}
        />
      )}
    </>
  );
}
