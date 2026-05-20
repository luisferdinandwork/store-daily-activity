'use client';
// app/ops/tasks/progress/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Box,
  CalendarDays,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  CreditCard,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Store,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'discrepancy'
  | 'verified'
  | 'rejected';

type StoreSummary = {
  pending: number;
  inProgress: number;
  completed: number;
  discrepancy: number;
  verified: number;
  rejected: number;
  total: number;
  completionRate: number;
};

type StoreRow = {
  id: string;
  name: string;
  address: string;
  summary: StoreSummary;
};

type OverviewResponse = {
  success: boolean;
  error?: string;
  date: string;
  area: { id: string; name: string } | null;
  summary: StoreSummary;
  stores: StoreRow[];
};

type FlatTask = {
  id: string;
  type: string;
  scheduleId: string;
  userId: string;
  userName: string | null;
  storeId: string;
  shift: 'morning' | 'evening' | 'full_day' | null;
  date: string;
  status: TaskStatus | string | null;
  notes: string | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  isBalanced: boolean | null;
  parentTaskId: number | null;
  extra: Record<string, unknown>;
};

type DetailResponse = {
  success: boolean;
  error?: string;
  date: string;
  store: { id: string; name: string; address: string };
  summary: StoreSummary;
  tasks: FlatTask[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_LABELS: Record<string, string> = {
  store_front: 'Store Front',
  store_opening: 'Store Opening',
  setoran: 'Setoran',
  cek_bin: 'Cek Bin',
  vm_checklist: 'VM Checklist',
  marketing_check: 'Marketing Check',
  item_dropping: 'Item Dropping',
  briefing: 'Briefing',
  edc_reconciliation: 'EDC Reconciliation',
  eod_z_report: 'EOD Z Report',
  open_statement: 'Open Statement',
  grooming: 'Grooming',
};

const TASK_ICONS: Record<string, React.ElementType> = {
  store_opening: Store,
  store_front: Camera,
  setoran: Wallet,
  cek_bin: Box,
  vm_checklist: ClipboardList,
  marketing_check: ClipboardList,
  item_dropping: Box,
  briefing: Users,
  edc_reconciliation: CreditCard,
  eod_z_report: FileText,
  open_statement: ClipboardList,
  grooming: User,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtAmount(val: unknown): string {
  const n = Number(val);
  if (!val || isNaN(n)) return '—';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

/** 0% = amber (pending, matching employee task page), in-progress = indigo, 100% = green */
function progressBarClass(rate: number): string {
  if (rate === 0) return 'bg-amber-300';
  if (rate >= 100) return 'bg-emerald-500';
  return 'bg-indigo-500';
}

function progressTextClass(rate: number): string {
  if (rate === 0) return 'text-amber-500';
  if (rate >= 100) return 'text-emerald-600';
  return 'text-indigo-600';
}

function progressRingColor(rate: number): string {
  if (rate === 0) return '#fbbf24';   // amber-400
  if (rate >= 100) return '#10b981'; // emerald-500
  return '#6366f1';                   // indigo-500
}

function statusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'completed':  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'in_progress': return 'bg-indigo-50 text-indigo-700 border-indigo-200';
    case 'discrepancy': return 'bg-amber-50 text-amber-700 border-amber-300';
    default:            return 'bg-amber-50 text-amber-600 border-amber-200'; // pending
  }
}

function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'completed':   return 'Selesai';
    case 'in_progress': return 'Aktif';
    case 'discrepancy': return 'Discrepancy';
    default:            return 'Pending';
  }
}

// ─── Shared mini-atoms ────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 52, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = progressRingColor(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" className="transition-all duration-300" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black tabular-nums" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', progressBarClass(pct))}
        style={{ width: `${pct}%` }} />
    </div>
  );
}

function CheckRow({ label, done, by, at }: { label: string; done: boolean; by?: string | null; at?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2">
        {done
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          : <Circle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
        <span className={cn('text-xs font-medium', done ? 'text-slate-700' : 'text-amber-700')}>{label}</span>
      </div>
      {done && (by || at) && (
        <span className="shrink-0 text-[10px] text-slate-400">{by ? `${by}` : ''}{at ? ` · ${fmtTime(at)}` : ''}</span>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold text-slate-400">{label}</span>
      <span className="text-xs font-semibold text-slate-700">{value}</span>
    </div>
  );
}

// ─── Task-type-specific detail panels ────────────────────────────────────────

/**
 * store_opening — show each checklist item, who did it, and when.
 * The `extra` object mirrors the DB columns (camelCase) populated by buildExtra().
 */
function StoreOpeningDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const checks = [
    { label: 'Login POS / Kasir',      done: !!e.loginPos,          by: e.loginPosBy as string,          at: e.loginPosAt as string },
    { label: 'Cek Absen Sunfish',      done: !!e.checkAbsenSunfish, by: e.checkAbsenSunfishBy as string, at: e.checkAbsenSunfishAt as string },
    { label: 'Tarik SOH & Sales',      done: !!e.tarikSohSales,     by: e.tarikSohSalesBy as string,     at: e.tarikSohSalesAt as string },
    { label: '5R (area kasir)',         done: !!(e.fiveR && e.fiveRAreaKasirPhotos && (e.fiveRAreaKasirPhotos as string[]).length > 0),  by: e.fiveRAreaKasirBy as string,  at: e.fiveRAreaKasirAt as string },
    { label: '5R (depan toko)',         done: !!(e.fiveR && e.fiveRAreaDepanPhotos && (e.fiveRAreaDepanPhotos as string[]).length > 0),  by: e.fiveRAreaDepanBy as string,  at: e.fiveRAreaDepanAt as string },
    { label: '5R (sisi kanan)',         done: !!(e.fiveR && e.fiveRAreaKananPhotos && (e.fiveRAreaKananPhotos as string[]).length > 0),  by: e.fiveRAreaKananBy as string,  at: e.fiveRAreaKananAt as string },
    { label: '5R (sisi kiri)',          done: !!(e.fiveR && e.fiveRAreaKiriPhotos  && (e.fiveRAreaKiriPhotos  as string[]).length > 0),  by: e.fiveRAreaKiriBy as string,   at: e.fiveRAreaKiriAt as string },
    { label: '5R (gudang)',             done: !!(e.fiveR && e.fiveRAreaGudangPhotos && (e.fiveRAreaGudangPhotos as string[]).length > 0), by: e.fiveRAreaGudangBy as string, at: e.fiveRAreaGudangAt as string },
    { label: 'Cek Lampu',              done: !!e.cekLamp,           by: e.cekLampBy as string,           at: e.cekLampAt as string },
    { label: 'Cek Sound System',       done: !!e.cekSoundSystem,    by: e.cekSoundSystemBy as string,    at: e.cekSoundSystemAt as string },
    { label: 'Foto Cash Drawer',       done: !!(e.cashDrawerPhotos && (e.cashDrawerPhotos as string[]).length > 0), by: e.cashDrawerBy as string, at: e.cashDrawerAt as string },
  ];
  const done = checks.filter(c => c.done).length;
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">{done}/{checks.length} item selesai</p>
      <div className="divide-y divide-slate-100">
        {checks.map(c => <CheckRow key={c.label} {...c} />)}
      </div>
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** store_front — who completed it + photo count */
function StoreFrontDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const storefrontPhotos = (e.storefrontPhotos as string[] | undefined) ?? [];
  const hasRolling = !!e.rollingDoorClosedPhoto;
  const completedBy = e.completedBy as string | null;
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Dikerjakan oleh" value={task.userName ?? task.userId} />
      {completedBy && completedBy !== task.userId && (
        <InfoRow label="Diselesaikan oleh" value={String(completedBy)} />
      )}
      <InfoRow label="Foto storefront" value={storefrontPhotos.length > 0 ? `${storefrontPhotos.length} foto` : '—'} />
      <InfoRow label="Foto rolling door" value={hasRolling
        ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ada</span>
        : <span className="text-amber-500">Belum</span>}
      />
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** setoran — money amounts */
function SetoranDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const actualReceived: unknown = e.actualReceivedAmount  ?? e.expectedAmount;
  const previousUnpaid: unknown = e.previousUnpaidAmount  ?? e.carriedDeficit;
  const requiredStore: unknown  = e.requiredStoreAmount;
  const stored: unknown         = e.storedAmount           ?? e.amount;
  const unpaid: unknown         = e.unpaidAmount;
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Uang diterima"    value={fmtAmount(actualReceived)} />
      {Number(previousUnpaid) > 0 && (
        <InfoRow label="Sisa kemarin"   value={<span className="text-amber-600">{fmtAmount(previousUnpaid)}</span>} />
      )}
      {Boolean(requiredStore) && (
        <InfoRow label="Wajib disetor"  value={fmtAmount(requiredStore)} />
      )}
      <InfoRow label="Disetor"          value={fmtAmount(stored)} />
      {Number(unpaid) > 0 && (
        <InfoRow label="Belum lunas"    value={<span className="text-amber-600 font-bold">{fmtAmount(unpaid)}</span>} />
      )}
      <InfoRow label="Foto resi"        value={(e.resiPhoto as string | null)
        ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ada</span>
        : <span className="text-amber-500">Belum</span>}
      />
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** cek_bin — bin counts */
function CekBinDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const total   = Number(e.totalStoreBins      ?? 0);
  const minimum = Number(e.minimumBinsToCheck  ?? 0);
  const checked = Number(e.checkedBinsCount    ?? 0);
  const pct     = total > 0 ? Math.round((checked / total) * 100) : 0;
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Total BIN toko"   value={total} />
      <InfoRow label="Minimum dicek"    value={minimum} />
      <InfoRow label="Sudah dicek"      value={
        <span className={cn('font-bold', checked >= minimum ? 'text-emerald-600' : 'text-amber-600')}>{checked} ({pct}%)</span>
      } />
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** vm_checklist */
function VmChecklistDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const items = [
    { label: 'Shoe lace / filler / price tag / hangtag / label K3L', done: !!e.shoeLaceShoeFillerPriceTagHangtagLabelK3L },
    { label: 'Last pair & pigskin hangtag',                           done: !!e.lastPairAndPigskinHangtag },
    { label: 'POP promo update',                                      done: !!e.popPromoUpdate },
    { label: 'Display table / wall shelving / showcase / hangbar / stacking / pedestal', done: !!e.displayTableWallShelvingShowcaseHangbarStackingPedestal },
    { label: 'Floor display cleanliness',                             done: !!e.floorDisplayCleanliness },
    { label: 'VM tools storage',                                      done: !!e.vmToolsStorage },
  ];
  return (
    <div className="divide-y divide-slate-100">
      {items.map(i => <CheckRow key={i.label} label={i.label} done={i.done} />)}
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** marketing_check */
function MarketingCheckDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const items = [
    { label: 'Nama promo',             done: !!e.promoName,           by: e.promoNameBy as string,         at: e.promoNameAt as string },
    { label: 'Periode promo',          done: !!e.promoPeriod,         by: e.promoPeriodBy as string,       at: e.promoPeriodAt as string },
    { label: 'Mekanisme promo',        done: !!e.promoMechanism,      by: e.promoMechanismBy as string,    at: e.promoMechanismAt as string },
    { label: 'Random item sepatu',     done: !!e.randomShoeItems,     by: e.randomShoeItemsBy as string,   at: e.randomShoeItemsAt as string },
    { label: 'Random item non-sepatu', done: !!e.randomNonShoeItems,  by: e.randomNonShoeItemsBy as string,at: e.randomNonShoeItemsAt as string },
    { label: 'Sell tag',               done: !!e.sellTag,             by: e.sellTagBy as string,           at: e.sellTagAt as string },
  ];
  return (
    <div className="divide-y divide-slate-100">
      {items.map(i => <CheckRow key={i.label} {...i} />)}
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** item_dropping */
function ItemDroppingDetail({ task }: { task: FlatTask }) {
  const e    = task.extra as Record<string, unknown>;
  const entries = (e.entries as unknown[] | undefined) ?? [];
  if (!e.hasDropping) {
    return <p className="py-2 text-xs text-slate-400">Tidak ada dropping hari ini.</p>;
  }
  return (
    <div>
      {entries.length === 0
        ? <p className="py-2 text-xs text-amber-600">Dropping ada, belum ada entri.</p>
        : entries.map((entry: unknown, i: number) => {
            const en = entry as Record<string, unknown>;
            return (
              <div key={i} className="border-t border-slate-100 py-2 first:border-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700">TO #{en.toNumber as string}</span>
                  <span className="text-[10px] text-slate-400">{fmtTime(en.dropTime as string)}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">Qty: {String(en.quantity)}</p>
              </div>
            );
          })
      }
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** briefing */
function BriefingDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Briefing selesai" value={Boolean(e.done)
        ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3 w-3" />Ya</span>
        : <span className="text-amber-500">Belum</span>}
      />
      <InfoRow label="Balanced" value={task.isBalanced === null ? '—'
        : task.isBalanced
          ? <span className="text-emerald-600">Seimbang</span>
          : <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />Tidak seimbang</span>}
      />
      {task.parentTaskId && (
        <InfoRow label="Carry-forward dari" value={`Task #${task.parentTaskId}`} />
      )}
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** edc_reconciliation */
function EdcReconciliationDetail({ task }: { task: FlatTask }) {
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Balanced" value={task.isBalanced === null ? '—'
        : task.isBalanced
          ? <span className="text-emerald-600">Seimbang</span>
          : <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />Tidak seimbang</span>}
      />
      {task.parentTaskId && (
        <InfoRow label="Carry-forward dari" value={`Task #${task.parentTaskId}`} />
      )}
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** eod_z_report */
function EodZReportDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const photos = (e.zReportPhotos as string[] | undefined) ?? [];
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Total nominal" value={fmtAmount(e.totalNominal)} />
      <InfoRow label="Foto Z-report"  value={photos.length > 0 ? `${photos.length} foto` : '—'} />
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/** open_statement */
function OpenStatementDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  return (
    <div className="space-y-1 divide-y divide-slate-100">
      <InfoRow label="Expected"  value={fmtAmount(e.expectedAmount)} />
      <InfoRow label="Aktual"    value={fmtAmount(e.actualAmount)} />
      <InfoRow label="Balanced"  value={task.isBalanced === null ? '—'
        : task.isBalanced
          ? <span className="text-emerald-600">Seimbang</span>
          : <span className="flex items-center gap-1 text-amber-600"><AlertTriangle className="h-3 w-3" />Tidak seimbang</span>}
      />
      {task.parentTaskId && (
        <InfoRow label="Carry-forward dari" value={`Task #${task.parentTaskId}`} />
      )}
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

// ─── Grooming: per-employee detail (used inside the grouped card) ────────────

/**
 * GroomingEmployeeDetail — renders ONE employee's grooming checklist.
 * Used by GroomingGroupCard to show each employee's per-row detail when expanded.
 */
function GroomingEmployeeDetail({ task }: { task: FlatTask }) {
  const e = task.extra as Record<string, unknown>;
  const fields: { label: string; active: boolean; checked: boolean | null }[] = [
    { label: 'Seragam',    active: e.uniformActive  !== false, checked: (e.uniformChecked  ?? null) as boolean | null },
    { label: 'Rambut',     active: e.hairActive     !== false, checked: (e.hairChecked     ?? null) as boolean | null },
    { label: 'Aroma',      active: e.smellActive    !== false, checked: (e.smellChecked    ?? null) as boolean | null },
    { label: 'Make-up',    active: e.makeUpActive   !== false, checked: (e.makeUpChecked   ?? null) as boolean | null },
    { label: 'Sepatu',     active: e.shoeActive     !== false, checked: (e.shoeChecked     ?? null) as boolean | null },
    { label: 'Name tag',   active: e.nameTagActive  !== false, checked: (e.nameTagChecked  ?? null) as boolean | null },
  ];
  const activeFields  = fields.filter(f => f.active);
  const doneCount     = activeFields.filter(f => f.checked === true).length;
  const photos        = (e.selfiePhotos as string[] | undefined) ?? [];

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
                  : <Circle className="h-3.5 w-3.5 text-amber-400" />
              }
              <span className="text-xs font-medium text-slate-700">{f.label}</span>
            </div>
            {!f.active && <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">N/A</span>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400">
        {photos.length > 0 && <span className="flex items-center gap-1"><Camera className="h-3 w-3" />{photos.length} selfie</span>}
        {task.completedAt && <span>Selesai {fmtTime(task.completedAt)}</span>}
      </div>
      {task.notes && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">{task.notes}</p>}
    </div>
  );
}

/**
 * GroomingGroupCard — collapses all grooming tasks (one per employee) into a
 * single card. Header shows the aggregate (e.g. "3/5 karyawan selesai").
 * Inside, each employee row is independently expandable for their checklist.
 */
function GroomingGroupCard({ tasks }: { tasks: FlatTask[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openEmployees, setOpenEmployees] = useState<Set<string>>(new Set());

  const totalEmployees = tasks.length;
  const doneEmployees  = tasks.filter(t => t.status === 'completed').length;
  const activeCount    = tasks.filter(t => t.status === 'in_progress').length;
  const issueCount     = tasks.filter(t => t.status === 'discrepancy').length;

  // Aggregate status: completed if all done, in_progress if any active, pending otherwise
  const aggregateStatus: TaskStatus =
    doneEmployees === totalEmployees ? 'completed'
    : activeCount > 0 ? 'in_progress'
    : issueCount > 0 ? 'discrepancy'
    : 'pending';

  const accentClass =
    aggregateStatus === 'completed'   ? 'bg-emerald-500' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-500' :
    aggregateStatus === 'discrepancy' ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300';

  const iconBg =
    aggregateStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    aggregateStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    aggregateStatus === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  const toggleEmployee = (id: string) => {
    setOpenEmployees(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      {/* Group header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentClass)} />

        <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg pl-1', iconBg)}>
          <User className="h-4 w-4" strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">Grooming Karyawan</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {doneEmployees}/{totalEmployees} karyawan selesai
                <span className="ml-1.5 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-600">Personal</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(aggregateStatus))}>
                {statusLabel(aggregateStatus)}
              </span>
              <span className="text-[10px] text-slate-400">
                {activeCount > 0 && <span className="text-indigo-500">{activeCount} aktif</span>}
                {activeCount > 0 && issueCount > 0 && ' · '}
                {issueCount > 0 && <span className="text-amber-600">{issueCount} discrepancy</span>}
              </span>
            </div>
          </div>
          {/* Mini progress bar for aggregate */}
          <ProgressBar
            pct={totalEmployees > 0 ? Math.round((doneEmployees / totalEmployees) * 100) : 0}
            className="mt-2"
          />
        </div>

        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Per-employee list */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 p-3">
          <div className="space-y-2">
            {tasks.map(task => {
              const isOpen = openEmployees.has(task.id);
              const empStatus = task.status ?? 'pending';
              return (
                <div key={task.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <button
                    type="button"
                    onClick={() => toggleEmployee(task.id)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-slate-50"
                  >
                    <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
                      empStatus === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
                      empStatus === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
                      empStatus === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
                      'bg-amber-50 text-amber-500'
                    )}>
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-900">{task.userName ?? task.userId}</p>
                      {task.completedAt && (
                        <p className="text-[10px] text-slate-400">Selesai {fmtTime(task.completedAt)}</p>
                      )}
                    </div>
                    <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(empStatus))}>
                      {statusLabel(empStatus)}
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform', isOpen && 'rotate-180')} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2.5">
                      <GroomingEmployeeDetail task={task} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TaskDetail({ task }: { task: FlatTask }) {
  switch (task.type) {
    case 'store_opening':      return <StoreOpeningDetail task={task} />;
    case 'store_front':        return <StoreFrontDetail task={task} />;
    case 'setoran':            return <SetoranDetail task={task} />;
    case 'cek_bin':            return <CekBinDetail task={task} />;
    case 'vm_checklist':       return <VmChecklistDetail task={task} />;
    case 'marketing_check':    return <MarketingCheckDetail task={task} />;
    case 'item_dropping':      return <ItemDroppingDetail task={task} />;
    case 'briefing':           return <BriefingDetail task={task} />;
    case 'edc_reconciliation': return <EdcReconciliationDetail task={task} />;
    case 'eod_z_report':       return <EodZReportDetail task={task} />;
    case 'open_statement':     return <OpenStatementDetail task={task} />;
    // grooming is handled by GroomingGroupCard, not here
    default:
      return task.notes
        ? <p className="py-2 text-xs text-slate-500">{task.notes}</p>
        : <p className="py-2 text-xs text-slate-400">Tidak ada detail tambahan.</p>;
  }
}

// ─── Expandable TaskRow ───────────────────────────────────────────────────────

function TaskRow({ task }: { task: FlatTask }) {
  const [expanded, setExpanded] = useState(false);

  const label      = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const status     = task.status ?? 'pending';
  const TaskIcon   = TASK_ICONS[task.type] ?? ClipboardList;

  // Accent bar color mirrors status
  const accentClass =
    status === 'completed'   ? 'bg-emerald-500' :
    status === 'in_progress' ? 'bg-indigo-500' :
    status === 'discrepancy' ? 'bg-amber-400 animate-pulse' :
    'bg-amber-300'; // pending

  const iconBg =
    status === 'completed'   ? 'bg-emerald-50 text-emerald-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'discrepancy' ? 'bg-amber-50 text-amber-600' :
    'bg-amber-50 text-amber-500';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="relative flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        {/* Left accent bar */}
        <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-xl', accentClass)} />

        <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg pl-1', iconBg)}>
          <TaskIcon className="h-4 w-4" strokeWidth={2} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-900">{label}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                PIC: {task.userName ?? task.userId}
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
                {statusLabel(status)}
              </span>
              {task.completedAt && (
                <span className="text-[10px] text-slate-400">{fmtTime(task.completedAt)}</span>
              )}
            </div>
          </div>
        </div>

        <ChevronDown className={cn('mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform', expanded && 'rotate-180')} />
      </button>

      {/* Expandable detail */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-3 pl-5">
          <TaskDetail task={task} />
        </div>
      )}
    </div>
  );
}

// ─── SummaryBreakdown ─────────────────────────────────────────────────────────

function SummaryBreakdown({ summary }: { summary: StoreSummary }) {
  const rows = [
    { label: 'Completed',   value: summary.completed,   cls: 'text-emerald-600' },
    { label: 'In Progress', value: summary.inProgress,  cls: 'text-indigo-600'  },
    { label: 'Pending',     value: summary.pending,     cls: 'text-amber-500'   },
    { label: 'Discrepancy', value: summary.discrepancy, cls: 'text-amber-600'   },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map(row => (
        <div key={row.label} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{row.label}</p>
          <p className={cn('mt-0.5 text-2xl font-black', row.cls)}>{row.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Store list card ──────────────────────────────────────────────────────────

function StoreProgressCard({ store, active, onOpen }: {
  store: StoreRow; active: boolean; onOpen: () => void;
}) {
  const rate    = store.summary.completionRate;
  const done    = store.summary.completed;
  const hasIssue = store.summary.discrepancy > 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50',
        active ? 'bg-indigo-50' : '')}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500')}>
        <Store className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
          <span className={cn('shrink-0 text-xs font-bold tabular-nums', progressTextClass(rate))}>{rate}%</span>
        </div>
        <ProgressBar pct={rate} className="mt-1.5" />
        <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
          {done}/{store.summary.total} selesai
          {store.summary.inProgress > 0 && <span className="text-indigo-500"> · {store.summary.inProgress} aktif</span>}
          {hasIssue && <span className="text-amber-600"> · {store.summary.discrepancy} discrepancy</span>}
        </p>
      </div>

      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// ─── Store detail panel ───────────────────────────────────────────────────────

function StoreDetailPanel({ detail, loading }: { detail: DetailResponse | null; loading: boolean }) {
  /**
   * Group tasks by shift, AND split out grooming tasks (which are per-employee)
   * so they can be rendered as a single grouped card in the morning section.
   */
  const groupedTasks = useMemo(() => {
    const groups: Record<string, { regular: FlatTask[]; grooming: FlatTask[] }> = {
      morning:  { regular: [], grooming: [] },
      full_day: { regular: [], grooming: [] },
      evening:  { regular: [], grooming: [] },
      other:    { regular: [], grooming: [] },
    };
    for (const task of detail?.tasks ?? []) {
      const shiftKey: 'morning' | 'full_day' | 'evening' | 'other' =
        task.shift === 'morning'  ? 'morning'  :
        task.shift === 'full_day' ? 'full_day' :
        task.shift === 'evening'  ? 'evening'  :
        'other';
      if (task.type === 'grooming') {
        groups[shiftKey].grooming.push(task);
      } else {
        groups[shiftKey].regular.push(task);
      }
    }
    return groups;
  }, [detail?.tasks]);

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Memuat detail task…
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <ArrowRight className="h-5 w-5" />
          </div>
          <p className="font-semibold text-slate-700">Pilih toko untuk lihat detail</p>
          <p className="mt-1 text-xs text-slate-400">Klik salah satu toko di kiri untuk melihat semua task progress-nya.</p>
        </div>
      </div>
    );
  }

  const rate = detail.summary.completionRate;
  const shiftSections = [
    { key: 'morning',  label: 'Morning Shift' },
    { key: 'full_day', label: 'Full Day Shift' },
    { key: 'evening',  label: 'Evening Shift' },
    { key: 'other',    label: 'Other' },
  ] as const;

  const hasAnyTasks = detail.tasks.length > 0;

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header (fixed inside the card) */}
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <ProgressRing pct={rate} size={64} stroke={6} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-slate-900">{detail.store.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{detail.store.address}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              <span className="text-emerald-600">{detail.summary.completed} selesai</span>
              <span className="text-slate-300"> · </span>
              <span className={detail.summary.inProgress > 0 ? 'text-indigo-600' : 'text-slate-400'}>
                {detail.summary.inProgress} aktif
              </span>
              {detail.summary.discrepancy > 0 && (
                <><span className="text-slate-300"> · </span><span className="text-amber-600">{detail.summary.discrepancy} discrepancy</span></>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Breakdown (fixed) */}
      <div className="shrink-0 border-b border-slate-100 p-4">
        <SummaryBreakdown summary={detail.summary} />
      </div>

      {/* Scrollable task sections */}
      <div className="flex-1 overflow-y-auto">
        {!hasAnyTasks ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Tidak ada task untuk toko ini pada tanggal yang dipilih.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {shiftSections.map(section => {
              const { regular, grooming } = groupedTasks[section.key];
              const totalCount = regular.length + (grooming.length > 0 ? 1 : 0);
              if (totalCount === 0) return null;
              return (
                <div key={section.key} className="p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{section.label}</h3>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {totalCount} task
                    </span>
                  </div>
                  <div className="space-y-2">
                    {/* Grooming group card appears first in morning shift */}
                    {grooming.length > 0 && <GroomingGroupCard tasks={grooming} />}
                    {regular.map(task => <TaskRow key={`${task.type}-${task.id}`} task={task} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTaskProgressPage() {
  const [date, setDate]                     = useState(todayKey());
  const [search, setSearch]                 = useState('');
  const [overview, setOverview]             = useState<OverviewResponse | null>(null);
  const [detail, setDetail]                 = useState<DetailResponse | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail]   = useState(false);
  const [error, setError]                   = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true); setError(null);
    try {
      const res  = await fetch(`/api/ops/tasks/progress?date=${date}`, { cache: 'no-store' });
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load task progress.');
      setOverview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task progress.');
      setOverview(null);
    } finally { setLoadingOverview(false); }
  }, [date]);

  const loadDetail = useCallback(async (storeId: string) => {
    setLoadingDetail(true); setError(null);
    try {
      const params = new URLSearchParams({ date, storeId });
      const res  = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
      const json = (await res.json()) as DetailResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load store detail.');
      setDetail(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load store detail.');
      setDetail(null);
    } finally { setLoadingDetail(false); }
  }, [date]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (selectedStoreId) void loadDetail(selectedStoreId);
    else setDetail(null);
  }, [selectedStoreId, loadDetail]);

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview?.stores ?? [];
    return (overview?.stores ?? []).filter(
      s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q),
    );
  }, [overview?.stores, search]);

  return (
    <main className="min-h-screen bg-slate-50">
      {/* ── Header ── */}
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">Ops · Task Monitor</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Task Progress</h1>
              <p className="mt-1 text-sm text-slate-500">
                {overview?.area?.name ? `${overview.area.name} · ` : ''}{fmtDateLabel(date)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="date" value={date}
                  onChange={e => { setDate(e.target.value); setSelectedStoreId(null); setDetail(null); }}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <button type="button"
                onClick={() => { void loadOverview(); if (selectedStoreId) void loadDetail(selectedStoreId); }}
                disabled={loadingOverview || loadingDetail}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-4 w-4', (loadingOverview || loadingDetail) && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Gagal memuat data</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        {/*
          Two-column layout. Each column has its OWN scroll container capped at
          the viewport height (minus the sticky header). This way:
          - The page itself doesn't grow as the store list or task list grow.
          - When one column has more content than fits, it scrolls internally,
            without forcing the other column off-screen or shrinking it.
        */}
        <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
          {/* ── Store list ── */}
          <aside className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[6.5rem]">
            {/* Search (fixed inside card) */}
            <div className="shrink-0 border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Cari toko…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>

            {/* Legend (fixed inside card) */}
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{filteredStores.length} toko</p>
              <div className="ml-auto flex items-center gap-2.5 text-[10px] font-semibold text-slate-400">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-300" />Belum mulai</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-indigo-500" />Aktif</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />Selesai</span>
              </div>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
              {loadingOverview
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                    </div>
                  ))
                : filteredStores.length === 0
                  ? (
                    <div className="p-8 text-center">
                      <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
                      <p className="mt-1 text-xs text-slate-400">Coba ubah tanggal atau kata kunci pencarian.</p>
                    </div>
                  )
                  : filteredStores.map(store => (
                      <StoreProgressCard key={store.id} store={store}
                        active={selectedStoreId === store.id}
                        onOpen={() => setSelectedStoreId(cur => cur === store.id ? null : store.id)}
                      />
                    ))
              }
            </div>
          </aside>

          {/* ── Detail panel ── */}
          <div className="lg:sticky lg:top-[6.5rem]">
            <StoreDetailPanel detail={detail} loading={loadingDetail} />
          </div>
        </div>
      </div>
    </main>
  );
}