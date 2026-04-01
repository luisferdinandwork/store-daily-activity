'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Circle,
  Clock,
  Camera,
  ChevronRight,
  Inbox,
  Store,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import StoreOpeningTaskDetail from '@/components/employee/StoreOpeningTaskDetail';
import GroomingTaskDetail from '@/components/employee/GroomingTaskDetail';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskType = 'store_opening' | 'grooming';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface StoreOpeningTask {
  id: string;
  userId: string;
  storeId: string;
  scheduleId: string | null;
  attendanceId: string | null;
  date: string;
  shift: 'morning' | 'evening';
  cashDrawerAmount: number | null;
  allLightsOn: boolean | null;
  cleanlinessCheck: boolean | null;
  equipmentCheck: boolean | null;
  stockCheck: boolean | null;
  safetyCheck: boolean | null;
  openingNotes: string | null;
  storeFrontPhotos: string[];
  cashDrawerPhotos: string[];
  status: TaskStatus;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export interface GroomingTask {
  id: string;
  userId: string;
  storeId: string;
  scheduleId: string | null;
  attendanceId: string | null;
  date: string;
  shift: 'morning' | 'evening';
  uniformComplete: boolean | null;
  hairGroomed: boolean | null;
  nailsClean: boolean | null;
  accessoriesCompliant: boolean | null;
  shoeCompliant: boolean | null;
  groomingNotes: string | null;
  selfiePhotos: string[];
  status: TaskStatus;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
}

export type TaskItem =
  | { type: 'store_opening'; data: StoreOpeningTask }
  | { type: 'grooming';      data: GroomingTask };

type Filter = 'all' | 'pending' | 'in_progress' | 'completed';

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<TaskStatus, {
  Icon: React.ElementType; label: string; iconCls: string; bg: string;
}> = {
  pending:     { Icon: Circle,       label: 'Pending',     iconCls: 'text-amber-500', bg: 'bg-amber-50'  },
  in_progress: { Icon: Clock,        label: 'In Progress', iconCls: 'text-primary',   bg: 'bg-primary/5' },
  completed:   { Icon: CheckCircle2, label: 'Done',        iconCls: 'text-green-600', bg: 'bg-green-50'  },
};

const TASK_META: Record<TaskType, {
  title: string;
  description: string;
  Icon: React.ElementType;
}> = {
  store_opening: {
    title:       'Store Opening',
    description: 'Complete the opening checklist and upload photos.',
    Icon:        Store,
  },
  grooming: {
    title:       'Grooming Check',
    description: 'Confirm uniform compliance and upload a selfie.',
    Icon:        User,
  },
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'pending',     label: 'Pending' },
  { key: 'in_progress', label: 'Active' },
  { key: 'completed',   label: 'Done' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeTasksPage() {
  const { data: session, status: sessionStatus } = useSession();

  const [tasks,    setTasks]    = useState<TaskItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [filter,   setFilter]   = useState<Filter>('all');
  const [selected, setSelected] = useState<TaskItem | null>(null);

  // ── Load tasks ──────────────────────────────────────────────────────────────
  // FIX: old code guarded on `storeId` from session, which is not a standard
  // NextAuth field and may be undefined. The API now filters by userId (from
  // the server session cookie) so the client just calls the endpoint with no
  // extra params. Guard on sessionStatus instead so we wait for auth to settle.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch (e) {
      console.error('[EmployeeTasksPage] load error:', e);
    } finally {
      setLoading(false);
    }
  }, []); // no deps — the API reads userId from the server session cookie

  useEffect(() => {
    // Wait until NextAuth has finished resolving the session before fetching.
    // 'loading' status means auth is still in flight — don't fetch yet.
    // 'unauthenticated' means no session — nothing to show.
    if (sessionStatus === 'authenticated') {
      load();
    }
  }, [sessionStatus, load]);

  // ── Open a task (set in_progress if pending) ────────────────────────────────
  const openTask = async (item: TaskItem) => {
    if (item.data.status === 'completed') return;

    const taskType  = item.type;
    const taskId    = item.data.id;
    const isPending = item.data.status === 'pending';

    if (isPending) {
      // Optimistic update
      const updated: TaskItem =
        item.type === 'store_opening'
          ? { type: 'store_opening', data: { ...item.data, status: 'in_progress' as const } }
          : { type: 'grooming',      data: { ...item.data, status: 'in_progress' as const } };

      setTasks(prev => prev.map(t => (t.data.id === taskId ? updated : t)));
      setSelected(updated);

      await fetch('/api/employee/tasks', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId, taskType, status: 'in_progress' }),
      });
    } else {
      setSelected(item);
    }
  };

  const handleTaskUpdate = () => { load(); setSelected(null); };

  // ── Counts ──────────────────────────────────────────────────────────────────
  const count = (f: Filter) =>
    f === 'all' ? tasks.length : tasks.filter(t => t.data.status === f).length;

  const filtered = tasks.filter(t => filter === 'all' || t.data.status === filter);

  // ── Detail view ─────────────────────────────────────────────────────────────
  if (selected?.type === 'store_opening') {
    return <StoreOpeningTaskDetail task={selected.data} onBack={handleTaskUpdate} />;
  }
  if (selected?.type === 'grooming') {
    return <GroomingTaskDetail task={selected.data} onBack={handleTaskUpdate} />;
  }

  // ── List view ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden bg-primary px-6 pb-6 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
            Today
          </p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">My Tasks</h1>
          <p className="mt-1 text-xs text-primary-foreground/50">
            {new Date().toLocaleDateString('en-ID', {
              weekday: 'long', day: 'numeric', month: 'long',
            })}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all',
                filter === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:bg-border',
              )}
            >
              {label}
              <span className={cn(
                'flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                filter === key
                  ? 'bg-white/20 text-primary-foreground'
                  : 'bg-border text-foreground',
              )}>
                {count(key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <div className="space-y-2.5 p-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-secondary" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">No tasks here</p>
            <p className="mt-1 text-xs text-muted-foreground">You&apos;re all caught up!</p>
          </div>
        ) : (
          filtered.map(item => {
            const { status }  = item.data;
            const cfg         = STATUS_CFG[status];
            const meta        = TASK_META[item.type];
            const StatusIcon  = cfg.Icon;
            const TaskIcon    = meta.Icon;
            const isCompleted = status === 'completed';

            return (
              <Card
                key={item.data.id}
                className={cn(
                  'overflow-hidden border-border shadow-sm transition-all',
                  !isCompleted && 'cursor-pointer active:scale-[0.99]',
                  isCompleted && 'opacity-70',
                )}
                onClick={() => openTask(item)}
              >
                {status === 'in_progress' && (
                  <div className="h-0.5 w-full animate-pulse bg-primary" />
                )}
                {status === 'completed' && (
                  <div className="h-0.5 w-full bg-green-500" />
                )}

                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary">
                      <TaskIcon className="h-4 w-4 text-foreground" strokeWidth={2} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-tight text-foreground">
                          {meta.title}
                        </p>
                        {isCompleted && item.data.completedAt ? (
                          <span className="flex-shrink-0 text-[10px] font-medium text-green-600">
                            ✓{' '}
                            {new Date(item.data.completedAt).toLocaleTimeString('en-ID', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        ) : (
                          !isCompleted && (
                            <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          )
                        )}
                      </div>

                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {meta.description}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {/* Status */}
                        <Badge
                          className={cn(
                            'h-4 gap-1 px-1.5 text-[10px] font-semibold',
                            status === 'in_progress' && 'bg-primary/10 text-primary hover:bg-primary/10',
                            status === 'pending'     && 'bg-amber-50 text-amber-600 hover:bg-amber-50',
                            status === 'completed'   && 'bg-green-50 text-green-700 hover:bg-green-50',
                          )}
                        >
                          <StatusIcon className="h-2.5 w-2.5" />
                          {cfg.label}
                        </Badge>

                        {/* Photo required */}
                        <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                          <Camera className="h-2.5 w-2.5" />
                          Photo
                        </Badge>

                        {/* Shift */}
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px] capitalize">
                          {item.data.shift}
                        </Badge>

                        {/* Opening-only label */}
                        {item.type === 'store_opening' && (
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                            Opening
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}