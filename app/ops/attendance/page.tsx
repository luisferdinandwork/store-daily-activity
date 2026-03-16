'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  ChevronLeft, ChevronRight, RefreshCw, Store, ArrowLeft, Download, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import StoreAttendanceDetail from '@/components/ops/StoreAttendanceDetail';
import AttendanceExportModal from '@/components/ops/AttendanceExportModal';

// ─── Types ────────────────────────────────────────────────────────────────────
interface StoreAttendanceSummary {
  storeId:   string;
  storeName: string;
  total:     number;
  present:   number;
  absent:    number;
  late:      number;
  excused:   number;
  onBreak:   number;
  unset:     number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateLong(d: Date) {
  return d.toLocaleDateString('en-ID', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function monthLabel(d: Date) {
  return d.toLocaleDateString('en-ID', { month: 'long', year: 'numeric' });
}

type HealthStatus = 'good' | 'risk' | 'critical' | 'pending' | 'none';

function storeHealth(s: StoreAttendanceSummary): HealthStatus {
  if (s.total === 0) return 'none';
  const absentRate  = s.absent / s.total;
  const unsetRate   = s.unset / s.total;
  // Unset takes priority — if most records aren't marked yet, show pending first
  if (unsetRate > 0.3)                         return 'pending';
  if (absentRate >= 0.3)                       return 'critical';
  if (absentRate >= 0.15)                      return 'risk';
  return 'good';
}

function dayHealth(stores: StoreAttendanceSummary[]): HealthStatus {
  if (!stores.length) return 'none';
  const healths = stores.map(storeHealth);
  if (healths.every((h) => h === 'none'))       return 'none';
  if (healths.includes('critical'))             return 'critical';
  if (healths.includes('risk'))                 return 'risk';
  if (healths.includes('pending'))              return 'pending';
  return 'good';
}

function dayPresentPct(stores: StoreAttendanceSummary[]): number | null {
  const total   = stores.reduce((a, s) => a + s.total, 0);
  const present = stores.reduce((a, s) => a + s.present + s.late, 0);
  if (total === 0) return null;
  return Math.round((present / total) * 100);
}

const HC: Record<HealthStatus, { bg: string; ring: string; text: string; light: string; border: string }> = {
  good:     { bg: 'bg-emerald-500', ring: 'ring-emerald-300', text: 'text-emerald-700', light: 'bg-emerald-50',  border: 'border-emerald-200' },
  risk:     { bg: 'bg-amber-400',   ring: 'ring-amber-300',   text: 'text-amber-700',   light: 'bg-amber-50',    border: 'border-amber-200'   },
  critical: { bg: 'bg-red-500',     ring: 'ring-red-300',     text: 'text-red-700',     light: 'bg-red-50',      border: 'border-red-200'     },
  pending:  { bg: 'bg-sky-400',     ring: 'ring-sky-300',     text: 'text-sky-700',     light: 'bg-sky-50',      border: 'border-sky-200'     },
  none:     { bg: 'bg-slate-300',   ring: 'ring-slate-200',   text: 'text-slate-400',   light: 'bg-slate-50',    border: 'border-slate-100'   },
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Day cell ─────────────────────────────────────────────────────────────────
function DayCell({
  date, stores, isToday, isCurrentMonth, isSelected, onClick,
}: {
  date:           Date;
  stores:         StoreAttendanceSummary[];
  isToday:        boolean;
  isCurrentMonth: boolean;
  isSelected:     boolean;
  onClick:        () => void;
}) {
  const health   = dayHealth(stores);
  const pct      = dayPresentPct(stores);
  const hc       = HC[health];
  const hasData  = stores.some((s) => s.total > 0);
  const visible  = stores.filter((s) => s.total > 0).slice(0, 5);

  return (
    <button
      onClick={hasData ? onClick : undefined}
      disabled={!hasData}
      className={cn(
        'relative flex flex-col rounded-lg border p-1.5 sm:p-2 text-left',
        'min-h-[76px] sm:min-h-[90px] w-full transition-all duration-150',
        hasData
          ? cn('cursor-pointer hover:shadow-md hover:-translate-y-px', hc.light, hc.border)
          : 'cursor-default border-border/50 bg-background',
        isSelected && cn('ring-2 ring-offset-0', hc.ring),
        !isCurrentMonth && 'opacity-25 pointer-events-none',
      )}
    >
      {/* Date number */}
      <div className="flex items-start justify-between gap-1">
        <span className={cn(
          'flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-full text-[10px] sm:text-xs font-bold',
          isToday
            ? cn('text-white', hc.bg)
            : 'text-foreground',
        )}>
          {date.getDate()}
        </span>

        {hasData && pct !== null && (
          <span className={cn('text-[9px] font-extrabold tabular-nums leading-none pt-0.5', hc.text)}>
            {pct}%
          </span>
        )}
      </div>

      {/* Store dots */}
      {hasData && (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {visible.map((s) => {
            const sh = storeHealth(s);
            const sc = HC[sh];
            return (
              <span
                key={s.storeId}
                className={cn('h-1.5 w-1.5 rounded-full flex-shrink-0', sc.bg)}
                title={`${s.storeName}: ${Math.round(((s.present + s.late) / s.total) * 100)}%`}
              />
            );
          })}
          {stores.filter((s) => s.total > 0).length > 5 && (
            <span className="text-[8px] text-muted-foreground leading-none">
              +{stores.filter((s) => s.total > 0).length - 5}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

// ─── Day side-panel: store breakdown ─────────────────────────────────────────
function DayPanel({
  date, stores, onOpenStore, onClose,
}: {
  date:        Date;
  stores:      StoreAttendanceSummary[];
  onOpenStore: (s: { id: string; name: string }) => void;
  onClose:     () => void;
}) {
  const active = stores.filter((s) => s.total > 0);

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-foreground">
            {date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {active.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {active.length} store{active.length !== 1 ? 's' : ''} scheduled
            </p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {active.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <Store className="mb-2 h-7 w-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No schedules for this day</p>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto">
          {active.map((s) => {
            const health = storeHealth(s);
            const hc     = HC[health];
            const pct    = Math.round(((s.present + s.late) / s.total) * 100);
            const labels: Record<HealthStatus, string> = {
              good: 'Good', risk: 'At risk', critical: 'Critical', pending: 'Pending', none: '—',
            };

            return (
              <button
                key={s.storeId}
                onClick={() => onOpenStore({ id: s.storeId, name: s.storeName })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left',
                  'transition-all duration-150 hover:shadow-sm hover:-translate-y-px',
                  hc.light, hc.border,
                )}
              >
                {/* Icon */}
                <div className={cn(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border',
                  hc.light, hc.border,
                )}>
                  <Store className={cn('h-4 w-4', hc.text)} />
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground truncate">{s.storeName}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="text-emerald-600 font-medium">{s.present + s.late} present</span>
                    {s.absent > 0 && <span className="text-red-500">{s.absent} absent</span>}
                    {s.late   > 0 && <span className="text-amber-600">{s.late} late</span>}
                    {s.unset  > 0 && <span>{s.unset} unset</span>}
                  </div>
                </div>

                {/* Percentage */}
                <div className="flex flex-col items-end gap-1">
                  <span className={cn('text-sm font-extrabold tabular-nums', hc.text)}>
                    {pct}%
                  </span>
                  <div className="h-1.5 w-14 overflow-hidden rounded-full bg-white/70">
                    <div
                      className={cn('h-full rounded-full transition-all', hc.bg)}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={cn('text-[9px] font-bold uppercase tracking-wide', hc.text)}>
                    {labels[health]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OpsAttendancePage() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [exportOpen,    setExportOpen]    = useState(false);
  const [viewMonth,     setViewMonth]     = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [cache,         setCache]         = useState<Record<string, StoreAttendanceSummary[]>>({});
  const [loadingMonth,  setLoadingMonth]  = useState(false);
  const [selectedDate,  setSelectedDate]  = useState<Date | null>(null);
  const [activeStore,   setActiveStore]   = useState<{ id: string; name: string } | null>(null);

  const fetchMonth = useCallback(async (monthStart: Date) => {
    setLoadingMonth(true);
    try {
      const year  = monthStart.getFullYear();
      const month = monthStart.getMonth();
      const days  = new Date(year, month + 1, 0).getDate();

      const fetches = Array.from({ length: days }, (_, i) => {
        const d = new Date(year, month, i + 1);
        return fetch(`/api/ops/attendance/overview?date=${d.toISOString()}`)
          .then((r) => r.json())
          .then((json) => ({
            key:    toKey(d),
            stores: json.success ? (json.data as StoreAttendanceSummary[]) : [],
          }));
      });

      const results = await Promise.all(fetches);
      const patch: Record<string, StoreAttendanceSummary[]> = {};
      for (const { key, stores } of results) patch[key] = stores;
      setCache((prev) => ({ ...prev, ...patch }));
    } catch {
      toast.error('Failed to load month data');
    } finally {
      setLoadingMonth(false);
    }
  }, []);

  useEffect(() => { fetchMonth(viewMonth); }, [viewMonth, fetchMonth]);

  // Derive unique stores from cache for the Export Modal
  const storeList = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    Object.values(cache).forEach((stores) => {
      stores.forEach((s) => {
        if (!map.has(s.storeId)) {
          map.set(s.storeId, { id: s.storeId, name: s.storeName });
        }
      });
    });
    return Array.from(map.values());
  }, [cache]);

  const year       = viewMonth.getFullYear();
  const month      = viewMonth.getMonth();
  const firstDow   = new Date(year, month, 1).getDay();
  const daysInMth  = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const stepMonth = (delta: number) => {
    setViewMonth((p) => new Date(p.getFullYear(), p.getMonth() + delta, 1));
    setSelectedDate(null);
    setActiveStore(null);
  };

  // Aggregate stats for the visible month
  const monthStats = Object.entries(cache)
    .filter(([k]) => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`))
    .flatMap(([, stores]) => stores)
    .reduce((acc, s) => ({
      total:   acc.total   + s.total,
      present: acc.present + s.present + s.late,
      absent:  acc.absent  + s.absent,
    }), { total: 0, present: 0, absent: 0 });

  const selectedStores = selectedDate ? (cache[toKey(selectedDate)] ?? []) : [];

  // ── Employee detail ───────────────────────────────────────────────────────
  if (activeStore && selectedDate) {
    return (
      <div className="space-y-5 p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveStore(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">{activeStore.name}</h1>
            <p className="text-xs text-muted-foreground">{fmtDateLong(selectedDate)}</p>
          </div>
          <div className="ml-auto">
            <Button
              variant="outline" size="sm" className="gap-1.5"
              onClick={() => window.open(
                `/api/ops/attendance/export?storeId=${activeStore.id}&date=${selectedDate.toISOString()}`,
                '_blank',
              )}
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </Button>
          </div>
        </div>
        <StoreAttendanceDetail storeId={activeStore.id} date={selectedDate} />
      </div>
    );
  }

  // ── Calendar view ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Attendance</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Monthly overview — all stores</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" 
            size="sm" 
            className="gap-1.5"
            onClick={() => setExportOpen(true)}
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            variant="outline" 
            size="sm" 
            className="gap-1.5"
            onClick={() => fetchMonth(viewMonth)}
            disabled={loadingMonth}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loadingMonth && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Month stats bar */}
      {monthStats.total > 0 && (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2.5">
          <div className="text-center">
            <p className="text-lg font-bold text-foreground">{monthStats.total}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Scheduled</p>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-600">{monthStats.present}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Present</p>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="text-center">
            <p className="text-lg font-bold text-red-500">{monthStats.absent}</p>
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Absent</p>
          </div>
          <div className="mx-auto" />
          {/* Month progress bar */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">
              {monthStats.total > 0 ? Math.round((monthStats.present / monthStats.total) * 100) : 0}% attendance
            </span>
            <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${monthStats.total > 0 ? Math.round((monthStats.present / monthStats.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => stepMonth(-1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 rounded-xl border border-border bg-card px-4 py-2 text-center">
          <p className="text-sm font-semibold text-foreground">{monthLabel(viewMonth)}</p>
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => stepMonth(1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
        <span className="font-semibold text-xs">Each dot = one store:</span>
        {(['good', 'risk', 'critical', 'pending'] as const).map((h) => (
          <span key={h} className="flex items-center gap-1">
            <span className={cn('h-2 w-2 rounded-full', HC[h].bg)} />
            {{ good: 'Good', risk: 'At risk', critical: 'Critical', pending: 'Pending' }[h]}
          </span>
        ))}
        <span className="text-[10px]">· % = day-wide present rate · click a day to expand</span>
      </div>

      {/* Calendar + side panel */}
      <div className="flex gap-4 items-start">
        {/* Calendar */}
        <div className={cn('flex-1 min-w-0 transition-all', selectedDate ? 'lg:max-w-[56%]' : '')}>
          {/* Weekday headers */}
          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className={cn('grid grid-cols-7 gap-1', loadingMonth && 'opacity-50 pointer-events-none')}>
            {cells.map((date, i) => {
              if (!date) return <div key={`e-${i}`} className="min-h-[76px] sm:min-h-[90px]" />;
              const key        = toKey(date);
              const isToday    = key === toKey(today);
              const isCurrent  = date.getMonth() === month;
              const isSelected = selectedDate ? toKey(selectedDate) === key : false;
              const dayStores  = cache[key] ?? [];

              return (
                <DayCell
                  key={key}
                  date={date}
                  stores={dayStores}
                  isToday={isToday}
                  isCurrentMonth={isCurrent}
                  isSelected={isSelected}
                  onClick={() => {
                    setSelectedDate((prev) => prev && toKey(prev) === key ? null : date);
                    setActiveStore(null);
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        {selectedDate && (
          <div className="hidden lg:block lg:w-[44%] flex-shrink-0">
            <div className="sticky top-4 rounded-xl border border-border bg-card p-4 shadow-sm min-h-[200px]">
              <DayPanel
                date={selectedDate}
                stores={selectedStores}
                onOpenStore={setActiveStore}
                onClose={() => setSelectedDate(null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile: panel below calendar */}
      {selectedDate && (
        <div className="lg:hidden rounded-xl border border-border bg-card p-4 shadow-sm">
          <DayPanel
            date={selectedDate}
            stores={selectedStores}
            onOpenStore={setActiveStore}
            onClose={() => setSelectedDate(null)}
          />
        </div>
      )}

      {/* Export Modal */}
      <AttendanceExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        stores={storeList}
      />
    </div>
  );
}