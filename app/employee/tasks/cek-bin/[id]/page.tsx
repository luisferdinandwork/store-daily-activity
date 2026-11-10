'use client';
// app/employee/tasks/cek-bin/[id]/page.tsx
//
// Cek Bin: the bins are scanned in Business Central; this page shows what BC says is
// still WRONG (components/employee/BinCheckResults.tsx). There is nothing to fill in
// and no submit button — the task is marked done by itself the moment the employee
// opens it (once they are checked in / inside the store), see completeCekBin().

import { useCallback, useEffect, useRef, useState } from 'react';
import { useGeo } from '@/lib/hooks/useGeo';
import type { GeoPoint } from '@/lib/geo';
import { useParams } from 'next/navigation';
import { Box, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import {
  AccessBanner, LockedOverlay, TaskHeader, shiftLabel,
} from '@/components/employee/tasks';
import {
  EmptyState, Notice, PageBody, SkeletonBlocks, TaskReviewNotices,
} from '@/components/employee/ui';
import BinCheckResults from '@/components/employee/BinCheckResults';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'pending';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface CekBinData {
  id: string; scheduleId: string; userId?: string; storeId: string;
  shift: string; date: string; status: TaskStatus; notes: string | null;
  completedAt: string | null; verifiedBy?: string | null; verifiedAt: string | null;
}

function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

/** Past "open": nothing left to record, the page only shows the BC result. */
const FINISHED: TaskStatus[] = ['completed', 'verified', 'rejected'];

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(scheduleId: string, storeId: string, geo: GeoPoint | null, geoReady: boolean, taskStatus?: TaskStatus) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const check = useCallback(async () => {
    if (taskStatus && FINISHED.includes(taskStatus)) { setAccessStatus({ status: 'ok' }); setAccessLoading(false); return; }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) { p.set('lat', String(geo.lat)); p.set('lng', String(geo.lng)); if (geo.accuracy != null) p.set('acc', String(geo.accuracy)); }
      setAccessStatus(await fetch(`/api/employee/tasks/access?${p}`).then(r => r.json()) as AccessStatus);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);
  useEffect(() => { if (geoReady) check(); }, [geoReady, check]);
  return { accessStatus, accessLoading, refreshAccess: check };
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CekBinDetailPage() {
  const params = useParams();
  const taskId = params.id as string;

  const { requiresLocation } = useTaskLocationSetting('cek_bin');
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocation);

  const [taskData,      setTaskData]      = useState<CekBinData | null>(null);
  const [loading,       setLoading]       = useState(true);
  const [completing,    setCompleting]    = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  // One automatic attempt per page visit; "Coba lagi" is the manual retry.
  const autoTried = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: { type: string; data: CekBinData }[] };
      const found = data.tasks?.find(t => t.type === 'cek_bin' && t.data.id === taskId);
      if (!found) { setTaskData(null); return; }
      setTaskData(found.data);
    } catch (e) {
      console.error('[CekBinDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const taskStatus = taskData?.status;
  const finished   = !!taskStatus && FINISHED.includes(taskStatus);
  const locked     = !finished && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');

  // Opening the task IS doing it: POST once, server marks the day's Cek Bin completed.
  const complete = useCallback(async () => {
    if (!taskData) return;
    setCompleteError(null); setCompleting(true);
    try {
      const res = await fetch('/api/employee/tasks/cek-bin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: Number(taskData.scheduleId), storeId: Number(taskData.storeId),
          geo: geo ?? null, skipGeo: geo === null,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        setCompleteError((typeof json.error === 'string' && json.error) || `HTTP ${res.status}`);
        return;
      }
      const done = json.data as { status?: TaskStatus; completedAt?: string | null } | undefined;
      setTaskData((prev) => prev && {
        ...prev,
        status: done?.status ?? 'completed',
        completedAt: done?.completedAt ?? new Date().toISOString(),
      });
      toast.success('Cek BIN tercatat selesai ✓', { duration: 3000 });
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : 'Gagal terhubung ke server.');
    } finally { setCompleting(false); }
  }, [taskData, geo]);

  // Ready = loaded, still open, location settled, and allowed in (checked in / inside the store).
  const ready = !loading && !!taskData && !finished && geoReady && !accessLoading &&
    (accessStatus?.status === 'ok' || accessStatus?.status === 'geo_unavailable');

  useEffect(() => {
    if (!ready || autoTried.current) return;
    autoTried.current = true;
    complete();
  }, [ready, complete]);

  function retry() { autoTried.current = true; complete(); }

  return (
    <>
      <TaskHeader title="Cek BIN" subtitle={shiftLabel(taskData?.shift)} status={taskStatus} />

      <PageBody>
        {!finished && !loading && taskData && (
          <AccessBanner accessStatus={accessStatus} accessLoading={accessLoading} geoReady={geoReady}
            geo={geo} geoError={geoError} onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess}
            requireGeo={requiresLocation} allowWithoutGeo />
        )}

        {completeError && (
          <Notice
            tone="error"
            title="Cek BIN belum tercatat"
            action={{ label: 'Coba lagi', onClick: retry, icon: RefreshCw }}
            onDismiss={() => setCompleteError(null)}
          >
            {completeError}
          </Notice>
        )}

        <TaskReviewNotices status={taskStatus} notes={taskData?.notes} verifiedAt={taskData?.verifiedAt} />

        {loading ? (
          <SkeletonBlocks count={3} className="h-24" />
        ) : !taskData ? (
          <EmptyState icon={Box} title="Task tidak ditemukan" description="Task ini mungkin sudah tidak tersedia untuk jadwalmu hari ini." />
        ) : (
          <div className="relative space-y-5">
            {!finished && <LockedOverlay accessStatus={accessStatus} requireGeo={requiresLocation} allowWithoutGeo />}

            {completing ? (
              <Notice tone="neutral" icon={Spinner}>Mencatat Cek BIN selesai…</Notice>
            ) : finished ? (
              <Notice tone="success" icon={CheckCircle2} title="Cek BIN sudah selesai">
                Task ini tercatat selesai otomatis saat dibuka. Barang yang masih salah di bawah tetap bisa
                diperbaiki — scan ulang di BC, lalu tekan Muat ulang.
              </Notice>
            ) : !locked && !completeError ? (
              <Notice tone="info" icon={Box}>
                Task ini selesai otomatis begitu dibuka. Scan BIN di BC — barang yang masih salah muncul di bawah.
              </Notice>
            ) : null}

            {/* What Business Central says is wrong in today's scans (never blocks the task) */}
            <BinCheckResults taskId={taskData.id} />
          </div>
        )}
      </PageBody>
    </>
  );
}
