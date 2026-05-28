'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GeoPoint } from './useGeo';

export type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

export function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: GeoPoint | null,
  geoReady: boolean,
  taskStatus: string | undefined,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const refreshAccess = useCallback(async () => {
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
        params.set('lng', String(geo.lng));
      }

      const res = await fetch(`/api/employee/tasks/access?${params.toString()}`);
      const data = (await res.json()) as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => {
    if (geoReady) refreshAccess();
  }, [geoReady, refreshAccess]);

  return { accessStatus, accessLoading, refreshAccess };
}
