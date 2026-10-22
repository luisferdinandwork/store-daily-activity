'use client';
// components/it/task-progress/TaskDetailSheet.tsx
//
// Slide-over with the full detail of one task at one store (photos, checklist,
// amounts…) — the same TaskDetailView Ops uses, fed by the Ops store-day endpoint
// (IT may call it). Opens from a row of the IT Task Progress table.

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import {
  SerahTerimaPanel,
  TASK_LABELS,
  TaskDetailView,
  type FlatTask,
  type SerahTerimaBoardView,
} from '@/app/ops/tasks/progress/task-detail';
import { BOARD_TASK, type TaskProgressSlot, type TaskProgressStore } from '@/lib/task-progress';

export interface DetailTarget {
  store: TaskProgressStore;
  slot: TaskProgressSlot | null;
  type: string;
}

type StoreDay = { tasks: FlatTask[]; serahTerima: SerahTerimaBoardView };

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

export default function TaskDetailSheet({
  target,
  date,
  onClose,
}: {
  target: DetailTarget | null;
  date: string;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<{ key: string; day: StoreDay | null; error: string } | null>(null);
  const storeId = target?.store.storeId ?? null;
  const key = storeId != null ? `${storeId}|${date}` : null;

  useEffect(() => {
    if (!key || storeId == null) return;
    let stale = false;
    (async () => {
      try {
        const params = new URLSearchParams({ date, storeId: String(storeId) });
        const res = await fetch(`/api/ops/tasks/progress?${params}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat detail task.');
        if (!stale) setLoaded({ key, day: { tasks: json.tasks, serahTerima: json.serahTerima }, error: '' });
      } catch (err) {
        if (!stale) setLoaded({ key, day: null, error: err instanceof Error ? err.message : 'Gagal memuat detail task.' });
      }
    })();
    return () => { stale = true; };
  }, [key, storeId, date]);

  const ready = loaded?.key === key ? loaded : null;
  let body: React.ReactNode;

  if (!target) {
    body = null;
  } else if (!ready) {
    body = (
      <div className="flex min-h-[240px] items-center justify-center gap-2 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Memuat detail task…
      </div>
    );
  } else if (!ready.day) {
    body = (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="text-sm font-semibold">{ready.error}</p>
      </div>
    );
  } else if (target.type === BOARD_TASK) {
    body = <SerahTerimaPanel board={ready.day.serahTerima} />;
  } else {
    const { slot, type } = target;
    const ofType = ready.day.tasks.filter((t) => t.type === type);
    const task =
      (slot?.id != null ? ofType.find((t) => Number(t.id) === slot.id) : undefined) ??
      (slot ? ofType.find((t) => t.isPlaceholder && t.shift === slot.shift) : undefined) ??
      ofType[0];
    body = task
      ? <TaskDetailView task={task} onBack={onClose} />
      : <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Tidak ada data task ini untuk toko pada tanggal tersebut.</p>;
  }

  return (
    <Sheet open={!!target} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 bg-slate-50 p-0 sm:max-w-xl">
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 pr-12">
          <SheetTitle className="truncate text-sm font-bold text-slate-900">
            {target ? `${target.store.name}` : 'Detail task'}
          </SheetTitle>
          <SheetDescription className="truncate text-xs text-slate-500">
            {target && (
              <>
                <span className="font-mono font-semibold text-slate-600">{target.store.storeNo}</span>
                {` · ${TASK_LABELS[target.type] ?? target.type}`}
                {target.type !== BOARD_TASK && ` · ${dateLabel(date)}`}
              </>
            )}
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">{body}</div>
      </SheetContent>
    </Sheet>
  );
}
