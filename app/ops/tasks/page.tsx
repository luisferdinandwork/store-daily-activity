'use client';
// app/ops/tasks/page.tsx — OPS task verifier (desktop)

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter }  from 'next/navigation';
import {
  Loader2, Shield, MapPin, Store as StoreIcon,
  ChevronLeft, ChevronRight, RefreshCw, CheckCircle2,
  XCircle, Clock, AlertCircle, Sun, Moon, Users,
  ChevronDown, X, Eye, CheckCheck, Ban, ImageIcon,
  ClipboardList, Search, Zap, Keyboard,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';
type TaskType   =
  | 'store_opening' | 'setoran' | 'cek_bin' | 'product_check' | 'receiving'
  | 'briefing' | 'edc_summary' | 'edc_settlement' | 'eod_z_report' | 'open_statement'
  | 'grooming';

interface OpsTask {
  id:          string;
  type:        TaskType;
  scheduleId:  string;
  userId:      string;
  userName:    string;
  storeId:     string;
  shift:       'morning' | 'evening' | null;
  date:        string;
  status:      TaskStatus | null;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
  extra:       Record<string, any>;
}

interface StoreSummary {
  pending: number; inProgress: number; completed: number;
  verified: number; rejected: number; total: number;
}

interface StoreOption {
  id:      string;
  name:    string;
  address: string;
  summary: StoreSummary;
}

interface AreaInfo { id: number; name: string; }

// ─── Constants ────────────────────────────────────────────────────────────────

const TASK_META: Record<TaskType, { label: string; shift: 'morning' | 'evening' | 'both'; icon: string }> = {
  store_opening:  { label: 'Store Opening',  shift: 'morning', icon: '🏪' },
  setoran:        { label: 'Setoran',        shift: 'morning', icon: '💰' },
  cek_bin:        { label: 'Cek Bin',        shift: 'morning', icon: '📦' },
  product_check:  { label: 'Product Check',  shift: 'morning', icon: '🏷️' },
  receiving:      { label: 'Receiving',      shift: 'morning', icon: '📥' },
  briefing:       { label: 'Briefing',       shift: 'evening', icon: '📋' },
  edc_summary:    { label: 'EDC Summary',    shift: 'evening', icon: '💳' },
  edc_settlement: { label: 'EDC Settlement', shift: 'evening', icon: '🧾' },
  eod_z_report:   { label: 'EOD Z-Report',   shift: 'evening', icon: '📊' },
  open_statement: { label: 'Open Statement', shift: 'evening', icon: '📄' },
  grooming:       { label: 'Grooming',       shift: 'both',    icon: '👔' },
};

const STATUS_CFG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  pending:     { label: 'Pending',     bg: '#f8fafc', border: '#e2e8f0', text: '#64748b', dot: '#cbd5e1' },
  in_progress: { label: 'In Progress', bg: '#fffbeb', border: '#fde68a', text: '#b45309', dot: '#fbbf24' },
  completed:   { label: 'Needs Review',bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', dot: '#4ade80' },
  verified:    { label: 'Verified',    bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#6366f1' },
  rejected:    { label: 'Rejected',    bg: '#fff1f2', border: '#fecdd3', text: '#9f1239', dot: '#f43f5e' },
};

const STORAGE_KEY_LAST_STORE = 'ops:tasks:lastSelectedStoreId';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' });
}

/** Pull photos out of a task's extra bag, regardless of which field holds them. */
function extractPhotos(task: OpsTask): string[] {
  const e = task.extra;
  const out: string[] = [];
  const candidates = [
    'storeFrontPhotos', 'cashDrawerPhotos', 'moneyPhotos', 'receivingPhotos',
    'edcSummaryPhotos', 'edcSettlementPhotos', 'zReportPhotos', 'openStatementPhotos',
    'selfiePhotos',
  ];
  for (const key of candidates) {
    const val = e[key];
    if (Array.isArray(val)) out.push(...val);
  }
  return out;
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string | null }) {
  const cfg = STATUS_CFG[status ?? 'pending'] ?? STATUS_CFG.pending;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

// ─── PhotoGrid ────────────────────────────────────────────────────────────────

function PhotoGrid({ photos, compact = false }: { photos: string[]; compact?: boolean }) {
  if (!photos.length) return null;
  return (
    <div>
      {!compact && (
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Photos ({photos.length})
        </p>
      )}
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-4' : 'grid-cols-3')}>
        {photos.map((src, i) => {
          const cleanSrc = src.replace(/^\/+/, '');
          return (
            <a
              key={i}
              href={`/storage/${cleanSrc}`}
              target="_blank"
              rel="noreferrer"
              className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-slate-50 hover:opacity-90 transition"
              onClick={e => e.stopPropagation()}
            >
              <img
                src={`/storage/${cleanSrc}`}
                alt=""
                className="h-full w-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              <ImageIcon className="absolute h-5 w-5 text-slate-300" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ─── TaskDetailPanel ──────────────────────────────────────────────────────────

function TaskDetailPanel({ task, onVerify, onReject, saving, onClose }: {
  task:     OpsTask;
  onVerify: (notes?: string) => void;
  onReject: (notes?: string) => void;
  saving:   boolean;
  onClose:  () => void;
}) {
  const [notes, setNotes] = useState('');
  const meta   = TASK_META[task.type];
  const canAct = task.status === 'completed';
  const photos = extractPhotos(task);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!canAct || saving)  return;
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'v' || e.key === 'V') { e.preventDefault(); onVerify(notes || undefined); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); onReject(notes || undefined); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canAct, saving, notes, onVerify, onReject, onClose]);

  function renderExtra() {
    const e = task.extra;

    if (task.type === 'store_opening') {
      const checks: [string, boolean][] = [
        ['Login POS',         !!e.loginPos],
        ['Absen Sunfish',     !!e.checkAbsenSunfish],
        ['Tarik SOH & Sales', !!e.tarikSohSales],
        ['5R Cleaning',       !!e.fiveR],
        ['Cek Lampu',         !!e.cekLamp],
        ['Sound System',      !!e.cekSoundSystem],
      ];
      return (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Checklist</p>
            <div className="grid grid-cols-2 gap-1.5">
              {checks.map(([label, done]) => (
                <div key={label} className={cn(
                  'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold',
                  done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400',
                )}>
                  {done
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    : <Clock className="h-3.5 w-3.5 shrink-0" />}
                  {label}
                </div>
              ))}
            </div>
          </div>
          <PhotoGrid photos={photos} />
        </div>
      );
    }

    if (task.type === 'setoran') {
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Amount</p>
              <p className="text-lg font-bold text-slate-800">
                {e.amount ? `Rp ${Number(e.amount).toLocaleString('id-ID')}` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Link Setoran</p>
              <p className="mt-1 truncate text-xs font-semibold text-indigo-600">
                {e.linkSetoran
                  ? <a href={e.linkSetoran} target="_blank" rel="noreferrer" className="hover:underline">View transfer</a>
                  : '—'}
              </p>
            </div>
          </div>
          <PhotoGrid photos={photos} />
        </div>
      );
    }

    if (task.type === 'product_check') {
      const checks: [string, boolean][] = [
        ['Display',     !!e.display],
        ['Price',       !!e.price],
        ['Sale Tag',    !!e.saleTag],
        ['Shoe Filler', !!e.shoeFiller],
        ['Label Indo',  !!e.labelIndo],
        ['Barcode',     !!e.barcode],
      ];
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {checks.map(([label, done]) => (
            <div key={label} className={cn(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold',
              done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-400',
            )}>
              {done
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                : <Clock className="h-3.5 w-3.5 shrink-0" />}
              {label}
            </div>
          ))}
        </div>
      );
    }

    if (task.type === 'receiving') {
      const hasRec = !!e.hasReceiving;
      return (
        <div className="space-y-4">
          <div className={cn(
            'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold',
            hasRec ? 'bg-blue-50 text-blue-700' : 'bg-slate-50 text-slate-500',
          )}>
            {hasRec ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {hasRec ? 'Barang diterima hari ini' : 'Tidak ada penerimaan barang'}
          </div>
          <PhotoGrid photos={photos} />
        </div>
      );
    }

    if (task.type === 'grooming') {
      const items: [string, boolean, boolean | null][] = [
        ['Uniform',     !!e.uniformActive,     e.uniformComplete ?? null],
        ['Hair',        !!e.hairActive,        e.hairGroomed ?? null],
        ['Nails',       !!e.nailsActive,       e.nailsClean ?? null],
        ['Accessories', !!e.accessoriesActive, e.accessoriesCompliant ?? null],
        ['Shoes',       !!e.shoeActive,        e.shoeCompliant ?? null],
      ];
      const activeItems = items.filter(([, active]) => active);
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1.5">
            {activeItems.map(([label, , done]) => (
              <div key={label} className={cn(
                'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold',
                done === true  ? 'bg-emerald-50 text-emerald-700'
                : done === false ? 'bg-red-50 text-red-700'
                : 'bg-slate-50 text-slate-400',
              )}>
                {done === true  ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                : done === false ? <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                : <Clock className="h-3.5 w-3.5 shrink-0" />}
                {label}
              </div>
            ))}
          </div>
          <PhotoGrid photos={photos} />
        </div>
      );
    }

    if (['edc_summary','edc_settlement','eod_z_report','open_statement'].includes(task.type)) {
      if (!photos.length) return <p className="text-xs text-slate-400">No photos submitted.</p>;
      return <PhotoGrid photos={photos} />;
    }

    if (task.type === 'briefing') {
      const done = !!e.done;
      return (
        <div className={cn(
          'flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold',
          done ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-500',
        )}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
          {done ? 'Briefing dilaksanakan' : 'Belum dilaksanakan'}
        </div>
      );
    }

    return <p className="text-xs italic text-slate-400">No additional data for this task type.</p>;
  }

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="w-[480px] bg-white shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">{meta?.icon}</span>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {task.shift === 'morning' ? 'Morning' : task.shift === 'evening' ? 'Evening' : ''} task
                </p>
              </div>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{meta?.label}</p>
              <p className="text-sm text-slate-500">{task.userName}</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <StatusBadge status={task.status} />
            {task.completedAt && (
              <span className="text-xs text-slate-400">Submitted {formatTime(task.completedAt)}</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {renderExtra()}

          {task.notes && (
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Notes from employee</p>
              <p className="mt-1 text-xs text-amber-800">{task.notes}</p>
            </div>
          )}

          {canAct && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">OPS Review</p>
                <p className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Keyboard className="h-3 w-3" />
                  <kbd className="rounded bg-white px-1 font-mono">V</kbd> verify ·{' '}
                  <kbd className="rounded bg-white px-1 font-mono">R</kbd> reject
                </p>
              </div>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add a note (optional)…"
                rows={2}
                className="mb-3 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 placeholder-slate-300 focus:border-indigo-300 focus:outline-none"
              />
              <div className="flex gap-2.5">
                <button
                  onClick={() => {
                    if (!notes) {
                      const ok = confirm('Reject without a note? The employee won\'t know what to fix.');
                      if (!ok) return;
                    }
                    onReject(notes || undefined);
                  }}
                  disabled={saving}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                  Reject
                </button>
                <button
                  onClick={() => onVerify(notes || undefined)}
                  disabled={saving}
                  className="flex h-10 flex-[2] items-center justify-center gap-1.5 rounded-xl text-xs font-bold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Verify Task
                </button>
              </div>
            </div>
          )}

          {task.status === 'verified' && (
            <div className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
              <CheckCheck className="h-4 w-4 text-indigo-500" />
              <div>
                <p className="text-xs font-bold text-indigo-700">Verified</p>
                {task.verifiedAt && <p className="text-[11px] text-indigo-500">at {formatTime(task.verifiedAt)}</p>}
              </div>
            </div>
          )}

          {task.status === 'rejected' && (
            <div className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <p className="text-xs font-bold text-red-700">Rejected</p>
                {task.notes && <p className="text-[11px] text-red-500">{task.notes}</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({ task, onClick, selected }: {
  task:     OpsTask;
  onClick:  () => void;
  selected: boolean;
}) {
  const meta   = TASK_META[task.type];
  const cfg    = STATUS_CFG[task.status ?? 'pending'] ?? STATUS_CFG.pending;
  const needsReview = task.status === 'completed';
  const photos = extractPhotos(task);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative w-full rounded-2xl border text-left transition-all hover:shadow-md',
        needsReview && 'ring-1 ring-emerald-200',
        selected && 'ring-2 ring-indigo-400',
      )}
      style={{ borderColor: cfg.border, background: cfg.bg }}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg"
          style={{ background: cfg.dot + '25' }}
        >
          {meta?.icon ?? '📋'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{meta?.label}</p>
              <p className="text-[11px] text-slate-500 truncate">{task.userName}</p>
            </div>
            <StatusBadge status={task.status} />
          </div>

          {photos.length > 0 && (
            <div className="mt-2.5">
              <PhotoGrid photos={photos.slice(0, 4)} compact />
              {photos.length > 4 && (
                <p className="mt-1 text-[10px] text-slate-400">+{photos.length - 4} more</p>
              )}
            </div>
          )}

          {task.completedAt && (
            <p className="mt-2 text-[10px] text-slate-400">Submitted {formatTime(task.completedAt)}</p>
          )}
        </div>
      </div>
      {needsReview && (
        <div className="absolute right-3 top-3 opacity-0 transition group-hover:opacity-100">
          <Eye className="h-4 w-4 text-emerald-600" />
        </div>
      )}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsTasksPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user  = session?.user as any;
  const role  = user?.role as string | undefined;
  const isOps = role === 'ops';

  // State
  const [stores,        setStores]        = useState<StoreOption[]>([]);
  const [area,          setArea]          = useState<AreaInfo | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);

  const [selectedDate,  setSelectedDate]  = useState<string>(() => isoDate(new Date()));
  const [tasks,         setTasks]         = useState<OpsTask[]>([]);
  const [summary,       setSummary]       = useState<StoreSummary | null>(null);
  const [storeName,     setStoreName]     = useState('');
  const [loading,       setLoading]       = useState(false);

  const [activeTask,   setActiveTask]   = useState<OpsTask | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [bulkSaving,   setBulkSaving]   = useState(false);
  const [filterShift,  setFilterShift]  = useState<'all' | 'morning' | 'evening'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'verified' | 'pending' | 'rejected'>('all');
  const [filterEmployee, setFilterEmployee] = useState<string>('all');
  const [searchQuery,  setSearchQuery]  = useState('');

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  // ── Load stores ────────────────────────────────────────────────────────────
  const loadStores = useCallback(async (date: string) => {
    setStoresLoading(true);
    try {
      const res  = await fetch(`/api/ops/tasks/stores?date=${date}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed');
      setStores(json.stores ?? []);
      setArea(json.area ?? null);

      const remembered = typeof window !== 'undefined'
        ? sessionStorage.getItem(STORAGE_KEY_LAST_STORE)
        : null;
      const valid = remembered && (json.stores ?? []).some((s: StoreOption) => s.id === remembered);

      if (valid) setSelectedStore(remembered);
      else if ((json.stores ?? []).length > 0) setSelectedStore(json.stores[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stores');
    } finally {
      setStoresLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOps) loadStores(selectedDate);
  }, [isOps, loadStores, selectedDate]);

  useEffect(() => {
    if (selectedStore && typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY_LAST_STORE, selectedStore);
    }
  }, [selectedStore]);

  // ── Load tasks ──────────────────────────────────────────────────────────────
  const loadTasks = useCallback(async (storeId: string, date: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ops/tasks?storeId=${storeId}&date=${date}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed');
      setTasks(json.tasks ?? []);
      setSummary(json.summary ?? null);
      setStoreName(json.storeName ?? '');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStore) loadTasks(selectedStore, selectedDate);
  }, [selectedStore, selectedDate, loadTasks]);

  // Reset employee filter when store changes
  useEffect(() => {
    setFilterEmployee('all');
    setSearchQuery('');
  }, [selectedStore, selectedDate]);

  // ── Date nav ───────────────────────────────────────────────────────────────
  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(isoDate(d));
  }

  // ── Verify / Reject single ─────────────────────────────────────────────────
  async function handleVerify(action: 'verify' | 'reject', notes?: string) {
    if (!activeTask || !selectedStore) return;
    setSaving(true);
    try {
      const res  = await fetch('/api/ops/tasks', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          taskId:   activeTask.id,
          taskType: activeTask.type,
          storeId:  Number(selectedStore),
          action,
          notes,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(action === 'verify' ? 'Task verified ✓' : 'Task rejected');
      setActiveTask(null);
      loadTasks(selectedStore, selectedDate);
      loadStores(selectedDate);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Derived / Filtered ─────────────────────────────────────────────────────
  const currentStoreObj = stores.find(s => s.id === selectedStore);

  // Unique employees from the current task list, for the employee filter
  const employees = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) {
      if (!map.has(t.userId)) map.set(t.userId, t.userName);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter(t => {
      if (filterShift !== 'all' && t.shift !== filterShift) return false;
      if (filterStatus !== 'all') {
        if (filterStatus === 'pending' && t.status !== 'pending' && t.status !== 'in_progress') return false;
        if (filterStatus !== 'pending' && t.status !== filterStatus) return false;
      }
      if (filterEmployee !== 'all' && t.userId !== filterEmployee) return false;
      if (q) {
        const label = TASK_META[t.type]?.label.toLowerCase() ?? '';
        if (!label.includes(q) && !t.userName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [tasks, filterShift, filterStatus, filterEmployee, searchQuery]);

  const morningTasks = filteredTasks.filter(t => t.shift === 'morning');
  const eveningTasks = filteredTasks.filter(t => t.shift === 'evening');
  const nullShiftTasks = filteredTasks.filter(t => !t.shift);

  const needsVerificationInFilter = filteredTasks.filter(t => t.status === 'completed');
  const canBulkVerify = needsVerificationInFilter.length > 0;

  // Per-employee progress (within the current store/date, unfiltered)
  const employeeProgress = useMemo(() => {
    const map = new Map<string, { name: string; total: number; done: number }>();
    for (const t of tasks) {
      const entry = map.get(t.userId) ?? { name: t.userName, total: 0, done: 0 };
      entry.total++;
      if (t.status === 'verified' || t.status === 'completed') entry.done++;
      map.set(t.userId, entry);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v, pct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  const dateObj      = new Date(selectedDate + 'T00:00:00');
  const isToday      = selectedDate === isoDate(new Date());
  const displayDate  = isToday
    ? 'Today'
    : dateObj.toLocaleDateString('en-ID', { weekday: 'short', day: 'numeric', month: 'short' });

  // ── Bulk verify ────────────────────────────────────────────────────────────
  async function handleBulkVerify() {
    if (!selectedStore || needsVerificationInFilter.length === 0) return;
    const count = needsVerificationInFilter.length;
    if (!confirm(`Verify all ${count} completed task${count !== 1 ? 's' : ''} in the current view?`)) return;

    setBulkSaving(true);
    try {
      const res  = await fetch('/api/ops/tasks/bulk', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          storeId: Number(selectedStore),
          action:  'verify',
          tasks:   needsVerificationInFilter.map(t => ({ taskId: Number(t.id), taskType: t.type })),
        }),
      });
      const json = await res.json();
      if (json.succeeded > 0) {
        toast.success(`Verified ${json.succeeded} task${json.succeeded !== 1 ? 's' : ''}`);
      }
      if (json.failed?.length) {
        toast.error(`${json.failed.length} task${json.failed.length !== 1 ? 's' : ''} failed`);
      }
      loadTasks(selectedStore, selectedDate);
      loadStores(selectedDate);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Bulk verify failed');
    } finally {
      setBulkSaving(false);
    }
  }

  // ── Auth guards ────────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isOps) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
        <Shield className="h-8 w-8 text-red-500" />
      </div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can manage area tasks.</p>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">OPS · Area Tasks</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Task Manager</h1>
            {area && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="h-3.5 w-3.5" />
                {area.name} · {stores.length} store{stores.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {selectedStore && (
            <button
              onClick={() => { loadTasks(selectedStore, selectedDate); loadStores(selectedDate); }}
              disabled={loading}
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh
            </button>
          )}
        </div>

        {/* ── Store + Date picker ── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 min-w-[280px]">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Store</label>
              {storesLoading ? (
                <div className="h-11 w-full animate-pulse rounded-xl bg-slate-100" />
              ) : stores.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  No stores in your area.
                </div>
              ) : (
                <div className="relative">
                  <StoreIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <select
                    value={selectedStore ?? ''}
                    onChange={e => setSelectedStore(e.target.value)}
                    className="h-11 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-semibold text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                  >
                    {stores.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.summary.completed > 0 ? `(${s.summary.completed} pending)` : ''}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              )}
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Date</label>
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  onClick={() => shiftDate(-1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="px-4 text-center min-w-[140px]">
                  <p className="text-sm font-bold text-slate-800">{displayDate}</p>
                  {!isToday && <p className="text-[10px] text-slate-400">{selectedDate}</p>}
                </div>
                <button
                  onClick={() => shiftDate(1)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  disabled={selectedDate >= isoDate(new Date())}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {!isToday && (
              <button
                onClick={() => setSelectedDate(isoDate(new Date()))}
                className="h-11 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-600 hover:bg-indigo-100"
              >
                Today
              </button>
            )}
          </div>

          {selectedStore && currentStoreObj && (
            <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3" />
                {currentStoreObj.address}
              </span>
              {summary && summary.completed > 0 && (
                <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
                  <AlertCircle className="h-3 w-3" />
                  {summary.completed} awaiting verification
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Store cards (area overview) ── */}
        {stores.length > 1 && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {stores.map(s => {
              const pct = s.summary.total > 0
                ? Math.round(((s.summary.verified + s.summary.completed) / s.summary.total) * 100)
                : 0;
              const isSelected = s.id === selectedStore;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStore(s.id)}
                  className={cn(
                    'rounded-2xl border p-4 text-left transition-all hover:shadow-sm',
                    isSelected
                      ? 'border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200'
                      : 'border-slate-200 bg-white',
                  )}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-800 truncate pr-2">{s.name}</p>
                    {s.summary.completed > 0 && (
                      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        {s.summary.completed} review
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct === 100 ? '#6366f1' : pct > 50 ? '#10b981' : '#f59e0b',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">{pct}%</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {s.summary.verified}v · {s.summary.completed}c · {s.summary.total} total
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Summary stat cards (clickable as status filters) ── */}
        {summary && !loading && tasks.length > 0 && (
          <div className="grid grid-cols-5 gap-3">
            {[
              { key: 'total',     label: 'Total',        value: summary.total,                         color: '#6366f1', Icon: ClipboardList },
              { key: 'pending',   label: 'Pending',      value: summary.pending + summary.inProgress,  color: '#f59e0b', Icon: Clock },
              { key: 'completed', label: 'Needs Review', value: summary.completed,                     color: '#10b981', Icon: Eye },
              { key: 'verified',  label: 'Verified',     value: summary.verified,                      color: '#3730a3', Icon: CheckCheck },
              { key: 'rejected',  label: 'Rejected',     value: summary.rejected,                      color: '#e11d48', Icon: XCircle },
            ].map(({ key, label, value, color, Icon }) => {
              const isActive = filterStatus === key || (key === 'total' && filterStatus === 'all');
              return (
                <button
                  key={key}
                  onClick={() => setFilterStatus(key === 'total' ? 'all' : key as any)}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-4 py-4 text-left transition-all hover:shadow-sm',
                    !isActive && 'border-slate-200 bg-white',
                  )}
                  style={isActive
                    ? { borderColor: color + '60', background: color + '10', boxShadow: `0 0 0 2px ${color}30` }
                    : {}}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color + '15' }}>
                    <Icon className="h-5 w-5" style={{ color }} />
                  </div>
                  <div>
                    <p className="text-xl font-bold" style={{ color }}>{value}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Filter + search + bulk verify bar ── */}
        {tasks.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest mr-1">Shift</span>
            {(['all', 'morning', 'evening'] as const).map(s => (
              <button
                key={s}
                onClick={() => setFilterShift(s)}
                className={cn(
                  'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all',
                  filterShift === s
                    ? 'bg-indigo-500 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {s === 'morning' && <Sun className="h-3 w-3" />}
                {s === 'evening' && <Moon className="h-3 w-3" />}
                {s === 'all' ? 'All shifts' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}

            {employees.length > 1 && (
              <>
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-2 mr-1">Employee</span>
                <select
                  value={filterEmployee}
                  onChange={e => setFilterEmployee(e.target.value)}
                  className="h-8 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 focus:border-indigo-300 focus:outline-none"
                >
                  <option value="all">All ({employees.length})</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </>
            )}

            <div className="relative ml-auto">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search task or name…"
                className="h-8 w-56 rounded-xl border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 placeholder-slate-400 focus:border-indigo-300 focus:outline-none"
              />
            </div>

            {canBulkVerify && (
              <button
                onClick={handleBulkVerify}
                disabled={bulkSaving}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-white shadow-sm hover:shadow disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                {bulkSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                Verify all {needsVerificationInFilter.length}
              </button>
            )}
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          </div>
        )}

        {/* ── Main content: tasks + employee rail ── */}
        {!loading && tasks.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px]">
            {/* Task lists */}
            <div className="space-y-6">
              {/* Morning */}
              {(filterShift === 'all' || filterShift === 'morning') && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100">
                      <Sun className="h-4 w-4 text-orange-500" />
                    </div>
                    <p className="text-sm font-bold text-slate-700">Morning shift</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {morningTasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {morningTasks.length > 0 ? morningTasks.map(t => (
                      <TaskCard
                        key={`${t.type}-${t.id}`}
                        task={t}
                        onClick={() => setActiveTask(t)}
                        selected={activeTask?.id === t.id && activeTask?.type === t.type}
                      />
                    )) : (
                      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-xs text-slate-400">
                        <ClipboardList className="h-4 w-4" />
                        No morning tasks match your filter
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Evening */}
              {(filterShift === 'all' || filterShift === 'evening') && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100">
                      <Moon className="h-4 w-4 text-violet-500" />
                    </div>
                    <p className="text-sm font-bold text-slate-700">Evening shift</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {eveningTasks.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {eveningTasks.length > 0 ? eveningTasks.map(t => (
                      <TaskCard
                        key={`${t.type}-${t.id}`}
                        task={t}
                        onClick={() => setActiveTask(t)}
                        selected={activeTask?.id === t.id && activeTask?.type === t.type}
                      />
                    )) : (
                      <div className="flex items-center gap-2 rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-xs text-slate-400">
                        <ClipboardList className="h-4 w-4" />
                        No evening tasks match your filter
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Unassigned shift (fallback) */}
              {nullShiftTasks.length > 0 && filterShift === 'all' && (
                <div>
                  <div className="mb-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-slate-400" />
                    <p className="text-sm font-bold text-slate-700">Unassigned shift</p>
                  </div>
                  <div className="space-y-2">
                    {nullShiftTasks.map(t => (
                      <TaskCard
                        key={`${t.type}-${t.id}`}
                        task={t}
                        onClick={() => setActiveTask(t)}
                        selected={activeTask?.id === t.id && activeTask?.type === t.type}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Employee progress rail */}
            <aside className="hidden lg:block">
              <div className="sticky top-6 space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-400" />
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Per Employee
                    </p>
                  </div>
                  <div className="space-y-3">
                    {employeeProgress.map(emp => (
                      <button
                        key={emp.id}
                        onClick={() => setFilterEmployee(filterEmployee === emp.id ? 'all' : emp.id)}
                        className={cn(
                          'w-full text-left transition-all',
                          filterEmployee === emp.id && 'opacity-100',
                          filterEmployee !== 'all' && filterEmployee !== emp.id && 'opacity-40',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700 truncate">{emp.name}</span>
                          <span className="shrink-0 text-[10px] font-bold text-slate-500">
                            {emp.done}/{emp.total}
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${emp.pct}%`,
                              background: emp.pct === 100 ? '#6366f1' : emp.pct > 50 ? '#10b981' : '#f59e0b',
                            }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* ── No tasks ── */}
        {!loading && selectedStore && tasks.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-50">
              <ClipboardList className="h-8 w-8 text-slate-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No tasks for {storeName} on {displayDate}</p>
              <p className="mt-1 text-xs text-slate-400">
                Tasks are created automatically when employees have a schedule for this day.
              </p>
            </div>
          </div>
        )}

        {!loading && !selectedStore && !storesLoading && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <StoreIcon className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">Select a store above to view tasks</p>
          </div>
        )}
      </div>

      {/* ── Task detail panel ── */}
      {activeTask && (
        <TaskDetailPanel
          task={activeTask}
          onVerify={notes => handleVerify('verify', notes)}
          onReject={notes => handleVerify('reject', notes)}
          saving={saving}
          onClose={() => setActiveTask(null)}
        />
      )}
    </div>
  );
}