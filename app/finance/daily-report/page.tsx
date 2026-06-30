'use client';
// app/finance/daily-report/page.tsx
//
// Finance · Daily Performance Report
//
// Shows each store's daily sales vs target, broken down per employee.
// Layout:
//   • Sticky header — date nav + refresh
//   • Summary bar  — totals across all visible stores
//   • Area group headers — stores grouped by area, collapsible
//   • Store card    — store totals + progress bars
//   • Employee table inside each expanded store card

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  DailyReportStore,
  DailyReportEmployee,
} from '@/app/api/finance/daily-report/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style:                 'currency',
  currency:              'IDR',
  maximumFractionDigits: 0,
});
const idr = (v: number) => IDR.format(v);

const PCT = (v: number) => `${v}%`;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function shiftDay(iso: string, delta: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return [
    dt.getFullYear(),
    String(dt.getMonth() + 1).padStart(2, '0'),
    String(dt.getDate()).padStart(2, '0'),
  ].join('-');
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}
function fmtMonthYear(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

// ─── Achievement colour ───────────────────────────────────────────────────────

function achColor(pct: number): string {
  if (pct >= 100) return 'text-emerald-600';
  if (pct >= 70)  return 'text-blue-600';
  if (pct >= 40)  return 'text-amber-600';
  return 'text-rose-600';
}
function barColor(pct: number): string {
  if (pct >= 100) return 'bg-emerald-500';
  if (pct >= 70)  return 'bg-blue-400';
  if (pct >= 40)  return 'bg-amber-400';
  return 'bg-rose-400';
}
function badgeCls(pct: number): string {
  if (pct >= 100) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (pct >= 70)  return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (pct >= 40)  return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-rose-50 text-rose-600 ring-rose-200';
}

// ─── Mini progress bar ────────────────────────────────────────────────────────

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const capped = Math.min(pct, 100);
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-slate-100', className)}>
      <div
        className={cn('h-full rounded-full transition-all', barColor(pct))}
        style={{ width: `${capped}%` }}
      />
    </div>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ code }: { code: string }) {
  const cls =
    code === 'PIC1' || code === 'PIC2'
      ? 'bg-violet-50 text-violet-700 ring-violet-200'
      : 'bg-slate-100 text-slate-500 ring-slate-200';
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 py-px text-[10px] font-bold ring-1 ring-inset', cls)}>
      {code}
    </span>
  );
}

// ─── Employee table ───────────────────────────────────────────────────────────

function EmployeeTable({
  employees,
  unassigned,
  bcAvailable,
}: {
  employees: DailyReportEmployee[];
  unassigned: { userId: string; nik: string; name: string }[];
  bcAvailable: boolean;
}) {
  if (employees.length === 0 && unassigned.length === 0) {
    return (
      <p className="px-6 py-4 text-xs italic text-slate-400">
        Tidak ada target karyawan yang dikonfigurasi untuk bulan ini.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50/60">
            <th className="py-2 pl-6 pr-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Karyawan
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Target harian
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Penjualan hari ini
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Transaksi
            </th>
            <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
              ATV
            </th>
            <th className="w-32 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Capaian
            </th>
            <th className="py-2 pl-3 pr-6 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Bulan ini
            </th>
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const salesPct = emp.salesAchievementPct;
            const hasActuals = bcAvailable && emp.isScheduled;
            return (
              <tr
                key={emp.userId}
                className={cn(
                  'border-b border-slate-100/80 transition-colors last:border-0',
                  !emp.isScheduled && 'opacity-50',
                )}
              >
                {/* Name + role */}
                <td className="py-3 pl-6 pr-3">
                  <div className="flex items-center gap-2">
                    <RoleBadge code={emp.roleCode} />
                    <span className="font-medium text-slate-800">{emp.name}</span>
                    {!emp.isScheduled && (
                      <span className="text-[10px] text-slate-400">· libur</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    NIK {emp.nik}
                    {emp.scheduledDaysInMonth > 0 && (
                      <> · {emp.scheduledDaysInMonth} hari dijadwalkan bulan ini</>
                    )}
                  </p>
                </td>

                {/* Daily target */}
                <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                  {emp.dailySalesTarget > 0 ? idr(emp.dailySalesTarget) : '—'}
                </td>

                {/* Actual sales */}
                <td className="px-3 py-3 text-right">
                  {bcAvailable ? (
                    <span className={cn('font-semibold tabular-nums', achColor(salesPct))}>
                      {idr(emp.actualSales)}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>

                {/* Transaction count */}
                <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                  {bcAvailable ? emp.actualTransactionCount : '—'}
                  {emp.dailyTransactionTarget > 0 && (
                    <span className="text-slate-400">
                      /{emp.dailyTransactionTarget}
                    </span>
                  )}
                </td>

                {/* ATV */}
                <td className="px-3 py-3 text-right tabular-nums text-slate-600">
                  {bcAvailable && emp.actualAtv > 0 ? idr(emp.actualAtv) : '—'}
                </td>

                {/* Achievement bar + % */}
                <td className="px-3 py-3">
                  {hasActuals && emp.dailySalesTarget > 0 ? (
                    <div className="flex items-center gap-2">
                      <ProgressBar pct={salesPct} className="flex-1" />
                      <span className={cn('w-10 text-right text-xs font-bold tabular-nums', achColor(salesPct))}>
                        {PCT(salesPct)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>

                {/* Monthly target chip */}
                <td className="py-3 pl-3 pr-6 text-right">
                  <span className="text-xs tabular-nums text-slate-500">
                    {idr(emp.monthlySalesTarget)}
                  </span>
                </td>
              </tr>
            );
          })}

          {/* Unassigned staff */}
          {unassigned.map((u) => (
            <tr key={u.userId} className="border-b border-slate-100/80 opacity-60 last:border-0">
              <td className="py-2.5 pl-6 pr-3">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded px-1.5 py-px text-[10px] font-bold ring-1 ring-inset bg-slate-100 text-slate-400 ring-slate-200">
                    —
                  </span>
                  <span className="text-slate-500">{u.name}</span>
                  <span className="text-[10px] text-amber-500">· belum ada target</span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">NIK {u.nik}</p>
              </td>
              <td colSpan={6} className="px-3 py-2.5 text-xs italic text-slate-400">
                Target bulan ini belum dikonfigurasi
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Store card ───────────────────────────────────────────────────────────────

function StoreCard({
  store,
  expanded,
  onToggle,
}: {
  store: DailyReportStore;
  expanded: boolean;
  onToggle: () => void;
}) {
  const salesPct = store.storeSalesVsMonthlyPct;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Card header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
        className={cn(
          'grid cursor-pointer select-none items-center gap-x-4 px-5 py-4 transition-colors',
          'grid-cols-[auto_1fr_10rem_10rem_10rem_8rem_auto]',
          expanded ? 'bg-slate-50' : 'bg-white hover:bg-slate-50/60',
        )}
      >
        {/* Chevron */}
        <div className={cn(
          'flex h-6 w-6 items-center justify-center rounded-md transition-colors',
          expanded ? 'bg-slate-200 text-slate-600' : 'text-slate-300 hover:bg-slate-100',
        )}>
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </div>

        {/* Store name */}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-slate-900">{store.storeName}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-500">
              {store.storeNo}
            </span>
            {!store.bcAvailable && (
              <span title={store.bcError} className="flex items-center gap-1 text-[10px] text-amber-500">
                <WifiOff className="h-3 w-3" /> BC offline
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {store.employees.length} karyawan dengan target
            {store.unassignedScheduledStaff.length > 0 && (
              <span className="ml-2 text-amber-500">
                · {store.unassignedScheduledStaff.length} belum ada target
              </span>
            )}
          </p>
        </div>

        {/* Today actual */}
        <div className="text-right">
          <p className={cn('text-sm font-bold tabular-nums', achColor(salesPct))}>
            {store.bcAvailable ? idr(store.storeActualSales) : '—'}
          </p>
          <p className="text-[10px] text-slate-400">penjualan hari ini</p>
        </div>

        {/* Monthly target */}
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-700">
            {idr(store.storeMonthlySalesTarget)}
          </p>
          <p className="text-[10px] text-slate-400">target bulan ini</p>
        </div>

        {/* Transactions */}
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-700">
            {store.bcAvailable ? store.storeActualTransactionCount : '—'}
          </p>
          <p className="text-[10px] text-slate-400">transaksi</p>
        </div>

        {/* Achievement badge */}
        <div className="flex justify-end">
          {store.bcAvailable && store.storeMonthlySalesTarget > 0 ? (
            <span className={cn(
              'inline-flex items-center rounded-md px-2 py-1 text-[10px] font-bold ring-1 ring-inset',
              badgeCls(salesPct),
            )}>
              {PCT(salesPct)} mtd
            </span>
          ) : (
            <span className="text-[10px] text-slate-300">—</span>
          )}
        </div>

        {/* Spacer for grid alignment */}
        <div />
      </div>

      {/* Progress bar strip */}
      {store.bcAvailable && store.storeMonthlySalesTarget > 0 && (
        <div className="h-1 w-full bg-slate-100">
          <div
            className={cn('h-full transition-all', barColor(salesPct))}
            style={{ width: `${Math.min(salesPct, 100)}%` }}
          />
        </div>
      )}

      {/* Expanded employee table */}
      {expanded && (
        <div className="border-t border-slate-100">
          {store.bcError && (
            <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-6 py-2 text-xs text-amber-700">
              <WifiOff className="h-3.5 w-3.5 shrink-0" />
              Business Central tidak dapat dijangkau: {store.bcError}
            </div>
          )}
          <EmployeeTable
            employees={store.employees}
            unassigned={store.unassignedScheduledStaff}
            bcAvailable={store.bcAvailable}
          />
        </div>
      )}
    </div>
  );
}

// ─── Area group ───────────────────────────────────────────────────────────────

function AreaGroup({
  areaName,
  stores,
  expandedStores,
  onToggleStore,
  open,
  onToggleArea,
}: {
  areaName: string;
  stores: DailyReportStore[];
  expandedStores: Set<number>;
  onToggleStore: (id: number) => void;
  open: boolean;
  onToggleArea: () => void;
}) {
  const totalActual = stores.reduce((s, r) => s + r.storeActualSales, 0);
  const totalTarget = stores.reduce((s, r) => s + r.storeMonthlySalesTarget, 0);
  const areaPct     = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Area header */}
      <button
        onClick={onToggleArea}
        className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 text-left shadow-sm transition hover:bg-slate-50"
      >
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
        <span className="flex-1 text-sm font-bold text-slate-800">{areaName}</span>
        <span className="text-xs text-slate-400">{stores.length} toko</span>
        {totalTarget > 0 && (
          <>
            <span className="text-xs tabular-nums text-slate-500">{idr(totalActual)}</span>
            <span className="text-[10px] text-slate-400">vs {idr(totalTarget)}</span>
            <span className={cn('text-xs font-bold tabular-nums', achColor(areaPct))}>
              {PCT(areaPct)}
            </span>
          </>
        )}
      </button>

      {open && (
        <div className="space-y-3 pl-4">
          {stores.map((store) => (
            <StoreCard
              key={store.storeId}
              store={store}
              expanded={expandedStores.has(store.storeId)}
              onToggle={() => onToggleStore(store.storeId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({
  stores,
  yearMonth,
}: {
  stores: DailyReportStore[];
  yearMonth: string;
}) {
  const totalActual  = stores.reduce((s, r) => s + r.storeActualSales, 0);
  const totalTarget  = stores.reduce((s, r) => s + r.storeMonthlySalesTarget, 0);
  const totalTx      = stores.reduce((s, r) => s + r.storeActualTransactionCount, 0);
  const totalAtv     = totalTx > 0 ? Math.round(totalActual / totalTx) : 0;
  const overallPct   = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
  const bcOffline    = stores.filter((s) => !s.bcAvailable).length;
  const noTarget     = stores.filter((s) => s.storeMonthlySalesTarget === 0).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {[
        {
          label:  'Total penjualan hari ini',
          value:  idr(totalActual),
          dot:    overallPct >= 70 ? 'bg-emerald-500' : 'bg-amber-400',
          sub:    `${PCT(overallPct)} dari target bulan`,
        },
        {
          label:  'Target bulan ini',
          value:  idr(totalTarget),
          dot:    'bg-slate-300',
          sub:    fmtMonthYear(yearMonth),
        },
        {
          label:  'Total transaksi',
          value:  totalTx.toLocaleString('id-ID'),
          dot:    'bg-blue-400',
          sub:    'hari ini',
        },
        {
          label:  'Rata-rata ATV',
          value:  totalAtv > 0 ? idr(totalAtv) : '—',
          dot:    'bg-violet-400',
          sub:    'hari ini',
        },
        {
          label:  'BC offline',
          value:  bcOffline,
          dot:    bcOffline > 0 ? 'bg-amber-400' : 'bg-slate-200',
          sub:    'toko tidak terjangkau',
        },
        {
          label:  'Belum ada target',
          value:  noTarget,
          dot:    noTarget > 0 ? 'bg-rose-400' : 'bg-slate-200',
          sub:    'toko tanpa target bulan ini',
        },
      ].map(({ label, value, dot, sub }) => (
        <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
          <div className="min-w-0">
            <p className="truncate text-lg font-bold leading-none text-slate-900">{value}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="text-[10px] text-slate-400">{sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FinanceDailyReportPage() {
  const [date, setDate]       = useState(todayStr);
  const [data, setData]       = useState<{ stores: DailyReportStore[]; yearMonth: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const [expandedStores, setExpandedStores] = useState<Set<number>>(new Set());
  const [openAreas, setOpenAreas]           = useState<Set<string>>(new Set());
  const [search, setSearch]                 = useState('');

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/finance/daily-report?date=${d}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) {
        setData({ stores: body.stores, yearMonth: body.yearMonth });
        // Open all areas by default, collapse all store cards
        const areas = [...new Set((body.stores as DailyReportStore[]).map((s) => s.areaName))];
        setOpenAreas(new Set(areas));
        setExpandedStores(new Set());
      } else {
        setError(body.error ?? 'Gagal memuat data.');
      }
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(date); }, [load, date]);

  const isToday = date === todayStr();

  const filteredStores = useMemo(() => {
    if (!data) return [];
    const q = search.toLowerCase();
    if (!q) return data.stores;
    return data.stores.filter((s) =>
      s.storeName.toLowerCase().includes(q) ||
      s.storeNo.toLowerCase().includes(q) ||
      s.areaName.toLowerCase().includes(q) ||
      s.employees.some(
        (e) => e.name.toLowerCase().includes(q) || e.nik.toLowerCase().includes(q),
      ),
    );
  }, [data, search]);

  const groupedByArea = useMemo(() => {
    const map = new Map<string, DailyReportStore[]>();
    for (const s of filteredStores) {
      if (!map.has(s.areaName)) map.set(s.areaName, []);
      map.get(s.areaName)!.push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'id'));
  }, [filteredStores]);

  const toggleStore = (id: number) =>
    setExpandedStores((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleArea = (name: string) =>
    setOpenAreas((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const expandAll = () => {
    if (!data) return;
    setExpandedStores(new Set(data.stores.map((s) => s.storeId)));
  };
  const collapseAll = () => setExpandedStores(new Set());

  return (
    <div className="min-h-full bg-slate-50">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-[1400px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Laporan Performa
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">
                Daily Performance Report
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Day navigator */}
              <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white">
                <button
                  onClick={() => setDate((d) => shiftDay(d, -1))}
                  aria-label="Hari sebelumnya"
                  className="flex h-full w-8 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50"
                >‹</button>
                <span className="border-x border-slate-200 px-3 text-xs font-bold text-slate-700">
                  {fmtDate(date)}
                </span>
                <button
                  onClick={() => setDate((d) => shiftDay(d, 1))}
                  disabled={isToday}
                  aria-label="Hari berikutnya"
                  className="flex h-full w-8 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >›</button>
              </div>

              {!isToday && (
                <button
                  onClick={() => setDate(todayStr())}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Hari ini
                </button>
              )}

              <button
                onClick={() => load(date)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>

              {/* Expand / collapse all */}
              {data && (
                <>
                  <button
                    onClick={expandAll}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Buka semua
                  </button>
                  <button
                    onClick={collapseAll}
                    className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Tutup semua
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-5 px-6 py-6 lg:px-8">

        {/* Summary */}
        {!loading && !error && data && (
          <SummaryBar stores={data.stores} yearMonth={data.yearMonth} />
        )}

        {/* Search */}
        <div className="flex items-center gap-3">
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari toko, area, atau nama karyawan…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {data && (
            <span className="text-xs text-slate-400">
              {filteredStores.length} dari {data.stores.length} toko
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2].map((g) => (
              <div key={g} className="space-y-3">
                <div className="h-12 animate-pulse rounded-xl bg-slate-200" />
                <div className="space-y-3 pl-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                      <div className="h-16 animate-pulse bg-slate-50" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {!loading && !error && data && groupedByArea.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <BarChart3 className="mx-auto mb-3 h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">
              {search ? 'Tidak ada toko yang cocok.' : 'Tidak ada data untuk hari ini.'}
            </p>
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-6">
            {groupedByArea.map(([areaName, areaStores]) => (
              <AreaGroup
                key={areaName}
                areaName={areaName}
                stores={areaStores}
                expandedStores={expandedStores}
                onToggleStore={toggleStore}
                open={openAreas.has(areaName)}
                onToggleArea={() => toggleArea(areaName)}
              />
            ))}
          </div>
        )}

        {/* Legend */}
        {!loading && !error && data && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
            <span className="font-semibold uppercase tracking-wide">Capaian:</span>
            {[
              { dot: 'bg-emerald-500', label: '≥ 100% — target tercapai' },
              { dot: 'bg-blue-400',    label: '70–99%' },
              { dot: 'bg-amber-400',   label: '40–69%' },
              { dot: 'bg-rose-400',    label: '< 40%' },
            ].map(({ dot, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className={cn('h-2 w-2 rounded-full', dot)} />
                {label}
              </span>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}