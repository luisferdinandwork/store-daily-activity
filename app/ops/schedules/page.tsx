// app/ops/schedules/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession }    from 'next-auth/react';
import { Button }        from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge }         from '@/components/ui/badge';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  RefreshCw, Sun, Moon, Users, AlertCircle,
  Store, MapPin, Eye, Calendar, ChevronRight,
  Trash2, Loader2, FileSpreadsheet,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScheduleSummary {
  id:              string;
  yearMonth:       string;
  note:            string | null;
  createdAt:       string;
  updatedAt:       string;
  uniqueEmployees: number;
  morningShifts:   number;
  eveningShifts:   number;
  leaveDays:       number;
  totalEntries:    number;
}

interface Employee {
  id:           string;
  name:         string;
  employeeType: string | null;
  role:         string;
}

interface StoreData {
  storeId:          string;
  storeName:        string;
  address:          string;
  scheduleSummaries: ScheduleSummary[];
  employees:        Employee[];
  scheduledUserIds: string[];
  currentYearMonth: string | null;
}

interface AreaData {
  areaId:   string;
  areaName: string;
  stores:   StoreData[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

const EMP_LABEL: Record<string, string> = {
  pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO',
};

function formatYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

// ─── StoreSchedulePanel ───────────────────────────────────────────────────────

function StoreSchedulePanel({
  store,
  onDelete,
  onRematerialise,
}: {
  store:            StoreData;
  onDelete:         (id: string, storeName: string, yearMonth: string) => void;
  onRematerialise:  (storeId: string, yearMonth: string) => void;
}) {
  const { scheduleSummaries, employees, scheduledUserIds, storeName } = store;
  const unscheduled = employees.filter(e => !scheduledUserIds.includes(e.id));

  return (
    <div className="space-y-4">

      {/* Unscheduled alert */}
      {unscheduled.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-800">
            <span className="font-semibold">{unscheduled.length} employee{unscheduled.length !== 1 ? 's' : ''} not in current schedule: </span>
            {unscheduled.map(e => e.name).join(', ')}
          </div>
        </div>
      )}

      {/* Schedule cards */}
      {scheduleSummaries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-secondary/30 py-12 text-center">
          <FileSpreadsheet className="h-8 w-8 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-semibold text-muted-foreground">No schedules yet</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">PIC 1 can import a schedule from Excel.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {scheduleSummaries.map((ms) => (
            <div
              key={ms.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-foreground">{formatYearMonth(ms.yearMonth)}</p>
                    {ms.note && (
                      <span className="text-xs italic text-muted-foreground">"{ms.note}"</span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {ms.uniqueEmployees} employee{ms.uniqueEmployees !== 1 ? 's' : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      <Sun className="h-3 w-3 text-amber-500" />
                      {ms.morningShifts} morning
                    </span>
                    <span className="flex items-center gap-1">
                      <Moon className="h-3 w-3 text-violet-500" />
                      {ms.eveningShifts} evening
                    </span>
                    {ms.leaveDays > 0 && (
                      <span className="flex items-center gap-1 text-indigo-600">
                        <Calendar className="h-3 w-3" />
                        {ms.leaveDays} leave
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 gap-1.5">
                  <button
                    title="Re-materialise schedules"
                    onClick={() => onRematerialise(store.storeId, ms.yearMonth)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-secondary text-muted-foreground hover:bg-border"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title="Delete schedule"
                    onClick={() => onDelete(ms.id, storeName, ms.yearMonth)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-400 hover:bg-red-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Employee roster */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Store Employees ({employees.length})
        </p>
        <div className="flex flex-wrap gap-2">
          {employees.map(e => {
            const isScheduled = scheduledUserIds.includes(e.id);
            return (
              <div
                key={e.id}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-xs',
                  isScheduled
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800',
                )}
              >
                <span className="font-semibold">{e.name}</span>
                {e.employeeType && (
                  <span className="ml-1.5 opacity-60 uppercase text-[9px]">
                    {EMP_LABEL[e.employeeType] ?? e.employeeType}
                  </span>
                )}
              </div>
            );
          })}
          {employees.length === 0 && (
            <p className="text-xs text-muted-foreground italic">No employees assigned to this store.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsSchedulesPage() {
  const { data: session } = useSession();
  const opsUserId = (session?.user as any)?.id as string | undefined;

  const [areaData,    setAreaData]    = useState<AreaData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [activeStore, setActiveStore] = useState<string>('');
  const [remating,    setRemating]    = useState(false);

  const load = useCallback(async () => {
    if (!opsUserId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res  = await fetch('/api/ops/schedules/area');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to load');
      setAreaData(json.area);
      if (json.area?.stores?.length && !activeStore) {
        setActiveStore(json.area.stores[0].storeId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      toast.error(`Failed to load: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [opsUserId, activeStore]);

  useEffect(() => { if (opsUserId) load(); }, [opsUserId]); // eslint-disable-line

  async function handleDelete(id: string, storeName: string, yearMonth: string) {
    if (!confirm(`Delete the ${formatYearMonth(yearMonth)} schedule for ${storeName}? Attended days are preserved.`)) return;
    try {
      const res  = await fetch(`/api/ops/schedules/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(
        json.lockedCount > 0
          ? `Cleared — ${json.lockedCount} attended day(s) preserved`
          : 'Schedule deleted',
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function handleRematerialise(storeId: string, yearMonth: string) {
    setRemating(true);
    try {
      const res  = await fetch('/api/ops/schedules', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ storeId, yearMonth }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(`Re-materialised: ${json.schedulesCreated} schedules, ${json.openingTasksCreated} opening tasks, ${json.groomingTasksCreated} grooming tasks`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Materialisation failed');
    } finally {
      setRemating(false);
    }
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const allSummaries     = areaData?.stores.flatMap(s => s.scheduleSummaries) ?? [];
  const totalEmployees   = areaData?.stores.reduce((n, s) => n + s.employees.length, 0) ?? 0;
  const totalMorning     = allSummaries.reduce((n, ms) => n + ms.morningShifts, 0);
  const totalEvening     = allSummaries.reduce((n, ms) => n + ms.eveningShifts, 0);
  const totalUnscheduled = areaData?.stores.reduce((n, s) => {
    return n + s.employees.filter(e => !s.scheduledUserIds.includes(e.id)).length;
  }, 0) ?? 0;

  return (
    <div className="space-y-6 p-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Schedules</h1>
          {areaData && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {areaData.areaName} · {areaData.stores.length} store{areaData.stores.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load} disabled={loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {loadError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2.5 p-4">
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" className="ml-auto" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* OPS role callout */}
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="flex items-start gap-3 p-4">
          <Eye className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p>
              <strong>Your role here is oversight.</strong> Schedules are imported and managed
              by the PIC 1 of each store via Excel import. You can view all schedules across
              your area, re-materialise schedule rows if needed, or delete a month's schedule
              (attended days are always preserved).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Area-wide stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Stores in area',      value: areaData?.stores.length ?? 0, Icon: Store,  color: 'text-primary',     bg: 'bg-primary/10'  },
          { label: 'Employees total',     value: totalEmployees,               Icon: Users,  color: 'text-emerald-600', bg: 'bg-emerald-50'  },
          { label: 'Morning shifts',      value: totalMorning,                 Icon: Sun,    color: 'text-amber-600',   bg: 'bg-amber-50'    },
          { label: 'Evening shifts',      value: totalEvening,                 Icon: Moon,   color: 'text-violet-600',  bg: 'bg-violet-50'   },
        ].map(({ label, value, Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', bg)}>
                <Icon className={cn('h-5 w-5', color)} />
              </div>
              <div>
                <p className={cn('text-2xl font-bold', color)}>{loading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Unscheduled alert */}
      {!loading && totalUnscheduled > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              <strong>{totalUnscheduled} employee{totalUnscheduled !== 1 ? 's' : ''}</strong> across
              your area are not in the current month's schedule.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      )}

      {/* Per-store tabs */}
      {!loading && areaData && (
        <Tabs value={activeStore} onValueChange={setActiveStore}>
          <TabsList className="mb-4 h-auto w-full justify-start gap-1 rounded-xl bg-secondary p-1">
            {areaData.stores.map(s => {
              const unscheduledCount = s.employees.filter(
                e => !s.scheduledUserIds.includes(e.id),
              ).length;
              return (
                <TabsTrigger
                  key={s.storeId}
                  value={s.storeId}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <Store className="h-3.5 w-3.5" />
                  <span className="font-medium">{s.storeName}</span>
                  {unscheduledCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                      {unscheduledCount}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {areaData.stores.map(s => (
            <TabsContent key={s.storeId} value={s.storeId} className="mt-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    {s.storeName}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">{s.address}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StoreSchedulePanel
                    store={s}
                    onDelete={handleDelete}
                    onRematerialise={handleRematerialise}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* No area */}
      {!loading && !areaData && !loadError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-semibold">No area assigned</p>
            <p className="text-xs text-muted-foreground">
              Ask an admin to assign you to an area before you can view schedules.
            </p>
          </CardContent>
        </Card>
      )}

      {remating && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm text-background shadow-xl">
          <Loader2 className="h-4 w-4 animate-spin" />
          Re-materialising schedules…
        </div>
      )}
    </div>
  );
}