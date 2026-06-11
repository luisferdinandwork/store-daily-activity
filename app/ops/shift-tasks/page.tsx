'use client';
// app/ops/shift-tasks/page.tsx — OPS "Shift & Tasks" configuration.
//
// Layout mirrors the Task Progress page: a left list (shifts) + a right detail
// panel. Creating / editing a shift and managing its task set all happen in ONE
// right-side sliding drawer (same pattern as the Schedule page's SchedulePanel),
// which swaps between three views: 'create' → 'edit' → 'tasks'.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  Sun, Moon, Zap, Sunrise, Clock, Coffee,
  Store, DoorClosed, WalletCards, PackageCheck, MonitorCheck, Megaphone,
  UsersRound, ReceiptText, FileText, ListChecks, Shirt,
  ClipboardList, Layers, Plus, Pencil, Loader2, X,
  ChevronRight, Search, CheckCircle2, Shield, ListPlus, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import {
  ACCENT_PALETTE, PALETTE_KEYS, paletteOf, SHIFT_ICON_NAMES,
  shiftTimeRange, trimTime,
  BREAK_TYPES, BREAK_TYPE_LABELS,
  type PaletteKey, type ShiftBreakDef, type BreakTypeCode,
  type ShiftWithTasks, type TaskDefinitionDTO, type ShiftTasksPayload,
} from '@/lib/shift-tasks';

// ─── Icon resolution ──────────────────────────────────────────────────────────

const SHIFT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  sun: Sun, moon: Moon, zap: Zap, sunrise: Sunrise, clock: Clock, coffee: Coffee,
};

const TASK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Store, DoorClosed, WalletCards, PackageCheck, MonitorCheck, Megaphone,
  UsersRound, ReceiptText, FileText, ListChecks, Shirt,
};

function ShiftGlyph({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && SHIFT_ICONS[name]) || Clock;
  return <Icon className={className} />;
}

function TaskGlyph({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && TASK_ICONS[name]) || ClipboardList;
  return <Icon className={className} />;
}

// ─── Shift list card (left column) ────────────────────────────────────────────

function ShiftListCard({ shift, active, onOpen }: {
  shift: ShiftWithTasks; active: boolean; onOpen: () => void;
}) {
  const pal = paletteOf(shift.accent);
  const taskCount = shift.tasks.filter(t => t.isActive).length;
  const range = shiftTimeRange(shift.startTime, shift.endTime);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-50',
        active ? 'bg-indigo-50' : '',
        !shift.isActive && 'opacity-60',
      )}
    >
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        style={{ background: pal.bg, color: pal.text }}
      >
        <ShiftGlyph name={shift.icon} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm font-bold', active ? 'text-indigo-900' : 'text-slate-900')}>
            {shift.label}
          </p>
          {!shift.isActive && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-400">
              Off
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {range ? `${range} · ` : ''}{taskCount} task{taskCount !== 1 ? 's' : ''}
        </p>
      </div>
      <ChevronRight className={cn('h-4 w-4 shrink-0', active ? 'text-indigo-500' : 'text-slate-300')} />
    </button>
  );
}

// ─── Shift detail panel (right column) ────────────────────────────────────────

function ShiftDetailPanel({ shift, onEdit, onManageTasks }: {
  shift: ShiftWithTasks | null;
  onEdit: () => void;
  onManageTasks: () => void;
}) {
  if (!shift) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center">
        <div>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <Layers className="h-5 w-5" />
          </div>
          <p className="font-semibold text-slate-700">Select a shift to view its tasks</p>
          <p className="mt-1 text-xs text-slate-400">Pick a shift on the left, or create a new one.</p>
        </div>
      </div>
    );
  }

  const pal = paletteOf(shift.accent);
  const active = shift.tasks.filter(t => t.isActive);
  const required = active.filter(t => t.isRequired);
  const optional = active.filter(t => !t.isRequired);
  const range = shiftTimeRange(shift.startTime, shift.endTime);

  const Group = ({ title, items }: { title: string; items: typeof active }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {title} · {items.length}
        </p>
        <div className="space-y-2">
          {items.map(t => {
            const tp = paletteOf(t.accent);
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-2xl border px-4 py-3"
                style={{ borderColor: tp.border, background: tp.bg }}
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: tp.dot + '30', color: tp.text }}
                >
                  <TaskGlyph name={t.icon} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{t.label}</p>
                  <p className="text-[11px] text-slate-400 font-mono">{t.code}</p>
                </div>
                {t.isPersonal && (
                  <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600">
                    Personal
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <article className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="shrink-0 border-b border-slate-100 p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
            style={{ background: pal.bg, color: pal.text }}
          >
            <ShiftGlyph name={shift.icon} className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-slate-900">{shift.label}</h2>
              {!shift.isActive && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">
                  Disabled
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400 font-mono">{shift.code}</p>
            <p className="mt-1.5 text-xs font-semibold text-slate-600">
              {range && <><Clock className="mr-1 inline h-3 w-3 -translate-y-0.5" />{range}<span className="text-slate-300"> · </span></>}
              <span className="text-indigo-600">{active.length} task{active.length !== 1 ? 's' : ''}</span>
            </p>
            {shift.breaks && shift.breaks.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {shift.breaks.map((b, i) => {
                  const bp = paletteOf(b.accent);
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: bp.bg, color: bp.text }}
                    >
                      <Coffee className="h-2.5 w-2.5" /> {b.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit shift
          </button>
          <button
            type="button"
            onClick={onManageTasks}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700"
          >
            <ListPlus className="h-3.5 w-3.5" /> Manage tasks
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {active.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ClipboardList className="h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">No tasks assigned to this shift yet.</p>
            <button
              type="button"
              onClick={onManageTasks}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-700"
            >
              Add tasks
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <Group title="Required" items={required} />
            <Group title="Optional" items={optional} />
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Accent + icon pickers ────────────────────────────────────────────────────

function AccentPicker({ value, onChange }: { value: PaletteKey | null; onChange: (k: PaletteKey) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PALETTE_KEYS.map(k => {
        const pal = ACCENT_PALETTE[k];
        const active = value === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            className="flex h-9 items-center gap-1.5 rounded-xl border-2 px-2.5 text-xs font-semibold capitalize transition"
            style={{
              borderColor: active ? pal.dot : '#e2e8f0',
              background: active ? pal.bg : '#f8fafc',
              color: active ? pal.text : '#64748b',
            }}
          >
            <span className="h-3 w-3 rounded-full" style={{ background: pal.dot }} />
            {k}
          </button>
        );
      })}
    </div>
  );
}

function IconPicker({ value, onChange, accent }: {
  value: string | null; onChange: (n: string) => void; accent: PaletteKey | null;
}) {
  const pal = paletteOf(accent);
  return (
    <div className="flex flex-wrap gap-2">
      {SHIFT_ICON_NAMES.map(name => {
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border-2 transition"
            style={{
              borderColor: active ? pal.dot : '#e2e8f0',
              background: active ? pal.bg : '#f8fafc',
              color: active ? pal.text : '#94a3b8',
            }}
          >
            <ShiftGlyph name={name} className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}

// ─── Break editor ─────────────────────────────────────────────────────────────
// Lets OPS attach meal breaks to a shift. `type` is restricted to break_type
// enum values (so the attendance break_sessions insert stays valid); label and
// accent are free. The attendance page reads these straight from the shift.

function BreakEditor({ value, onChange }: {
  value: ShiftBreakDef[];
  onChange: (b: ShiftBreakDef[]) => void;
}) {
  const usedTypes = new Set(value.map(b => b.type));
  const addable = BREAK_TYPES.filter(t => !usedTypes.has(t));

  const update = (i: number, patch: Partial<ShiftBreakDef>) =>
    onChange(value.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => {
    const next = addable[0];
    if (!next) return;
    onChange([...value, { type: next, label: BREAK_TYPE_LABELS[next] ?? next, accent: 'amber' }]);
  };

  return (
    <div className="space-y-2">
      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-400">
          No breaks. This shift will show “No scheduled break”.
        </p>
      )}

      {value.map((b, i) => {
        const pal = paletteOf(b.accent);
        return (
          <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <Coffee className="h-4 w-4 shrink-0" style={{ color: pal.text }} />
              <select
                value={b.type}
                onChange={e => update(i, { type: e.target.value as BreakTypeCode })}
                className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:border-indigo-400 focus:outline-none"
              >
                {BREAK_TYPES
                  .filter(t => t === b.type || !usedTypes.has(t))
                  .map(t => (
                    <option key={t} value={t}>{BREAK_TYPE_LABELS[t] ?? t}</option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => remove(i)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200 hover:text-rose-500"
                aria-label="Remove break"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>

            <input
              value={b.label}
              onChange={e => update(i, { label: e.target.value })}
              placeholder="Break label (e.g. Lunch)"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 focus:border-indigo-400 focus:outline-none"
            />

            <div className="flex flex-wrap gap-1.5">
              {PALETTE_KEYS.map(k => {
                const p = ACCENT_PALETTE[k];
                const active = (b.accent ?? 'amber') === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => update(i, { accent: k })}
                    className="h-6 w-6 rounded-full border-2 transition"
                    style={{ background: p.dot, borderColor: active ? p.text : 'transparent' }}
                    title={k}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {addable.length > 0 && (
        <button
          type="button"
          onClick={add}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-200 py-2 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add break
        </button>
      )}
    </div>
  );
}

// ─── Shift form (create / edit) ───────────────────────────────────────────────

interface ShiftFormValue {
  label: string;
  description: string;
  startTime: string;
  endTime: string;
  accent: PaletteKey | null;
  icon: string | null;
  breaks: ShiftBreakDef[];
  isActive: boolean;
}

function ShiftForm({ initial, mode, saving, onSubmit, onCancel }: {
  initial: ShiftFormValue;
  mode: 'create' | 'edit';
  saving: boolean;
  onSubmit: (v: ShiftFormValue) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<ShiftFormValue>(initial);
  const set = <K extends keyof ShiftFormValue>(k: K, val: ShiftFormValue[K]) =>
    setV(prev => ({ ...prev, [k]: val }));

  const inputCls = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100';
  const labelCls = 'mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400';

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        <div>
          <label className={labelCls}>Shift name</label>
          <input className={inputCls} value={v.label} placeholder="e.g. Morning"
            onChange={e => set('label', e.target.value)} />
          {mode === 'create' && (
            <p className="mt-1 px-1 text-[10px] text-slate-400">
              A stable code will be generated from this name (e.g. <span className="font-mono">morning</span>).
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start time</label>
            <input type="time" className={inputCls} value={trimTime(v.startTime)}
              onChange={e => set('startTime', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>End time</label>
            <input type="time" className={inputCls} value={trimTime(v.endTime)}
              onChange={e => set('endTime', e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <input className={inputCls} value={v.description} placeholder="Optional"
            onChange={e => set('description', e.target.value)} />
        </div>

        <div>
          <label className={labelCls}>Accent</label>
          <AccentPicker value={v.accent} onChange={k => set('accent', k)} />
        </div>

        <div>
          <label className={labelCls}>Icon</label>
          <IconPicker value={v.icon} onChange={n => set('icon', n)} accent={v.accent} />
        </div>

        <div>
          <label className={labelCls}>Breaks</label>
          <BreakEditor value={v.breaks} onChange={b => set('breaks', b)} />
        </div>

        {mode === 'edit' && (
          <button
            type="button"
            onClick={() => set('isActive', !v.isActive)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <span className="text-sm font-semibold text-slate-700">Active</span>
            <span className={cn('relative h-6 w-11 rounded-full transition', v.isActive ? 'bg-indigo-500' : 'bg-slate-300')}>
              <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', v.isActive ? 'left-[22px]' : 'left-0.5')} />
            </span>
          </button>
        )}
      </div>

      <div className="flex gap-2.5 border-t border-slate-100 px-5 py-4">
        <button onClick={onCancel}
          className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(v)}
          disabled={saving || !v.label.trim()}
          className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          {saving
            ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
            : mode === 'create' ? 'Create shift' : 'Save changes'}
        </button>
      </div>
    </>
  );
}

// ─── Task multi-select (manage tasks) ─────────────────────────────────────────

type Selection = Record<number, { isRequired: boolean }>;

function TaskMultiSelect({ catalog, initial, saving, onSubmit, onCancel }: {
  catalog: TaskDefinitionDTO[];
  initial: Selection;
  saving: boolean;
  onSubmit: (sel: Selection) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<Selection>(initial);

  const toggle = (id: number) =>
    setSel(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = { isRequired: true };
      return next;
    });

  const setRequired = (id: number, isRequired: boolean) =>
    setSel(prev => (prev[id] ? { ...prev, [id]: { isRequired } } : prev));

  const count = Object.keys(sel).length;

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          Tasks · {count} selected
        </p>
        <div className="space-y-1.5">
          {catalog.map(t => {
            const picked = !!sel[t.id];
            const tp = paletteOf(t.accent);
            return (
              <div
                key={t.id}
                className="rounded-xl border-2 transition-all"
                style={{ borderColor: picked ? tp.dot : '#e2e8f0', background: picked ? tp.bg : '#f8fafc' }}
              >
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: picked ? tp.dot + '30' : '#e2e8f0', color: picked ? tp.text : '#64748b' }}
                  >
                    <TaskGlyph name={t.icon} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{t.label}</p>
                    <p className="truncate text-[10px] text-slate-400 font-mono">{t.code}</p>
                  </div>
                  {picked
                    ? <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: tp.text }} />
                    : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-slate-300" />}
                </button>

                {picked && (
                  <div className="flex gap-1.5 border-t px-3 py-2" style={{ borderColor: tp.border }}>
                    {(['required', 'optional'] as const).map(opt => {
                      const on = opt === 'required' ? sel[t.id].isRequired : !sel[t.id].isRequired;
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setRequired(t.id, opt === 'required')}
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-[11px] font-bold capitalize transition',
                            on ? 'bg-white shadow-sm' : 'text-slate-400 hover:text-slate-600',
                          )}
                          style={on ? { color: tp.text } : undefined}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2.5 border-t border-slate-100 px-5 py-4">
        <button onClick={onCancel}
          className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(sel)}
          disabled={saving}
          className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : `Save ${count} task${count !== 1 ? 's' : ''}`}
        </button>
      </div>
    </>
  );
}

// ─── Right-side drawer ────────────────────────────────────────────────────────

type DrawerView = 'create' | 'edit' | 'tasks';

function ShiftDrawer({
  view, shift, catalog, saving, onClose, onCreate, onEdit, onSaveTasks,
}: {
  view: DrawerView;
  shift: ShiftWithTasks | null;
  catalog: TaskDefinitionDTO[];
  saving: boolean;
  onClose: () => void;
  onCreate: (v: ShiftFormValue, taskIds: number[]) => void;
  onEdit: (v: ShiftFormValue) => void;
  onSaveTasks: (sel: Selection) => void;
}) {
  const eyebrow = view === 'create' ? 'New Shift' : view === 'edit' ? 'Edit Shift' : 'Manage Tasks';
  const title = view === 'create' ? 'Create a shift' : (shift?.label ?? 'Shift');

  const blankForm: ShiftFormValue = {
    label: '', description: '', startTime: '', endTime: '', accent: 'slate', icon: 'clock', breaks: [], isActive: true,
  };
  const editForm: ShiftFormValue = shift ? {
    label: shift.label,
    description: shift.description ?? '',
    startTime: shift.startTime ?? '',
    endTime: shift.endTime ?? '',
    accent: (shift.accent as PaletteKey | null) ?? 'slate',
    icon: shift.icon ?? 'clock',
    breaks: shift.breaks ?? [],
    isActive: shift.isActive,
  } : blankForm;

  // For 'create' we let the form also drive the task selection in a second step,
  // but to keep things simple here the create flow assigns tasks afterwards via
  // "Manage tasks". So create() submits with an empty task list.
  const initialSelection: Selection = {};
  if (shift) for (const t of shift.tasks) initialSelection[t.taskDefinitionId] = { isRequired: t.isRequired };

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="flex w-[440px] max-w-full flex-col overflow-hidden bg-white shadow-2xl"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{eyebrow}</p>
              <p className="mt-0.5 truncate text-lg font-bold text-slate-900">{title}</p>
            </div>
            <button onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — keyed so each view mounts fresh form state */}
        <div
          key={`${view}:${shift?.id ?? 'new'}`}
          className="flex min-h-0 flex-1 flex-col"
          style={{ animation: 'panelFade 0.2s ease-out' }}
        >
          {view === 'create' && (
            <ShiftForm
              mode="create"
              initial={blankForm}
              saving={saving}
              onSubmit={(v) => onCreate(v, [])}
              onCancel={onClose}
            />
          )}
          {view === 'edit' && (
            <ShiftForm
              mode="edit"
              initial={editForm}
              saving={saving}
              onSubmit={onEdit}
              onCancel={onClose}
            />
          )}
          {view === 'tasks' && (
            <TaskMultiSelect
              catalog={catalog}
              initial={initialSelection}
              saving={saving}
              onSubmit={onSaveTasks}
              onCancel={onClose}
            />
          )}
        </div>
      </div>
      <style>{`
        @keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}
        @keyframes panelFade{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:translateX(0)}}
      `}</style>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsShiftTasksPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role as string | undefined;
  const isOps = role === 'ops' || role === 'admin';

  const [shifts, setShifts]       = useState<ShiftWithTasks[]>([]);
  const [catalog, setCatalog]     = useState<TaskDefinitionDTO[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const [drawerView, setDrawerView] = useState<DrawerView | null>(null);
  const [saving, setSaving]         = useState(false);

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/shift-tasks', { cache: 'no-store' });
      const json = (await res.json()) as ShiftTasksPayload;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load shift tasks');
      setShifts(json.shifts);
      setCatalog(json.catalog);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load shift tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isOps) void load(); }, [isOps, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shifts;
    return shifts.filter(s => s.label.toLowerCase().includes(q) || s.code.toLowerCase().includes(q));
  }, [shifts, search]);

  const selected = useMemo(
    () => shifts.find(s => s.id === selectedId) ?? null,
    [shifts, selectedId],
  );

  // ── Save handlers ──────────────────────────────────────────────────────────

  function timeOrNull(t: string) { return t.trim() ? t.trim() : null; }

  async function handleCreate(v: ShiftFormValue) {
    setSaving(true);
    try {
      const res = await fetch('/api/ops/shift-tasks/shift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: v.label,
          description: v.description.trim() || null,
          startTime: timeOrNull(v.startTime),
          endTime: timeOrNull(v.endTime),
          accent: v.accent,
          icon: v.icon,
          breaks: v.breaks,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Create failed');
      toast.success('Shift created — now add some tasks');
      setDrawerView(null);
      await load();
      setSelectedId(json.shift?.id ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally { setSaving(false); }
  }

  async function handleEdit(v: ShiftFormValue) {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ops/shift-tasks/shift/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: v.label,
          description: v.description.trim() || null,
          startTime: timeOrNull(v.startTime),
          endTime: timeOrNull(v.endTime),
          accent: v.accent,
          icon: v.icon,
          breaks: v.breaks,
          isActive: v.isActive,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Update failed');
      toast.success('Shift updated');
      setDrawerView(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setSaving(false); }
  }

  async function handleSaveTasks(sel: Selection) {
    if (!selected) return;
    setSaving(true);
    try {
      const tasks = Object.entries(sel).map(([id, meta]) => ({
        taskDefinitionId: Number(id),
        isRequired: meta.isRequired,
      }));
      const res = await fetch(`/api/ops/shift-tasks/shift/${selected.id}/tasks`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Update failed');
      toast.success('Tasks updated');
      setDrawerView(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setSaving(false); }
  }

  // ── Guards ──────────────────────────────────────────────────────────────────

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can manage shift tasks.</p>
    </div>
  );

  const activeShiftCount = shifts.filter(s => s.isActive).length;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Configuration"
        title="Shift & Tasks"
        subtitle={`${activeShiftCount} active shift${activeShiftCount !== 1 ? 's' : ''} · ${catalog.length} task types`}
        onRefresh={() => void load()}
        refreshing={loading}
        actions={
          <button
            type="button"
            onClick={() => { setSelectedId(null); setDrawerView('create'); }}
            className="flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> New shift
          </button>
        }
      />

      <div className="mx-auto space-y-5 px-4 py-5 sm:px-6 lg:px-8">
        <div className="grid items-start gap-5 lg:grid-cols-[380px_1fr]">
          {/* ── Shift list ── */}
          <aside className="flex max-h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:sticky lg:top-[6.5rem]">
            <div className="shrink-0 border-b border-slate-100 p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search shifts…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </label>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{filtered.length} shifts</p>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {loading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
                    </div>
                  ))
                : filtered.length === 0
                  ? (
                    <div className="p-8 text-center">
                      <p className="text-sm font-semibold text-slate-700">No shifts</p>
                      <p className="mt-1 text-xs text-slate-400">Create a shift to get started.</p>
                    </div>
                  )
                  : filtered.map(s => (
                      <ShiftListCard
                        key={s.id}
                        shift={s}
                        active={selectedId === s.id}
                        onOpen={() => setSelectedId(cur => cur === s.id ? null : s.id)}
                      />
                    ))
              }
            </div>
          </aside>

          {/* ── Detail ── */}
          <div className="lg:sticky lg:top-[6.5rem]">
            <ShiftDetailPanel
              shift={selected}
              onEdit={() => setDrawerView('edit')}
              onManageTasks={() => setDrawerView('tasks')}
            />
          </div>
        </div>
      </div>

      {drawerView && (
        <ShiftDrawer
          view={drawerView}
          shift={drawerView === 'create' ? null : selected}
          catalog={catalog}
          saving={saving}
          onClose={() => setDrawerView(null)}
          onCreate={(v) => handleCreate(v)}
          onEdit={handleEdit}
          onSaveTasks={handleSaveTasks}
        />
      )}
    </div>
  );
}