// lib/geo.ts
// Pure geo helpers — no DB imports, so they're safe in client components too.
// Server geofence checks (lib/db/utils/geofence.ts) and the pages' live
// distance previews share evaluateGeofence, so both sides agree on the verdict.

export interface GeoPoint {
  lat: number;
  lng: number;
  /**
   * Device-reported horizontal accuracy in metres (GeolocationCoordinates.accuracy,
   * ~68% confidence radius). Optional: store coordinates and legacy clients omit it.
   */
  accuracy?: number | null;
}

export interface Geofence {
  lat:     number;
  lng:     number;
  radiusM: number;
}

// ─── Geofence policy ──────────────────────────────────────────────────────────
//
// Phone GPS inside a mall or shop typically reports ±15–50 m, so a raw
// "distance > radius" check rejects staff who are standing in the store. Two
// allowances absorb that noise:
//   • radii are floored at MIN_GEOFENCE_RADIUS_M — a 15 m fence is tighter
//     than indoor GPS can resolve;
//   • the fix's own reported uncertainty is added, capped at
//     MAX_ACCURACY_ALLOWANCE_M so a coarse cell/IP fix (±1 km) can't pass.
// Tune here; every check-in / task gate reads these.

export const DEFAULT_GEOFENCE_RADIUS_M = 100;
export const MIN_GEOFENCE_RADIUS_M     = 30;
export const MAX_ACCURACY_ALLOWANCE_M  = 50;
/** Worse than this, part of the fix's noise isn't absorbed → "weak signal" tips. */
export const POOR_ACCURACY_M           = MAX_ACCURACY_ALLOWANCE_M;

export interface GeofenceVerdict {
  inside:    boolean;
  /** Rounded distance from the store point. */
  distanceM: number;
  /** Radius shown to staff as the limit (configured radius, floored). */
  radiusM:   number;
  /** Rounded reported accuracy of the fix, or null when the client didn't send one. */
  accuracyM: number | null;
}

/** Great-circle distance between two points, in metres. */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const R  = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Sanitises an untrusted accuracy value to a positive number of metres, or null. */
export function parseAccuracy(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parses untrusted lat/lng (+ optional accuracy) into a GeoPoint, or null if invalid. */
export function parseGeoPoint(lat: unknown, lng: unknown, accuracy?: unknown): GeoPoint | null {
  const la = typeof lat === 'number' ? lat : typeof lat === 'string' && lat.trim() ? Number(lat) : NaN;
  const ln = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln, accuracy: parseAccuracy(accuracy) };
}

/** Is this fix inside the store's fence, allowing for GPS noise (see policy above)? */
export function evaluateGeofence(fix: GeoPoint, fence: Geofence): GeofenceVerdict {
  const distanceM = haversineMetres(fix, fence);
  const accuracy  = parseAccuracy(fix.accuracy);
  const radiusM   = Math.max(fence.radiusM, MIN_GEOFENCE_RADIUS_M);
  const allowedM  = radiusM + Math.min(accuracy ?? 0, MAX_ACCURACY_ALLOWANCE_M);
  return {
    inside:    distanceM <= allowedM,
    distanceM: Math.round(distanceM),
    radiusM,
    accuracyM: accuracy != null ? Math.round(accuracy) : null,
  };
}

export function isPoorAccuracy(accuracyM: number | null | undefined): boolean {
  return accuracyM != null && accuracyM > POOR_ACCURACY_M;
}

/** Tips for getting a better fix — shown when the reported accuracy is weak. */
export const WEAK_GPS_TIP =
  'Pastikan GPS aktif dan izin lokasi browser diatur ke "lokasi akurat/tepat" (bukan perkiraan), lalu coba dekat pintu atau jendela toko.';

/** Indonesian rejection message for an outside-the-fence verdict. */
export function geofenceErrorMessage(v: GeofenceVerdict): string {
  const base = `Kamu terdeteksi ${v.distanceM}m dari toko (batas: ${v.radiusM}m).`;
  return isPoorAccuracy(v.accuracyM)
    ? `${base} Sinyal GPS lemah (akurasi ±${v.accuracyM}m). ${WEAK_GPS_TIP}`
    : `${base} Pastikan kamu berada di dalam toko dan coba lagi.`;
}
