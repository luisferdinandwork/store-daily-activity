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
import { Notice } from '@/components/employee/ui';
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
// Exported so pages that run their own access hooks (store-opening) render the
// exact same states as AccessGuard pages.

export function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError,
  onRefreshGeo, onRefreshAccess, requireGeo = true, allowWithoutGeo = false,
}: {
  accessStatus: AccessStatus | null;
  accessLoading: boolean;
  geoReady: boolean;
  geo: GeoPoint | null;
  geoError: string | null;
  onRefreshGeo: () => void;
  onRefreshAccess: () => void;
  requireGeo?: boolean;
  /** Geo is checked when available, but a missing fix doesn't block (store-front). */
  allowWithoutGeo?: boolean;
}) {
  if (!geoReady || accessLoading) {
    return (
      <Notice tone="neutral" icon={SpinnerIcon}>
        {!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}
      </Notice>
    );
  }
  if (!accessStatus) return null;

  if (accessStatus.status === 'not_checked_in') {
    return (
      <Notice
        tone="error"
        icon={LogIn}
        title="Belum absen masuk"
        action={{ label: 'Cek ulang', onClick: onRefreshAccess, icon: RefreshCw }}
      >
        Lakukan absen masuk dulu di halaman Attendance.
      </Notice>
    );
  }

  // Geo-only states — only meaningful when requireGeo is true.
  if (requireGeo && accessStatus.status === 'outside_geofence') {
    return (
      <Notice
        tone="warning"
        icon={NavigationOff}
        title="Di luar area toko"
        action={{ label: 'Perbarui', onClick: onRefreshGeo, icon: RefreshCw }}
      >
        Kamu berada {accessStatus.distanceM}m dari toko (batas {accessStatus.radiusM}m).
      </Notice>
    );
  }
  if (requireGeo && accessStatus.status === 'geo_unavailable') {
    return (
      <Notice
        tone="warning"
        icon={NavigationOff}
        title="Lokasi tidak terdeteksi"
        action={{ label: 'Coba lagi', onClick: onRefreshGeo, icon: RefreshCw }}
      >
        {geoError ?? 'Izin lokasi belum diberikan.'}{' '}
        {allowWithoutGeo ? 'Task tetap bisa dilanjutkan tanpa rekaman lokasi.' : 'Lokasi wajib aktif.'}
      </Notice>
    );
  }

  // OK state — short and friendly.
  return (
    <Notice tone="success" icon={Navigation}>
      {requireGeo && geo ? 'Lokasi terdeteksi · kamu di area toko' : 'Sudah absen masuk · siap mengerjakan task'}
    </Notice>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return <Loader2 className={cn(className, 'animate-spin')} />;
}

// ─── Locked overlay ─────────────────────────────────────────────────────────

export function LockedOverlay({
  accessStatus, requireGeo = true, allowWithoutGeo = false,
}: {
  accessStatus: AccessStatus | null;
  requireGeo?: boolean;
  /** A missing location fix doesn't lock the page (store-front). */
  allowWithoutGeo?: boolean;
}) {
  if (!accessStatus || accessStatus.status === 'ok') return null;
  if (allowWithoutGeo && accessStatus.status === 'geo_unavailable') return null;

  // In no-geo mode, only not_checked_in lockouts make sense.
  if (!requireGeo && accessStatus.status !== 'not_checked_in') return null;

  const isCheckIn = accessStatus.status === 'not_checked_in';
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-start gap-2 rounded-2xl bg-background/75 pt-16 backdrop-blur-[2px]">
      <div className={cn(
        'flex h-12 w-12 items-center justify-center rounded-2xl',
        isCheckIn ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600',
      )}>
        {isCheckIn ? <LogIn className="h-6 w-6" /> : <NavigationOff className="h-6 w-6" />}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-amber-800')}>
        {isCheckIn
          ? 'Absen masuk dulu'
          : accessStatus.status === 'geo_unavailable' ? 'Lokasi wajib aktif' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}
