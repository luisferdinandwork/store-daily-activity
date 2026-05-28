'use client';

import { useCallback, useEffect, useState } from 'react';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export function useGeo() {
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    setGeoReady(false);
    setGeoError(null);

    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoReady(true);
      },
      () => {
        setGeoError('Lokasi tidak dapat diperoleh.');
        setGeoReady(true);
      },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { geo, geoError, geoReady, refresh };
}
