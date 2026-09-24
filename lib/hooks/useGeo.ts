'use client';

import { useCallback, useEffect, useState } from 'react';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Browser geolocation. Reads a fix on mount while `enabled` (default true) —
 * pass false to hold off the permission prompt until the page actually needs
 * a location. `refresh()` resolves with the fresh fix (or null) so callers that
 * need a position *right now* (attendance check-in) can await it.
 */
export function useGeo(enabled = true) {
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback((): Promise<GeoPoint | null> => {
    setGeoReady(false);
    setGeoError(null);

    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setGeo(point);
          setGeoReady(true);
          resolve(point);
        },
        () => {
          setGeoError('Lokasi tidak dapat diperoleh.');
          setGeoReady(true);
          resolve(null);
        },
        { timeout: 10_000, maximumAge: 0 },
      );
    });
  }, []);

  useEffect(() => {
    if (enabled) refresh();
  }, [enabled, refresh]);

  return { geo, geoError, geoReady, refresh };
}
