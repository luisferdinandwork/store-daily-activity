// app/ops/tasks/page.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Search, MoreHorizontal, Pencil, Power, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type Task = {
  id: string;
  title: string;
  description: string | null;
  role: string;
  employeeType: string | null;
  shift: string | null;
  recurrence: 'daily' | 'weekly' | 'monthly';
  recurrenceDays: number[] | null;
  isActive: boolean;
  requiresForm: boolean;
  requiresAttachment: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
};

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function recurrenceLabel(task: Task) {
  if (task.recurrence === 'daily') return 'Every day';
  if (task.recurrence === 'weekly' && task.recurrenceDays?.length) {
    return task.recurrenceDays.map((d) => WEEKDAY[d]).join(', ');
  }
  if (task.recurrence === 'monthly' && task.recurrenceDays?.length) {
    return task.recurrenceDays.join(', ') + ' of month';
  }
  return '—';
}

const RECURRENCE_BADGE: Record<string, string> = {
  daily: 'bg-primary/10 text-primary border-primary/20',
  weekly: 'bg-violet-100 text-violet-700 border-violet-200',
  monthly: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function OpsTaskLibraryPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRecurrence, setFilterRecurrence] = useState('all');
  const [filterShift, setFilterShift] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterActive, setFilterActive] = useState('true');

  async function loadTasks() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterRecurrence !== 'all') params.set('recurrence', filterRecurrence);
      if (filterShift !== 'all') params.set('shift', filterShift);
      if (filterActive !== 'all') params.set('isActive', filterActive);
      const res = await fetch(`/api/ops/tasks?${params}`);
      const json = await res.json();
      if (json.success) setTasks(json.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterRecurrence, filterShift, filterActive]);

  async function toggleActive(task: Task) {
    const res = await fetch(`/api/ops/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !task.isActive }),
    });
    if (res.ok) {
      toast.success(`Task ${task.isActive ? 'paused' : 'resumed'}`);
      loadTasks();
    }
  }

  async function deleteTask(id: string) {
    if (!confirm('Deactivate this task template?')) return;
    const res = await fetch(`/api/ops/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Task deactivated');
      loadTasks();
    }
  }

  const filtered = tasks.filter((t) => {
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== 'all' && t.employeeType !== filterType) return false;
    return true;
  });

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Task Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage task templates for all employees
          </p>
        </div>
        <Link href="/ops/tasks/new">
          <Button className="gap-1.5">
            <Plus className="h-4 w-4" />
            Create Task
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-8 h-9"
            placeholder="Search tasks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={filterRecurrence} onValueChange={setFilterRecurrence}>
          <SelectTrigger className="w-36 h-9">
            <SelectValue placeholder="Recurrence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Recurrences</SelectItem>
            <SelectItem value="daily">Daily</SelectItem>
            <SelectItem value="weekly">Weekly</SelectItem>
            <SelectItem value="monthly">Monthly</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterShift} onValueChange={setFilterShift}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue placeholder="Shift" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Shifts</SelectItem>
            <SelectItem value="morning">Morning</SelectItem>
            <SelectItem value="evening">Evening</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-32 h-9">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pic">PIC</SelectItem>
            <SelectItem value="so">SO</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterActive} onValueChange={setFilterActive}>
          <SelectTrigger className="w-28 h-9">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Active</SelectItem>
            <SelectItem value="false">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Recurrence</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Features</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 animate-pulse rounded bg-secondary" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    No tasks found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <p className="font-medium text-foreground">{task.title}</p>
                      {task.description && (
                        <p className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground">
                          {task.description}
                        </p>
                      )}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={RECURRENCE_BADGE[task.recurrence]}
                      >
                        {task.recurrence}
                      </Badge>
                      {task.recurrenceDays && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {recurrenceLabel(task)}
                        </p>
                      )}
                    </TableCell>

                    <TableCell>
                      {task.shift ? (
                        <Badge variant="outline" className="capitalize">
                          {task.shift}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Both</span>
                      )}
                    </TableCell>

                    <TableCell>
                      <Badge variant="secondary">
                        {task.employeeType?.toUpperCase() ?? 'All'}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="flex gap-1">
                        {task.requiresForm && (
                          <Badge variant="outline" className="text-[10px]">
                            Form
                          </Badge>
                        )}
                        {task.requiresAttachment && (
                          <Badge variant="outline" className="text-[10px]">
                            📎
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={task.isActive ? 'default' : 'secondary'}
                        className={
                          task.isActive
                            ? 'bg-green-100 text-green-700 hover:bg-green-100'
                            : ''
                        }
                      >
                        {task.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/ops/tasks/${task.id}/edit`}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleActive(task)}>
                            <Power className="mr-2 h-3.5 w-3.5" />
                            {task.isActive ? 'Pause' : 'Resume'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteTask(task.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}