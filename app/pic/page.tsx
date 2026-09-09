'use client';
// app/pic/page.tsx — PIC Panel home: check the store's schedule.
//
// READ-ONLY for PIC. Desktop dashboard: sticky header with month nav, a stat
// row, and a spreadsheet-style employee × day grid. PIC uploads the Excel for
// a month that has no schedule yet; once a schedule exists it can only be
// viewed. To fix a mistake, Ops removes the schedule from the Ops panel and
// the PIC re-uploads a corrected file. Editing days, creating an empty
// schedule, and deleting are Ops-only.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession }  from 'next-auth/react';
import { useRouter }   from 'next/navigation';
import {
  Upload, Download, Loader2, RefreshCw, Lock,
  Shield, Calendar, ChevronLeft, ChevronRight,
  CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

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

function daysInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function dayOfWeekLabel(yearMonth: string, day: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('en-ID', { weekday: 'short' })[0];
}

// ─── ImportButton ─────────────────────────────────────────────────────────────
//
// PIC-only, and only rendered when the selected month has NO schedule yet —
// the server also refuses an import over an existing month (409). To replace
// one, Ops removes it from the Ops panel first.

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
          'flex h-10 cursor-pointer items-center gap-2 rounded-xl px-4 text-sm font-bold transition-colors',
          importing ? 'bg-indigo-300 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700',
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

  const employeeType = session?.user?.employeeType ?? null;
  const storeId: number | null = session?.user?.homeStoreId ?? null;

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [schedule,      setSchedule]      = useState<MonthlySchedule | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [downloading,   setDownloading]   = useState(false);

  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [employees,    setEmployees]    = useState<EmployeeOption[]>([]);

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
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

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
      <p className="text-sm text-slate-500">Only PIC can view the store schedule.</p>
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
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">Store Schedule</h1>
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

              <button
                type="button"
                onClick={handleDownloadTemplate}
                disabled={downloading}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Template
              </button>

              {/* Import is only offered while the month has no schedule yet. */}
              {!loading && !schedule && (
                <ImportButton onImported={() => loadSchedule(selectedMonth)} />
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
              <p className="mt-1 text-xs text-slate-400">
                Download the <span className="font-semibold">Template</span>, fill it in, then use
                <span className="font-semibold"> Import Excel</span> to upload this month&apos;s schedule.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Read-only notice */}
            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <p className="text-xs text-slate-500">
                This schedule is <span className="font-semibold text-slate-700">read-only</span>. To change it,
                ask Ops to remove the {formatYearMonth(selectedMonth)} schedule from the Ops panel — then
                re-upload a corrected Excel file here.
              </p>
            </div>

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
                              <div
                                className={cn(
                                  'mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[9px] font-bold',
                                  !pal && 'border border-dashed border-slate-200 text-slate-300',
                                )}
                                style={pal ? { background: pal.bg, color: pal.text, border: `1px solid ${pal.border}` } : undefined}
                                title={pal ? pal.label : '—'}
                              >
                                {pal ? pal.label : ''}
                              </div>
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
    </div>
  );
}
