'use client';
// app/ops/page.tsx

import { useCallback, useEffect, useState, type ElementType } from 'react';
import Link from 'next/link';
import {
  CalendarDays,
  CheckCircle2,
  ListTodo,
  Plus,
  RefreshCw,
  TrendingUp,
  Users,
} from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

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

// TODO: replace this with the real storeId from session/scope when available.
const STORE_ID = 'your-store-id';

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
  icon: ElementType;
  highlight?: 'green' | 'amber' | 'red' | 'primary';
}) {
  const colorMap = {
    green: 'text-emerald-600',
    amber: 'text-amber-500',
    red: 'text-rose-600',
    primary: 'text-indigo-600',
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
            <p className={`mt-1 text-3xl font-bold ${highlight ? colorMap[highlight] : 'text-slate-900'}`}>
              {value}
            </p>
            {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
          </div>
          <div className="rounded-xl bg-indigo-50 p-2 text-indigo-500">
            <Icon className="h-4 w-4" />
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
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetch(
        `/api/ops/dashboard?storeId=${STORE_ID}&date=${new Date().toISOString()}`,
        { cache: 'no-store' },
      );
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
    const id = setInterval(() => void load('refresh'), 60_000);
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

      await load('refresh');
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
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Overview"
        title="Dashboard"
        subtitle={todayFull()}
        onRefresh={() => void load('refresh')}
        refreshing={refreshing}
        contentClassName="w-full"
        actions={
          <>
            <Link href="/ops/tasks/new">
              <Button variant="outline" size="sm" className="h-10 gap-1.5 rounded-xl border-slate-200 bg-white font-semibold text-slate-600 hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" />
                New Task
              </Button>
            </Link>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="h-10 gap-1.5 rounded-xl font-bold"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating…' : 'Generate Tasks'}
            </Button>
          </>
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
        {genMsg && (
          <p className={`text-xs ${genMsg.startsWith('✓') ? 'text-emerald-600' : 'text-rose-600'}`}>
            {genMsg}
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="border-slate-200 bg-white">
                <CardContent className="p-5">
                  <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
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
              highlight={scheduled > 0 && present === scheduled ? 'green' : 'amber'}
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Task Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: 'Completed', value: data?.tasks.completed ?? 0, textColor: 'text-emerald-600' },
                { label: 'In Progress', value: data?.tasks.inProgress ?? 0, textColor: 'text-indigo-600' },
                { label: 'Pending', value: data?.tasks.pending ?? 0, textColor: 'text-amber-600' },
              ].map(({ label, value, textColor }) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className={`font-medium ${textColor}`}>{label}</span>
                    <span className="tabular-nums text-slate-500">{value}</span>
                  </div>
                  <Progress value={total > 0 ? (value / total) * 100 : 0} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Today&apos;s Attendance</CardTitle>
            </CardHeader>
            <CardContent>
              {[
                { label: 'Present', value: data?.attendance.present ?? 0, variant: 'default' as const },
                { label: 'Late', value: data?.attendance.late ?? 0, variant: 'secondary' as const },
                { label: 'Absent', value: data?.attendance.absent ?? 0, variant: 'destructive' as const },
                { label: 'Excused', value: data?.attendance.excused ?? 0, variant: 'outline' as const },
              ].map(({ label, value, variant }) => (
                <div key={label} className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
                  <span className="text-sm text-slate-700">{label}</span>
                  <Badge variant={variant}>{value}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-900">Active Task Templates</CardTitle>
                <Link href="/ops/tasks">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-indigo-600">
                    Manage →
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Daily', value: data?.taskTemplates.daily ?? 0, color: 'bg-indigo-50 text-indigo-600' },
                  { label: 'Weekly', value: data?.taskTemplates.weekly ?? 0, color: 'bg-violet-50 text-violet-600' },
                  { label: 'Monthly', value: data?.taskTemplates.monthly ?? 0, color: 'bg-amber-50 text-amber-600' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`rounded-xl p-3 text-center ${color}`}>
                    <p className="text-2xl font-bold">{value}</p>
                    <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide opacity-70">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-900">Recently Completed</CardTitle>
            </CardHeader>
            <CardContent>
              {!data?.recentCompleted?.length ? (
                <p className="py-4 text-center text-sm text-slate-500">No completions yet today</p>
              ) : (
                <ul className="space-y-0">
                  {data.recentCompleted.map((item, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-slate-100 py-2.5 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {item.task?.title ?? 'Unknown Task'}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="text-xs text-slate-500">{item.user?.name}</span>
                          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                            {item.employeeTask.shift}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
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
    </div>
  );
}
