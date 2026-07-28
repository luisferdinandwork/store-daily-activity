'use client';
// app/finance/uang-modal/page.tsx
//
// Finance · Daily Uang Modal (Cek Uang Modal monitor)
//
// A month-calendar of cashier opening-float (uang modal) submissions.
// Clicking a day opens a right-side slide-over panel (matches the OPS
// Schedule Manager panel pattern) listing every store's denomination
// breakdown for that date.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coins,
  Loader2,
  RefreshCw,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  UangModalDayCell,
  UangModalDayDetail,
  UangModalStoreEntry,
} from '@/app/api/finance/uang-modal/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style:                 'currency',
  currency:              'IDR',
  maximumFractionDigits: 0,
});
const idr = (v: number) => IDR.format(v);

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}
function dateLabelFull(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
function dateLabelShort(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}
function fmtTs(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

const DENOMINATION_LABELS: Record<number, string> = {
  100_000: 'Rp 100.000',
  50_000:  'Rp 50.000',
  20_000:  'Rp 20.000',
  10_000:  'Rp 10.000',
  5_000:   'Rp 5.000',
  2_000:   'Rp 2.000',
  1_000:   'Rp 1.000',
  500:     'Rp 500',
  200:     'Rp 200',
  100:     'Rp 100',
};

// ─── Status meta ──────────────────────────────────────────────────────────────

const STATUS_META: Record<UangModalStoreEntry['status'], { dot: string; badge: string; label: string }> = {
  completed:   { dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', label: 'Selesai' },
  in_progress: { dot: 'bg-blue-400',    badge: 'bg-blue-50 text-blue-700 ring-blue-200',          label: 'Sedang dihitung' },
  not_started: { dot: 'bg-slate-300',   badge: 'bg-slate-100 text-slate-500 ring-slate-200',      label: 'Belum mulai' },
  pending:     { dot: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',          label: 'Pending' },
};

// ─── Day cell ─────────────────────────────────────────────────────────────────

function DayCell({
  cell,
  isToday,
  onClick,
}: {
  cell: UangModalDayCell;
  isToday: boolean;
  onClick: () => void;
}) {
  const allSubmitted = cell.totalStoreCount > 0 && cell.pendingCount === 0;
  const partial      = cell.totalStoreCount > 0 && cell.pendingCount > 0;

  return (
    <button
      onClick={onClick}
      disabled={!cell.hasData}
      className={cn(
        'group flex h-[92px] flex-col rounded-xl border p-2.5 text-left transition-all',
        cell.hasData
          ? 'cursor-pointer border-slate-200 bg-white hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md'
          : 'cursor-default border-slate-100 bg-slate-50/50',
        isToday && 'ring-2 ring-emerald-400 ring-offset-1',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn(
          'text-xs font-bold',
          isToday ? 'text-emerald-600' : cell.hasData ? 'text-slate-700' : 'text-slate-300',
        )}>
          {cell.dayOfMonth}
        </span>
        {cell.hasData && (
          <span className={cn(
            'h-1.5 w-1.5 rounded-full',
            allSubmitted ? 'bg-emerald-500' : partial ? 'bg-amber-400' : 'bg-slate-300',
          )} />
        )}
      </div>

      {cell.hasData ? (
        <div className="mt-auto">
          <p className="truncate text-[13px] font-bold tabular-nums text-slate-800 group-hover:text-emerald-700">
            {idr(cell.totalAmount)}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">
            {cell.submittedCount}/{cell.totalStoreCount} toko
          </p>
        </div>
      ) : (
        <div className="mt-auto">
          <p className="text-[11px] text-slate-300">—</p>
        </div>
      )}
    </button>
  );
}

// ─── Denomination breakdown chip row ──────────────────────────────────────────

function DenominationGrid({ denominations }: { denominations: UangModalStoreEntry['denominations'] }) {
  const nonZero = denominations.filter((d) => d.quantity > 0);

  if (nonZero.length === 0) {
    return <p className="text-xs italic text-slate-400">Belum ada pecahan diinput.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {nonZero.map((d) => (
        <div
          key={d.denominationValue}
          className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2"
        >
          <div>
            <p className="text-[11px] font-semibold text-slate-600">
              {DENOMINATION_LABELS[d.denominationValue] ?? `Rp ${d.denominationValue.toLocaleString('id-ID')}`}
            </p>
            <p className="text-[10px] text-slate-400">× {d.quantity}</p>
          </div>
          <p className="text-xs font-bold tabular-nums text-slate-700">{idr(d.amount)}</p>
        </div>
      ))}
    </div>
  );
}

// ─── Store entry card (inside the panel) ──────────────────────────────────────

function StoreEntryCard({ entry }: { entry: UangModalStoreEntry }) {
  const [open, setOpen] = useState(false);
  const meta = STATUS_META[entry.status];
  const pctOfMax = entry.maxAmount > 0
    ? Math.min(100, Math.round((entry.totalAmount / entry.maxAmount) * 100))
    : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dot)} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold text-slate-900">{entry.storeName}</span>
            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-500">
              {entry.storeNo}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
            <span>{entry.areaName}</span>
            {entry.submittedBy && (
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {entry.submittedBy}
              </span>
            )}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums text-slate-800">{idr(entry.totalAmount)}</p>
          <p className="text-[10px] text-slate-400">dari {idr(entry.maxAmount)}</p>
        </div>
      </button>

      {/* Status + mini progress bar */}
      <div className="flex items-center gap-2 px-4 pb-2.5">
        <span className={cn(
          'shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset',
          meta.badge,
        )}>
          {meta.label}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn('h-full transition-all', pctOfMax >= 90 ? 'bg-amber-400' : 'bg-emerald-400')}
            style={{ width: `${pctOfMax}%` }}
          />
        </div>
        {entry.completedAt && (
          <span className="shrink-0 text-[10px] text-slate-400">{fmtTs(entry.completedAt)}</span>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-100 bg-slate-50/40 px-4 py-3">
          {entry.notes && (
            <p className="mb-2.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-600">Catatan:</span> {entry.notes}
            </p>
          )}
          <DenominationGrid denominations={entry.denominations} />
        </div>
      )}
    </div>
  );
}

// ─── Day detail panel — right-side slide-over ─────────────────────────────────

function DayDetailPanel({
  detail,
  onClose,
}: {
  detail: UangModalDayDetail;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="flex w-[440px] max-w-full flex-col overflow-hidden bg-white shadow-2xl"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 bg-emerald-50/60 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                <Wallet className="h-3 w-3" />
                Uang Modal
              </p>
              <p className="mt-0.5 truncate text-lg font-bold text-slate-900">
                {dateLabelShort(detail.date)}
              </p>
              <p className="truncate text-xs text-slate-500">{dateLabelFull(detail.date)}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Compact summary row */}
          <div className="mt-4 flex items-center gap-4 rounded-xl bg-white px-4 py-3 ring-1 ring-emerald-100">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Total terkumpul</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-emerald-700">{idr(detail.totalAmount)}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Toko submit</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">
                {detail.submittedCount}<span className="text-sm text-slate-400">/{detail.totalStoreCount}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Store list */}
        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {detail.stores.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <Coins className="h-8 w-8 text-slate-200" />
              <p className="text-sm text-slate-400">Tidak ada data untuk tanggal ini.</p>
            </div>
          ) : (
            detail.stores.map((entry) => (
              <StoreEntryCard key={entry.taskId} entry={entry} />
            ))
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
      `}</style>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface ApiResponse {
  success: true;
  month: string;
  maxAmountPerStore: number;
  days: UangModalDayCell[];
  detail: Record<string, UangModalDayDetail>;
}

export default function FinanceUangModalPage() {
  const [month, setMonth]     = useState(currentMonth);
  const [data, setData]       = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/finance/uang-modal?month=${m}`, { cache: 'no-store' });
      const body = await res.json();
      if (body.success) setData(body);
      else setError(body.error ?? 'Gagal memuat data.');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [load, month]);

  const isCurrentMonth = month === currentMonth();

  // Build calendar grid: leading blanks for first-of-month weekday offset
  const calendarCells = useMemo(() => {
    if (!data) return [];
    const [y, m] = month.split('-').map(Number);
    const firstWeekday = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
    const blanks = Array.from({ length: firstWeekday }, () => null);
    return [...blanks, ...data.days];
  }, [data, month]);

  // Today's (or most recent day-with-data's) completion ratio for the header chip
  const todayCompletion = useMemo(() => {
    if (!data) return null;
    const t = data.days.find((d) => d.date === todayStr());
    if (t && t.hasData) return t;
    // fall back to most recent day with data
    const withData = [...data.days].reverse().find((d) => d.hasData);
    return withData ?? null;
  }, [data]);

  const selectedDetail = selectedDate && data ? data.detail[selectedDate] : null;

  const weekdayLabels = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

  return (
    <div className="min-h-full bg-slate-50">

      {/* ── Sticky header ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-[1200px] px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">
                Finance · Kas Operasional
              </p>
              <h1 className="mt-0.5 flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
                <Wallet className="h-6 w-6 text-emerald-500" />
                Daily Uang Modal
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Quick completion chip */}
              {!loading && todayCompletion && (
                <span className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
                  {todayCompletion.submittedCount}/{todayCompletion.totalStoreCount} toko submit
                  {todayCompletion.date !== todayStr() && (
                    <span className="font-normal text-emerald-500">
                      · {dateLabelShort(todayCompletion.date)}
                    </span>
                  )}
                </span>
              )}

              <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white">
                <button
                  onClick={() => setMonth((m) => prevMonth(m))}
                  className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50"
                  aria-label="Bulan sebelumnya"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex items-center gap-1.5 border-x border-slate-200 px-3 text-xs font-bold text-slate-700">
                  <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                  {monthLabel(month)}
                </span>
                <button
                  onClick={() => setMonth((m) => nextMonth(m))}
                  disabled={isCurrentMonth}
                  className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Bulan berikutnya"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {!isCurrentMonth && (
                <button
                  onClick={() => setMonth(currentMonth())}
                  className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Bulan ini
                </button>
              )}

              <button
                onClick={() => load(month)}
                disabled={loading}
                className="flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1200px] space-y-5 px-6 py-6 lg:px-8">

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{error}</p>
          </div>
        )}

        {/* Calendar */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : (
            <>
              {/* Weekday header */}
              <div className="mb-2 grid grid-cols-7 gap-2">
                {weekdayLabels.map((w) => (
                  <div key={w} className="text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    {w}
                  </div>
                ))}
              </div>

              {/* Day grid */}
              <div className="grid grid-cols-7 gap-2">
                {calendarCells.map((cell, i) =>
                  cell === null ? (
                    <div key={`blank-${i}`} />
                  ) : (
                    <DayCell
                      key={cell.date}
                      cell={cell}
                      isToday={cell.date === todayStr()}
                      onClick={() => setSelectedDate(cell.date)}
                    />
                  ),
                )}
              </div>
            </>
          )}
        </div>

        {/* Legend */}
        {!loading && !error && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-500">
            <span className="font-semibold uppercase tracking-wide">Status hari:</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Semua toko sudah submit
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Sebagian toko belum submit
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              Belum ada data
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-slate-400">
              <Coins className="h-3.5 w-3.5" />
              Klik tanggal untuk lihat rincian pecahan uang per toko
            </span>
          </div>
        )}

      </div>

      {/* Right-side detail panel */}
      {selectedDetail && (
        <DayDetailPanel
          detail={selectedDetail}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </div>
  );
}