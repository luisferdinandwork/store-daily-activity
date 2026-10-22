'use client';
// app/ops/tasks/progress/store-day.tsx
//
// One store's day, in a slide-over: its tasks grouped by shift (each naming who
// did it), the Serah Terima board, and — on a click — the task's full detail.
// Opened from the task board (Ops /ops/tasks/progress, IT /it/task-progress).

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, ClipboardList, History, Loader2, User } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { EDC_BANKS } from '@/lib/store-closing-edc';
import {
  DoerLine,
  SerahTerimaPanel,
  TASK_ICONS,
  TASK_LABELS,
  TaskDetailView,
  edcSummaryOf,
  fmtTime,
  statusBadgeClass,
  statusLabel,
  type FlatTask,
  type SerahTerimaBoardView,
  type TaskStatus,
} from './task-detail';

export interface StoreDayTarget {
  storeId: number;
  name: string;
  storeNo: string;
  /** Jakarta day "YYYY-MM-DD". */
  date: string;
  /** Open straight onto this task (its row id; null = the not-yet-opened slot of `focusType`/`focusShift`). */
  focusType?: string;
  focusId?: number | null;
  focusShift?: string | null;
}

type StoreDay = {
  date: string;
  store: { id: string; name: string; storeNo: string; address: string };
  summary: { completed: number; total: number; completionRate: number };
  tasks: FlatTask[];
  serahTerima: SerahTerimaBoardView;
};

const isFinished = (status: string | null | undefined) => status === 'completed' || status === 'verified';

function taskKey(t: Pick<FlatTask, 'type' | 'id'>): string {
  return `${t.type}-${t.id}`;
}

function fmtDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

function rateColor(rate: number): string {
  if (rate >= 100) return '#10b981';
  if (rate === 0) return '#fbbf24';
  return '#6366f1';
}

function ProgressRing({ pct, size = 56, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (Math.min(100, Math.max(0, pct)) / 100) * c;
  const color = rateColor(pct);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-black tabular-nums" style={{ color }}>{pct}%</span>
      </div>
    </div>
  );
}

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-1.5 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: rateColor(pct) }} />
    </div>
  );
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task, onSelect }: { task: FlatTask; onSelect: () => void }) {
  const label = TASK_LABELS[task.type] ?? task.type.replaceAll('_', ' ');
  const status = task.status ?? 'not_started';
  const TaskIcon = TASK_ICONS[task.type] ?? ClipboardList;

  // Cek Uang Modal: a completed float below the daily max or with empty
  // denominations — words match Finance Uang Modal Review ("Belum penuh").
  const cekUangModalIncomplete = (() => {
    if (task.type !== 'cek_uang_modal' || !isFinished(status)) return null;
    const e = task.extra;
    if (Number(e.totalAmount ?? 0) <= 0) return null;
    if (e.isPartial === true) return 'Belum penuh';
    const denomCount = Number(e.denominationCount ?? 0);
    return denomCount > 0 && Number(e.filledDenominationCount ?? 0) < denomCount ? 'Pecahan belum lengkap' : null;
  })();

  const marketingSkipped = task.type === 'marketing_check' && isFinished(status) && task.extra.hasMarketingCheck === false;

  // Store Closing: the EDC money as far as the store has typed it.
  const closingEdc = task.type === 'store_closing' && !task.isPlaceholder ? edcSummaryOf(task.extra) : null;
  const closingEdcLine = (() => {
    if (!closingEdc?.hasData) return null;
    const total = `Rp ${closingEdc.total.toLocaleString('id-ID')}`;
    if (isFinished(status)) return `EDC ${total}`;
    return `Rekap EDC ${EDC_BANKS.length - closingEdc.missingBanks.length}/${EDC_BANKS.length} bank · ${total}`;
  })();

  const tone =
    isFinished(status) ? 'bg-emerald-50 text-emerald-600' :
    status === 'in_progress' ? 'bg-indigo-50 text-indigo-600' :
    status === 'pending' ? 'bg-amber-50 text-amber-600' :
    'bg-slate-100 text-slate-400';

  return (
    <button type="button" onClick={onSelect} className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', tone)}>
        <TaskIcon className="h-4 w-4" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-slate-900">{label}</span>
          {task.parentTaskId != null && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-indigo-600">
              <History className="h-2.5 w-2.5" /> Lanjutan
            </span>
          )}
          {cekUangModalIncomplete && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
              <AlertTriangle className="h-2.5 w-2.5" /> {cekUangModalIncomplete}
            </span>
          )}
          {marketingSkipped && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-600">Tidak ada promo</span>
          )}
        </span>
        <DoerLine task={task} className="mt-0.5 text-[11px]" />
        {closingEdcLine && <span className="mt-0.5 block text-[11px] font-semibold text-slate-600">{closingEdcLine}</span>}
        {task.type === 'setoran' && task.extra.actualReceivedAmount != null && (
          <span className="mt-0.5 block text-[11px] font-semibold text-slate-600">
            Diterima Rp {Number(task.extra.actualReceivedAmount).toLocaleString('id-ID')}
          </span>
        )}
      </span>
      <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>{statusLabel(status)}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

// ─── Grooming: one row per employee, folded into one card ───────────────────

function GroomingGroupCard({ tasks, onSelect }: { tasks: FlatTask[]; onSelect: (key: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const done = tasks.filter((t) => isFinished(t.status)).length;
  const active = tasks.filter((t) => t.status === 'in_progress').length;
  const flagged = tasks.filter((t) => t.status === 'pending').length;
  const aggregate: TaskStatus = done === tasks.length ? 'completed' : active > 0 ? 'in_progress' : flagged > 0 ? 'pending' : 'not_started';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-slate-50">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', aggregate === 'completed' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400')}>
          <User className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Grooming Karyawan</span>
          <span className="mt-0.5 block text-[11px] text-slate-400">
            <span className="font-semibold text-slate-700">{done}/{tasks.length}</span> karyawan sudah grooming
          </span>
          <ProgressBar pct={tasks.length ? Math.round((done / tasks.length) * 100) : 0} className="mt-2" />
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-300 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-slate-100 bg-slate-50/70 p-2.5">
          {tasks.map((task) => {
            const s = task.status ?? 'not_started';
            return (
              <button key={task.id} type="button" onClick={() => onSelect(taskKey(task))} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-900">{task.userName ?? task.userId}</span>
                  <span className="block text-[10px] text-slate-400">
                    {isFinished(s) && task.completedAt ? `Selesai ${fmtTime(task.completedAt)}` : s === 'in_progress' ? 'Sedang dikerjakan' : 'Belum grooming'}
                  </span>
                </span>
                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(s))}>{statusLabel(s)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── The day ─────────────────────────────────────────────────────────────────

const SHIFT_SECTIONS = [
  { key: 'morning', label: 'Morning Shift' },
  { key: 'middle', label: 'Middle Shift' },
  { key: 'full_day', label: 'Full Day Shift' },
  { key: 'evening', label: 'Evening Shift' },
  { key: 'other', label: 'Other' },
] as const;

function StoreDayBody({ day, onSelect }: { day: StoreDay; onSelect: (key: string) => void }) {
  const groups = useMemo(() => {
    const g: Record<string, { regular: FlatTask[]; grooming: FlatTask[] }> = Object.fromEntries(
      SHIFT_SECTIONS.map((s) => [s.key, { regular: [], grooming: [] }]),
    );
    for (const task of day.tasks) {
      const s = task.shift as string | null;
      const k = s === 'morning' || s === 'middle' || s === 'full_day' || s === 'evening' ? s : 'other';
      (task.type === 'grooming' ? g[k].grooming : g[k].regular).push(task);
    }
    return g;
  }, [day.tasks]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
        <ProgressRing pct={day.summary.completionRate} />
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">{fmtDateLabel(day.date)}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            <span className="font-mono font-semibold text-slate-600">{day.store.storeNo}</span>
            {day.store.address && ` · ${day.store.address}`}
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-800">{day.summary.completed} dari {day.summary.total} task selesai</p>
        </div>
      </div>

      <SerahTerimaPanel board={day.serahTerima} />

      {day.tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Tidak ada task untuk toko ini pada tanggal ini.</p>
      ) : (
        SHIFT_SECTIONS.map((section) => {
          const { regular, grooming } = groups[section.key];
          const total = regular.length + (grooming.length ? 1 : 0);
          if (!total) return null;
          const done = regular.filter((t) => isFinished(t.status)).length + (grooming.length && grooming.every((t) => isFinished(t.status)) ? 1 : 0);
          return (
            <section key={section.key}>
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{section.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-slate-200">{done}/{total} selesai</span>
              </div>
              <div className="space-y-2">
                {grooming.length > 0 && <GroomingGroupCard tasks={grooming} onSelect={onSelect} />}
                {regular.map((task) => <TaskRow key={taskKey(task)} task={task} onSelect={() => onSelect(taskKey(task))} />)}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

/** Pick the task a cell click asked for (null = show the whole day). */
function focusedTask(day: StoreDay, target: StoreDayTarget): FlatTask | null {
  if (!target.focusType) return null;
  const ofType = day.tasks.filter((t) => t.type === target.focusType);
  if (target.focusId != null) return ofType.find((t) => Number(t.id) === target.focusId) ?? null;
  return ofType.find((t) => t.isPlaceholder && (target.focusShift == null || t.shift === target.focusShift)) ?? null;
}

export default function StoreDaySheet({ target, onClose }: { target: StoreDayTarget | null; onClose: () => void }) {
  const key = target ? `${target.storeId}|${target.date}` : null;
  const [loaded, setLoaded] = useState<{ key: string; day: StoreDay | null; error: string } | null>(null);
  // The task open inside the sheet — keyed by the target, so a new cell starts fresh.
  const [selected, setSelected] = useState<{ for: StoreDayTarget; key: string | null } | null>(null);

  useEffect(() => {
    if (!target || !key) return;
    let stale = false;
    (async () => {
      try {
        const params = new URLSearchParams({ date: target.date, storeId: String(target.storeId) });
        const res = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat task toko.');
        if (!stale) setLoaded({ key, day: json as StoreDay, error: '' });
      } catch (err) {
        if (!stale) setLoaded({ key, day: null, error: err instanceof Error ? err.message : 'Gagal memuat task toko.' });
      }
    })();
    return () => { stale = true; };
  }, [key, target]);

  const ready = loaded && loaded.key === key ? loaded : null;
  const day = ready?.day ?? null;

  let openTask: FlatTask | null = null;
  if (day && target) {
    if (selected?.for === target) openTask = selected.key ? day.tasks.find((t) => taskKey(t) === selected.key) ?? null : null;
    else openTask = focusedTask(day, target);
  }

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 bg-slate-50 p-0 sm:max-w-2xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 pr-12">
          <SheetTitle className="truncate text-base font-bold text-slate-900">{target?.name ?? 'Task toko'}</SheetTitle>
          <SheetDescription className="truncate text-xs text-slate-500">
            {target && <><span className="font-mono font-semibold text-slate-600">{target.storeNo}</span> · {fmtDateLabel(target.date)}</>}
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!target ? null : !ready ? (
            <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Memuat task toko…
            </div>
          ) : !day ? (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="text-sm font-semibold">{ready.error}</p>
            </div>
          ) : openTask ? (
            <TaskDetailView task={openTask} onBack={() => setSelected({ for: target, key: null })} />
          ) : (
            <StoreDayBody day={day} onSelect={(k) => setSelected({ for: target, key: k })} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
