// app/employee/tasks/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  Circle,
  Clock,
  Paperclip,
  FileText,
  ChevronRight,
  Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import TaskDetailView from '@/components/employee/TaskDetailView';

// ─── Shared types ─────────────────────────────────────────────────────────────
export interface FormField {
  id: string;
  type: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'time';
  label: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  validation?: { min?: number; max?: number };
}

export interface TaskTemplate {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  recurrence: string;
  requiresForm: boolean;
  requiresAttachment: boolean;
  maxAttachments: number;
  formSchema: { fields: FormField[] } | null;
}

export interface EmployeeTask {
  id: string;
  taskId: string;
  userId: string;
  storeId: string;
  date: string;
  shift: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt: string | null;
  attachmentUrls: string[];
  formData: Record<string, unknown> | null;
  notes: string | null;
}

export interface AssignedTask {
  task: TaskTemplate;
  employeeTask: EmployeeTask;
  attendance: unknown;
}

type Filter = 'all' | 'pending' | 'in_progress' | 'completed';

const STATUS_CFG = {
  pending:     { Icon: Circle,       label: 'Pending',  iconCls: 'text-amber-500', bg: 'bg-amber-50'   },
  in_progress: { Icon: Clock,        label: 'Active',   iconCls: 'text-primary',   bg: 'bg-primary/5'  },
  completed:   { Icon: CheckCircle2, label: 'Done',     iconCls: 'text-green-600', bg: 'bg-green-50'   },
} as const;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',         label: 'All' },
  { key: 'pending',     label: 'Pending' },
  { key: 'in_progress', label: 'Active' },
  { key: 'completed',   label: 'Done' },
];

export default function EmployeeTasksPage() {
  const { data: session } = useSession();
  const [tasks, setTasks] = useState<AssignedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<AssignedTask | null>(null);

  const storeId = (session?.user as any)?.storeId ?? '';

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/employee/tasks?storeId=${storeId}`);
      const data = await res.json();
      setTasks(data.assignedTasks ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (session?.user) load();
  }, [session, load]);

  const handleTaskUpdate = () => {
    load();
    setSelected(null);
  };

  const openTask = async (item: AssignedTask) => {
    if (item.employeeTask.status === 'completed') return;

    if (item.employeeTask.status === 'pending') {
      const updated = {
        ...item,
        employeeTask: { ...item.employeeTask, status: 'in_progress' as const },
      };
      setTasks((prev) =>
        prev.map((t) => (t.employeeTask.id === item.employeeTask.id ? updated : t)),
      );
      setSelected(updated);
      await fetch('/api/employee/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: item.employeeTask.id, status: 'in_progress' }),
      });
    } else {
      setSelected(item);
    }
  };

  const count = (f: Filter) =>
    f === 'all' ? tasks.length : tasks.filter((t) => t.employeeTask.status === f).length;

  const filtered = tasks.filter((t) => filter === 'all' || t.employeeTask.status === filter);

  if (selected) return <TaskDetailView task={selected} onBack={handleTaskUpdate} />;

  return (
    <div className="flex flex-col">
      {/* ── Header ── */}
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

      {/* ── Filter tabs ── */}
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
              <span
                className={cn(
                  'flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                  filter === key
                    ? 'bg-white/20 text-primary-foreground'
                    : 'bg-border text-foreground',
                )}
              >
                {count(key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── List ── */}
      <div className="space-y-2.5 p-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-secondary" />
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">No tasks here</p>
            <p className="mt-1 text-xs text-muted-foreground">You&apos;re all caught up!</p>
          </div>
        ) : (
          filtered.map((item) => {
            const { status } = item.employeeTask;
            const cfg = STATUS_CFG[status];
            const StatusIcon = cfg.Icon;
            const isCompleted = status === 'completed';

            return (
              <Card
                key={item.employeeTask.id}
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
                    <div
                      className={cn(
                        'mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
                        cfg.bg,
                      )}
                    >
                      <StatusIcon className={cn('h-4 w-4', cfg.iconCls)} strokeWidth={2.5} />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-tight text-foreground">
                          {item.task.title}
                        </p>
                        {isCompleted && item.employeeTask.completedAt ? (
                          <span className="flex-shrink-0 text-[10px] font-medium text-green-600">
                            ✓{' '}
                            {new Date(item.employeeTask.completedAt).toLocaleTimeString('en-ID', {
                              hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        ) : (
                          !isCompleted && (
                            <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                          )
                        )}
                      </div>

                      {item.task.description && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {item.task.description}
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {status === 'in_progress' && (
                          <Badge className="h-4 gap-1 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary hover:bg-primary/10">
                            <Clock className="h-2.5 w-2.5" />
                            In Progress
                          </Badge>
                        )}
                        {item.task.requiresForm && (
                          <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                            <FileText className="h-2.5 w-2.5" />
                            Form
                          </Badge>
                        )}
                        {item.task.requiresAttachment && (
                          <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                            <Paperclip className="h-2.5 w-2.5" />
                            Photo
                          </Badge>
                        )}
                        {item.task.shift && (
                          <Badge
                            variant="secondary"
                            className="h-4 px-1.5 text-[10px] capitalize"
                          >
                            {item.task.shift}
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