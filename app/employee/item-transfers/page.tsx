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
  Store, Clock, Truck, Package, Inbox, Search, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { AccessBanner } from '@/components/employee/tasks';
import {
  ActionButton, EmptyState, Notice, PageBody, Segmented, SkeletonBlocks, inputClass,
} from '@/components/employee/ui';
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
    <div className={cn('overflow-hidden rounded-2xl border bg-card', cfg.accentBorder)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-secondary"
        aria-expanded={expanded}
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
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Isi kiriman</p>
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
            <label className="px-0.5 text-xs font-medium text-muted-foreground">Jumlah dihitung</label>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qtyCounted}
              onChange={(e) => setQtyCounted(e.target.value)}
              disabled={disabled}
              className={cn(inputClass, 'mt-1 h-11 tabular-nums')}
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

          <ActionButton
            className="w-full"
            icon={CheckCircle2}
            loading={confirming}
            disabled={disabled || !canConfirm}
            onClick={() => onConfirm(entry.id, Number(qtyCounted), photos[0])}
          >
            {cfg.confirmCta}
          </ActionButton>
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
    <div className="rounded-2xl border border-green-200 bg-card px-4 py-3.5">
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
              : entry.submittedAt
                ? `Diterima BC dalam ${formatDurationBetween(entry.submittedAt, entry.receivedAt)}`
                : 'Selesai otomatis oleh BC — toko tidak perlu konfirmasi'}
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

function matchesSearch(entry: EntryData, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    entry.toaNo.toLowerCase().includes(q) ||
    (entry.transferFromCode?.toLowerCase().includes(q) ?? false) ||
    (entry.transferToCode?.toLowerCase().includes(q) ?? false) ||
    (entry.fromStore?.name.toLowerCase().includes(q) ?? false) ||
    (entry.toStore?.name.toLowerCase().includes(q) ?? false)
  );
}

function FlowSection({
  kind, payload, locked, confirmingId, search, onConfirm,
}: {
  kind: Kind;
  payload: FlowPayload;
  locked: boolean;
  confirmingId: string | null;
  search: string;
  onConfirm: (kind: Kind, entryId: string, qtyCounted: number, courierSignPhoto: string) => void;
}) {
  const cfg = KIND_CFG[kind];
  const searched = payload.entries.filter((e) => matchesSearch(e, search));
  // receivedAt can now close a transfer on its own (BC's Warehouse Receipt
  // for a store-bound leg, or this store's own Item Return submission for a
  // warehouse-bound leg) without this entry's own submittedAt ever being
  // set — treat either as "nothing left to do here".
  const openEntries = searched.filter((e) => !e.submittedAt && !e.receivedAt);
  const confirmedEntries = searched.filter((e) => e.submittedAt || e.receivedAt);

  return (
    <div className="space-y-3">
      {payload.syncWarning && (
        <Notice tone="error" title="Gagal sinkronisasi dengan Business Central">{payload.syncWarning}</Notice>
      )}

      {payload.entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border">
          <EmptyState icon={Inbox} title={cfg.emptyTitle} description={cfg.emptyBody} className="py-10" />
        </div>
      ) : searched.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border">
          <EmptyState
            icon={Search}
            title="Tidak ada hasil"
            description={<>Tidak ada transfer yang cocok dengan pencarian &ldquo;{search}&rdquo;.</>}
            className="py-10"
          />
        </div>
      ) : (
        <>
          {openEntries.length > 0 && (
            <section className="space-y-2.5">
              <p className={cn('px-0.5 text-[11px] font-semibold uppercase tracking-wide', cfg.accentText)}>
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
              <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
  const [search, setSearch] = useState('');

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

  // Same "still open" predicate as FlowSection's own openEntries split —
  // this badge and that section must never disagree about what's pending.
  const droppingOpenCount = useMemo(
    () => dropping.entries.filter((e) => !e.submittedAt && !e.receivedAt).length,
    [dropping.entries],
  );
  const returnOpenCount = useMemo(
    () => returnData.entries.filter((e) => !e.submittedAt && !e.receivedAt).length,
    [returnData.entries],
  );

  if (loading) {
    return (
      <PageBody>
        <SkeletonBlocks count={4} />
      </PageBody>
    );
  }

  if (notScheduled) {
    return (
      <PageBody>
        <EmptyState
          icon={AlertCircle}
          title="Tidak ada jadwal hari ini"
          description="Transfer Orders hanya tersedia saat kamu terjadwal di toko."
        />
      </PageBody>
    );
  }

  const locked = tab === 'dropping' ? droppingLocked : returnLocked;

  return (
    <PageBody className="space-y-4">
      <AccessBanner
        accessStatus={accessStatus}
        accessLoading={accessLoading}
        geoReady={geoReady}
        geo={geo}
        geoError={geoError}
        onRefreshGeo={refreshGeo}
        onRefreshAccess={refreshAccess}
        requireGeo={requiresLocationAny}
      />

      <Segmented<Kind>
        value={tab}
        onChange={setTab}
        options={(Object.keys(KIND_CFG) as Kind[]).map((k) => {
          const cfg = KIND_CFG[k];
          return {
            value: k,
            count: k === 'dropping' ? droppingOpenCount : returnOpenCount,
            label: (
              <span className="flex items-center gap-1.5">
                <cfg.Icon className="h-4 w-4" />
                {cfg.label}
              </span>
            ),
          };
        })}
      />

      <section>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor TOA, toko, atau kode…"
            className={cn(inputClass, 'h-11 pl-10 pr-10')}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-muted-foreground"
              aria-label="Hapus pencarian"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </section>

      <section>
        {tab === 'dropping' ? (
          <FlowSection kind="dropping" payload={dropping} locked={locked} confirmingId={confirmingId} search={search} onConfirm={handleConfirm} />
        ) : (
          <FlowSection kind="return" payload={returnData} locked={locked} confirmingId={confirmingId} search={search} onConfirm={handleConfirm} />
        )}
      </section>
    </PageBody>
  );
}
