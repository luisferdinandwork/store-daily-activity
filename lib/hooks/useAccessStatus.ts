'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoPoint } from './useGeo';

export type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number; accuracyM?: number | null }
  | { status: 'geo_unavailable' }
  | { status: 'validation_unavailable'; error?: string };

export function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: GeoPoint | null,
  geoReady: boolean,
  taskStatus: string | undefined,
  taskType?: string,
  taskId?: string,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const requestId = useRef(0);

  const refreshAccess = useCallback(async () => {
    const id = ++requestId.current;
    if (taskStatus && ['completed', 'verified'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }

    if ((!scheduleId && !taskId) || !storeId) {
      setAccessStatus({ status: 'validation_unavailable', error: 'Jadwal belum tersedia.' });
      setAccessLoading(false);
      return;
    }

    setAccessLoading(true);

    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      if (taskType) params.set('taskType', taskType);
      if (taskId) params.set('taskId', taskId);

      if (geo) {
        params.set('lat', String(geo.lat));
        params.set('lng', String(geo.lng));
        if (geo.accuracy != null) params.set('acc', String(geo.accuracy));
      }

      const res = await fetch(`/api/employee/tasks/access?${params.toString()}`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const data = (await res.json()) as AccessStatus;
      if (id !== requestId.current) return;
      if (!res.ok || !['ok', 'not_checked_in', 'outside_geofence', 'geo_unavailable'].includes(data.status)) {
        setAccessStatus({ status: 'validation_unavailable', error: 'Validasi belum tersedia. Coba cek ulang.' });
        return;
      }
      setAccessStatus(data);
    } catch {
      if (id === requestId.current) setAccessStatus({ status: 'validation_unavailable', error: 'Koneksi terputus. Coba cek ulang.' });
    } finally {
      if (id === requestId.current) setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus, taskType, taskId]);

  useEffect(() => {
    const counter = requestId;
    if (geoReady) void refreshAccess();
    return () => { counter.current++; };
  }, [geoReady, refreshAccess]);

  useEffect(() => {
    const refresh = () => { if (geoReady) void refreshAccess(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [geoReady, refreshAccess]);

  useEffect(() => {
    if (accessStatus?.status !== 'validation_unavailable') return;
    const retry = setTimeout(() => { void refreshAccess(); }, 5_000);
    return () => clearTimeout(retry);
  }, [accessStatus, refreshAccess]);

  return { accessStatus, accessLoading, refreshAccess };
}
