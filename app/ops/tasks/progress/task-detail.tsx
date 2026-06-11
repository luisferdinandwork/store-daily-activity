'use client';
// app/ops/tasks/progress/task-detail.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Per-task detail components + image galleries, plus a full right-panel
// `TaskDetailView` that opens when an OPS user selects a single task.
//
// Actor-name resolution
// ──────────────────────
// The server (lib/db/utils/tasks.ts) now resolves user IDs into display names:
//   • On the task itself:   completedByName, verifiedByName, verifiedAt.
//   • Inside `extra`:        for every actor key `xxxBy`, a sibling `xxxByName`.
// So a checklist field that records `loginPosBy` also carries `loginPosByName`.
// Use `actorName(extra, 'loginPos')` to prefer the readable name and fall back
// to the raw id only when no name was resolved.
//
// Store Closing
// ─────────────
// `store_closing` replaces the old edc_reconciliation / eod_z_report /
// open_statement tasks. Its detail body reads everything from `extra`
// (eodZReportDone, edcSummaryDone, edcSettlementDone, the side-by-side evidence
// photo, and the open-statement decision / hold state).
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  CreditCard,
  PauseCircle,
  ShieldCheck,
  Store,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'discrepancy'
  | 'verified'
  | 'rejected';

export type FlatTask = {
  id: string;
  type: string;
  scheduleId: string;
  userId: string;
  userName: string | null;
  // Actor display fields resolved server-side.
  completedBy: string | null;
  completedByName: string | null;
  verifiedBy: string | null;
  verifiedByName: string | null;
  verifiedAt: string | null;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day' | null;
  date: string;
  status: TaskStatus | string | null;
  notes: string | null;
  completedAt: string | null;
  isBalanced: boolean | null;
  parentTaskId: number | null;
  extra: Record<string, unknown>;
};

// ─── Label / icon maps ──────────────────────────────────────────────────────

export const TASK_LABELS: Record<string, string> = {
  store_front: 'Store Front',
  store_opening: 'Store Opening',
  setoran: 'Setoran',
  cek_bin: 'Cek Bin',
  vm_checklist: 'VM Checklist',
  marketing_check: 'Marketing Check',
  item_dropping: 'Item Dropping',
  briefing: 'Briefing',
  serah_terima: 'Serah Terima',
  store_closing: 'Store Closing',
  grooming: 'Grooming',
};

export const TASK_ICONS: Record<string, React.ElementType> = {
  store_opening: Store,
  store_front: Camera,
  setoran: Wallet,
  cek_bin: Box,
  vm_checklist: ClipboardList,
  marketing_check: ClipboardList,
  item_dropping: Box,
  briefing: Users,
  serah_terima: ClipboardList,
  store_closing: CreditCard,
  grooming: User,
};

// ─── Formatters ──────────────────────────────────────────────────────────────

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export function fmtAmount(val: unknown): string {
  const n = Number(val);
  if (!val || isNaN(n)) return '—';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'completed':   return 'Selesai';
    case 'verified':    return 'Terverifikasi';
    case 'rejected':    return 'Ditolak';
    case 'in_progress': return 'Aktif';
    case 'discrepancy': return 'Discrepancy';
    default:            return 'Pending';
  }
}

export function statusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case 'completed':   return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'verified':    return 'bg-teal-50 text-teal-700 border-teal-200';
    case 'rejected':    return 'bg-red-50 text-red-700 border-red-200';
    case 'in_progress': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'discrepancy': return 'bg-amber-50 text-amber-700 border-amber-300';
    default:            return 'bg-amber-50 text-amber-600 border-amber-200';
  }
}

// ─── Actor-name resolution ───────────────────────────────────────────────────
//
// For a checklist key like `loginPos`, the server stores `loginPosBy` (id) and
// `loginPosByName` (resolved name). Prefer the name, fall back to the id, and
// return null when nothing was recorded.

export function actorName(
  extra: Record<string, unknown>,
  baseKey: string,
): string | null {
  const name = extra[`${baseKey}ByName`];
  if (typeof name === 'string' && name.length > 0) return name;
  const id = extra[`${baseKey}By`];
  if (typeof id === 'string' && id.length > 0) return id;
  return null;
}

function actorAt(extra: Record<string, unknown>, baseKey: string): string | null {
  const at = extra[`${baseKey}At`];
  return typeof at === 'string' && at.length > 0 ? at : null;
}

// ─── Photo helpers ───────────────────────────────────────────────────────────
//
// `extra` photo fields can arrive as a string[] (already parsed server-side),
// a raw JSON string, or a single plain path string. `asPhotos` normalises all
// three into a clean string[].
//
// ⚠️ Adjust `resolvePhotoUrl` to match where your uploads actually live
//    (e.g. a CDN base, an S3 bucket, or a `/api/files/…` proxy route).

export function resolvePhotoUrl(path: string): string {
  if (!path) return '';
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (path.startsWith('/')) return path;
  return `/${path}`;
}

export function asPhotos(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s);
        return Array.isArray(parsed)
          ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0)
          : [];
      } catch {
        return [];
      }
    }
    return [s];
  }
  return [];
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({
  urls,
  index,
  onChange,
  onClose,
}: {
  urls: string[];
  index: number;
  onChange: (i: number) => void;
  onClose: () => void;
}) {
  const go = useCallback(
    (dir: number) => onChange((index + dir + urls.length) % urls.length),
    [index, urls.length, onChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        aria-label="Tutup"
      >
        <X className="h-5 w-5" />
      </button>

      {urls.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); go(-1); }}
          className="absolute left-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="Sebelumnya"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={urls[index]}
        alt={`Foto ${index + 1}`}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
      />

      {urls.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); go(1); }}
          className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
          aria-label="Berikutnya"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      {urls.length > 1 && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-white">
          {index + 1} / {urls.length}
        </div>
      )}
    </div>
  );
}

// ─── PhotoGrid (self-contained, opens its own lightbox) ──────────────────────

export function PhotoGrid({
  label,
  photos,
  columns = 3,
  emptyHint,
}: {
  label?: string;
  photos: unknown;
  columns?: 1 | 2 | 3;
  emptyHint?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const urls = asPhotos(photos).map(resolvePhotoUrl).filter(Boolean);

  if (urls.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="py-1.5">
        {label && <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>}
        <p className="text-xs text-amber-500">{emptyHint}</p>
      </div>
    );
  }

  const gridCols =
    columns === 1 ? 'grid-cols-1' : columns === 2 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className="py-1.5">
      {label && (
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Camera className="h-3 w-3" />
          {label} · {urls.length}
        </p>
      )}
      <div className={cn('grid gap-2', gridCols)}>
        {urls.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${label ?? 'Foto'} ${i + 1}`}
              loading="lazy"
              className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
            />
            <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" />
          </button>
        ))}
      </div>
      {active !== null && (
        <Lightbox urls={urls} index={active} onChange={setActive} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

// ─── Mini-atoms ──────────────────────────────────────────────────────────────

export function CheckRow({
  label, done, by, at,
}: { label: string; done: boolean; by?: string | null; at?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        {done
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          : <Circle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        <span className={cn('text-xs font-medium', done ? 'text-slate-700' : 'text-amber-700')}>{label}</span>
      </div>
      {done && (by || at) && (
        <span className="shrink-0 text-right text-[10px] text-slate-400">
          {by ? by : ''}{by && at ? ' · ' : ''}{at ? fmtTime(at) : ''}
        </span>
      )}
    </div>
  );
}

export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-xs font-semibold text-slate-700">{value}</span>
    </div>
  );
}

function NotesBlock({ notes }: { notes: string | null | undefined }) {
  if (!notes) return null;
  return <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{notes}</p>;
}

// Shared footer that surfaces who completed/verified the task using the
// server-resolved display names.
function ActorFooter({ task }: { task: FlatTask }) {
  const completedName = task.completedByName ?? task.completedBy;
  const verifiedName = task.verifiedByName ?? task.verifiedBy;

  if (!completedName && !verifiedName && !task.completedAt) return null;

  return (
    <div className="mt-3 space-y-1 rounded-lg bg-slate-50 px-3 py-2">
      {completedName && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Diselesaikan oleh
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {completedName}{task.completedAt ? ` · ${fmtTime(task.completedAt)}` : ''}
          </span>
        </div>
      )}
      {verifiedName && (
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <ShieldCheck className="h-3 w-3 text-teal-500" /> Diverifikasi oleh
          </span>
          <span className="text-xs font-semibold text-slate-700">
            {verifiedName}{task.verifiedAt ? ` · ${fmtTime(task.verifiedAt)}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Per-task detail bodies ──────────────────────────────────────────────────

function StoreOpeningDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  // Each checklist row resolves its own actor name from extra via actorName().
  const checks = [
    { label: 'Login POS / Kasir',  base: 'loginPos',          done: !!e.loginPos },
    { label: 'Cek Absen Sunfish',  base: 'checkAbsenSunfish', done: !!e.checkAbsenSunfish },
    { label: 'Tarik SOH & Sales',  base: 'tarikSohSales',     done: !!e.tarikSohSales },
    { label: 'Cek Lampu',          base: 'cekLamp',           done: !!e.cekLamp },
    { label: 'Cek Sound System',   base: 'cekSoundSystem',    done: !!e.cekSoundSystem },
  ];
  const doneCount = checks.filter(c => c.done).length;

  const fiveR: { label: string; base: string; photos: unknown }[] = [
    { label: '5R Area Kasir',  base: 'fiveRAreaKasir',  photos: e.fiveRAreaKasirPhotos },
    { label: '5R Depan Toko',  base: 'fiveRAreaDepan',  photos: e.fiveRAreaDepanPhotos },
    { label: '5R Sisi Kanan',  base: 'fiveRAreaKanan',  photos: e.fiveRAreaKananPhotos },
    { label: '5R Sisi Kiri',   base: 'fiveRAreaKiri',   photos: e.fiveRAreaKiriPhotos },
    { label: '5R Gudang',      base: 'fiveRAreaGudang', photos: e.fiveRAreaGudangPhotos },
  ];

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{doneCount}/{checks.length} checklist selesai</p>
      <div className="divide-y divide-slate-100">
        {checks.map(c => (
          <CheckRow
            key={c.base}
            label={c.label}
            done={c.done}
            by={actorName(e, c.base)}
            at={actorAt(e, c.base)}
          />
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <PhotoGrid label="Foto Meja / Cash Drawer" photos={e.cashDrawerPhotos ?? e.cashierDeskPhotos} columns={2} emptyHint="Belum ada foto cash drawer." />
        {fiveR.map(area => (
          <PhotoGrid key={area.base} label={area.label} photos={area.photos} columns={2} />
        ))}
      </div>

      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function StoreFrontDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  return (
    <div>
      <div className="space-y-1 divide-y divide-slate-100">
        <InfoRow label="Dikerjakan oleh" value={task.userName ?? task.userId} />
      </div>
      <div className="mt-2 space-y-2">
        <PhotoGrid label="Foto Storefront" photos={e.storefrontPhotos} columns={3} emptyHint="Belum ada foto storefront." />
        <PhotoGrid label="Foto Rolling Door" photos={e.rollingDoorClosedPhoto} columns={2} emptyHint="Belum ada foto rolling door." />
      </div>
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function SetoranDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const actualReceived = e.actualReceivedAmount ?? e.expectedAmount;
  const previousUnpaid = e.previousUnpaidAmount ?? e.carriedDeficit;
  const requiredStore  = e.requiredStoreAmount;
  const stored         = e.storedAmount ?? e.amount;
  const unpaid         = e.unpaidAmount;
  return (
    <div>
      <div className="space-y-1 divide-y divide-slate-100">
        <InfoRow label="Uang diterima" value={fmtAmount(actualReceived)} />
        {Number(previousUnpaid) > 0 && (
          <InfoRow label="Sisa kemarin" value={<span className="text-amber-600">{fmtAmount(previousUnpaid)}</span>} />
        )}
        {Boolean(requiredStore) && <InfoRow label="Wajib disetor" value={fmtAmount(requiredStore)} />}
        <InfoRow label="Disetor" value={fmtAmount(stored)} />
        {Number(unpaid) > 0 && (
          <InfoRow label="Belum lunas" value={<span className="font-bold text-amber-600">{fmtAmount(unpaid)}</span>} />
        )}
      </div>
      <div className="mt-2 space-y-2">
        <PhotoGrid label="Foto Resi" photos={e.resiPhoto} columns={2} emptyHint="Belum ada foto resi." />
        <PhotoGrid label="Selfie + Kartu ATM" photos={e.atmCardSelfiePhoto} columns={2} />
      </div>
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function CekBinDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const total   = Number(e.totalStoreBins ?? 0);
  const minimum = Number(e.minimumBinsToCheck ?? 0);
  const checked = Number(e.checkedBinsCount ?? 0);
  const pct     = total > 0 ? Math.round((checked / total) * 100) : 0;
  return (
    <div>
      <div className="space-y-1 divide-y divide-slate-100">
        <InfoRow label="Total BIN toko" value={total} />
        <InfoRow label="Minimum dicek" value={minimum} />
        <InfoRow
          label="Sudah dicek"
          value={<span className={cn('font-bold', checked >= minimum ? 'text-emerald-600' : 'text-amber-600')}>{checked} ({pct}%)</span>}
        />
      </div>
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function VmChecklistDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const items = [
    { label: 'Shoe lace / filler / price tag / hangtag / label K3L', done: !!e.shoeLaceShoeFillerPriceTagHangtagLabelK3L },
    { label: 'Last pair & pigskin hangtag', done: !!e.lastPairAndPigskinHangtag },
    { label: 'POP promo update', done: !!e.popPromoUpdate },
    { label: 'Display table / wall shelving / showcase / hangbar / stacking / pedestal', done: !!e.displayTableWallShelvingShowcaseHangbarStackingPedestal },
    { label: 'Floor display cleanliness', done: !!e.floorDisplayCleanliness },
    { label: 'VM tools storage', done: !!e.vmToolsStorage },
  ];
  return (
    <div className="divide-y divide-slate-100">
      {items.map(i => <CheckRow key={i.label} label={i.label} done={i.done} />)}
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function MarketingCheckDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const items = [
    { label: 'Nama promo',             base: 'promoName',          done: !!e.promoName },
    { label: 'Periode promo',          base: 'promoPeriod',        done: !!e.promoPeriod },
    { label: 'Mekanisme promo',        base: 'promoMechanism',     done: !!e.promoMechanism },
    { label: 'Random item sepatu',     base: 'randomShoeItems',    done: !!e.randomShoeItems },
    { label: 'Random item non-sepatu', base: 'randomNonShoeItems', done: !!e.randomNonShoeItems },
    { label: 'Sell tag',               base: 'sellTag',            done: !!e.sellTag },
  ];
  return (
    <div className="divide-y divide-slate-100">
      {items.map(i => (
        <CheckRow
          key={i.base}
          label={i.label}
          done={i.done}
          by={actorName(e, i.base)}
          at={actorAt(e, i.base)}
        />
      ))}
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function ItemDroppingDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const entries = (e.entries as Record<string, unknown>[] | undefined) ?? [];

  if (!e.hasDropping) {
    return <p className="py-2 text-xs text-slate-400">Tidak ada dropping hari ini.</p>;
  }

  return (
    <div>
      {entries.length === 0 ? (
        <p className="py-2 text-xs text-amber-600">Dropping ada, belum ada entri.</p>
      ) : (
        entries.map((en, i) => (
          <div key={i} className="border-t border-slate-100 py-2 first:border-0">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">TO #{String(en.toNumber)}</span>
              <span className="text-[10px] text-slate-400">{fmtTime(en.dropTime as string)}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">Qty: {String(en.quantity)}</p>
            <PhotoGrid label="Foto Dropping" photos={en.droppingPhotos} columns={3} />
            <PhotoGrid label="Foto Terima" photos={en.receivePhotos} columns={3} />
          </div>
        ))
      )}
      {/* Task-level fallback if photos are stored on the task instead of entries */}
      <PhotoGrid label="Foto Dropping" photos={e.droppingPhotos} columns={3} />
      <PhotoGrid label="Foto Terima" photos={e.receivePhotos} columns={3} />
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function BriefingDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const done = task.status === 'completed' || Boolean(e.done);
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow
        label="Briefing selesai"
        value={done
          ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ya</span>
          : <span className="text-amber-500">Belum</span>}
      />
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

function SerahTerimaDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const items = Array.isArray(e.items) ? (e.items as Record<string, unknown>[]) : [];
  const handoverText = typeof e.handoverText === 'string' ? e.handoverText : '';
  const doneItems = items.filter(item => Boolean(item.isCompleted)).length;

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {items.length > 0 ? `${doneItems}/${items.length} pesan selesai` : 'Pesan handover'}
      </p>
      {items.length > 0 ? (
        <div className="divide-y divide-slate-100">
          {items.map((item, index) => (
            <CheckRow
              key={String(item.id ?? index)}
              label={String(item.message ?? '')}
              done={Boolean(item.isCompleted)}
              by={(item.completedByName as string | null) ?? (item.completedBy as string | null)}
              at={item.completedAt as string | null}
            />
          ))}
        </div>
      ) : handoverText ? (
        <div className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-600">
          {handoverText}
        </div>
      ) : (
        <p className="py-2 text-xs text-slate-400">Belum ada pesan serah terima.</p>
      )}
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

// Store Closing — replaces edc_reconciliation + eod_z_report + open_statement.
// Order per OPS request: EOD Z-Report → EDC Summary → EDC Settlement → evidence
// photo → Open Statement.
function StoreClosingDetail({ task }: { task: FlatTask }) {
  const e = task.extra;

  const decision    = (e.openStatementDecision as string | null) ?? null;
  const isOnHold    = !!e.isOnHold;
  const heldAt      = (e.heldAt as string | null | undefined) ?? null;
  const holdReason  = (e.openStatementHoldReason as string | null | undefined) ?? null;
  const reopenedAt  = (e.reopenedAt as string | null | undefined) ?? null;

  const edcSummaryNotes    = typeof e.edcSummaryNotes === 'string' ? e.edcSummaryNotes.trim() : '';
  const edcSettlementNotes = typeof e.edcSettlementNotes === 'string' ? e.edcSettlementNotes.trim() : '';

  const openStatement =
    decision === 'post_statement'
      ? { label: 'Post Statement', cls: 'text-emerald-600', Icon: CheckCircle2 }
      : decision === 'on_hold'
        ? { label: 'On Hold', cls: 'text-amber-600', Icon: PauseCircle }
        : { label: 'Belum dipilih', cls: 'text-amber-500', Icon: Circle };
  const OpenIcon = openStatement.Icon;

  return (
    <div>
      {isOnHold && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2">
          <PauseCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-amber-800">Open Statement On Hold</p>
            <p className="mt-0.5 text-[10px] text-amber-700">
              Issue terkait sedang ditangani; task dibuka kembali setelah resolved.
              {heldAt ? ` · Ditahan ${fmtTime(heldAt)}` : ''}
            </p>
          </div>
        </div>
      )}

      {/* 1 · EOD Z-Report */}
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">EOD Z-Report</p>
      <div className="divide-y divide-slate-100">
        <CheckRow
          label="EOD Z-Report selesai"
          done={!!e.eodZReportDone}
          by={actorName(e, 'eodZReport')}
          at={actorAt(e, 'eodZReport')}
        />
      </div>

      {/* 2 · EDC Summary (shown before Settlement) */}
      <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">EDC Summary</p>
      <div className="divide-y divide-slate-100">
        <CheckRow
          label="EDC Summary selesai"
          done={!!e.edcSummaryDone}
          by={actorName(e, 'edcSummary')}
          at={actorAt(e, 'edcSummary')}
        />
      </div>
      {edcSummaryNotes && (
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{edcSummaryNotes}</p>
      )}

      {/* 3 · EDC Settlement */}
      <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">EDC Settlement</p>
      <div className="divide-y divide-slate-100">
        <CheckRow
          label="EDC Settlement selesai"
          done={!!e.edcSettlementDone}
          by={actorName(e, 'edcSettlement')}
          at={actorAt(e, 'edcSettlement')}
        />
      </div>
      {edcSettlementNotes && (
        <p className="mt-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{edcSettlementNotes}</p>
      )}

      {/* 4 · Evidence photo (EOD + EDC settlement side by side) */}
      <div className="mt-3">
        <PhotoGrid
          label="Foto EOD + EDC Settlement"
          photos={e.eodEdcSettlementPhoto}
          columns={2}
          emptyHint="Belum ada foto bukti EOD + EDC Settlement."
        />
      </div>

      {/* 5 · Open Statement */}
      <div className="mt-3 space-y-1 divide-y divide-slate-100">
        <InfoRow
          label="Open Statement"
          value={<span className={cn('flex items-center gap-1 font-bold', openStatement.cls)}><OpenIcon className="h-3 w-3" />{openStatement.label}</span>}
        />
        {reopenedAt && (
          <InfoRow label="Dibuka kembali" value={<span className="text-indigo-600">{fmtTime(reopenedAt)}</span>} />
        )}
      </div>
      {isOnHold && holdReason && (
        <div className="py-1.5">
          <p className="text-xs font-semibold text-slate-400">Alasan hold</p>
          <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{holdReason}</p>
        </div>
      )}

      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

export function GroomingEmployeeDetail({ task }: { task: FlatTask }) {
  const e = task.extra;
  const fields: { label: string; active: boolean; checked: boolean | null }[] = [
    { label: 'Seragam',  active: e.uniformActive !== false, checked: (e.uniformChecked ?? null) as boolean | null },
    { label: 'Rambut',   active: e.hairActive    !== false, checked: (e.hairChecked    ?? null) as boolean | null },
    { label: 'Aroma',    active: e.smellActive   !== false, checked: (e.smellChecked   ?? null) as boolean | null },
    { label: 'Make-up',  active: e.makeUpActive  !== false, checked: (e.makeUpChecked  ?? null) as boolean | null },
    { label: 'Sepatu',   active: e.shoeActive    !== false, checked: (e.shoeChecked    ?? null) as boolean | null },
    { label: 'Name tag', active: e.nameTagActive !== false, checked: (e.nameTagChecked ?? null) as boolean | null },
  ];
  const activeFields = fields.filter(f => f.active);
  const doneCount = activeFields.filter(f => f.checked === true).length;

  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {doneCount}/{activeFields.length} item aktif selesai
      </p>
      <div className="divide-y divide-slate-100">
        {fields.map(f => (
          <div key={f.label} className={cn('flex items-center justify-between py-1.5', !f.active && 'opacity-40')}>
            <div className="flex items-center gap-2">
              {!f.active
                ? <Circle className="h-3.5 w-3.5 text-slate-300" />
                : f.checked
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  : <Circle className="h-3.5 w-3.5 text-amber-400" />}
              <span className="text-xs font-medium text-slate-700">{f.label}</span>
            </div>
            {!f.active && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">N/A</span>}
          </div>
        ))}
      </div>
      <PhotoGrid label="Selfie" photos={e.selfiePhotos} columns={3} />
      <ActorFooter task={task} />
      <NotesBlock notes={task.notes} />
    </div>
  );
}

// ─── Switch ──────────────────────────────────────────────────────────────────

export function TaskDetailBody({ task }: { task: FlatTask }) {
  switch (task.type) {
    case 'store_opening':   return <StoreOpeningDetail task={task} />;
    case 'store_front':     return <StoreFrontDetail task={task} />;
    case 'setoran':         return <SetoranDetail task={task} />;
    case 'cek_bin':         return <CekBinDetail task={task} />;
    case 'vm_checklist':    return <VmChecklistDetail task={task} />;
    case 'marketing_check': return <MarketingCheckDetail task={task} />;
    case 'item_dropping':   return <ItemDroppingDetail task={task} />;
    case 'briefing':        return <BriefingDetail task={task} />;
    case 'serah_terima':    return <SerahTerimaDetail task={task} />;
    case 'store_closing':   return <StoreClosingDetail task={task} />;
    case 'grooming':        return <GroomingEmployeeDetail task={task} />;
    default:
      return task.notes
        ? <p className="py-2 text-xs text-slate-500">{task.notes}</p>
        : <p className="py-2 text-xs text-slate-400">Tidak ada detail tambahan.</p>;
  }
}

// ─── Full right-panel detail view ────────────────────────────────────────────

export function TaskDetailView({
  task,
  onBack,
}: {
  task: FlatTask;
  onBack: () => void;
}) {
  const label = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const TaskIcon = TASK_ICONS[task.type] ?? ClipboardList;
  const status = task.status ?? 'pending';

  const iconBg =
    status === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    status === 'verified'    ? 'bg-teal-50 text-teal-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Kembali ke daftar task
        </button>

        <div className="flex items-start gap-3">
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', iconBg)}>
            <TaskIcon className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-bold text-slate-900">{label}</h2>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">PIC: {task.userName ?? task.userId}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
              {statusLabel(status)}
            </span>
            {task.completedAt && <span className="text-[10px] text-slate-400">{fmtTime(task.completedAt)}</span>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <TaskDetailBody task={task} />
      </div>
    </article>
  );
}