// app/employee/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  CheckSquare,
  ChevronRight,
  UserCircle,
  Sun,
  Moon,
  LogIn,
  CalendarDays,
  CheckCircle2,
  Clock,
  XCircle,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
}

// Matches the exact shape of the GET /api/employee/attendance payload
interface AttSlot {
  schedule: {
    shift: 'morning' | 'evening' | 'full_day';
  };
  attendance: {
    status: 'present' | 'late' | 'absent' | 'excused';
    checkInTime: string | null;
    checkOutTime: string | null;
    onBreak: boolean;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayLabel() {
  return new Date().toLocaleDateString('en-ID', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function fmtTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-ID', { hour: '2-digit', minute: '2-digit' });
}

// ─── UI Components ────────────────────────────────────────────────────────────

function RingProgress({ pct }: { pct: number }) {
  const r    = 44;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);
  return (
    <svg width={104} height={104} viewBox="0 0 104 104" className="-rotate-90">
      <circle cx={52} cy={52} r={r} fill="none" stroke="currentColor"
        strokeWidth={8} className="text-primary-foreground/15" />
      <circle
        cx={52} cy={52} r={r} fill="none" stroke="currentColor"
        strokeWidth={8} strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        className="text-primary-foreground transition-all duration-700"
      />
    </svg>
  );
}

const ATT_CFG = {
  present: { Icon: CheckCircle2, label: 'Present',  textClass: 'text-green-400', bg: 'bg-white/10' },
  late:    { Icon: Clock,        label: 'Late',     textClass: 'text-amber-300', bg: 'bg-white/10' },
  absent:  { Icon: XCircle,      label: 'Absent',   textClass: 'text-red-400',   bg: 'bg-white/10' },
  excused: { Icon: AlertCircle,  label: 'Excused',  textClass: 'text-white/60',  bg: 'bg-white/10' },
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeDashboard() {
  const { data: session, status: sessionStatus } = useSession();
  const [stats,    setStats]    = useState<Stats>({ pending: 0, inProgress: 0, completed: 0, total: 0 });
  const [attSlots, setAttSlots] = useState<AttSlot[]>([]);
  const [loading,  setLoading]  = useState(true);

  const user = session?.user as any;

  useEffect(() => {
    // Wait for session to be fully loaded before fetching data
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated') {
      setLoading(false);
      return;
    }

    Promise.all([
      // FIX 1: Removed ?storeId=... (API uses session.user.id automatically)
      fetch('/api/employee/tasks').then((r) => r.json()),
      fetch('/api/employee/attendance').then((r) => r.json()),
    ])
      .then(([taskData, attData]) => {
        // FIX 2: Updated task mapping to match GET /api/employee/tasks payload
        const tasks: any[] = taskData.tasks ?? [];
        setStats({
          pending:    tasks.filter((t) => t.data.status === 'pending').length,
          inProgress: tasks.filter((t) => t.data.status === 'in_progress' || t.data.status === 'discrepancy').length,
          completed:  tasks.filter((t) => t.data.status === 'completed' || t.data.status === 'verified').length,
          total:      tasks.length,
        });

        // FIX 3: Updated attendance mapping to match GET /api/employee/attendance payload
        if (attData.success && Array.isArray(attData.shifts)) {
          setAttSlots(attData.shifts);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [sessionStatus]);

  // Derive UI states from the new array format
  const primaryShift = attSlots[0]?.schedule.shift ?? 'morning';
  const primaryAtt   = attSlots[0]?.attendance ?? null;
  const isOnBreak    = primaryAtt?.onBreak ?? false;
  
  const attCfg = primaryAtt 
    ? ATT_CFG[primaryAtt.status] 
    : null;

  const pct       = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="flex flex-col">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden bg-primary px-6 pb-8 pt-12">
        <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -right-4 top-4 h-28 w-28 rounded-full bg-white/5" />

        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary-foreground/60">
            {greeting()}
          </p>
          <h1 className="mt-0.5 text-2xl font-bold text-primary-foreground">
            {firstName} 👋
          </h1>
          <p className="mt-1 text-xs text-primary-foreground/50">{todayLabel()}</p>

          {/* Shift + attendance status row */}
          <div className="mt-4 flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/80">
              {primaryShift === 'morning' && <Sun className="h-3 w-3" />}
              {primaryShift === 'evening' && <Moon className="h-3 w-3" />}
              {primaryShift === 'full_day' && <Zap className="h-3 w-3" />}
              {primaryShift === 'morning' && 'Morning shift'}
              {primaryShift === 'evening' && 'Evening shift'}
              {primaryShift === 'full_day' && 'Full Day shift'}
            </div>
            
            {primaryAtt && attCfg ? (
              <div className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium',
                isOnBreak ? 'bg-amber-500/20 text-amber-200' : attCfg.bg, attCfg.textClass,
              )}>
                {isOnBreak 
                  ? <Clock className="h-3 w-3" />
                  : <attCfg.Icon className="h-3 w-3" />
                }
                {isOnBreak ? 'On Break' : attCfg.label}
                {primaryAtt.checkInTime && !isOnBreak && (
                  <span className="opacity-70">· In {fmtTime(primaryAtt.checkInTime)}</span>
                )}
              </div>
            ) : !loading && attSlots.length > 0 ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-primary-foreground/60">
                <LogIn className="h-3 w-3" />
                Not checked in
              </div>
            ) : null}
          </div>
        </div>

        {/* Ring progress */}
        <div className="relative mt-5 flex items-center gap-5">
          <div className="relative shrink-0">
            <RingProgress pct={loading ? 0 : pct} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-primary-foreground">
                {loading ? '—' : `${pct}%`}
              </span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-primary-foreground/50">
                done
              </span>
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-primary-foreground">
              {loading ? '—' : stats.total}
            </p>
            <p className="text-xs text-primary-foreground/60">tasks assigned today</p>
          </div>
        </div>
      </div>

      {/* ── Stat chips ── */}
      <div className="-mt-4 grid grid-cols-3 gap-3 px-4">
        {[
          { label: 'Pending',  value: stats.pending,    textColor: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-100'    },
          { label: 'Active',   value: stats.inProgress, textColor: 'text-primary',    bg: 'bg-primary/5', border: 'border-primary/10'   },
          { label: 'Done',     value: stats.completed,  textColor: 'text-green-600',  bg: 'bg-green-50',  border: 'border-green-100'    },
        ].map(({ label, value, textColor, bg, border }) => (
          <div
            key={label}
            className={`rounded-xl border ${border} ${bg} px-3 py-3 text-center shadow-sm`}
          >
            <p className={`text-2xl font-bold ${textColor}`}>{loading ? '—' : value}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
          </div>
        ))}
      </div>

      {/* ── Quick actions ── */}
      <div className="mt-5 px-4 pb-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Quick Actions
        </p>

        <div className="space-y-2.5">
          <Link href="/employee/tasks">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CheckSquare className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">My Tasks</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {loading
                      ? 'Loading…'
                      : `${stats.pending} pending · ${stats.inProgress} in progress`}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/employee/attendance">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  primaryAtt && !isOnBreak ? 'bg-green-100' : 'bg-amber-50',
                )}>
                  <CalendarDays className={cn('h-5 w-5', primaryAtt && !isOnBreak ? 'text-green-600' : 'text-amber-600')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">Attendance</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {loading
                      ? 'Loading…'
                      : isOnBreak
                        ? 'Currently on break'
                        : primaryAtt
                          ? `${attCfg?.label} · ${primaryAtt.checkOutTime ? 'Shift complete' : 'Check-out when done'}`
                          : attSlots.length > 0
                            ? 'Tap to check in for your shift'
                            : 'No shift scheduled today'}
                  </p>
                </div>
                {!primaryAtt && !loading && attSlots.length > 0 && (
                  <Badge className="shrink-0 bg-amber-100 text-amber-700 hover:bg-amber-100 text-[10px]">
                    Action needed
                  </Badge>
                )}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <Link href="/employee/profile">
            <Card className="border-border shadow-sm transition-all active:scale-[0.98]">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary">
                  <UserCircle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">My Profile</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    View schedule &amp; account info
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}