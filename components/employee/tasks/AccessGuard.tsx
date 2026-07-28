'use client';
// components/employee/tasks/AccessGuard.tsx
//
// Wraps an employee task page with the right combination of access checks.
//
// Default behaviour:
//   • Reads geolocation (browser permission prompt)
//   • Checks the user is checked in for the schedule
//   • Checks the user is inside the store geofence
//
// Pass `requireGeo={false}` to opt out of location entirely (e.g. Setoran):
//   • No browser geolocation prompt
//   • No geofence check; outside_geofence / geo_unavailable will never lock
//   • Only "not checked in" can lock the page
//   • `geo` is exposed as null — callers should not send it in their requests
//
// Usage:
//
//   <AccessGuard
//     scheduleId={...}
//     storeId={...}
//     taskStatus={task.status}
//     requireGeo={false}    // ← Setoran: skip location
//   >
//     {({ banner, lockedOverlay, dis, geo, readonly }) => ( ... )}
//   </AccessGuard>

import { ReactNode } from 'react';
import {
  Loader2, LogIn, Navigation, NavigationOff, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGeo, type GeoPoint } from '@/lib/hooks/useGeo';
import { useAccessStatus, type AccessStatus } from '@/lib/hooks/useAccessStatus';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';

export interface AccessGuardSlots {
  geo:            GeoPoint | null;
  geoError:       string | null;
  geoReady:       boolean;
  refreshGeo:     () => void;
  accessStatus:   AccessStatus | null;
  accessLoading:  boolean;
  refreshAccess:  () => void;
  readonly:       boolean;
  locked:         boolean;
  dis:            boolean;
  banner:         ReactNode;
  lockedOverlay:  ReactNode;
}

interface AccessGuardProps {
  scheduleId: string;
  storeId: string;
  /** When set to completed/verified/rejected, all location checks are skipped. */
  taskStatus: string | undefined;
  /**
   * OPS-managed task code (e.g. 'setoran', 'briefing') — when given, whether
   * this task enforces geolocation + geofence is read live from OPS's Task
   * Management settings (/api/employee/task-settings), defaulting to
   * "required" until that setting loads. Takes priority over `requireGeo`.
   */
  taskType?: string;
  /**
   * Static fallback / override. When true (default), the page enforces
   * geolocation + geofence. Set to false for tasks where check-in alone is
   * enough. Ignored once `taskType`'s setting has loaded.
   */
  requireGeo?: boolean;
  children: (slots: AccessGuardSlots) => ReactNode;
}

export default function AccessGuard({
  scheduleId, storeId, taskStatus,
  taskType,
  requireGeo = true,
  children,
}: AccessGuardProps) {
  // Always call the hook (rules of hooks) — it's a no-op fetch skip when
  // taskType is omitted, since the cache/ready state is shared anyway.
  // While the setting is still loading, fall back to the caller's static
  // `requireGeo` (today's known-correct default) instead of a hardcoded
  // guess, so there's no flash of the wrong behavior before it resolves.
  const { requiresLocation, ready } = useTaskLocationSetting(taskType ?? '');
  const effectiveRequireGeo = taskType ? (ready ? requiresLocation : requireGeo) : requireGeo;

  // Two internal variants so the rules of hooks stay happy if the effective
  // value flips, and so the geolocation prompt genuinely never fires in
  // no-geo mode.
  return effectiveRequireGeo
    ? <AccessGuardWithGeo scheduleId={scheduleId} storeId={storeId} taskStatus={taskStatus}>{children}</AccessGuardWithGeo>
    : <AccessGuardNoGeo   scheduleId={scheduleId} storeId={storeId} taskStatus={taskStatus}>{children}</AccessGuardNoGeo>;
}

// ─── Full-geo variant ──────────────────────────────────────────────────────

function AccessGuardWithGeo({
  scheduleId, storeId, taskStatus, children,
}: Omit<AccessGuardProps, 'requireGeo'>) {
  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();
  const { accessStatus, accessLoading, refreshAccess } =
    useAccessStatus(scheduleId, storeId, geo, geoReady, taskStatus);

  const readonly = taskStatus === 'completed' || taskStatus === 'verified';

  const locationBlocked = !geoReady || !geo || accessStatus?.status === 'geo_unavailable';
  const locked =
    !readonly &&
    (accessLoading ||
      locationBlocked ||
      accessStatus?.status === 'not_checked_in' ||
      accessStatus?.status === 'outside_geofence');
  const dis = readonly || locked;

  const banner = readonly ? null : (
    <AccessBanner
      accessStatus={accessStatus}
      accessLoading={accessLoading}
      geoReady={geoReady}
      geo={geo}
      geoError={geoError}
      onRefreshGeo={refreshGeo}
      onRefreshAccess={refreshAccess}
      requireGeo
    />
  );

  const lockedOverlay = readonly ? null : <LockedOverlay accessStatus={accessStatus} />;

  return <>{children({
    geo, geoError, geoReady, refreshGeo,
    accessStatus, accessLoading, refreshAccess,
    readonly, locked, dis,
    banner, lockedOverlay,
  })}</>;
}

// ─── Check-in-only variant ─────────────────────────────────────────────────
// No useGeo() call → no permission prompt. We still call useAccessStatus, but
// with null geo so the server only validates check-in. The geo_unavailable and
// outside_geofence states will never apply because the endpoint only emits
// those when given coordinates.

function AccessGuardNoGeo({
  scheduleId, storeId, taskStatus, children,
}: Omit<AccessGuardProps, 'requireGeo'>) {
  const { accessStatus, accessLoading, refreshAccess } =
    useAccessStatus(scheduleId, storeId, /* geo */ null, /* geoReady */ true, taskStatus);

  const readonly = taskStatus === 'completed' || taskStatus === 'verified';
  const locked = !readonly && (accessLoading || accessStatus?.status === 'not_checked_in');
  const dis = readonly || locked;

  const banner = readonly ? null : (
    <AccessBanner
      accessStatus={accessStatus}
      accessLoading={accessLoading}
      geoReady
      geo={null}
      geoError={null}
      onRefreshGeo={() => {}}
      onRefreshAccess={refreshAccess}
      requireGeo={false}
    />
  );

  const lockedOverlay = readonly ? null : <LockedOverlay accessStatus={accessStatus} requireGeo={false} />;

  return <>{children({
    geo: null,
    geoError: null,
    geoReady: true,
    refreshGeo: () => {},
    accessStatus, accessLoading, refreshAccess,
    readonly, locked, dis,
    banner, lockedOverlay,
  })}</>;
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError,
  onRefreshGeo, onRefreshAccess, requireGeo,
}: {
  accessStatus: AccessStatus | null;
  accessLoading: boolean;
  geoReady: boolean;
  geo: GeoPoint | null;
  geoError: string | null;
  onRefreshGeo: () => void;
  onRefreshAccess: () => void;
  requireGeo: boolean;
}) {
  if (!geoReady || accessLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}
        </p>
      </div>
    );
  }
  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
        <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
          <p className="mt-0.5 text-xs text-red-600">Kamu harus melakukan absensi masuk terlebih dahulu.</p>
        </div>
        <button
          onClick={onRefreshAccess}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 transition-colors hover:bg-red-200"
        >
          <RefreshCw className="h-3 w-3" />Cek ulang
        </button>
      </div>
    );
  }

  // Geo-only states — only meaningful when requireGeo is true.
  if (requireGeo && accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).
          </p>
        </div>
        <button
          onClick={onRefreshGeo}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 transition-colors hover:bg-orange-200"
        >
          <RefreshCw className="h-3 w-3" />Perbarui
        </button>
      </div>
    );
  }
  if (requireGeo && accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">
            {geoError ?? 'Izin lokasi belum diberikan.'} Lokasi wajib aktif.
          </p>
        </div>
        <button
          onClick={onRefreshGeo}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-200"
        >
          <RefreshCw className="h-3 w-3" />Coba lagi
        </button>
      </div>
    );
  }

  // OK state — short and friendly. Coordinates only shown when geo is required.
  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        {requireGeo && geo
          ? `Lokasi terdeteksi (${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)})`
          : 'Sudah absen masuk · siap mengerjakan task'}
      </p>
    </div>
  );
}

// ─── Locked overlay ─────────────────────────────────────────────────────────

function LockedOverlay({
  accessStatus, requireGeo = true,
}: {
  accessStatus: AccessStatus | null;
  requireGeo?: boolean;
}) {
  if (!accessStatus || accessStatus.status === 'ok') return null;

  // In no-geo mode, only not_checked_in lockouts make sense.
  if (!requireGeo && accessStatus.status !== 'not_checked_in') return null;

  const isCheckIn = accessStatus.status === 'not_checked_in';
  const isGeoUnavailable = accessStatus.status === 'geo_unavailable';
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/70 backdrop-blur-[2px]">
      <div className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full',
        isCheckIn ? 'bg-red-100' : isGeoUnavailable ? 'bg-amber-100' : 'bg-orange-100',
      )}>
        {isCheckIn
          ? <LogIn className="h-6 w-6 text-red-600" />
          : <NavigationOff className={cn('h-6 w-6', isGeoUnavailable ? 'text-amber-600' : 'text-orange-600')} />}
      </div>
      <p className={cn(
        'text-sm font-bold',
        isCheckIn ? 'text-red-700' : isGeoUnavailable ? 'text-amber-700' : 'text-orange-700',
      )}>
        {isCheckIn ? 'Absen masuk dulu' : isGeoUnavailable ? 'Lokasi wajib aktif' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}