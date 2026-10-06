'use client';
// app/ops/attendance/page.tsx

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Store, ArrowLeft, Download, X, CalendarDays, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { StoreCombobox } from '@/components/shared/store-combobox';
import { toast } from 'sonner';
import StoreAttendanceDetail from '@/components/ops/StoreAttendanceDetail';
import AttendanceExportModal from '@/components/ops/AttendanceExportModal';
import {
  ATTENDANCE_COUNT_ITEMS, AttendanceCountsLine, AttendanceStatusBadge, AttendanceStatusDot,
  HEALTH_STYLE, type RowStatus,
} from '@/components/ops/AttendanceStatus';
import {
  ATTENDANCE_GOOD_PCT, ATTENDANCE_RISK_PCT, LATE_HEAVY_MIN, LATE_HEAVY_RATE,
  EMPTY_COUNTS, HEALTH_LABEL,
  addCounts, attendanceHealth, attendanceRate, healthSeverity, isIssueHealth, isLateHeavy,
  type AttendanceCounts, type AttendanceHealth, type AttendanceMonthData, type StoreDayCounts,
} from '@/lib/attendance-health';
import type { AttendanceStatus } from '@/lib/attendance-status';
import { daysInMonthKey, jakartaDayStart, jakartaTime, jakartaTodayKey } from '@/lib/day-bucket';

// ─── Day / calendar helpers ───────────────────────────────────────────────────
// Every date here is a Jakarta "YYYY-MM-DD" key (never a browser-local Date), so
// the calendar shows the same days whatever zone the browser is in.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  // Noon UTC printed in UTC is that calendar day everywhere.
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-ID', { ...opts, timeZone: 'UTC' });
}

function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonthKey(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

// ─── Per-day roll-up ──────────────────────────────────────────────────────────

interface DayInfo {
  key:        string;
  stores:     StoreDayCounts[];
  /** All stores pooled — the day's colour and % come from this, so they always agree. */
  totals:     AttendanceCounts;
  rate:       number | null;
  health:     AttendanceHealth;
  /** Stores that day under 75% / 75–89% / with many late — the pills on the cell. */
  critical:   number;
  risk:       number;
  lateStores: number;
}

function buildDay(key: string, stores: StoreDayCounts[]): DayInfo {
  let totals = EMPTY_COUNTS;
  let critical = 0, risk = 0, lateStores = 0;
  for (const s of stores) {
    totals = addCounts(totals, s);
    const h = attendanceHealth(s);
    if (h === 'critical') critical++;
    else if (h === 'risk') risk++;
    if (isLateHeavy(s)) lateStores++;
  }
  return {
    key, stores, totals,
    rate: attendanceRate(totals),
    health: attendanceHealth(totals),
    critical, risk, lateStores,
  };
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

type PillTone = 'critical' | 'risk' | 'late';
const PILL: Record<PillTone, string> = {
  critical: 'bg-red-500 text-white',
  risk:     'bg-amber-400 text-amber-950',
  late:     'bg-fuchsia-500 text-white',
};

function Pill({ tone, title, children }: { tone: PillTone; title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className={cn('inline-flex min-w-4 items-center justify-center rounded-full px-1.5 py-px text-[9px] font-extrabold leading-tight tabular-nums', PILL[tone])}
    >
      {children}
    </span>
  );
}

// ─── Day cell ─────────────────────────────────────────────────────────────────
function DayCell({
  dateKey, info, singleStore, isToday, isUpcoming, isSelected, onClick,
}: {
  dateKey:     string;
  info:        DayInfo | undefined;
  singleStore: boolean;
  isToday:     boolean;
  isUpcoming:  boolean;
  isSelected:  boolean;
  onClick:     () => void;
}) {
  const hasData = !!info && info.totals.total > 0;
  // A day that hasn't happened yet has nothing to judge — keep it neutral
  // instead of calling it "pending".
  const tone    = !hasData || isUpcoming ? 'none' : info.health;
  const hs      = HEALTH_STYLE[tone];
  const day     = Number(dateKey.slice(8));
  const t       = info?.totals;

  const label = hasData
    ? isUpcoming
      ? `${fmtKey(dateKey, { day: 'numeric', month: 'long' })}: ${t!.total} scheduled`
      : `${fmtKey(dateKey, { day: 'numeric', month: 'long' })}: ${info.rate === null ? 'nothing counted yet' : `${info.rate}% attendance`}, ${HEALTH_LABEL[info.health]}`
    : `${fmtKey(dateKey, { day: 'numeric', month: 'long' })}: no schedules`;

  return (
    <button
      type="button"
      onClick={hasData ? onClick : undefined}
      disabled={!hasData}
      aria-label={label}
      aria-pressed={isSelected}
      className={cn(
        'relative flex min-h-[76px] w-full flex-col overflow-hidden rounded-lg border p-1.5 text-left transition-all duration-150 sm:min-h-[90px] sm:p-2',
        hasData
          ? cn('cursor-pointer hover:-translate-y-px hover:shadow-md', hs.light, hs.border)
          : 'cursor-default border-border/50 bg-background',
        isSelected && cn('ring-2 ring-offset-0', hs.ring),
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold sm:h-6 sm:w-6 sm:text-xs',
          isToday ? 'bg-indigo-600 text-white' : hasData ? 'text-foreground' : 'text-muted-foreground/60',
        )}>
          {day}
        </span>

        {hasData && !isUpcoming && info.rate !== null && (
          <span className={cn('pt-0.5 text-[10px] font-extrabold leading-none tabular-nums', hs.text)}>
            {info.rate}%
          </span>
        )}
      </div>

      {hasData && isUpcoming && (
        <p className="mt-auto pt-1 text-[9px] font-medium text-muted-foreground">{t!.total} scheduled</p>
      )}

      {/* What to look at: in all-stores mode, how many stores had trouble that day;
          in single-store mode, how many people were absent / late. */}
      {hasData && !isUpcoming && (
        <div className="mt-auto flex flex-wrap gap-0.5 pt-1.5">
          {singleStore ? (
            <>
              {t!.absent > 0 && <Pill tone="critical" title={`${t!.absent} absent`}>{t!.absent} absent</Pill>}
              {t!.late   > 0 && <Pill tone="late" title={`${t!.late} late`}>{t!.late} late</Pill>}
            </>
          ) : (
            <>
              {info.critical   > 0 && <Pill tone="critical" title={`${info.critical} store${info.critical > 1 ? 's' : ''} under ${ATTENDANCE_RISK_PCT}%`}>{info.critical}</Pill>}
              {info.risk       > 0 && <Pill tone="risk"     title={`${info.risk} store${info.risk > 1 ? 's' : ''} at ${ATTENDANCE_RISK_PCT}–${ATTENDANCE_GOOD_PCT - 1}%`}>{info.risk}</Pill>}
              {info.lateStores > 0 && <Pill tone="late"     title={`${info.lateStores} store${info.lateStores > 1 ? 's' : ''} with many late`}>{info.lateStores}</Pill>}
            </>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────
function SummaryBar({ totals }: { totals: AttendanceCounts }) {
  const rate   = attendanceRate(totals);
  const health = attendanceHealth(totals);
  const hs     = HEALTH_STYLE[health];

  const tiles: { label: string; value: number; color: string; hint: string }[] = [
    { label: 'Scheduled', value: totals.total, color: 'text-foreground', hint: 'Working shifts scheduled this month' },
    ...ATTENDANCE_COUNT_ITEMS.map((i) => ({ label: i.label, value: totals[i.key], color: i.text, hint: i.hint })),
  ];

  return (
    <div className="grid gap-4 rounded-xl border border-border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-center">
      <div className="flex items-center gap-4">
        <div className={cn('flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border', hs.light, hs.border)}>
          <span className={cn('text-xl font-black tabular-nums', hs.text)}>{rate === null ? '—' : `${rate}%`}</span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Attendance rate</p>
          <p className={cn('text-sm font-bold', hs.text)}>{HEALTH_LABEL[health]}</p>
          <p className="text-[11px] leading-snug text-muted-foreground">
            (Present + late) ÷ (present + late + absent). Pending and leave aren&apos;t counted.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
        {tiles.map((t) => (
          <div key={t.label} title={t.hint} className="rounded-lg bg-secondary/50 px-2 py-2 text-center">
            <p className={cn('text-lg font-bold tabular-nums leading-tight', t.color)}>{t.value}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── "Days to check" strip ────────────────────────────────────────────────────
function IssueDays({
  days, selectedKey, onSelect,
}: {
  days:        DayInfo[];
  selectedKey: string | null;
  onSelect:    (key: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        {days.length > 0
          ? <AlertTriangle className="h-4 w-4 text-amber-500" />
          : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <p className="text-xs font-bold text-foreground">Days to check</p>
        {days.length > 0 && (
          <span className="rounded-full bg-secondary px-1.5 text-[10px] font-black tabular-nums text-muted-foreground">
            {days.length}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground">worst first</span>
      </div>

      {days.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No day this month is under {ATTENDANCE_GOOD_PCT}% attendance or has many late.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {days.map((d) => {
            const hs = HEALTH_STYLE[d.health];
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => onSelect(d.key)}
                aria-pressed={d.key === selectedKey}
                title={`${HEALTH_LABEL[d.health]} · ${d.totals.absent} absent · ${d.totals.late} late`}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all hover:-translate-y-px hover:shadow-sm',
                  hs.light, hs.border,
                  d.key === selectedKey && cn('ring-2', hs.ring),
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', hs.bg)} />
                <span className="font-semibold text-foreground">{fmtKey(d.key, { weekday: 'short', day: 'numeric' })}</span>
                <span className={cn('font-extrabold tabular-nums', hs.text)}>{d.rate}%</span>
                {d.health === 'late'
                  ? <span className="text-[10px] font-medium text-fuchsia-700">{d.totals.late} late</span>
                  : d.totals.absent > 0 && <span className="text-[10px] font-medium text-muted-foreground">{d.totals.absent} absent</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend({ singleStore }: { singleStore: boolean }) {
  const tiers: { health: AttendanceHealth; text: string }[] = [
    { health: 'good',     text: `Good ≥ ${ATTENDANCE_GOOD_PCT}%` },
    { health: 'risk',     text: `At risk ${ATTENDANCE_RISK_PCT}–${ATTENDANCE_GOOD_PCT - 1}%` },
    { health: 'critical', text: `Critical < ${ATTENDANCE_RISK_PCT}%` },
    { health: 'late',     text: `Many late (≥ ${LATE_HEAVY_MIN} and ≥ ${Math.round(LATE_HEAVY_RATE * 100)}% of those present)` },
    { health: 'pending',  text: 'Pending — nothing recorded yet' },
  ];
  return (
    <div className="space-y-1 text-[10px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {tiers.map((t) => (
          <span key={t.health} className="flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', HEALTH_STYLE[t.health].bg)} />
            {t.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Number pills:</span>
        {singleStore ? (
          <>
            <span className="flex items-center gap-1"><Pill tone="critical" title="">n absent</Pill> people absent</span>
            <span className="flex items-center gap-1"><Pill tone="late" title="">n late</Pill> people late</span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1"><Pill tone="critical" title="">n</Pill> stores critical</span>
            <span className="flex items-center gap-1"><Pill tone="risk" title="">n</Pill> stores at risk</span>
            <span className="flex items-center gap-1"><Pill tone="late" title="">n</Pill> stores with many late</span>
          </>
        )}
        <span>· % = {singleStore ? "store's" : 'all stores'} attendance rate · click a day to expand</span>
      </div>
    </div>
  );
}

// ─── Day panel — all stores ──────────────────────────────────────────────────
type StoreFilter = 'all' | 'issues';

function AllStoresDayPanel({
  dateKey, info, storeById, onOpenStore, onViewStore, onClose,
}: {
  dateKey:     string;
  info:        DayInfo | undefined;
  storeById:   Map<number, { storeNo: string; name: string }>;
  onOpenStore: (id: number) => void;
  onViewStore: (id: number) => void;
  onClose:     () => void;
}) {
  const [filter, setFilter] = useState<StoreFilter>('all');

  const rows = useMemo(() => {
    const list = (info?.stores ?? [])
      .filter((s) => s.total > 0)
      .map((s) => ({
        s,
        health: attendanceHealth(s),
        rate:   attendanceRate(s),
        meta:   storeById.get(s.storeId),
      }));
    // Worst first: critical → at risk → many late → pending → good; lowest % first inside a tier.
    list.sort((a, b) =>
      healthSeverity(a.health) - healthSeverity(b.health)
      || (a.rate ?? 101) - (b.rate ?? 101)
      || (a.meta?.name ?? '').localeCompare(b.meta?.name ?? ''));
    return list;
  }, [info, storeById]);

  const issueCount = rows.filter((r) => isIssueHealth(r.health) || isLateHeavy(r.s)).length;
  const shown = filter === 'issues' ? rows.filter((r) => isIssueHealth(r.health) || isLateHeavy(r.s)) : rows;
  const dayHs = info ? HEALTH_STYLE[info.health] : HEALTH_STYLE.none;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {fmtKey(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {rows.length} store{rows.length !== 1 ? 's' : ''} scheduled
            {issueCount > 0 && <> · <span className="font-semibold text-red-600">{issueCount} need attention</span></>}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {info && info.totals.total > 0 && (
        <div className={cn('flex items-center gap-3 rounded-xl border p-3', dayHs.light, dayHs.border)}>
          <span className={cn('text-2xl font-black tabular-nums', dayHs.text)}>{info.rate === null ? '—' : `${info.rate}%`}</span>
          <div className="min-w-0">
            <p className={cn('text-[10px] font-bold uppercase tracking-wide', dayHs.text)}>
              Day total · {HEALTH_LABEL[info.health]}
            </p>
            <AttendanceCountsLine counts={info.totals} className="mt-0.5" />
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Store className="mb-2 h-7 w-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No schedules for this day</p>
        </div>
      ) : (
        <>
          <OpsChipTabs<StoreFilter>
            value={filter}
            onChange={setFilter}
            items={[
              { key: 'all',    label: 'All stores',      count: rows.length },
              { key: 'issues', label: 'Needs attention', count: issueCount, tone: 'rose' },
            ]}
          />

          {shown.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">No store needs attention this day.</p>
          ) : (
            <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-0.5">
              {shown.map(({ s, health, rate, meta }) => {
                const hs = HEALTH_STYLE[health];
                return (
                  <div
                    key={s.storeId}
                    className={cn('flex items-stretch rounded-xl border-2 transition-all duration-150 hover:shadow-sm', hs.light, hs.border)}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenStore(s.storeId)}
                      className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left"
                    >
                      <div className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border', hs.light, hs.border)}>
                        <Store className={cn('h-4 w-4', hs.text)} />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {meta && <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">{meta.storeNo}</span>}
                          {meta?.name ?? `Store ${s.storeId}`}
                        </p>
                        <AttendanceCountsLine counts={s} className="mt-0.5" />
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className={cn('text-sm font-extrabold tabular-nums', hs.text)}>
                          {rate === null ? '—' : `${rate}%`}
                        </span>
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/70">
                          <div className={cn('h-full rounded-full transition-all', hs.bg)} style={{ width: `${rate ?? 0}%` }} />
                        </div>
                        <span className={cn('text-[9px] font-bold uppercase tracking-wide', hs.text)}>
                          {HEALTH_LABEL[health]}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onViewStore(s.storeId)}
                      title="See this store's whole month"
                      aria-label={`See ${meta?.name ?? 'this store'}'s whole month`}
                      className={cn('flex w-9 flex-shrink-0 items-center justify-center rounded-r-[10px] border-l transition-colors hover:bg-white/70', hs.border, hs.text)}
                    >
                      <CalendarDays className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Day panel — one store (roster) ──────────────────────────────────────────
interface RosterRow {
  schedule:   { id: string; shiftLabel: string | null };
  user:       { name: string; employeeTypeLabel: string | null } | null;
  attendance: { status: AttendanceStatus; checkInTime: string | null; checkOutTime: string | null; onBreak: boolean } | null;
}

/** Problems first: absent, late, pending, leave, then everyone who's fine. */
function rosterRank(status: RowStatus): number {
  if (status === 'absent') return 0;
  if (status === 'late') return 1;
  if (status === 'pending') return 2;
  if (status === 'present') return 4;
  return 3;
}

// Remounted per store/day (`key`), so it starts loading from scratch each time.
function StoreDayRoster({ storeId, dateKey }: { storeId: number; dateKey: string }) {
  const [rows,   setRows]   = useState<RosterRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ops/attendance?storeId=${storeId}&date=${dateKey}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) setRows(json.data as RosterRow[]);
        else setFailed(true);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [storeId, dateKey]);

  const sorted = useMemo(() => {
    const status = (r: RosterRow): RowStatus => r.attendance?.status ?? 'pending';
    return [...(rows ?? [])].sort((a, b) =>
      rosterRank(status(a)) - rosterRank(status(b))
      || (a.user?.name ?? '').localeCompare(b.user?.name ?? ''));
  }, [rows]);

  if (failed) return <p className="py-6 text-center text-xs text-red-600">Couldn&apos;t load the roster.</p>;
  if (rows === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-secondary" />)}
      </div>
    );
  }
  if (sorted.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">No one is scheduled this day.</p>;

  return (
    <div className="divide-y divide-border">
      {sorted.map((r) => {
        const status = r.attendance?.status ?? 'pending';
        const checkIn = r.attendance?.checkInTime ? jakartaTime(r.attendance.checkInTime) : '';
        return (
          <div key={r.schedule.id} className="flex items-center gap-2.5 py-2">
            <AttendanceStatusDot status={status} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{r.user?.name ?? '—'}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {[r.user?.employeeTypeLabel, r.schedule.shiftLabel, checkIn && `in ${checkIn}`].filter(Boolean).join(' · ')}
              </p>
            </div>
            <AttendanceStatusBadge status={status} compact />
          </div>
        );
      })}
    </div>
  );
}

function StoreDayPanel({
  dateKey, info, storeId, storeName, onOpenStore, onClose,
}: {
  dateKey:     string;
  info:        DayInfo | undefined;
  storeId:     number;
  storeName:   string;
  onOpenStore: (id: number) => void;
  onClose:     () => void;
}) {
  const hs = info ? HEALTH_STYLE[info.health] : HEALTH_STYLE.none;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">
            {fmtKey(dateKey, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">{storeName}</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {info && info.totals.total > 0 && (
        <div className={cn('flex items-center gap-3 rounded-xl border p-3', hs.light, hs.border)}>
          <span className={cn('text-2xl font-black tabular-nums', hs.text)}>{info.rate === null ? '—' : `${info.rate}%`}</span>
          <div className="min-w-0">
            <p className={cn('text-[10px] font-bold uppercase tracking-wide', hs.text)}>{HEALTH_LABEL[info.health]}</p>
            <AttendanceCountsLine counts={info.totals} className="mt-0.5" />
          </div>
        </div>
      )}

      <StoreDayRoster key={`${storeId}-${dateKey}`} storeId={storeId} dateKey={dateKey} />

      <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => onOpenStore(storeId)}>
        Open full detail &amp; mark attendance
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OpsAttendancePage() {
  const todayKey = jakartaTodayKey();

  const [month,        setMonth]        = useState(todayKey.slice(0, 7));
  const [storeId,      setStoreId]      = useState<number | null>(null);
  // The last response, stamped with the month/store it was for.
  const [loaded,       setLoaded]       = useState<{ month: string; storeId: number | null; data: AttendanceMonthData } | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [selectedKey,  setSelectedKey]  = useState<string | null>(null);
  const [detailStore,  setDetailStore]  = useState<number | null>(null);
  const [exportOpen,   setExportOpen]   = useState(false);

  // Latest request wins — flipping month/store quickly must not let a slow
  // earlier response overwrite a newer one.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ month });
      if (storeId !== null) qs.set('storeId', String(storeId));
      const res  = await fetch(`/api/ops/attendance/overview?${qs}`, { cache: 'no-store' });
      const json = await res.json();
      if (id !== requestId.current) return;
      if (!json.success) throw new Error(json.error ?? 'Request failed');
      setLoaded({ month, storeId, data: json.data as AttendanceMonthData });
    } catch (e) {
      if (id !== requestId.current) return;
      toast.error(e instanceof Error ? e.message : 'Failed to load attendance');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [month, storeId]);

  useEffect(() => { load(); }, [load]);

  // Day numbers only show for the month + store they were loaded for — while a
  // switch is in flight the calendar goes blank rather than showing the
  // previous store's counts under the new store's name. The store list is the
  // same either way, so the picker keeps it from the last response.
  const stores = loaded?.data.stores;
  const data   = loaded && loaded.month === month && loaded.storeId === storeId ? loaded.data : null;

  const storeById = useMemo(
    () => new Map((stores ?? []).map((s) => [s.id, { storeNo: s.storeNo, name: s.name }])),
    [stores],
  );
  const exportStores = useMemo(
    () => (stores ?? []).map((s) => ({ id: String(s.id), name: s.name })),
    [stores],
  );

  const dayInfo = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const [key, stores] of Object.entries(data?.days ?? {})) {
      if (key.startsWith(`${month}-`)) map.set(key, buildDay(key, stores));
    }
    return map;
  }, [data, month]);

  const monthTotals = useMemo(
    () => [...dayInfo.values()].reduce((acc, d) => addCounts(acc, d.totals), EMPTY_COUNTS),
    [dayInfo],
  );

  // Days worth a look, worst first — judged on the day's own (pooled) rate, so
  // it matches the colour and % printed on that day's cell.
  const issueDays = useMemo(
    () => [...dayInfo.values()]
      .filter((d) => isIssueHealth(d.health))
      .sort((a, b) =>
        healthSeverity(a.health) - healthSeverity(b.health)
        || (a.rate ?? 101) - (b.rate ?? 101)
        || a.key.localeCompare(b.key)),
    [dayInfo],
  );

  const cells         = useMemo(() => monthCells(month), [month]);
  const singleStore   = storeId !== null;
  const store         = storeId !== null ? storeById.get(storeId) : undefined;
  const selectedInfo  = selectedKey ? dayInfo.get(selectedKey) : undefined;
  const detailName    = detailStore !== null ? storeById.get(detailStore)?.name ?? `Store ${detailStore}` : '';

  const pickStore = (id: number | null) => {
    setStoreId(id);
    setDetailStore(null);
  };

  // ── Employee detail ───────────────────────────────────────────────────────
  if (detailStore !== null && selectedKey) {
    return (
      <div className="min-h-full bg-slate-50">
        <OpsPageHeader
          scope="OPS · Attendance"
          title={detailName}
          subtitle={fmtKey(selectedKey, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          contentClassName="w-full"
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 rounded-xl border-slate-200 bg-white font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  setDetailStore(null);
                  load(); // marking leave in the detail changes the counts
                }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 rounded-xl border-slate-200 bg-white font-semibold text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  window.open(
                    `/api/ops/attendance/export?storeId=${detailStore}&fromDate=${selectedKey}&toDate=${selectedKey}`,
                    '_blank',
                  );
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </>
          }
        />

        <div className="mx-auto max-w-7xl p-6 lg:p-8">
          <StoreAttendanceDetail storeId={String(detailStore)} date={jakartaDayStart(selectedKey)} />
        </div>
      </div>
    );
  }

  // ── Calendar view ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · People"
        title="Attendance"
        subtitle={
          singleStore && store
            ? <><span className="font-mono text-xs font-semibold text-slate-600">{store.storeNo}</span> {store.name} — daily attendance</>
            : 'Monthly overview — all stores'
        }
        periodProps={{
          period: 'monthly',
          date: `${month}-01`,
          onDateChange: (dateKey) => {
            setMonth(dateKey.slice(0, 7));
            setSelectedKey(null);
          },
        }}
        onRefresh={load}
        refreshing={loading}
        contentClassName="max-w-7xl"
        actions={
          <>
            <StoreCombobox
              stores={stores ?? []}
              value={storeId}
              onChange={pickStore}
              loading={!stores && loading}
              allLabel="All stores"
              className="h-10 w-64 max-w-none"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 rounded-xl border-slate-200 bg-white font-semibold text-slate-600 hover:bg-slate-50"
              onClick={() => setExportOpen(true)}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-7xl space-y-4 p-6 lg:p-8">
        {monthTotals.total > 0 && <SummaryBar totals={monthTotals} />}

        {!loading && data && monthTotals.total === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            {singleStore && store ? `${store.name} has no schedules` : 'No schedules'} in{' '}
            {fmtKey(`${month}-01`, { month: 'long', year: 'numeric' })}.
          </div>
        )}

        {monthTotals.total > 0 && (
          <IssueDays
            days={issueDays}
            selectedKey={selectedKey}
            onSelect={(key) => setSelectedKey(key)}
          />
        )}

        <Legend singleStore={singleStore} />

        {/* Calendar + side panel (panel sits below the calendar on small screens) */}
        <div className="flex flex-col items-start gap-4 lg:flex-row">
          <div className={cn('w-full min-w-0 flex-1 transition-all', selectedKey && 'lg:max-w-[56%]')}>
            <div className="mb-1 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((d) => (
                <div key={d} className="py-1 text-center text-[9px] font-bold uppercase tracking-widest text-muted-foreground sm:text-[10px]">
                  {d}
                </div>
              ))}
            </div>

            <div className={cn('grid grid-cols-7 gap-1', loading && 'pointer-events-none opacity-50')}>
              {cells.map((key, i) => {
                if (!key) return <div key={`e-${i}`} className="min-h-[76px] sm:min-h-[90px]" />;
                return (
                  <DayCell
                    key={key}
                    dateKey={key}
                    info={dayInfo.get(key)}
                    singleStore={singleStore}
                    isToday={key === todayKey}
                    isUpcoming={key > todayKey}
                    isSelected={key === selectedKey}
                    onClick={() => setSelectedKey((prev) => (prev === key ? null : key))}
                  />
                );
              })}
            </div>
          </div>

          {selectedKey && (
            <div className="w-full flex-shrink-0 lg:sticky lg:top-28 lg:w-[44%]">
              <div className="min-h-[200px] rounded-xl border border-border bg-card p-4 shadow-sm lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
                {singleStore && storeId !== null ? (
                  <StoreDayPanel
                    dateKey={selectedKey}
                    info={selectedInfo}
                    storeId={storeId}
                    storeName={store ? `${store.storeNo} · ${store.name}` : `Store ${storeId}`}
                    onOpenStore={setDetailStore}
                    onClose={() => setSelectedKey(null)}
                  />
                ) : (
                  <AllStoresDayPanel
                    dateKey={selectedKey}
                    info={selectedInfo}
                    storeById={storeById}
                    onOpenStore={setDetailStore}
                    onViewStore={pickStore}
                    onClose={() => setSelectedKey(null)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <AttendanceExportModal
          key={storeId ?? 'all'}
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          stores={exportStores}
          defaultStoreId={storeId !== null ? String(storeId) : undefined}
        />
      </div>
    </div>
  );
}
