// app/ops/tasks/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  CheckCircle2,
  Circle,
  Clock,
  Store,
  User,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  CalendarDays,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed';

interface StoreOpeningRow {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  date: string;
  shift: 'morning';
  status: TaskStatus;
  completedAt: string | null;
  cashDrawerAmount: number | null;
  allLightsOn: boolean | null;
  cleanlinessCheck: boolean | null;
  equipmentCheck: boolean | null;
  stockCheck: boolean | null;
  safetyCheck: boolean | null;
  storeFrontPhotos: string[];
  cashDrawerPhotos: string[];
  verifiedBy: string | null;
  verifiedAt: string | null;
}

interface GroomingRow {
  id: string;
  userId: string;
  userName: string;
  storeId: string;
  storeName: string;
  date: string;
  shift: 'morning' | 'evening';
  status: TaskStatus;
  completedAt: string | null;
  uniformComplete: boolean | null;
  hairGroomed: boolean | null;
  nailsClean: boolean | null;
  accessoriesCompliant: boolean | null;
  shoeCompliant: boolean | null;
  selfiePhotos: string[];
  verifiedBy: string | null;
  verifiedAt: string | null;
}

type TaskTab = 'store_opening' | 'grooming';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<TaskStatus, {
  label: string; icon: React.ElementType; cls: string; dot: string;
}> = {
  pending:     { label: 'Pending',     icon: Circle,       cls: 'bg-amber-50 text-amber-700 border-amber-200',   dot: 'bg-amber-400'  },
  in_progress: { label: 'In Progress', icon: Clock,        cls: 'bg-primary/10 text-primary border-primary/20',  dot: 'bg-primary'    },
  completed:   { label: 'Completed',   icon: CheckCircle2, cls: 'bg-green-50 text-green-700 border-green-200',   dot: 'bg-green-500'  },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn('gap-1 text-xs', cfg.cls)}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function CheckDot({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>;
  return value
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : <Circle className="h-4 w-4 text-red-400" />;
}

function SummaryCard({
  label, total, completed, icon: Icon, color,
}: {
  label: string; total: number; completed: number;
  icon: React.ElementType; color: string;
}) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-xl', color)}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-2xl font-bold text-foreground">{pct}%</span>
        </div>
        <p className="mt-2 text-sm font-semibold text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{completed}/{total} completed</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-green-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Expandable detail row ────────────────────────────────────────────────────

function OpeningDetailRow({ row }: { row: StoreOpeningRow }) {
  const checks = [
    { label: 'Lights',      val: row.allLightsOn },
    { label: 'Cleanliness', val: row.cleanlinessCheck },
    { label: 'Equipment',   val: row.equipmentCheck },
    { label: 'Stock',       val: row.stockCheck },
    { label: 'Safety',      val: row.safetyCheck },
  ];
  return (
    <TableRow className="bg-secondary/30">
      <TableCell colSpan={7} className="px-6 py-3">
        <div className="flex flex-wrap gap-6 text-xs">
          <div>
            <p className="mb-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Checklist</p>
            <div className="flex gap-3">
              {checks.map(({ label, val }) => (
                <div key={label} className="flex items-center gap-1">
                  <CheckDot value={val} />
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
          {row.cashDrawerAmount !== null && (
            <div>
              <p className="mb-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Cash Float</p>
              <p className="font-semibold">Rp {row.cashDrawerAmount.toLocaleString('id-ID')}</p>
            </div>
          )}
          {row.storeFrontPhotos.length > 0 && (
            <div>
              <p className="mb-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Photos</p>
              <div className="flex gap-1.5">
                {row.storeFrontPhotos.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover border border-border hover:opacity-80" />
                  </a>
                ))}
                {row.cashDrawerPhotos.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={`cd-${i}`} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover border border-border hover:opacity-80" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function GroomingDetailRow({ row }: { row: GroomingRow }) {
  const checks = [
    { label: 'Uniform',      val: row.uniformComplete },
    { label: 'Hair',         val: row.hairGroomed },
    { label: 'Nails',        val: row.nailsClean },
    { label: 'Accessories',  val: row.accessoriesCompliant },
    { label: 'Shoes',        val: row.shoeCompliant },
  ];
  return (
    <TableRow className="bg-secondary/30">
      <TableCell colSpan={7} className="px-6 py-3">
        <div className="flex flex-wrap gap-6 text-xs">
          <div>
            <p className="mb-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Checklist</p>
            <div className="flex gap-3">
              {checks.map(({ label, val }) => (
                <div key={label} className="flex items-center gap-1">
                  <CheckDot value={val} />
                  <span className="text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>
          {row.selfiePhotos.length > 0 && (
            <div>
              <p className="mb-1.5 font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">Selfie</p>
              <div className="flex gap-1.5">
                {row.selfiePhotos.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={i} href={url} target="_blank" rel="noreferrer">
                    <img src={url} alt="" className="h-10 w-10 rounded-lg object-cover border border-border hover:opacity-80" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTasksPage() {
  const { data: session } = useSession();
  const [tab, setTab]               = useState<TaskTab>('store_opening');
  const [filterStore, setFilterStore] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterShift, setFilterShift]   = useState('all');
  const [dateStr, setDateStr]           = useState(() => new Date().toISOString().slice(0, 10));
  const [openingRows, setOpeningRows]   = useState<StoreOpeningRow[]>([]);
  const [groomingRows, setGroomingRows] = useState<GroomingRow[]>([]);
  const [stores, setStores]             = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]           = useState(true);
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date: dateStr });
      if (filterStore !== 'all') params.set('storeId', filterStore);

      const [openRes, groomRes] = await Promise.all([
        fetch(`/api/ops/tasks/store-opening?${params}`),
        fetch(`/api/ops/tasks/grooming?${params}`),
      ]);
      const [openData, groomData] = await Promise.all([openRes.json(), groomRes.json()]);

      if (openData.success)  setOpeningRows(openData.data ?? []);
      if (groomData.success) setGroomingRows(groomData.data ?? []);
      if (openData.stores)   setStores(openData.stores ?? []);
    } finally {
      setLoading(false);
    }
  }, [dateStr, filterStore]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Filtering ───────────────────────────────────────────────────────────────
  const filteredOpening = openingRows.filter((r) => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    return true;
  });

  const filteredGrooming = groomingRows.filter((r) => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterShift  !== 'all' && r.shift  !== filterShift)  return false;
    return true;
  });

  const activeRows = tab === 'store_opening' ? filteredOpening : filteredGrooming;
  const openingCompleted = openingRows.filter((r) => r.status === 'completed').length;
  const groomingCompleted = groomingRows.filter((r) => r.status === 'completed').length;

  // ── Verify handler ──────────────────────────────────────────────────────────
  async function handleVerify(taskType: TaskTab, taskId: string) {
    const res = await fetch(`/api/ops/tasks/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskType, taskId }),
    });
    if (res.ok) load();
  }

  return (
    <div className="space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Task Monitoring</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Daily completion status for store opening and grooming checks
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Date picker */}
      <div className="flex items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">
          {new Date(dateStr + 'T00:00:00').toLocaleDateString('en-ID', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}
        </span>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard
          label="Store Opening"
          total={openingRows.length}
          completed={openingCompleted}
          icon={Store}
          color="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="Grooming Checks"
          total={groomingRows.length}
          completed={groomingCompleted}
          icon={User}
          color="bg-violet-50 text-violet-600"
        />
      </div>

      {/* Tab + Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Tab toggle */}
        <div className="flex rounded-lg border border-border bg-secondary p-0.5">
          {([
            { key: 'store_opening', label: 'Store Opening', icon: Store },
            { key: 'grooming',      label: 'Grooming',      icon: User  },
          ] as { key: TaskTab; label: string; icon: React.ElementType }[]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { setTab(key); setExpanded(new Set()); }}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                tab === key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Store filter */}
        {stores.length > 1 && (
          <Select value={filterStore} onValueChange={setFilterStore}>
            <SelectTrigger className="h-8 w-40">
              <SelectValue placeholder="All Stores" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Stores</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Shift filter (grooming only) */}
        {tab === 'grooming' && (
          <Select value={filterShift} onValueChange={setFilterShift}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue placeholder="All Shifts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Shifts</SelectItem>
              <SelectItem value="morning">Morning</SelectItem>
              <SelectItem value="evening">Evening</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Status filter */}
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-36">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Employee</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Completed At</TableHead>
                <TableHead>Verified</TableHead>
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
              ) : activeRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    No tasks found for this date and filter combination
                  </TableCell>
                </TableRow>
              ) : (
                activeRows.map((row) => {
                  const isOpen = expanded.has(row.id);
                  return (
                    <>
                      <TableRow
                        key={row.id}
                        className={cn(
                          'cursor-pointer transition-colors',
                          isOpen && 'bg-secondary/20',
                        )}
                        onClick={() => toggleExpand(row.id)}
                      >
                        <TableCell className="w-8 pr-0">
                          {isOpen
                            ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          }
                        </TableCell>

                        <TableCell>
                          <p className="font-medium text-foreground">{row.userName}</p>
                        </TableCell>

                        <TableCell>
                          <p className="text-sm text-muted-foreground">{row.storeName}</p>
                        </TableCell>

                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {row.shift}
                          </Badge>
                        </TableCell>

                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>

                        <TableCell>
                          {row.completedAt ? (
                            <span className="text-xs text-foreground">
                              {new Date(row.completedAt).toLocaleTimeString('en-ID', {
                                hour: '2-digit', minute: '2-digit',
                              })}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>

                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {row.verifiedAt ? (
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Verified
                            </Badge>
                          ) : row.status === 'completed' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => handleVerify(tab, row.id)}
                            >
                              Verify
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>

                      {/* Expandable detail */}
                      {isOpen && (
                        tab === 'store_opening'
                          ? <OpeningDetailRow row={row as StoreOpeningRow} />
                          : <GroomingDetailRow row={row as GroomingRow} />
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}