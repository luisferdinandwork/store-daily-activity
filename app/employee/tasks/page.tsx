// app/employee/tasks/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession }    from 'next-auth/react';
import { useRouter }     from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge }         from '@/components/ui/badge';
import {
  CheckCircle2, Circle, Clock, XCircle,
  Camera, ChevronRight, Inbox,
  Store, Wallet, Box, Package, Truck,
  Users, CreditCard, BarChart2, ClipboardList,
  User, Sun, Moon, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Task types ────────────────────────────────────────────────────────────────

export type TaskType =
  | 'store_opening'
  | 'setoran'
  | 'cek_bin'
  | 'product_check'
  | 'marketing_check'
  | 'item_dropping'
  | 'briefing'
  | 'edc_reconciliation'
  | 'eod_z_report'
  | 'open_statement'
  | 'grooming';

export type TaskStatus =
  | 'pending' | 'in_progress' | 'completed'
  | 'discrepancy' | 'verified' | 'rejected';

interface TaskBase {
  id:          string;
  scheduleId:  string;
  userId:      string;
  storeId:     string;
  shift:       'morning' | 'evening' | 'full_day';
  date:        string;
  status:      TaskStatus;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
}

export interface StoreOpeningData extends TaskBase {
  loginPos: boolean; checkAbsenSunfish: boolean; tarikSohSales: boolean;
  fiveR: boolean; cekBanner: boolean; cekLamp: boolean; cekSoundSystem: boolean;
  storeFrontPhotos: string[]; cashDrawerPhotos: string[];
  fiveRPhotos: string[];
  cekBannerStorefrontPhotos: string[]; cekBannerDeskPhotos: string[];
}
export interface SetoranData extends TaskBase {
  amount:      string | null;
  linkSetoran: string | null;
  resiPhoto:   string | null;
  expectedAmount:          string | null;
  carriedDeficit:          string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount:            string | null;
}

export interface MarketingCheckData extends TaskBase {
  promoName: boolean;
  promoPeriod: boolean;
  promoMechanism: boolean;
  randomShoeItems: boolean;
  randomNonShoeItems: boolean;
  sellTag: boolean;
}

export interface CekBinData       extends TaskBase {}
export interface ProductCheckData extends TaskBase {
  display: boolean; price: boolean; saleTag: boolean;
  shoeFiller: boolean; labelIndo: boolean; barcode: boolean;
}
export interface ItemDroppingData extends TaskBase {
  hasDropping:      boolean;
  entries:          Array<{
    id: string; taskId: string; userId: string; storeId: string;
    toNumber: string; dropTime: string | null; droppingPhotos: string[];
    notes: string | null; createdAt: string | null;
  }>;
}
export interface BriefingData extends TaskBase {
  done: boolean; isBalanced: boolean | null; parentTaskId: number | null;
}
export interface EdcReconciliationData extends TaskBase {
  parentTaskId:               number | null;
  isBalanced:                 boolean | null;
  expectedFetchedAt:          string | null;
  expectedSnapshot:           string | null;
  discrepancyStartedAt:       string | null;
  discrepancyResolvedAt:      string | null;
  discrepancyDurationMinutes: number | null;
}
export interface EodZReportData extends TaskBase {
  totalNominal:  string | null;
  zReportPhotos: string[];
}
export interface OpenStatementData extends TaskBase {
  parentTaskId:               number | null;
  expectedAmount:             string | null;
  expectedFetchedAt:          string | null;
  actualAmount:               string | null;
  isBalanced:                 boolean | null;
  discrepancyStartedAt:       string | null;
  discrepancyResolvedAt:      string | null;
  discrepancyDurationMinutes: number | null;
}
export interface GroomingData extends TaskBase {
  uniformActive: boolean; hairActive: boolean; nailsActive: boolean;
  accessoriesActive: boolean; shoeActive: boolean;
  uniformComplete: boolean | null; hairGroomed: boolean | null;
  nailsClean: boolean | null; accessoriesCompliant: boolean | null;
  shoeCompliant: boolean | null; selfiePhotos: string[];
}

export type TaskItem =
  | { type: 'store_opening';      shift: 'morning' | 'evening' | 'full_day'; data: StoreOpeningData }
  | { type: 'setoran';            shift: 'morning' | 'evening' | 'full_day'; data: SetoranData }
  | { type: 'cek_bin';            shift: 'morning' | 'evening' | 'full_day'; data: CekBinData }
  | { type: 'product_check';      shift: 'morning' | 'evening' | 'full_day'; data: ProductCheckData }
  | { type: 'marketing_check';    shift: 'morning' | 'evening' | 'full_day'; data: MarketingCheckData }
  | { type: 'item_dropping';      shift: 'morning' | 'evening' | 'full_day'; data: ItemDroppingData }
  | { type: 'briefing';           shift: 'morning' | 'evening' | 'full_day'; data: BriefingData }
  | { type: 'edc_reconciliation'; shift: 'morning' | 'evening' | 'full_day'; data: EdcReconciliationData }
  | { type: 'eod_z_report';       shift: 'morning' | 'evening' | 'full_day'; data: EodZReportData }
  | { type: 'open_statement';     shift: 'morning' | 'evening' | 'full_day'; data: OpenStatementData }
  | { type: 'grooming';           shift: 'morning' | 'evening' | 'full_day'; data: GroomingData };

type Filter = 'all' | 'pending' | 'in_progress' | 'completed';

// Status config: each status gets a dedicated accent color that runs the full
// height of the card as a left border. Badge colors match.
const STATUS_CFG: Record<TaskStatus, {
  Icon: React.ElementType;
  label: string;
  badgeCls: string;
  accentCls: string;  // full-height left bar
}> = {
  discrepancy: {
    Icon: AlertTriangle, label: 'Discrepancy',
    badgeCls: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
    accentCls: 'bg-amber-400',
  },
  in_progress: {
    Icon: Clock, label: 'Active',
    badgeCls: 'bg-primary/10 text-primary hover:bg-primary/10',
    accentCls: 'bg-primary',
  },
  pending: {
    Icon: Circle, label: 'Pending',
    badgeCls: 'bg-amber-50 text-amber-600 hover:bg-amber-50',
    accentCls: 'bg-amber-200',
  },
  completed: {
    Icon: CheckCircle2, label: 'Done',
    badgeCls: 'bg-green-50 text-green-700 hover:bg-green-50',
    accentCls: 'bg-green-500',
  },
  verified: {
    Icon: CheckCircle2, label: 'Verified',
    badgeCls: 'bg-green-100 text-green-800 hover:bg-green-100',
    accentCls: 'bg-green-600',
  },
  rejected: {
    Icon: XCircle, label: 'Rejected',
    badgeCls: 'bg-red-50 text-red-600 hover:bg-red-50',
    accentCls: 'bg-red-500',
  },
};

// Urgency sort order — discrepancy first, terminal states last.
const STATUS_PRIORITY: Record<TaskStatus, number> = {
  discrepancy: 0,
  in_progress: 1,
  pending:     2,
  rejected:    3,
  completed:   4,
  verified:    5,
};

const TASK_META: Record<TaskType, { title: string; description: string; Icon: React.ElementType; hasPhoto: boolean }> = {
  store_opening:      { title: 'Store Opening',      description: 'Opening checklist + photos.',            Icon: Store,         hasPhoto: true  },
  setoran:            { title: 'Setoran',            description: 'Record cash handover & upload proof.',   Icon: Wallet,        hasPhoto: true  },
  cek_bin:            { title: 'Cek Bin',            description: 'Bin inspection.',                        Icon: Box,           hasPhoto: false },
  product_check:      { title: 'Product Check',      description: 'Display, price, tags & labels.',         Icon: Package,       hasPhoto: false },
  item_dropping:      { title: 'Item Dropping',      description: 'Log delivery arrival & receipt.',        Icon: Truck,         hasPhoto: true  },
  briefing:           { title: 'Briefing',           description: 'Conduct evening shift briefing.',        Icon: Users,         hasPhoto: false },
  edc_reconciliation: { title: 'EDC Reconciliation', description: 'Match EDC transactions vs system data.', Icon: CreditCard,    hasPhoto: false },
  eod_z_report:       { title: 'EOD Z-Report',       description: 'Enter Z-report total & upload receipt.', Icon: BarChart2,     hasPhoto: true  },
  open_statement:     { title: 'Open Statement',     description: 'Match actual vs expected cash amount.',  Icon: ClipboardList, hasPhoto: false },
  grooming:           { title: 'Grooming Check',     description: 'Uniform check + full-body selfie.',      Icon: User,          hasPhoto: true  },
  marketing_check: {
  title: 'Marketing Check',
  description: 'Promo, random checking, dan sell tag checklist.',
  Icon: ClipboardList,
  hasPhoto: false,
},
};

const TASK_ROUTES: Record<TaskType, string> = {
  store_opening:      'store-opening',
  setoran:            'setoran',
  cek_bin:            'cek-bin',
  product_check:      'product-check',
  item_dropping:      'item-dropping',
  briefing:           'briefing',
  edc_reconciliation: 'edc-reconciliation',
  eod_z_report:       'eod-z-report',
  open_statement:     'open-statement',
  grooming:           'grooming',
  marketing_check:    'marketing-check',
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',         label: 'All'     },
  { key: 'pending',     label: 'Pending' },
  { key: 'in_progress', label: 'Active'  },
  { key: 'completed',   label: 'Done'    },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EmployeeTasksPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [tasks,   setTasks]   = useState<TaskItem[]>([]);
  const [shift,   setShift]   = useState<'morning' | 'evening' | 'full_day' | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: TaskItem[]; shift: 'morning' | 'evening' | 'full_day' | null };
      setTasks(data.tasks ?? []);
      setShift(data.shift ?? null);
    } catch (e) {
      console.error('[EmployeeTasksPage] load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === 'authenticated') load();
  }, [sessionStatus, load]);

  const openTask = useCallback(async (item: TaskItem) => {
    const { status, id } = item.data;

    if (status === 'pending') {
      setTasks(prev =>
        prev.map(t =>
          t.data.id === id
            ? ({ ...t, data: { ...t.data, status: 'in_progress' as const } } as TaskItem)
            : t,
        ),
      );
      fetch('/api/employee/tasks', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ taskId: id, taskType: item.type, status: 'in_progress' }),
      }).catch(console.error);
    }

    router.push(`/employee/tasks/${TASK_ROUTES[item.type]}/${id}`);
  }, [router]);

  const countFilter = (f: Filter) => {
    if (f === 'all')         return tasks.length;
    if (f === 'in_progress') return tasks.filter(t => t.data.status === 'in_progress' || t.data.status === 'discrepancy').length;
    return tasks.filter(t => t.data.status === f).length;
  };

  // Filter + sort by urgency (discrepancy → in_progress → pending → rejected → completed → verified)
  const filtered = tasks
    .filter(t => {
      if (filter === 'all')         return true;
      if (filter === 'in_progress') return t.data.status === 'in_progress' || t.data.status === 'discrepancy';
      return t.data.status === filter;
    })
    .sort((a, b) => {
      const pa = STATUS_PRIORITY[a.data.status] ?? 9;
      const pb = STATUS_PRIORITY[b.data.status] ?? 9;
      return pa - pb;
    });

  const morningTasks = filtered.filter(t => t.shift === 'morning' || t.shift === 'full_day');
  const eveningTasks = filtered.filter(t => t.shift === 'evening' || t.shift === 'full_day');
  const notScheduled = !loading && tasks.length === 0;

  return (
    <div className="flex flex-col min-h-screen bg-background">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-6 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">Today</p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">My Tasks</h1>
          <p className="mt-1 text-xs text-primary-foreground/50">
            {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          {shift && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1">
              {shift === 'morning'
                ? <Sun className="h-3.5 w-3.5 text-yellow-300" />
                : shift === 'evening'
                  ? <Moon className="h-3.5 w-3.5 text-blue-300" />
                  : <Sun className="h-3.5 w-3.5 text-orange-300" />}
              <span className="text-xs font-semibold capitalize text-primary-foreground">
                {shift === 'morning' ? 'Morning Shift' : shift === 'evening' ? 'Evening Shift' : 'Full Day Shift'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all',
                filter === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-muted-foreground hover:bg-border',
              )}>
              {label}
              <span className={cn(
                'flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold',
                filter === key ? 'bg-white/20 text-primary-foreground' : 'bg-border text-foreground',
              )}>
                {countFilter(key)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Task sections ────────────────────────────────────────────────── */}
      <div className="flex-1 p-4 space-y-6">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />)}
          </div>
        ) : notScheduled ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Inbox className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-foreground">No shift today</p>
            <p className="mt-1 text-xs text-muted-foreground">You are not scheduled for any shift today.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle2 className="mb-3 h-10 w-10 text-green-400" />
            <p className="text-sm font-semibold text-foreground">All clear!</p>
            <p className="mt-1 text-xs text-muted-foreground">No tasks in this category.</p>
          </div>
        ) : (
          <>
            {morningTasks.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-500" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Morning Shift</h2>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground">{morningTasks.length}</span>
                </div>
                <div className="space-y-2.5">
                  {morningTasks.map(item => <TaskCard key={`${item.type}-${item.data.id}`} item={item} onOpen={openTask} />)}
                </div>
              </section>
            )}
            {eveningTasks.length > 0 && (
              <section>
                <div className="mb-2.5 flex items-center gap-2">
                  <Moon className="h-4 w-4 text-blue-500" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Evening Shift</h2>
                  <div className="h-px flex-1 bg-border" />
                  <span className="text-[10px] font-semibold text-muted-foreground">{eveningTasks.length}</span>
                </div>
                <div className="space-y-2.5">
                  {eveningTasks.map(item => <TaskCard key={`${item.type}-${item.data.id}`} item={item} onOpen={openTask} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Task card ────────────────────────────────────────────────────────────────

function TaskCard({ item, onOpen }: { item: TaskItem; onOpen: (item: TaskItem) => void }) {
  const { status }    = item.data;
  const cfg           = STATUS_CFG[status];
  const meta          = TASK_META[item.type];
  const StatusIcon    = cfg.Icon;
  const TaskIcon      = meta.Icon;
  const isTerminal    = status === 'completed' || status === 'verified';
  const isRejected    = status === 'rejected';
  const isDiscrepancy = status === 'discrepancy';

  // ── Contextual descriptor overrides ────────────────────────────────────────
  const showCarryForward =
    isDiscrepancy && (
      item.type === 'item_dropping'       ||
      item.type === 'edc_reconciliation'  ||
      item.type === 'open_statement'
    );

  const carryForwardDescription: Partial<Record<TaskType, string>> = {
    edc_reconciliation: 'Rekonsiliasi EDC belum selesai — tap untuk lanjutkan.',
    open_statement:     'Selisih open statement belum terselesaikan — tap untuk lanjutkan.',
  };

  const itemDroppingLabel = (() => {
    if (item.type !== 'item_dropping' || !isDiscrepancy) return null;
    const d = item.data as ItemDroppingData;
    const firstEntry = d.entries?.[0];
    if (!d.hasDropping || !firstEntry?.dropTime) return 'Item belum diterima — tap untuk konfirmasi.';

    const diffMin = Math.max(0, Math.floor((Date.now() - new Date(firstEntry.dropTime).getTime()) / 60_000));
    const hours   = Math.floor(diffMin / 60);
    const minutes = diffMin % 60;

    const elapsed =
      hours >= 24 ? `${Math.floor(hours / 24)}h ${hours % 24}j lalu` :
      hours >  0  ? `${hours}j ${minutes}m lalu` :
                    `${minutes}m lalu`;

    return `Belum diterima · Drop ${elapsed}`;
  })();

  const setoranDeficitLabel = (() => {
    if (item.type !== 'setoran') return null;
    const d = item.data as SetoranData;

    if ((d.status === 'completed' || d.status === 'verified') && d.unpaidAmount) {
      const unpaid = Number(d.unpaidAmount);
      if (unpaid > 0) return `Masih kurang: Rp ${unpaid.toLocaleString('id-ID')} — muncul di setoran besok`;
    }
    if ((d.status === 'pending' || d.status === 'in_progress') && d.carriedDeficit) {
      const carried = Number(d.carriedDeficit);
      if (carried > 0) return `Kurang dari kemarin: Rp ${carried.toLocaleString('id-ID')}`;
    }
    return null;
  })();

  const hasSetoranDeficit = item.type === 'setoran' && !!setoranDeficitLabel;
  const needsAttention    = isDiscrepancy || hasSetoranDeficit || isRejected;

  const description =
    itemDroppingLabel
      ? itemDroppingLabel
      : setoranDeficitLabel
        ? setoranDeficitLabel
        : showCarryForward
          ? (carryForwardDescription[item.type] ?? meta.description)
          : meta.description;

  return (
    <Card
      className={cn(
        'relative overflow-hidden border-border shadow-sm transition-all cursor-pointer active:scale-[0.99]',
        isTerminal       && 'opacity-75',
        isRejected       && 'border-red-200',
        isDiscrepancy    && 'border-amber-300',
        hasSetoranDeficit && !isDiscrepancy && 'border-amber-300',
      )}
      onClick={() => onOpen(item)}
    >
      {/* Full-height status accent bar (replaces the old 0.5 top stripe) */}
      <div className={cn(
        'absolute left-0 top-0 bottom-0 w-1',
        cfg.accentCls,
        status === 'in_progress' && 'animate-pulse',
        isDiscrepancy            && 'animate-pulse',
      )} />

      <CardContent className="py-3.5 pl-4 pr-3">
        <div className="flex items-start gap-3">
          {/* Task icon */}
          <div className={cn(
            'mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl',
            needsAttention ? 'bg-amber-100' : 'bg-secondary',
          )}>
            <TaskIcon
              className={cn('h-[18px] w-[18px]', needsAttention ? 'text-amber-700' : 'text-foreground')}
              strokeWidth={2}
            />
          </div>

          {/* Main content */}
          <div className="min-w-0 flex-1">
            {/* Title row */}
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-tight text-foreground">
                {meta.title}
              </p>
              {isTerminal && item.data.completedAt ? (
                <span className="flex-shrink-0 text-[10px] font-medium text-green-600">
                  ✓ {new Date(item.data.completedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : (
                <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              )}
            </div>

            {/* Description */}
            <p className={cn(
              'mt-1 line-clamp-2 text-[11.5px] leading-snug',
              needsAttention ? 'text-amber-700 font-medium' : 'text-muted-foreground',
            )}>
              {description}
            </p>

            {/* Badges */}
            <div className="mt-2 flex flex-wrap items-center gap-1">
              <Badge className={cn('h-[18px] gap-1 px-1.5 text-[10px] font-semibold', cfg.badgeCls)}>
                <StatusIcon className="h-2.5 w-2.5" />
                {cfg.label}
              </Badge>

              {item.type === 'grooming' ? (
                <Badge variant="outline" className="h-[18px] px-1.5 text-[10px] text-violet-600 border-violet-200">
                  Personal
                </Badge>
              ) : (
                <Badge variant="outline" className="h-[18px] px-1.5 text-[10px]">
                  Shared
                </Badge>
              )}

              {meta.hasPhoto && (
                <Badge variant="outline" className="h-[18px] gap-1 px-1.5 text-[10px]">
                  <Camera className="h-2.5 w-2.5" />
                </Badge>
              )}

              {showCarryForward && (
                <Badge className="h-[18px] gap-1 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                  <AlertTriangle className="h-2.5 w-2.5" />Carry-forward
                </Badge>
              )}

              {hasSetoranDeficit && !isDiscrepancy && (
                <Badge className="h-[18px] gap-1 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                  <AlertTriangle className="h-2.5 w-2.5" />Kekurangan
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}