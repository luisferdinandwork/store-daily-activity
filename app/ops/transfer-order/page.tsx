'use client';

// app/ops/transfer-order/page.tsx — OPS Transfer Order pipeline dashboard.
//
// Shows every BC-synced transfer order across its 3 phases (Item Return →
// Shipping → Item Receiving), sourced live from /api/ops/item-transfers
// (API route path kept as-is — only this page's own route was renamed),
// which re-syncs Business Central on every load/refresh. Mirrors the
// app/ops/issues/page.tsx convention: store-filterable card list + a
// right-side slide-in drawer with the full phase timeline.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package, Truck, PackageCheck, CheckCircle2, Store as StoreIcon,
  MapPin, Loader2, X, Globe2, Shield, AlertTriangle,
  Factory, Send, Inbox, Warehouse, Maximize2, Camera, ClipboardCheck, ArrowRight,
} from 'lucide-react';
import { ImageLightbox } from '@/components/shared/ImageLightbox';
import {
  buildTransferMetrics, durationBetween, finishedEarly, formatStamp,
  type MetricKey, type TransferMetric,
} from '@/lib/transfer-order-metrics';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { TONES, TONE_HEX, type Tone } from '@/lib/status-theme';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsList, OpsListRow, OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import { MetricTile } from '@/components/tasks/MetricTile';
import StorePickerCombobox, {
  type AreaGroupOption, type StoreOption,
} from '@/components/ops/impact-visits/StorePickerCombobox';

// ─── Types ────────────────────────────────────────────────────────────────────

// 'to_warehouse' — a transfer whose destination is a DM warehouse/return
// location, not a real store. There's no employee on that end to ever
// confirm receipt, so it's a separate terminal state instead of a 5th step
// on the normal return → shipping → receiving → received path (see
// isWarehouseCode in app/api/ops/item-transfers/route.ts).
type Phase = 'return' | 'shipping' | 'receiving' | 'received' | 'to_warehouse';

interface StoreRef {
  id: string;
  name: string;
  storeNo: string;
  areaId: string | null;
  areaName: string | null;
}

interface Transfer {
  id: string;
  toaNo: string;
  transferFromCode: string;
  transferToCode: string;
  fromStore: StoreRef | null;
  toStore: StoreRef | null;
  qtyOrdered: number;
  bcStatus: string | null;
  postingDate: string | null;
  whseShipmentNo: string | null;
  phase: Phase;
  fromIsWarehouse: boolean;
  toIsWarehouse: boolean;
  returnDetectedAt: string | null;
  returnSubmittedAt: string | null;
  droppingDetectedAt: string | null;
  droppingSubmittedAt: string | null;
  receivedAt: string | null;
  returnPhoto: string | null;
  returnQtyCounted: number | null;
  droppingPhoto: string | null;
  droppingQtyCounted: number | null;
}

// ─── Phase config ─────────────────────────────────────────────────────────────

// Colours come from the shared tones (lib/status-theme.ts): waiting = warning, on
// the road = info, waiting for BC = active, done = success, warehouse = neutral.
const PHASE_CFG: Record<Phase, { label: string; tone: Tone; accent: string; Icon: typeof Package }> = {
  return: { label: 'Menunggu Diambil', tone: 'warning', accent: TONE_HEX.warning, Icon: Package },
  shipping: { label: 'Dalam Perjalanan', tone: 'info', accent: TONE_HEX.info, Icon: Truck },
  receiving: { label: 'Menunggu Diterima BC', tone: 'active', accent: TONE_HEX.active, Icon: PackageCheck },
  received: { label: 'Selesai', tone: 'success', accent: TONE_HEX.success, Icon: CheckCircle2 },
  to_warehouse: { label: 'Dikirim ke Gudang', tone: 'neutral', accent: TONE_HEX.neutral, Icon: Warehouse },
};

// The linear happy path shown as the drawer's 4-dot stepper. to_warehouse is
// a side branch off "return" (see resolvePhase), not a 5th step on this
// path, so it's deliberately excluded — see TransferDrawer for its own view.
const PHASE_ORDER: Phase[] = ['return', 'shipping', 'receiving', 'received'];
const PHASE_TILE_ORDER: Phase[] = [...PHASE_ORDER, 'to_warehouse'];

// ─── Time helpers ─────────────────────────────────────────────────────────────

function useTicking(intervalMs: number | false = 30_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!intervalMs) return;
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

// ─── Timing metrics OPS needs on every transfer order ─────────────────────────
// Rules + semantics live in lib/transfer-order-metrics.ts (pure, tested); this
// page only adds the icons.

type Metric = TransferMetric;

const METRIC_ICON: Record<MetricKey, typeof Factory> = {
  bcProcessing: Factory,
  wsToReturn: Camera,
  returnTotal: ClipboardCheck,
  delivery: Send,
  bcReceiving: Inbox,
};

function buildMetrics(t: Transfer): Metric[] {
  return buildTransferMetrics(t);
}

// ─── Store label ──────────────────────────────────────────────────────────────

function StoreLabel({ store, code, isWarehouse }: { store: StoreRef | null; code: string; isWarehouse?: boolean }) {
  if (isWarehouse) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500">
        <Warehouse className="h-3 w-3 shrink-0 text-slate-400" />
        Gudang
        <span className="font-mono text-[10px] font-normal text-slate-400">({code})</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
      <StoreIcon className="h-3 w-3 shrink-0 text-slate-400" />
      {store ? store.name : code}
      <span className="font-mono text-[10px] font-normal text-slate-400">({code})</span>
    </span>
  );
}

// ─── Phase badge ──────────────────────────────────────────────────────────────

function PhaseBadge({ phase, compact }: { phase: Phase; compact?: boolean }) {
  const c = PHASE_CFG[phase];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-bold',
        TONES[c.tone].chip,
        compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', TONES[c.tone].dot)} />
      {c.label}
    </span>
  );
}

// ─── Metric pill (compact, used on the card list) ──────────────────────────────

function MetricPill({ metric }: { metric: Metric }) {
  useTicking(metric.applicable && metric.start && !metric.end ? 30_000 : false);
  const { start, end } = metric;
  const Icon = METRIC_ICON[metric.key];

  if (!metric.applicable) {
    return (
      <span className="flex w-full items-center justify-center gap-1 rounded-md bg-slate-50 px-1 py-0.5 text-slate-300" title={`${metric.label} — ${metric.naReason}`}>
        <Icon className="h-3 w-3" />
        <span className="text-[10px] font-semibold">N/A</span>
      </span>
    );
  }

  if (!start) {
    return (
      <span className="flex w-full items-center justify-center gap-1 rounded-md bg-slate-50 px-1 py-0.5 text-slate-400">
        <Icon className="h-3 w-3" />
        <span className="text-[10px] font-semibold">—</span>
      </span>
    );
  }

  const ongoing = !end;
  const early = finishedEarly(metric);
  return (
    <span
      className={cn(
        'flex w-full items-center justify-center gap-1 rounded-md px-1 py-0.5',
        early ? TONES.info.soft : ongoing ? TONES.warning.soft : TONES.success.soft,
      )}
      title={early ? `${metric.label} — ${metric.earlyNote}` : metric.label}
    >
      <Icon className="h-3 w-3" />
      <span className="text-[10px] font-bold tabular-nums">{durationBetween(start, end, { signed: metric.signed })}</span>
    </span>
  );
}

// ─── Metric card (full, used in the drawer) ────────────────────────────────────

function MetricCard({ metric }: { metric: Metric }) {
  useTicking(metric.applicable && metric.start && !metric.end ? 30_000 : false);
  const { start, end } = metric;
  const Icon = METRIC_ICON[metric.key];
  const ongoing = Boolean(start) && !end;
  const early = finishedEarly(metric);
  const accent = !metric.applicable ? TONE_HEX.muted : !start ? TONE_HEX.neutral : early ? TONE_HEX.info : ongoing ? TONE_HEX.warning : TONE_HEX.success;

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: accent + '18' }}>
          <Icon className="h-4 w-4" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-700">{metric.label}</p>
          <p className="text-[11px] text-slate-400">
            {!metric.applicable
              ? metric.naReason
              : !start
                ? metric.notStartedLabel
                : (
                  <>
                    {formatStamp(start)}
                    {end ? ` → ${formatStamp(end)}` : ` → ${metric.ongoingLabel}`}
                    {early && ` · ${metric.earlyNote}`}
                  </>
                )}
          </p>
        </div>
      </div>
      <p className="shrink-0 text-sm font-bold tabular-nums" style={{ color: accent }}>
        {!metric.applicable ? 'N/A' : start ? durationBetween(start, end, { signed: metric.signed }) : '—'}
      </p>
    </div>
  );
}

// ─── Transfer detail drawer ───────────────────────────────────────────────────

function TransferDrawer({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const cfg = PHASE_CFG[transfer.phase];
  const currentIdx = PHASE_ORDER.indexOf(transfer.phase);
  const metrics = buildMetrics(transfer);

  // The employees' courier-sign photos, previewed in a modal (ImageLightbox)
  // instead of a new tab; the two legs step through as one set.
  const photos = [
    transfer.returnPhoto && { label: 'Item Return', url: transfer.returnPhoto, qtyCounted: transfer.returnQtyCounted },
    transfer.droppingPhoto && { label: 'Item Receiving', url: transfer.droppingPhoto, qtyCounted: transfer.droppingQtyCounted },
  ].filter((p): p is { label: string; url: string; qtyCounted: number | null } => Boolean(p));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="flex w-[440px] max-w-full flex-col overflow-hidden bg-white shadow-2xl"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <PhaseBadge phase={transfer.phase} />
                {transfer.bcStatus && <span className="text-[11px] text-slate-400">{transfer.bcStatus}</span>}
              </div>
              <p className="mt-1.5 font-mono text-lg font-bold leading-snug text-slate-900">{transfer.toaNo}</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Progress — to_warehouse is a side branch off "return", not a
              5th step on this linear path, so it gets its own banner
              instead of trying to plot it on the 4-dot stepper. */}
          {transfer.phase === 'to_warehouse' ? (
            <div className="flex items-center gap-2.5 rounded-2xl border p-3.5" style={{ borderColor: cfg.accent + '33', background: cfg.accent + '0d' }}>
              <Warehouse className="h-5 w-5 shrink-0" style={{ color: cfg.accent }} />
              <p className="text-xs leading-snug text-slate-600">
                Tujuan adalah lokasi gudang (DM) — toko sudah menyerahkan barang, tidak ada tracking pengiriman/penerimaan lebih lanjut di sistem ini.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {PHASE_ORDER.map((phase, i) => {
                const done = i <= currentIdx;
                const isLast = i === PHASE_ORDER.length - 1;
                return (
                  <div key={phase} className="flex flex-1 items-center gap-1">
                    <div
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-colors"
                      style={{
                        borderColor: done ? PHASE_CFG[phase].accent : '#e2e8f0',
                        background: done ? PHASE_CFG[phase].accent : 'white',
                        color: done ? 'white' : '#94a3b8',
                      }}
                    >
                      {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                    </div>
                    {!isLast && (
                      <div
                        className="mx-1 h-px flex-1"
                        style={{ background: i < currentIdx ? PHASE_CFG[phase].accent : '#e2e8f0' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Route */}
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: cfg.accent + '33', background: cfg.accent + '0d' }}>
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dari</p>
                <StoreLabel store={transfer.fromStore} code={transfer.transferFromCode} isWarehouse={transfer.fromIsWarehouse} />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ke</p>
                <StoreLabel store={transfer.toStore} code={transfer.transferToCode} isWarehouse={transfer.toIsWarehouse} />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Package className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Qty pesanan</p>
                <p className="text-sm font-semibold text-slate-800">{transfer.qtyOrdered}</p>
              </div>
            </div>
          </div>

          {/* Key metrics — the durations OPS actually needs to check (rules: lib/transfer-order-metrics.ts) */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Waktu Kunci · WIB</p>
            <div className="space-y-2">
              {metrics.map((m) => <MetricCard key={m.key} metric={m} />)}
            </div>
            {/* BC's transfer-order feed carries no creation time, so be explicit
                about what each end of the first range actually is. */}
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              TO Dibuat = saat sistem pertama kali mendeteksi TO di Business Central (BC tidak menyediakan jam pembuatan TO).
              WS Diposting = jam Warehouse Shipment diposting di BC. Foto Serah Terima = saat toko mengirim konfirmasi serah terima ke kurir
              beserta foto. Total Proses Item Return = TO Dibuat sampai Foto Serah Terima. Terima Fisik Barang di Toko = saat toko mengonfirmasi
              barang diterima dari kurir. WR Diposting = saat sistem pertama kali melihat Warehouse Receipt diposting di BC.
            </p>
          </div>

          {photos.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Bukti Foto Karyawan</p>
              <div className="grid grid-cols-2 gap-3">
                {photos.map((photo, i) => (
                  <button
                    key={photo.label}
                    type="button"
                    onClick={() => setViewerIndex(i)}
                    className="group block text-left"
                    aria-label={`Perbesar foto ${photo.label}`}
                  >
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">{photo.label}</p>
                    <span className="relative block overflow-hidden rounded-xl border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.url}
                        alt={`Bukti foto ${photo.label}`}
                        className="h-32 w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
                        <Maximize2 className="h-5 w-5" />
                      </span>
                    </span>
                    {photo.qtyCounted != null && (
                      <p className="mt-1 text-[10px] text-slate-400">Qty dihitung: {photo.qtyCounted}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {viewerIndex != null && (
            <ImageLightbox
              title={transfer.toaNo}
              images={photos.map((p) => ({ url: p.url, label: p.label }))}
              index={viewerIndex}
              onIndexChange={setViewerIndex}
              onClose={() => setViewerIndex(null)}
            />
          )}

          {transfer.whseShipmentNo && (
            <p className="text-[11px] text-slate-400">Whse Shipment: <span className="font-mono">{transfer.whseShipmentNo}</span></p>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

// ─── Transfer row ─────────────────────────────────────────────────────────────

// One list row per transfer order (OpsList). Wide container (`@5xl`, ~1000px of
// list): a single line — TO code · status · route · the five timing metrics — whose
// columns line up with the header row above. Narrower: two lines, code + status +
// route on top and the five metrics under them, each with its small label, so the
// list never scrolls sideways beside the sidebar.
const ROW_GRID = '@5xl:grid @5xl:grid-cols-[112px_156px_minmax(0,1fr)_repeat(5,78px)] @5xl:items-center @5xl:gap-x-3';

// Short header text per metric; the full wording (lib/transfer-order-metrics.ts)
// is the hover title.
const METRIC_HEAD: Record<MetricKey, string> = {
  bcProcessing: 'TO → WS',
  wsToReturn: 'WS → Foto',
  returnTotal: 'Total Return',
  delivery: 'Delivery',
  bcReceiving: 'Terima BC',
};

const METRIC_HEAD_TITLE: Record<MetricKey, string> = {
  bcProcessing: 'TO Dibuat → WS Diposting',
  wsToReturn: 'WS Diposting → Foto Serah Terima',
  returnTotal: 'Total Proses Item Return (TO Dibuat → Foto Serah Terima)',
  delivery: 'Waktu Pengiriman (Delivery Time)',
  bcReceiving: 'Terima Fisik Barang di Toko → WR Diposting (BC)',
};

const METRIC_ORDER: MetricKey[] = ['bcProcessing', 'wsToReturn', 'returnTotal', 'delivery', 'bcReceiving'];

function TransferTableHead() {
  const th = 'text-[10px] font-bold uppercase tracking-wide text-slate-500';
  return (
    <div className={cn(ROW_GRID, 'hidden border-b border-slate-100 bg-slate-50 py-2.5 pl-5 pr-[52px]')} aria-hidden>
      <span className={th}>TO</span>
      <span className={th}>Status</span>
      <span className={th}>Dari → Ke</span>
      {METRIC_ORDER.map((key) => {
        const Icon = METRIC_ICON[key];
        return (
          <span key={key} title={METRIC_HEAD_TITLE[key]} className={cn(th, 'flex items-center justify-center gap-1 whitespace-nowrap')}>
            <Icon className="h-3 w-3 shrink-0" />
            {METRIC_HEAD[key]}
          </span>
        );
      })}
    </div>
  );
}

/** Store code (mono) + name; the name drops first when the route is tight. */
function RouteEnd({ store, code, isWarehouse }: { store: StoreRef | null; code: string; isWarehouse?: boolean }) {
  const Icon = isWarehouse ? Warehouse : StoreIcon;
  const name = isWarehouse ? 'Gudang' : (store?.name ?? '');
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5" title={`${name || code} (${code})`}>
      <Icon className="h-3 w-3 shrink-0 text-slate-400" />
      <span className={cn('shrink-0 font-mono text-xs font-semibold', isWarehouse ? 'text-slate-500' : 'text-slate-700')}>{code}</span>
      {name && <span className="min-w-0 truncate text-[11px] text-slate-400">{name}</span>}
    </span>
  );
}

function TransferRow({ transfer, onClick }: { transfer: Transfer; onClick: () => void }) {
  const metrics = useMemo(() => buildMetrics(transfer), [transfer]);

  return (
    <OpsListRow onClick={onClick} ariaLabel={`Buka ${transfer.toaNo}`} className="py-2.5">
      <div className={cn('w-full min-w-0 space-y-2 @5xl:space-y-0', ROW_GRID)}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @5xl:contents">
          <div className="min-w-0">
            <span className="block truncate font-mono text-xs font-bold text-slate-800">{transfer.toaNo}</span>
            <span className="hidden text-[10px] tabular-nums text-slate-400 @5xl:block">Qty {transfer.qtyOrdered}</span>
          </div>
          <span><PhaseBadge phase={transfer.phase} compact /></span>
          <span className="flex min-w-0 flex-1 basis-64 items-center gap-1.5 @5xl:flex-col @5xl:items-stretch @5xl:gap-0.5">
            <RouteEnd store={transfer.fromStore} code={transfer.transferFromCode} isWarehouse={transfer.fromIsWarehouse} />
            <ArrowRight className="h-3 w-3 shrink-0 text-slate-300 @5xl:hidden" />
            <RouteEnd store={transfer.toStore} code={transfer.transferToCode} isWarehouse={transfer.toIsWarehouse} />
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400 @5xl:hidden" title="Qty pesanan">×{transfer.qtyOrdered}</span>
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1.5 @5xl:contents">
          {metrics.map((m) => (
            <div key={m.key} className="min-w-0">
              <p className="mb-0.5 truncate text-center text-[9px] font-semibold uppercase tracking-wide text-slate-400 @5xl:hidden">{METRIC_HEAD[m.key]}</p>
              <MetricPill metric={m} />
            </div>
          ))}
        </div>
      </div>
    </OpsListRow>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsItemTransfersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isOps = role === 'ops' || role === 'it';

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [scope, setScope] = useState<'area' | 'all_areas'>('area');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<Phase | 'all'>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  // 'from' = this store is shipping out (Item Return task); 'to' = this
  // store is receiving (Item Dropping/Receiving task). Independent of
  // storeFilter — e.g. picking 'from' with "All stores" shows every Item
  // Return leg system-wide, regardless of which store filter is selected.
  const [direction, setDirection] = useState<'all' | 'from' | 'to'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Transfer | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps) router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      // The Refresh button forces a Business Central sweep; the first load /
      // reload reuses the one the 5-minute cron (or a colleague) just did.
      const res = await fetch(`/api/ops/item-transfers${isRefresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
      const data = await res.json();
      setTransfers(data.transfers ?? []);
      setScope(data.scope ?? 'area');
      setSyncWarnings(data.syncWarnings ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, []);

  useEffect(() => { if (isOps) load(); }, [isOps, load]);

  // Same StorePickerCombobox used on the Schedules and Impact Visit pages —
  // a searchable list scales far better than a plain <select> once the
  // store roster grows past a couple of entries.
  const storeGroups = useMemo<AreaGroupOption[]>(() => {
    const m = new Map<string, { id: number; name: string; stores: StoreOption[] }>();
    let syntheticId = 0;
    for (const t of transfers) {
      for (const store of [t.fromStore, t.toStore]) {
        if (!store) continue;
        const key = store.areaName ?? '—';
        if (!m.has(key)) m.set(key, { id: store.areaId ? Number(store.areaId) : --syntheticId, name: key, stores: [] });
        const list = m.get(key)!.stores;
        if (!list.some((s) => s.id === Number(store.id))) {
          list.push({ id: Number(store.id), storeNo: store.storeNo, name: store.name });
        }
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [transfers]);

  const allStoreOptions = useMemo(() => storeGroups.flatMap((g) => g.stores), [storeGroups]);

  const storeScoped = useMemo(() => transfers.filter((t) => {
    if (direction === 'from') return storeFilter === 'all' ? !!t.fromStore : t.fromStore?.id === storeFilter;
    if (direction === 'to') return storeFilter === 'all' ? !!t.toStore : t.toStore?.id === storeFilter;
    return storeFilter === 'all' || t.fromStore?.id === storeFilter || t.toStore?.id === storeFilter;
  }), [transfers, storeFilter, direction]);

  const searchScoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return storeScoped;
    return storeScoped.filter((t) =>
      t.toaNo.toLowerCase().includes(q) ||
      t.transferFromCode.toLowerCase().includes(q) ||
      t.transferToCode.toLowerCase().includes(q) ||
      (t.fromStore?.name.toLowerCase().includes(q) ?? false) ||
      (t.toStore?.name.toLowerCase().includes(q) ?? false),
    );
  }, [storeScoped, search]);

  const meta = useMemo(() => ({
    all: searchScoped.length,
    return: searchScoped.filter((t) => t.phase === 'return').length,
    shipping: searchScoped.filter((t) => t.phase === 'shipping').length,
    receiving: searchScoped.filter((t) => t.phase === 'receiving').length,
    received: searchScoped.filter((t) => t.phase === 'received').length,
    to_warehouse: searchScoped.filter((t) => t.phase === 'to_warehouse').length,
  }), [searchScoped]);

  const visible = useMemo(
    () => phaseFilter === 'all' ? searchScoped : searchScoped.filter((t) => t.phase === phaseFilter),
    [searchScoped, phaseFilter],
  );

  const filtered = phaseFilter !== 'all' || storeFilter !== 'all' || direction !== 'all' || search.trim() !== '';
  const clearFilters = () => { setPhaseFilter('all'); setStoreFilter('all'); setDirection('all'); setSearch(''); setSelected(null); };

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can view the item transfer pipeline.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={scope === 'all_areas' ? 'OPS · Head Office' : 'OPS · Area'}
        title="Transfer Orders"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {scope === 'all_areas' ? (<><Globe2 className="h-3.5 w-3.5" />Semua area</>) : (<><MapPin className="h-3.5 w-3.5" />Area kamu</>)}
            <span>·</span>
            <span>{transfers.length} transfer order</span>
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="space-y-6 p-6 lg:p-8">
        {syncWarnings.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Sebagian sinkronisasi Business Central gagal</p>
              {syncWarnings.map((w, i) => (
                <p key={i} className="mt-0.5 text-[11px] text-red-600">{w}</p>
              ))}
            </div>
          </div>
        )}

        {/* Summary — one tile per phase; a tile is also the phase filter (click again to clear) */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {PHASE_TILE_ORDER.map((phase) => {
            const cfg = PHASE_CFG[phase];
            const active = phaseFilter === phase;
            return (
              <MetricTile
                key={phase}
                label={cfg.label}
                value={loading ? '–' : meta[phase]}
                tone={meta[phase] > 0 ? cfg.tone : 'default'}
                active={active}
                onClick={() => { setPhaseFilter(active ? 'all' : phase); setSelected(null); }}
              />
            );
          })}
        </div>

        {/* Search / store / direction */}
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearchInput value={search} onChange={(v) => { setSearch(v); setSelected(null); }} placeholder="Cari no. TO, nama / kode toko…" className="max-w-sm" />
          <div className="w-60 shrink-0 [&_button]:h-10">
            <StorePickerCombobox
              storeGroups={storeGroups}
              selectedValue={storeFilter}
              triggerLabel={storeFilter === 'all' ? 'Semua toko' : (allStoreOptions.find((s) => String(s.id) === storeFilter)?.name ?? '')}
              onSelect={(v) => { setStoreFilter(v); setSelected(null); }}
              extraOption={{ value: 'all', label: 'Semua toko' }}
            />
          </div>
          <OpsFilterSelect label="Arah" value={direction} onChange={(v) => { setDirection(v as typeof direction); setSelected(null); }}>
            <option value="all">Semua arah</option>
            <option value="from">Keluar · Item Return</option>
            <option value="to">Masuk · Item Receiving</option>
          </OpsFilterSelect>
        </div>

        {/* List */}
        {loading ? (
          <OpsListSkeleton rows={8} />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50"><Package className="h-7 w-7 text-slate-300" /></div>
            <div>
              <p className="text-sm font-bold text-slate-700">Tidak ada transfer order</p>
              <p className="mt-1 text-xs text-slate-400">
                {filtered ? 'Tidak ada yang cocok dengan filter.' : 'Belum ada yang tersinkron dari Business Central.'}
              </p>
            </div>
            {filtered && (
              <button type="button" onClick={clearFilters} className="text-xs font-semibold text-indigo-600 hover:underline">Hapus filter</button>
            )}
          </div>
        ) : (
          <div className="@container overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 sm:px-5">
              <p className="text-sm font-semibold text-slate-800">
                {visible.length} transfer order
                {filtered && <span className="ml-2 text-xs font-normal text-slate-400">dari {transfers.length}</span>}
              </p>
              {filtered && (
                <button type="button" onClick={clearFilters} className="text-xs font-semibold text-indigo-600 hover:underline">Hapus filter</button>
              )}
            </div>
            <TransferTableHead />
            <OpsList className="rounded-none border-0 shadow-none">
              {visible.map((t) => <TransferRow key={t.id} transfer={t} onClick={() => setSelected(t)} />)}
            </OpsList>
          </div>
        )}
      </div>

      {selected && (
        <TransferDrawer transfer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
