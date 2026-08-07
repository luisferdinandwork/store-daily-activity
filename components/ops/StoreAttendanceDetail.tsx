// app/components/ops/StoreAttendanceDetail.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle2, XCircle, Clock, AlertCircle, HelpCircle, Sun, Moon, Zap,
  RefreshCw, UserCircle, Pencil, CalendarDays, Coffee, LogIn, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttStatus = 'present' | 'absent' | 'late' | 'excused';
type RowStatus = AttStatus | 'pending';

interface BreakSession {
  id:           string;
  breakType:    'lunch' | 'dinner';
  breakOutTime: string;
  returnTime:   string | null;
}

interface AttendanceData {
  id:           string;
  status:       AttStatus;
  checkInTime:  string | null;
  checkOutTime: string | null;
  onBreak:      boolean;
  notes:        string | null;
  breaks:       BreakSession[];
}

interface ScheduleInfo {
  id:             string;
  shift:          string;               // shift code, e.g. 'morning' | 'evening' | 'full_day'
  shiftLabel:     string | null;
  shiftStartTime: string | null;        // "HH:MM:SS"
  shiftEndTime:   string | null;
  shiftIcon:      string | null;        // 'sun' | 'moon' | 'zap' | …
  shiftAccent:    string | null;        // 'amber' | 'violet' | 'sky' | …
  shiftSortOrder: number;
  date:           string;
}

interface AttRow {
  schedule:   ScheduleInfo;
  user:       { id: string; name: string; employeeType: string | null; employeeTypeLabel: string | null } | null;
  attendance: AttendanceData | null;
}

// ─── Shift display helpers ──────────────────────────────────────────────────
// Shifts are dynamic (morning/evening/full_day today, more can be added
// later via the shifts lookup table), so the icon/color/time range are
// driven by whatever the API reports for that schedule — not a hardcoded
// two-shift assumption. Falls back gracefully for any shift not in the map.
const SHIFT_ICONS: Record<string, React.ElementType> = { sun: Sun, moon: Moon, zap: Zap };

const SHIFT_ACCENTS: Record<string, { icon: string; border: string; bg: string; text: string }> = {
  amber:  { icon: 'text-amber-500',  border: 'border-amber-200',  bg: 'bg-amber-50',  text: 'text-amber-800'  },
  violet: { icon: 'text-violet-500', border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-800' },
  sky:    { icon: 'text-sky-500',    border: 'border-sky-200',    bg: 'bg-sky-50',    text: 'text-sky-800'    },
};
const DEFAULT_ACCENT = { icon: 'text-muted-foreground', border: 'border-border', bg: 'bg-secondary', text: 'text-foreground' };

function shiftIconFor(icon: string | null): React.ElementType {
  return (icon && SHIFT_ICONS[icon]) || Clock;
}
function shiftAccentFor(accent: string | null) {
  return (accent && SHIFT_ACCENTS[accent]) || DEFAULT_ACCENT;
}
function fmtShiftTime(t: string | null) {
  return t ? t.slice(0, 5) : '—';
}

// Indicator colors: green = present, yellow = late, red = absent, blue = pending (unset).
const STATUS: Record<RowStatus, { label: string; Icon: React.ElementType; chip: string; dot: string }> = {
  present: { label: 'Present', Icon: CheckCircle2, chip: 'border-emerald-200 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  late:    { label: 'Late',    Icon: Clock,        chip: 'border-amber-200 bg-amber-50 text-amber-700',       dot: 'bg-amber-400'   },
  absent:  { label: 'Absent',  Icon: XCircle,      chip: 'border-red-200 bg-red-50 text-red-700',             dot: 'bg-red-500'     },
  excused: { label: 'Excused', Icon: AlertCircle,  chip: 'border-border bg-secondary text-muted-foreground',  dot: 'bg-slate-400'   },
  pending: { label: 'Pending', Icon: HelpCircle,    chip: 'border-sky-200 bg-sky-50 text-sky-700',             dot: 'bg-sky-400'     },
};

function rowStatus(att: AttendanceData | null): RowStatus {
  return att?.status ?? 'pending';
}

// Settable statuses for the mark dialog — 'pending' isn't a real status, it's
// just how the table renders "no attendance record yet".
const SETTABLE_STATUSES: AttStatus[] = ['present', 'late', 'absent', 'excused'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function fmtDuration(inIso: string | null, outIso: string | null) {
  if (!inIso || !outIso) return null;
  const mins = Math.round((new Date(outIso).getTime() - new Date(inIso).getTime()) / 60000);
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// ─── Break pill ───────────────────────────────────────────────────────────────
function BreakPill({ b }: { b: BreakSession }) {
  const open = !b.returnTime;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
      open
        ? 'border border-amber-300 bg-amber-50 text-amber-700'
        : 'border border-border bg-secondary text-muted-foreground',
    )}>
      <Coffee className="h-2.5 w-2.5" />
      <span className="capitalize">{b.breakType}</span>
      {open
        ? <span className="text-amber-500">ongoing since {fmtTime(b.breakOutTime)}</span>
        : <>{fmtTime(b.breakOutTime)} – {fmtTime(b.returnTime)} ({fmtDuration(b.breakOutTime, b.returnTime)})</>
      }
    </span>
  );
}

// ─── Mark attendance dialog ───────────────────────────────────────────────────
function MarkDialog({ row, open, onClose, onSaved }: {
  row: AttRow | null; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const [status, setStatus] = useState<AttStatus>('present');
  const [notes,  setNotes]  = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(row?.attendance?.status ?? 'present');
    setNotes(row?.attendance?.notes ?? '');
  }, [row, open]);

  const save = async () => {
    if (!row) return;
    setSaving(true);
    try {
      const res  = await fetch('/api/ops/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ scheduleId: row.schedule.id, status, notes: notes || undefined }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      toast.success('Attendance updated');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const att      = row?.attendance;
  const sched    = row?.schedule;
  const ShiftIcon = shiftIconFor(sched?.shiftIcon ?? null);
  const accent   = shiftAccentFor(sched?.shiftAccent ?? null);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Attendance — {row?.user?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className={cn('rounded-lg border px-3 py-2.5 text-xs', accent.border, accent.bg)}>
            <div className="flex items-center gap-2 font-medium">
              <ShiftIcon className={cn('h-3.5 w-3.5', accent.icon)} />
              <span className={accent.text}>
                {sched?.shiftLabel ?? 'Shift'} · {fmtShiftTime(sched?.shiftStartTime ?? null)}–{fmtShiftTime(sched?.shiftEndTime ?? null)}
              </span>
            </div>
            {(att?.checkInTime || att?.checkOutTime) && (
              <div className="mt-1.5 flex items-center gap-3 text-muted-foreground">
                {att.checkInTime  && <span className="flex items-center gap-1"><LogIn  className="h-3 w-3" /> {fmtTime(att.checkInTime)}</span>}
                {att.checkOutTime && <span className="flex items-center gap-1"><LogOut className="h-3 w-3" /> {fmtTime(att.checkOutTime)}</span>}
                {att.checkInTime && att.checkOutTime && (
                  <span className="text-[10px]">({fmtDuration(att.checkInTime, att.checkOutTime)})</span>
                )}
              </div>
            )}
            {att?.onBreak && (
              <div className="mt-1.5 flex items-center gap-1 font-semibold text-amber-700">
                <Coffee className="h-3 w-3" /> Currently on break
              </div>
            )}
            {att?.breaks && att.breaks.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {att.breaks.map((b) => <BreakPill key={b.id} b={b} />)}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Status</Label>
            <div className="grid grid-cols-2 gap-2">
              {SETTABLE_STATUSES.map((key) => {
                const cfg = STATUS[key];
                return (
                <button
                  key={key} type="button" onClick={() => setStatus(key)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 text-sm font-medium transition-colors text-left',
                    status === key
                      ? cfg.chip
                      : 'border-border bg-background text-muted-foreground hover:bg-secondary',
                  )}
                >
                  <cfg.Icon className="h-4 w-4 flex-shrink-0" />
                  {cfg.label}
                </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              placeholder="Reason, context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status indicator ───────────────────────────────────────────────────────
function StatusDot({ status, onBreak }: { status: RowStatus; onBreak?: boolean }) {
  const cfg = STATUS[status];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('h-2 w-2 flex-shrink-0 rounded-full', onBreak ? 'bg-amber-400' : cfg.dot)} />
      <Badge variant="outline" className={cn('gap-1 text-[11px]', cfg.chip)}>
        <cfg.Icon className="h-3 w-3" />
        {onBreak ? 'On Break' : cfg.label}
      </Badge>
    </span>
  );
}

// ─── Employee row ───────────────────────────────────────────────────────────
function AttendanceTableRow({ row, onMark }: { row: AttRow; onMark: (r: AttRow) => void }) {
  const att      = row.attendance;
  const status   = rowStatus(att);
  const onBreak  = Boolean(att?.onBreak);
  const breaks   = att?.breaks ?? [];

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <div className={cn(
            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
            onBreak ? 'bg-amber-100' : 'bg-secondary',
          )}>
            {onBreak
              ? <Coffee      className="h-4 w-4 text-amber-500" />
              : <UserCircle  className="h-4 w-4 text-muted-foreground" />
            }
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{row.user?.name ?? '—'}</p>
            <p className="text-[11px] text-muted-foreground">{row.user?.employeeTypeLabel ?? 'Employee'}</p>
          </div>
        </div>
      </TableCell>

      <TableCell>
        <StatusDot status={status} onBreak={onBreak} />
      </TableCell>

      <TableCell>
        {att?.checkInTime || att?.checkOutTime ? (
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <LogIn className="h-3 w-3" />
              {fmtTime(att?.checkInTime ?? null)}
            </span>
            <span className="flex items-center gap-1">
              <LogOut className="h-3 w-3" />
              {fmtTime(att?.checkOutTime ?? null)}
            </span>
            {att?.checkInTime && att?.checkOutTime && (
              <span className="text-[10px] font-medium text-primary/60">
                {fmtDuration(att.checkInTime, att.checkOutTime)}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        {breaks.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {breaks.map((b) => <BreakPill key={b.id} b={b} />)}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="max-w-[220px] whitespace-normal">
        {att?.notes ? (
          <p className="text-xs italic text-muted-foreground">&ldquo;{att.notes}&rdquo;</p>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="text-right">
        <Button
          variant="ghost" size="icon" className="h-8 w-8"
          onClick={() => onMark(row)} title="Mark attendance"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Shift table ────────────────────────────────────────────────────────────
function ShiftTable({ rows, onMark }: { rows: AttRow[]; onMark: (r: AttRow) => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Employee</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Check-in / out</TableHead>
            <TableHead>Breaks</TableHead>
            <TableHead>Notes</TableHead>
            <TableHead className="text-right">Mark</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <AttendanceTableRow key={i} row={row} onMark={onMark} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function StoreAttendanceDetail({
  storeId, date,
}: { storeId: string; date: Date }) {
  const [rows,    setRows]    = useState<AttRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState<AttRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ops/attendance?storeId=${storeId}&date=${date.toISOString()}`);
      const json = await res.json();
      if (json.success) setRows(json.data);
    } finally {
      setLoading(false);
    }
  }, [storeId, date]);

  useEffect(() => { load(); }, [load]);

  // Group by whatever shift each row actually belongs to — not a hardcoded
  // morning/evening split — so any shift (including PIC's full-day shift)
  // gets its own section instead of silently disappearing.
  const shiftGroups = (() => {
    const groups = new Map<string, { label: string; icon: string | null; accent: string | null; startTime: string | null; endTime: string | null; sortOrder: number; rows: AttRow[] }>();
    for (const row of rows) {
      const key = row.schedule.shift;
      if (!groups.has(key)) {
        groups.set(key, {
          label:     row.schedule.shiftLabel ?? key,
          icon:      row.schedule.shiftIcon,
          accent:    row.schedule.shiftAccent,
          startTime: row.schedule.shiftStartTime,
          endTime:   row.schedule.shiftEndTime,
          sortOrder: row.schedule.shiftSortOrder,
          rows:      [],
        });
      }
      groups.get(key)!.rows.push(row);
    }
    return [...groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  })();

  const total       = rows.length;
  const present     = rows.filter((r) => r.attendance?.status === 'present').length;
  const late        = rows.filter((r) => r.attendance?.status === 'late').length;
  const absent      = rows.filter((r) => r.attendance?.status === 'absent').length;
  const onBreak     = rows.filter((r) => r.attendance?.onBreak).length;
  const unset       = rows.filter((r) => !r.attendance).length;
  const recordedPct = total > 0 ? Math.round(((total - unset) / total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {[
          { label: 'Scheduled', value: total,   color: 'text-foreground'   },
          { label: 'Present',   value: present, color: 'text-emerald-600'  },
          { label: 'Late',      value: late,     color: 'text-amber-600'   },
          { label: 'Absent',    value: absent,  color: 'text-red-600'      },
          { label: 'Pending',   value: unset,    color: 'text-sky-600'     },
          { label: 'On Break',  value: onBreak,  color: 'text-amber-600'   },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardContent className="p-4 text-center">
              <p className={cn('text-2xl font-bold', color)}>{loading ? '—' : value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{recordedPct}% recorded</span>
            <span>{total - unset}/{total} employees · {unset} unmarked</span>
          </div>
          <Progress value={recordedPct} className="h-1.5" />
        </div>
      )}

      {/* Legend + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(['present', 'late', 'absent', 'pending'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className={cn('h-2 w-2 rounded-full', STATUS[s].dot)} />
              {STATUS[s].label}
            </span>
          ))}
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {/* Shift lists */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-14 text-center">
            <CalendarDays className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold text-muted-foreground">No schedules for this date</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {shiftGroups.map((group) => {
            const ShiftIcon = shiftIconFor(group.icon);
            const accent    = shiftAccentFor(group.accent);
            return (
              <div key={group.label}>
                <div className="mb-2 flex items-center gap-2">
                  <ShiftIcon className={cn('h-4 w-4', accent.icon)} />
                  <h2 className="text-sm font-semibold text-foreground">
                    {group.label} Shift
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {fmtShiftTime(group.startTime)}–{fmtShiftTime(group.endTime)}
                    </span>
                  </h2>
                  <Badge variant="secondary" className="ml-1">{group.rows.length}</Badge>
                </div>
                <ShiftTable rows={group.rows} onMark={setMarking} />
              </div>
            );
          })}
        </div>
      )}

      <MarkDialog
        row={marking}
        open={!!marking}
        onClose={() => setMarking(null)}
        onSaved={() => { setMarking(null); load(); }}
      />
    </div>
  );
}