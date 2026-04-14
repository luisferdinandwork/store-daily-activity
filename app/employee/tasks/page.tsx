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
  | 'store_opening'     | 'setoran'    | 'cek_bin'
  | 'product_check'     | 'item_dropping'
  | 'briefing'          | 'edc_reconciliation'
  | 'eod_z_report'      | 'open_statement'
  | 'grooming';

export type TaskStatus =
  | 'pending' | 'in_progress' | 'completed'
  | 'discrepancy' | 'verified' | 'rejected';

interface TaskBase {
  id:          string;
  scheduleId:  string;
  userId:      string;
  storeId:     string;
  shift:       'morning' | 'evening';
  date:        string;
  status:      TaskStatus;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
}

export interface StoreOpeningData extends TaskBase {
  loginPos: boolean; checkAbsenSunfish: boolean; tarikSohSales: boolean;
  fiveR: boolean; cekLamp: boolean; cekSoundSystem: boolean;
  storeFrontPhotos: string[]; cashDrawerPhotos: string[];
  cekPromoStorefrontPhotos: string[]; cekPromoDeskPhotos: string[];
}
export interface SetoranData extends TaskBase {
  amount: string | null; linkSetoran: string | null; resiPhoto: string | null;
}
export interface CekBinData       extends TaskBase {}
export interface ProductCheckData extends TaskBase {
  display: boolean; price: boolean; saleTag: boolean;
  shoeFiller: boolean; labelIndo: boolean; barcode: boolean;
}
export interface ItemDroppingData extends TaskBase {
  parentTaskId:     number | null;
  hasDropping:      boolean;
  dropTime:         string | null;
  droppingPhotos:   string[];
  isReceived:       boolean;
  receiveTime:      string | null;
  receivePhotos:    string[];           // ← added
  receivedByUserId: string | null;
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
  | { type: 'store_opening';      shift: 'morning';             data: StoreOpeningData       }
  | { type: 'setoran';            shift: 'morning';             data: SetoranData             }
  | { type: 'cek_bin';            shift: 'morning';             data: CekBinData              }
  | { type: 'product_check';      shift: 'morning';             data: ProductCheckData        }
  | { type: 'item_dropping';      shift: 'morning';             data: ItemDroppingData        }
  | { type: 'briefing';           shift: 'evening';             data: BriefingData            }
  | { type: 'edc_reconciliation'; shift: 'evening';             data: EdcReconciliationData   }
  | { type: 'eod_z_report';       shift: 'evening';             data: EodZReportData          }
  | { type: 'open_statement';     shift: 'evening';             data: OpenStatementData       }
  | { type: 'grooming';           shift: 'morning' | 'evening'; data: GroomingData            };

type Filter = 'all' | 'pending' | 'in_progress' | 'completed';

const STATUS_CFG: Record<TaskStatus, { Icon: React.ElementType; label: string; cls: string }> = {
  pending:     { Icon: Circle,        label: 'Pending',        cls: 'bg-amber-50   text-amber-600  hover:bg-amber-50'   },
  in_progress: { Icon: Clock,         label: 'In Progress',    cls: 'bg-primary/10 text-primary    hover:bg-primary/10' },
  completed:   { Icon: CheckCircle2,  label: 'Done',           cls: 'bg-green-50   text-green-700  hover:bg-green-50'   },
  discrepancy: { Icon: AlertTriangle, label: 'Discrepancy',    cls: 'bg-amber-100  text-amber-700  hover:bg-amber-100'  },
  verified:    { Icon: CheckCircle2,  label: 'Verified',       cls: 'bg-green-100  text-green-800  hover:bg-green-100'  },
  rejected:    { Icon: XCircle,       label: 'Rejected',       cls: 'bg-red-50     text-red-600    hover:bg-red-50'     },
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
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all',         label: 'All'     },
  { key: 'pending',     label: 'Pending' },
  { key: 'in_progress', label: 'Active'  },
  { key: 'completed',   label: 'Done'    },
];

export default function EmployeeTasksPage() {
  const { status: sessionStatus } = useSession();
  const router = useRouter();

  const [tasks,   setTasks]   = useState<TaskItem[]>([]);
  const [shift,   setShift]   = useState<'morning' | 'evening' | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: TaskItem[]; shift: 'morning' | 'evening' | null };
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

  // discrepancy counts under 'in_progress' tab so carry-forward tasks aren't missed
  const countFilter = (f: Filter) => {
    if (f === 'all')         return tasks.length;
    if (f === 'in_progress') return tasks.filter(t => t.data.status === 'in_progress' || t.data.status === 'discrepancy').length;
    return tasks.filter(t => t.data.status === f).length;
  };

  const filtered = tasks.filter(t => {
    if (filter === 'all')         return true;
    if (filter === 'in_progress') return t.data.status === 'in_progress' || t.data.status === 'discrepancy';
    return t.data.status === filter;
  });

  const morningTasks = filtered.filter(t => t.shift === 'morning');
  const eveningTasks = filtered.filter(t => t.shift === 'evening');
  const notScheduled = !loading && tasks.length === 0;

  return (
    <div className="flex flex-col min-h-screen bg-background">

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
              {shift === 'morning' ? <Sun className="h-3.5 w-3.5 text-yellow-300" /> : <Moon className="h-3.5 w-3.5 text-blue-300" />}
              <span className="text-xs font-semibold capitalize text-primary-foreground">
                {shift === 'morning' ? 'Morning Shift' : 'Evening Shift'}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {FILTERS.map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className={cn(
                'flex flex-shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide transition-all',
                filter === key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary text-muted-foreground hover:bg-border',
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

      <div className="flex-1 p-4 space-y-6">
        {loading ? (
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-secondary" />)}
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
                <div className="mb-2 flex items-center gap-2">
                  <Sun className="h-4 w-4 text-amber-500" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Morning Shift</h2>
                  <div className="h-px flex-1 bg-border" />
                </div>
                <div className="space-y-2.5">
                  {morningTasks.map(item => <TaskCard key={`${item.type}-${item.data.id}`} item={item} onOpen={openTask} />)}
                </div>
              </section>
            )}
            {eveningTasks.length > 0 && (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <Moon className="h-4 w-4 text-blue-500" />
                  <h2 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Evening Shift</h2>
                  <div className="h-px flex-1 bg-border" />
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

  const showCarryForward =
    isDiscrepancy && (
      // item_dropping: only when hasDropping=true (actual delivery pending receipt)
      (item.type === 'item_dropping' && (item.data as ItemDroppingData).hasDropping) ||
      // edc_reconciliation: always show carry-forward when discrepancy
      item.type === 'edc_reconciliation' ||
      // open_statement: always show carry-forward when discrepancy
      item.type === 'open_statement'
    );

  const carryForwardDescription: Partial<Record<TaskType, string>> = {
    item_dropping:      'Item belum diterima dari hari sebelumnya — tap untuk konfirmasi & upload foto.',
    edc_reconciliation: 'Rekonsiliasi EDC belum selesai dari shift sebelumnya — tap untuk lanjutkan.',
    open_statement:     'Selisih open statement belum terselesaikan — tap untuk lanjutkan.',
  };

  return (
    <Card
      className={cn(
        'overflow-hidden border-border shadow-sm transition-all cursor-pointer active:scale-[0.99]',
        isTerminal    && 'opacity-75',
        isRejected    && 'border-red-200',
        isDiscrepancy && 'border-amber-300',
      )}
      onClick={() => onOpen(item)}
    >
      {status === 'in_progress'  && <div className="h-0.5 w-full animate-pulse bg-primary" />}
      {status === 'completed'    && <div className="h-0.5 w-full bg-green-500" />}
      {status === 'verified'     && <div className="h-0.5 w-full bg-green-600" />}
      {status === 'rejected'     && <div className="h-0.5 w-full bg-red-500" />}
      {status === 'discrepancy'  && <div className="h-0.5 w-full animate-pulse bg-amber-400" />}

      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl',
            isDiscrepancy ? 'bg-amber-100' : 'bg-secondary',
          )}>
            <TaskIcon className={cn('h-4 w-4', isDiscrepancy ? 'text-amber-700' : 'text-foreground')} strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-tight text-foreground">{meta.title}</p>
              {isTerminal && item.data.completedAt ? (
                <span className="flex-shrink-0 text-[10px] font-medium text-green-600">
                  ✓ {new Date(item.data.completedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </span>
              ) : (
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              )}
            </div>

            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
              {showCarryForward
                ? (carryForwardDescription[item.type] ?? meta.description)
                : meta.description}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge className={cn('h-4 gap-1 px-1.5 text-[10px] font-semibold', cfg.cls)}>
                <StatusIcon className="h-2.5 w-2.5" />{cfg.label}
              </Badge>
              {meta.hasPhoto && (
                <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
                  <Camera className="h-2.5 w-2.5" />Photo
                </Badge>
              )}
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] capitalize">{item.shift}</Badge>
              {item.type === 'grooming' ? (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-violet-600 border-violet-200">Personal</Badge>
              ) : (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">Shared</Badge>
              )}
              {showCarryForward && (
                <Badge className="h-4 gap-1 px-1.5 text-[10px] font-semibold bg-amber-500 text-white hover:bg-amber-500">
                  <AlertTriangle className="h-2.5 w-2.5" />Carry-forward
                </Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}