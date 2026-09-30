'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GeoPoint } from '@/lib/geo';

export type { GeoPoint };

// A single getCurrentPosition() without enableHighAccuracy often returns a
// coarse Wi-Fi/cell fix (±100 m–2 km) — the main reason staff standing in the
// store were told they were outside. Instead we watch with high accuracy for
// a few seconds and keep the most precise fix the phone reports.

/** Stop sampling as soon as a fix is at least this precise. */
const GOOD_ACCURACY_M = 20;
/** After the first fix arrives, keep refining this long before settling. */
const SETTLE_MS = 5_000;
/** Give up if no fix at all arrives within this. */
const TIMEOUT_MS = 20_000;

const ERR_UNSUPPORTED = 'Browser ini tidak mendukung lokasi.';
const ERR_DENIED      = 'Izin lokasi ditolak. Buka pengaturan browser → Izin situs → Lokasi, pilih "Izinkan", lalu coba lagi.';
const ERR_UNAVAILABLE = 'GPS tidak aktif atau sinyal tidak ditemukan. Nyalakan Lokasi (GPS) di HP lalu coba lagi.';
const ERR_TIMEOUT     = 'Lokasi belum didapat (waktu habis). Pastikan GPS aktif, lalu coba lagi di dekat pintu atau jendela.';

type Sample = { point: GeoPoint } | { error: string };

const precision = (p: GeoPoint | null) => p?.accuracy ?? Infinity;

function sampleLocation(): { promise: Promise<Sample>; cancel: () => void } {
  let best: GeoPoint | null = null;
  let lastErrorCode: number | null = null;
  let watchId: number | undefined;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let done = false;
  let resolve!: (s: Sample) => void;
  const promise = new Promise<Sample>((r) => { resolve = r; });

  const finish = (s: Sample) => {
    if (done) return;
    done = true;
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    clearTimeout(settleTimer);
    clearTimeout(hardTimer);
    resolve(s);
  };

  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const fix: GeoPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
      if (precision(fix) <= precision(best)) best = fix;
      if (precision(best) <= GOOD_ACCURACY_M) return finish({ point: best! });
      settleTimer ??= setTimeout(() => finish({ point: best! }), SETTLE_MS);
    },
    (err) => {
      // Denied is final; "unavailable"/"timeout" can clear up while we keep watching.
      if (err.code === err.PERMISSION_DENIED) finish({ error: ERR_DENIED });
      else lastErrorCode = err.code;
    },
    { enableHighAccuracy: true, maximumAge: 0 },
  );

  hardTimer = setTimeout(() => finish(
    best ? { point: best } : { error: lastErrorCode === 2 /* POSITION_UNAVAILABLE */ ? ERR_UNAVAILABLE : ERR_TIMEOUT },
  ), TIMEOUT_MS);

  return { promise, cancel: () => finish({ error: ERR_TIMEOUT }) };
}

/**
 * Browser geolocation. Samples a fix on mount while `enabled` (default true);
 * when disabled it reports ready with no fix and never prompts for permission.
 * `refresh()` resolves with a fresh fix (or null) — concurrent calls share one
 * sampling run. `recentOrRefresh(ms)` reuses the last fix if it's younger than
 * `ms`, so a check-in right after the preview sends the fix the employee saw.
 */
export function useGeo(enabled = true) {
  const [geo, setGeo] = useState<GeoPoint | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const inflight = useRef<Promise<GeoPoint | null> | null>(null);
  const stop     = useRef<(() => void) | null>(null);
  const last     = useRef<{ point: GeoPoint; at: number } | null>(null);

  const refresh = useCallback((): Promise<GeoPoint | null> => {
    if (!enabled) {
      stop.current?.();
      setGeo(null);
      setGeoError(null);
      setGeoReady(true);
      return Promise.resolve(null);
    }
    if (inflight.current) return inflight.current;

    setGeoReady(false);
    setGeoError(null);

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError(ERR_UNSUPPORTED);
      setGeoReady(true);
      return Promise.resolve(null);
    }

    const run = sampleLocation();
    const p: Promise<GeoPoint | null> = run.promise.then((s) => {
      if (inflight.current !== p) return null; // stopped (unmount / disabled)
      inflight.current = null;
      stop.current = null;
      if ('point' in s) {
        last.current = { point: s.point, at: Date.now() };
        setGeo(s.point);
      } else {
        setGeoError(s.error);
      }
      setGeoReady(true);
      return 'point' in s ? s.point : null;
    });
    inflight.current = p;
    stop.current = () => {
      inflight.current = null;
      stop.current = null;
      run.cancel();
    };
    return p;
  }, [enabled]);

  const recentOrRefresh = useCallback((maxAgeMs: number): Promise<GeoPoint | null> => {
    const l = last.current;
    return l && Date.now() - l.at <= maxAgeMs ? Promise.resolve(l.point) : refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Release the GPS watch if the page unmounts mid-sample.
  useEffect(() => () => stop.current?.(), []);

  return { geo, geoError, geoReady, refresh, recentOrRefresh };
}
