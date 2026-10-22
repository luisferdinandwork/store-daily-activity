'use client';
// The Pengaturan Visit checklist: one bordered list, one row per task. Edits stay
// local until the page's save bar writes them; each row says whether it is new /
// changed, and blank or repeated names are flagged where they are typed.

import { useRef } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, Camera, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createVisitId } from '@/lib/store-visit/client';
import { MAX_TASKS, MAX_TASK_LABEL, taskChange, taskProblems } from '@/lib/store-visit/settings-view';
import type { VisitTask } from '@/lib/store-visit/types';

const iconButton = 'flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40 sm:h-9 sm:w-9';

export default function ChecklistEditor({ tasks, saved, onChange, disabled }: {
  tasks: VisitTask[];
  saved: VisitTask[];
  onChange: (tasks: VisitTask[]) => void;
  disabled?: boolean;
}) {
  const focusId = useRef<string | null>(null);
  const problems = taskProblems(tasks);
  const photoCount = tasks.filter((t) => t.requirePhoto).length;
  const removed = saved.filter((s) => !tasks.some((t) => t.id === s.id)).length;

  const patch = (id: string, change: Partial<VisitTask>) => onChange(tasks.map((t) => (t.id === id ? { ...t, ...change } : t)));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...tasks];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    onChange(next);
  };
  const add = () => {
    const task = { id: createVisitId(), label: '', requirePhoto: false };
    onChange([...tasks, task]);
    focusId.current = task.id; // the new row's textarea takes focus when it mounts
  };

  return (
    <section className="space-y-3" aria-label="Checklist visit">
      <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 p-3.5 text-sm text-indigo-900 sm:p-4">
        <ListChecks className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="min-w-0">Checklist berlaku untuk <b>semua toko</b>. Foto toko dan geotag selalu wajib; nyalakan <b>Foto wajib</b> hanya pada poin yang butuh bukti. Perubahan berlaku untuk visit berikutnya — visit yang sudah tersimpan tidak berubah.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-slate-500">
        <span><b className="text-slate-700">{tasks.length}</b> poin · <b className="text-slate-700">{photoCount}</b> wajib foto{removed > 0 && <> · <span className="font-semibold text-rose-600">{removed} dihapus</span></>}</span>
        <span>Urutan di sini = urutan di formulir Ops Area</span>
      </div>

      <fieldset disabled={disabled} className="min-w-0">
        <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {tasks.map((task, index) => {
            const change = taskChange(task, saved);
            const problem = problems.empty.has(task.id) ? 'Isi nama poin ini atau hapus.' : problems.duplicate.has(task.id) ? 'Nama poin sama dengan poin lain.' : null;
            return (
              <li key={task.id} className={cn('grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:p-4', change === 'new' ? 'bg-emerald-50/40' : change === 'changed' ? 'bg-amber-50/40' : '')}>
                <span className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-sm font-bold tabular-nums text-slate-600">{index + 1}</span>
                <div className="min-w-0">
                  <textarea
                    ref={(el) => { if (el && focusId.current === task.id) { focusId.current = null; el.focus(); } }}
                    rows={1}
                    maxLength={MAX_TASK_LABEL}
                    aria-label={`Poin ${index + 1}`}
                    aria-invalid={problem ? true : undefined}
                    placeholder="Tulis poin yang harus diperiksa…"
                    value={task.label}
                    onChange={(e) => patch(task.id, { label: e.target.value })}
                    className={cn('field-sizing-content block min-h-11 w-full resize-none rounded-xl border bg-white px-3 py-2.5 text-base leading-6 focus:outline-none focus:ring-2 md:text-sm', problem ? 'border-rose-300 focus:ring-rose-100' : 'border-slate-200 focus:ring-cyan-200')}
                  />
                  <div className="mt-1 flex min-h-4 items-center justify-between gap-2 text-xs">
                    {problem
                      ? <span role="alert" className="flex items-center gap-1 font-medium text-rose-600"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{problem}</span>
                      : change ? <span className={cn('font-bold', change === 'new' ? 'text-emerald-700' : 'text-amber-700')}>{change === 'new' ? 'Baru' : 'Diubah'}</span> : <span />}
                    {task.label.length > MAX_TASK_LABEL - 40 && <span className="tabular-nums text-slate-400">{task.label.length}/{MAX_TASK_LABEL}</span>}
                  </div>
                </div>
                <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-3 sm:row-start-1 sm:flex-nowrap">
                  <button
                    type="button"
                    aria-pressed={task.requirePhoto}
                    onClick={() => patch(task.id, { requirePhoto: !task.requirePhoto })}
                    className={cn('inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-bold ring-1 ring-inset transition-colors sm:h-9', task.requirePhoto ? 'bg-cyan-700 text-white ring-cyan-700' : 'bg-white text-slate-500 ring-slate-200 hover:bg-slate-50')}
                  >
                    <Camera className="h-4 w-4" />{task.requirePhoto ? 'Foto wajib' : 'Tanpa foto'}
                  </button>
                  <div className="ml-auto flex gap-1.5 sm:ml-0">
                    <button type="button" className={iconButton} aria-label={`Naikkan poin ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={iconButton} aria-label={`Turunkan poin ${index + 1}`} disabled={index === tasks.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={cn(iconButton, 'text-rose-600 hover:bg-rose-50')} aria-label={`Hapus poin ${index + 1}`} disabled={tasks.length === 1} onClick={() => onChange(tasks.filter((t) => t.id !== task.id))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </fieldset>

      <Button variant="outline" className="min-h-12 w-full border-dashed" disabled={disabled || tasks.length >= MAX_TASKS} onClick={add}>
        <Plus className="h-4 w-4" />Tambah poin{tasks.length >= MAX_TASKS ? ` (maksimum ${MAX_TASKS})` : ''}
      </Button>
    </section>
  );
}
