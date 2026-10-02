'use client';
// components/ops/performance/EmployeeCalendarModal.tsx
//
// One employee's day-by-day achievement: pick a period (presets or a custom
// range) and see which days reached their flat daily sales target and which
// didn't — a reached / missed tally and a calendar, not a heatmap.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Calendar, CheckCircle2, X, XCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { addDaysKey, daysInMonthKey, jakartaTodayKey } from '@/lib/day-bucket';
import { fmtRp, fmtRpCompact, shiftYearMonth } from '@/lib/performance/target-view';
import { MicroLabel } from './atoms';

type CalendarDay = { date: string; actualSales: number; actualTransactionCount: number };
type DayStatus = 'reached' | 'missed' | 'future' | 'no-target';

type LoadResult = {
  key: string;
  available: boolean;
  days: CalendarDay[];
  totalSales: number;
  error: string | null;
};

const DAY_STYLES: Record<DayStatus, string> = {
  reached: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  missed: 'border-rose-200 bg-rose-50 text-rose-600',
  future: 'border-slate-100 bg-slate-50 text-slate-300',
  'no-target': 'border-slate-100 bg-slate-50 text-slate-300',
};

function dayStatus(day: CalendarDay, dailyTarget: number, today: string): DayStatus {
  if (day.date > today) return 'future';
  if (dailyTarget <= 0) return 'no-target';
  return day.actualSales >= dailyTarget ? 'reached' : 'missed';
}

function fmtShort(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

const lastDayOf = (yearMonth: string) => `${yearMonth}-${String(daysInMonthKey(yearMonth)).padStart(2, '0')}`;

function Pill({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

export default function EmployeeCalendarModal({
  storeId,
  targetId,
  employeeName,
  yearMonth,
  dailyTarget,
  onClose,
}: {
  storeId: number;
  targetId: number;
  employeeName: string;
  yearMonth: string;
  dailyTarget: number;
  onClose: () => void;
}) {
  const [startDate, setStartDate] = useState(`${yearMonth}-01`);
  const [endDate, setEndDate] = useState(lastDayOf(yearMonth));
  const [result, setResult] = useState<LoadResult | null>(null);

  const today = jakartaTodayKey();
  const requestKey = `${storeId}|${targetId}|${startDate}|${endDate}`;
  const loading = result?.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ startDate, endDate });

    fetch(`/api/ops/performance-targets/${storeId}/employees/${targetId}/calendar?${params.toString()}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.success) throw new Error(json.error ?? 'Gagal memuat data pencapaian.');
        setResult({
          key: requestKey,
          available: Boolean(json.available),
          days: json.days ?? [],
          totalSales: json.totalSales ?? 0,
          error: json.available ? null : (json.error ?? null),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setResult({
          key: requestKey,
          available: false,
          days: [],
          totalSales: 0,
          error: err instanceof Error ? err.message : 'Gagal memuat data pencapaian.',
        });
      });

    return () => { cancelled = true; };
  }, [storeId, targetId, startDate, endDate, requestKey]);

  const applyPreset = (preset: 'this_month' | 'last_month' | 'last_30') => {
    const currentMonth = today.slice(0, 7);
    if (preset === 'this_month') {
      setStartDate(`${currentMonth}-01`);
      setEndDate(lastDayOf(currentMonth));
    } else if (preset === 'last_month') {
      const prev = shiftYearMonth(currentMonth, -1);
      setStartDate(`${prev}-01`);
      setEndDate(lastDayOf(prev));
    } else {
      setStartDate(addDaysKey(today, -29));
      setEndDate(today);
    }
  };

  // Escape closes the modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const days = useMemo(() => (loading ? [] : result?.days ?? []), [loading, result]);

  const grid = useMemo(() => {
    if (days.length === 0) return [];
    const firstWeekday = (new Date(`${days[0].date}T00:00:00`).getDay() + 6) % 7; // Monday first
    const cells: (CalendarDay | null)[] = Array.from({ length: firstWeekday }, () => null);
    cells.push(...days);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [days]);

  const tally = useMemo(() => {
    let reached = 0;
    let missed = 0;
    for (const day of days) {
      const status = dayStatus(day, dailyTarget, today);
      if (status === 'reached') reached++;
      else if (status === 'missed') missed++;
    }
    const evaluated = reached + missed;
    return { reached, missed, rate: evaluated > 0 ? Math.round((reached / evaluated) * 100) : 0 };
  }, [days, dailyTarget, today]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Riwayat pencapaian ${employeeName}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4">
          <div className="min-w-0">
            <MicroLabel className="flex items-center gap-1.5 text-indigo-500">
              <Calendar className="h-3 w-3" /> Riwayat harian
            </MicroLabel>
            <h3 className="mt-0.5 truncate text-base font-bold text-slate-900">{employeeName}</h3>
            <p className="text-[11px] tabular-nums text-slate-400">Target harian {fmtRp(dailyTarget)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Pill onClick={() => applyPreset('this_month')}>Bulan ini</Pill>
          <Pill onClick={() => applyPreset('last_month')}>Bulan lalu</Pill>
          <Pill onClick={() => applyPreset('last_30')}>30 hari</Pill>
          <div className="ml-auto flex items-center gap-1.5">
            <input
              type="date"
              value={startDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
              aria-label="Dari tanggal"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <span className="text-slate-300">–</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => e.target.value && setEndDate(e.target.value)}
              aria-label="Sampai tanggal"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] tabular-nums focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">Memuat…</div>
          ) : !result?.available ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <p className="text-xs font-semibold">Data Business Central tidak tersedia{result?.error ? `: ${result.error}` : '.'}</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs font-semibold tabular-nums text-slate-400">
                {fmtShort(startDate)} – {fmtShort(endDate)}
              </p>

              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-emerald-50 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Tercapai
                  </p>
                  <p className="mt-0.5 text-xl font-black tabular-nums text-emerald-700">{tally.reached}</p>
                </div>
                <div className="rounded-xl bg-rose-50 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-600">
                    <XCircle className="h-3 w-3" /> Tidak
                  </p>
                  <p className="mt-0.5 text-xl font-black tabular-nums text-rose-700">{tally.missed}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <MicroLabel>Rate</MicroLabel>
                  <p className="mt-0.5 text-xl font-black tabular-nums text-slate-900">{tally.rate}%</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                  <MicroLabel>Total sales</MicroLabel>
                  <p className="mt-0.5 truncate text-xl font-black tabular-nums text-slate-900">
                    {fmtRpCompact(result.totalSales)}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                {grid.map((cell, i) => {
                  if (!cell) return <div key={i} />;
                  const status = dayStatus(cell, dailyTarget, today);
                  return (
                    <div
                      key={cell.date}
                      title={`${cell.date}: ${fmtRp(cell.actualSales)} / ${fmtRp(dailyTarget)}`}
                      className={cn('flex aspect-square flex-col items-center justify-center gap-0.5 rounded-lg border p-1', DAY_STYLES[status])}
                    >
                      <span className="text-[11px] font-bold">{Number(cell.date.slice(8, 10))}</span>
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
    </div>,
    document.body,
  );
}
