// app/employee/schedule/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  Calendar, ChevronRight, Plus, Pencil, Trash2,
  Sun, Moon, Loader2, AlertCircle, Check, X,
  Users, ChevronDown, ChevronUp, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type Shift   = 'morning' | 'evening';
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface Entry { weekday: Weekday; shift: Shift }

interface TemplateUser {
  id:           string;
  name:         string;
  role:         string;
  employeeType: string | null;
}

interface Template {
  id:        string;
  note:      string | null;
  isActive:  boolean;
  entries:   Entry[];
  createdAt: string;
  updatedAt: string;
}

interface TemplateSlot {
  template: Template;
  user:     TemplateUser | null;
}

interface StoreEmployee {
  id:           string;
  name:         string;
  email:        string;
  employeeType: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS: { label: string; short: string; day: Weekday }[] = [
  { label: 'Sunday',    short: 'Sun', day: 0 },
  { label: 'Monday',    short: 'Mon', day: 1 },
  { label: 'Tuesday',   short: 'Tue', day: 2 },
  { label: 'Wednesday', short: 'Wed', day: 3 },
  { label: 'Thursday',  short: 'Thu', day: 4 },
  { label: 'Friday',    short: 'Fri', day: 5 },
  { label: 'Saturday',  short: 'Sat', day: 6 },
];

const SHIFT_CFG: Record<Shift, {
  label: string; time: string;
  Icon: React.FC<{ className?: string }>;
  color: string; bg: string; border: string; pill: string;
}> = {
  morning: { label: 'Morning', time: '08:00 – 17:00', Icon: Sun,  color: 'text-amber-500',  bg: 'bg-amber-50',  border: 'border-amber-200',  pill: 'bg-amber-100 text-amber-700'  },
  evening: { label: 'Evening', time: '13:00 – 22:00', Icon: Moon, color: 'text-violet-500', bg: 'bg-violet-50', border: 'border-violet-200', pill: 'bg-violet-100 text-violet-700' },
};

const EMP_TYPE_LABEL: Record<string, string> = {
  pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function groupEntriesByDay(entries: Entry[]): Map<Weekday, Shift[]> {
  const map = new Map<Weekday, Shift[]>();
  for (const e of entries) {
    if (!map.has(e.weekday)) map.set(e.weekday, []);
    map.get(e.weekday)!.push(e.shift);
  }
  return map;
}

function SchedulePill({ shift }: { shift: Shift }) {
  const cfg = SHIFT_CFG[shift];
  const ShiftIcon = cfg.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', cfg.pill)}>
      <ShiftIcon className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

// ─── WeekGrid — visual weekly schedule ───────────────────────────────────────
function WeekGrid({ entries }: { entries: Entry[] }) {
  const byDay = groupEntriesByDay(entries);
  return (
    <div className="grid grid-cols-7 gap-1">
      {DAYS.map(({ short, day }) => {
        const shifts = byDay.get(day) ?? [];
        const hasMorning = shifts.includes('morning');
        const hasEvening = shifts.includes('evening');
        const active = shifts.length > 0;
        return (
          <div key={day} className="flex flex-col items-center gap-1">
            <span className={cn('text-[9px] font-bold uppercase tracking-wide', active ? 'text-foreground' : 'text-muted-foreground/40')}>
              {short}
            </span>
            <div className={cn(
              'flex w-full flex-col gap-0.5 rounded-lg border p-0.5 transition-colors',
              active ? 'border-border bg-card' : 'border-transparent bg-secondary/50',
            )}>
              <div className={cn('h-2 rounded-sm', hasMorning ? 'bg-amber-400' : 'bg-transparent')} />
              <div className={cn('h-2 rounded-sm', hasEvening ? 'bg-violet-400' : 'bg-transparent')} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── TemplateEditor — create / edit a template ───────────────────────────────
function TemplateEditor({
  employees,
  initial,
  onSave,
  onCancel,
  saving,
}: {
  employees: StoreEmployee[];
  initial?: { userId: string; entries: Entry[]; note: string };
  onSave:   (userId: string, entries: Entry[], note: string) => Promise<void>;
  onCancel: () => void;
  saving:   boolean;
}) {
  const [userId,  setUserId]  = useState(initial?.userId  ?? '');
  const [entries, setEntries] = useState<Entry[]>(initial?.entries ?? []);
  const [note,    setNote]    = useState(initial?.note    ?? '');

  function toggleEntry(day: Weekday, shift: Shift) {
    setEntries(prev => {
      const exists = prev.some(e => e.weekday === day && e.shift === shift);
      return exists
        ? prev.filter(e => !(e.weekday === day && e.shift === shift))
        : [...prev, { weekday: day, shift }];
    });
  }

  function isSelected(day: Weekday, shift: Shift) {
    return entries.some(e => e.weekday === day && e.shift === shift);
  }

  const canSave = userId && entries.length > 0;

  return (
    <div className="space-y-5">
      {/* Employee picker */}
      {!initial && (
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Employee
          </label>
          <div className="relative">
            <select
              value={userId}
              onChange={e => setUserId(e.target.value)}
              className="w-full appearance-none rounded-xl border border-border bg-card px-4 py-3 pr-10 text-sm font-medium text-foreground outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">Select employee…</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({EMP_TYPE_LABEL[emp.employeeType ?? ''] ?? emp.employeeType})
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Day × Shift grid */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Working Days & Shifts
        </label>
        <div className="overflow-hidden rounded-xl border border-border">
          {/* Header */}
          <div className="grid grid-cols-[80px_1fr_1fr] border-b border-border bg-secondary/50 px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Day</span>
            {(['morning', 'evening'] as Shift[]).map(shift => {
              const ShiftIcon = SHIFT_CFG[shift].Icon;
              return (
              <div key={shift} className="flex items-center gap-1.5">
                <ShiftIcon className={cn('h-3 w-3', SHIFT_CFG[shift].color)} />
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {SHIFT_CFG[shift].label}
                </span>
              </div>
              );
            })}
          </div>
          {/* Rows */}
          {DAYS.map(({ label, short, day }, i) => (
            <div
              key={day}
              className={cn(
                'grid grid-cols-[80px_1fr_1fr] items-center px-3 py-2.5',
                i < DAYS.length - 1 && 'border-b border-border/60',
              )}
            >
              <span className="text-sm font-medium text-foreground">{short}</span>
              {(['morning', 'evening'] as Shift[]).map(shift => {
                const selected = isSelected(day, shift);
                const cfg = SHIFT_CFG[shift];
                return (
                  <button
                    key={shift}
                    type="button"
                    onClick={() => toggleEntry(day, shift)}
                    className={cn(
                      'mr-3 flex h-8 w-8 items-center justify-center rounded-lg border-2 transition-all',
                      selected
                        ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                        : 'border-border/50 bg-transparent text-muted-foreground/30 hover:border-border hover:bg-secondary',
                    )}
                  >
                    {selected ? <Check className="h-4 w-4" strokeWidth={3} /> : <Plus className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        {entries.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {entries.length} slot{entries.length !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>

      {/* Preview */}
      {entries.length > 0 && (
        <div className="space-y-2">
          <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Preview
          </label>
          <div className="rounded-xl border border-border bg-card p-3">
            <WeekGrid entries={entries} />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {entries
                .slice()
                .sort((a, b) => a.weekday - b.weekday || a.shift.localeCompare(b.shift))
                .map((e, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                    {DAYS.find(d => d.day === e.weekday)?.short}
                    <SchedulePill shift={e.shift} />
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Note */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Note <span className="font-normal normal-case">(optional)</span>
        </label>
        <input
          type="text"
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g. Mon–Fri morning shift"
          className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(userId, entries, note)}
          disabled={!canSave || saving}
          className={cn(
            'flex h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors',
            canSave && !saving
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Schedule'}
        </button>
      </div>
    </div>
  );
}

// ─── TemplateCard — one employee's schedule ───────────────────────────────────
function TemplateCard({
  slot,
  onEdit,
  onDeactivate,
}: {
  slot:         TemplateSlot;
  onEdit:       (slot: TemplateSlot) => void;
  onDeactivate: (templateId: string) => Promise<void>;
}) {
  const [expanded,     setExpanded]     = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const { template, user } = slot;
  const byDay = groupEntriesByDay(template.entries);
  const empTypeLabel = EMP_TYPE_LABEL[user?.employeeType ?? ''] ?? user?.employeeType ?? '—';

  async function handleDeactivate() {
    if (!confirm(`Remove schedule for ${user?.name ?? 'this employee'}? Future unattended shifts will be deleted.`)) return;
    setDeactivating(true);
    try { await onDeactivate(template.id); }
    finally { setDeactivating(false); }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/* Avatar */}
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
          {user?.name?.charAt(0).toUpperCase() ?? '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{user?.name ?? 'Unknown'}</p>
          <p className="text-xs text-muted-foreground">{empTypeLabel}</p>
        </div>
        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Week grid — always visible */}
      <div className="px-4 pb-3">
        <WeekGrid entries={template.entries} />
        {/* Shift summary chips */}
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {Array.from(byDay.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([day, shifts]) =>
              shifts.map(shift => (
                <span key={`${day}-${shift}`} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {DAYS.find(d => d.day === day)?.short}
                  <SchedulePill shift={shift} />
                </span>
              ))
            )}
        </div>
      </div>

      {/* Expanded detail + actions */}
      {expanded && (
        <div className="border-t border-border/60 bg-secondary/30 px-4 py-3.5 space-y-3">
          {template.note && (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold">Note: </span>{template.note}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            Last updated {new Date(template.updatedAt).toLocaleDateString('en-ID', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(slot)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-xs font-semibold text-foreground hover:bg-secondary"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit Schedule
            </button>
            <button
              onClick={handleDeactivate}
              disabled={deactivating}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-destructive hover:bg-red-100 disabled:opacity-50"
            >
              {deactivating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type View = 'list' | 'create' | 'edit';

export default function ScheduleManagePage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user         = session?.user as any;
  const employeeType = user?.employeeType as string | null;
  const storeId      = user?.storeId     as string | null;
  const userId       = user?.id          as string | null;

  const [view,       setView]       = useState<View>('list');
  const [templates,  setTemplates]  = useState<TemplateSlot[]>([]);
  const [employees,  setEmployees]  = useState<StoreEmployee[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [saving,     setSaving]     = useState(false);
  const [editTarget, setEditTarget] = useState<TemplateSlot | null>(null);

  // ── Auth guard: PIC 1 only ──────────────────────────────────────────────
  const isPic1 = employeeType === 'pic_1';

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isPic1)  { router.replace('/employee'); }
  }, [authStatus, session, isPic1, router]);

  // ── Load data ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [tRes, eRes] = await Promise.all([
        fetch('/api/pic/schedule/templates'),
        fetch('/api/pic/schedule/employees'),
      ]);
      const [tJson, eJson] = await Promise.all([tRes.json(), eRes.json()]);
      if (tJson.success) setTemplates(tJson.templates ?? []);
      if (eJson.success) setEmployees(eJson.employees ?? []);
    } catch {
      toast.error('Failed to load schedule data');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { if (isPic1) load(); }, [isPic1, load]);

  // ── Employees without an active template ─────────────────────────────────
  const scheduledUserIds = new Set(templates.map(t => t.user?.id).filter(Boolean));
  const unscheduledEmps  = employees.filter(e => !scheduledUserIds.has(e.id));

  // ── Save (create or update) ───────────────────────────────────────────────
  async function handleSave(targetUserId: string, entries: Entry[], note: string) {
    setSaving(true);
    try {
      if (view === 'create') {
        const res  = await fetch('/api/pic/schedule/templates', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ userId: targetUserId, entries, note }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        toast.success('Schedule created!');
      } else if (view === 'edit' && editTarget) {
        const res  = await fetch(`/api/pic/schedule/templates/${editTarget.template.id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ entries, note }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
        toast.success('Schedule updated!');
      }
      setView('list');
      setEditTarget(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Deactivate ────────────────────────────────────────────────────────────
  async function handleDeactivate(templateId: string) {
    try {
      const res  = await fetch(`/api/pic/schedule/templates/${templateId}`, {
        method:  'DELETE',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Schedule removed');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isPic1) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
          <Shield className="h-8 w-8 text-destructive" />
        </div>
        <p className="text-base font-bold text-foreground">Access Restricted</p>
        <p className="text-sm text-muted-foreground">Only PIC 1 can manage store schedules.</p>
      </div>
    );
  }

  const isFormView = view === 'create' || view === 'edit';

  return (
    <div className="flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-12">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 bottom-0 h-24 w-24 rounded-full bg-white/5" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
            {isFormView
              ? view === 'create' ? 'New Schedule' : 'Edit Schedule'
              : 'Schedule Manager'}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">
            {isFormView
              ? view === 'create' ? 'Assign Shifts' : `Edit — ${editTarget?.user?.name ?? ''}`
              : 'Staff Schedules'}
          </h1>
          {!isFormView && (
            <p className="mt-1 text-xs text-primary-foreground/50">
              {templates.length} active schedule{templates.length !== 1 ? 's' : ''} · your store only
            </p>
          )}
        </div>

        {/* Stats pills */}
        {!isFormView && !loading && (
          <div className="relative mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground">
              <Users className="h-3 w-3" />
              {templates.length} scheduled
            </span>
            {unscheduledEmps.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/20 px-3 py-1.5 text-xs font-medium text-amber-200">
                <AlertCircle className="h-3 w-3" />
                {unscheduledEmps.length} unscheduled
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="space-y-4 p-4 pb-10">

        {/* ── Loading skeleton ── */}
        {loading && view === 'list' && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-secondary" />
            ))}
          </div>
        )}

        {/* ── LIST VIEW ── */}
        {!loading && view === 'list' && (
          <>
            {/* Unscheduled employees banner */}
            {unscheduledEmps.length > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="flex-1 text-xs text-amber-800">
                  <p className="font-bold">Employees without schedules:</p>
                  <p className="mt-0.5">{unscheduledEmps.map(e => e.name).join(', ')}</p>
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 px-1">
              {(['morning', 'evening'] as Shift[]).map(shift => (
                <div key={shift} className="flex items-center gap-1.5">
                  <div className={cn('h-2.5 w-2.5 rounded-sm', shift === 'morning' ? 'bg-amber-400' : 'bg-violet-400')} />
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {SHIFT_CFG[shift].label} {SHIFT_CFG[shift].time}
                  </span>
                </div>
              ))}
            </div>

            {/* Template cards */}
            {templates.length === 0 && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-12 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary">
                  <Calendar className="h-7 w-7 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">No schedules yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Create a schedule for each employee in your store.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {templates.map(slot => (
                <TemplateCard
                  key={slot.template.id}
                  slot={slot}
                  onEdit={s => { setEditTarget(s); setView('edit'); }}
                  onDeactivate={handleDeactivate}
                />
              ))}
            </div>

            {/* Add new */}
            {unscheduledEmps.length > 0 && (
              <button
                onClick={() => setView('create')}
                className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 text-sm font-bold text-primary transition-colors hover:border-primary/50 hover:bg-primary/10"
              >
                <Plus className="h-5 w-5" />
                Assign New Schedule
              </button>
            )}
          </>
        )}

        {/* ── CREATE VIEW ── */}
        {view === 'create' && (
          <TemplateEditor
            employees={unscheduledEmps}
            onSave={handleSave}
            onCancel={() => setView('list')}
            saving={saving}
          />
        )}

        {/* ── EDIT VIEW ── */}
        {view === 'edit' && editTarget && (
          <TemplateEditor
            employees={employees}
            initial={{
              userId:  editTarget.user?.id ?? '',
              entries: editTarget.template.entries,
              note:    editTarget.template.note ?? '',
            }}
            onSave={(_, entries, note) =>
              handleSave(editTarget.user?.id ?? '', entries, note)
            }
            onCancel={() => { setEditTarget(null); setView('list'); }}
            saving={saving}
          />
        )}
      </div>
    </div>
  );
}