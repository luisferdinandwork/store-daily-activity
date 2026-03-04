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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  CheckCircle2, XCircle, Clock, AlertCircle, Sun, Moon,
  RefreshCw, UserCircle, Pencil, CalendarDays, Coffee, LogIn, LogOut,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────
type AttStatus = 'present' | 'absent' | 'late' | 'excused';
type Shift     = 'morning' | 'evening';

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

interface AttRow {
  schedule:   { id: string; shift: Shift; date: string };
  user:       { id: string; name: string; employeeType: string | null } | null;
  attendance: AttendanceData | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const SHIFT_CFG: Record<Shift, { startTime: string; endTime: string; label: string }> = {
  morning: { startTime: '08:00', endTime: '17:00', label: 'Morning' },
  evening: { startTime: '13:00', endTime: '22:00', label: 'Evening' },
};

const STATUS: Record<AttStatus, { label: string; Icon: React.ElementType; chip: string }> = {
  present: { label: 'Present', Icon: CheckCircle2, chip: 'border-green-200 bg-green-50 text-green-700'            },
  late:    { label: 'Late',    Icon: Clock,        chip: 'border-amber-200 bg-amber-50 text-amber-700'             },
  absent:  { label: 'Absent',  Icon: XCircle,      chip: 'border-destructive/20 bg-destructive/5 text-destructive' },
  excused: { label: 'Excused', Icon: AlertCircle,  chip: 'border-border bg-secondary text-muted-foreground'        },
};

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
  const shift    = row?.schedule.shift as Shift | undefined;
  const shiftCfg = shift ? SHIFT_CFG[shift] : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Attendance — {row?.user?.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className={cn(
            'rounded-lg border px-3 py-2.5 text-xs',
            shift === 'morning' ? 'border-amber-200 bg-amber-50' : 'border-violet-200 bg-violet-50',
          )}>
            <div className="flex items-center gap-2 font-medium">
              {shift === 'morning'
                ? <Sun  className="h-3.5 w-3.5 text-amber-500" />
                : <Moon className="h-3.5 w-3.5 text-violet-500" />}
              <span className={shift === 'morning' ? 'text-amber-800' : 'text-violet-800'}>
                {shiftCfg?.label} shift · {shiftCfg?.startTime}–{shiftCfg?.endTime}
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
              {(Object.entries(STATUS) as [AttStatus, typeof STATUS[AttStatus]][]).map(([key, cfg]) => (
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
              ))}
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

// ─── Employee card ─────────────────────────────────────────────────────────────
function AttendanceCard({ row, onMark }: { row: AttRow; onMark: (r: AttRow) => void }) {
  const att      = row.attendance;
  const cfg      = att ? STATUS[att.status] : null;
  const shift    = row.schedule.shift as Shift;
  const shiftCfg = SHIFT_CFG[shift];
  const onBreak  = Boolean(att?.onBreak);
  const breaks   = att?.breaks ?? [];

  return (
    <Card className="border-border shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full',
            onBreak ? 'bg-amber-100' : 'bg-secondary',
          )}>
            {onBreak
              ? <Coffee    className="h-5 w-5 text-amber-500" />
              : <UserCircle className="h-5 w-5 text-muted-foreground" />
            }
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">{row.user?.name ?? '—'}</p>
              {cfg ? (
                <Badge variant="outline" className={cn('gap-1 flex-shrink-0 text-[11px]', cfg.chip)}>
                  <cfg.Icon className="h-3 w-3" />
                  {onBreak ? 'On Break' : cfg.label}
                </Badge>
              ) : (
                <Badge variant="outline" className="flex-shrink-0 text-[11px] text-muted-foreground">
                  Not set
                </Badge>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {row.user?.employeeType?.toUpperCase() ?? 'Employee'}
              <span className="mx-1 opacity-40">·</span>
              {shiftCfg.startTime}–{shiftCfg.endTime}
            </p>

            {(att?.checkInTime || att?.checkOutTime) && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {att.checkInTime  && <span className="flex items-center gap-1"><LogIn  className="h-3 w-3" />{fmtTime(att.checkInTime)}</span>}
                {att.checkOutTime && <span className="flex items-center gap-1"><LogOut className="h-3 w-3" />{fmtTime(att.checkOutTime)}</span>}
                {att.checkInTime && att.checkOutTime && (
                  <span className="text-[10px] font-medium text-primary/60">
                    {fmtDuration(att.checkInTime, att.checkOutTime)}
                  </span>
                )}
              </div>
            )}

            {breaks.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {breaks.map((b) => <BreakPill key={b.id} b={b} />)}
              </div>
            )}

            {att?.notes && (
              <p className="text-xs italic text-muted-foreground">&ldquo;{att.notes}&rdquo;</p>
            )}
          </div>

          <Button
            variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0"
            onClick={() => onMark(row)} title="Mark attendance"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
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

  const morning = rows.filter((r) => r.schedule.shift === 'morning');
  const evening = rows.filter((r) => r.schedule.shift === 'evening');

  const total       = rows.length;
  const presentRows = rows.filter((r) => r.attendance?.status === 'present' || r.attendance?.status === 'late');
  const absent      = rows.filter((r) => r.attendance?.status === 'absent').length;
  const onBreak     = rows.filter((r) => r.attendance?.onBreak).length;
  const unset       = rows.filter((r) => !r.attendance).length;
  const recordedPct = total > 0 ? Math.round(((total - unset) / total) * 100) : 0;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Scheduled', value: total,              color: 'text-foreground'  },
          { label: 'Present',   value: presentRows.length, color: 'text-green-600'   },
          { label: 'Absent',    value: absent,             color: 'text-destructive' },
          { label: 'On Break',  value: onBreak,            color: 'text-amber-600'   },
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

      {/* Refresh */}
      <div className="flex justify-end">
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
          {morning.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                <h2 className="text-sm font-semibold text-foreground">
                  Morning Shift
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {SHIFT_CFG.morning.startTime}–{SHIFT_CFG.morning.endTime}
                  </span>
                </h2>
                <Badge variant="secondary" className="ml-1">{morning.length}</Badge>
              </div>
              <div className="space-y-2">
                {morning.map((row, i) => (
                  <AttendanceCard key={i} row={row} onMark={setMarking} />
                ))}
              </div>
            </div>
          )}

          {evening.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Moon className="h-4 w-4 text-violet-500" />
                <h2 className="text-sm font-semibold text-foreground">
                  Evening Shift
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {SHIFT_CFG.evening.startTime}–{SHIFT_CFG.evening.endTime}
                  </span>
                </h2>
                <Badge variant="secondary" className="ml-1">{evening.length}</Badge>
              </div>
              <div className="space-y-2">
                {evening.map((row, i) => (
                  <AttendanceCard key={i} row={row} onMark={setMarking} />
                ))}
              </div>
            </div>
          )}
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