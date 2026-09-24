// lib/geo.ts
// Pure geo helpers — no DB imports, so they're safe in client components too.
// Server geofence checks (lib/db/utils/tasks.ts) and the attendance page's
// live distance preview share this, so both sides agree on the verdict.

export interface GeoPoint {
  lat: number;
  lng: number;
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

/** Parses untrusted lat/lng (e.g. a request body) into a GeoPoint, or null if invalid. */
export function parseGeoPoint(lat: unknown, lng: unknown): GeoPoint | null {
  const la = typeof lat === 'number' ? lat : typeof lat === 'string' && lat.trim() ? Number(lat) : NaN;
  const ln = typeof lng === 'number' ? lng : typeof lng === 'string' && lng.trim() ? Number(lng) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}
