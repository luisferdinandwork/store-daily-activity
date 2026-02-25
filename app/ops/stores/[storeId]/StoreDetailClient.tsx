// app/ops/stores/[storeId]/StoreDetailClient.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft, CheckCircle2, Clock, Circle, User } from 'lucide-react';

interface EmployeeProgress {
  user: {
    id: string;
    name: string;
    employeeType: string | null;
  };
  shift: string;
  attendance: {
    status: string;
    checkInTime: string | null;
  } | null;
  tasks: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
  };
  recentTasks: Array<{
    id: string;
    title: string;
    status: string;
    completedAt: string | null;
  }>;
}

interface StoreDetail {
  store: {
    id: string;
    name: string;
    address: string;
    pettyCashBalance: string;
  };
  date: string;
  employees: EmployeeProgress[];
}

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

const ATTENDANCE_BADGE: Record<
  string,
  React.ComponentProps<typeof Badge>['variant']
> = {
  present: 'default',
  late: 'secondary',
  absent: 'destructive',
  excused: 'outline',
};

export default function StoreDetailClient({ storeId }: { storeId: string }) {
  const [data, setData] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/ops/stores/${storeId}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [storeId]);

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/ops/stores">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {loading ? 'Loading…' : data?.store.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {loading ? '' : data?.store.address}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      ) : !data ? (
        <p className="text-muted-foreground">Store not found.</p>
      ) : (
        <>
          {/* Store stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              {
                label: 'Total Employees Today',
                value: data.employees.length,
              },
              {
                label: 'Present',
                value: data.employees.filter((e) => e.attendance?.status === 'present').length,
              },
              {
                label: 'Tasks Completed',
                value: data.employees.reduce((sum, e) => sum + e.tasks.completed, 0),
              },
              {
                label: 'Tasks Pending',
                value: data.employees.reduce((sum, e) => sum + e.tasks.pending, 0),
              },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Employee cards */}
          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Employee Progress
            </h2>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {data.employees.map((emp) => {
                const rate =
                  emp.tasks.total > 0
                    ? Math.round((emp.tasks.completed / emp.tasks.total) * 100)
                    : 0;

                return (
                  <Card key={emp.user.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {emp.user.name}
                            </p>
                            <div className="flex gap-1.5 mt-0.5">
                              {emp.user.employeeType && (
                                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                  {emp.user.employeeType.toUpperCase()}
                                </Badge>
                              )}
                              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                                {emp.shift}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        {emp.attendance ? (
                          <Badge variant={ATTENDANCE_BADGE[emp.attendance.status] ?? 'outline'}>
                            {emp.attendance.status}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            No record
                          </Badge>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      {/* Progress bar */}
                      <div>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-muted-foreground">Task completion</span>
                          <span
                            className={`font-semibold ${
                              rate >= 80
                                ? 'text-green-600'
                                : rate >= 50
                                ? 'text-amber-600'
                                : 'text-destructive'
                            }`}
                          >
                            {rate}%
                          </span>
                        </div>
                        <Progress value={rate} className="h-1.5" />
                      </div>

                      {/* Task counts */}
                      <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                          {
                            label: 'Done',
                            value: emp.tasks.completed,
                            color: 'text-green-600',
                          },
                          {
                            label: 'Active',
                            value: emp.tasks.inProgress,
                            color: 'text-primary',
                          },
                          {
                            label: 'Pending',
                            value: emp.tasks.pending,
                            color: 'text-amber-600',
                          },
                        ].map(({ label, value, color }) => (
                          <div key={label} className="rounded bg-secondary/50 p-2">
                            <p className={`text-base font-bold ${color}`}>{value}</p>
                            <p className="text-[10px] text-muted-foreground">{label}</p>
                          </div>
                        ))}
                      </div>

                      {/* Recent tasks mini list */}
                      {emp.recentTasks.length > 0 && (
                        <div className="space-y-1">
                          {emp.recentTasks.slice(0, 3).map((task) => (
                            <div
                              key={task.id}
                              className="flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                {task.status === 'completed' ? (
                                  <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-green-500" />
                                ) : task.status === 'in_progress' ? (
                                  <Clock className="h-3 w-3 flex-shrink-0 text-primary" />
                                ) : (
                                  <Circle className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                                )}
                                <span className="truncate text-foreground">{task.title}</span>
                              </div>
                              {task.completedAt && (
                                <span className="flex-shrink-0 text-muted-foreground ml-2">
                                  {fmtTime(task.completedAt)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {emp.attendance?.checkInTime && (
                        <p className="text-xs text-muted-foreground">
                          Check-in: {fmtTime(emp.attendance.checkInTime)}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {data.employees.length === 0 && (
                <p className="col-span-2 py-12 text-center text-muted-foreground">
                  No employees scheduled today
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}