'use client';
// components/ops/mobile/DashboardMobile.tsx
//
// The Ops Dashboard on a phone (below `md`; app/ops/page.tsx renders the
// desktop panel above it from the same data). Top to bottom: a greeting card,
// what's waiting on Ops (petty cash + issues, one tap to each), today's pulse as
// rings, the stores worth a look, and the latest requests / issues.

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ListChecks, RefreshCw, Users, Wallet,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { AttendanceCountsLine } from '@/components/ops/AttendanceStatus';
import { EMPTY_COUNTS, showedUp } from '@/lib/attendance-health';
import { RATE_WORD, rateTone, storesBehind, type DashboardData } from '@/lib/ops-dashboard';
import { MobileSectionTitle, Ring } from './MobileKit';

const TONE_HEX = { emerald: '#10b981', amber: '#f59e0b', rose: '#e11d48' } as const;
const TONE_TEXT = { emerald: 'text-emerald-600', amber: 'text-amber-600', rose: 'text-rose-600' } as const;
const TONE_CHIP = { emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', rose: 'bg-rose-50 text-rose-700' } as const;

const SHIFT_DOT: Record<string, string> = {
  morning: '#f59e0b',
  middle: '#14b8a6',
  evening: '#7c3aed',
  full_day: '#0ea5e9',
  unknown: '#94a3b8',
};

// Same words as the Ops Petty Cash page.
const PETTY_CASH_STATUS: Record<string, { label: string; dot: string }> = {
  pending_ops: { label: 'Waiting OPS', dot: 'bg-amber-500' },
  ops_approved: { label: 'Approved', dot: 'bg-emerald-500' },
  completed: { label: 'Approved', dot: 'bg-emerald-500' },
  ops_rejected: { label: 'Rejected', dot: 'bg-rose-500' },
};

const IDR = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date()),
  );
  if (hour < 11) return 'Good morning';
  if (hour < 15) return 'Good afternoon';
  if (hour < 19) return 'Good evening';
  return 'Good night';
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function AttentionTile({
  href,
  icon: Icon,
  count,
  label,
  tone,
}: {
  href: string;
  icon: typeof Wallet;
  count: number;
  label: string;
  tone: 'amber' | 'rose';
}) {
  const hot = count > 0;
  return (
    <Link
      href={href}
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-2xl border p-3.5 shadow-sm transition active:scale-[0.98]',
        hot
          ? tone === 'amber'
            ? 'border-amber-200 bg-amber-50'
            : 'border-rose-200 bg-rose-50'
          : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-start justify-between">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-xl',
            hot ? (tone === 'amber' ? 'bg-amber-500 text-white' : 'bg-rose-500 text-white') : 'bg-slate-100 text-slate-400',
          )}
        >
          <Icon className="h-4.5 w-4.5" />
        </span>
        <ChevronRight className="h-4 w-4 text-slate-300" />
      </div>
      <p
        className={cn(
          'mt-3 text-[30px] font-bold leading-none tabular-nums',
          hot ? (tone === 'amber' ? 'text-amber-700' : 'text-rose-700') : 'text-slate-900',
        )}
      >
        {count}
      </p>
      <p className={cn('mt-1 text-xs font-semibold', hot ? 'text-slate-700' : 'text-slate-500')}>{label}</p>
    </Link>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-slate-200 bg-white shadow-sm', className)}>{children}</div>;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  );
}

function ViewAll({ href, children = 'View all' }: { href: string; children?: ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-0.5 text-xs font-semibold text-indigo-600 active:opacity-70">
      {children} <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function SkeletonCard({ h }: { h: string }) {
  return <div className={cn('animate-pulse rounded-2xl bg-white ring-1 ring-slate-200', h)} />;
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function DashboardMobile({
  data,
  loading,
  refreshing,
  lastUpdated,
  onRefresh,
}: {
  data: DashboardData | null;
  loading: boolean;
  refreshing: boolean;
  lastUpdated: Date | null;
  onRefresh: () => void;
}) {
  const { data: session } = useSession();
  const firstName = (session?.user?.name ?? '').split(' ')[0] || 'Ops';
  const [storeTab, setStoreTab] = useState<'tasks' | 'attendance'>('tasks');

  const att = data?.attendance;
  const today = data?.tasks.today;
  const month = data?.tasks.month;
  const shiftToday = (data?.tasks.shiftToday ?? []).filter((s) => s.total > 0);
  const pettyCashPending = data?.pettyCash.pendingCount ?? 0;
  const issuesUnreviewed = data?.issues.unreviewedCount ?? 0;
  const behind = storesBehind(data);

  const attRate = att?.rate ?? 0;
  const attTone = rateTone(attRate);
  const todayRate = today?.completionRate ?? 0;
  const todayTone = rateTone(todayRate);
  const monthRate = month?.completionRate ?? 0;
  const monthTone = rateTone(monthRate);

  const scopeLabel = data
    ? `${data.scope === 'all_areas' ? 'All areas' : 'Your area'} · ${data.storeCount} store${data.storeCount === 1 ? '' : 's'}`
    : 'Loading…';

  const storeRows = storeTab === 'tasks'
    ? behind.tasks.map((s) => ({
        key: String(s.storeId),
        name: s.storeName,
        rate: s.completionRate as number | null,
        detail: `${s.completed}/${s.total} task`,
        breakdown: null as ReactNode,
      }))
    : behind.attendance.map((s) => ({
        key: s.storeId,
        name: s.storeName,
        rate: s.rate,
        detail: s.rate === null ? 'Tidak ada shift hari ini' : '',
        breakdown: <AttendanceCountsLine counts={s} className="text-[11px]" /> as ReactNode,
      }));
  const shownStores = storeRows.slice(0, 5);

  return (
    <div className="min-h-full bg-slate-50 pb-8 md:hidden">
      {/* ── Greeting ─────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-5 text-white shadow-lg shadow-indigo-600/20">
          <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-20 -left-8 h-44 w-44 rounded-full bg-white/5" />

          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-indigo-100">{greeting()},</p>
              <p className="truncate text-2xl font-bold tracking-tight">{firstName}</p>
              <p className="mt-0.5 text-[11px] text-indigo-100">
                {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/20 transition active:scale-95 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
          </div>

          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-full bg-white/15 px-2.5 py-1 font-semibold ring-1 ring-white/20">{scopeLabel}</span>
            {lastUpdated && (
              <span className="text-indigo-100">
                Updated {lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Needs attention ──────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle>Needs Attention</MobileSectionTitle>
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            <SkeletonCard h="h-32" />
            <SkeletonCard h="h-32" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <AttentionTile href="/ops/petty-cash/requests" icon={Wallet} tone="amber" count={pettyCashPending} label="Petty cash pending" />
            <AttentionTile href="/ops/issues" icon={AlertTriangle} tone="rose" count={issuesUnreviewed} label="Unreviewed issues" />
          </div>
        )}
      </section>

      {/* ── Today ────────────────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle>Today&apos;s Snapshot</MobileSectionTitle>
        {loading ? (
          <SkeletonCard h="h-72" />
        ) : (
          <Card className="divide-y divide-slate-100">
            <div className="flex items-center gap-4 p-4">
              <Ring pct={attRate} color={TONE_HEX[attTone]}>
                <span className="text-lg font-bold tabular-nums text-slate-900">{attRate}%</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Attendance</p>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold', TONE_CHIP[attTone])}>{RATE_WORD[attTone]}</span>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">
                  {att ? showedUp(att) : 0} of {att?.total ?? 0} scheduled
                </p>
                <AttendanceCountsLine counts={att ?? EMPTY_COUNTS} className="mt-1 text-[11px]" />
              </div>
            </div>

            <div className="flex items-center gap-4 p-4">
              <Ring pct={todayRate} color={TONE_HEX[todayTone]}>
                <span className="text-lg font-bold tabular-nums text-slate-900">{todayRate}%</span>
              </Ring>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tasks today</p>
                  <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-bold', TONE_CHIP[todayTone])}>{RATE_WORD[todayTone]}</span>
                </div>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">
                  {today?.completed ?? 0} of {today?.total ?? 0} done
                </p>
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1">
                  {shiftToday.length ? (
                    shiftToday.map((s) => (
                      <span key={s.shift} className="flex items-center gap-1 text-[11px] text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: SHIFT_DOT[s.shift] ?? SHIFT_DOT.unknown }} />
                        {s.label}
                        <span className="font-semibold text-slate-900">{s.completionRate}%</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-slate-400">Belum ada task hari ini</span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4">
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tasks this month</p>
                <p className={cn('text-sm font-bold tabular-nums', TONE_TEXT[monthTone])}>{monthRate}%</p>
              </div>
              <Bar pct={monthRate} color={TONE_HEX[monthTone]} />
              <p className="mt-1.5 text-[11px] text-slate-500">
                {month?.completed ?? 0} dari {month?.total ?? 0} task bulan ini
              </p>
            </div>
          </Card>
        )}
      </section>

      {/* ── Stores needing attention ─────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle action={<ViewAll href={storeTab === 'tasks' ? '/ops/tasks/progress' : '/ops/attendance'} />}>
          Stores Needing Attention
        </MobileSectionTitle>

        <div className="mb-2.5 flex gap-1 rounded-xl bg-slate-200/60 p-1">
          {([
            { key: 'tasks' as const, label: 'Tasks', Icon: ListChecks, count: behind.tasks.length },
            { key: 'attendance' as const, label: 'Attendance', Icon: Users, count: behind.attendance.length },
          ]).map(({ key, label, Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setStoreTab(key)}
              aria-pressed={storeTab === key}
              className={cn(
                'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors',
                storeTab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="rounded-full bg-slate-100 px-1.5 text-[10px] tabular-nums text-slate-500">{count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <SkeletonCard h="h-48" />
        ) : shownStores.length === 0 ? (
          <Card className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <p className="text-sm text-slate-500">
              {storeTab === 'tasks'
                ? 'Semua toko sudah menyelesaikan task hari ini'
                : 'Semua toko hadir lengkap dan terjadwal hari ini'}
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {shownStores.map((row) => {
              const tone = row.rate === null ? null : rateTone(row.rate);
              return (
                <div key={row.key} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-800">{row.name}</p>
                    <span className="flex shrink-0 items-baseline gap-1.5">
                      {row.detail && <span className="text-[11px] text-slate-400">{row.detail}</span>}
                      {row.rate !== null && tone && (
                        <span className={cn('text-sm font-bold tabular-nums', TONE_TEXT[tone])}>{row.rate}%</span>
                      )}
                    </span>
                  </div>
                  {row.rate !== null && tone && (
                    <div className="mt-1.5">
                      <Bar pct={row.rate} color={TONE_HEX[tone]} />
                    </div>
                  )}
                  {row.breakdown && <div className="mt-1.5">{row.breakdown}</div>}
                </div>
              );
            })}
            {storeRows.length > shownStores.length && (
              <p className="px-4 py-2.5 text-xs text-slate-400">
                +{storeRows.length - shownStores.length} more store{storeRows.length - shownStores.length === 1 ? '' : 's'} need attention
              </p>
            )}
          </Card>
        )}
      </section>

      {/* ── Recent petty cash ────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle action={<ViewAll href="/ops/petty-cash/requests" />}>Recent Petty Cash</MobileSectionTitle>
        {loading ? (
          <SkeletonCard h="h-40" />
        ) : !data?.pettyCash.recent.length ? (
          <Card className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
            <Wallet className="h-6 w-6 text-slate-300" />
            <p className="text-sm text-slate-500">Belum ada request bulan ini</p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {data.pettyCash.recent.slice(0, 5).map((row) => {
              const meta = PETTY_CASH_STATUS[row.status] ?? { label: row.status, dot: 'bg-slate-300' };
              return (
                <Link
                  key={row.id}
                  href="/ops/petty-cash/requests"
                  className="flex items-center gap-3 px-4 py-3 active:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{row.storeName}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
                      {meta.label}
                      <span className="text-slate-300">·</span>
                      {relativeTime(row.createdAt)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">{IDR.format(Number(row.amount))}</p>
                </Link>
              );
            })}
          </Card>
        )}
      </section>

      {/* ── Unreviewed issues ────────────────────────────────────────────── */}
      <section className="px-4 pt-6">
        <MobileSectionTitle action={<ViewAll href="/ops/issues" />}>Unreviewed Issues</MobileSectionTitle>
        {loading ? (
          <SkeletonCard h="h-40" />
        ) : !data?.issues.recent.length ? (
          <Card className="flex flex-col items-center gap-1.5 px-6 py-8 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <p className="text-sm text-slate-500">Semua issue sudah direview</p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {data.issues.recent.slice(0, 5).map((row) => (
              <Link key={row.id} href="/ops/issues" className="flex items-center gap-3 px-4 py-3 active:bg-slate-50">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{row.title}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-500">
                    {row.storeName} · {row.reporterName} · {relativeTime(row.createdAt)}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
              </Link>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
