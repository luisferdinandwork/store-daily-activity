'use client';
// app/ops/performance-targets/page.tsx
//
// Employee Performance Target management.
//
//   - OPS HO sees all areas/stores (grouped by area, switchable).
//   - OPS Area sees only stores within their assigned area.
//
// Layout:
//   - OpsPageHeader's RangeNavigator is reused for date selection
//     (periodProps without onPeriodChange, so only the date picker renders —
//     the Daily/Monthly toggle below is page-owned since OpsPageHeader's
//     built-in tabs include "Weekly", which doesn't apply here).
//   - Left: a sticky list of stores grouped by area (HO) or a flat list
//     (Area Ops), card-style — same shape as the progress page's store list.
//   - Right: sticky detail panel for the selected store's monthly target
//     plan, with per-employee targets rendered as a TABLE comparing target
//     vs actual (from Business Central) with a percentage progress bar to
//     100%. ATV is always derived (sales / transactions), never stored.
//     Sourced from lib/performance/target-utils.ts +
//     lib/performance/employee-actuals.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  Store,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';

// ─── Types ────────────────────────────────────────────────────────────────────

type ViewPeriod = 'daily' | 'monthly';

type StoreRollup = {
  storeMonthlyTargetId: number | null;
  storeId: number;
  yearMonth: string;
  storeMonthlySalesTarget: number;
  storeMonthlyTransactionTarget: number;
  storeMonthlyAtvTarget: number;
  employeeTargetCount: number;
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
    employeeTargetCount: number;
    storeCount: number;
    plannedStoreCount: number;
  };
  stores: StoreRow[];
};

type PlanRow = {
  id: number;
  storeId: number;
  yearMonth: string;
  isLocked: boolean;
  notes: string | null;
};

type EmployeeTargetRow = {
  id: number;
  userId: string;
  nik: string;
  name: string;
  storeId: number;
  storeNo: string;
  storeName: string;
  yearMonth: string;
  targetRoleCode: string;
  targetWeightPct: number;
  monthlySalesTarget: number;
  monthlyTransactionTarget: number;
  /** Always derived: monthlySalesTarget / monthlyTransactionTarget. */
  monthlyAtvTarget: number;
  isActive: boolean;

  // ── Added by the detail API for the selected period ──
  actualSales: number;
  actualTransactionCount: number;
  /** Target for the selected period (= monthly target, or monthly/scheduledDays for daily). */
  displaySalesTarget: number;
  displayTransactionTarget: number;
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
  rollup: StoreRollup;
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

// ─── Date helpers ─────────────────────────────────────────────────────────────

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

// ─── Format helpers ───────────────────────────────────────────────────────────

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

const ROLE_OPTIONS = ['PIC1', 'PIC2', 'SA', 'CASHIER', 'SPV'];

// ─── Shared atoms (palette mirrors /ops/tasks/progress) ────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-black text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
    </div>
  );
}

/** Plan status pill — same color language as task status badges in the progress page. */
function PlanStatusPill({ hasPlan, isLocked }: { hasPlan: boolean; isLocked: boolean }) {
  if (!hasPlan) {
    return (
      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
        Belum ada plan
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

/** Progress bar to 100% — colors mirror /ops/tasks/progress's progressBarClass. */
function PctProgressBar({ pct }: { pct: number }) {
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
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
        <div className={cn('h-full rounded-full transition-all duration-500', barClass)} style={{ width: `${clamped}%` }} />
      </div>
      <span className={cn('text-[11px] font-black tabular-nums', textClass)}>{pct}%</span>
    </div>
  );
}

// ─── Daily/Monthly toggle ───────────────────────────────────────────────────────

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

// ─── StoreListItem ────────────────────────────────────────────────────────────

function StoreListItem({ store, active, onOpen }: { store: StoreRow; active: boolean; onOpen: () => void }) {
  const hasPlan = store.rollup.storeMonthlyTargetId != null;
  const hasIssue = store.rollup.employeeTargetCount === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50', active && 'bg-indigo-50')}
    >
      <div className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500',
      )}>
        <Store className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>{store.name}</p>
          {hasIssue && (
            <span title="Belum ada target karyawan">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {store.rollup.employeeTargetCount} karyawan ·{' '}
          <span className="font-semibold text-slate-500">{fmtCurrencyCompact(store.rollup.storeMonthlySalesTarget)}</span>
        </p>
        <div className="mt-1">
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
      employees: acc.employees + s.rollup.employeeTargetCount,
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

// ─── AddEmployeeTargetForm ─────────────────────────────────────────────────────
//
// New employees are given a weight% share of the store's monthly total.
// Sales/transaction targets are derived automatically from
// storeMonthlySalesTarget * weightPct / 100 (and likewise for transactions),
// matching the seeder's "store total split by weight" logic.

function AddEmployeeTargetForm({ storeId, yearMonth, eligible, storeRollup, onCreated, onCancel }: {
  storeId: number;
  yearMonth: string;
  eligible: EligibleEmployee[];
  storeRollup: StoreRollup;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const available = eligible.filter((e) => !e.hasTarget);

  const [userId, setUserId] = useState(available[0]?.id ?? '');
  const [targetRoleCode, setTargetRoleCode] = useState('SA');
  const [targetWeightPct, setTargetWeightPct] = useState('10');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Store total target = current rollup. The new employee's sales/transaction
  // target is store total × weight%, matching the seeder's "store total
  // split by weight" logic. The server recalculates from the submitted
  // weight on save, so this preview is informational only.
  const weightPctNum = Number(targetWeightPct) || 0;
  const previewSales = Math.round((storeRollup.storeMonthlySalesTarget * weightPctNum) / 100);
  const previewTx = Math.round((storeRollup.storeMonthlyTransactionTarget * weightPctNum) / 100);
  const previewAtv = previewTx > 0 ? Math.round(previewSales / previewTx) : 0;

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
          targetWeightPct: weightPctNum,
          monthlySalesTarget: previewSales,
          monthlyTransactionTarget: previewTx,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menambah target.');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menambah target.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-900">Tambah Target Karyawan</p>
        <button type="button" onClick={onCancel} className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      {available.length === 0 ? (
        <p className="mt-3 text-xs text-slate-500">Semua karyawan di toko ini sudah memiliki target bulan ini.</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Karyawan
              <select value={userId} onChange={(e) => setUserId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                {available.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.nik})</option>
                ))}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600">
              Role
              <select value={targetRoleCode} onChange={(e) => setTargetRoleCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>

            <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
              Weight (% dari total target toko)
              <input type="number" value={targetWeightPct} onChange={(e) => setTargetWeightPct(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                Target dihitung otomatis: total target toko × weight%.
              </span>
            </label>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-white px-2 py-1.5 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Sales Target</p>
              <p className="text-xs font-bold text-slate-700">{fmtCurrency(previewSales)}</p>
            </div>
            <div className="rounded-lg bg-white px-2 py-1.5 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Transaksi Target</p>
              <p className="text-xs font-bold text-slate-700">{previewTx}</p>
            </div>
            <div className="rounded-lg bg-white px-2 py-1.5 text-center">
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">ATV Target</p>
              <p className="text-xs font-bold text-slate-700">{fmtCurrency(previewAtv)}</p>
            </div>
          </div>
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

// ─── Role badge ───────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASSES: Record<string, string> = {
  PIC1: 'bg-violet-50 text-violet-600 border-violet-100',
  PIC2: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100',
  SA: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  CASHIER: 'bg-sky-50 text-sky-600 border-sky-100',
  SPV: 'bg-amber-50 text-amber-600 border-amber-100',
};

function RoleBadge({ role }: { role: string }) {
  const cls = ROLE_BADGE_CLASSES[role] ?? 'bg-slate-50 text-slate-600 border-slate-100';
  return <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', cls)}>{role}</span>;
}

// ─── EmployeeCalendarModal ──────────────────────────────────────────────────────
//
// Shows one employee's daily sales actuals for the selected month in a
// calendar grid. Fetched from the calendar API on open.

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

  // Build a 7-column grid, padding the first week so day 1 lands on the
  // correct weekday (Mon-first).
  const grid = useMemo(() => {
    if (days.length === 0) return [];
    const firstDate = new Date(`${days[0].date}T00:00:00`);
    const firstWeekday = (firstDate.getDay() + 6) % 7; // 0=Mon..6=Sun
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

  // Render via portal so this floating dialog isn't nested inside table
  // elements (a <div> directly inside <tbody>/<tr> is invalid HTML and
  // triggers hydration errors).
  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}

// ─── EmployeeTargetTableRow ─────────────────────────────────────────────────────
//
// One row in the employee target table. Click "Edit" to enter edit mode,
// where the admin can choose to edit EITHER the monthly sales/transaction
// target amounts OR the weight%:
//
//   - Amount mode: editing the sales/transaction amounts directly increases
//     or decreases the store total by the delta; every employee's weight%
//     (including this row, PIC1, PIC2) is recomputed as
//     amount / newStoreTotal * 100.
//
//   - Weight mode: editing the weight% keeps the store total FIXED. Other
//     PIC1/PIC2 rows keep their weight; the SA pool is redistributed
//     proportionally across the other SA rows. All rows' amounts are
//     re-derived from the new weights.
//
// Both modes are sent to the same PATCH endpoint via `editMode`, which
// rebalances every active sibling row in the store + month. ATV is always
// derived (sales / transactions) — never directly editable.

function EmployeeTargetTableRow({ row, storeId, period, yearMonth, locked, zebra, onUpdated, onDeleted }: {
  row: EmployeeTargetRow;
  storeId: number;
  period: ViewPeriod;
  yearMonth: string;
  locked: boolean;
  zebra: boolean;
  onUpdated: () => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editMode, setEditMode] = useState<'amount' | 'weight'>('amount');
  const [roleCode, setRoleCode] = useState(row.targetRoleCode);
  const [salesInput, setSalesInput] = useState(String(row.monthlySalesTarget));
  const [txInput, setTxInput] = useState(String(row.monthlyTransactionTarget));
  const [weightInput, setWeightInput] = useState(String(row.targetWeightPct));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  const startEdit = () => {
    setRoleCode(row.targetRoleCode);
    setSalesInput(String(row.monthlySalesTarget));
    setTxInput(String(row.monthlyTransactionTarget));
    setWeightInput(String(row.targetWeightPct));
    setEditMode('amount');
    setEditing(true);
    setError(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        targetRoleCode: roleCode,
        editMode,
      };

      if (editMode === 'amount') {
        body.monthlySalesTarget = Math.round(Number(salesInput) || 0);
        body.monthlyTransactionTarget = Math.round(Number(txInput) || 0);
      } else {
        body.targetWeightPct = Number(weightInput) || 0;
      }

      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memperbarui target.');
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui target.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Hapus target untuk ${row.name}?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/employees/${row.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menghapus target.');
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus target.');
      setSaving(false);
    }
  };

  const salesPct = pctOf(row.actualSales, row.displaySalesTarget);
  const txPct = pctOf(row.actualTransactionCount, row.displayTransactionTarget);

  return (
    <>
      <tr className={cn(
        'border-b border-slate-100 transition-colors last:border-b-0 hover:bg-indigo-50/30',
        zebra && !editing && 'bg-slate-50/60',
        !row.isActive && 'opacity-50',
        editing && 'bg-indigo-50/40',
      )}>
        <td className="px-3 py-3">
          <p className="text-sm font-bold text-slate-900">{row.name}</p>
          <p className="text-[11px] text-slate-400">NIK {row.nik}</p>
        </td>

        <td className="px-3 py-3">
          {editing ? (
            <select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs focus:border-indigo-400 focus:outline-none">
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          ) : (
            <RoleBadge role={row.targetRoleCode} />
          )}
        </td>

        <td className="px-3 py-3 text-right">
          {editing ? (
            <input
              type="number"
              value={weightInput}
              disabled={editMode !== 'weight'}
              onChange={(e) => setWeightInput(e.target.value)}
              className={cn(
                'w-20 rounded-lg border px-2 py-1 text-right text-xs focus:outline-none',
                editMode === 'weight'
                  ? 'border-indigo-300 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                  : 'border-slate-100 bg-slate-50 text-slate-400',
              )}
            />
          ) : (
            <span className="text-xs font-bold tabular-nums text-slate-600">{row.targetWeightPct.toFixed(2)}%</span>
          )}
        </td>

        {/* Sales: target / actual / progress */}
        <td className="px-3 py-3 text-right">
          {editing ? (
            <input
              type="number"
              value={salesInput}
              disabled={editMode !== 'amount'}
              onChange={(e) => setSalesInput(e.target.value)}
              className={cn(
                'w-28 rounded-lg border px-2 py-1 text-right text-xs tabular-nums focus:outline-none',
                editMode === 'amount'
                  ? 'border-indigo-300 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                  : 'border-slate-100 bg-slate-50 text-slate-400',
              )}
            />
          ) : (
            <>
              <p className="text-xs font-bold tabular-nums text-slate-700">{fmtCurrency(row.displaySalesTarget)}</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">Aktual {fmtCurrency(row.actualSales)}</p>
              <div className="mt-1 flex justify-end"><PctProgressBar pct={salesPct} /></div>
            </>
          )}
        </td>

        {/* Transactions: target / actual / progress */}
        <td className="px-3 py-3 text-right">
          {editing ? (
            <input
              type="number"
              value={txInput}
              disabled={editMode !== 'amount'}
              onChange={(e) => setTxInput(e.target.value)}
              className={cn(
                'w-20 rounded-lg border px-2 py-1 text-right text-xs tabular-nums focus:outline-none',
                editMode === 'amount'
                  ? 'border-indigo-300 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                  : 'border-slate-100 bg-slate-50 text-slate-400',
              )}
            />
          ) : (
            <>
              <p className="text-xs font-bold tabular-nums text-slate-700">{row.displayTransactionTarget}</p>
              <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">Aktual {row.actualTransactionCount}</p>
              <div className="mt-1 flex justify-end"><PctProgressBar pct={txPct} /></div>
            </>
          )}
        </td>

        {/* ATV — always derived */}
        <td className="px-3 py-3 text-right">
          <span className="text-xs font-bold tabular-nums text-slate-700">
            {fmtCurrency(row.monthlyAtvTarget)}
          </span>
        </td>

        <td className="px-3 py-3 text-right">
          {locked ? (
            <span className="text-[10px] font-semibold text-slate-300">—</span>
          ) : editing ? (
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => { setEditing(false); }} disabled={saving}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                Batal
              </button>
              <button type="button" onClick={handleSave} disabled={saving}
                className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-500 disabled:opacity-60">
                {saving ? '…' : 'Simpan'}
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-1.5">
              <button type="button" onClick={() => setShowCalendar(true)}
                title="Lihat kalender sales bulanan"
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                <Calendar className="h-3 w-3" />
              </button>
              <button type="button" onClick={startEdit}
                className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button type="button" onClick={handleDelete} disabled={saving}
                className="flex items-center gap-1 rounded-lg border border-red-100 bg-white px-2 py-1 text-[11px] font-bold text-red-500 hover:bg-red-50 disabled:opacity-60">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-100 bg-indigo-50/30 last:border-b-0">
          <td colSpan={7} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Edit berdasarkan:</span>
              <button type="button" onClick={() => setEditMode('amount')}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                  editMode === 'amount' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}>
                Target Sales / Transaksi
              </button>
              <button type="button" onClick={() => setEditMode('weight')}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-bold transition',
                  editMode === 'weight' ? 'bg-indigo-600 text-white' : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
                )}>
                Weight %
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">
              {editMode === 'amount'
                ? 'Mengubah target sales/transaksi akan mengubah total target toko, dan weight% seluruh karyawan dihitung ulang dari total baru.'
                : 'Mengubah weight% menjaga total target toko tetap sama. PIC1/PIC2 lain tidak berubah; sisa weight SA dibagi ulang secara proporsional, lalu target sales/transaksi dihitung ulang dari weight baru.'}
              {period === 'daily' && ' Target yang diedit adalah target bulanan (tampilan harian dihitung dari target bulanan ÷ hari terjadwal).'}
            </p>
          </td>
        </tr>
      )}
      {error && (
        <tr>
          <td colSpan={7} className="px-3 pb-2">
            <p className="text-xs font-semibold text-red-500">{error}</p>
          </td>
        </tr>
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
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Target className="h-5 w-5" />
          </div>
          <p className="font-semibold text-slate-700">Pilih toko untuk kelola target</p>
          <p className="mt-1 text-xs text-slate-400">Klik salah satu toko di kiri untuk melihat dan mengatur target karyawan.</p>
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
    const order = ['PIC1', 'PIC2', 'SA', 'CASHIER', 'SPV'];
    const ai = order.indexOf(a.targetRoleCode);
    const bi = order.indexOf(b.targetRoleCode);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });

  const weightSum = detail.employeeTargets.reduce((sum, row) => sum + row.targetWeightPct, 0);

  const storeSalesPct = pctOf(detail.actuals.storeActualSales, detail.storeDisplaySalesTarget);
  const storeTxPct = pctOf(detail.actuals.storeActualTransactionCount, detail.storeDisplayTransactionTarget);
  const storeAtvActual = detail.actuals.storeActualTransactionCount > 0
    ? Math.round(detail.actuals.storeActualSales / detail.actuals.storeActualTransactionCount)
    : 0;

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
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
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p className="text-[11px] font-semibold">
              Data aktual dari Business Central tidak tersedia{detail.actuals.error ? `: ${detail.actuals.error}` : '.'}
            </p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Sales</p>
            <p className="mt-0.5 text-sm font-black text-slate-900">{fmtCurrency(detail.storeDisplaySalesTarget)}</p>
            <p className="text-[11px] text-slate-400">Aktual {fmtCurrency(detail.actuals.storeActualSales)}</p>
            <div className="mt-1"><PctProgressBar pct={storeSalesPct} /></div>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Transaksi</p>
            <p className="mt-0.5 text-sm font-black text-slate-900">{detail.storeDisplayTransactionTarget}</p>
            <p className="text-[11px] text-slate-400">Aktual {detail.actuals.storeActualTransactionCount}</p>
            <div className="mt-1"><PctProgressBar pct={storeTxPct} /></div>
          </div>
          <StatCard label="ATV Target" value={fmtCurrency(detail.rollup.storeMonthlyAtvTarget)} sub={`Aktual ${fmtCurrency(storeAtvActual)}`} />
          <StatCard label="Karyawan" value={String(detail.rollup.employeeTargetCount)} sub="dengan target aktif" />
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
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-slate-400">
            <Users className="h-3.5 w-3.5" /> Target vs Aktual Karyawan
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
              storeRollup={detail.rollup}
              onCreated={() => { setShowAddForm(false); onRefresh(); }}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
            Belum ada target karyawan untuk bulan ini.
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                Total weight saat ini: <span className="font-bold text-slate-600">{weightSum.toFixed(2)}%</span>
                {Math.abs(weightSum - 100) > 0.5 && (
                  <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 font-bold text-amber-600">
                    <AlertTriangle className="h-2.5 w-2.5" /> tidak 100%
                  </span>
                )}
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-slate-200 bg-slate-100 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <th className="px-3 py-2.5">Karyawan</th>
                    <th className="px-3 py-2.5">Role</th>
                    <th className="px-3 py-2.5 text-right">Weight</th>
                    <th className="px-3 py-2.5 text-right">Sales {period === 'daily' ? '(Harian)' : '(Bulanan)'}</th>
                    <th className="px-3 py-2.5 text-right">Transaksi {period === 'daily' ? '(Harian)' : '(Bulanan)'}</th>
                    <th className="px-3 py-2.5 text-right">ATV</th>
                    <th className="px-3 py-2.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, idx) => (
                    <EmployeeTargetTableRow
                      key={row.id}
                      row={row}
                      storeId={detail.store.id}
                      period={period}
                      yearMonth={yearMonth}
                      locked={isLocked}
                      zebra={idx % 2 === 1}
                      onUpdated={onRefresh}
                      onDeleted={onRefresh}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-100 text-xs font-bold text-slate-700">
                    <td className="px-3 py-2.5" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{weightSum.toFixed(2)}%</td>
                    <td className="px-3 py-2.5 text-right">
                      <p className="tabular-nums">{fmtCurrency(detail.storeDisplaySalesTarget)}</p>
                      <p className="mt-0.5 text-[11px] font-normal tabular-nums text-slate-400">Aktual {fmtCurrency(detail.actuals.storeActualSales)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <p className="tabular-nums">{detail.storeDisplayTransactionTarget}</p>
                      <p className="mt-0.5 text-[11px] font-normal tabular-nums text-slate-400">Aktual {detail.actuals.storeActualTransactionCount}</p>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtCurrency(detail.rollup.storeMonthlyAtvTarget)}</td>
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
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

  // Clear selection whenever the month changes — the previously selected
  // store's target row set may not exist for the new month.
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

        {/* Summary strip */}
        {overview && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total Toko" value={String(overview.summary.storeCount)} />
            <StatCard
              label="Plan Terisi"
              value={`${overview.summary.plannedStoreCount}/${overview.summary.storeCount}`}
              sub="toko dengan plan bulanan"
            />
            <StatCard label="Total Target Sales" value={fmtCurrencyCompact(overview.summary.storeMonthlySalesTarget)} sub="bulanan" />
            <StatCard label="Total Target Transaksi" value={String(overview.summary.storeMonthlyTransactionTarget)} sub="bulanan" />
          </div>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
          {/* ── Store list ── */}
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

          {/* ── Detail panel ── */}
          <div className="lg:sticky lg:top-[6.5rem]">
            <StoreDetailPanel
              detail={detail}
              loading={loadingDetail}
              eligible={eligible}
              yearMonth={yearMonth}
              period={viewPeriod}
              onRefresh={handleRefresh}
            />
          </div>
        </div>
      </div>
    </div>
  );
}