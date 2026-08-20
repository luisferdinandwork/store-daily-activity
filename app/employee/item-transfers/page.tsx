'use client';
// app/employee/item-transfers/page.tsx
//
// Standalone Item Dropping (Receiving) + Item Return view. Both are BC-driven
// (Business Central Transfer Orders / Posted Whse Shipments) with no manual
// completion path, so they no longer live in the daily task checklist (see
// lib/shift-tasks.ts) — this page is on-demand, not tied to a specific day's
// schedule/status, and doesn't count toward Task Progress or the Ops
// Dashboard. See app/api/employee/item-transfers/route.ts for the backing API.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2, Loader2, AlertCircle,
  LogIn, Navigation, NavigationOff, RefreshCw,
  Store, Clock, Truck, Package, Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTaskLocationSetting } from '@/lib/hooks/useTaskLocationSetting';
import PhotoUploadGrid from '@/components/shared/PhotoUploadGrid';
import { uploadTaskPhoto } from '@/lib/tasks-upload';

// ─── Types ────────────────────────────────────────────────────────────────────

type Kind = 'dropping' | 'return';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface StoreRef {
  id: number;
  name: string;
  storeNo: string;
}

interface WhseShipmentLine {
  itemNo?: string;
  variantCode?: string;
  description?: string;
  quantity: number;
}

interface EntryData {
  id: string;
  toaNo: string;
  qtyOrdered: number;
  qtyCounted: number | null;
  courierSignPhoto: string | null;
  submittedAt: string | null;
  fromStore: StoreRef | null;
  toStore: StoreRef | null;
  transferFromCode: string | null;
  transferToCode: string | null;
  bcStatus: string | null;
  whseShipmentNo?: string | null;
  whseShipmentLines?: WhseShipmentLine[];
  inTransitSince?: string | null;
  receivedAt?: string | null;
  returnDetectedAt?: string | null;
}

interface FlowPayload {
  entries: EntryData[];
  syncWarning: string | null;
}

interface LoadResponse {
  success: boolean;
  error?: string;
  scheduleId?: number | null;
  storeId?: number | null;
  dropping?: FlowPayload;
  return?: FlowPayload;
}

// Opaque icon-chip + thin-border accents only — never a translucent full-card
// color wash. The employee shell sits on the app's lavender bg-secondary, and
// a `bg-sky-50/60`-style wash lets that lavender bleed through, turning into
// a muddy tint (this is what made the page look "ugly"). Solid white cards
// with a colored badge/border read cleanly on any background, and match
// every other card in the employee app (see TaskCard, StatTile).
const KIND_CFG: Record<Kind, {
  label: string;
  Icon: typeof Truck;
  accentBorder: string;
  accentText: string;
  accentIconBg: string;
  accentIconText: string;
  directionLabel: string;
  waitingLabel: string;
  openSectionLabel: string;
  confirmCta: string;
  emptyTitle: string;
  emptyBody: string;
  uploadKind: string;
}> = {
  dropping: {
    label: 'Receiving',
    Icon: Truck,
    accentBorder: 'border-sky-200',
    accentText: 'text-sky-700',
    accentIconBg: 'bg-sky-100',
    accentIconText: 'text-sky-600',
    directionLabel: 'Dari',
    waitingLabel: 'dalam perjalanan',
    openSectionLabel: 'Dalam perjalanan',
    confirmCta: 'Konfirmasi Terima dari Kurir',
    emptyTitle: 'Belum ada item dropping',
    emptyBody: 'Akan otomatis terisi begitu Business Central mengirim kiriman untuk toko ini.',
    uploadKind: 'item_dropping_courier_sign',
  },
  return: {
    label: 'Item Return',
    Icon: Package,
    accentBorder: 'border-amber-200',
    accentText: 'text-amber-700',
    accentIconBg: 'bg-amber-100',
    accentIconText: 'text-amber-600',
    directionLabel: 'Ke',
    waitingLabel: 'menunggu diambil',
    openSectionLabel: 'Menunggu diambil kurir',
    confirmCta: 'Konfirmasi Serah Terima ke Kurir',
    emptyTitle: 'Belum ada item return',
    emptyBody: 'Akan otomatis terisi begitu Business Central mengirim transfer order dari toko ini.',
    uploadKind: 'item_return_courier_sign',
  },
};

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo(required: boolean) {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    if (!required) {
      setGeo(null);
      setGeoError(null);
      setGeoReady(true);
      return;
    }
    setGeoReady(false);
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoReady(true); },
      () => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, [required]);

  useEffect(() => { refresh(); }, [refresh]);
  return { geo, geoError, geoReady, refresh };
}

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(
  scheduleId: string,
  storeId: string,
  geo: { lat: number; lng: number } | null,
  geoReady: boolean,
) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (!scheduleId || !storeId) {
      setAccessLoading(false);
      return;
    }
    setAccessLoading(true);
    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      if (geo) { params.set('lat', String(geo.lat)); params.set('lng', String(geo.lng)); }
      const res = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo]);

  useEffect(() => { if (geoReady) fetchAccess(); }, [geoReady, fetchAccess]);
  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Access banner ────────────────────────────────────────────────────────────

function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess,
}: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
      </div>
    );
  }
  if (!accessStatus) return null;
  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
        <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
          <p className="mt-0.5 text-xs text-red-600">Lakukan absensi masuk terlebih dahulu.</p>
        </div>
        <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Cek ulang
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).
          </p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Perbarui
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'}</p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200">
          <RefreshCw className="h-3 w-3" />Coba lagi
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})
      </p>
    </div>
  );
}

// ─── Elapsed time ─────────────────────────────────────────────────────────────

function useTicking(intervalMs: number | undefined | false = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

function formatElapsedSince(fromIso: string | null | undefined): string {
  if (!fromIso) return '—';
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(fromIso).getTime()) / 60_000));
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

function formatDurationBetween(startIso: string | null | undefined, endIso: string | null | undefined): string {
  if (!startIso || !endIso) return '—';
  const diffMin = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000));
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

// ─── Store pill ───────────────────────────────────────────────────────────────

function StorePill({ store, code }: { store: StoreRef | null; code: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-[11px] font-semibold text-foreground">
      <Store className="h-3 w-3 text-muted-foreground" />
      {store ? store.name : (code ?? '—')}
      {store && <span className="font-mono text-[10px] text-muted-foreground">({store.storeNo})</span>}
    </span>
  );
}

// ─── Open entry card ──────────────────────────────────────────────────────────

function OpenEntryCard({
  kind, entry, disabled, confirming, onConfirm,
}: {
  kind: Kind;
  entry: EntryData;
  disabled: boolean;
  confirming: boolean;
  onConfirm: (entryId: string, qtyCounted: number, courierSignPhoto: string) => void;
}) {
  useTicking();
  const cfg = KIND_CFG[kind];
  const [expanded, setExpanded] = useState(false);
  const [qtyCounted, setQtyCounted] = useState(String(entry.qtyOrdered));
  const [photos, setPhotos] = useState<string[]>([]);

  const canConfirm = qtyCounted.trim() !== '' && Number(qtyCounted) >= 0 && photos.length >= 1;
  const store = kind === 'dropping' ? entry.fromStore : entry.toStore;
  const code = kind === 'dropping' ? entry.transferFromCode : entry.transferToCode;
  // Dropping: elapsed since the origin store actually submitted the Item
  // Return on this website (not since our sync merely detected the
  // shipment) — null means it hasn't left the origin store yet.
  const since = kind === 'dropping' ? entry.inTransitSince : entry.returnDetectedAt;
  const notYetShipped = kind === 'dropping' && !since;

  return (
    <div className={cn('overflow-hidden rounded-2xl border bg-card shadow-sm', cfg.accentBorder)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
      >
        <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', cfg.accentIconBg, cfg.accentIconText)}>
          <cfg.Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-foreground">{entry.toaNo}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{cfg.directionLabel}</span>
            <StorePill store={store} code={code} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Qty: {entry.qtyOrdered}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          {notYetShipped ? (
            <p className="text-[11px] font-semibold text-muted-foreground">Menunggu dikirim</p>
          ) : (
            <>
              <div className={cn('flex items-center gap-1', cfg.accentText)}>
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs font-bold">{formatElapsedSince(since)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">{cfg.waitingLabel}</p>
            </>
          )}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3.5">
          {kind === 'dropping' && entry.whseShipmentLines && entry.whseShipmentLines.length > 0 && (
            <div className="rounded-xl border border-border bg-secondary/50 px-3 py-2.5">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Isi kiriman</p>
              <ul className="space-y-1">
                {entry.whseShipmentLines.map((line, i) => (
                  <li key={i} className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-foreground">
                      {line.description ?? line.itemNo ?? 'Item'}
                      {line.variantCode ? ` (${line.variantCode})` : ''}
                    </span>
                    <span className="flex-shrink-0 font-semibold text-muted-foreground">×{line.quantity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-foreground">Jumlah dihitung</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qtyCounted}
              onChange={(e) => setQtyCounted(e.target.value)}
              disabled={disabled}
              className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>

          <PhotoUploadGrid
            label="Foto bukti tanda tangan kurir"
            hint="Foto surat jalan yang sudah ditandatangani kurir."
            photos={photos}
            onChange={setPhotos}
            min={1}
            max={1}
            disabled={disabled}
            upload={(file) => uploadTaskPhoto(file, cfg.uploadKind)}
          />

          <button
            type="button"
            disabled={disabled || !canConfirm || confirming}
            onClick={() => onConfirm(entry.id, Number(qtyCounted), photos[0])}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {cfg.confirmCta}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Confirmed entry card ─────────────────────────────────────────────────────

function ConfirmedEntryCard({ kind, entry }: { kind: Kind; entry: EntryData }) {
  // Dropping's real "finish line" is Business Central posting the warehouse
  // receipt (receivedAt), not this store's local courier hand-off scan
  // (entry.submittedAt) — that scan just unlocks the confirm form. Keep
  // ticking until BC actually posts it.
  const isDropping = kind === 'dropping';
  const stillAwaitingBcReceive = isDropping && !entry.receivedAt;
  useTicking(stillAwaitingBcReceive ? 30_000 : false);

  const store = isDropping ? entry.fromStore : entry.toStore;
  const code = isDropping ? entry.transferFromCode : entry.transferToCode;
  // The headline duration is always THIS card's own leg: for Item Return,
  // TO detected → this employee's confirm; for Receiving, the actual
  // delivery time (origin store's Item Return submit → this employee's
  // confirm). BC posting the warehouse receipt is a separate, BC-owned
  // event that happens afterward — shown as its own status line below
  // instead of being folded into one blended number.
  const since = isDropping ? entry.inTransitSince : entry.returnDetectedAt;
  const ownDuration = formatDurationBetween(since, entry.submittedAt);
  const cfg = KIND_CFG[kind];

  return (
    <div className="rounded-2xl border border-green-200 bg-card px-4 py-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-green-100 text-green-600">
          <CheckCircle2 className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-foreground">{entry.toaNo}</p>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>{cfg.directionLabel}</span>
            <StorePill store={store} code={code} />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Qty pesanan {entry.qtyOrdered} · dihitung {entry.qtyCounted ?? '—'}
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-xs font-bold text-green-700">{ownDuration}</p>
          <p className="text-[10px] text-muted-foreground">
            {entry.submittedAt
              ? new Date(entry.submittedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
              : ''}
          </p>
        </div>
      </div>

      {isDropping && (
        <div
          className={cn(
            'mt-3 flex items-center gap-2 rounded-xl px-3 py-2',
            stillAwaitingBcReceive ? 'bg-amber-50' : 'bg-secondary',
          )}
        >
          {stillAwaitingBcReceive ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <p className={cn('text-[11px] font-semibold', stillAwaitingBcReceive ? 'text-amber-700' : 'text-muted-foreground')}>
            {stillAwaitingBcReceive
              ? `Menunggu BC posting Warehouse Receipt · ${formatElapsedSince(entry.submittedAt)}`
              : `Diterima BC dalam ${formatDurationBetween(entry.submittedAt, entry.receivedAt)}`}
          </p>
        </div>
      )}

      {entry.courierSignPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.courierSignPhoto}
          alt="Bukti tanda tangan kurir"
          className="mt-3 h-20 w-20 rounded-xl border border-border object-cover"
        />
      )}
    </div>
  );
}

// ─── Flow section (used inside each tab) ───────────────────────────────────────

function FlowSection({
  kind, payload, locked, confirmingId, onConfirm,
}: {
  kind: Kind;
  payload: FlowPayload;
  locked: boolean;
  confirmingId: string | null;
  onConfirm: (kind: Kind, entryId: string, qtyCounted: number, courierSignPhoto: string) => void;
}) {
  const cfg = KIND_CFG[kind];
  const openEntries = payload.entries.filter((e) => !e.submittedAt);
  const confirmedEntries = payload.entries.filter((e) => e.submittedAt);

  return (
    <div className="space-y-3">
      {payload.syncWarning && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-red-700">Gagal sinkronisasi dengan Business Central</p>
            <p className="mt-0.5 text-[11px] text-red-600">{payload.syncWarning}</p>
          </div>
        </div>
      )}

      {payload.entries.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-card px-4 py-10 text-center">
          <Inbox className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-semibold text-foreground">{cfg.emptyTitle}</p>
          <p className="text-xs text-muted-foreground">{cfg.emptyBody}</p>
        </div>
      ) : (
        <>
          {openEntries.length > 0 && (
            <section className="space-y-2.5">
              <p className={cn('text-[10px] font-bold uppercase tracking-widest', cfg.accentText)}>
                {cfg.openSectionLabel} · {openEntries.length}
              </p>
              {openEntries.map((entry) => (
                <OpenEntryCard
                  key={entry.id}
                  kind={kind}
                  entry={entry}
                  disabled={locked}
                  confirming={confirmingId === entry.id}
                  onConfirm={(entryId, qty, photo) => onConfirm(kind, entryId, qty, photo)}
                />
              ))}
            </section>
          )}

          {confirmedEntries.length > 0 && (
            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Sudah dikonfirmasi · {confirmedEntries.length}
              </p>
              {confirmedEntries.map((entry) => (
                <ConfirmedEntryCard key={entry.id} kind={kind} entry={entry} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItemTransfersPage() {
  const [tab, setTab] = useState<Kind>('dropping');

  const [scheduleId, setScheduleId] = useState<string>('');
  const [storeId, setStoreId] = useState<string>('');
  const [dropping, setDropping] = useState<FlowPayload>({ entries: [], syncWarning: null });
  const [returnData, setReturnData] = useState<FlowPayload>({ entries: [], syncWarning: null });
  const [loading, setLoading] = useState(true);
  const [notScheduled, setNotScheduled] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const { requiresLocation: droppingRequiresLocation } = useTaskLocationSetting('item_dropping');
  const { requiresLocation: returnRequiresLocation } = useTaskLocationSetting('item_return');
  const requiresLocationAny = droppingRequiresLocation || returnRequiresLocation;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo(requiresLocationAny);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/employee/item-transfers', { cache: 'no-store' });
      const data = await res.json() as LoadResponse;
      if (!data.success) {
        toast.error(data.error ?? 'Gagal memuat data.');
        return;
      }
      setScheduleId(data.scheduleId != null ? String(data.scheduleId) : '');
      setStoreId(data.storeId != null ? String(data.storeId) : '');
      setNotScheduled(data.scheduleId == null);
      setDropping(data.dropping ?? { entries: [], syncWarning: null });
      setReturnData(data.return ?? { entries: [], syncWarning: null });
    } catch (e) {
      console.error('[ItemTransfersPage] load error:', e);
      toast.error('Gagal memuat data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    scheduleId, storeId, geo, geoReady,
  );

  const droppingLocked = droppingRequiresLocation
    ? accessLoading || !accessStatus || accessStatus.status !== 'ok'
    : false;
  const returnLocked = returnRequiresLocation
    ? accessLoading || !accessStatus || accessStatus.status !== 'ok'
    : false;

  const handleConfirm = useCallback(async (kind: Kind, entryId: string, qtyCounted: number, courierSignPhoto: string) => {
    const requiresLocation = kind === 'dropping' ? droppingRequiresLocation : returnRequiresLocation;
    const locked = kind === 'dropping' ? droppingLocked : returnLocked;
    if (locked) {
      toast.warning('Belum bisa konfirmasi — periksa status akses di atas.');
      return;
    }
    setConfirmingId(entryId);
    try {
      const res = await fetch('/api/employee/item-transfers/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          entryId: Number(entryId),
          qtyCounted,
          courierSignPhoto,
          lat: geo?.lat,
          lng: geo?.lng,
          skipGeo: !requiresLocation,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? 'Gagal konfirmasi.');
      toast.success('Konfirmasi berhasil.');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal konfirmasi.');
    } finally {
      setConfirmingId(null);
    }
  }, [droppingRequiresLocation, returnRequiresLocation, droppingLocked, returnLocked, geo, load]);

  const droppingOpenCount = useMemo(
    () => dropping.entries.filter((e) => !e.submittedAt).length,
    [dropping.entries],
  );
  const returnOpenCount = useMemo(
    () => returnData.entries.filter((e) => !e.submittedAt).length,
    [returnData.entries],
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notScheduled) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 bg-slate-50 px-6 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Tidak ada jadwal hari ini</p>
        <p className="text-xs text-muted-foreground">Item Transfers hanya tersedia saat kamu terjadwal di toko.</p>
      </div>
    );
  }

  const locked = tab === 'dropping' ? droppingLocked : returnLocked;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] space-y-4 bg-slate-50 pb-24 pt-4">
      <section className="px-4">
        <AccessBanner
          accessStatus={accessStatus}
          accessLoading={accessLoading}
          geoReady={geoReady}
          geo={geo}
          geoError={geoError}
          onRefreshGeo={refreshGeo}
          onRefreshAccess={refreshAccess}
        />
      </section>

      <section className="px-4">
        <div className="flex gap-1.5 rounded-2xl border border-border bg-secondary p-1.5">
          {(Object.keys(KIND_CFG) as Kind[]).map((k) => {
            const cfg = KIND_CFG[k];
            const count = k === 'dropping' ? droppingOpenCount : returnOpenCount;
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-bold transition-all',
                  active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <cfg.Icon className="h-4 w-4" />
                {cfg.label}
                {count > 0 && (
                  <span className={cn(
                    'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-foreground',
                  )}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="px-4">
        {tab === 'dropping' ? (
          <FlowSection kind="dropping" payload={dropping} locked={locked} confirmingId={confirmingId} onConfirm={handleConfirm} />
        ) : (
          <FlowSection kind="return" payload={returnData} locked={locked} confirmingId={confirmingId} onConfirm={handleConfirm} />
        )}
      </section>
    </div>
  );
}
