'use client';
// app/ops/performance-targets/page.tsx
//
// Employee Performance Target management — monthly-fixed-percentage model.
//
//   - Ops sets ONE monthly sales + transaction target per store.
//   - The store's roster is assigned slots (PIC1, PIC2, SA1, SA2, ...) based
//     on the whole month's headcount ("Man Power"), and each slot defaults
//     to the IT-managed PIC1/PIC2/SA1-5 % grid (see /it/target-allocation).
//   - Ops can override one employee's % here — everyone else on the roster
//     automatically rebalances around it so the roster still sums to 100%.
//   - An employee's daily target is a FLAT number: their monthly target
//     (percentage% × store monthly target) divided by how many days
//     they're scheduled to work that month — the same figure every
//     scheduled day.
//
//   - OPS HO sees all areas/stores (grouped by area, switchable).
//   - OPS Area sees only stores within their assigned area.
//
// Redesign: actual sales / actual transactions are the headline numbers —
// pick a store on the left, its real performance is the first thing you see
// on the right, with the monthly target tucked into a small editable strip
// underneath. No lock/unlock control anymore.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  ChevronLeft,
  LayoutGrid,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Store,
  Target,
  TrendingUp,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ──────────────────────────────────────────────────────────────────

type ViewPeriod = 'daily' | 'monthly';

type StoreRollup = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;
  rosterCount: number;
  storeActualSales: number;
  storeActualTransactionCount: number;
  actualsAvailable: boolean;
};

type StoreRow = {
  id: number;
  storeNo: string;
  name: string;
  address: string;
  areaId: number | null;
  areaName: string | null;
  rollup: StoreRollup;
};

type OverviewResponse = {
  success: boolean;
  error?: string;
  yearMonth: string;
  scope: 'area' | 'all_areas';
  areaId: number | null;
  summary: {
    storeMonthlySalesTarget: number;
    storeMonthlyTransactionTarget: number;
    rosterCount: number;
    storeCount: number;
    plannedStoreCount: number;
  };
  stores: StoreRow[];
};

type PlanRow = {
  id: number;
  storeId: number;
  yearMonth: string;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  notes: string | null;
};

type EmployeeTargetRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  targetRoleCode: string;          // PIC1 | PIC2 | SA
  slotCode: string;                 // PIC1 | PIC2 | SA1... — fixed for the whole month
  percentage: number;               // fixed monthly % share of the store's monthly target
  isPercentageOverridden: boolean;
  scheduledDays: number;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  dailySalesTarget: number;         // flat: monthlySalesTarget / scheduledDays
  dailyTransactionTarget: number;
  isScheduledToday: boolean;
  displaySalesTarget: number;
  displayTransactionTarget: number;
  actualSales: number;
  actualTransactionCount: number;
};

type DetailResponse = {
  success: boolean;
  error?: string;
  yearMonth: string;
  period: ViewPeriod;
  date: string | null;
  scope: 'area' | 'all_areas';
  store: { id: number; storeNo: string; name: string; address: string; areaId: number | null; areaName: string | null };
  plan: PlanRow | null;
  rollup: {
    storeMonthlyTargetId: number | null;
    storeId: number;
    yearMonth: string;
    storeMonthlySalesTarget: number;
    storeMonthlyTransactionTarget: number;
    storeMonthlyAtvTarget: number;
    rosterCount: number;
  };
  rosterMeta: { headcount: number; usedFallbackEqualSplit: boolean } | null;
  employeeTargets: EmployeeTargetRow[];
  actuals: {
    available: boolean;
    error?: string;
    storeActualSales: number;
    storeActualTransactionCount: number;
  };
  storeDisplaySalesTarget: number;
  storeDisplayTransactionTarget: number;
};

type EligibleEmployee = {
  id: string;
  nik: string;
  name: string;
  hasTarget: boolean;
};

// ─── Date helpers ───────────────────────────────────────────────────────────

function todayDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateKeyToYearMonth(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function fmtDateLabel(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

function fmtMonthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function daysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function lastDayOfMonthKey(yearMonth: string): string {
  return `${yearMonth}-${String(daysInMonth(yearMonth)).padStart(2, '0')}`;
}

function shiftYearMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateShort(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Format helpers ─────────────────────────────────────────────────────────

function fmtCurrency(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

function fmtCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}jt`;
  if (Math.abs(value) >= 1_000) return `Rp ${(value / 1_000).toFixed(0)}rb`;
  return fmtCurrency(value);
}

function fmtNumber(value: number): string {
  return Math.round(value).toLocaleString('id-ID');
}

function pctOf(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

const ROLE_OPTIONS = ['PIC1', 'PIC2', 'SA'];

// ─── Shared atoms ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

function IconStat({ icon: Icon, iconClass, label, value, sub }: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconClass)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-slate-400">{label}</p>
        <p className="truncate text-lg font-black text-slate-900">{value}</p>
        {sub && <p className="truncate text-[11px] text-slate-400">{sub}</p>}
      </div>
    </div>
  );
}

function PctProgressBar({ pct, size = 'sm' }: { pct: number; size?: 'sm' | 'md' }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const barClass =
    pct === 0 ? 'bg-amber-300' :
    pct >= 100 ? 'bg-emerald-500' :
    'bg-indigo-500';
  const textClass =
    pct === 0 ? 'text-amber-500' :
    pct >= 100 ? 'text-emerald-600' :
    'text-indigo-600';

  return (
    <div className="flex items-center gap-2">
      <div className={cn('overflow-hidden rounded-full bg-slate-100', size === 'md' ? 'h-2 w-full' : 'h-1.5 w-16')}>
        <div className={cn('h-full rounded-full transition-all duration-500', barClass)} style={{ width: `${clamped}%` }} />
      </div>
      <span className={cn('shrink-0 text-[11px] font-black tabular-nums', textClass)}>{pct}%</span>
    </div>
  );
}

/** Headline actual-vs-target card — the main thing a store's detail leads with. */
function HeroMetric({ icon: Icon, iconClass, label, actual, target, format }: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  actual: number;
  target: number;
  format: (n: number) => string;
}) {
  const pct = pctOf(actual, target);
  const barClass = pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-500';
  const pctClass = pct >= 100 ? 'text-emerald-600' : 'text-indigo-600';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-center gap-2">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className="mt-2.5 truncate text-[26px] font-black leading-none tabular-nums text-slate-900">
        {format(actual)}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all duration-500', barClass)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Target {format(target)}</span>
        <span className={cn('font-black tabular-nums', pctClass)}>{pct}%</span>
      </div>
    </div>
  );
}

function ViewPeriodTabs({ value, onChange }: { value: ViewPeriod; onChange: (period: ViewPeriod) => void }) {
  const tabs: { id: ViewPeriod; label: string; icon: typeof CalendarDays }[] = [
    { id: 'daily', label: 'Harian', icon: CalendarDays },
    { id: 'monthly', label: 'Bulanan', icon: LayoutGrid },
  ];

  return (
    <div className="inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
      {tabs.map((tab) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex h-full items-center gap-1.5 rounded-lg px-3 text-xs font-bold transition',
              active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── StoreCard ──────────────────────────────────────────────────────────────
//
// A store in the browsable directory — click to drill into its detail view.
// Deliberately roomier than the old sidebar row so Ops can scan target +
// roster status for a whole area at a glance.

function StoreCard({ store, onOpen }: { store: StoreRow; onOpen: () => void }) {
  const hasPlan = store.rollup.storeMonthlyTargetId != null;
  const hasIssue = store.rollup.rosterCount === 0;
  const pct = pctOf(store.rollup.storeActualSales, store.rollup.storeMonthlySalesTarget);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition group-hover:bg-indigo-600 group-hover:text-white">
          <Store className="h-4 w-4" />
        </div>
        {hasIssue && (
          <span title="Belum ada karyawan di roster">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{store.name}</p>
        <p className="truncate text-xs text-slate-400">{store.address}</p>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{store.rollup.rosterCount} karyawan</span>
        <span className="font-black tabular-nums text-slate-900">{fmtCurrencyCompact(store.rollup.storeActualSales)}</span>
      </div>

      <div className="space-y-1 border-t border-slate-100 pt-3">
        <PctProgressBar pct={pct} size="md" />
        <p className="text-[10px] text-slate-400">Target {fmtCurrencyCompact(store.rollup.storeMonthlySalesTarget)}/bln</p>
      </div>

      {!hasPlan && (
        <span className="inline-block w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
          Belum ada target
        </span>
      )}
      {hasPlan && !store.rollup.actualsAvailable && (
        <span className="inline-block w-fit rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500">
          Data aktual tidak tersedia
        </span>
      )}
    </button>
  );
}

// ─── AreaSection ────────────────────────────────────────────────────────────

function AreaSection({ areaName, stores, onSelectStore }: {
  areaName: string;
  stores: StoreRow[];
  onSelectStore: (storeId: number) => void;
}) {
  const totals = useMemo(
    () => stores.reduce((acc, s) => acc + s.rollup.storeMonthlySalesTarget, 0),
    [stores],
  );

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{areaName}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{stores.length} toko</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">{fmtCurrencyCompact(totals)}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stores.map((store) => (
          <StoreCard key={store.id} store={store} onOpen={() => onSelectStore(store.id)} />
        ))}
      </div>
    </section>
  );
}

// ─── MonthlyTargetStrip ─────────────────────────────────────────────────────
//
// Secondary now — actual performance is the headline (see HeroMetric above).
// This is a compact, always-editable strip: a summary line by default, an
// inline form when "Ubah" is clicked.

function MonthlyTargetStrip({ storeId, yearMonth, salesTarget, transactionTarget, onSaved }: {
  storeId: number;
  yearMonth: string;
  salesTarget: number;
  transactionTarget: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [salesInput, setSalesInput] = useState(String(salesTarget));
  const [txInput, setTxInput] = useState(String(transactionTarget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setSalesInput(String(salesTarget));
      setTxInput(String(transactionTarget));
    }
  }, [salesTarget, transactionTarget, editing]);

  const days = daysInMonth(yearMonth);
  const atv = Number(txInput) > 0 ? Math.round(Number(salesInput) / Number(txInput)) : 0;
  const dailySales = days > 0 ? Math.round((Number(salesInput) || 0) / days) : 0;
  const dailyTx = days > 0 ? Math.round((Number(txInput) || 0) / days) : 0;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yearMonth,
          monthlySalesTarget: Math.max(0, Math.round(Number(salesInput) || 0)),
          monthlyTransactionTarget: Math.max(0, Math.round(Number(txInput) || 0)),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan target bulanan.');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan target bulanan.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-bold text-slate-500">Target Bulanan</span>
          <span className="font-black tabular-nums text-slate-900">{fmtCurrency(salesTarget)}</span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums text-slate-600">{transactionTarget.toLocaleString('id-ID')} transaksi</span>
          <span className="text-slate-300">·</span>
          <span className="tabular-nums text-slate-500">ATV {fmtCurrency(salesTarget && transactionTarget ? Math.round(salesTarget / transactionTarget) : 0)}</span>
        </div>
        <button type="button" onClick={() => setEditing(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100">
          <Pencil className="h-3.5 w-3.5" /> Ubah
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 p-4">
      <p className="text-sm font-bold text-slate-900">Ubah Target Bulanan</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Target Sales / Bulan
          <div className="relative mt-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">Rp</span>
            <input type="number" value={salesInput} onChange={(e) => setSalesInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Target Transaksi / Bulan
          <input type="number" value={txInput} onChange={(e) => setTxInput(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
        </label>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-white p-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">≈ Sales / hari</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-indigo-600">{fmtCurrency(dailySales)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">≈ Transaksi / hari</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-indigo-600">{dailyTx}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">ATV</p>
          <p className="mt-0.5 text-sm font-bold tabular-nums text-slate-700">{fmtCurrency(atv)}</p>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">÷ {days} hari dalam bulan ini.</p>

      {error && <p className="mt-2 text-xs font-semibold text-red-500">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} disabled={saving}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          Batal
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
          {saving ? 'Menyimpan…' : 'Simpan'}
        </button>
      </div>
    </div>
  );
}

// ─── AddEmployeeTargetForm ─────────────────────────────────────────────────────

function AddEmployeeTargetForm({ storeId, yearMonth, eligible, onCreated, onCancel }: {
  storeId: number;
  yearMonth: string;
  eligible: EligibleEmployee[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const available = eligible.filter((e) => !e.hasTarget);

  const [userId, setUserId] = useState(available[0]?.id ?? '');
  const [targetRoleCode, setTargetRoleCode] = useState('SA');
  const [sortOrder, setSortOrder] = useState('1');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!userId) {
      setError('Pilih karyawan terlebih dahulu.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          yearMonth,
          targetRoleCode,
          sortOrder: targetRoleCode === 'SA' ? Number(sortOrder) || 0 : 0,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menambah karyawan ke roster.');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah karyawan ke roster.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900">Tambah Karyawan ke Roster</p>
        <button type="button" onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {available.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Semua karyawan di toko ini sudah ada di roster bulan ini.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
            Karyawan
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              {available.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.nik})</option>
              ))}
            </select>
          </label>

          <label className="text-xs font-semibold text-slate-600">
            Posisi
            <select value={targetRoleCode} onChange={(e) => setTargetRoleCode(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>

          {targetRoleCode === 'SA' && (
            <label className="text-xs font-semibold text-slate-600 sm:col-span-3">
              Urutan SA (SA1, SA2, ...)
              <input type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
                className="mt-1 w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </label>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-red-500">{error}</p>}

      {available.length > 0 && (
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
            Batal
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Role / Slot badges ─────────────────────────────────────────────────────

const ROLE_BADGE_CLASSES: Record<string, string> = {
  PIC1: 'bg-violet-50 text-violet-600 border-violet-100',
  PIC2: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100',
  SA: 'bg-indigo-50 text-indigo-600 border-indigo-100',
};

function RoleBadge({ role, slotCode }: { role: string; slotCode: string }) {
  const cls = ROLE_BADGE_CLASSES[role] ?? 'bg-slate-50 text-slate-600 border-slate-100';
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', cls)}>{slotCode}</span>;
}

function NotScheduledTodayBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
      <CalendarOff className="h-2.5 w-2.5" /> Libur hari ini
    </span>
  );
}

// ─── EmployeeCalendarModal ──────────────────────────────────────────────────
//
// Timeline view: Ops picks a period (quick presets or a custom date range)
// for one employee and sees which days hit their flat daily target and
// which didn't — a reached/missed tally instead of a plain sales heatmap.

type CalendarDay = { date: string; actualSales: number; actualTransactionCount: number };
type DayStatus = 'reached' | 'missed' | 'future' | 'no-target';

function getDayStatus(day: CalendarDay, dailyTarget: number, today: string): DayStatus {
  if (day.date > today) return 'future';
  if (dailyTarget <= 0) return 'no-target';
  return day.actualSales >= dailyTarget ? 'reached' : 'missed';
}

const DAY_STATUS_STYLES: Record<DayStatus, string> = {
  reached: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  missed: 'border-red-200 bg-red-50 text-red-600',
  future: 'border-slate-100 bg-slate-50 text-slate-300',
  'no-target': 'border-slate-100 bg-slate-50 text-slate-300',
};

function EmployeeCalendarModal({ storeId, targetId, employeeName, yearMonth, dailyTarget, onClose }: {
  storeId: number;
  targetId: number;
  employeeName: string;
  yearMonth: string;
  dailyTarget: number;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(`${yearMonth}-01`);
  const [endDate, setEndDate] = useState(lastDayOfMonthKey(yearMonth));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [totalSales, setTotalSales] = useState(0);

  const today = useMemo(() => todayDateKey(), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ startDate, endDate });
    fetch(`/api/ops/performance-targets/${storeId}/employees/${targetId}/calendar?${params.toString()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error ?? 'Gagal memuat data pencapaian.');
        setAvailable(json.available);
        setDays(json.days ?? []);
        setTotalSales(json.totalSales ?? 0);
        if (!json.available && json.error) setError(json.error);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat data pencapaian.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [storeId, targetId, startDate, endDate]);

  const applyPreset = (preset: 'this_month' | 'last_month' | 'last_30') => {
    if (preset === 'this_month') {
      const ym = dateKeyToYearMonth(today);
      setStartDate(`${ym}-01`);
      setEndDate(lastDayOfMonthKey(ym));
    } else if (preset === 'last_month') {
      const ym = shiftYearMonth(dateKeyToYearMonth(today), -1);
      setStartDate(`${ym}-01`);
      setEndDate(lastDayOfMonthKey(ym));
    } else {
      setStartDate(shiftDateKey(today, -29));
      setEndDate(today);
    }
  };

  const grid = useMemo(() => {
    if (days.length === 0) return [];
    const firstDate = new Date(`${days[0].date}T00:00:00`);
    const firstWeekday = (firstDate.getDay() + 6) % 7;
    const cells: (CalendarDay | null)[] = Array.from({ length: firstWeekday }, () => null);
    cells.push(...days);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [days]);

  const summary = useMemo(() => {
    let reached = 0;
    let missed = 0;
    for (const day of days) {
      const status = getDayStatus(day, dailyTarget, today);
      if (status === 'reached') reached++;
      else if (status === 'missed') missed++;
    }
    const evaluated = reached + missed;
    const rate = evaluated > 0 ? Math.round((reached / evaluated) * 100) : 0;
    return { reached, missed, evaluated, rate };
  }, [days, dailyTarget, today]);

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-500">
              <Calendar className="h-3 w-3" /> Riwayat Pencapaian
            </p>
            <h3 className="mt-0.5 text-base font-bold text-slate-900">{employeeName}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <button type="button" onClick={() => applyPreset('this_month')}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            Bulan Ini
          </button>
          <button type="button" onClick={() => applyPreset('last_month')}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            Bulan Lalu
          </button>
          <button type="button" onClick={() => applyPreset('last_30')}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            30 Hari Terakhir
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            <span className="text-slate-300">–</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Memuat…</div>
          ) : !available ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-xs font-semibold">Data Business Central tidak tersedia{error ? `: ${error}` : '.'}</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs font-semibold text-slate-500">
                {fmtDateShort(startDate)} – {fmtDateShort(endDate)}
              </p>

              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label="Tercapai" value={String(summary.reached)} sub={`dari ${summary.evaluated} hari`} />
                <StatCard label="Tidak Tercapai" value={String(summary.missed)} sub={`dari ${summary.evaluated} hari`} />
                <StatCard label="Tingkat Pencapaian" value={`${summary.rate}%`} />
                <StatCard label="Total Sales" value={fmtCurrencyCompact(totalSales)} />
              </div>

              <div className="mb-2 flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> Tercapai</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-400" /> Tidak tercapai</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-200" /> Belum lewat / tanpa target</span>
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                {grid.map((cell, i) => {
                  if (!cell) return <div key={i} />;
                  const dayNum = Number(cell.date.slice(8, 10));
                  const status = getDayStatus(cell, dailyTarget, today);
                  const statusLabel =
                    status === 'reached' ? 'Tercapai' :
                    status === 'missed' ? 'Tidak tercapai' :
                    status === 'future' ? 'Belum lewat' : 'Tanpa target';
                  return (
                    <div
                      key={cell.date}
                      title={`${cell.date}: ${fmtCurrency(cell.actualSales)} / target ${fmtCurrency(dailyTarget)} — ${statusLabel}`}
                      className={cn('flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border p-1', DAY_STATUS_STYLES[status])}
                    >
                      <span className="text-[11px] font-bold">{dayNum}</span>
                      {status === 'reached' && <CheckCircle2 className="h-3 w-3" />}
                      {status === 'missed' && <XCircle className="h-3 w-3" />}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

// ─── EmployeeTargetTableRow ───────────────────────────────────────────────────
//
// Actual sales / transactions are now the bold, primary numbers; the target
// is the small caption underneath — matching the store-level hero above.

function EmployeeTargetTableRow({ row, storeId, period, yearMonth, onChanged, onDeleted }: {
  row: EmployeeTargetRow;
  storeId: number;
  period: ViewPeriod;
  yearMonth: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const [editingPct, setEditingPct] = useState(false);
  const [pctInput, setPctInput] = useState(String(row.percentage));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const startEdit = () => {
    setPctInput(String(row.percentage));
    setEditingPct(true);
    setError(null);
  };

  const handleSavePct = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percentage: Number(pctInput) || 0 }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan persentase.');
      setEditingPct(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan persentase.');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPct = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetPercentage: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mereset persentase.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mereset persentase.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFromRoster = async () => {
    if (!confirm(`Hapus ${row.name} dari roster target?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menghapus dari roster.');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus dari roster.');
      setSaving(false);
    }
  };

  const salesPct = pctOf(row.actualSales, row.displaySalesTarget);
  const txPct = pctOf(row.actualTransactionCount, row.displayTransactionTarget);
  const notWorkingToday = period === 'daily' && !row.isScheduledToday;

  return (
    <>
      <tr className={cn('border-b border-slate-100 last:border-0 hover:bg-slate-50/60', notWorkingToday && 'opacity-50')}>
        {/* Employee */}
        <td className="min-w-[160px] px-3 py-2.5">
          <p className="truncate text-xs font-bold text-slate-900">{row.name}</p>
          <p className="text-[10px] text-slate-400">NIK {row.nik}</p>
        </td>

        {/* Role / slot */}
        <td className="px-3 py-2.5">
          <div className="flex flex-col items-start gap-1">
            <RoleBadge role={row.targetRoleCode} slotCode={row.slotCode} />
            {notWorkingToday && <NotScheduledTodayBadge />}
          </div>
        </td>

        {/* Sales — actual is the bold number now */}
        <td className="min-w-[130px] px-3 py-2.5">
          <p className="text-sm font-black tabular-nums text-slate-900">{fmtCurrencyCompact(row.actualSales)}</p>
          <p className="text-[10px] tabular-nums text-slate-400">Target {fmtCurrencyCompact(row.displaySalesTarget)}</p>
          <div className="mt-1"><PctProgressBar pct={salesPct} /></div>
        </td>

        {/* Transactions */}
        <td className="min-w-[110px] px-3 py-2.5">
          <p className="text-sm font-black tabular-nums text-slate-900">{row.actualTransactionCount}</p>
          <p className="text-[10px] tabular-nums text-slate-400">Target {row.displayTransactionTarget}</p>
          <div className="mt-1"><PctProgressBar pct={txPct} /></div>
        </td>

        {/* Fixed monthly % share */}
        <td className="min-w-[150px] px-3 py-2.5">
          {editingPct ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={pctInput}
                onChange={(e) => setPctInput(e.target.value)}
                autoFocus
                className="w-16 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-xs font-semibold text-slate-400">%</span>
              <button type="button" onClick={() => setEditingPct(false)} disabled={saving}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50">
                Batal
              </button>
              <button type="button" onClick={handleSavePct} disabled={saving}
                className="rounded-md bg-indigo-600 px-1.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                {saving ? '…' : 'OK'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold tabular-nums text-slate-700">{row.percentage.toFixed(1)}%</span>
              <span className="text-[10px] text-slate-400">· {row.scheduledDays} hari/bln</span>
              {row.isPercentageOverridden && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700" title="Diubah manual">
                  M
                </span>
              )}
              <button type="button" onClick={startEdit}
                className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-indigo-600" title="Ubah persentase bulanan">
                <Pencil className="h-3 w-3" />
              </button>
              {row.isPercentageOverridden && (
                <button type="button" onClick={handleResetPct} disabled={saving}
                  className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-indigo-600" title="Kembalikan ke default">
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-1 text-[10px] font-semibold text-red-500">{error}</p>}
        </td>

        {/* Actions */}
        <td className="px-3 py-2.5">
          <div className="flex justify-end gap-1">
            <button type="button" onClick={() => setShowCalendar(true)} title="Riwayat Pencapaian"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
              <Calendar className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={handleDeleteFromRoster} disabled={saving} title="Hapus dari roster"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-100 bg-white text-red-500 hover:bg-red-50 disabled:opacity-60">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {showCalendar && (
        <EmployeeCalendarModal
          storeId={storeId}
          targetId={row.id}
          employeeName={row.name}
          yearMonth={yearMonth}
          dailyTarget={row.dailySalesTarget}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </>
  );
}

// ─── StoreDetailPanel ─────────────────────────────────────────────────────────

function StoreDetailPanel({ detail, loading, eligible, yearMonth, period, onRefresh }: {
  detail: DetailResponse | null;
  loading: boolean;
  eligible: EligibleEmployee[];
  yearMonth: string;
  period: ViewPeriod;
  onRefresh: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    setNotes(detail?.plan?.notes ?? '');
    setNotesDirty(false);
    setShowAddForm(false);
  }, [detail?.store.id, detail?.plan?.id]);

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-400">Memuat detail target…</p>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-500">
            <Target className="h-6 w-6" />
          </div>
          <p className="font-bold text-slate-700">Pilih toko untuk melihat performa</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
            Klik salah satu toko di daftar kiri untuk melihat sales aktual, transaksi, dan roster karyawannya.
          </p>
        </div>
      </div>
    );
  }

  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      const res = await fetch(`/api/ops/performance-targets/${detail.store.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth, notes }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan catatan.');
      setNotesDirty(false);
      onRefresh();
    } finally {
      setNotesSaving(false);
    }
  };

  const sorted = [...detail.employeeTargets].sort((a, b) => {
    const order = ['PIC1', 'PIC2', 'SA'];
    const ai = order.indexOf(a.targetRoleCode);
    const bi = order.indexOf(b.targetRoleCode);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });

  const storeAtvActual = detail.actuals.storeActualTransactionCount > 0
    ? Math.round(detail.actuals.storeActualSales / detail.actuals.storeActualTransactionCount)
    : 0;

  const periodLabel = period === 'daily' ? 'Hari Ini' : 'Bulan Ini';

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-4 border-b border-slate-100 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
            {detail.store.areaName ?? 'Toko'}
          </p>
          <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900">{detail.store.name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{detail.store.address}</p>
        </div>

        {!detail.actuals.available && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="text-[11px] font-semibold">
              Data aktual dari Business Central tidak tersedia{detail.actuals.error ? `: ${detail.actuals.error}` : '.'}
            </p>
          </div>
        )}

        {detail.rosterMeta?.usedFallbackEqualSplit && detail.rosterMeta.headcount > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="text-[11px] font-semibold">
              Belum ada pola pembagian untuk {detail.rosterMeta.headcount} orang — sementara dibagi rata.
            </p>
          </div>
        )}

        {/* Headline: actual sales & actual transactions */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <HeroMetric
            icon={TrendingUp}
            iconClass="bg-emerald-50 text-emerald-600"
            label={`Sales Aktual · ${periodLabel}`}
            actual={detail.actuals.storeActualSales}
            target={detail.storeDisplaySalesTarget}
            format={fmtCurrency}
          />
          <HeroMetric
            icon={Receipt}
            iconClass="bg-blue-50 text-blue-600"
            label={`Transaksi Aktual · ${periodLabel}`}
            actual={detail.actuals.storeActualTransactionCount}
            target={detail.storeDisplayTransactionTarget}
            format={fmtNumber}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="ATV Aktual" value={fmtCurrency(storeAtvActual)} sub={period === 'daily' ? 'hari ini' : 'bulan ini'} />
          <StatCard label="Karyawan di Roster" value={String(detail.rollup.rosterCount)} sub="Man Power bulan ini" />
        </div>

        <MonthlyTargetStrip
          storeId={detail.store.id}
          yearMonth={yearMonth}
          salesTarget={detail.rollup.storeMonthlySalesTarget}
          transactionTarget={detail.rollup.storeMonthlyTransactionTarget}
          onSaved={onRefresh}
        />
      </div>

      <div className="p-4 sm:p-5">
        <div className="mb-4">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Catatan Plan Bulanan</label>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
            rows={2}
            placeholder="Catatan untuk plan bulan ini…"
            className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          {notesDirty && (
            <div className="mt-1.5 flex justify-end">
              <button type="button" onClick={saveNotes} disabled={notesSaving}
                className="rounded-lg bg-indigo-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                {notesSaving ? 'Menyimpan…' : 'Simpan Catatan'}
              </button>
            </div>
          )}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center text-xs font-bold uppercase tracking-widest text-slate-400">
            <Users className="mr-1.5 h-3.5 w-3.5" /> Karyawan — Aktual vs Target
          </h3>
          <button type="button" onClick={() => setShowAddForm((v) => !v)}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500">
            <Plus className="h-3 w-3" /> Tambah
          </button>
        </div>

        {showAddForm && (
          <div className="mb-3">
            <AddEmployeeTargetForm
              storeId={detail.store.id}
              yearMonth={yearMonth}
              eligible={eligible}
              onCreated={() => { setShowAddForm(false); onRefresh(); }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
            Belum ada karyawan di roster target bulan ini. Klik &quot;Tambah&quot; untuk mulai.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                    <th className="px-3 py-2.5 text-left">Karyawan</th>
                    <th className="px-3 py-2.5 text-left">Slot</th>
                    <th className="px-3 py-2.5 text-left">Sales Aktual</th>
                    <th className="px-3 py-2.5 text-left">Transaksi Aktual</th>
                    <th className="px-3 py-2.5 text-left">Porsi Bulanan</th>
                    <th className="px-3 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => (
                    <EmployeeTargetTableRow
                      key={row.id}
                      row={row}
                      storeId={detail.store.id}
                      period={period}
                      yearMonth={yearMonth}
                      onChanged={onRefresh}
                      onDeleted={onRefresh}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PerformanceTargetsPage() {
  const [dateKey, setDateKey] = useState(todayDateKey());
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('monthly');
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [eligible, setEligible] = useState<EligibleEmployee[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearMonth = useMemo(() => dateKeyToYearMonth(dateKey), [dateKey]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets?yearMonth=${yearMonth}`, { cache: 'no-store' });
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat data target.');
      setOverview(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data target.');
      setOverview(null);
    } finally {
      setLoadingOverview(false);
    }
  }, [yearMonth]);

  const loadDetail = useCallback(async (storeId: number) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const params = new URLSearchParams({ yearMonth, period: viewPeriod });
      if (viewPeriod === 'daily') params.set('date', dateKey);

      const [detailRes, eligibleRes] = await Promise.all([
        fetch(`/api/ops/performance-targets/${storeId}?${params.toString()}`, { cache: 'no-store' }),
        fetch(`/api/ops/performance-targets/${storeId}/employees?yearMonth=${yearMonth}`, { cache: 'no-store' }),
      ]);
      const detailJson = (await detailRes.json()) as DetailResponse;
      const eligibleJson = await eligibleRes.json();
      if (!detailRes.ok || !detailJson.success) throw new Error(detailJson.error ?? 'Gagal memuat detail toko.');
      setDetail(detailJson);
      setEligible(eligibleJson.success ? eligibleJson.employees : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat detail toko.');
      setDetail(null);
      setEligible([]);
    } finally {
      setLoadingDetail(false);
    }
  }, [yearMonth, viewPeriod, dateKey]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (selectedStoreId != null) void loadDetail(selectedStoreId);
    else setDetail(null);
  }, [selectedStoreId, loadDetail]);

  useEffect(() => { setSelectedStoreId(null); }, [yearMonth]);

  const handleSelectStore = (storeId: number) => {
    setSelectedStoreId(storeId);
  };

  const handleBackToList = () => {
    setSelectedStoreId(null);
  };

  const handleRefresh = useCallback(() => {
    void loadOverview();
    if (selectedStoreId != null) void loadDetail(selectedStoreId);
  }, [loadOverview, loadDetail, selectedStoreId]);

  const isHo = overview?.scope === 'all_areas';

  const filteredStores = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overview?.stores ?? [];
    return (overview?.stores ?? []).filter((s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
  }, [overview?.stores, search]);

  const groupedStores = useMemo(() => {
    const groups = new Map<string, StoreRow[]>();
    for (const store of filteredStores) {
      const key = store.areaName?.trim() || 'Tanpa Area';
      const cur = groups.get(key);
      if (cur) cur.push(store);
      else groups.set(key, [store]);
    }
    return Array.from(groups.entries())
      .map(([areaName, rows]) => ({ areaName, stores: rows.sort((a, b) => a.name.localeCompare(b.name)) }))
      .sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [filteredStores]);

  const headingScope = isHo ? 'Semua Area' : (overview?.stores[0]?.areaName ?? 'Area Anda');

  const periodLabel = viewPeriod === 'daily' ? fmtDateLabel(dateKey) : fmtMonthLabel(yearMonth);

  const showingDetail = selectedStoreId != null;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Operations"
        title="Performance Targets"
        subtitle={`${headingScope} · ${periodLabel}`}
        periodProps={{
          date: dateKey,
          onDateChange: setDateKey,
        }}
        onRefresh={handleRefresh}
        refreshing={loadingOverview || loadingDetail}
        actions={<ViewPeriodTabs value={viewPeriod} onChange={setViewPeriod} />}
      />

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Gagal memuat data</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        {showingDetail ? (
          <div className="space-y-4">
            <button type="button" onClick={handleBackToList}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50">
              <ChevronLeft className="h-3.5 w-3.5" /> Kembali ke daftar toko
            </button>

            <StoreDetailPanel
              detail={detail}
              loading={loadingDetail}
              eligible={eligible}
              yearMonth={yearMonth}
              period={viewPeriod}
              onRefresh={handleRefresh}
            />
          </div>
        ) : (
          <div className="space-y-5">
            {overview && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <IconStat icon={Store} iconClass="bg-slate-100 text-slate-500" label="Total Toko" value={String(overview.summary.storeCount)} />
                <IconStat
                  icon={Target}
                  iconClass="bg-emerald-50 text-emerald-600"
                  label="Sudah Isi Target"
                  value={`${overview.summary.plannedStoreCount}/${overview.summary.storeCount}`}
                />
                <IconStat icon={ShoppingBag} iconClass="bg-indigo-50 text-indigo-600" label="Total Target Sales" value={fmtCurrencyCompact(overview.summary.storeMonthlySalesTarget)} sub="bulanan, semua toko" />
                <IconStat icon={Receipt} iconClass="bg-blue-50 text-blue-600" label="Total Target Transaksi" value={String(overview.summary.storeMonthlyTransactionTarget)} sub="bulanan, semua toko" />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="relative block w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari toko…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{filteredStores.length} toko</p>
            </div>

            {loadingOverview ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-100" />
                ))}
              </div>
            ) : filteredStores.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
                <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
                <p className="mt-1 text-xs text-slate-400">Coba ubah kata kunci pencarian.</p>
              </div>
            ) : isHo ? (
              <div className="space-y-6">
                {groupedStores.map((group) => (
                  <AreaSection key={group.areaName} areaName={group.areaName} stores={group.stores} onSelectStore={handleSelectStore} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredStores.map((store) => (
                  <StoreCard key={store.id} store={store} onOpen={() => handleSelectStore(store.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
