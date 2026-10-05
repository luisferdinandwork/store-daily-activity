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
  Clock, Sun, Moon, Zap,
  RefreshCw, UserCircle, Pencil, CalendarDays, Coffee, LogIn, LogOut, Sunrise,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  isLeaveAttendanceStatus,
  LEAVE_ATTENDANCE_STATUSES,
  type AttendanceStatus,
  type LeaveAttendanceStatus,
} from '@/lib/attendance-status';
import {
  attendanceRate, attendanceHealth, tallyStatus, EMPTY_COUNTS, HEALTH_LABEL,
  type AttendanceCounts,
} from '@/lib/attendance-health';
import { CASH_COUNT_SESSION_INFO, type CashCountSession } from '@/lib/cash-count-sessions';
import {
  ATTENDANCE_COUNT_ITEMS, AttendanceStatusBadge, AttendanceStatusDot,
  STATUS, HEALTH_STYLE, type RowStatus,
} from '@/components/ops/AttendanceStatus';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttStatus = AttendanceStatus;

/** One SOP cash-count session for the store/day; record null = not counted. */
interface CashCountEntry {
  session: CashCountSession;
  record: {
    totalAmount: number;
    countedByName: string | null;
    witnessName: string | null;
    selfiePhoto: string;
    completedAt: string | null;
  } | null;
}

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
const SHIFT_ICONS: Record<string, React.ElementType> = {
  sun: Sun, moon: Moon, zap: Zap, sunrise: Sunrise, coffee: Coffee, clock: Clock,
};

const SHIFT_ACCENTS: Record<string, { icon: string; border: string; bg: string; text: string }> = {
  amber:  { icon: 'text-amber-500',  border: 'border-amber-200',  bg: 'bg-amber-50',  text: 'text-amber-800'  },
  violet: { icon: 'text-violet-500', border: 'border-violet-200', bg: 'bg-violet-50', text: 'text-violet-800' },
  sky:    { icon: 'text-sky-500',    border: 'border-sky-200',    bg: 'bg-sky-50',    text: 'text-sky-800'    },
  emerald:{ icon: 'text-emerald-500', border: 'border-emerald-200', bg: 'bg-emerald-50', text: 'text-emerald-800' },
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

function rowStatus(att: AttendanceData | null): RowStatus {
  return att?.status ?? 'pending';
}

// The only statuses Ops can set: justified absences (D / C / STD / SD), from
// any current status. Present / late come from the employee's own check-in,
// absent from the auto no-show job — never from this dialog.
const OPS_SETTABLE_STATUSES = LEAVE_ATTENDANCE_STATUSES;

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
// Remounted per row (`key` = schedule id), so state starts from that row.
function MarkDialog({ row, open, onClose, onSaved }: {
  row: AttRow | null; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const currentStatus = rowStatus(row?.attendance ?? null);
  const [status, setStatus] = useState<LeaveAttendanceStatus | null>(() => {
    const s = row?.attendance?.status;
    return isLeaveAttendanceStatus(s) ? s : null;
  });
  const [notes,  setNotes]  = useState(row?.attendance?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const hasExistingRecord = Boolean(row?.attendance);
  const statusChanged = status !== null && status !== row?.attendance?.status;
  // A brand-new record needs a status; an existing one can save just a note.
  const canSave = !saving && (statusChanged || hasExistingRecord);

  const save = async () => {
    if (!row || !canSave) return;
    setSaving(true);
    try {
      const body = {
        scheduleId: row.schedule.id,
        ...(statusChanged ? { status } : {}),
        // Always sent, so emptying the box clears the note.
        notes,
      };
      const res  = await fetch('/api/ops/attendance', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
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
            <Label>Current status</Label>
            <div>
              <AttendanceStatusBadge status={currentStatus} className="text-xs" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Change to</Label>
            <div className="grid grid-cols-2 gap-2">
              {OPS_SETTABLE_STATUSES.map((key) => {
                const cfg = STATUS[key];
                const selected = status === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    // Tap again to deselect (keep the current status, edit the note only).
                    onClick={() => setStatus(selected ? null : key)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-3 text-left text-sm font-medium transition-colors',
                      selected
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
            <p className="text-[11px] text-muted-foreground">
              Present and Late come from the employee&apos;s own check-in, and Absent is marked
              automatically — only Dinas, Cuti or Sakit can be set here.
            </p>
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
          <Button onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status indicator ───────────────────────────────────────────────────────
function StatusDot({ status, onBreak }: { status: RowStatus; onBreak?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <AttendanceStatusDot status={status} className={onBreak ? 'bg-amber-400' : undefined} />
      <AttendanceStatusBadge status={status} label={onBreak ? 'On Break' : undefined} className="text-[11px]" />
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
  const [cashCounts, setCashCounts] = useState<CashCountEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/ops/attendance?storeId=${storeId}&date=${date.toISOString()}`);
      const json = await res.json();
      if (json.success) {
        setRows(json.data);
        setCashCounts(json.cashCounts ?? []);
      }
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

  // Same buckets and rule as the calendar: present + late over present + late +
  // absent, pending and leave left out.
  const counts: AttendanceCounts = { ...EMPTY_COUNTS };
  for (const r of rows) tallyStatus(counts, r.attendance?.status);
  const { total, unset } = counts;
  const onBreak     = rows.filter((r) => r.attendance?.onBreak).length;
  const recordedPct = total > 0 ? Math.round(((total - unset) / total) * 100) : 0;
  const rate        = attendanceRate(counts);
  const health      = attendanceHealth(counts);

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {[
          { label: 'Scheduled', value: total, color: 'text-foreground', hint: undefined },
          ...ATTENDANCE_COUNT_ITEMS.map((i) => ({ label: i.label, value: counts[i.key], color: i.text, hint: i.hint })),
          { label: 'On Break', value: onBreak, color: 'text-amber-600', hint: undefined },
        ].map(({ label, value, color, hint }) => (
          <Card key={label} title={hint}>
            <CardContent className="p-4 text-center">
              <p className={cn('text-2xl font-bold', color)}>{loading ? '—' : value}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!loading && total > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              {rate !== null && (
                <Badge
                  variant="outline"
                  className={cn('gap-1.5 text-[11px] font-bold', HEALTH_STYLE[health].light, HEALTH_STYLE[health].border, HEALTH_STYLE[health].text)}
                  title="Present + late, out of present + late + absent. Pending and leave aren't counted."
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', HEALTH_STYLE[health].bg)} />
                  {rate}% attendance · {HEALTH_LABEL[health]}
                </Badge>
              )}
              <span>{recordedPct}% recorded</span>
            </span>
            <span>{total - unset}/{total} employees · {unset} {STATUS.pending.label}</span>
          </div>
          <Progress value={recordedPct} className="h-1.5" />
        </div>
      )}

      {/* Cashier cash-count + buddy selfie — five SOP sessions (read-only) */}
      {!loading && cashCounts.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Kas Kasir Hari Ini
              </p>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  cashCounts.every((c) => c.record)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-amber-200 bg-amber-50 text-amber-700',
                )}
              >
                {cashCounts.filter((c) => c.record).length}/{cashCounts.length} sesi
              </Badge>
            </div>
            <div className="divide-y divide-border">
              {cashCounts.map(({ session, record }) => {
                const info = CASH_COUNT_SESSION_INFO[session];
                return (
                  <div key={session} className="flex items-center gap-3 py-2">
                    {record?.selfiePhoto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={record.selfiePhoto}
                        alt={`Foto hitung kas sesi ${info.label}`}
                        className="h-10 w-10 flex-shrink-0 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold text-muted-foreground">
                        {info.step}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {info.label} <span className="font-normal text-muted-foreground">· {info.moment}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {record
                          ? `${record.countedByName ?? '—'} & ${record.witnessName ?? '—'} · ${fmtTime(record.completedAt)}`
                          : `Dihitung oleh ${info.counter.toLowerCase()}`}
                      </p>
                    </div>
                    {record ? (
                      <p className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
                        Rp {record.totalAmount.toLocaleString('id-ID')}
                      </p>
                    ) : (
                      <span className="flex-shrink-0 text-xs text-muted-foreground">Belum dihitung</span>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legend + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {(['present', 'late', 'absent', 'dinas', 'cuti', 'sakit_tanpa_surat', 'sakit_dengan_surat', 'pending'] as const).map((s) => (
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
        key={marking?.schedule.id ?? 'closed'}
        row={marking}
        open={!!marking}
        onClose={() => setMarking(null)}
        onSaved={() => { setMarking(null); load(); }}
      />
    </div>
  );
}