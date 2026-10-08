'use client';
// app/employee/tasks/marketing-check/[id]/page.tsx

import { useEffect, useState, useCallback } from 'react';
import { useGeo } from '@/lib/hooks/useGeo';
import type { GeoPoint } from '@/lib/geo';
import { useParams, useRouter } from 'next/navigation';
import { CircleSlash, CloudOff, Megaphone } from 'lucide-react';
import { cn } from '@/lib/utils';
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

interface MarketingCheckData {
  id: string;
  scheduleId: string;
  userId: string;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day';
  date: string;
  status: TaskStatus;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;

  /** true = ada marketing / promo baru, false = tidak ada, null = belum dipilih. */
  hasMarketingCheck: boolean | null;

  promoName: boolean;
  promoPeriod: boolean;
  promoMechanism: boolean;
  randomShoeItems: boolean;
  randomNonShoeItems: boolean;
  sellTag: boolean;

  promoNameBy?: string | null;
  promoNameAt?: string | null;
  promoPeriodBy?: string | null;
  promoPeriodAt?: string | null;
  promoMechanismBy?: string | null;
  promoMechanismAt?: string | null;
  randomShoeItemsBy?: string | null;
  randomShoeItemsAt?: string | null;
  randomNonShoeItemsBy?: string | null;
  randomNonShoeItemsAt?: string | null;
  sellTagBy?: string | null;
  sellTagAt?: string | null;
  notesBy?: string | null;
  notesAt?: string | null;
  completedBy?: string | null;
  completedByScheduleId?: string | null;
}

function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: GeoPoint | null,
  geoReady: boolean,
  taskStatus: TaskStatus | undefined,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
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
      if (geo) {
        params.set('lat', String(geo.lat));
        params.set('lng', String(geo.lng)); if (geo.accuracy != null) params.set('acc', String(geo.accuracy));
      }

      const res = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => {
    if (geoReady) fetch_();
  }, [geoReady, fetch_]);

  return { accessStatus, accessLoading, refreshAccess: fetch_ };
}

export default function MarketingCheckDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('marketing_check');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData, setTaskData] = useState<MarketingCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [hasMarketingCheck, setHasMarketingCheck] = useState<boolean | null>(null);
  const [promoName, setPromoName] = useState(false);
  const [promoPeriod, setPromoPeriod] = useState(false);
  const [promoMechanism, setPromoMechanism] = useState(false);
  const [randomShoeItems, setRandomShoeItems] = useState(false);
  const [randomNonShoeItems, setRandomNonShoeItems] = useState(false);
  const [sellTag, setSellTag] = useState(false);
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as { tasks: { type: string; data: MarketingCheckData }[] };
      const found = data.tasks?.find(t => t.type === 'marketing_check' && t.data.id === taskId);

      if (found) {
        const d = found.data;
        setTaskData(d);
        // A row started before this choice existed (ticks but no answer) was
        // clearly a "yes".
        const anyTicked =
          d.promoName || d.promoPeriod || d.promoMechanism ||
          d.randomShoeItems || d.randomNonShoeItems || d.sellTag;
        setHasMarketingCheck(d.hasMarketingCheck ?? (anyTicked ? true : null));
        setPromoName(d.promoName);
        setPromoPeriod(d.promoPeriod);
        setPromoMechanism(d.promoMechanism);
        setRandomShoeItems(d.randomShoeItems);
        setRandomNonShoeItems(d.randomNonShoeItems);
        setSellTag(d.sellTag);
        setNotes(d.notes ?? '');
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[MarketingCheckDetailPage] load error:', e);
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

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId = taskData ? parseInt(taskData.storeId, 10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/marketing-check',
    baseBody: {},
    debounceMs: 800,
  });

  const makeAutoSaveBody = useCallback((patch: Record<string, unknown>) => ({
    taskId: taskData ? Number(taskData.id) : undefined,
    scheduleId: taskData ? Number(taskData.scheduleId) : undefined,
    storeId: taskData ? Number(taskData.storeId) : undefined,
    geo: geo ?? null,
    skipGeo: geo === null,
    ...patch,
  }), [taskData, geo]);

  const taskStatus = taskData?.status;
  const readonly = taskStatus === 'completed' || taskStatus === 'verified';
  const locked =
    !readonly &&
    !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  const setChk = (field: string, setter: (v: boolean) => void) => (v: boolean) => {
    setter(v);
    autoSave(makeAutoSaveBody({ [field]: v }));
  };

  const allChecked =
    promoName &&
    promoPeriod &&
    promoMechanism &&
    randomShoeItems &&
    randomNonShoeItems &&
    sellTag;

  const chooseMarketingCheck = (v: boolean) => {
    setHasMarketingCheck(v);
    autoSave(makeAutoSaveBody({ hasMarketingCheck: v }));
  };

  // No marketing / new promo today → nothing to tick, submit straight away.
  const canSubmit =
    !locked && (hasMarketingCheck === false || (hasMarketingCheck === true && allChecked));

  const submitHint = (() => {
    if (locked) return '';
    if (hasMarketingCheck === null) return 'Pilih dulu: ada marketing / promo baru hari ini atau tidak.';
    if (!hasMarketingCheck) return '';
    if (!promoName) return 'Checklist "Nama promo" belum ditandai.';
    if (!promoPeriod) return 'Checklist "Periode promo" belum ditandai.';
    if (!promoMechanism) return 'Checklist "Mekanisme promo" belum ditandai.';
    if (!randomShoeItems) return 'Checklist "5 item sepatu" belum ditandai.';
    if (!randomNonShoeItems) return 'Checklist "5 item non-sepatu" belum ditandai.';
    if (!sellTag) return 'Checklist "Sell tag" belum ditandai.';
    return '';
  })();

  async function handleSubmit() {
    if (!taskData) return;

    setSubmitError(null);

    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Muat ulang halaman.';
      setSubmitError(msg);
      toast.error(msg);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/marketing-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: Number(taskData.id),
          scheduleId,
          storeId,
          geo: geo ?? null,
          skipGeo: geo === null,
          hasMarketingCheck,
          promoName,
          promoPeriod,
          promoMechanism,
          randomShoeItems,
          randomNonShoeItems,
          sellTag,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) {
        json = await res.json();
      }

      if (!res.ok || json.success === false) {
        const serverMsg =
          (typeof json.error === 'string' && json.error) ||
          (typeof json.message === 'string' && json.message) ||
          `HTTP ${res.status}`;
        setSubmitError(serverMsg);
        toast.error(serverMsg, { duration: 6000 });
        return;
      }

      toast.success('Marketing Check berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  const groups = [
    {
      title: 'Cek promo berjalan',
      items: [
        { label: 'Nama promo',      checked: promoName,      toggle: setChk('promoName', setPromoName) },
        { label: 'Periode promo',   checked: promoPeriod,    toggle: setChk('promoPeriod', setPromoPeriod) },
        { label: 'Mekanisme promo', checked: promoMechanism, toggle: setChk('promoMechanism', setPromoMechanism) },
      ],
    },
    {
      title: 'Random checking',
      items: [
        { label: '5 item sepatu',     checked: randomShoeItems,    toggle: setChk('randomShoeItems', setRandomShoeItems) },
        { label: '5 item non-sepatu', checked: randomNonShoeItems, toggle: setChk('randomNonShoeItems', setRandomNonShoeItems) },
      ],
    },
    {
      title: 'Sell tag',
      items: [
        { label: 'Sell tag', checked: sellTag, toggle: setChk('sellTag', setSellTag) },
      ],
    },
  ];

  return (
    <>
      <TaskHeader
        title="Marketing Check"
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
          <EmptyState title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative">
            {!readonly && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            <div className="space-y-5">
              <Section title="Ada marketing / promo baru hari ini?">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: true,  label: 'Ada',       sub: 'Cek promo & sell tag', Icon: Megaphone },
                    { value: false, label: 'Tidak ada', sub: 'Submit tanpa checklist', Icon: CircleSlash },
                  ] as const).map((o) => {
                    const selected = hasMarketingCheck === o.value;
                    return (
                      <button
                        key={o.label}
                        type="button"
                        aria-pressed={selected}
                        disabled={dis}
                        onClick={() => chooseMarketingCheck(o.value)}
                        className={cn(
                          'flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:opacity-60',
                          selected
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border bg-card text-muted-foreground',
                        )}
                      >
                        <o.Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', selected && 'text-primary')} />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{o.label}</span>
                          <span className="block text-[11px] leading-snug text-muted-foreground">{o.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              {hasMarketingCheck === false && (
                <Notice tone="neutral" icon={CircleSlash}>
                  {readonly
                    ? 'Tidak ada marketing / promo baru hari ini — checklist tidak diisi.'
                    : 'Tidak ada marketing / promo baru hari ini — Marketing Check bisa langsung disubmit tanpa checklist.'}
                </Notice>
              )}

              {hasMarketingCheck === true && groups.map(g => (
                <Section key={g.title} title={g.title} meta={`${g.items.filter(i => i.checked).length}/${g.items.length}`}>
                  <ListGroup>
                    {g.items.map(i => (
                      <CheckRow
                        key={i.label}
                        label={i.label}
                        checked={i.checked}
                        onToggle={() => i.toggle(!i.checked)}
                        disabled={dis}
                      />
                    ))}
                  </ListGroup>
                </Section>
              ))}

              <NotesField
                value={notes}
                onChange={(v) => {
                  setNotes(v);
                  autoSave(makeAutoSaveBody({ notes: v }));
                }}
                disabled={dis}
                rows={3}
              />
            </div>
          </div>
        )}
      </PageBody>

      {taskData && (
        <TaskSubmitBar
          label={hasMarketingCheck === false ? 'Submit tanpa Marketing Check' : 'Submit Marketing Check'}
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
