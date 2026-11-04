'use client';
// components/ops/areas/AreaCalendar.tsx
//
// The month calendar at the top of Area Management (OPS HO + IT): two tabs —
// Attendance and Task — and every day shows each area's % as a coloured pill.
//
// Colours are NOT defined here: Attendance pills use the Attendance calendar's
// health bands (HEALTH_STYLE: ≥ 90 good · 75–89 at risk · < 75 critical · many
// late · pending) and Task pills use the Task Progress heat steps (HEAT_STEPS:
// 100 · 80–99 · 50–79 · 1–49 · 0). Retune them in lib/status-theme.ts and this
// page follows. Click a day (or "Ringkasan bulan") for the area-by-area list,
// open an area to see its stores worst-first, "Kelola" opens its settings.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { HEAT_STEPS, TONES, heatStep, rateTone } from '@/lib/status-theme';
import { jakartaTodayKey } from '@/lib/day-bucket';
import {
  ATTENDANCE_GOOD_PCT, ATTENDANCE_RISK_PCT, HEALTH_LABEL, attendanceHealth,
  type AttendanceHealth,
} from '@/lib/attendance-health';
import {
  figuresRate, hasFigures, monthGrid, pooled, rollUpByArea, shiftMonth,
  type AreaCalendarData, type CalendarMetric, type Figures,
} from '@/lib/area-calendar';
import { AttendanceCountsLine, HEALTH_STYLE } from '@/components/status/AttendanceStatus';

export interface CalendarArea {
  id: number;
  name: string;
  color: string;
  opsUserName: string | null;
}

// ─── Words + dates ───────────────────────────────────────────────────────────

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

const METRICS: { key: CalendarMetric; label: string }[] = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'task', label: 'Task' },
];

/** Noon UTC printed in UTC is that calendar day everywhere. */
function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('id-ID', { ...opts, timeZone: 'UTC' });
}

// ─── The one place a figure becomes a colour ─────────────────────────────────

interface Look {
  /** Fill + text of the pill (a whole class string from the shared theme). */
  cls: string;
  /** "92%", or "—" while nobody is countable yet. */
  label: string;
  /** Text-only colour, for a figure on white. */
  text: string;
  /** Sort key for worst-first lists (lower = worse; nulls last). */
  rank: number;
  /** For the tooltip. */
  words: string;
}

function lookOf(f: Figures, metric: CalendarMetric): Look {
  const rate = figuresRate(f, metric);
  if (metric === 'attendance') {
    const health: AttendanceHealth = attendanceHealth(f.att);
    const hs = HEALTH_STYLE[health];
    return {
      cls: hs.solid,
      label: rate === null ? '—' : `${rate}%`,
      text: hs.text,
      rank: rate === null ? 101 : rate,
      words: `${rate === null ? 'belum ada data' : `${rate}%`} · ${HEALTH_LABEL[health]}`,
    };
  }
  const pct = rate ?? 0;
  const step = heatStep(pct);
  return {
    cls: step.cell,
    label: `${pct}%`,
    text: TONES[rateTone(pct)].strong,
    rank: pct,
    words: `${f.done}/${f.total} tugas selesai`,
  };
}

// ─── Legend ──────────────────────────────────────────────────────────────────

function Legend({ metric }: { metric: CalendarMetric }) {
  const items: { cls: string; label: string }[] =
    metric === 'attendance'
      ? [
          { cls: HEALTH_STYLE.good.bg, label: `Good ≥ ${ATTENDANCE_GOOD_PCT}%` },
          { cls: HEALTH_STYLE.risk.bg, label: `At risk ${ATTENDANCE_RISK_PCT}–${ATTENDANCE_GOOD_PCT - 1}%` },
          { cls: HEALTH_STYLE.critical.bg, label: `Critical < ${ATTENDANCE_RISK_PCT}%` },
          { cls: HEALTH_STYLE.late.bg, label: 'Many late' },
          { cls: HEALTH_STYLE.pending.bg, label: 'Pending' },
        ]
      : HEAT_STEPS.map((s) => ({ cls: s.swatch, label: s.label }));
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-500">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className={cn('h-2.5 w-2.5 rounded-[3px]', i.cls)} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export default function AreaCalendar({
  areas, version, onManage,
}: {
  areas: CalendarArea[];
  /** Bumped by the host whenever areas/stores changed, so the calendar reloads. */
  version: number;
  onManage: (areaId: number) => void;
}) {
  const todayKey = jakartaTodayKey();
  const [metric, setMetric] = useState<CalendarMetric>('attendance');
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  // The last answer, tagged with what it answered; "loading" = it isn't for the
  // month + version on screen yet (the previous month stays visible, dimmed).
  const [result, setResult] = useState<{ key: string; data: AreaCalendarData | null; error: string | null } | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [openArea, setOpenArea] = useState<number | null>(null);

  const requestKey = `${month}:${version}`;
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error : null;

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/ops/areas/calendar?month=${month}`, { cache: 'no-store', signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat kalender');
        setResult({ key: requestKey, data: json.data as AreaCalendarData, error: null });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setResult((cur) => ({
          key: requestKey,
          data: cur?.data ?? null,
          error: e instanceof Error ? e.message : 'Gagal memuat kalender',
        }));
      });
    return () => ctrl.abort();
  }, [month, requestKey]);

  const byDay = useMemo(() => (data ? rollUpByArea(data) : null), [data]);

  /** Areas that have at least one active store, in the table's order. */
  const shownAreas = useMemo(() => {
    const withStores = new Set(data?.stores.map((s) => s.areaId));
    return areas.filter((a) => withStores.has(a.id));
  }, [areas, data]);

  const storesByArea = useMemo(() => {
    const map = new Map<number, AreaCalendarData['stores']>();
    for (const s of data?.stores ?? []) map.set(s.areaId, [...(map.get(s.areaId) ?? []), s]);
    return map;
  }, [data]);

  const cells = useMemo(() => monthGrid(month), [month]);
  const isCurrentMonth = month === todayKey.slice(0, 7);

  function changeMonth(next: string) {
    setMonth(next);
    setSelectedDay(null);
    setOpenArea(null);
  }

  // The panel: the picked day, else the whole month pooled per area.
  const panelRows = useMemo(() => {
    if (!data || !byDay) return [];
    return shownAreas
      .map((a) => {
        const figures = selectedDay
          ? byDay.get(selectedDay)?.get(a.id)
          : pooled([...byDay.values()].map((perArea) => perArea.get(a.id)));
        return { area: a, figures: hasFigures(figures, metric) ? figures : null };
      })
      .sort((x, y) => {
        const rx = x.figures ? lookOf(x.figures, metric).rank : 1000;
        const ry = y.figures ? lookOf(y.figures, metric).rank : 1000;
        return rx - ry || x.area.name.localeCompare(y.area.name);
      });
  }, [data, byDay, shownAreas, selectedDay, metric]);

  function storeRows(areaId: number) {
    if (!data) return [];
    const rows = (storesByArea.get(areaId) ?? []).map((s) => {
      const figures = selectedDay
        ? data.days[selectedDay]?.[s.id]
        : pooled(Object.values(data.days).map((perStore) => perStore[s.id]));
      return { store: s, figures: hasFigures(figures, metric) ? figures : null };
    });
    return rows.sort((x, y) => {
      const rx = x.figures ? lookOf(x.figures, metric).rank : 1000;
      const ry = y.figures ? lookOf(y.figures, metric).rank : 1000;
      return rx - ry || x.store.name.localeCompare(y.store.name);
    });
  }

  const monthTitle = fmtKey(`${month}-01`, { month: 'long', year: 'numeric' });

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      {/* ── Header: tabs · month ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Metrik kalender" className="inline-flex rounded-xl bg-slate-100 p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={cn(
                'h-8 rounded-lg px-4 text-sm font-bold transition',
                metric === m.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {loading && <Loader2 className="mr-1 h-4 w-4 animate-spin text-slate-400" />}
          <button
            type="button"
            onClick={() => changeMonth(shiftMonth(month, -1))}
            aria-label="Bulan sebelumnya"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <p className="min-w-36 text-center text-sm font-bold capitalize text-slate-900">{monthTitle}</p>
          <button
            type="button"
            onClick={() => changeMonth(shiftMonth(month, 1))}
            aria-label="Bulan berikutnya"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => changeMonth(todayKey.slice(0, 7))}
              className="ml-1 h-9 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Bulan ini
            </button>
          )}
        </div>
      </div>

      <div className="mt-2.5">
        <Legend metric={metric} />
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">{error}</p>
      )}

      <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        {/* ── Month grid ── */}
        <div className={cn('min-w-0 transition-opacity', loading && data && 'opacity-60')}>
          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <p key={d} className="py-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">{d}</p>
            ))}
          </div>

          {!data && loading ? (
            <div className="h-96 animate-pulse rounded-xl bg-slate-100" />
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {cells.map((key, i) => {
                if (!key) return <div key={`pad-${i}`} className="min-h-24 rounded-lg bg-slate-50/50" />;
                const perArea = byDay?.get(key);
                const upcoming = key > todayKey;
                const pills = shownAreas.flatMap((a) => {
                  const f = perArea?.get(a.id);
                  return hasFigures(f, metric) ? [{ area: a, look: lookOf(f, metric) }] : [];
                });
                const clickable = pills.length > 0;
                const selected = selectedDay === key;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={!clickable}
                    onClick={() => { setSelectedDay(selected ? null : key); setOpenArea(null); }}
                    aria-pressed={selected}
                    aria-label={`${fmtKey(key, { day: 'numeric', month: 'long' })}${clickable ? '' : ': tidak ada data'}`}
                    className={cn(
                      'flex min-h-24 min-w-0 flex-col gap-0.5 rounded-lg border p-1 text-left transition',
                      clickable ? 'border-slate-200 bg-white hover:border-indigo-300 hover:shadow-sm' : 'cursor-default border-slate-100 bg-slate-50/40',
                      selected && 'border-indigo-400 ring-2 ring-indigo-200',
                    )}
                  >
                    <span
                      className={cn(
                        'mb-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                        key === todayKey ? 'bg-indigo-600 text-white' : upcoming || !clickable ? 'text-slate-300' : 'text-slate-600',
                      )}
                    >
                      {Number(key.slice(8))}
                    </span>
                    {pills.map(({ area, look }) => (
                      <span
                        key={area.id}
                        title={`${area.name}: ${look.words}`}
                        className={cn('flex items-center gap-1 rounded px-1 py-px text-[10px] font-semibold leading-snug', look.cls)}
                      >
                        <span className="min-w-0 flex-1 truncate">{area.name}</span>
                        <span className="shrink-0 font-extrabold tabular-nums">{look.label}</span>
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Panel: picked day, or the month ── */}
        <aside className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/50">
          <div className="flex items-start justify-between gap-2 border-b border-slate-200 px-3.5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                {selectedDay ? 'Detail hari' : 'Ringkasan bulan'}
              </p>
              <p className="truncate text-sm font-bold capitalize text-slate-900">
                {selectedDay ? fmtKey(selectedDay, { weekday: 'long', day: 'numeric', month: 'long' }) : monthTitle}
              </p>
              {!selectedDay && <p className="text-[11px] text-slate-400">Klik tanggal untuk melihat harinya</p>}
            </div>
            {selectedDay && (
              <button
                type="button"
                onClick={() => { setSelectedDay(null); setOpenArea(null); }}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <X className="h-3 w-3" /> Bulan
              </button>
            )}
          </div>

          {panelRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-slate-400">
              {loading ? 'Memuat…' : 'Belum ada area dengan toko aktif.'}
            </p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {panelRows.map(({ area, figures }) => {
                const look = figures ? lookOf(figures, metric) : null;
                const open = openArea === area.id;
                return (
                  <li key={area.id}>
                    <div className="flex items-center gap-2.5 px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => setOpenArea(open ? null : area.id)}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        <span
                          className={cn(
                            'flex h-9 w-12 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold tabular-nums',
                            look?.cls ?? 'bg-slate-100 text-slate-400',
                          )}
                        >
                          {look?.label ?? '—'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: area.color }} aria-hidden />
                            <span className="truncate text-sm font-bold text-slate-900">{area.name}</span>
                          </span>
                          <span className="block truncate text-[11px] text-slate-400">
                            {area.opsUserName ?? 'Belum ada Ops Area'} · {storesByArea.get(area.id)?.length ?? 0} toko
                          </span>
                          {figures && metric === 'attendance' && <AttendanceCountsLine counts={figures.att} className="mt-0.5" />}
                          {figures && metric === 'task' && (
                            <span className={cn('block text-[11px] font-semibold', look?.text)}>
                              {figures.done}/{figures.total} tugas selesai
                            </span>
                          )}
                        </span>
                        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onManage(area.id)}
                        aria-label={`Kelola ${area.name}`}
                        title="Kelola area"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-indigo-300 hover:text-indigo-700"
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                    </div>

                    {open && (
                      <ul className="space-y-1 bg-white px-3.5 pb-3 pt-1">
                        {storeRows(area.id).map(({ store, figures: sf }) => {
                          const sl = sf ? lookOf(sf, metric) : null;
                          return (
                            <li key={store.id} className="flex items-center gap-2 text-xs">
                              <span className={cn('w-11 shrink-0 rounded px-1 py-0.5 text-center text-[10px] font-extrabold tabular-nums', sl?.cls ?? 'bg-slate-100 text-slate-400')}>
                                {sl?.label ?? '—'}
                              </span>
                              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{store.name}</span>
                              <span className="shrink-0 font-mono text-[10px] text-slate-400">{store.storeNo}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
