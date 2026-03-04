// app/ops/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Users,
  RefreshCw,
  Plus,
  TrendingUp,
  CalendarDays,
  ListTodo,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
type DashboardData = {
  date: string;
  tasks: {
    total: number;
    pending: number;
    inProgress: number;
    completed: number;
    completionRate: number;
  };
  attendance: {
    scheduled: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
  };
  taskTemplates: {
    daily: number;
    weekly: number;
    monthly: number;
  };
  recentCompleted: Array<{
    employeeTask: { id: string; completedAt: string | null; shift: string };
    task: { id: string; title: string } | null;
    user: { id: string; name: string } | null;
  }>;
};

// Replace with session store ID
const STORE_ID = 'your-store-id';

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function todayFull() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ─── Stat card ────────────────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  highlight,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  highlight?: 'green' | 'amber' | 'red' | 'primary';
}) {
  const colorMap = {
    green: 'text-green-600',
    amber: 'text-amber-500',
    red: 'text-destructive',
    primary: 'text-primary',
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p
              className={`mt-1 text-3xl font-bold ${
                highlight ? colorMap[highlight] : 'text-foreground'
              }`}
            >
              {value}
            </p>
            {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
          </div>
          <div className="rounded-lg bg-secondary p-2 text-secondary-foreground">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function OpsDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/ops/dashboard?storeId=${STORE_ID}&date=${new Date().toISOString()}`,
      );
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg('');
    try {
      const res = await fetch('/api/ops/tasks/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: STORE_ID, createdBy: 'ops-user-id' }),
      });
      const json = await res.json();
      setGenMsg(
        json.success
          ? `✓ ${json.tasksCreated} tasks generated`
          : `✗ ${json.errors?.[0] ?? 'Error generating tasks'}`,
      );
      load();
    } finally {
      setGenerating(false);
    }
  }

  const rate = data?.tasks.completionRate ?? 0;
  const total = data?.tasks.total ?? 0;
  const completed = data?.tasks.completed ?? 0;
  const scheduled = data?.attendance.scheduled ?? 0;
  const present = (data?.attendance.present ?? 0) + (data?.attendance.late ?? 0);
  const templates =
    (data?.taskTemplates.daily ?? 0) +
    (data?.taskTemplates.weekly ?? 0) +
    (data?.taskTemplates.monthly ?? 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{todayFull()}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2">
            <Link href="/ops/tasks/new">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                New Task
              </Button>
            </Link>
            <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating…' : 'Generate Tasks'}
            </Button>
          </div>
          {genMsg && (
            <p
              className={`text-xs ${
                genMsg.startsWith('✓') ? 'text-green-600' : 'text-destructive'
              }`}
            >
              {genMsg}
            </p>
          )}
        </div>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-16 animate-pulse rounded bg-secondary" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            title="Completion Rate"
            value={`${Math.round(rate)}%`}
            sub={`${completed} of ${total} tasks done`}
            icon={TrendingUp}
            highlight={rate >= 80 ? 'green' : rate >= 50 ? 'amber' : 'red'}
          />
          <StatCard
            title="Tasks Today"
            value={total}
            sub={`${data?.tasks.pending ?? 0} pending · ${data?.tasks.inProgress ?? 0} active`}
            icon={ListTodo}
          />
          <StatCard
            title="Attendance"
            value={`${present}/${scheduled}`}
            sub={`${data?.attendance.absent ?? 0} absent · ${data?.attendance.late ?? 0} late`}
            icon={Users}
            highlight={present === scheduled ? 'green' : 'amber'}
          />
          <StatCard
            title="Task Templates"
            value={templates}
            sub={`${data?.taskTemplates.daily ?? 0} daily · ${data?.taskTemplates.weekly ?? 0} weekly · ${data?.taskTemplates.monthly ?? 0} monthly`}
            icon={CalendarDays}
            highlight="primary"
          />
        </div>
      )}

      {/* Middle row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Task breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Task Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              {
                label: 'Completed',
                value: data?.tasks.completed ?? 0,
                color: 'bg-green-500',
                textColor: 'text-green-600',
              },
              {
                label: 'In Progress',
                value: data?.tasks.inProgress ?? 0,
                color: 'bg-primary',
                textColor: 'text-primary',
              },
              {
                label: 'Pending',
                value: data?.tasks.pending ?? 0,
                color: 'bg-amber-400',
                textColor: 'text-amber-600',
              },
            ].map(({ label, value, textColor }) => (
              <div key={label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className={`font-medium ${textColor}`}>{label}</span>
                  <span className="tabular-nums text-muted-foreground">{value}</span>
                </div>
                <Progress
                  value={total > 0 ? (value / total) * 100 : 0}
                  className="h-1.5"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Attendance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Today's Attendance</CardTitle>
          </CardHeader>
          <CardContent>
            {[
              {
                label: 'Present',
                value: data?.attendance.present ?? 0,
                variant: 'default' as const,
              },
              {
                label: 'Late',
                value: data?.attendance.late ?? 0,
                variant: 'secondary' as const,
              },
              {
                label: 'Absent',
                value: data?.attendance.absent ?? 0,
                variant: 'destructive' as const,
              },
              {
                label: 'Excused',
                value: data?.attendance.excused ?? 0,
                variant: 'outline' as const,
              },
            ].map(({ label, value, variant }) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
              >
                <span className="text-sm text-foreground">{label}</span>
                <Badge variant={variant}>{value}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Template types */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Active Task Templates</CardTitle>
              <Link href="/ops/tasks">
                <Button variant="ghost" size="sm" className="h-7 text-xs text-primary">
                  Manage →
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Daily',
                  value: data?.taskTemplates.daily ?? 0,
                  color: 'bg-primary/10 text-primary',
                },
                {
                  label: 'Weekly',
                  value: data?.taskTemplates.weekly ?? 0,
                  color: 'bg-violet-100 text-violet-600',
                },
                {
                  label: 'Monthly',
                  value: data?.taskTemplates.monthly ?? 0,
                  color: 'bg-amber-50 text-amber-600',
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className={`rounded-lg p-3 text-center ${color}`}
                >
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide opacity-70">
                    {label}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent completions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recently Completed</CardTitle>
          </CardHeader>
          <CardContent>
            {!data?.recentCompleted?.length ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No completions yet today
              </p>
            ) : (
              <ul className="space-y-0">
                {data.recentCompleted.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between border-b border-border py-2.5 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {item.task?.title ?? 'Unknown Task'}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {item.user?.name}
                        </span>
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                          {item.employeeTask.shift}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      {fmtTime(item.employeeTask.completedAt)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}