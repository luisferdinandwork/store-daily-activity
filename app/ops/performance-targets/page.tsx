'use client';
// app/ops/performance-targets/page.tsx
//
// Employee Performance Target management — daily-allocation model.
//
//   - Ops sets ONE monthly sales + transaction target per store.
//   - That monthly target is divided by days-in-month into a daily store
//     target.
//   - Each day, whoever is actually scheduled to work is split into slots
//     (PIC1, PIC2, SA1, SA2, ...) and the daily target is shared out using
//     a % template keyed by headcount ("Man Power").
//   - Ops can override one employee's % for one specific day; everyone else
//     scheduled that day automatically rebalances around it.
//
//   - OPS HO sees all areas/stores (grouped by area, switchable).
//   - OPS Area sees only stores within their assigned area.
//
// Design pass: same data/handlers as before, presentation reworked for a
// first-time user — plain-language explainer, a monthly editor that shows
// its own math, and employee rows as single-column cards instead of a
// horizontally-scrolling table (which was rough on tablets/phones, and the
// primary retail-ops surface here).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Info,
  LayoutGrid,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Target,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types (unchanged) ─────────────────────────────────────────────────────────

type ViewPeriod = 'daily' | 'monthly';

type StoreRollup = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;
  rosterCount: number;
};

type StoreRow = {
  id: number;
  storeNo: string;
  name: string;
  address: string;
  areaId: number | null;
  areaName: string | null;
  rollup: StoreRollup;
  isLocked: boolean;
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
  isLocked: boolean;
  notes: string | null;
};

type EmployeeTargetRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  targetRoleCode: string;          // PIC1 | PIC2 | SA
  slotCode: string | null;          // PIC1 | PIC2 | SA1... — daily view only
  defaultPct: number | null;
  effectivePct: number | null;
  isOverridden: boolean;
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
  dailyMeta: { headcount: number; usedFallbackEqualSplit: boolean } | null;
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

// ─── Date helpers (unchanged) ──────────────────────────────────────────────────

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

// ─── Format helpers (unchanged) ────────────────────────────────────────────────

function fmtCurrency(value: number): string {
  return `Rp ${Math.round(value).toLocaleString('id-ID')}`;
}

function fmtCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000_000) return `Rp ${(value / 1_000_000).toFixed(1)}jt`;
  if (Math.abs(value) >= 1_000) return `Rp ${(value / 1_000).toFixed(0)}rb`;
  return fmtCurrency(value);
}

function pctOf(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.round((actual / target) * 100);
}

const ROLE_OPTIONS = ['PIC1', 'PIC2', 'SA'];

// ─── Shared atoms ───────────────────────────────────────────────────────────

/** Plain text stat — used for compact, secondary numbers. */
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/** Icon-led headline stat — used for the top summary strip, where a beginner lands first. */
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

function PlanStatusPill({ hasPlan, isLocked }: { hasPlan: boolean; isLocked: boolean }) {
  if (!hasPlan) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
        Belum ada target
      </span>
    );
  }
  if (isLocked) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
        <Lock className="h-2.5 w-2.5" /> Terkunci
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
      <LockOpen className="h-2.5 w-2.5" /> Terbuka
    </span>
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

// ─── HowThisWorksCallout ────────────────────────────────────────────────────────
//
// Collapsed by default so it doesn't clutter the view for people who already
// know the model — but it's the very first thing a beginner sees when they
// open it, in plain steps instead of jargon.

function HowThisWorksCallout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-indigo-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <span className="flex-1 text-sm font-bold text-indigo-900">Baru di sini? Lihat cara kerja target ini</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-indigo-400 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ol className="space-y-2.5 border-t border-indigo-100 bg-white px-4 py-4">
          {[
            'Isi target sales & transaksi untuk SATU BULAN di toko yang dipilih.',
            'Sistem membaginya rata ke setiap hari dalam bulan itu — jadi ada "target harian" toko.',
            'Setiap hari, target harian itu dibagi ke karyawan yang jadwal kerja hari itu. Porsinya tergantung berapa orang yang masuk & posisi mereka (PIC1, PIC2, SA1, SA2, ...).',
            'Butuh kasih porsi lebih ke satu orang di hari tertentu? Ubah persennya — porsi karyawan lain di hari itu otomatis menyesuaikan supaya totalnya tetap 100%.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3 text-xs text-slate-600">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">
                {i + 1}
              </span>
              <span className="leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── StoreListItem ────────────────────────────────────────────────────────────

function StoreListItem({ store, active, onOpen }: { store: StoreRow; active: boolean; onOpen: () => void }) {
  const hasPlan = store.rollup.storeMonthlyTargetId != null;
  const hasIssue = store.rollup.rosterCount === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 border-l-[3px] px-4 py-3.5 text-left transition hover:bg-slate-50',
        active ? 'border-l-indigo-600 bg-indigo-50/70' : 'border-l-transparent',
      )}
    >
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500',
      )}>
        <Store className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
          {hasIssue && (
            <span title="Belum ada karyawan di roster">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {store.rollup.rosterCount} karyawan ·{' '}
          <span className="font-semibold text-slate-500">{fmtCurrencyCompact(store.rollup.storeMonthlySalesTarget)}</span>
        </p>
        <div className="mt-1.5">
          <PlanStatusPill hasPlan={hasPlan} isLocked={store.isLocked} />
        </div>
      </div>
      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// ─── AreaStoreGroup ───────────────────────────────────────────────────────────

function AreaStoreGroup({ areaName, stores, selectedStoreId, initiallyOpen, onSelectStore }: {
  areaName: string;
  stores: StoreRow[];
  selectedStoreId: number | null;
  initiallyOpen: boolean;
  onSelectStore: (storeId: number) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  const totals = useMemo(
    () => stores.reduce((acc, s) => ({
      sales: acc.sales + s.rollup.storeMonthlySalesTarget,
      employees: acc.employees + s.rollup.rosterCount,
    }), { sales: 0, employees: 0 }),
    [stores],
  );

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-slate-50 px-4 py-2 text-left transition hover:bg-slate-100"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition-transform', !open && '-rotate-90')} />
        <p className="flex-1 text-[11px] font-bold uppercase tracking-widest text-slate-500">{areaName}</p>
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500">
          {fmtCurrencyCompact(totals.sales)}
        </span>
        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{stores.length}</span>
      </button>

      {open && (
        <div className="divide-y divide-slate-100 bg-white">
          {stores.map((store) => (
            <StoreListItem key={store.id} store={store} active={selectedStoreId === store.id} onOpen={() => onSelectStore(store.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MonthlyTargetEditor ──────────────────────────────────────────────────────
//
// The ONE number everything else divides down from — so this gets the most
// prominent, most explained treatment on the page. While editing, it shows
// its own math live ("= Rp X / hari") so the connection to the daily/employee
// numbers below is never a mystery.

function MonthlyTargetEditor({ storeId, yearMonth, salesTarget, transactionTarget, isLocked, onSaved }: {
  storeId: number;
  yearMonth: string;
  salesTarget: number;
  transactionTarget: number;
  isLocked: boolean;
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
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-indigo-50/70 to-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Target Bulanan Toko</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{fmtCurrency(salesTarget)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {transactionTarget.toLocaleString('id-ID')} transaksi · ATV {fmtCurrency(atv)}
            </p>
          </div>
          {!isLocked && (
            <button type="button" onClick={() => setEditing(true)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50">
              <Pencil className="h-3.5 w-3.5" /> Ubah
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1.5 border-t border-indigo-100 pt-3 text-[11px] text-slate-500">
          <Info className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          <span>
            Ini dibagi otomatis jadi <span className="font-semibold text-slate-700">{fmtCurrency(salesTarget / Math.max(days, 1))} / hari</span> ({days} hari), lalu dibagi lagi ke karyawan yang jadwal kerja hari itu.
          </span>
        </div>
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

      {/* Live math — the whole point is making this connection obvious. */}
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
      <p className="mt-2 text-[11px] text-slate-500">÷ {days} hari dalam bulan ini. Angka harian ini yang nanti dibagi ke karyawan.</p>

      {error && <p className="mt-2 text-xs font-semibold text-red-500">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={() => setEditing(false)} disabled={saving}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
          Batal
        </button>
        <button type="button" onClick={handleSave} disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
          {saving ? 'Menyimpan…' : 'Simpan Target Bulanan'}
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
        <>
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
                Urutan SA — dipakai saat beberapa SA masuk di hari yang sama (jadi SA1, SA2, ...)
                <input type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}
                  className="mt-1 w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </label>
            )}
          </div>

          <p className="mt-3 flex items-start gap-1.5 text-[11px] text-slate-500">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
            Target sales/transaksi tidak diisi manual di sini — dihitung otomatis tiap hari dari target toko, dibagi sesuai jumlah karyawan yang jadwal hari itu.
          </p>
        </>
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

// ─── Role / Slot badges + legend ───────────────────────────────────────────────

const ROLE_BADGE_CLASSES: Record<string, string> = {
  PIC1: 'bg-violet-50 text-violet-600 border-violet-100',
  PIC2: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100',
  SA: 'bg-indigo-50 text-indigo-600 border-indigo-100',
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_BADGE_CLASSES[role] ?? 'bg-slate-50 text-slate-600 border-slate-100';
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', cls)}>{role}</span>;
}

function SlotBadge({ slotCode }: { slotCode: string | null }) {
  if (!slotCode) {
    return (
      <span className="flex items-center gap-1 rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
        <CalendarOff className="h-2.5 w-2.5" /> Libur hari ini
      </span>
    );
  }
  const base = slotCode.startsWith('PIC') ? ROLE_BADGE_CLASSES[slotCode] : ROLE_BADGE_CLASSES.SA;
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', base)}>Slot {slotCode}</span>;
}

/** Click-to-toggle legend explaining PIC1/PIC2/SA1.. — a tooltip would be invisible on touch devices, so this is a small disclosure instead. */
function SlotLegend() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title="Apa itu PIC1 / SA1?"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-6 z-20 w-64 rounded-xl border border-slate-200 bg-white p-3 text-left text-[11px] normal-case tracking-normal text-slate-600 shadow-lg">
            <p><span className="font-bold text-violet-600">PIC1 / PIC2</span> — penanggung jawab toko, porsinya tetap.</p>
            <p className="mt-1.5"><span className="font-bold text-indigo-600">SA1, SA2, ...</span> — staf penjualan, urutan otomatis dari yang jadwal hari itu. Kalau salah satu libur, yang lain naik urutan.</p>
          </div>
        </>
      )}
    </span>
  );
}

// ─── EmployeeCalendarModal (unchanged) ────────────────────────────────────────

type CalendarDay = { date: string; actualSales: number; actualTransactionCount: number };

function EmployeeCalendarModal({ storeId, targetId, employeeName, yearMonth, onClose }: {
  storeId: number;
  targetId: number;
  employeeName: string;
  yearMonth: string;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(yearMonth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [totalSales, setTotalSales] = useState(0);
  const [totalTransactionCount, setTotalTransactionCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/ops/performance-targets/${storeId}/employees/${targetId}/calendar?yearMonth=${month}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error ?? 'Gagal memuat data kalender.');
        setAvailable(json.available);
        setDays(json.days ?? []);
        setTotalSales(json.totalSales ?? 0);
        setTotalTransactionCount(json.totalTransactionCount ?? 0);
        if (!json.available && json.error) setError(json.error);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Gagal memuat data kalender.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [storeId, targetId, month]);

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
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

  const maxSales = useMemo(() => Math.max(1, ...days.map((d) => d.actualSales)), [days]);

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4">
          <div>
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-indigo-500">
              <Calendar className="h-3 w-3" /> Kalender Sales
            </p>
            <h3 className="mt-0.5 text-base font-bold text-slate-900">{employeeName}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-2">
          <button type="button" onClick={() => shiftMonth(-1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="text-sm font-bold text-slate-700">{fmtMonthLabel(month)}</p>
          <button type="button" onClick={() => shiftMonth(1)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <ChevronRight className="h-4 w-4" />
          </button>
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
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <StatCard label="Total Sales" value={fmtCurrency(totalSales)} sub={fmtMonthLabel(month)} />
                <StatCard label="Total Transaksi" value={String(totalTransactionCount)} sub={fmtMonthLabel(month)} />
                <StatCard
                  label="Rata-rata Harian"
                  value={fmtCurrency(days.length ? totalSales / days.length : 0)}
                  sub={`${days.length} hari`}
                />
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                {grid.map((cell, i) => {
                  if (!cell) return <div key={i} />;
                  const dayNum = Number(cell.date.slice(8, 10));
                  const intensity = cell.actualSales > 0 ? Math.max(0.12, cell.actualSales / maxSales) : 0;
                  return (
                    <div
                      key={cell.date}
                      title={`${cell.date}: ${fmtCurrency(cell.actualSales)} (${cell.actualTransactionCount} trx)`}
                      className="flex aspect-square flex-col items-center justify-center rounded-lg border border-slate-100 p-1"
                      style={cell.actualSales > 0 ? { backgroundColor: `rgba(99, 102, 241, ${intensity})` } : undefined}
                    >
                      <span className={cn('text-[11px] font-bold', cell.actualSales > 0 && intensity > 0.5 ? 'text-white' : 'text-slate-500')}>
                        {dayNum}
                      </span>
                      {cell.actualSales > 0 && (
                        <span className={cn('text-[8px] font-semibold leading-tight', intensity > 0.5 ? 'text-white' : 'text-indigo-600')}>
                          {fmtCurrencyCompact(cell.actualSales)}
                        </span>
                      )}
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

// ─── MiniMetric — one "target vs actual" block inside an employee card ────────

function MiniMetric({ icon: Icon, label, target, actual, formatValue, pct }: {
  icon: React.ElementType;
  label: string;
  target: number;
  actual: number;
  formatValue: (n: number) => string;
  pct: number;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="flex items-center gap-1.5 text-slate-400">
        <Icon className="h-3 w-3" />
        <p className="text-[10px] font-bold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-1.5 text-sm font-bold tabular-nums text-slate-900">{formatValue(target)}</p>
      <p className="text-[11px] tabular-nums text-slate-400">Aktual {formatValue(actual)}</p>
      <div className="mt-1.5"><PctProgressBar pct={pct} /></div>
    </div>
  );
}

// ─── EmployeeTargetCard ─────────────────────────────────────────────────────────
//
// Replaces the old table row. A single-column card list scans top-to-bottom
// on any screen size (no horizontal scroll needed on a tablet/phone), and
// groups "who/what slot" — "target vs actual" — "today's %" — "actions"
// into clearly separated zones instead of one dense row of tiny cells.

function EmployeeTargetCard({ row, storeId, period, yearMonth, date, locked, onDailyChange, onDeleted }: {
  row: EmployeeTargetRow;
  storeId: number;
  period: ViewPeriod;
  yearMonth: string;
  date: string;
  locked: boolean;
  onDailyChange: () => void;
  onDeleted: () => void;
}) {
  const [editingPct, setEditingPct] = useState(false);
  const [pctInput, setPctInput] = useState(String(row.effectivePct ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const startEdit = () => {
    setPctInput(String(row.effectivePct ?? 0));
    setEditingPct(true);
    setError(null);
  };

  const handleSavePct = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/daily-overrides`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, yearMonth, userId: row.userId, percentage: Number(pctInput) || 0 }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan persentase.');
      setEditingPct(false);
      onDailyChange();
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
      const res = await fetch(`/api/ops/performance-targets/${storeId}/daily-overrides`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, yearMonth, userId: row.userId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mereset persentase.');
      onDailyChange();
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
  const atv = row.displayTransactionTarget > 0 ? Math.round(row.displaySalesTarget / row.displayTransactionTarget) : 0;
  const canEditPct = period === 'daily' && !locked && row.isScheduledToday;
  const notWorkingToday = period === 'daily' && !row.isScheduledToday;

  return (
    <div className={cn(
      'rounded-2xl border border-slate-200 bg-white p-4 transition',
      notWorkingToday && 'opacity-60',
    )}>
      {/* Who + role/slot */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{row.name}</p>
          <p className="text-[11px] text-slate-400">NIK {row.nik}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RoleBadge role={row.targetRoleCode} />
          {period === 'daily' && <SlotBadge slotCode={row.slotCode} />}
        </div>
      </div>

      {/* Target vs actual */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniMetric
          icon={ShoppingBag}
          label={`Sales${period === 'daily' ? ' (Harian)' : ' (Bulanan)'}`}
          target={row.displaySalesTarget}
          actual={row.actualSales}
          formatValue={fmtCurrency}
          pct={salesPct}
        />
        <MiniMetric
          icon={Receipt}
          label={`Transaksi${period === 'daily' ? ' (Harian)' : ' (Bulanan)'}`}
          target={row.displayTransactionTarget}
          actual={row.actualTransactionCount}
          formatValue={(n) => String(n)}
          pct={txPct}
        />
      </div>

      {/* ATV + today's % */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-slate-500">
          <Wallet className="h-3.5 w-3.5" />
          <span className="text-xs font-semibold">ATV {fmtCurrency(atv)}</span>
        </div>

        {period === 'daily' && (
          editingPct ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={pctInput}
                onChange={(e) => setPctInput(e.target.value)}
                autoFocus
                className="w-20 rounded-lg border border-indigo-300 bg-white px-2 py-1 text-right text-xs tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
              <span className="text-xs font-semibold text-slate-400">%</span>
              <button type="button" onClick={() => setEditingPct(false)} disabled={saving}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50">
                Batal
              </button>
              <button type="button" onClick={handleSavePct} disabled={saving}
                className="rounded-md bg-indigo-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                {saving ? '…' : 'Simpan'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {row.isOverridden && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                  Diubah manual
                </span>
              )}
              <span className="text-xs font-bold tabular-nums text-slate-700">
                {row.isScheduledToday ? `Porsi ${(row.effectivePct ?? 0).toFixed(1)}%` : 'Tidak jadwal'}
              </span>
              {canEditPct && (
                <button type="button" onClick={startEdit}
                  className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-indigo-600" title="Ubah porsi hari ini">
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              {canEditPct && row.isOverridden && (
                <button type="button" onClick={handleResetPct} disabled={saving}
                  className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-indigo-600" title="Kembalikan ke default">
                  <RotateCcw className="h-3 w-3" />
                </button>
              )}
            </div>
          )
        )}
      </div>

      {editingPct && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          Sisa persennya otomatis dibagi ke karyawan lain yang jadwal hari ini.
        </p>
      )}

      {error && <p className="mt-2 text-xs font-semibold text-red-500">{error}</p>}

      {/* Actions */}
      {!locked && (
        <div className="mt-3 flex justify-end gap-1.5">
          <button type="button" onClick={() => setShowCalendar(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            <Calendar className="h-3 w-3" /> Kalender
          </button>
          <button type="button" onClick={handleDeleteFromRoster} disabled={saving}
            className="flex items-center gap-1.5 rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-[11px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-60">
            <Trash2 className="h-3 w-3" /> Hapus
          </button>
        </div>
      )}

      {showCalendar && (
        <EmployeeCalendarModal
          storeId={storeId}
          targetId={row.id}
          employeeName={row.name}
          yearMonth={yearMonth}
          onClose={() => setShowCalendar(false)}
        />
      )}
    </div>
  );
}

// ─── StoreDetailPanel ─────────────────────────────────────────────────────────

function StoreDetailPanel({ detail, loading, eligible, yearMonth, period, dateKey, onRefresh }: {
  detail: DetailResponse | null;
  loading: boolean;
  eligible: EligibleEmployee[];
  yearMonth: string;
  period: ViewPeriod;
  dateKey: string;
  onRefresh: () => void;
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [lockSaving, setLockSaving] = useState(false);
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
          <p className="font-bold text-slate-700">Pilih toko untuk mulai atur target</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-slate-400">
            Klik salah satu toko di daftar kiri. Dari sini kamu bisa isi target bulanan, atur roster karyawan, dan lihat pencapaian.
          </p>
        </div>
      </div>
    );
  }

  const isLocked = detail.plan?.isLocked ?? false;

  const toggleLock = async () => {
    setLockSaving(true);
    try {
      const res = await fetch(`/api/ops/performance-targets/${detail.store.id}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth, isLocked: !isLocked }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal mengubah status lock.');
      onRefresh();
    } catch {
      // surfaced via onRefresh re-fetch error state
    } finally {
      setLockSaving(false);
    }
  };

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

  const storeSalesPct = pctOf(detail.actuals.storeActualSales, detail.storeDisplaySalesTarget);
  const storeTxPct = pctOf(detail.actuals.storeActualTransactionCount, detail.storeDisplayTransactionTarget);
  const storeAtvActual = detail.actuals.storeActualTransactionCount > 0
    ? Math.round(detail.actuals.storeActualSales / detail.actuals.storeActualTransactionCount)
    : 0;

  return (
    <div className="space-y-4">
      <HowThisWorksCallout />

      <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 space-y-4 border-b border-slate-100 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">
                {detail.store.areaName ?? 'Toko'}
              </p>
              <h2 className="mt-0.5 truncate text-lg font-bold text-slate-900">{detail.store.name}</h2>
              <p className="mt-0.5 text-xs text-slate-500">{detail.store.address}</p>
            </div>
            <button type="button" onClick={toggleLock} disabled={lockSaving}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-60',
                isLocked
                  ? 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
              )}
            >
              {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
              {isLocked ? 'Terkunci' : 'Terbuka'}
            </button>
          </div>

          {!detail.actuals.available && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-[11px] font-semibold">
                Data aktual dari Business Central tidak tersedia{detail.actuals.error ? `: ${detail.actuals.error}` : '.'}
              </p>
            </div>
          )}

          {period === 'daily' && detail.dailyMeta?.usedFallbackEqualSplit && detail.dailyMeta.headcount > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-[11px] font-semibold">
                Belum ada pola pembagian untuk {detail.dailyMeta.headcount} orang — sementara dibagi rata. Minta admin tambahkan pola ini supaya sesuai grid PIC1/PIC2/SA.
              </p>
            </div>
          )}

          <MonthlyTargetEditor
            storeId={detail.store.id}
            yearMonth={yearMonth}
            salesTarget={detail.rollup.storeMonthlySalesTarget}
            transactionTarget={detail.rollup.storeMonthlyTransactionTarget}
            isLocked={isLocked}
            onSaved={onRefresh}
          />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Sales {period === 'daily' ? '(Hari Ini)' : '(Bulan Ini)'}
              </p>
              <p className="mt-0.5 text-sm font-black text-slate-900">{fmtCurrency(detail.storeDisplaySalesTarget)}</p>
              <p className="text-[11px] text-slate-400">Aktual {fmtCurrency(detail.actuals.storeActualSales)}</p>
              <div className="mt-1"><PctProgressBar pct={storeSalesPct} /></div>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Transaksi {period === 'daily' ? '(Hari Ini)' : '(Bulan Ini)'}
              </p>
              <p className="mt-0.5 text-sm font-black text-slate-900">{detail.storeDisplayTransactionTarget}</p>
              <p className="text-[11px] text-slate-400">Aktual {detail.actuals.storeActualTransactionCount}</p>
              <div className="mt-1"><PctProgressBar pct={storeTxPct} /></div>
            </div>
            <StatCard label="ATV Aktual" value={fmtCurrency(storeAtvActual)} sub={period === 'daily' ? 'hari ini' : 'bulan ini'} />
            <StatCard
              label={period === 'daily' ? 'Jadwal Hari Ini' : 'Karyawan di Roster'}
              value={period === 'daily' ? String(detail.dailyMeta?.headcount ?? 0) : String(detail.rollup.rosterCount)}
              sub={period === 'daily' ? 'orang bekerja' : 'total roster'}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Catatan Plan Bulanan</label>
            <textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
              rows={2}
              disabled={isLocked}
              placeholder="Catatan untuk plan bulan ini…"
              className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60"
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
              <Users className="mr-1.5 h-3.5 w-3.5" /> Target vs Aktual Karyawan
              {period === 'daily' && <SlotLegend />}
            </h3>
            {!isLocked && (
              <button type="button" onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-indigo-500">
                <Plus className="h-3 w-3" /> Tambah
              </button>
            )}
          </div>

          {showAddForm && !isLocked && (
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
            <div className="space-y-3">
              {sorted.map((row) => (
                <EmployeeTargetCard
                  key={row.id}
                  row={row}
                  storeId={detail.store.id}
                  period={period}
                  yearMonth={yearMonth}
                  date={dateKey}
                  locked={isLocked}
                  onDailyChange={onRefresh}
                  onDeleted={onRefresh}
                />
              ))}
            </div>
          )}
        </div>
      </article>
    </div>
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
    setSelectedStoreId((cur) => (cur === storeId ? null : storeId));
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

  return (
    <div className="min-h-full bg-slate-50">
      {/* Header — unchanged, as requested. */}
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

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        {error && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-sm font-bold">Gagal memuat data</p>
              <p className="mt-0.5 text-xs">{error}</p>
            </div>
          </div>
        )}

        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <IconStat icon={Store} iconClass="bg-slate-100 text-slate-500" label="Total Toko" value={String(overview.summary.storeCount)} />
            <IconStat
              icon={Target}
              iconClass="bg-emerald-50 text-emerald-600"
              label="Sudah Isi Target"
              value={`${overview.summary.plannedStoreCount}/${overview.summary.storeCount}`}
              sub="toko dengan target bulanan"
            />
            <IconStat icon={ShoppingBag} iconClass="bg-indigo-50 text-indigo-600" label="Total Target Sales" value={fmtCurrencyCompact(overview.summary.storeMonthlySalesTarget)} sub="bulanan, semua toko" />
            <IconStat icon={Receipt} iconClass="bg-blue-50 text-blue-600" label="Total Target Transaksi" value={String(overview.summary.storeMonthlyTransactionTarget)} sub="bulanan, semua toko" />
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
          <aside className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[6.5rem]">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari toko…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>

            <div className="flex shrink-0 items-center border-b border-slate-100 px-4 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{filteredStores.length} toko</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingOverview
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="border-b border-slate-100 px-4 py-3">
                      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                    </div>
                  ))
                : filteredStores.length === 0
                  ? (
                    <div className="p-8 text-center">
                      <p className="text-sm font-semibold text-slate-700">Tidak ada toko</p>
                      <p className="mt-1 text-xs text-slate-400">Coba ubah kata kunci pencarian.</p>
                    </div>
                  )
                  : isHo
                    ? groupedStores.map((group) => (
                        <AreaStoreGroup
                          key={group.areaName}
                          areaName={group.areaName}
                          stores={group.stores}
                          selectedStoreId={selectedStoreId}
                          initiallyOpen
                          onSelectStore={handleSelectStore}
                        />
                      ))
                    : (
                      <div className="divide-y divide-slate-100">
                        {filteredStores.map((store) => (
                          <StoreListItem key={store.id} store={store} active={selectedStoreId === store.id} onOpen={() => handleSelectStore(store.id)} />
                        ))}
                      </div>
                    )
              }
            </div>
          </aside>

          <div className="lg:sticky lg:top-[6.5rem]">
            <StoreDetailPanel
              detail={detail}
              loading={loadingDetail}
              eligible={eligible}
              yearMonth={yearMonth}
              period={viewPeriod}
              dateKey={dateKey}
              onRefresh={handleRefresh}
            />
          </div>
        </div>
      </div>
    </div>
  );
}