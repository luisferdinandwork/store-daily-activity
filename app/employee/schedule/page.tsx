'use client';
// app/employee/schedule/page.tsx  (PIC 1 — calendar view)

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSession }  from 'next-auth/react';
import { useRouter }   from 'next/navigation';
import {
  Sun, Moon, Upload, Loader2, Trash2, RefreshCw,
  Shield, Calendar, Users, X, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  FileSpreadsheet,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type Shift = 'morning' | 'evening';

interface DayEntry {
  id:         string;
  userId:     string;
  userName:   string | null;
  userType:   string | null; // Maps to userEmployeeType from API
  date:       string;
  shiftId:    number | null;
  shift:      Shift | null;  // Now reliably populated from API
  isOff:      boolean;
  isLeave:    boolean;
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

const MONTHS      = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_HEADER = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EMP_LABEL: Record<string, string> = { pic_1: 'PIC 1', pic_2: 'PIC 2', so: 'SO' };

// Shift visual config
const SHIFT_CFG = {
  morning: { label: 'E', bg: '#fff7ed', border: '#fed7aa', text: '#c2410c', dot: '#fb923c' },
  evening: { label: 'L', bg: '#f5f3ff', border: '#ddd6fe', text: '#6d28d9', dot: '#a78bfa' },
  leave:   { label: 'AL', bg: '#eef2ff', border: '#c7d2fe', text: '#3730a3', dot: '#818cf8' },
  off:     { label: '',   bg: 'transparent', border: 'transparent', text: '#cbd5e1', dot: '#e2e8f0' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert any date-ish input (Date, ISO string from server, YYYY-MM-DD)
 * into a local YYYY-MM-DD string. Server timestamps come back as UTC ISO
 * (e.g. "2026-05-14T17:00:00.000Z") which represents May 15 in Jakarta —
 * we must convert to LOCAL time before extracting the date portion.
 */
function toLocalDateKey(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (isNaN(d.getTime())) return '';
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  // Use LOCAL date components, not UTC. toISOString() converts to UTC which
  // shifts the day boundary in non-UTC timezones.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build the calendar grid: 6 weeks × 7 days, padded with nulls */
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
  if (entry.isLeave)              return SHIFT_CFG.leave;
  if (entry.isOff || !entry.shift) return SHIFT_CFG.off;
  return SHIFT_CFG[entry.shift];
}

// ─── DayDetailSheet ───────────────────────────────────────────────────────────
// Bottom sheet showing all employees on a selected day

function DayDetailSheet({ date, entries, onEdit, onAdd, onClose }: {
  date:    Date;
  entries: DayEntry[];
  onEdit:  (e: DayEntry) => void;
  onAdd:   () => void;
  onClose: () => void;
}) {
  const label = date.toLocaleDateString('en-ID', { weekday: 'long', day: 'numeric', month: 'long' });
  const working = entries.filter(e => !e.isOff && !e.isLeave && e.shift);
  const leave   = entries.filter(e => e.isLeave);
  const off     = entries.filter(e => e.isOff && !e.isLeave);

  return (
    <div
      className="fixed inset-0 z-99 flex items-end justify-center"
      style={{ background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white pb-10 shadow-2xl"
        style={{ animation: 'slideUp 0.28s cubic-bezier(0.34,1.4,0.64,1)', maxHeight: '80vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between px-5 pb-4 pt-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Schedule</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{label}</p>
          </div>
          <button
            onClick={onClose}
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center px-6">
            <Calendar className="h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">No employees scheduled on this day.</p>
            <button
              onClick={onAdd}
              className="mt-2 flex items-center gap-1.5 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add employee
            </button>
          </div>
        ) : (
          <div className="space-y-1 px-4">
            {/* Add employee button at top */}
            <button
              onClick={onAdd}
              className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50 py-2.5 text-xs font-bold text-indigo-600 active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add another employee
            </button>

            {/* Working */}
            {working.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Working</p>
                {working.map(entry => {
                  const cfg = getShiftCfg(entry)!;
                  return (
                    <button
                      key={entry.id}
                      onClick={() => onEdit(entry)}
                      className="flex w-full items-center gap-3 rounded-2xl border px-4 py-3 mb-2 text-left transition-all active:scale-[0.98]"
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
            )}

            {/* Leave */}
            {leave.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">On Leave</p>
                {leave.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => onEdit(entry)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 mb-2 text-left active:scale-[0.98]"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-xs font-extrabold text-indigo-600">
                      AL
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
                    </div>
                    <span className="rounded-lg bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-600">Leave</span>
                  </button>
                ))}
              </div>
            )}

            {/* Off */}
            {off.length > 0 && (
              <div className="mb-2">
                <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Day Off</p>
                {off.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => onEdit(entry)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 mb-2 text-left active:scale-[0.98]"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-400">
                      —
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-500 truncate">{entry.userName}</p>
                      <p className="text-[11px] text-slate-400">{EMP_LABEL[entry.userType ?? ''] ?? '—'}</p>
                    </div>
                    <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">Off</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── AddEntryModal ────────────────────────────────────────────────────────────
// Used when PIC taps a day and wants to assign an employee to it.

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

  // Filter out employees already assigned to this day
  const available = employees.filter(e => !existingUserIds.has(e.id));

  function handleSubmit() {
    if (!selectedUserId) { toast.error('Please select an employee'); return; }
    const payload = {
      userId:  selectedUserId,
      shift:   (mode === 'morning' || mode === 'evening') ? mode : null,
      isOff:   mode === 'off',
      isLeave: mode === 'leave',
    };
    onSave(payload);
  }

  const options = [
    { key: 'morning', label: 'Morning', sub: '08:00 – 17:00', icon: <Sun  className="h-5 w-5" />, accent: '#ea580c' },
    { key: 'evening', label: 'Evening', sub: '13:00 – 22:00', icon: <Moon className="h-5 w-5" />, accent: '#7c3aed' },
    { key: 'off',     label: 'Day Off', sub: 'No work today', icon: <X    className="h-5 w-5" />, accent: '#64748b' },
    { key: 'leave',   label: 'Leave',   sub: 'AL / CU / Sick',icon: <Calendar className="h-5 w-5" />, accent: '#4338ca' },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-4 shadow-2xl"
        style={{ animation: 'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)', maxHeight: '90vh', overflow: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />

        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Add Employee</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{label}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Employee picker */}
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Employee</p>
          {available.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 py-6 text-center">
              <p className="text-xs text-slate-400">All employees already assigned to this day.</p>
            </div>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto">
              {available.map(emp => {
                const active = selectedUserId === emp.id;
                return (
                  <button
                    key={emp.id}
                    onClick={() => setSelectedUserId(emp.id)}
                    className="flex w-full items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left transition-all active:scale-[0.98]"
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

        {/* Shift picker */}
        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Shift</p>
        <div className="mb-6 grid grid-cols-2 gap-2.5">
          {options.map(opt => {
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setMode(opt.key)}
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

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !selectedUserId || available.length === 0}
            className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Adding…</> : 'Add to Schedule'}
          </button>
        </div>
      </div>
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
    { key: 'off',     label: 'Day Off',  sub: 'No work today',  icon: <X    className="h-5 w-5" />, accent: '#64748b' },
    { key: 'leave',   label: 'Leave',    sub: 'AL / CU / Sick', icon: <Calendar className="h-5 w-5" />, accent: '#4338ca' },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-99 flex items-end justify-center"
      style={{ background: 'rgba(15,23,42,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-4 shadow-2xl"
        style={{ animation: 'slideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200" />

        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Edit Shift</p>
            <p className="mt-0.5 text-lg font-bold text-slate-900">{entry.userName}</p>
            <p className="text-sm text-slate-500">{label}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
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

        <div className="flex gap-2.5">
          <button
            onClick={onClose}
            className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 active:scale-[0.98]"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave({ shift, isOff, isLeave })}
            disabled={saving}
            className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
          >
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" />Saving…</> : 'Save Changes'}
          </button>
        </div>
      </div>
      <style>{`@keyframes slideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
    </div>
  );
}

// ─── ImportButton ─────────────────────────────────────────────────────────────

function ImportButton({ onImported }: { onImported: () => void }) {
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
      const res  = await fetch('/api/pic/schedule/import', { method: 'POST', body: form });
      const json = (await res.json()) as ImportResult & { error?: string };

      // Normalise the response into our ImportResult shape
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

      // If there are date errors, auto-expand and toast loud
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

  // Unified warning detection — include dateErrors now
  const hasDateErrors = (result?.dateErrors?.length ?? 0) > 0;
  const hasErrors     = (result?.errors.length     ?? 0) > 0;
  const hasNotFound   = (result?.notFound.length   ?? 0) > 0;
  const hasWarnings   = hasDateErrors || hasErrors || hasNotFound;

  // Severity for panel styling
  const isFullSuccess = result?.success && !hasWarnings;
  const isHardFail    = result && !result.success && (hasDateErrors || (result.schedulesCreated === 0));

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      <button
        type="button"
        onClick={() => { setResult(null); setShowErrors(false); inputRef.current?.click(); }}
        disabled={importing}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed text-sm font-semibold transition-all active:scale-[0.98]"
        style={{
          borderColor: importing ? '#e2e8f0' : '#a5b4fc',
          background:  importing ? '#f8fafc'  : '#eef2ff',
          color:       importing ? '#94a3b8'  : '#4f46e5',
        }}
      >
        {importing
          ? <><Loader2 className="h-4 w-4 animate-spin" />Importing…</>
          : <><Upload className="h-4 w-4" />Import Schedule (.xlsx)</>}
      </button>

      {result && (
        <div
          className={cn(
            'overflow-hidden rounded-2xl border text-sm',
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
            <button onClick={() => setResult(null)} className="text-slate-400">
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
                      <li key={i} className="text-[11px] leading-relaxed text-red-700">
                        • {e}
                      </li>
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
                      <span key={n} className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {hasErrors && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-red-700 mb-1">
                    Errors
                  </p>
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

// ─── CalendarGrid ─────────────────────────────────────────────────────────────

function CalendarGrid({ schedule, yearMonth, onDayPress }: {
  schedule:   MonthlySchedule;
  yearMonth:  string;
  onDayPress: (date: Date, entries: DayEntry[]) => void;
}) {
  const grid = buildCalendarGrid(yearMonth);

  // `today` must update across midnight, otherwise the highlight gets stuck
  // on yesterday until the user refreshes the page.
  const [today, setToday] = useState(() => isoDate(new Date()));
  useEffect(() => {
    const tick = () => setToday(isoDate(new Date()));
    // Compute ms until next local midnight
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    const msUntilMidnight = nextMidnight.getTime() - now.getTime();
    const t = setTimeout(() => {
      tick();
      // After the first midnight tick, re-tick every 24h
      const daily = setInterval(tick, 24 * 60 * 60 * 1000);
      return () => clearInterval(daily);
    }, msUntilMidnight);
    return () => clearTimeout(t);
  }, []);

  // Build a map: dateString → entries[]
  const dayMap = new Map<string, DayEntry[]>();
  for (const entry of schedule.entries) {
    const ds = toLocalDateKey(entry.date);
    if (!ds) continue;
    if (!dayMap.has(ds)) dayMap.set(ds, []);
    dayMap.get(ds)!.push(entry);
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-slate-100">
        {DAYS_HEADER.map((d, i) => (
          <div
            key={d}
            className="py-2 text-center text-[10px] font-bold uppercase tracking-wide"
            style={{ color: i === 0 || i === 6 ? '#fca5a5' : '#94a3b8' }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar cells */}
      <div className="grid grid-cols-7">
        {grid.map((date, idx) => {
          if (!date) return (
            <div key={`pad-${idx}`} className="aspect-square border-b border-r border-slate-50 last:border-r-0" />
          );

          const ds      = isoDate(date);
          const entries = dayMap.get(ds) ?? [];
          const dow     = date.getDay();
          const isWkd   = dow === 0 || dow === 6;
          const isTod   = ds === today;

          // Summarise shifts for dot indicators
          const hasMorning = entries.some(e => !e.isOff && !e.isLeave && e.shift === 'morning');
          const hasEvening = entries.some(e => !e.isOff && !e.isLeave && e.shift === 'evening');
          const hasLeave   = entries.some(e => e.isLeave);
          const totalWork  = entries.filter(e => !e.isOff && !e.isLeave && e.shift).length;

          // Column border — no right border on last of each row
          const isLastInRow = (idx + 1) % 7 === 0;

          return (
            <button
              key={ds}
              onClick={() => onDayPress(date, entries)}
              className={cn(
                'relative flex flex-col items-center py-2 transition-colors active:bg-slate-50',
                'border-b border-slate-50',
                !isLastInRow && 'border-r',
              )}
              style={{
                background: isTod ? '#eef2ff' : isWkd ? '#fafafa' : 'white',
              }}
            >
              {/* Date number */}
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold',
                  isTod ? 'bg-indigo-500 text-white' : '',
                )}
                style={{
                  color: isTod ? undefined : isWkd ? '#fca5a5' : '#334155',
                }}
              >
                {date.getDate()}
              </span>

              {/* Staff count badge */}
              {totalWork > 0 && (
                <span
                  className="mt-0.5 rounded-full px-1.5 text-[8px] font-bold"
                  style={{ background: '#f1f5f9', color: '#64748b' }}
                >
                  {totalWork}
                </span>
              )}

              {/* Shift indicator dots */}
              <div className="mt-1 flex gap-0.5">
                {hasMorning && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#fb923c' }} />
                )}
                {hasEvening && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#a78bfa' }} />
                )}
                {hasLeave && (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#818cf8' }} />
                )}
                {/* Empty placeholder to keep height consistent */}
                {!hasMorning && !hasEvening && !hasLeave && (
                  <span className="h-1.5 w-1.5 opacity-0" />
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

export default function SchedulePage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const user         = session?.user as any;
  const employeeType = user?.employeeType as string | null;
  const storeId      = user?.homeStoreId  as string | null;

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [deleting,      setDeleting]      = useState(false);

  // Create entry state (opened from the calendar grid)
  const [creating, setCreating] = useState(false);
  const [employees,  setEmployees]  = useState<EmployeeOption[]>([]);
  const [addingDate, setAddingDate] = useState<Date | null>(null);
  const [addingEntry, setAddingEntry] = useState(false);
  
  // Day detail sheet state
  const [detailDate,    setDetailDate]    = useState<Date | null>(null);
  const [detailEntries, setDetailEntries] = useState<DayEntry[]>([]);

  // Edit modal state (opened from within the day sheet)
  const [editEntry,   setEditEntry]   = useState<DayEntry | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);

  const isPic1 = employeeType === 'pic_1';

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session) { router.replace('/login'); return; }
    if (!isPic1)  router.replace('/employee');
  }, [authStatus, session, isPic1, router]);

  useEffect(() => {
    if (!isPic1) return;
    fetch('/api/pic/schedule/employees')
      .then(r => r.json())
      .then(j => { if (j.success) setEmployees(j.employees ?? []); })
      .catch(() => toast.error('Failed to load employees'));
  }, [isPic1]);

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

  function handleMonthChange(ym: string) {
    setSelectedMonth(ym);
    setDetailDate(null);
  }

  function handleDayPress(date: Date, entries: DayEntry[]) {
    setDetailDate(date);
    setDetailEntries(entries);
  }

  function handleEditFromSheet(entry: DayEntry) {
    setEditEntry(entry);
  }

  function handleAddFromSheet() {
    if (!detailDate) return;
    setAddingDate(detailDate);
    setDetailDate(null);  // close the detail sheet
  }

  async function handleCreate() {
    if (schedule) { toast.error('A schedule already exists for this month'); return; }
    if (!confirm(`Create an empty schedule for ${formatYearMonth(selectedMonth)}?`)) return;
    setCreating(true);
    try {
      const res = await fetch('/api/pic/schedule/monthly', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ yearMonth: selectedMonth }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Empty schedule created — tap days to assign shifts');
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

  async function handleSaveEntry(patch: { shift: Shift | null; isOff: boolean; isLeave: boolean }) {
    if (!editEntry) return;
    setSavingEntry(true);
    try {
      const res  = await fetch(`/api/pic/schedule/entry/${editEntry.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Day updated');
      setEditEntry(null);
      setDetailDate(null);
      loadSchedule(selectedMonth);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally { setSavingEntry(false); }
  }

  async function handleSaveNewEntry(payload: {
    userId: string;
    shift:  Shift | null;
    isOff:  boolean;
    isLeave:boolean;
  }) {
    if (!addingDate) return;
    setAddingEntry(true);
    try {
      const res = await fetch('/api/pic/schedule/entry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...payload,
          date: isoDate(addingDate),
        }),
      });
      const json = await res.json();
      console.log('[handleSaveNewEntry] response:', res.status, json);
      if (!json.success) throw new Error(json.error || `HTTP ${res.status}`);
      toast.success('Employee added to this day');
      setAddingDate(null);
      loadSchedule(selectedMonth);
    } catch (e) {
      console.error('[handleSaveNewEntry] error:', e);
      toast.error(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setAddingEntry(false);
    }
  }

  // ── Auth guards ────────────────────────────────────────────────────────────

  if (authStatus === 'loading' || !session) return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
    </div>
  );

  if (!isPic1) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
        <Shield className="h-8 w-8 text-red-500" />
      </div>
      <p className="text-base font-bold text-slate-800">Access Restricted</p>
      <p className="text-sm text-slate-500">Only PIC 1 can manage store schedules.</p>
    </div>
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalEmployees = schedule ? new Set(schedule.entries.map(e => e.userId)).size : 0;
  const workingDays    = schedule ? schedule.entries.filter(e => !e.isOff && !e.isLeave && e.shift).length : 0;
  const leaveDays      = schedule ? schedule.entries.filter(e => e.isLeave).length : 0;

  const [y, m] = selectedMonth.split('-').map(Number);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">

      {/* ── Header ── */}
      <div
        className="relative overflow-hidden px-5 pb-6 pt-12"
        style={{ background: 'linear-gradient(135deg, #4338ca 0%, #7c3aed 100%)' }}
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />
        <div className="pointer-events-none absolute -left-4 bottom-0 h-24 w-24 rounded-full"  style={{ background: 'rgba(255,255,255,0.05)' }} />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-300">PIC 1 · Schedules</p>
            <h1 className="mt-0.5 text-2xl font-bold text-white">Staff Schedule</h1>
          </div>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => loadSchedule(selectedMonth)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            {!schedule && (
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-emerald-400/30 disabled:opacity-40"
                title="Create empty schedule"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            )}
            {schedule && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-red-400/30 disabled:opacity-40"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>

        {/* Month navigator */}
        <div className="relative mt-5 flex items-center justify-between">
          {/* Prev month */}
          <button
            onClick={() => {
              const d = new Date(y, m - 2, 1);
              handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>

          <div className="text-center">
            <p className="text-xl font-bold text-white">{MONTHS[m - 1]}</p>
            <p className="text-[11px] font-medium text-indigo-300">{y}</p>
          </div>

          {/* Next month */}
          <button
            onClick={() => {
              const d = new Date(y, m, 1);
              handleMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}`);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/70 hover:bg-white/20"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 space-y-3 p-4 pb-24">

        {/* Import */}
        <ImportButton onImported={() => loadSchedule(selectedMonth)} />

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
          </div>
        )}

        {/* ── Schedule exists ── */}
        {!loading && schedule && (
          <div className="space-y-3">

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Staff',        value: totalEmployees, color: '#6366f1' },
                { label: 'Work shifts',  value: workingDays,    color: '#10b981' },
                { label: 'Leave days',   value: leaveDays,      color: '#f59e0b' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-white px-3 py-3 text-center shadow-sm">
                  <p className="text-xl font-bold" style={{ color }}>{value}</p>
                  <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-3 px-1">
              {[
                { color: '#fb923c', label: 'Morning' },
                { color: '#a78bfa', label: 'Evening' },
                { color: '#818cf8', label: 'Leave'   },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-1 text-[10px] text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {label}
                </div>
              ))}
              <span className="ml-auto text-[10px] text-slate-400">Tap a day to edit</span>
            </div>

            {/* Calendar */}
            <CalendarGrid
              schedule={schedule}
              yearMonth={selectedMonth}
              onDayPress={handleDayPress}
            />

            {schedule.note && (
              <p className="px-1 text-[11px] italic text-slate-400">Note: "{schedule.note}"</p>
            )}
          </div>
        )}

        {/* ── No schedule ── */}
        {!loading && !schedule && (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ background: 'linear-gradient(135deg, #eef2ff, #f5f3ff)' }}
            >
              <Calendar className="h-8 w-8 text-indigo-300" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">No schedule for {formatYearMonth(selectedMonth)}</p>
              <p className="mt-1 text-xs text-slate-400">Import an Excel file above, or tap the + button in the header to create an empty schedule.</p>
            </div>
          </div>
        )}
      </div>
      
      {/* Add Entry Modal */}
      {addingDate && (
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

      {/* Day detail sheet */}
      {detailDate && !editEntry && !addingDate && (
        <DayDetailSheet
          date={detailDate}
          entries={detailEntries}
          onEdit={handleEditFromSheet}
          onAdd={handleAddFromSheet}
          onClose={() => setDetailDate(null)}
        />
      )}

      {/* Edit modal — stacked on top of detail sheet */}
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