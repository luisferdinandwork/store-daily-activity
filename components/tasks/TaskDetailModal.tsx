'use client';
// components/tasks/TaskDetailModal.tsx
//
// Task Progress · one task of one store, opened from the board (Ops + IT). Two shapes,
// chosen by the task TYPE (PHOTO_TASK_TYPES in task-detail.tsx):
//   • tasks with photos (Store Opening / Front / Setoran / Closing / Grooming) are laid
//     out like the Finance petty cash request modal (components/finance/petty-cash/
//     TxDetailModal.tsx): the photo sits on the left in the zoomable stage (wheel or
//     double-click to zoom, drag to pan, rotate), what the store filled in on the right;
//   • tasks without any (Cek Bin, VM Checklist, Marketing Check, Cek Uang Modal,
//     Briefing) have nothing to put on a stage, so they are one compact column.
// Either way ‹ › (or the arrow keys) step to the same task of the previous / next store
// on the board — so Ops can compare stores without closing anything.
//
// The photos are the task's own PhotoGrids: inside the photo layout they report to the
// stage (PhotoStageContext in task-detail.tsx) instead of opening a lightbox.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ClipboardList, ImageOff, Loader2, AlertCircle, List } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ZoomableImage } from '@/components/shared/ZoomableImage';
import { taskStatusTile } from '@/components/status/TaskStatus';
import {
  DoerLine,
  PhotoStageContext,
  photoKey,
  TASK_ICONS,
  TASK_LABELS,
  TaskDetailBody,
  fmtTime,
  taskHasPhotos,
  statusBadgeClass,
  statusLabel,
  type FlatTask,
  type PhotoStage,
} from '@/app/ops/tasks/progress/task-detail';

export type TaskModalState = 'loading' | 'error' | 'missing' | 'ready';

export interface TaskModalNav {
  /** Position of this store in the board's current order. */
  index: number;
  count: number;
  prevName?: string;
  nextName?: string;
  onPrev?: () => void;
  onNext?: () => void;
}

export interface TaskDetailModalProps {
  type: string;
  store: { name: string; storeNo: string };
  dateLabel: string;
  state: TaskModalState;
  error?: string;
  task?: FlatTask | null;
  nav?: TaskModalNav | null;
  onClose: () => void;
  /** "Semua task": back to the store's whole day. */
  onAllTasks?: () => void;
}

type Photo = { key: string; url: string; label: string };

const navBtn =
  'flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40';

/** The stage + the task's details. Remounted (key) for every task, so the photos start fresh. */
function ModalBody({ task }: { task: FlatTask }) {
  const [groups, setGroups] = useState<Record<string, { label: string; urls: string[] }>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const register = useCallback((id: string, label: string, urls: string[]) => {
    setGroups((g) => (g[id]?.label === label && g[id].urls.join('\n') === urls.join('\n') ? g : { ...g, [id]: { label, urls } }));
  }, []);
  const unregister = useCallback((id: string) => {
    setGroups((g) => {
      if (!(id in g)) return g;
      const next = { ...g };
      delete next[id];
      return next;
    });
  }, []);

  const photos = useMemo<Photo[]>(
    () =>
      Object.entries(groups).flatMap(([id, g]) => g.urls.map((url, i) => ({ key: photoKey(id, i), url, label: g.label }))),
    [groups],
  );
  const currentIndex = Math.max(0, photos.findIndex((p) => p.key === selected));
  const current = photos[currentIndex] ?? null;

  const stage = useMemo<PhotoStage>(
    () => ({ register, unregister, select: setSelected, active: current?.key ?? null }),
    [register, unregister, current?.key],
  );

  const status = task.status ?? 'not_started';

  return (
    <PhotoStageContext.Provider value={stage}>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Photo — zoomable */}
        {current ? (
          <div className="flex min-h-[280px] min-w-0 flex-1 flex-col bg-slate-900">
            <ZoomableImage key={current.key} src={current.url} alt={current.label} className="min-h-0 flex-1" />
            <div className="flex items-center gap-2 border-t border-white/10 bg-slate-950 px-3 py-2 text-xs text-white/80">
              <span className="min-w-0 flex-1 truncate font-semibold">{current.label}</span>
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setSelected(photos[(currentIndex - 1 + photos.length) % photos.length].key)}
                    aria-label="Foto sebelumnya"
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="w-12 text-center font-semibold tabular-nums">{currentIndex + 1} / {photos.length}</span>
                  <button
                    type="button"
                    onClick={() => setSelected(photos[(currentIndex + 1) % photos.length].key)}
                    aria-label="Foto berikutnya"
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center gap-2 bg-slate-100 text-slate-400">
            <ImageOff className="h-10 w-10" />
            <p className="text-sm font-medium text-slate-500">Tidak ada foto untuk task ini</p>
          </div>
        )}

        {/* What the store filled in */}
        <aside className="flex max-h-[45vh] w-full shrink-0 flex-col overflow-y-auto border-t border-slate-200 bg-white lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
          <div className="flex items-start gap-3 border-b border-slate-100 p-4">
            <DoerLine task={task} className="min-w-0 flex-1 text-xs" />
            <div className="flex shrink-0 flex-col items-end gap-1">
              <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
                {statusLabel(status)}
              </span>
              {task.completedAt && <span className="text-[10px] text-slate-400">{fmtTime(task.completedAt)}</span>}
            </div>
          </div>
          <div className="p-4">
            <TaskDetailBody task={task} />
          </div>
        </aside>
      </div>
    </PhotoStageContext.Provider>
  );
}

/** A task with no photos: who did it + status on top, the details below, in one column. */
function CompactBody({ task }: { task: FlatTask }) {
  const status = task.status ?? 'not_started';

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
      <div className="flex items-start gap-3 border-b border-slate-100 p-4">
        <DoerLine task={task} className="min-w-0 flex-1 text-xs" />
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', statusBadgeClass(status))}>
            {statusLabel(status)}
          </span>
          {task.completedAt && <span className="text-[10px] text-slate-400">{fmtTime(task.completedAt)}</span>}
        </div>
      </div>
      <div className="p-4">
        <TaskDetailBody task={task} />
      </div>
    </div>
  );
}

export default function TaskDetailModal({
  type,
  store,
  dateLabel,
  state,
  error,
  task,
  nav,
  onClose,
  onAllTasks,
}: TaskDetailModalProps) {
  const label = TASK_LABELS[type] ?? type.replaceAll('_', ' ');
  const TaskIcon = TASK_ICONS[type] ?? ClipboardList;
  // By type (known even while loading), so the dialog keeps its shape across stores.
  const withPhotos = taskHasPhotos(type);
  const onPrev = nav?.onPrev;
  const onNext = nav?.onNext;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);

  const tile = taskStatusTile(task?.status ?? 'not_started');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={cn(
          'flex max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none',
          withPhotos
            ? 'h-[min(92vh,880px)] w-[min(96vw,1360px)]'
            : 'max-h-[min(92vh,880px)] w-[min(96vw,720px)]',
        )}
        // The close icon would sit on the dark photo stage — the header has its own.
        showCloseButton={false}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tile)}>
            <TaskIcon className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base text-slate-900">{label}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs">
              <span className="font-mono font-semibold text-slate-600">{store.storeNo}</span> · {store.name} · {dateLabel}
            </DialogDescription>
          </div>

          {nav && nav.count > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={nav.onPrev}
                disabled={!nav.onPrev}
                aria-label="Toko sebelumnya"
                title={nav.prevName ? `Sebelumnya: ${nav.prevName}` : undefined}
                className={navBtn}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="w-16 text-center text-xs font-semibold tabular-nums text-slate-500">
                {nav.index + 1} / {nav.count}
              </span>
              <button
                type="button"
                onClick={nav.onNext}
                disabled={!nav.onNext}
                aria-label="Toko berikutnya"
                title={nav.nextName ? `Berikutnya: ${nav.nextName}` : undefined}
                className={navBtn}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {onAllTasks && (
            <button
              type="button"
              onClick={onAllTasks}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Semua task</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Tutup
          </button>
        </header>

        {state === 'ready' && task ? (
          withPhotos ? (
            <ModalBody key={`${task.type}-${task.id}-${task.shift ?? ''}`} task={task} />
          ) : (
            <CompactBody key={`${task.type}-${task.id}-${task.shift ?? ''}`} task={task} />
          )
        ) : (
          <div className={cn('flex flex-1 items-center justify-center bg-slate-50 p-6', withPhotos ? 'min-h-[320px]' : 'min-h-[200px]')}>
            {state === 'loading' ? (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Memuat task toko…
              </p>
            ) : state === 'error' ? (
              <div className="flex max-w-md items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-semibold">{error || 'Gagal memuat task toko.'}</p>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-400">
                Toko ini tidak punya task {label} pada tanggal tersebut.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
