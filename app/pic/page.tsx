'use client';
// app/pic/page.tsx — PIC Panel home: manage the store's schedule.
//
// Desktop dashboard, not a mobile app screen: sticky header with month nav
// and actions, stat tiles, and a spreadsheet-style employee × day grid.
// Click any cell to set/edit that day. Import/download the Excel template
// from the header toolbar.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession }  from 'next-auth/react';
import { useRouter }   from 'next/navigation';
import {
  Sun, Moon, Upload, Download, Loader2, Trash2, RefreshCw,
  Shield, Calendar, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  Plus, Clock, Users, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftCode = 'morning' | 'evening' | 'full_day' | string;

interface ShiftOption {
  id:        number;
  code:      string;
  label:     string;
  startTime: string | null;
  endTime:   string | null;
}

interface DayEntry {
  id:       string;
  userId:   string;
  userName: string | null;
  userType: string | null;
  date:     string;
  shiftId:  number | null;
  shift:    ShiftCode | null;
  isOff:    boolean;
  isLeave:  boolean;
}

interface MonthlySchedule {
  id:        string;
  storeId:   string;
  yearMonth: string;
  note:      string | null;
  createdAt: string;
  updatedAt: string;
  entries:   DayEntry[];
}

interface ImportResult {
  success:          boolean;
  schedulesCreated: number;
  entriesCreated:   number;
  skipped:          number;
  errors:           string[];
  notFound:         string[];
  month?:           string;
  sheet?:           string;
  sections?:        string[];
  dateErrors?:      string[];
}

interface EmployeeOption {
  id:           string;
  name:         string;
  employeeType: string | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const EMP_LABEL: Record<string, string> = { pic_1: 'PIC 1', pic_2: 'PIC 2', sa: 'SA', so: 'SO' };

const SHIFT_PALETTE: Record<string, { label: string; bg: string; border: string; text: string; dot: string }> = {
  morning:  { label: 'E',  bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', dot: '#fb923c' },
  evening:  { label: 'L',  bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', dot: '#a78bfa' },
  full_day: { label: 'FD', bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d', dot: '#4ade80' },
  leave:    { label: 'AL', bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#818cf8' },
  off:      { label: 'OFF', bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8', dot: '#cbd5e1' },
};

function cellPalette(entry: DayEntry | undefined) {
  if (!entry) return null;
  if (entry.isLeave) return SHIFT_PALETTE.leave;
  if (entry.isOff || !entry.shift) return SHIFT_PALETTE.off;
  return SHIFT_PALETTE[entry.shift] ?? { label: entry.shift.slice(0, 2).toUpperCase(), bg: '#f1f5f9', border: '#e2e8f0', text: '#475569', dot: '#94a3b8' };
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function currentYearMonth() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
}

function formatYearMonth(ym: string | null | undefined): string {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${MONTHS[m - 1]} ${y}`;
}

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dayOfWeekLabel(yearMonth: string, day: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-ID', { weekday: 'short' })[0];
}

// ─── ShiftPicker ──────────────────────────────────────────────────────────────

function ShiftPicker({ shiftOptions, selected, onSelect }: {
  shiftOptions: ShiftOption[];
  selected:     string;
  onSelect:     (v: string) => void;
}) {
  const specials = [
    { code: 'off',   label: 'Day Off', sub: 'No work today',   accent: '#64748b', icon: <X        className="h-5 w-5" /> },
    { code: 'leave', label: 'Leave',   sub: 'AL / CU / Sick',  accent: '#4338ca', icon: <Calendar className="h-5 w-5" /> },
  ];

  const allOptions = [
    ...shiftOptions.map(s => ({
      code:   s.code,
      label:  s.label,
      sub:    [formatTime(s.startTime), formatTime(s.endTime)].filter(Boolean).join(' – ') || '—',
      accent: s.code === 'morning' ? '#ea580c' : s.code === 'evening' ? '#7c3aed' : s.code === 'full_day' ? '#15803d' : '#475569',
      icon:   s.code === 'morning'
        ? <Sun  className="h-5 w-5" />
        : s.code === 'evening'
          ? <Moon className="h-5 w-5" />
          : s.code === 'full_day'
            ? <Clock className="h-5 w-5" />
            : <Calendar className="h-5 w-5" />,
    })),
    ...specials,
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {allOptions.map(opt => {
        const active = selected === opt.code;
        return (
          <button
            key={opt.code}
            type="button"
            onClick={() => onSelect(opt.code)}
            className="relative flex flex-col items-start gap-1.5 rounded-2xl border-2 px-4 py-3.5 text-left transition-all active:scale-[0.97]"
            style={{
              borderColor: active ? opt.accent : '#e2e8f0',
              background:  active ? `${opt.accent}12` : '#f8fafc',
              boxShadow:   active ? `0 0 0 3px ${opt.accent}20` : 'none',
            }}
          >
            <span style={{ color: active ? opt.accent : '#94a3b8' }}>{opt.icon}</span>
            <div>
              <p className="text-sm font-bold" style={{ color: active ? opt.accent : '#334155' }}>{opt.label}</p>
              <p className="text-[10px] text-slate-400">{opt.sub}</p>
            </div>
            {active && (
              <span className="absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full" style={{ background: opt.accent }}>
                <CheckCircle2 className="h-3 w-3 text-white" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── SetDayDialog — unified add/edit for one (employee, day) cell ────────────

interface ActiveCell {
  employee: EmployeeOption;
  day:      number;
  entry:    DayEntry | null;
}

function SetDayDialog({ cell, yearMonth, shiftOptions, onSave, onClose, saving }: {
  cell:         ActiveCell | null;
  yearMonth:    string;
  shiftOptions: ShiftOption[];
  onSave:       (p: { shift: string | null; isOff: boolean; isLeave: boolean }) => void;
  onClose:      () => void;
  saving:       boolean;
}) {
  const initialMode = cell?.entry
    ? (cell.entry.isLeave ? 'leave' : cell.entry.isOff ? 'off' : (cell.entry.shift ?? 'off'))
    : 'off';
  // Keyed by the parent (see call site) so this remounts — and re-derives
  // `mode` fresh from `initialMode` — whenever a different cell is opened,
  // instead of syncing it back with an effect.
  const [mode, setMode] = useState(initialMode);

  const [y, m] = yearMonth.split('-').map(Number);
  const label = cell ? new Date(y, m - 1, cell.day).toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' }) : '';

  function handleSave() {
    const isOff   = mode === 'off';
    const isLeave = mode === 'leave';
    const shift   = isOff || isLeave ? null : mode;
    onSave({ shift, isOff, isLeave });
  }

  return (
    <Dialog open={!!cell} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {cell && (
          <>
            <DialogHeader>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{cell.entry ? 'Edit Shift' : 'Set Shift'}</p>
              <DialogTitle>{cell.employee.name}</DialogTitle>
              <p className="text-sm text-slate-500">{label}</p>
            </DialogHeader>

            <div>
              {shiftOptions.length === 0
                ? <div className="flex items-center justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
                : <ShiftPicker shiftOptions={shiftOptions} selected={mode} onSelect={setMode} />
              }
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={onClose}
                className="flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 sm:flex-none sm:px-6"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60 sm:flex-none sm:px-6"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
              >
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save'}
              </button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── ImportButton ─────────────────────────────────────────────────────────────

function ImportButton({ onImported }: { onImported: () => void }) {
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true);
    setResult(null);
    setShowErrors(false);

    try {
      const form = new FormData();
      form.append('file', file);
      const res  = await fetch('/api/pic/schedule/import', { method: 'POST', body: form });
      const json = (await res.json()) as ImportResult & { error?: string };

      const normalised: ImportResult = {
        success:          json.success          ?? false,
        schedulesCreated: json.schedulesCreated ?? 0,
        entriesCreated:   json.entriesCreated   ?? 0,
        skipped:          json.skipped          ?? 0,
        errors:           json.errors           ?? (json.error ? [json.error] : []),
        notFound:         json.notFound         ?? [],
        month:            json.month,
        sheet:            json.sheet,
        sections:         json.sections,
        dateErrors:       json.dateErrors,
      };

      setResult(normalised);

      if (normalised.dateErrors && normalised.dateErrors.length > 0) {
        setShowErrors(true);
        toast.error('Excel has wrong dates — please fix and re-upload');
        return;
      }

      if (normalised.schedulesCreated > 0 && normalised.errors.length === 0 && normalised.notFound.length === 0) {
        toast.success(`Imported ${normalised.entriesCreated} entries`);
        onImported();
      } else if (normalised.schedulesCreated > 0) {
        toast.warning('Imported with warnings');
        setShowErrors(true);
        onImported();
      } else if (!normalised.success) {
        toast.error(normalised.errors[0] ?? 'Import failed');
        setShowErrors(true);
      } else {
        toast.info('No new data imported');
      }
    } catch (err) {
      setResult({ success: false, schedulesCreated: 0, entriesCreated: 0, skipped: 0, errors: [String(err)], notFound: [] });
      setShowErrors(true);
      toast.error('Network error');
    } finally {
      setImporting(false);
    }
  }

  const hasDateErrors = (result?.dateErrors?.length ?? 0) > 0;
  const hasErrors     = (result?.errors.length     ?? 0) > 0;
  const hasNotFound   = (result?.notFound.length   ?? 0) > 0;
  const hasWarnings   = hasDateErrors || hasErrors || hasNotFound;
  const isFullSuccess = result?.success && !hasWarnings;
  const isHardFail    = result && !result.success && (hasDateErrors || (result.schedulesCreated === 0));

  return (
    <div className="relative">
      <label
        className={cn(
          'flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors',
          importing ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        )}
      >
        <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} disabled={importing} />
        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {importing ? 'Importing…' : 'Import Excel'}
      </label>

      {result && (
        <div
          className={cn(
            'absolute right-0 top-12 z-20 w-80 overflow-hidden rounded-2xl border text-sm shadow-lg',
            isFullSuccess ? 'border-emerald-200 bg-emerald-50' : isHardFail ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50',
          )}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            {isFullSuccess
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              : <AlertCircle  className={cn('h-4 w-4 shrink-0', isHardFail ? 'text-red-500' : 'text-amber-500')} />}
            <div className="flex-1 min-w-0">
              <p className={cn('font-bold text-sm', isFullSuccess ? 'text-emerald-800' : isHardFail ? 'text-red-800' : 'text-amber-800')}>
                {isFullSuccess ? 'Import successful' : hasDateErrors ? 'Wrong dates in Excel' : isHardFail ? 'Import failed' : 'Imported with warnings'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {result.entriesCreated} entries · {result.schedulesCreated} store(s)
                {result.month && ` · ${formatYearMonth(result.month)}`}
              </p>
            </div>
            {hasWarnings && (
              <button onClick={() => setShowErrors(v => !v)} className={cn('text-[11px] font-semibold flex items-center gap-0.5', isHardFail ? 'text-red-700' : 'text-amber-700')}>
                Details {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button onClick={() => setResult(null)} className="text-slate-400"><X className="h-3.5 w-3.5" /></button>
          </div>

          {hasWarnings && showErrors && (
            <div className={cn('border-t bg-white/70 px-4 py-3 space-y-3', isHardFail ? 'border-red-200' : 'border-amber-200')}>
              {hasDateErrors && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1.5">Wrong dates — please fix your Excel file</p>
                  <ul className="max-h-40 overflow-y-auto space-y-1">
                    {result.dateErrors!.map((e, i) => <li key={i} className="text-[11px] leading-relaxed text-red-700">• {e}</li>)}
                  </ul>
                </div>
              )}
              {hasNotFound && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1">Employees not found in system</p>
                  <div className="flex flex-wrap gap-1">
                    {result.notFound.map(n => <span key={n} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{n}</span>)}
                  </div>
                </div>
              )}
              {hasErrors && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1">Errors</p>
                  <ul className="max-h-28 overflow-y-auto space-y-0.5">
                    {result.errors.map((e, i) => <li key={i} className="text-[11px] text-red-700 font-mono break-all">{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PicPanelPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user         = session?.user as any;
  const employeeType = user?.employeeType as string | null;
  const storeId      = user?.homeStoreId  as string | null;

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [downloading,   setDownloading]   = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [employees,    setEmployees]    = useState<EmployeeOption[]>([]);

  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [savingCell, setSavingCell] = useState(false);

  const isPic1 = employeeType === 'pic_1' || employeeType === 'pic_2';

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isPic1)  router.replace('/employee');
  }, [authStatus, session, isPic1, router]);

  // ── Fetch shifts + employees ───────────────────────────────────────────────
  useEffect(() => {
    if (!isPic1) return;
    fetch('/api/pic/schedule/shifts')
      .then(r => r.json())
      .then(j => { if (j.success) setShiftOptions(j.shifts ?? []); })
      .catch(() => toast.error('Failed to load shift options'));
  }, [isPic1]);

  useEffect(() => {
    if (!isPic1) return;
    fetch('/api/pic/schedule/employees')
      .then(r => r.json())
      .then(j => { if (j.success) setEmployees(j.employees ?? []); })
      .catch(() => toast.error('Failed to load employees'));
  }, [isPic1]);

  // ── Load schedule ──────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async (ym: string) => {
    if (!storeId) return;
    setLoading(true);
    try {
      const res  = await fetch(`/api/pic/schedule/monthly?yearMonth=${ym}`);
      const json = await res.json();
      setSchedule(json.schedule ?? null);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (isPic1) loadSchedule(selectedMonth);
  }, [isPic1, selectedMonth, loadSchedule]);

  // ── Month nav ───────────────────────────────────────────────────────────────
  const [y, m] = selectedMonth.split('-').map(Number);

  function goToMonth(deltaMonths: number) {
    const d = new Date(y, m - 1 + deltaMonths, 1);
    setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    setActiveCell(null);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleCreate() {
    if (schedule) { toast.error('A schedule already exists for this month'); return; }
    setShowCreateConfirm(true);
  }

  async function confirmCreate() {
    setShowCreateConfirm(false);
    setCreating(true);
    try {
      const res  = await fetch('/api/pic/schedule/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ yearMonth: selectedMonth }) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Empty schedule created — click a cell to assign shifts');
      loadSchedule(selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!confirm(`Delete the ${formatYearMonth(selectedMonth)} schedule? Attended days are preserved.`)) return;
    setDeleting(true);
    try {
      const res  = await fetch(`/api/pic/schedule/monthly?yearMonth=${selectedMonth}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(json.lockedCount > 0 ? `Cleared — ${json.lockedCount} attended day(s) preserved` : 'Schedule deleted');
      loadSchedule(selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally { setDeleting(false); }
  }

  async function handleDownloadTemplate() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/pic/schedule/template?yearMonth=${selectedMonth}`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? `schedule_template_${selectedMonth}.xlsx`;
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function handleSaveCell(patch: { shift: string | null; isOff: boolean; isLeave: boolean }) {
    if (!activeCell) return;
    setSavingCell(true);
    try {
      let res: Response;
      if (activeCell.entry) {
        res = await fetch(`/api/pic/schedule/entry/${activeCell.entry.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        });
      } else {
        res = await fetch('/api/pic/schedule/entry', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...patch, userId: activeCell.employee.id, date: isoDate(y, m, activeCell.day) }),
        });
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success('Schedule updated');
      setActiveCell(null);
      loadSchedule(selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally { setSavingCell(false); }
  }

  // ── Derived table data ──────────────────────────────────────────────────────
  const days = useMemo(() => Array.from({ length: daysInMonth(selectedMonth) }, (_, i) => i + 1), [selectedMonth]);
  const today = new Date();
  const todayDay = (today.getFullYear() === y && today.getMonth() + 1 === m) ? today.getDate() : -1;

  const entryMap = useMemo(() => {
    const map = new Map<string, DayEntry>();
    for (const e of schedule?.entries ?? []) {
      const d = new Date(e.date);
      map.set(`${e.userId}|${d.getDate()}`, e);
    }
    return map;
  }, [schedule]);

  const rosterEmployees = useMemo(() => {
    // Anyone with an entry this month, plus the fetched roster — deduped, sorted.
    const byId = new Map<string, EmployeeOption>();
    for (const emp of employees) byId.set(emp.id, emp);
    for (const e of schedule?.entries ?? []) {
      if (!byId.has(e.userId)) byId.set(e.userId, { id: e.userId, name: e.userName ?? e.userId, employeeType: e.userType });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, schedule]);

  const totalEmployees = schedule ? new Set(schedule.entries.map(e => e.userId)).size : 0;
  const workingDays    = schedule ? schedule.entries.filter(e => !e.isOff && !e.isLeave && e.shift).length : 0;
  const leaveDays      = schedule ? schedule.entries.filter(e => e.isLeave).length : 0;

  // ── Auth loading ───────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isPic1) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only PIC can manage store schedules.</p>
    </div>
  );

  return (
    <div className="min-h-full bg-slate-50">
      {/* ── Header ── */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto px-6 py-4 lg:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">PIC Panel</p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Manage Schedule</h1>
              {schedule && (
                <p className="mt-1 text-sm text-slate-500">
                  {totalEmployees} staff · {workingDays} work shifts · {leaveDays} leave days
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex h-10 items-center rounded-xl border border-slate-200 bg-white">
                <button onClick={() => goToMonth(-1)} className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="whitespace-nowrap px-2 text-sm font-bold text-slate-700">{MONTHS[m - 1]} {y}</span>
                <button onClick={() => goToMonth(1)} className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => loadSchedule(selectedMonth)}
                disabled={loading}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </button>

              <ImportButton onImported={() => loadSchedule(selectedMonth)} />

              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={downloading}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Template
              </button>

              {schedule ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create Schedule
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mx-auto space-y-5 px-6 py-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-indigo-400" /></div>
        ) : !schedule ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
              <Calendar className="h-8 w-8 text-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No schedule for {formatYearMonth(selectedMonth)}</p>
              <p className="mt-1 text-xs text-slate-400">Import an Excel file, or create an empty schedule to start filling it in.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Staff',       value: totalEmployees, color: '#6366f1' },
                { label: 'Work shifts', value: workingDays,    color: '#10b981' },
                { label: 'Leave days',  value: leaveDays,      color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                  <p className="text-2xl font-black" style={{ color }}>{value}</p>
                  <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
              {shiftOptions.map(s => {
                const pal = SHIFT_PALETTE[s.code] ?? { dot: '#94a3b8' };
                return (
                  <div key={s.code} className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                    <span className="h-2 w-2 rounded-full" style={{ background: pal.dot }} />
                    {s.label}
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: SHIFT_PALETTE.leave.dot }} />
                Leave
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: SHIFT_PALETTE.off.dot }} />
                Off
              </div>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <Users className="h-3 w-3" /> Click a cell to set or edit a shift
              </span>
            </div>

            {/* Schedule grid */}
            {rosterEmployees.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
                <p className="text-sm font-semibold text-slate-600">No employees found for this store.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="sticky left-0 z-10 min-w-[180px] border-r border-slate-100 bg-white px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Employee
                      </th>
                      {days.map(d => (
                        <th
                          key={d}
                          className={cn(
                            'min-w-[34px] px-1 py-2.5 text-center text-[10px] font-bold',
                            d === todayDay ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400',
                          )}
                        >
                          <div>{d}</div>
                          <div className="font-normal opacity-60">{dayOfWeekLabel(selectedMonth, d)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rosterEmployees.map(emp => (
                      <tr key={emp.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40">
                        <td className="sticky left-0 z-10 border-r border-slate-100 bg-white px-3 py-1.5">
                          <p className="truncate font-semibold text-slate-800">{emp.name}</p>
                          <p className="text-[10px] text-slate-400">{EMP_LABEL[emp.employeeType ?? ''] ?? emp.employeeType ?? '—'}</p>
                        </td>
                        {days.map(d => {
                          const entry = entryMap.get(`${emp.id}|${d}`);
                          const pal = cellPalette(entry);
                          return (
                            <td key={d} className={cn('p-0.5 text-center', d === todayDay && 'bg-indigo-50/40')}>
                              <button
                                type="button"
                                onClick={() => setActiveCell({ employee: emp, day: d, entry: entry ?? null })}
                                className={cn(
                                  'mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[9px] font-bold transition-transform hover:scale-110',
                                  !pal && 'border border-dashed border-slate-200 text-slate-300 hover:border-indigo-300 hover:text-indigo-400',
                                )}
                                style={pal ? { background: pal.bg, color: pal.text, border: `1px solid ${pal.border}` } : undefined}
                                title={pal ? pal.label : 'Set shift'}
                              >
                                {pal ? pal.label : ''}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {schedule.note && <p className="px-1 text-[11px] italic text-slate-400">Note: {schedule.note}</p>}
          </>
        )}
      </div>

      <SetDayDialog
        key={activeCell ? `${activeCell.employee.id}-${activeCell.day}` : 'none'}
        cell={activeCell}
        yearMonth={selectedMonth}
        shiftOptions={shiftOptions}
        onSave={handleSaveCell}
        onClose={() => setActiveCell(null)}
        saving={savingCell}
      />

      <AlertDialog open={showCreateConfirm} onOpenChange={setShowCreateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Create an empty schedule for {formatYearMonth(selectedMonth)}? You can
              then click a cell to assign each day.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmCreate()}>
              Create
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
