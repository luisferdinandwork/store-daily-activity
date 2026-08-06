'use client';

// app/ops/item-transfers/page.tsx — OPS Item Transfer pipeline dashboard.
//
// Shows every BC-synced transfer order across its 3 phases (Item Return →
// Shipping → Item Receiving), sourced live from /api/ops/item-transfers,
// which re-syncs Business Central on every load/refresh. Mirrors the
// app/ops/issues/page.tsx convention: store-filterable card list + a
// right-side slide-in drawer with the full phase timeline.

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Package, Truck, PackageCheck, CheckCircle2, Store as StoreIcon,
  MapPin, Clock, ChevronDown, Loader2, X, Globe2, Shield, AlertTriangle,
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = 'return' | 'shipping' | 'receiving' | 'received';

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
  returnDetectedAt: string | null;
  returnSubmittedAt: string | null;
  droppingDetectedAt: string | null;
  droppingSubmittedAt: string | null;
  receivedAt: string | null;
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASE_CFG: Record<Phase, { label: string; accent: string; Icon: typeof Package }> = {
  return: { label: 'Menunggu Diambil', accent: '#f59e0b', Icon: Package },
  shipping: { label: 'Dalam Perjalanan', accent: '#0ea5e9', Icon: Truck },
  receiving: { label: 'Menunggu Diterima BC', accent: '#8b5cf6', Icon: PackageCheck },
  received: { label: 'Selesai', accent: '#10b981', Icon: CheckCircle2 },
};

const PHASE_ORDER: Phase[] = ['return', 'shipping', 'receiving', 'received'];

// ─── Time helpers ─────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  if (hours < 24) return `${hours}j lalu`;
  if (days < 7) return `${days}h lalu`;
  return new Date(dateStr).toLocaleDateString('id-ID', { month: 'short', day: 'numeric' });
}

function durationBetween(startIso: string | null, endIso: string | null): string {
  if (!startIso) return '—';
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMin = Math.max(0, Math.round((end - new Date(startIso).getTime()) / 60_000));
  const hours = Math.floor(diffMin / 60);
  const minutes = diffMin % 60;
  if (hours >= 24) return `${Math.floor(hours / 24)}h ${hours % 24}j`;
  if (hours > 0) return `${hours}j ${minutes}m`;
  return `${minutes}m`;
}

function currentPhaseStart(t: Transfer): string | null {
  if (t.phase === 'return') return t.returnDetectedAt;
  if (t.phase === 'shipping') return t.returnSubmittedAt;
  return t.droppingSubmittedAt;
}

function currentPhaseEnd(t: Transfer): string | null {
  return t.phase === 'received' ? t.receivedAt : null;
}

// ─── Store label ──────────────────────────────────────────────────────────────

function StoreLabel({ store, code }: { store: StoreRef | null; code: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700">
      <StoreIcon className="h-3 w-3 shrink-0 text-slate-400" />
      {store ? store.name : code}
      <span className="font-mono text-[10px] font-normal text-slate-400">({code})</span>
    </span>
  );
}

// ─── Phase badge ──────────────────────────────────────────────────────────────

function PhaseBadge({ phase }: { phase: Phase }) {
  const c = PHASE_CFG[phase];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
      style={{ background: c.accent + '18', color: c.accent }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.accent }} />
      {c.label}
    </span>
  );
}

// ─── Transfer detail drawer ───────────────────────────────────────────────────

function TransferDrawer({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  const cfg = PHASE_CFG[transfer.phase];
  const currentIdx = PHASE_ORDER.indexOf(transfer.phase);

  const phases: Array<{ key: Phase; start: string | null; end: string | null }> = [
    { key: 'return', start: transfer.returnDetectedAt, end: transfer.returnSubmittedAt },
    { key: 'shipping', start: transfer.returnSubmittedAt, end: transfer.droppingSubmittedAt },
    { key: 'receiving', start: transfer.droppingSubmittedAt, end: transfer.receivedAt },
  ];

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
          {/* Progress */}
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

          {/* Route */}
          <div className="space-y-3 rounded-2xl border p-4" style={{ borderColor: cfg.accent + '33', background: cfg.accent + '0d' }}>
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Dari</p>
                <StoreLabel store={transfer.fromStore} code={transfer.transferFromCode} />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <MapPin className="h-4 w-4 shrink-0" style={{ color: cfg.accent }} />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ke</p>
                <StoreLabel store={transfer.toStore} code={transfer.transferToCode} />
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

          {/* Phase timeline */}
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Timeline</p>
            <div className="space-y-2">
              {[
                { label: 'Item Return (pickup)', ...phases[0] },
                { label: 'Shipping (in transit)', ...phases[1] },
                { label: 'Item Receiving', ...phases[2] },
              ].map((p, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                  <div>
                    <p className="text-xs font-bold text-slate-700">{p.label}</p>
                    <p className="text-[11px] text-slate-400">
                      {p.start ? new Date(p.start).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Belum mulai'}
                      {p.end ? ` → ${new Date(p.end).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}` : p.start ? ' → berjalan' : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-slate-800">{p.start ? durationBetween(p.start, p.end) : '—'}</p>
                </div>
              ))}
            </div>
          </div>

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

function TransferRow({ transfer, onClick }: { transfer: Transfer; onClick: () => void }) {
  const start = currentPhaseStart(transfer);
  const end = currentPhaseEnd(transfer);

  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:border-indigo-200 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="font-mono text-sm font-bold leading-snug text-slate-800">{transfer.toaNo}</p>
        <PhaseBadge phase={transfer.phase} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <StoreLabel store={transfer.fromStore} code={transfer.transferFromCode} />
        <span className="text-slate-300">→</span>
        <StoreLabel store={transfer.toStore} code={transfer.transferToCode} />
      </div>
      <div className="flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><Package className="h-3 w-3" />Qty {transfer.qtyOrdered}</span>
        <span className="ml-auto flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {start ? `${durationBetween(start, end)} di fase ini` : relativeTime(transfer.postingDate ?? new Date().toISOString())}
        </span>
      </div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsItemTransfersPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isOps = role === 'ops' || role === 'it';

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [scope, setScope] = useState<'area' | 'all_areas'>('area');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncWarnings, setSyncWarnings] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<Phase | 'all'>('all');
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Transfer | null>(null);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps) router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    try {
      const res = await fetch('/api/ops/item-transfers', { cache: 'no-store' });
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

  const storesByArea = useMemo(() => {
    const m = new Map<string, { areaName: string; list: { id: string; name: string }[] }>();
    for (const t of transfers) {
      for (const store of [t.fromStore, t.toStore]) {
        if (!store) continue;
        const key = store.areaName ?? '—';
        if (!m.has(key)) m.set(key, { areaName: key, list: [] });
        const list = m.get(key)!.list;
        if (!list.some((s) => s.id === store.id)) list.push({ id: store.id, name: store.name });
      }
    }
    return [...m.values()].sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [transfers]);

  const storeScoped = useMemo(
    () => storeFilter === 'all'
      ? transfers
      : transfers.filter((t) => t.fromStore?.id === storeFilter || t.toStore?.id === storeFilter),
    [transfers, storeFilter],
  );

  const meta = useMemo(() => ({
    all: storeScoped.length,
    return: storeScoped.filter((t) => t.phase === 'return').length,
    shipping: storeScoped.filter((t) => t.phase === 'shipping').length,
    receiving: storeScoped.filter((t) => t.phase === 'receiving').length,
    received: storeScoped.filter((t) => t.phase === 'received').length,
  }), [storeScoped]);

  const visible = useMemo(
    () => phaseFilter === 'all' ? storeScoped : storeScoped.filter((t) => t.phase === phaseFilter),
    [storeScoped, phaseFilter],
  );

  const statCards = [
    { key: 'all' as const, label: 'Total', value: meta.all, color: '#6366f1', Icon: Package },
    { key: 'return' as const, label: PHASE_CFG.return.label, value: meta.return, color: PHASE_CFG.return.accent, Icon: PHASE_CFG.return.Icon },
    { key: 'shipping' as const, label: PHASE_CFG.shipping.label, value: meta.shipping, color: PHASE_CFG.shipping.accent, Icon: PHASE_CFG.shipping.Icon },
    { key: 'receiving' as const, label: PHASE_CFG.receiving.label, value: meta.receiving, color: PHASE_CFG.receiving.accent, Icon: PHASE_CFG.receiving.Icon },
    { key: 'received' as const, label: PHASE_CFG.received.label, value: meta.received, color: PHASE_CFG.received.accent, Icon: PHASE_CFG.received.Icon },
  ];

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
        title="Item Transfers"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {scope === 'all_areas' ? (<><Globe2 className="h-3.5 w-3.5" />All areas</>) : (<><MapPin className="h-3.5 w-3.5" />Your area</>)}
            <span>·</span>
            <span>{transfers.length} transfer order{transfers.length !== 1 ? 's' : ''}</span>
          </span>
        }
        onRefresh={() => load(true)}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
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

        {/* Store filter */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[280px] flex-1">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Store</label>
              <div className="relative">
                <StoreIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <select
                  value={storeFilter}
                  onChange={(e) => { setStoreFilter(e.target.value); setSelected(null); }}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">All stores</option>
                  {storesByArea.length > 1
                    ? storesByArea.map((g) => (
                        <optgroup key={g.areaName} label={g.areaName}>
                          {g.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </optgroup>
                      ))
                    : storesByArea[0]?.list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              </div>
            </div>
            <p className="pb-3 text-xs tabular-nums text-slate-400">
              {visible.length} shown · click a card to filter by phase
            </p>
          </div>
        </div>

        {/* Phase stat cards */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {statCards.map(({ key, label, value, color, Icon }) => {
            const active = phaseFilter === key;
            return (
              <button
                key={key}
                onClick={() => { setPhaseFilter(key); setSelected(null); }}
                className="flex items-center gap-3 rounded-2xl border bg-white px-4 py-4 text-left shadow-sm transition-all"
                style={{ borderColor: active ? color : '#e2e8f0', boxShadow: active ? `0 0 0 3px ${color}20` : undefined }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color + '15' }}>
                  <Icon className="h-5 w-5" style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50"><Package className="h-8 w-8 text-slate-300" /></div>
            <div>
              <p className="text-sm font-bold text-slate-700">No transfer orders to show</p>
              <p className="mt-1 text-xs text-slate-400">
                {phaseFilter !== 'all' ? `No transfers in "${PHASE_CFG[phaseFilter as Phase].label}" right now.` : 'Nothing synced from Business Central yet.'}
              </p>
            </div>
          </div>
        ) : (
          <div className={cn('grid grid-cols-1 gap-3 lg:grid-cols-2')}>
            {visible.map((t) => (
              <TransferRow key={t.id} transfer={t} onClick={() => setSelected(t)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <TransferDrawer transfer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
