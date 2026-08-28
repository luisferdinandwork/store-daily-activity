'use client';
// app/ops/schedules/page.tsx
//
// Design: original full-screen layout (top store-picker card, inline import,
//         stats row, large calendar grid, single right-side slide-over panel).
// Logic:  dynamic shifts loaded from /api/ops/schedules/shifts — no hardcoded
//         morning/evening/full_day. All shift codes come from the API.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Globe2,
  Loader2,
  MapPin,
  Plus,
  Shield,
  Store as StoreIcon,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { paletteOf } from '@/lib/shift-tasks';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ─── Types ────────────────────────────────────────────────────────────────────

type ShiftCode = string;

interface ShiftOption {
  id: number;
  code: string;
  label: string;
  description: string | null;
  startTime: string | null;
  endTime: string | null;
  accent: string | null;
  icon: string | null;
  isActive: boolean;
  sortOrder: number;
}

interface DayEntry {
  id: string;
  userId: string;
  userName: string | null;
  userType: string | null;
  date: string;
  shiftId: number | null;
  shift: ShiftCode | null;
  shiftCode?: ShiftCode | null;
  shiftLabel?: string | null;
  isOff: boolean;
  isLeave: boolean;
}

interface MonthlySchedule {
  id: string;
  storeId: string;
  yearMonth: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  entries: DayEntry[];
}

interface EmployeeOption {
  id: string;
  nik?: string | null;
  name: string;
  employeeType: string | null;
}

interface StoreOption {
  id: string;
  storeNo: string;
  name: string;
  address: string | null;
  areaId?: number | null;
  areaName?: string | null;
}

interface AreaInfo {
  id: number;
  name: string;
}

interface StoresPayload {
  success: boolean;
  isHO: boolean;
  area: AreaInfo | null;
  areas: AreaInfo[];
  stores: StoreOption[];
  error?: string;
}

interface ImportResult {
  success: boolean;
  schedulesCreated: number;
  entriesCreated: number;
  skipped: number;
  errors: string[];
  notFound: string[];
  month?: string;
  sheet?: string;
  sections?: string[];
  dateErrors?: string[];
}

type PanelView = 'detail' | 'add' | 'edit';
type ShiftMode = string; // any shift code, 'off', or 'leave'

type ShiftVisual = {
  label: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS_HEADER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const EMP_LABEL: Record<string, string> = { pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO', sa: 'SA' };
const STORAGE_KEY_LAST_STORE = 'ops:lastSelectedStoreId';
const RESERVED_MODES = new Set(['off', 'leave']);

const STATUS_VISUAL: Record<'off' | 'leave', ShiftVisual> = {
  leave: { label: 'AL', bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#818cf8' },
  off:   { label: '',   bg: 'transparent', border: 'transparent', text: '#cbd5e1', dot: '#e2e8f0' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toLocalDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildCalendarGrid(yearMonth: string): (Date | null)[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const first  = new Date(y, m - 1, 1);
  const days   = new Date(y, m, 0).getDate();
  const grid: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) grid.push(null);
  for (let d = 1; d <= days; d++) grid.push(new Date(y, m - 1, d));
  while (grid.length % 7 !== 0) grid.push(null);
  return grid;
}

function formatTime(v: string | null | undefined): string {
  if (!v) return '';
  return v.slice(0, 5);
}

function shiftInitial(code: string, label?: string | null): string {
  if (code === 'full_day') return 'FD';
  const source = label || code;
  return source.split(/[\s_-]+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase();
}

function parseApiError(json: unknown, fallback: string): string {
  if (json && typeof json === 'object' && 'error' in json) {
    const e = (json as { error?: unknown }).error;
    if (typeof e === 'string' && e.trim()) return e;
  }
  return fallback;
}

function safeShiftMode(value: string | null | undefined, shifts: ShiftOption[]): ShiftMode {
  if (!value) return 'off';
  if (RESERVED_MODES.has(value)) return value;
  if (shifts.some(s => s.code === value)) return value;
  return 'off';
}

function getEmployeeTypeLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return EMP_LABEL[code] ?? code;
}

// ─── Shift visual resolution ──────────────────────────────────────────────────
// Colors are sourced directly from the shift's `accent` field (a PaletteKey
// stored in the DB). paletteOf() resolves any unknown accent to 'slate' so
// every shift always has a valid visual even if the DB value is null.

function getShiftVisual(
  code: string | null,
  shifts: ShiftOption[],
  isOff = false,
  isLeave = false,
): ShiftVisual {
  if (isLeave) return STATUS_VISUAL.leave;
  if (isOff || !code) return STATUS_VISUAL.off;
  const shift = shifts.find(s => s.code === code);
  const palette = paletteOf(shift?.accent);
  return {
    bg:     palette.bg,
    border: palette.border,
    text:   palette.text,
    dot:    palette.dot,
    label:  shiftInitial(code, shift?.label),
  };
}

function getShiftDisplayName(code: string | null, shifts: ShiftOption[]): string {
  if (!code) return '—';
  return shifts.find(s => s.code === code)?.label ?? code.replaceAll('_', ' ');
}

function getShiftHours(code: string | null, shifts: ShiftOption[]): string {
  if (!code) return '';
  const s = shifts.find(i => i.code === code);
  if (!s) return '';
  const start = formatTime(s.startTime);
  const end   = formatTime(s.endTime);
  if (!start && !end) return '';
  return `${start || '—'}–${end || '—'}`;
}

// ─── ShiftModePicker ──────────────────────────────────────────────────────────

function ShiftModePicker({ value, shifts, onChange }: {
  value: ShiftMode;
  shifts: ShiftOption[];
  onChange: (v: ShiftMode) => void;
}) {
  const options = [
    ...shifts.map(s => ({
      key: s.code,
      label: s.label,
      sub: [formatTime(s.startTime), formatTime(s.endTime)].filter(Boolean).join(' – '),
      visual: getShiftVisual(s.code, shifts),
    })),
    { key: 'off',   label: 'Day Off', sub: 'No work today',   visual: STATUS_VISUAL.off },
    { key: 'leave', label: 'Leave',   sub: 'AL / CU / Sick',  visual: STATUS_VISUAL.leave },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map(opt => {
        const active = value === opt.key;
        const accent = opt.key === 'off' ? '#64748b' : opt.visual.text;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            className="relative flex flex-col items-start gap-1.5 rounded-2xl border-2 px-3 py-3 text-left transition-all"
            style={{
              borderColor: active ? accent : '#e2e8f0',
              background:  active ? opt.visual.bg : '#f8fafc',
              boxShadow:   active ? `0 0 0 3px ${accent}20` : 'none',
            }}
          >
            <span
              className="flex h-8 min-w-8 items-center justify-center rounded-xl px-2 text-xs font-black"
              style={{
                background: active ? `${opt.visual.dot}30` : '#e2e8f0',
                color:      active ? opt.visual.text : '#64748b',
              }}
            >
              {opt.visual.label || '—'}
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold" style={{ color: active ? opt.visual.text : '#334155' }}>
                {opt.label}
              </p>
              <p className="truncate text-[9px] text-slate-400">{opt.sub || 'Flexible'}</p>
            </div>
            {active && (
              <span
                className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full"
                style={{ background: accent }}
              >
                <CheckCircle2 className="h-3 w-3 text-white" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Panel views ──────────────────────────────────────────────────────────────

function DetailView({ entries, shifts, onEdit, onAdd }: {
  entries: DayEntry[];
  shifts: ShiftOption[];
  onEdit: (e: DayEntry) => void;
  onAdd: () => void;
}) {
  const working = entries.filter(e => !e.isOff && !e.isLeave && e.shift);
  const leave   = entries.filter(e => e.isLeave);
  const off     = entries.filter(e => e.isOff && !e.isLeave);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <button
        type="button"
        onClick={onAdd}
        className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50 py-2.5 text-xs font-bold text-indigo-600 transition hover:bg-indigo-100"
      >
        <Plus className="h-3.5 w-3.5" />Add employee
      </button>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <Calendar className="h-8 w-8 text-slate-200" />
          <p className="text-sm text-slate-400">No employees scheduled on this day.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {working.length > 0 && (
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Working</p>
              <div className="space-y-2">
                {working.map(entry => {
                  const visual = getShiftVisual(entry.shift, shifts, entry.isOff, entry.isLeave);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => onEdit(entry)}
                      className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:shadow-sm"
                      style={{ borderColor: visual.border, background: visual.bg }}
                    >
                      <div
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold"
                        style={{ background: `${visual.dot}30`, color: visual.text }}
                      >
                        {visual.label}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{entry.userName}</p>
                        <p className="text-[11px] text-slate-400">
                          {getEmployeeTypeLabel(entry.userType)} · {getShiftHours(entry.shift, shifts)}
                        </p>
                      </div>
                      <div
                        className="rounded-lg px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: `${visual.dot}20`, color: visual.text }}
                      >
                        {getShiftDisplayName(entry.shift, shifts)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {leave.length > 0 && (
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">On Leave</p>
              <div className="space-y-2">
                {leave.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onEdit(entry)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-left transition hover:shadow-sm"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-extrabold text-indigo-600">AL</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-800">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{getEmployeeTypeLabel(entry.userType)}</p>
                    </div>
                    <span className="rounded-lg bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">Leave</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {off.length > 0 && (
            <div>
              <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Day Off</p>
              <div className="space-y-2">
                {off.map(entry => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => onEdit(entry)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left transition hover:shadow-sm"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-400">—</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-500">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{getEmployeeTypeLabel(entry.userType)}</p>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">Off</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddView({ entries, employees, shifts, saving, onSave, onCancel }: {
  entries: DayEntry[];
  employees: EmployeeOption[];
  shifts: ShiftOption[];
  saving: boolean;
  onSave: (p: { userId: string; shift: string | null; isOff: boolean; isLeave: boolean }) => void;
  onCancel: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [mode, setMode] = useState<ShiftMode>(shifts[0]?.code ?? 'off');

  // Reset mode if shifts change and current mode is no longer valid
  useEffect(() => {
    if (!RESERVED_MODES.has(mode) && !shifts.some(s => s.code === mode)) {
      setMode(shifts[0]?.code ?? 'off');
    }
  }, [mode, shifts]);

  const existing  = useMemo(() => new Set(entries.map(e => e.userId)), [entries]);
  const available = useMemo(() => employees.filter(e => !existing.has(e.id)), [employees, existing]);

  function handleSubmit() {
    if (!selectedUserId) { toast.error('Please select an employee'); return; }
    onSave({
      userId:  selectedUserId,
      shift:   RESERVED_MODES.has(mode) ? null : mode,
      isOff:   mode === 'off',
      isLeave: mode === 'leave',
    });
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Employee</p>
        {available.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-6 text-center">
            <p className="text-xs text-slate-400">All employees already assigned to this day.</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {available.map(emp => {
              const active = selectedUserId === emp.id;
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => setSelectedUserId(emp.id)}
                  className="flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all"
                  style={{ borderColor: active ? '#6366f1' : '#e2e8f0', background: active ? '#eef2ff' : '#f8fafc' }}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                    style={{ background: active ? '#6366f1' : '#e2e8f0', color: active ? 'white' : '#64748b' }}
                  >
                    {emp.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{emp.name}</p>
                    <p className="text-[10px] text-slate-400">{getEmployeeTypeLabel(emp.employeeType)}</p>
                  </div>
                  {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-500" />}
                </button>
              );
            })}
          </div>
        )}

        <p className="mb-2 mt-5 text-[10px] font-bold uppercase tracking-widest text-slate-400">Shift</p>
        <ShiftModePicker value={mode} shifts={shifts} onChange={setMode} />
      </div>

      <div className="flex gap-2.5 border-t border-slate-100 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !selectedUserId || available.length === 0}
          className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : 'Add to Schedule'}
        </button>
      </div>
    </>
  );
}

function EditView({ entry, shifts, saving, onSave, onCancel }: {
  entry: DayEntry;
  shifts: ShiftOption[];
  saving: boolean;
  onSave: (p: { shift: string | null; isOff: boolean; isLeave: boolean }) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<ShiftMode>(() => {
    if (entry.isLeave) return 'leave';
    if (entry.isOff || !entry.shift) return 'off';
    return safeShiftMode(entry.shift, shifts);
  });

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Shift</p>
        <ShiftModePicker value={mode} shifts={shifts} onChange={setMode} />
      </div>

      <div className="flex gap-2.5 border-t border-slate-100 px-5 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave({
            shift:   RESERVED_MODES.has(mode) ? null : mode,
            isOff:   mode === 'off',
            isLeave: mode === 'leave',
          })}
          disabled={saving}
          className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
        >
          {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Changes'}
        </button>
      </div>
    </>
  );
}

// ─── SchedulePanel ────────────────────────────────────────────────────────────

function SchedulePanel({
  date, view, entries, editEntry, employees, shifts, saving,
  onClose, onBack, onAdd, onEdit, onSaveNew, onSaveEdit,
}: {
  date: Date;
  view: PanelView;
  entries: DayEntry[];
  editEntry: DayEntry | null;
  employees: EmployeeOption[];
  shifts: ShiftOption[];
  saving: boolean;
  onClose: () => void;
  onBack: () => void;
  onAdd: () => void;
  onEdit: (e: DayEntry) => void;
  onSaveNew: (p: { userId: string; shift: string | null; isOff: boolean; isLeave: boolean }) => void;
  onSaveEdit: (p: { shift: string | null; isOff: boolean; isLeave: boolean }) => void;
}) {
  const fullLabel  = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const shortLabel = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });

  const eyebrow = view === 'detail' ? 'Schedule' : view === 'add' ? 'Add Employee' : 'Edit Shift';
  const title   = view === 'edit' && editEntry ? (editEntry.userName ?? '—') : view === 'detail' ? fullLabel : shortLabel;

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
            <div className="flex min-w-0 items-start gap-2.5">
              {view !== 'detail' && (
                <button
                  type="button"
                  onClick={onBack}
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200"
                  aria-label="Back"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{eyebrow}</p>
                <p className="mt-0.5 truncate text-lg font-bold text-slate-900">{title}</p>
                {view === 'edit' && editEntry && <p className="truncate text-sm text-slate-500">{shortLabel}</p>}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body — keyed so each view swap gets a fade while panel stays put */}
        <div
          key={`${view}:${editEntry?.id ?? ''}`}
          className="flex min-h-0 flex-1 flex-col"
          style={{ animation: 'panelFade 0.2s ease-out' }}
        >
          {view === 'detail' && (
            <DetailView entries={entries} shifts={shifts} onEdit={onEdit} onAdd={onAdd} />
          )}
          {view === 'add' && (
            <AddView entries={entries} employees={employees} shifts={shifts} saving={saving} onSave={onSaveNew} onCancel={onBack} />
          )}
          {view === 'edit' && editEntry && (
            <EditView entry={editEntry} shifts={shifts} saving={saving} onSave={onSaveEdit} onCancel={onBack} />
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

// ─── ImportButton ─────────────────────────────────────────────────────────────

function ImportButton({ storeId, storeName, onImported }: {
  storeId: string;
  storeName: string;
  onImported: () => void;
}) {
  const inputRef                    = useRef<HTMLInputElement>(null);
  const [importing,  setImporting]  = useState(false);
  const [result,     setResult]     = useState<ImportResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImporting(true); setResult(null); setShowErrors(false);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('storeId', storeId);
      const res  = await fetch('/api/ops/schedules/import', { method: 'POST', body: form });
      const json = await res.json();
      const norm: ImportResult = {
        success: json.success ?? false,
        schedulesCreated: json.schedulesCreated ?? 0,
        entriesCreated: json.entriesCreated ?? 0,
        skipped: json.skipped ?? 0,
        errors: json.errors ?? (json.error ? [json.error] : []),
        notFound: json.notFound ?? [],
        month: json.month,
        sheet: json.sheet,
        sections: json.sections,
        dateErrors: json.dateErrors,
      };
      setResult(norm);
      if (norm.dateErrors?.length) { setShowErrors(true); toast.error('Excel has wrong dates — please fix and re-upload'); return; }
      if (norm.schedulesCreated > 0 && !norm.errors.length && !norm.notFound.length) { toast.success(`Imported ${norm.entriesCreated} entries to ${storeName}`); onImported(); }
      else if (norm.schedulesCreated > 0) { toast.warning('Imported with warnings'); setShowErrors(true); onImported(); }
      else if (!norm.success) { toast.error(norm.errors[0] ?? 'Import failed'); setShowErrors(true); }
      else { toast.info('No new data imported'); }
    } catch (err) {
      setResult({ success: false, schedulesCreated: 0, entriesCreated: 0, skipped: 0, errors: [String(err)], notFound: [] });
      setShowErrors(true); toast.error('Network error');
    } finally { setImporting(false); }
  }

  const hasDateErrors = (result?.dateErrors?.length ?? 0) > 0;
  const hasErrors     = (result?.errors.length ?? 0) > 0;
  const hasNotFound   = (result?.notFound.length ?? 0) > 0;
  const hasWarnings   = hasDateErrors || hasErrors || hasNotFound;
  const isFullSuccess = result?.success && !hasWarnings;
  const isHardFail    = result && !result.success && (hasDateErrors || result.schedulesCreated === 0);

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => { setResult(null); setShowErrors(false); inputRef.current?.click(); }}
        disabled={importing}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all"
        style={{ borderColor: importing ? '#e2e8f0' : '#a5b4fc', background: importing ? '#f8fafc' : '#eef2ff', color: importing ? '#94a3b8' : '#4f46e5' }}
      >
        {importing
          ? <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
          : <><Upload className="h-4 w-4" />Import schedule for {storeName}</>}
      </button>

      {result && (
        <div className={cn('overflow-hidden rounded-xl border text-sm', isFullSuccess ? 'border-emerald-200 bg-emerald-50' : isHardFail ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
          <div className="flex items-center gap-3 px-4 py-3">
            {isFullSuccess
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              : <AlertCircle className={cn('h-4 w-4 shrink-0', isHardFail ? 'text-red-500' : 'text-amber-500')} />}
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm font-bold', isFullSuccess ? 'text-emerald-800' : isHardFail ? 'text-red-800' : 'text-amber-800')}>
                {isFullSuccess ? 'Import successful' : hasDateErrors ? 'Wrong dates in Excel' : isHardFail ? 'Import failed' : 'Imported with warnings'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {result.entriesCreated} entries · {result.schedulesCreated} store(s){result.month && ` · ${formatYearMonth(result.month)}`}
              </p>
            </div>
            {hasWarnings && (
              <button
                type="button"
                onClick={() => setShowErrors(v => !v)}
                className={cn('flex items-center gap-0.5 text-[11px] font-semibold', isHardFail ? 'text-red-700' : 'text-amber-700')}
              >
                Details {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button type="button" onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {hasWarnings && showErrors && (
            <div className={cn('space-y-3 border-t bg-white/70 px-4 py-3', isHardFail ? 'border-red-200' : 'border-amber-200')}>
              {hasDateErrors && (
                <div>
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-red-700">Wrong dates — please fix your Excel file</p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto">
                    {result.dateErrors!.map((e, i) => <li key={i} className="text-[11px] leading-relaxed text-red-700">• {e}</li>)}
                  </ul>
                </div>
              )}
              {hasNotFound && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-700">Employees not found in system</p>
                  <div className="flex flex-wrap gap-1">
                    {result.notFound.map(n => <span key={n} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{n}</span>)}
                  </div>
                </div>
              )}
              {hasErrors && (
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-red-700">Errors</p>
                  <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                    {result.errors.map((e, i) => <li key={i} className="break-all font-mono text-[11px] text-red-700">{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {!result && !importing && (
        <p className="flex items-center gap-1.5 px-1 text-[10px] text-slate-400">
          <FileSpreadsheet className="h-3 w-3 shrink-0" />
          Shift codes are loaded dynamically from OPS Shift settings.
        </p>
      )}
    </div>
  );
}

// ─── CalendarGrid ─────────────────────────────────────────────────────────────

function CalendarGrid({ schedule, yearMonth, shifts, onDayPress }: {
  schedule: MonthlySchedule;
  yearMonth: string;
  shifts: ShiftOption[];
  onDayPress: (date: Date) => void;
}) {
  const grid = buildCalendarGrid(yearMonth);
  const [today, setToday] = useState(() => isoDate(new Date()));

  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const t = setTimeout(() => {
      setToday(isoDate(new Date()));
      const daily = setInterval(() => setToday(isoDate(new Date())), 86_400_000);
      return () => clearInterval(daily);
    }, nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(t);
  }, []);

  const entriesByDate = useMemo(() => {
    const map = new Map<string, DayEntry[]>();
    for (const entry of schedule.entries) {
      const key = toLocalDateKey(entry.date);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return map;
  }, [schedule.entries]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
        {DAYS_HEADER.map((d, i) => (
          <div
            key={d}
            className="py-3 text-center text-xs font-bold uppercase tracking-wide"
            style={{ color: i === 0 || i === 6 ? '#fca5a5' : '#94a3b8' }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {grid.map((date, idx) => {
          if (!date) {
            return (
              <div
                key={`pad-${idx}`}
                className="min-h-[110px] border-b border-r border-slate-50 bg-slate-50/30 last:border-r-0"
              />
            );
          }

          const ds          = isoDate(date);
          const entries     = entriesByDate.get(ds) ?? [];
          const dow         = date.getDay();
          const isWkd       = dow === 0 || dow === 6;
          const isTod       = ds === today;
          const isLastInRow = (idx + 1) % 7 === 0;

          const working = entries.filter(e => !e.isOff && !e.isLeave && e.shift);
          const leave   = entries.filter(e => e.isLeave);
          const preview = working.slice(0, 3);
          const overflow = entries.length - preview.length - Math.min(leave.length, 1);

          return (
            <button
              key={ds}
              type="button"
              onClick={() => onDayPress(date)}
              className={cn(
                'group relative flex min-h-[110px] flex-col gap-1 p-2 text-left transition-colors hover:bg-indigo-50/40',
                'border-b border-slate-100',
                !isLastInRow && 'border-r',
              )}
              style={{ background: isTod ? '#eef2ff' : isWkd ? '#fafafa' : 'white' }}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold',
                    isTod ? 'bg-indigo-500 text-white' : '',
                  )}
                  style={{ color: isTod ? undefined : isWkd ? '#fca5a5' : '#334155' }}
                >
                  {date.getDate()}
                </span>
                {entries.length > 0 && (
                  <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-bold text-slate-500">
                    {entries.length}
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-0.5">
                {preview.map(e => {
                  const visual = getShiftVisual(e.shift, shifts);
                  return (
                    <div
                      key={e.id}
                      className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold truncate"
                      style={{ background: visual.bg, color: visual.text }}
                    >
                      <span
                        className="flex h-3.5 min-w-4 shrink-0 items-center justify-center rounded text-[8px] font-black"
                        style={{ background: `${visual.dot}30` }}
                      >
                        {visual.label}
                      </span>
                      <span className="truncate">{e.userName}</span>
                    </div>
                  );
                })}
                {leave.slice(0, 1).map(e => (
                  <div
                    key={e.id}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold truncate"
                    style={{ background: STATUS_VISUAL.leave.bg, color: STATUS_VISUAL.leave.text }}
                  >
                    <Calendar className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{e.userName}</span>
                  </div>
                ))}
                {overflow > 0 && (
                  <p className="px-1 text-[9px] text-slate-400">+{overflow} more</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── StorePickerCombobox ────────────────────────────────────────────────────
//
// Searchable in place of a plain <select> — Ops can type a store's name OR
// its store code (storeNo) to filter, instead of scrolling a long list.

function StorePickerCombobox({ stores, storesByArea, selectedStore, currentStore, onSelect }: {
  stores: StoreOption[];
  storesByArea: { areaId: number | null | undefined; areaName: string; list: StoreOption[] }[];
  selectedStore: string | null;
  currentStore: StoreOption | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const grouped = storesByArea.length > 1;

  const renderItem = (s: StoreOption) => (
    <CommandItem
      key={s.id}
      value={`${s.name} ${s.storeNo}`}
      onSelect={() => { onSelect(s.id); setOpen(false); }}
      className="gap-2"
    >
      <StoreIcon className="h-3.5 w-3.5 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{s.name}</p>
        <p className="truncate text-[10px] text-slate-400">
          {s.storeNo}{s.address ? ` · ${s.address}` : ''}
        </p>
      </div>
      {selectedStore === s.id && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
    </CommandItem>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-11 w-full justify-between gap-2 rounded-xl border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:border-indigo-300 hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-100"
        >
          <span className="flex min-w-0 items-center gap-2">
            <StoreIcon className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="truncate">{currentStore ? currentStore.name : 'Select a store…'}</span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search store name or code…" />
          <CommandList>
            <CommandEmpty>No stores found.</CommandEmpty>
            {grouped ? (
              storesByArea.map((group) => (
                <CommandGroup key={group.areaName} heading={group.areaName}>
                  {group.list.map(renderItem)}
                </CommandGroup>
              ))
            ) : (
              <CommandGroup>{stores.map(renderItem)}</CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsSchedulesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user  = session?.user as any;
  const role  = user?.role as string | undefined;
  const empType = (user?.employeeType ?? user?.employeeTypeCode) as string | undefined;
  const isOps = role === 'ops' || role === 'it' || empType === 'ops_area' || empType === 'ops_ho';

  // ── Data state ──────────────────────────────────────────────────────────────
  const [isHO,          setIsHO]          = useState(false);
  const [stores,        setStores]        = useState<StoreOption[]>([]);
  const [area,          setArea]          = useState<AreaInfo | null>(null);
  const [areas,         setAreas]         = useState<AreaInfo[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [shifts,        setShifts]        = useState<ShiftOption[]>([]);
  const [employees,     setEmployees]     = useState<EmployeeOption[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [templating,    setTemplating]    = useState(false);

  // ── Panel state ─────────────────────────────────────────────────────────────
  const [panelDate,      setPanelDate]      = useState<Date | null>(null);
  const [panelView,      setPanelView]      = useState<PanelView>('detail');
  const [panelEditEntry, setPanelEditEntry] = useState<DayEntry | null>(null);
  const [panelSaving,    setPanelSaving]    = useState(false);

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session)  { router.replace('/login'); return; }
    if (!isOps)    router.replace('/');
  }, [authStatus, session, isOps, router]);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const currentStore = useMemo(() => stores.find(s => s.id === selectedStore) ?? null, [stores, selectedStore]);
  const currentStoreName = currentStore?.name ?? '—';
  const currentStoreArea = currentStore?.areaName ?? null;

  const storesByArea = useMemo(() => {
    const map = new Map<string, { areaId: number | null | undefined; areaName: string; list: StoreOption[] }>();
    for (const s of stores) {
      const key = s.areaName ?? '—';
      if (!map.has(key)) map.set(key, { areaId: s.areaId, areaName: key, list: [] });
      map.get(key)!.list.push(s);
    }
    return [...map.values()].sort((a, b) => a.areaName.localeCompare(b.areaName));
  }, [stores]);

  const panelEntries = useMemo(() => {
    if (!panelDate || !schedule) return [];
    const key = isoDate(panelDate);
    return schedule.entries
      .filter(e => toLocalDateKey(e.date) === key)
      .sort((a, b) => {
        const ai = shifts.findIndex(s => s.code === a.shift);
        const bi = shifts.findIndex(s => s.code === b.shift);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });
  }, [panelDate, schedule, shifts]);

  // Stats derived from schedule entries
  const totalEmployees = schedule ? new Set(schedule.entries.map(e => e.userId)).size : 0;
  const workingShifts  = schedule ? schedule.entries.filter(e => !e.isOff && !e.isLeave && e.shift).length : 0;
  const leaveDays      = schedule ? schedule.entries.filter(e => e.isLeave).length : 0;
  const offDays        = schedule ? schedule.entries.filter(e => e.isOff && !e.isLeave).length : 0;

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    try {
      const res  = await fetch('/api/ops/schedules/stores');
      const json = (await res.json()) as StoresPayload;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Failed to load stores');
      setIsHO(!!json.isHO);
      setStores(json.stores ?? []);
      setArea(json.area ?? null);
      setAreas(json.areas ?? (json.area ? [json.area] : []));
      const remembered = typeof window !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY_LAST_STORE) : null;
      const valid = remembered && (json.stores ?? []).some(s => s.id === remembered);
      setSelectedStore(valid ? remembered : (json.stores?.[0]?.id ?? null));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load stores');
    } finally { setStoresLoading(false); }
  }, []);

  const loadShifts = useCallback(async () => {
    try {
      const res  = await fetch('/api/ops/schedules/shifts');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Failed to load shifts'));
      setShifts(json.shifts ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load shifts');
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    if (!selectedStore) { setSchedule(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ storeId: selectedStore, yearMonth: selectedMonth });
      const res  = await fetch(`/api/ops/schedules/monthly?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Failed to load schedule'));
      setSchedule(json.schedule ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load schedule');
      setSchedule(null);
    } finally { setLoading(false); }
  }, [selectedStore, selectedMonth]);

  const loadEmployees = useCallback(async () => {
    if (!selectedStore) { setEmployees([]); return; }
    try {
      const res  = await fetch(`/api/ops/schedules/employees?storeId=${encodeURIComponent(selectedStore)}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Failed to load employees'));
      setEmployees(json.employees ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employees');
    }
  }, [selectedStore]);

  useEffect(() => { if (isOps) { loadStores(); loadShifts(); } }, [isOps, loadStores, loadShifts]);

  useEffect(() => {
    if (!selectedStore) return;
    sessionStorage.setItem(STORAGE_KEY_LAST_STORE, selectedStore);
    loadSchedule();
    loadEmployees();
  }, [selectedStore, selectedMonth, loadSchedule, loadEmployees]);

  // ── Actions ──────────────────────────────────────────────────────────────────
  function handleCreate() {
    if (!selectedStore || schedule) return;
    setShowCreateConfirm(true);
  }

  async function confirmCreate() {
    setShowCreateConfirm(false);
    if (!selectedStore || schedule) return;
    setCreating(true);
    try {
      const res  = await fetch('/api/ops/schedules/monthly', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storeId: selectedStore, yearMonth: selectedMonth }) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Create failed'));
      toast.success('Empty schedule created — click days to assign shifts');
      loadSchedule();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Create failed'); }
    finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!selectedStore || !schedule) return;
    if (!confirm(`Delete the ${formatYearMonth(selectedMonth)} schedule for ${currentStoreName}? Attended days are preserved.`)) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ storeId: selectedStore, yearMonth: selectedMonth });
      const res  = await fetch(`/api/ops/schedules/monthly?${params}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Delete failed'));
      toast.success(json.lockedCount > 0 ? `Cleared — ${json.lockedCount} attended day(s) preserved` : 'Schedule deleted');
      closePanel(); setSchedule(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Delete failed'); }
    finally { setDeleting(false); }
  }

  async function handleExport() {
    if (!selectedStore || !schedule) return;
    setExporting(true);
    try {
      const url = `/api/ops/schedules/export?storeId=${selectedStore}&yearMonth=${selectedMonth}`;
      const res = await fetch(url);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(parseApiError(j, `HTTP ${res.status}`)); }
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? `schedule_${selectedMonth}.xlsx`;
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success(`Downloaded ${filename}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  }

  async function handleDownloadTemplate() {
    if (!selectedStore) return;
    setTemplating(true);
    try {
      const url = `/api/pic/schedule/template?storeId=${selectedStore}&yearMonth=${selectedMonth}`;
      const res = await fetch(url);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(parseApiError(j, `HTTP ${res.status}`)); }
      const blob    = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const filename = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] ?? `schedule_template_${selectedMonth}.xlsx`;
      a.href = blobUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      toast.success(`Downloaded ${filename}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Template download failed'); }
    finally { setTemplating(false); }
  }

  async function handleSaveNewEntry(payload: { userId: string; shift: string | null; isOff: boolean; isLeave: boolean }) {
    if (!panelDate || !selectedStore) return;
    setPanelSaving(true);
    try {
      const res  = await fetch('/api/ops/schedules/entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, storeId: selectedStore, date: isoDate(panelDate) }) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Add failed'));
      toast.success('Employee added');
      await loadSchedule();
      panelBack();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Add failed'); }
    finally { setPanelSaving(false); }
  }

  async function handleSaveEntry(payload: { shift: string | null; isOff: boolean; isLeave: boolean }) {
    if (!panelEditEntry) return;
    setPanelSaving(true);
    try {
      const res  = await fetch(`/api/ops/schedules/entry/${panelEditEntry.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(parseApiError(json, 'Update failed'));
      toast.success('Day updated');
      await loadSchedule();
      panelBack();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed'); }
    finally { setPanelSaving(false); }
  }

  // ── Panel helpers ────────────────────────────────────────────────────────────
  function closePanel()              { setPanelDate(null); setPanelView('detail'); setPanelEditEntry(null); }
  function panelBack()               { setPanelView('detail'); setPanelEditEntry(null); }
  function handleDayPress(d: Date)   { setPanelDate(d); setPanelView('detail'); setPanelEditEntry(null); }
  function handleMonthChange(ym: string) { setSelectedMonth(ym); closePanel(); }

  // ── Guards ───────────────────────────────────────────────────────────────────
  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-full items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );
  if (!isOps) return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 bg-slate-50 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50"><Shield className="h-8 w-8 text-red-500" /></div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only OPS users can manage area schedules.</p>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope={isHO ? 'OPS · Head Office' : 'OPS · Area Schedules'}
        title="Schedule Manager"
        subtitle={
          isHO
            ? `${areas.length} area${areas.length !== 1 ? 's' : ''} · ${stores.length} store${stores.length !== 1 ? 's' : ''}`
            : area
              ? `${area.name} · ${stores.length} store${stores.length !== 1 ? 's' : ''}`
              : undefined
        }
        periodProps={{
          period: 'monthly',
          date: `${selectedMonth}-01`,
          onDateChange: (dateKey) => handleMonthChange(dateKey.slice(0, 7)),
        }}
        onRefresh={selectedStore ? () => { loadSchedule(); loadShifts(); } : undefined}
        refreshing={loading}
        actions={
          selectedStore ? (
            <>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={templating}
                className="flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              >
                {templating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Template
              </button>
              {!schedule && (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create empty
                </button>
              )}
              {schedule && (
                <>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exporting}
                    className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Export
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete schedule
                  </button>
                </>
              )}
            </>
          ) : null
        }
      />

      <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">

        {/* ── Store picker ── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[280px]">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Store {isHO && <span className="text-amber-600">· all areas</span>}
              </label>
              {storesLoading ? (
                <div className="h-11 w-full animate-pulse rounded-xl bg-slate-100" />
              ) : stores.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {isHO ? 'No stores in the system yet.' : 'No stores in your area. Contact an admin.'}
                </div>
              ) : (
                <StorePickerCombobox
                  stores={stores}
                  storesByArea={storesByArea}
                  selectedStore={selectedStore}
                  currentStore={currentStore}
                  onSelect={setSelectedStore}
                />
              )}
            </div>
          </div>

          {selectedStore && currentStore && (
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              {isHO && currentStoreArea && (
                <span className="flex items-center gap-1.5">
                  <Globe2 className="h-3 w-3" />
                  <span className="font-semibold text-slate-700">{currentStoreArea}</span>
                </span>
              )}
              <span className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{currentStore.address}</span>
              <span className="flex items-center gap-1.5"><Users className="h-3 w-3" />{employees.length} employee{employees.length !== 1 ? 's' : ''} on roster</span>
              {shifts.length > 0 && (
                <span className="ml-auto flex items-center gap-2">
                  {shifts.map(s => {
                    const visual = getShiftVisual(s.code, shifts);
                    return (
                      <span
                        key={s.code}
                        className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ background: visual.bg, color: visual.text, border: `1px solid ${visual.border}` }}
                      >
                        {visual.label} {s.label}
                      </span>
                    );
                  })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Import ── */}
        {selectedStore && (
          <ImportButton
            storeId={selectedStore}
            storeName={currentStoreName}
            onImported={() => loadSchedule()}
          />
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          </div>
        )}

        {/* ── Schedule view ── */}
        {!loading && selectedStore && schedule && (
          <div className="space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Staff',         value: totalEmployees, color: '#6366f1', Icon: Users         },
                { label: 'Work shifts',   value: workingShifts,  color: '#10b981', Icon: CheckCircle2  },
                { label: 'Leave days',    value: leaveDays,      color: '#f59e0b', Icon: Calendar      },
                { label: 'Off days',      value: offDays,        color: '#94a3b8', Icon: X             },
              ].map(({ label, value, color, Icon }) => (
                <div key={label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: color + '15' }}>
                    <Icon className="h-5 w-5" style={{ color }} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold" style={{ color }}>{value}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-slate-400">
              {shifts.map(s => {
                const visual = getShiftVisual(s.code, shifts);
                return (
                  <div key={s.code} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: visual.dot }} />
                    {s.label} ({visual.label})
                    {s.startTime && s.endTime && <span className="text-slate-300">· {formatTime(s.startTime)}–{formatTime(s.endTime)}</span>}
                  </div>
                );
              })}
              <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-400" />Leave (AL)</div>
              <span className="ml-auto">Click any day to view or edit</span>
            </div>

            <CalendarGrid
              schedule={schedule}
              yearMonth={selectedMonth}
              shifts={shifts}
              onDayPress={handleDayPress}
            />

            {schedule.note && (
              <p className="px-1 text-xs italic text-slate-400">Note: "{schedule.note}"</p>
            )}
          </div>
        )}

        {/* ── No schedule ── */}
        {!loading && selectedStore && !schedule && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)' }}
            >
              <Calendar className="h-8 w-8 text-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">
                No schedule for {currentStoreName} in {formatYearMonth(selectedMonth)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Import an Excel file above, or click "Create empty" in the header to start from scratch.
              </p>
            </div>
          </div>
        )}

        {/* ── No store selected ── */}
        {!loading && !selectedStore && !storesLoading && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-200 bg-white py-20 text-center">
            <StoreIcon className="h-10 w-10 text-slate-300" />
            <p className="text-sm font-semibold text-slate-500">Select a store above to begin</p>
          </div>
        )}
      </div>

      {/* ── Right-side panel ── */}
      {panelDate && selectedStore && (
        <SchedulePanel
          date={panelDate}
          view={panelView}
          entries={panelEntries}
          editEntry={panelEditEntry}
          employees={employees}
          shifts={shifts}
          saving={panelSaving}
          onClose={closePanel}
          onBack={panelBack}
          onAdd={() => setPanelView('add')}
          onEdit={e => { setPanelEditEntry(e); setPanelView('edit'); }}
          onSaveNew={handleSaveNewEntry}
          onSaveEdit={handleSaveEntry}
        />
      )}

      <AlertDialog open={showCreateConfirm} onOpenChange={setShowCreateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Create an empty schedule for {formatYearMonth(selectedMonth)} at{' '}
              {currentStoreName}? You can then click days to assign shifts.
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