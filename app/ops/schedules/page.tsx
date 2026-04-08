'use client';
// app/ops/schedules/page.tsx — OPS multi-store schedule manager (desktop)

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter }  from 'next/navigation';
import {
  Sun, Moon, Upload, Loader2, Trash2, RefreshCw,
  Shield, Calendar, X, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  FileSpreadsheet, Plus, Store as StoreIcon, MapPin, Users,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type Shift = 'morning' | 'evening';

interface DayEntry {
  id:       string;
  userId:   string;
  userName: string | null;
  userType: string | null;
  date:     string;
  shiftId:  number | null;
  shift:    Shift | null;
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

interface StoreOption {
  id:      string;
  name:    string;
  address: string;
}

interface AreaInfo {
  id:   number;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_HEADER = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EMP_LABEL: Record<string, string> = { pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO' };

const STORAGE_KEY_LAST_STORE = 'ops:lastSelectedStoreId';

const SHIFT_CFG = {
  morning: { label: 'E',  bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', dot: '#fb923c' },
  evening: { label: 'L',  bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', dot: '#a78bfa' },
  leave:   { label: 'AL', bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#818cf8' },
  off:     { label: '',   bg: 'transparent', border: 'transparent', text: '#cbd5e1', dot: '#e2e8f0' },
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

function getShiftCfg(entry: DayEntry | undefined) {
  if (!entry) return null;
  if (entry.isLeave)               return SHIFT_CFG.leave;
  if (entry.isOff || !entry.shift) return SHIFT_CFG.off;
  return SHIFT_CFG[entry.shift];
}

// ─── DayDetailDrawer (desktop side panel) ─────────────────────────────────────

function DayDetailDrawer({ date, entries, onEdit, onAdd, onClose }: {
  date:    Date;
  entries: DayEntry[];
  onEdit:  (e: DayEntry) => void;
  onAdd:   () => void;
  onClose: () => void;
}) {
  const label = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const working = entries.filter(e => !e.isOff && !e.isLeave && e.shift);
  const leave   = entries.filter(e => e.isLeave);
  const off     = entries.filter(e => e.isOff && !e.isLeave);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1 bg-slate-900/50 backdrop-blur-sm" />
      <div
        className="w-[420px] bg-white shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: 'slideInRight 0.25s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 px-6 py-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Schedule</p>
              <p className="mt-0.5 text-lg font-bold text-slate-900">{label}</p>
            </div>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Add button */}
          <button
            onClick={onAdd}
            className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50 py-2.5 text-xs font-bold text-indigo-600 hover:bg-indigo-100 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            Add employee
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
                      const cfg = getShiftCfg(entry)!;
                      return (
                        <button
                          key={entry.id}
                          onClick={() => onEdit(entry)}
                          className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-all hover:shadow-sm"
                          style={{ borderColor: cfg.border, background: cfg.bg }}
                        >
                          <div
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold"
                            style={{ background: cfg.dot + '30', color: cfg.text }}
                          >
                            {cfg.label}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{entry.userName}</p>
                            <p className="text-[11px] text-slate-400">
                              {EMP_LABEL[entry.userType ?? ''] ?? entry.userType ?? '—'} ·{' '}
                              {entry.shift === 'morning' ? '08:00–17:00' : '13:00–22:00'}
                            </p>
                          </div>
                          <div
                            className="rounded-lg px-2 py-0.5 text-[10px] font-bold"
                            style={{ background: cfg.dot + '20', color: cfg.text }}
                          >
                            {entry.shift === 'morning' ? 'Morning' : 'Evening'}
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
                        onClick={() => onEdit(entry)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-left hover:shadow-sm transition"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-extrabold text-indigo-600">AL</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{entry.userName}</p>
                          <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
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
                        onClick={() => onEdit(entry)}
                        className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-left hover:shadow-sm transition"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-400">—</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-500 truncate">{entry.userName}</p>
                          <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
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
      </div>
      <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
    </div>
  );
}

// ─── AddEntryModal ────────────────────────────────────────────────────────────

function AddEntryModal({ date, employees, existingUserIds, onSave, onClose, saving }: {
  date:            Date;
  employees:       EmployeeOption[];
  existingUserIds: Set<string>;
  onSave:          (p: { userId: string; shift: Shift | null; isOff: boolean; isLeave: boolean }) => Promise<void>;
  onClose:         () => void;
  saving:          boolean;
}) {
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [mode, setMode] = useState<'morning' | 'evening' | 'off' | 'leave'>('morning');

  const label = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const available = employees.filter(e => !existingUserIds.has(e.id));

  function handleSubmit() {
    if (!selectedUserId) { toast.error('Please select an employee'); return; }
    onSave({
      userId:  selectedUserId,
      shift:   (mode === 'morning' || mode === 'evening') ? mode : null,
      isOff:   mode === 'off',
      isLeave: mode === 'leave',
    });
  }

  const options = [
    { key: 'morning', label: 'Morning', sub: '08:00 – 17:00', icon: <Sun  className="h-5 w-5" />, accent: '#ea580c' },
    { key: 'evening', label: 'Evening', sub: '13:00 – 22:00', icon: <Moon className="h-5 w-5" />, accent: '#7c3aed' },
    { key: 'off',     label: 'Day Off', sub: 'No work today', icon: <X    className="h-5 w-5" />, accent: '#64748b' },
    { key: 'leave',   label: 'Leave',   sub: 'AL / CU / Sick',icon: <Calendar className="h-5 w-5" />, accent: '#4338ca' },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
        style={{ animation: 'fadeUp 0.25s cubic-bezier(0.34,1.56,0.64,1)', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Add Employee</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{label}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Employee</p>
          {available.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-6 text-center">
              <p className="text-xs text-slate-400">All employees already assigned to this day.</p>
            </div>
          ) : (
            <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {available.map(emp => {
                const active = selectedUserId === emp.id;
                return (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedUserId(emp.id)}
                    className="flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all"
                    style={{
                      borderColor: active ? '#6366f1' : '#e2e8f0',
                      background:  active ? '#eef2ff' : '#f8fafc',
                    }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold"
                      style={{ background: active ? '#6366f1' : '#e2e8f0', color: active ? 'white' : '#64748b' }}
                    >
                      {emp.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{emp.name}</p>
                      <p className="text-[10px] text-slate-400">{EMP_LABEL[emp.employeeType ?? ''] ?? '—'}</p>
                    </div>
                    {active && <CheckCircle2 className="h-4 w-4 shrink-0 text-indigo-500" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Shift</p>
        <div className="mb-6 grid grid-cols-2 gap-2.5">
          {options.map(opt => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
                className="relative flex flex-col items-start gap-1.5 rounded-2xl border-2 px-4 py-3.5 text-left transition-all"
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

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedUserId || available.length === 0}
            className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : 'Add to Schedule'}
          </button>
        </div>
      </div>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
}

// ─── EditDayModal ─────────────────────────────────────────────────────────────

function EditDayModal({ entry, onSave, onClose, saving }: {
  entry:   DayEntry;
  onSave:  (p: { shift: Shift | null; isOff: boolean; isLeave: boolean }) => Promise<void>;
  onClose: () => void;
  saving:  boolean;
}) {
  const [shift,   setShift]   = useState<Shift | null>(entry.shift);
  const [isOff,   setIsOff]   = useState(entry.isOff);
  const [isLeave, setIsLeave] = useState(entry.isLeave);

  const dateObj = new Date(entry.date);
  const label   = dateObj.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });

  function pick(mode: 'morning' | 'evening' | 'off' | 'leave') {
    if (mode === 'morning') { setShift('morning'); setIsOff(false); setIsLeave(false); }
    if (mode === 'evening') { setShift('evening'); setIsOff(false); setIsLeave(false); }
    if (mode === 'off')     { setShift(null); setIsOff(true);  setIsLeave(false); }
    if (mode === 'leave')   { setShift(null); setIsOff(false); setIsLeave(true);  }
  }

  const current = isLeave ? 'leave' : isOff ? 'off' : shift ?? 'off';

  const options = [
    { key: 'morning', label: 'Morning', sub: '08:00 – 17:00', icon: <Sun  className="h-5 w-5" />, accent: '#ea580c' },
    { key: 'evening', label: 'Evening', sub: '13:00 – 22:00', icon: <Moon className="h-5 w-5" />, accent: '#7c3aed' },
    { key: 'off',     label: 'Day Off', sub: 'No work today', icon: <X    className="h-5 w-5" />, accent: '#64748b' },
    { key: 'leave',   label: 'Leave',   sub: 'AL / CU / Sick',icon: <Calendar className="h-5 w-5" />, accent: '#4338ca' },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-6"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl"
        style={{ animation: 'fadeUp 0.25s cubic-bezier(0.34,1.56,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Edit Shift</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{entry.userName}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-6">
          {options.map(opt => {
            const active = current === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => pick(opt.key)}
                className="relative flex flex-col items-start gap-1.5 rounded-2xl border-2 px-4 py-3.5 text-left transition-all"
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

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ shift, isOff, isLeave })}
            disabled={saving}
            className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ImportButton (OPS variant — sends storeId in form data) ──────────────────

function ImportButton({ storeId, storeName, onImported }: {
  storeId:    string;
  storeName:  string;
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
    setImporting(true);
    setResult(null);
    setShowErrors(false);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('storeId', storeId);
      const res  = await fetch('/api/ops/schedules/import', { method: 'POST', body: form });
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
        toast.success(`Imported ${normalised.entriesCreated} entries to ${storeName}`);
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
      setResult({
        success: false, schedulesCreated: 0, entriesCreated: 0, skipped: 0,
        errors: [String(err)], notFound: [],
      });
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
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => { setResult(null); setShowErrors(false); inputRef.current?.click(); }}
        disabled={importing}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm font-semibold transition-all"
        style={{
          borderColor: importing ? '#e2e8f0' : '#a5b4fc',
          background:  importing ? '#f8fafc'  : '#eef2ff',
          color:       importing ? '#94a3b8'  : '#4f46e5',
        }}
      >
        {importing
          ? <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
          : <><Upload className="h-4 w-4" />Import schedule for {storeName}</>}
      </button>

      {result && (
        <div
          className={cn(
            'overflow-hidden rounded-xl border text-sm',
            isFullSuccess
              ? 'border-emerald-200 bg-emerald-50'
              : isHardFail
                ? 'border-red-200 bg-red-50'
                : 'border-amber-200 bg-amber-50',
          )}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            {isFullSuccess
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              : <AlertCircle  className={cn('h-4 w-4 shrink-0', isHardFail ? 'text-red-500' : 'text-amber-500')} />}
            <div className="flex-1 min-w-0">
              <p className={cn(
                'font-bold text-sm',
                isFullSuccess ? 'text-emerald-800' : isHardFail ? 'text-red-800' : 'text-amber-800',
              )}>
                {isFullSuccess
                  ? 'Import successful'
                  : hasDateErrors
                    ? 'Wrong dates in Excel'
                    : isHardFail
                      ? 'Import failed'
                      : 'Imported with warnings'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {result.entriesCreated} entries · {result.schedulesCreated} store(s)
                {result.month && ` · ${formatYearMonth(result.month)}`}
              </p>
            </div>
            {hasWarnings && (
              <button
                onClick={() => setShowErrors(v => !v)}
                className={cn(
                  'text-[11px] font-semibold flex items-center gap-0.5',
                  isHardFail ? 'text-red-700' : 'text-amber-700',
                )}
              >
                Details {showErrors ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}
            <button onClick={() => setResult(null)} className="text-slate-400 hover:text-slate-600">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {hasWarnings && showErrors && (
            <div className={cn(
              'border-t bg-white/70 px-4 py-3 space-y-3',
              isHardFail ? 'border-red-200' : 'border-amber-200',
            )}>
              {hasDateErrors && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1.5">
                    Wrong dates — please fix your Excel file
                  </p>
                  <ul className="max-h-40 overflow-y-auto space-y-1">
                    {result.dateErrors!.map((e, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-red-700">• {e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {hasNotFound && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-700 mb-1">
                    Employees not found in system
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {result.notFound.map(n => (
                      <span key={n} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">{n}</span>
                    ))}
                  </div>
                </div>
              )}
              {hasErrors && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1">Errors</p>
                  <ul className="max-h-28 overflow-y-auto space-y-0.5">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-[11px] text-red-700 font-mono break-all">{e}</li>
                    ))}
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
          E = Morning · L = Evening · AL/CU = Leave
        </p>
      )}
    </div>
  );
}

// ─── CalendarGrid (desktop) ───────────────────────────────────────────────────

function CalendarGrid({ schedule, yearMonth, onDayPress }: {
  schedule:   MonthlySchedule;
  yearMonth:  string;
  onDayPress: (date: Date, entries: DayEntry[]) => void;
}) {
  const grid = buildCalendarGrid(yearMonth);

  const [today, setToday] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const t = setTimeout(() => {
      setToday(isoDate(new Date()));
      const daily = setInterval(() => setToday(isoDate(new Date())), 24 * 60 * 60 * 1000);
      return () => clearInterval(daily);
    }, nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(t);
  }, []);

  const dayMap = new Map<string, DayEntry[]>();
  for (const entry of schedule.entries) {
    const ds = toLocalDateKey(entry.date);
    if (!ds) continue;
    if (!dayMap.has(ds)) dayMap.set(ds, []);
    dayMap.get(ds)!.push(entry);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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

      <div className="grid grid-cols-7">
        {grid.map((date, idx) => {
          if (!date) return (
            <div key={`pad-${idx}`} className="min-h-[110px] border-b border-r border-slate-50 last:border-r-0 bg-slate-50/30" />
          );

          const ds      = isoDate(date);
          const entries = dayMap.get(ds) ?? [];
          const dow     = date.getDay();
          const isWkd   = dow === 0 || dow === 6;
          const isTod   = ds === today;
          const isLastInRow = (idx + 1) % 7 === 0;

          const morning = entries.filter(e => !e.isOff && !e.isLeave && e.shift === 'morning');
          const evening = entries.filter(e => !e.isOff && !e.isLeave && e.shift === 'evening');
          const leave   = entries.filter(e => e.isLeave);

          return (
            <button
              key={ds}
              onClick={() => onDayPress(date, entries)}
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

              {/* Compact employee chips */}
              <div className="flex flex-col gap-0.5">
                {morning.slice(0, 2).map(e => (
                  <div
                    key={e.id}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold truncate"
                    style={{ background: '#fff7ed', color: '#c2410c' }}
                  >
                    <Sun className="h-2 w-2 shrink-0" />
                    <span className="truncate">{e.userName}</span>
                  </div>
                ))}
                {evening.slice(0, 2).map(e => (
                  <div
                    key={e.id}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold truncate"
                    style={{ background: '#f5f3ff', color: '#6d28d9' }}
                  >
                    <Moon className="h-2 w-2 shrink-0" />
                    <span className="truncate">{e.userName}</span>
                  </div>
                ))}
                {leave.slice(0, 1).map(e => (
                  <div
                    key={e.id}
                    className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-semibold truncate"
                    style={{ background: '#eef2ff', color: '#3730a3' }}
                  >
                    <Calendar className="h-2 w-2 shrink-0" />
                    <span className="truncate">{e.userName}</span>
                  </div>
                ))}
                {(morning.length + evening.length + leave.length) > 5 && (
                  <p className="text-[9px] text-slate-400 px-1">+{(morning.length + evening.length + leave.length) - 5} more</p>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpsSchedulesPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user = session?.user as any;
  const role = user?.role as string | undefined;

  // Store + area state
  const [stores,        setStores]        = useState<StoreOption[]>([]);
  const [area,          setArea]          = useState<AreaInfo | null>(null);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [storesLoading, setStoresLoading] = useState(true);

  // Schedule state
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [creating,      setCreating]      = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Employee + entry state
  const [employees,    setEmployees]    = useState<EmployeeOption[]>([]);
  const [addingDate,   setAddingDate]   = useState<Date | null>(null);
  const [addingEntry,  setAddingEntry]  = useState(false);

  // Day drawer + edit modal state
  const [detailDate,    setDetailDate]    = useState<Date | null>(null);
  const [detailEntries, setDetailEntries] = useState<DayEntry[]>([]);
  const [editEntry,     setEditEntry]     = useState<DayEntry | null>(null);
  const [savingEntry,   setSavingEntry]   = useState(false);

  const isOps = role === 'ops';

  // ── Auth guard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isOps)   router.replace('/');
  }, [authStatus, session, isOps, router]);

  // ── Load stores in OPS area ────────────────────────────────────────────────
  useEffect(() => {
    if (!isOps) return;
    (async () => {
      setStoresLoading(true);
      try {
        const res  = await fetch('/api/ops/schedules/stores');
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? 'Failed to load stores');
        setStores(json.stores ?? []);
        setArea(json.area ?? null);

        // Restore last selection from sessionStorage
        const remembered = typeof window !== 'undefined'
          ? sessionStorage.getItem(STORAGE_KEY_LAST_STORE)
          : null;

        const validRemembered = remembered && (json.stores ?? []).some((s: StoreOption) => s.id === remembered);

        if (validRemembered) {
          setSelectedStore(remembered);
        } else if ((json.stores ?? []).length > 0) {
          setSelectedStore(json.stores[0].id);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load stores');
      } finally {
        setStoresLoading(false);
      }
    })();
  }, [isOps]);

  // Persist store selection
  useEffect(() => {
    if (selectedStore && typeof window !== 'undefined') {
      sessionStorage.setItem(STORAGE_KEY_LAST_STORE, selectedStore);
    }
  }, [selectedStore]);

  // ── Load employees for selected store ──────────────────────────────────────
  useEffect(() => {
    if (!selectedStore) return;
    fetch(`/api/ops/schedules/employees?storeId=${selectedStore}`)
      .then(r => r.json())
      .then(j => { if (j.success) setEmployees(j.employees ?? []); })
      .catch(() => toast.error('Failed to load employees'));
  }, [selectedStore]);

  // ── Load schedule ──────────────────────────────────────────────────────────
  const loadSchedule = useCallback(async (storeId: string, ym: string) => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ops/schedules/monthly?storeId=${storeId}&yearMonth=${ym}`);
      const json = await res.json();
      setSchedule(json.schedule ?? null);
    } catch {
      toast.error('Failed to load schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStore) loadSchedule(selectedStore, selectedMonth);
  }, [selectedStore, selectedMonth, loadSchedule]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleMonthChange(ym: string) {
    setSelectedMonth(ym);
    setDetailDate(null);
  }

  function handleDayPress(date: Date, entries: DayEntry[]) {
    setDetailDate(date);
    setDetailEntries(entries);
  }

  function handleEditFromDrawer(entry: DayEntry) {
    setEditEntry(entry);
  }

  function handleAddFromDrawer() {
    if (!detailDate) return;
    setAddingDate(detailDate);
    setDetailDate(null);
  }

  async function handleCreate() {
    if (!selectedStore) return;
    if (schedule) { toast.error('A schedule already exists for this month'); return; }
    if (!confirm(`Create an empty schedule for ${formatYearMonth(selectedMonth)} at ${currentStoreName}?`)) return;
    setCreating(true);
    try {
      const res = await fetch('/api/ops/schedules/monthly', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ storeId: selectedStore, yearMonth: selectedMonth }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Empty schedule created — click days to assign shifts');
      loadSchedule(selectedStore, selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally { setCreating(false); }
  }

  async function handleDelete() {
    if (!selectedStore) return;
    if (!confirm(`Delete the ${formatYearMonth(selectedMonth)} schedule for ${currentStoreName}? Attended days are preserved.`)) return;
    setDeleting(true);
    try {
      const res  = await fetch(`/api/ops/schedules/monthly?storeId=${selectedStore}&yearMonth=${selectedMonth}`, { method: 'DELETE' });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success(json.lockedCount > 0 ? `Cleared — ${json.lockedCount} attended day(s) preserved` : 'Schedule deleted');
      loadSchedule(selectedStore, selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally { setDeleting(false); }
  }

  async function handleSaveEntry(patch: { shift: Shift | null; isOff: boolean; isLeave: boolean }) {
    if (!editEntry) return;
    setSavingEntry(true);
    try {
      const res  = await fetch(`/api/ops/schedules/entry/${editEntry.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(patch),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Day updated');
      setEditEntry(null);
      setDetailDate(null);
      if (selectedStore) loadSchedule(selectedStore, selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setSavingEntry(false); }
  }

  async function handleSaveNewEntry(payload: { userId: string; shift: Shift | null; isOff: boolean; isLeave: boolean }) {
    if (!addingDate || !selectedStore) return;
    setAddingEntry(true);
    try {
      const res = await fetch('/api/ops/schedules/entry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...payload,
          storeId: selectedStore,
          date:    isoDate(addingDate),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success('Employee added');
      setAddingDate(null);
      loadSchedule(selectedStore, selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setAddingEntry(false);
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const currentStoreName = useMemo(
    () => stores.find(s => s.id === selectedStore)?.name ?? '—',
    [stores, selectedStore],
  );

  const totalEmployees = schedule ? new Set(schedule.entries.map(e => e.userId)).size : 0;
  const workingDays    = schedule ? schedule.entries.filter(e => !e.isOff && !e.isLeave && e.shift).length : 0;
  const leaveDays      = schedule ? schedule.entries.filter(e => e.isLeave).length : 0;

  const [y, m] = selectedMonth.split('-').map(Number);

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
      <p className="text-sm text-slate-500">Only OPS users can manage area schedules.</p>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl p-6 lg:p-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500">OPS · Area Schedules</p>
            <h1 className="mt-1 text-3xl font-bold text-slate-900">Schedule Manager</h1>
            {area && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <MapPin className="h-3.5 w-3.5" />
                {area.name} · {stores.length} store{stores.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>

          {selectedStore && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => loadSchedule(selectedStore, selectedMonth)}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                Refresh
              </button>
              {!schedule && (
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create empty
                </button>
              )}
              {schedule && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex h-10 items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete schedule
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Store picker + month nav ── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-end gap-4 flex-wrap">
            {/* Store picker */}
            <div className="flex-1 min-w-[280px]">
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Store
              </label>
              {storesLoading ? (
                <div className="h-11 w-full animate-pulse rounded-xl bg-slate-100" />
              ) : stores.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  No stores in your area. Contact an admin.
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
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                </div>
              )}
            </div>

            {/* Month nav */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Month
              </label>
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                <button
                  onClick={() => {
                    const d = new Date(y, m - 2, 1);
                    handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div className="px-4 text-center min-w-[140px]">
                  <p className="text-sm font-bold text-slate-800">{MONTHS[m - 1]} {y}</p>
                </div>
                <button
                  onClick={() => {
                    const d = new Date(y, m, 1);
                    handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Address & employee count */}
          {selectedStore && (
            <div className="mt-4 flex items-center gap-4 border-t border-slate-100 pt-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3" />
                {stores.find(s => s.id === selectedStore)?.address}
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                {employees.length} employee{employees.length !== 1 ? 's' : ''} on roster
              </span>
            </div>
          )}
        </div>

        {/* ── Import ── */}
        {selectedStore && (
          <ImportButton
            storeId={selectedStore}
            storeName={currentStoreName}
            onImported={() => loadSchedule(selectedStore, selectedMonth)}
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
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Staff',       value: totalEmployees, color: '#6366f1', Icon: Users },
                { label: 'Work shifts', value: workingDays,    color: '#10b981', Icon: Sun },
                { label: 'Leave days',  value: leaveDays,      color: '#f59e0b', Icon: Calendar },
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
            <div className="flex items-center gap-4 px-1 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-orange-400" />Morning
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-violet-400" />Evening
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-indigo-400" />Leave
              </div>
              <span className="ml-auto">Click any day to view or edit</span>
            </div>

            <CalendarGrid
              schedule={schedule}
              yearMonth={selectedMonth}
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

      {/* ── Modals ── */}
      {addingDate && selectedStore && (
        <AddEntryModal
          date={addingDate}
          employees={employees}
          existingUserIds={new Set(
            (schedule?.entries ?? [])
              .filter(e => toLocalDateKey(e.date) === isoDate(addingDate))
              .map(e => e.userId),
          )}
          onSave={handleSaveNewEntry}
          onClose={() => setAddingDate(null)}
          saving={addingEntry}
        />
      )}

      {detailDate && !editEntry && !addingDate && (
        <DayDetailDrawer
          date={detailDate}
          entries={detailEntries}
          onEdit={handleEditFromDrawer}
          onAdd={handleAddFromDrawer}
          onClose={() => setDetailDate(null)}
        />
      )}

      {editEntry && (
        <EditDayModal
          entry={editEntry}
          onSave={handleSaveEntry}
          onClose={() => setEditEntry(null)}
          saving={savingEntry}
        />
      )}
    </div>
  );
}