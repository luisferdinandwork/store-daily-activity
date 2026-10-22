'use client';
// components/ops/dashboard/TrendChart.tsx
//
// The Ops Dashboard's lead chart: task completion % and attendance % over a
// chosen period, as two thin lines on one 0–100% axis. Hover (or ←/→ when
// focused) moves a crosshair that reads both values for that day; the table
// toggle shows every number without hovering. Data: GET /api/ops/dashboard/trend.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Table2, TrendingUp } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useApi } from '@/lib/client/use-api';
import {
  TREND_PERIODS,
  bucketTrend,
  trendAverage,
  type TrendPeriod,
  type TrendPoint,
  type TrendResponse,
} from '@/lib/ops-trend';

// Validated pair (dataviz reference palette, categorical slots 1–2).
const SERIES = [
  { key: 'tasks', label: 'Task selesai', color: '#2a78d6' },
  { key: 'attendance', label: 'Kehadiran', color: '#eb6834' },
] as const;

type SeriesKey = (typeof SERIES)[number]['key'];

const HEIGHT = 240;
const PAD = { top: 12, right: 16, bottom: 28, left: 40 };
const Y_TICKS = [0, 25, 50, 75, 100];

const rateOf = (p: TrendPoint, key: SeriesKey) => (key === 'tasks' ? p.tasks.rate : p.attendance.rate);

function dayLabel(key: string, withWeekday = false): string {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('id-ID', {
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function pointLabel(p: TrendPoint): string {
  return p.date === p.end ? dayLabel(p.date, true) : `${dayLabel(p.date)} – ${dayLabel(p.end)}`;
}

/** Split a series into runs of consecutive points that have a value (gaps stay gaps). */
function segments(xs: number[], ys: (number | null)[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  ys.forEach((y, i) => {
    if (y === null) {
      if (run.length) out.push(run.join(' '));
      run = [];
      return;
    }
    run.push(`${run.length ? 'L' : 'M'}${xs[i].toFixed(1)},${y.toFixed(1)}`);
  });
  if (run.length) out.push(run.join(' '));
  return out;
}

export default function TrendChart({ className }: { className?: string }) {
  const [period, setPeriod] = useState<TrendPeriod>('30d');
  const [showTable, setShowTable] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const api = useApi<TrendResponse>(`/api/ops/dashboard/trend?period=${period}`);
  // Refetch keeps the frame: hold the last good render while a new period loads.
  const [last, setLast] = useState<TrendResponse | null>(null);
  if (api.data?.success && api.data !== last) setLast(api.data);
  const shown = api.data?.success ? api.data : last;
  const reloading = !api.data?.success && api.validating && !!last;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = useMemo(() => (shown ? bucketTrend(shown.points, shown.period) : []), [shown]);
  const hasData = points.some((p) => p.tasks.rate !== null || p.attendance.rate !== null);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const xs = points.map((_, i) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2));
  const yOf = (rate: number) => PAD.top + plotH - (rate / 100) * plotH;

  // ~7 evenly spaced x labels, always including the last point.
  const xTicks = useMemo(() => {
    if (!points.length) return [];
    const step = Math.max(1, Math.ceil(points.length / 7));
    const idx = points.map((_, i) => i).filter((i) => i % step === 0);
    if (idx[idx.length - 1] !== points.length - 1) {
      if (points.length - 1 - idx[idx.length - 1] < step / 2) idx.pop();
      idx.push(points.length - 1);
    }
    return idx;
  }, [points]);

  const nearest = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !points.length) return null;
    const x = clientX - rect.left;
    let best = 0;
    xs.forEach((px, i) => { if (Math.abs(px - x) < Math.abs(xs[best] - x)) best = i; });
    return best;
  };

  const activePoint = active !== null ? points[active] : null;
  const markers = points.length <= 14;

  return (
    <section
      aria-label="Tren task dan kehadiran"
      className={cn('rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:p-6', className)}
    >
      {/* Header: title + period, then the legend (with each line's average for the period) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <TrendingUp className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Tren Task &amp; Kehadiran</h2>
            <p className="text-xs text-slate-500">
              {shown ? `${dayLabel(shown.from)} – ${dayLabel(shown.to)}` : 'Memuat…'}
              {shown?.period === '90d' && ' · per minggu'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Periode" className="inline-flex h-9 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-0.5">
            {TREND_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={period === p.key}
                onClick={() => { setPeriod(p.key); setActive(null); }}
                className={cn(
                  'h-full rounded-lg px-3 text-xs font-semibold transition',
                  period === p.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            title={showTable ? 'Tampilkan grafik' : 'Tampilkan tabel'}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl border transition',
              showTable ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50',
            )}
          >
            <Table2 className="h-4 w-4" />
            <span className="sr-only">{showTable ? 'Tampilkan grafik' : 'Tampilkan tabel'}</span>
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1.5">
        {SERIES.map((s) => {
          const avg = trendAverage(points, s.key);
          return (
            <span key={s.key} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
              {s.label}
              <span className="font-semibold text-slate-900">{avg === null ? '—' : `${avg}%`}</span>
              <span className="text-slate-400">rata-rata</span>
            </span>
          );
        })}
      </div>

      {showTable ? (
        <div className="mt-4 max-h-[260px] overflow-auto rounded-xl border border-slate-100">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-medium">{shown?.period === '90d' ? 'Minggu' : 'Tanggal'}</th>
                <th className="px-4 py-2 text-right font-medium">Task selesai</th>
                <th className="px-4 py-2 text-right font-medium">Kehadiran</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-700">{pointLabel(p)}</td>
                  <td className="px-4 py-2 text-right text-slate-900">
                    {p.tasks.rate === null ? '—' : `${p.tasks.rate}%`}
                    <span className="ml-1.5 text-xs text-slate-400">{p.tasks.completed}/{p.tasks.total}</span>
                  </td>
                  <td className="px-4 py-2 text-right text-slate-900">
                    {p.attendance.rate === null ? '—' : `${p.attendance.rate}%`}
                    <span className="ml-1.5 text-xs text-slate-400">{p.attendance.showed}/{p.attendance.counted}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          ref={boxRef}
          className={cn('relative mt-3 outline-none transition-opacity', reloading && 'opacity-50')}
          style={{ height: HEIGHT }}
          tabIndex={points.length ? 0 : -1}
          role="img"
          aria-label={`Grafik garis task selesai dan kehadiran, ${points.length} titik. Gunakan panah kiri/kanan untuk membaca nilai.`}
          onPointerMove={(e) => setActive(nearest(e.clientX))}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((a) => a ?? (points.length ? points.length - 1 : null))}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (!points.length) return;
            if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(0, (a ?? points.length) - 1)); }
            if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1)); }
          }}
        >
          {!shown && api.loading ? (
            <div className="h-full animate-pulse rounded-xl bg-slate-50" />
          ) : width > 0 && (
            <svg width={width} height={HEIGHT} className="block overflow-visible">
              {/* Recessive grid + y labels */}
              {Y_TICKS.map((t) => (
                <g key={t}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="#eef0f3" strokeWidth={1} />
                  <text x={PAD.left - 10} y={yOf(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
                    {t}%
                  </text>
                </g>
              ))}
              {xTicks.map((i) => (
                <text key={points[i].date} x={xs[i]} y={HEIGHT - 6} textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'} className="fill-slate-400 text-[11px]">
                  {dayLabel(points[i].date, points.length <= 7)}
                </text>
              ))}

              {/* Crosshair */}
              {active !== null && (
                <line x1={xs[active]} x2={xs[active]} y1={PAD.top} y2={PAD.top + plotH} stroke="#cbd5e1" strokeWidth={1} />
              )}

              {/* Lines */}
              {SERIES.map((s) => {
                const ys = points.map((p) => { const r = rateOf(p, s.key); return r === null ? null : yOf(r); });
                const lastIdx = ys.map((y, i) => (y === null ? -1 : i)).filter((i) => i >= 0).pop();
                return (
                  <g key={s.key}>
                    {segments(xs, ys).map((d, i) => (
                      <path key={i} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    ))}
                    {/* A lone point between gaps still needs a mark */}
                    {ys.map((y, i) => {
                      const lone = y !== null && (i === 0 || ys[i - 1] === null) && (i === ys.length - 1 || ys[i + 1] === null);
                      const show = y !== null && (markers || lone || i === lastIdx || i === active);
                      return show ? (
                        <circle key={i} cx={xs[i]} cy={y!} r={i === active ? 5 : 4} fill={s.color} stroke="#ffffff" strokeWidth={2} />
                      ) : null;
                    })}
                  </g>
                );
              })}
            </svg>
          )}

          {shown && !hasData && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">Belum ada data pada periode ini.</p>
          )}

          {/* Tooltip — values lead, labels follow */}
          {activePoint && width > 0 && (
            <div
              className="pointer-events-none absolute top-1 z-10 w-64 rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur"
              style={{ left: Math.max(0, xs[active!] + 280 > width ? xs[active!] - 268 : xs[active!] + 12) }}
            >
              <p className="font-semibold text-slate-700">{pointLabel(activePoint)}</p>
              <div className="mt-2 space-y-1.5">
                {SERIES.map((s) => {
                  const r = rateOf(activePoint, s.key);
                  const detail = s.key === 'tasks'
                    ? `${activePoint.tasks.completed}/${activePoint.tasks.total} task`
                    : `${activePoint.attendance.showed}/${activePoint.attendance.counted} hadir`;
                  return (
                    <div key={s.key} className="flex items-center gap-2 whitespace-nowrap">
                      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="text-sm font-semibold tabular-nums text-slate-900">{r === null ? '—' : `${r}%`}</span>
                      <span className="text-slate-500">{s.label}</span>
                      <span className="ml-auto tabular-nums text-slate-400">{detail}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
