// app/ops/schedules/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import {
  Plus, RefreshCw, Pencil, Trash2, Sun, Moon,
  UserCircle, CalendarDays, Info,
  Users, Clock, AlertCircle, CheckCircle2,
  Store, MapPin, ShieldAlert, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type Shift = 'morning' | 'evening';

interface Entry {
  weekday: number; // 0–6
  shift:   Shift;
}

interface SerializedTemplate {
  template: {
    id:                   string;
    userId:               string;
    storeId:              string;
    isActive:             boolean;
    note:                 string | null;
    createdBy:            string | null;
    lastScheduledThrough: string | null;
    createdAt:            string;
    updatedAt:            string;
  };
  entries: {
    id:         string;
    templateId: string;
    weekday:    number;
    shift:      string;
    createdAt:  string;
  }[];
  user: {
    id:           string;
    name:         string;
    role:         string;
    employeeType: string | null;
  } | null;
}

interface Employee {
  id:           string;
  name:         string;
  employeeType: string | null;
  role:         string;
}

interface StoreData {
  storeId:   string;
  storeName: string;
  address:   string;
  templates: SerializedTemplate[];
  employees: Employee[];
}

interface AreaData {
  areaId:   string;
  areaName: string;
  stores:   StoreData[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SHIFT_CFG: Record<Shift, {
  startTime: string; endTime: string; label: string;
  breakType: string; lateAfter: string;
  Icon:      React.FC<{ className?: string }>;
  color:     string; badgeCls: string;
}> = {
  morning: {
    startTime: '08:00', endTime: '17:00', label: 'Morning',
    breakType: 'Lunch',  lateAfter: '08:30',
    Icon: Sun,  color: 'text-amber-500',
    badgeCls: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  evening: {
    startTime: '13:00', endTime: '22:00', label: 'Evening',
    breakType: 'Dinner', lateAfter: '13:30',
    Icon: Moon, color: 'text-violet-500',
    badgeCls: 'border-violet-200 bg-violet-50 text-violet-700',
  },
};

const EMP_TYPE_LABEL: Record<string, string> = {
  pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO',
};

const DAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hoursPerWeek(entries: { weekday: number; shift: string }[]): number {
  return entries.reduce((sum, e) => {
    const cfg = SHIFT_CFG[e.shift as Shift];
    if (!cfg) return sum;
    const [sh, sm] = cfg.startTime.split(':').map(Number);
    const [eh, em] = cfg.endTime.split(':').map(Number);
    return sum + (eh + em / 60) - (sh + sm / 60);
  }, 0);
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Not yet';
  return new Date(iso).toLocaleDateString('en-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ─── Pattern chips ────────────────────────────────────────────────────────────
function PatternChips({ entries }: { entries: { weekday: number; shift: string }[] }) {
  if (!entries.length)
    return <span className="text-xs italic text-muted-foreground">No pattern</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {[...entries]
        .sort((a, b) => a.weekday - b.weekday)
        .map((e, i) => {
          const cfg = SHIFT_CFG[e.shift as Shift];
          const ShiftIcon = cfg?.Icon;
          return (
            <Badge
              key={i}
              variant="outline"
              className={cn('gap-1 px-1.5 py-0 text-[10px] font-semibold', cfg?.badgeCls)}
            >
              {DAYS[e.weekday]}
              {ShiftIcon && <ShiftIcon className="h-2.5 w-2.5" />}
            </Badge>
          );
        })}
    </div>
  );
}

// ─── Week-grid toggle ─────────────────────────────────────────────────────────
function WeekGrid({ entries, onChange, readOnly = false }: {
  entries:   Entry[];
  onChange?: (e: Entry[]) => void;
  readOnly?: boolean;
}) {
  const toggle = (weekday: number, shift: Shift) => {
    if (readOnly || !onChange) return;
    const idx = entries.findIndex((e) => e.weekday === weekday && e.shift === shift);
    onChange(
      idx >= 0
        ? entries.filter((_, i) => i !== idx)
        : [...entries, { weekday, shift }],
    );
  };
  const has = (weekday: number, shift: Shift) =>
    entries.some((e) => e.weekday === weekday && e.shift === shift);

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          {(['morning', 'evening'] as Shift[]).map((shift) => {
            const cfg = SHIFT_CFG[shift];
            const ShiftIcon = cfg.Icon;
            return (
              <span
                key={shift}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                  shift === 'morning'
                    ? 'border-amber-200 bg-amber-50 text-amber-700'
                    : 'border-violet-200 bg-violet-50 text-violet-700',
                )}
              >
                <ShiftIcon className="h-3 w-3" />
                {cfg.label} · {cfg.startTime}–{cfg.endTime}
                <span className="opacity-60">
                  · {cfg.breakType} break · Late after {cfg.lateAfter}
                </span>
              </span>
            );
          })}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-center text-xs">
          <thead className="bg-secondary/60">
            <tr>
              <th className="w-28 py-2.5 pl-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Shift
              </th>
              {DAYS.map((d) => (
                <th key={d} className="py-2.5 text-[11px] font-semibold text-foreground">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['morning', 'evening'] as Shift[]).map((shift, si) => {
              const cfg = SHIFT_CFG[shift];
              const ShiftIcon = cfg.Icon;
              return (
                <tr key={shift} className={si === 0 ? 'border-b border-border' : ''}>
                  <td className="py-2 pl-3 text-left">
                    <div className="flex flex-col gap-0.5">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold w-fit',
                        shift === 'morning' ? 'bg-amber-50 text-amber-700' : 'bg-violet-50 text-violet-700',
                      )}>
                        <ShiftIcon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                      <span className="flex items-center gap-0.5 pl-0.5 text-[9px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {cfg.startTime}–{cfg.endTime}
                      </span>
                    </div>
                  </td>
                  {DAYS.map((_, day) => {
                    const active = has(day, shift);
                    return (
                      <td key={day} className="py-2">
                        <button
                          type="button"
                          onClick={() => toggle(day, shift)}
                          disabled={readOnly}
                          title={readOnly ? undefined : `${DAYS_FULL[day]} ${cfg.label}`}
                          className={cn(
                            'mx-auto flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-all',
                            active
                              ? shift === 'morning'
                                ? 'border-amber-400 bg-amber-100 text-amber-700 shadow-sm'
                                : 'border-violet-400 bg-violet-100 text-violet-700 shadow-sm'
                              : readOnly
                              ? 'border-border/40 bg-background text-muted-foreground/30 cursor-default'
                              : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:bg-primary/5',
                          )}
                        >
                          {active ? '✓' : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-3 py-1.5 text-[10px] text-muted-foreground">
          {entries.length} slot{entries.length !== 1 ? 's' : ''} selected
          {entries.length > 0 && (
            <> · {[...new Set(entries.map((e) => e.weekday))].length} day(s)/week
            · ~{hoursPerWeek(entries).toFixed(0)}h/week</>
          )}
        </p>
      </div>
    </div>
  );
}

// ─── Override dialog ─────────────────────────────────────────────────────────
// OPS sees a warning that PIC 1 normally owns schedules.
// They can still edit but it's clearly framed as an override.
function OverrideDialog({
  open, onClose, onSaved,
  employees, editing, storeId, storeName,
}: {
  open:      boolean;
  onClose:   () => void;
  onSaved:   () => void;
  employees: Employee[];
  editing:   SerializedTemplate | null;
  storeId:   string;
  storeName: string;
}) {
  const [userId,  setUserId]  = useState('');
  const [note,    setNote]    = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [saving,  setSaving]  = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!open) { setConfirmed(false); return; }
    setUserId(editing?.user?.id ?? '');
    setNote(editing?.template.note ?? '');
    setEntries(
      editing?.entries.map((e) => ({
        weekday: e.weekday,
        shift:   e.shift as Shift,
      })) ?? [],
    );
  }, [editing, open]);

  const save = async () => {
    if (!userId)         return toast.error('Select an employee');
    if (!entries.length) return toast.error('Select at least one shift slot');

    setSaving(true);
    try {
      const isEdit = Boolean(editing);
      const url    = isEdit
        ? `/api/ops/schedules/${editing!.template.id}`
        : '/api/ops/schedules';
      const method = isEdit ? 'PATCH' : 'POST';

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, storeId, entries, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Unknown error');

      toast.success(
        isEdit
          ? 'Schedule overridden — future shifts regenerated'
          : 'Schedule created — shifts auto-generating',
      );
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = Boolean(editing);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isEdit ? 'Override Schedule' : 'Create Schedule'}
            <Badge variant="outline" className="ml-1 gap-1 text-xs font-normal">
              <Store className="h-3 w-3" />
              {storeName}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* OPS override warning */}
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
            <div className="text-xs text-amber-800 space-y-1">
              <p className="font-semibold">OPS Override Mode</p>
              <p>
                Schedules are normally created and maintained by the PIC 1 of each store.
                As OPS, you can override here to correct mistakes or cover gaps — but prefer
                coordinating with PIC 1 first.
              </p>
              {!confirmed && (
                <button
                  type="button"
                  onClick={() => setConfirmed(true)}
                  className="mt-1.5 rounded-md bg-amber-200 px-3 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-300"
                >
                  I understand, proceed
                </button>
              )}
              {confirmed && (
                <p className="flex items-center gap-1 font-medium text-amber-700">
                  <CheckCircle2 className="h-3 w-3" /> Acknowledged
                </p>
              )}
            </div>
          </div>

          {confirmed && (
            <>
              {/* Auto-scheduling notice */}
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                <span>
                  {isEdit
                    ? 'Saving will regenerate all future unstarted shifts. Past shifts are untouched.'
                    : 'Once created, schedules and tasks generate automatically — no publishing needed.'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Employee *</Label>
                  <Select value={userId} onValueChange={setUserId} disabled={isEdit}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select employee…" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.length === 0 ? (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                          No employees found for this store
                        </div>
                      ) : (
                        employees.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            <span className="font-medium">{e.name}</span>
                            {e.employeeType && (
                              <span className="ml-2 text-xs uppercase text-muted-foreground">
                                {EMP_TYPE_LABEL[e.employeeType] ?? e.employeeType}
                              </span>
                            )}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Note (optional)</Label>
                  <Input
                    placeholder="e.g. OPS override — gap cover"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Weekly pattern *</Label>
                <p className="text-xs text-muted-foreground">
                  Toggle days and shifts. This pattern repeats automatically — tasks are
                  auto-assigned per role, type, and shift.
                </p>
                <WeekGrid entries={entries} onChange={setEntries} />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={save}
            disabled={saving || !confirmed}
            className="gap-1.5"
          >
            {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
            {saving ? 'Saving…' : isEdit ? 'Override Schedule' : 'Create Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Store schedule table ─────────────────────────────────────────────────────
function StoreScheduleTable({
  store,
  onEdit,
  onRemove,
  onAdd,
}: {
  store:    StoreData;
  onEdit:   (t: SerializedTemplate) => void;
  onRemove: (id: string, storeName: string) => void;
  onAdd:    (storeId: string) => void;
}) {
  const { templates, employees, storeName } = store;

  const scheduledIds   = new Set(templates.map((t) => t.user?.id).filter(Boolean));
  const unscheduled    = employees.filter((e) => !scheduledIds.has(e.id));
  const morningSlots   = templates.reduce((n, t) => n + t.entries.filter((e) => e.shift === 'morning').length, 0);
  const eveningSlots   = templates.reduce((n, t) => n + t.entries.filter((e) => e.shift === 'evening').length, 0);

  return (
    <div className="space-y-3">
      {/* Store stats row */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          <Users className="h-3 w-3" />
          {templates.length} scheduled
        </span>
        {unscheduled.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            <AlertCircle className="h-3 w-3" />
            {unscheduled.length} unscheduled: {unscheduled.map((e) => e.name).join(', ')}
          </span>
        )}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Sun  className="h-3 w-3 text-amber-500" /> {morningSlots} morning
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Moon className="h-3 w-3 text-violet-500" /> {eveningSlots} evening
        </span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Weekly Pattern</TableHead>
              <TableHead className="w-24 text-center">Slots/wk</TableHead>
              <TableHead className="w-28">Est. Hours</TableHead>
              <TableHead className="w-36">Scheduled Through</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <CalendarDays className="h-7 w-7 opacity-30" />
                    <p className="text-sm font-medium">No schedules for this store yet</p>
                    <p className="text-xs">PIC 1 can create them, or use Override to add one.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              templates.map((t) => (
                <TableRow key={t.template.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-secondary">
                        <UserCircle className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {t.user?.name ?? '(no user)'}
                        </p>
                        {t.user?.employeeType && (
                          <p className="text-[10px] uppercase text-muted-foreground">
                            {EMP_TYPE_LABEL[t.user.employeeType] ?? t.user.employeeType}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><PatternChips entries={t.entries} /></TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{t.entries.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      ~{hoursPerWeek(t.entries).toFixed(0)}h/wk
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      'text-xs',
                      t.template.lastScheduledThrough
                        ? 'font-medium text-emerald-600'
                        : 'italic text-muted-foreground',
                    )}>
                      {fmtDate(t.template.lastScheduledThrough)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {t.template.note ?? '—'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Override / edit schedule"
                        onClick={() => onEdit(t)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Remove schedule"
                        onClick={() => onRemove(t.template.id, storeName)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add override button */}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 border-dashed"
        onClick={() => onAdd(store.storeId)}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Override Schedule
      </Button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function OpsSchedulesPage() {
  const { data: session } = useSession();
  const opsUserId = (session?.user as any)?.id as string | undefined;

  const [areaData,    setAreaData]    = useState<AreaData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState<string | null>(null);
  const [activeStore, setActiveStore] = useState<string>('');

  // Dialog state
  const [editorOpen,     setEditorOpen]     = useState(false);
  const [editorStoreId,  setEditorStoreId]  = useState('');
  const [editing,        setEditing]        = useState<SerializedTemplate | null>(null);

  // ── Load area data ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!opsUserId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/ops/schedules/area');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? 'Failed to load');
      setAreaData(json.area);
      // Default to first store tab
      if (json.area?.stores?.length && !activeStore) {
        setActiveStore(json.area.stores[0].storeId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      toast.error(`Failed to load: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [opsUserId, activeStore]);

  useEffect(() => { if (opsUserId) load(); }, [opsUserId]); // eslint-disable-line

  // ── Actions ────────────────────────────────────────────────────────────────
  function openAdd(storeId: string) {
    setEditorStoreId(storeId);
    setEditing(null);
    setEditorOpen(true);
  }

  function openEdit(t: SerializedTemplate) {
    setEditorStoreId(t.template.storeId);
    setEditing(t);
    setEditorOpen(true);
  }

  async function remove(id: string, storeName: string) {
    if (!confirm(`Remove this schedule from ${storeName}? Future unstarted shifts will be deleted.`)) return;
    try {
      const res  = await fetch(`/api/ops/schedules/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Schedule removed');
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    }
  }

  // ── Summary across all stores ──────────────────────────────────────────────
  const allTemplates    = areaData?.stores.flatMap((s) => s.templates) ?? [];
  const totalEmployees  = allTemplates.length;
  const totalMorning    = allTemplates.reduce((n, t) => n + t.entries.filter((e) => e.shift === 'morning').length, 0);
  const totalEvening    = allTemplates.reduce((n, t) => n + t.entries.filter((e) => e.shift === 'evening').length, 0);
  const totalUnscheduled = areaData?.stores.reduce((n, s) => {
    const ids = new Set(s.templates.map((t) => t.user?.id));
    return n + s.employees.filter((e) => !ids.has(e.id)).length;
  }, 0) ?? 0;

  const currentStore = areaData?.stores.find((s) => s.storeId === activeStore);

  return (
    <div className="space-y-6 p-6">

      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Schedules</h1>
          {areaData && (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {areaData.areaName} · {areaData.stores.length} store{areaData.stores.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Button
          variant="outline" size="sm" className="gap-1.5"
          onClick={load} disabled={loading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* ── Error ── */}
      {loadError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2.5 p-4">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" className="ml-auto" onClick={load}>Retry</Button>
          </CardContent>
        </Card>
      )}

      {/* ── OPS role callout ── */}
      <Card className="border-amber-200 bg-amber-50/60">
        <CardContent className="flex items-start gap-3 p-4">
          <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
          <div className="space-y-1 text-sm text-amber-900">
            <p>
              <strong>Your role here is oversight.</strong> Schedules are created and maintained
              by the PIC 1 of each store. You can view all schedules across your area and
              override them if there's a mistake — but coordinate with PIC 1 first.
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-0.5 text-xs text-amber-700">
              {(['morning', 'evening'] as Shift[]).map((shift) => {
                const cfg = SHIFT_CFG[shift];
                const ShiftIcon = cfg.Icon;
                return (
                  <span key={shift} className="flex items-center gap-1">
                    <ShiftIcon className="h-3 w-3" />
                    <span className="font-medium capitalize">{shift}:</span>
                    {cfg.startTime}–{cfg.endTime} · {cfg.breakType} break · Late after {cfg.lateAfter}
                  </span>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Area-wide summary stats ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Stores in area',      value: areaData?.stores.length ?? 0, Icon: Store,        color: 'text-primary',    bg: 'bg-primary/10'   },
          { label: 'Employees scheduled', value: totalEmployees,                Icon: Users,        color: 'text-emerald-600',bg: 'bg-emerald-50'   },
          { label: 'Morning slots/wk',    value: totalMorning,                  Icon: Sun,          color: 'text-amber-600',  bg: 'bg-amber-50'     },
          { label: 'Evening slots/wk',    value: totalEvening,                  Icon: Moon,         color: 'text-violet-600', bg: 'bg-violet-50'    },
        ].map(({ label, value, Icon, color, bg }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', bg)}>
                <Icon className={cn('h-5 w-5', color)} />
              </div>
              <div>
                <p className={cn('text-2xl font-bold', color)}>{loading ? '—' : value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Unscheduled alert ── */}
      {!loading && totalUnscheduled > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-600" />
            <p className="text-sm text-amber-800">
              <strong>{totalUnscheduled} employee{totalUnscheduled !== 1 ? 's' : ''}</strong> across
              your area have no schedule yet. Check each store tab below.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Per-store tabs ── */}
      {loading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      )}

      {!loading && areaData && (
        <Tabs value={activeStore} onValueChange={setActiveStore}>
          {/* Tab list — one tab per store */}
          <TabsList className={cn(
            'mb-4 h-auto w-full justify-start gap-1 rounded-xl bg-secondary p-1',
            areaData.stores.length > 3 && 'flex-wrap',
          )}>
            {areaData.stores.map((s) => {
              const unscheduledCount = s.employees.filter(
                (e) => !new Set(s.templates.map((t) => t.user?.id)).has(e.id)
              ).length;
              return (
                <TabsTrigger
                  key={s.storeId}
                  value={s.storeId}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
                >
                  <Store className="h-3.5 w-3.5" />
                  <span className="font-medium">{s.storeName}</span>
                  {unscheduledCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white">
                      {unscheduledCount}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Tab panels */}
          {areaData.stores.map((s) => (
            <TabsContent key={s.storeId} value={s.storeId} className="mt-0">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    {s.storeName}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {s.address}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <StoreScheduleTable
                    store={s}
                    onEdit={openEdit}
                    onRemove={remove}
                    onAdd={openAdd}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}

      {/* ── No area assigned ── */}
      {!loading && !areaData && !loadError && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-semibold">No area assigned</p>
            <p className="text-xs text-muted-foreground">
              Ask an admin to assign you to an area before you can view schedules.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Override dialog ── */}
      <OverrideDialog
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSaved={() => { setEditorOpen(false); load(); }}
        employees={
          areaData?.stores.find((s) => s.storeId === editorStoreId)?.employees ?? []
        }
        editing={editing}
        storeId={editorStoreId}
        storeName={
          areaData?.stores.find((s) => s.storeId === editorStoreId)?.storeName ?? ''
        }
      />
    </div>
  );
}