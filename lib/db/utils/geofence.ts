// lib/db/utils/geofence.ts
// The one server-side store geofence check. Attendance check-in, the task
// access probe and every task submit call into here, so they all apply the
// same GPS-noise allowances (see evaluateGeofence in lib/geo.ts).

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { stores } from '@/lib/db/schema';
import {
  DEFAULT_GEOFENCE_RADIUS_M,
  evaluateGeofence,
  geofenceErrorMessage,
  type GeoPoint,
  type Geofence,
  type GeofenceVerdict,
} from '@/lib/geo';

/** undefined = no such store; null = store has no coordinates (radius check skipped). */
async function loadStoreGeofence(storeId: number): Promise<Geofence | null | undefined> {
  const [store] = await db
    .select({ lat: stores.latitude, lng: stores.longitude, radius: stores.geofenceRadiusM })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!store) return undefined;
  if (!store.lat || !store.lng) return null;
  return {
    lat:     parseFloat(store.lat),
    lng:     parseFloat(store.lng),
    radiusM: store.radius ? parseFloat(store.radius) : DEFAULT_GEOFENCE_RADIUS_M,
  };
}

/** The store's fence for client-side previews; null when it has no coordinates. */
export async function getStoreGeofence(storeId: number): Promise<Geofence | null> {
  return (await loadStoreGeofence(storeId)) ?? null;
}

/** Verdict for a fix, or null when the store has no coordinates (nothing to check). */
export async function checkStoreGeofence(storeId: number, geo: GeoPoint): Promise<GeofenceVerdict | null> {
  const fence = await loadStoreGeofence(storeId);
  return fence ? evaluateGeofence(geo, fence) : null;
}

/** Null when the fix is acceptable, otherwise an Indonesian error for the employee. */
export async function assertInGeofence(storeId: number, geo: GeoPoint): Promise<string | null> {
  const fence = await loadStoreGeofence(storeId);
  if (fence === undefined) return 'Toko tidak ditemukan.';
  if (fence === null)      return null;

  const verdict = evaluateGeofence(geo, fence);
  return verdict.inside ? null : geofenceErrorMessage(verdict);
}
