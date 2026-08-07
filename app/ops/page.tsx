'use client';
// app/ops/page.tsx

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ListChecks,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskBucket = {
  notStarted: number;
  inProgress: number;
  completed: number;
  pending: number;
  total: number;
  completionRate: number;
};

type ShiftBucket = {
  shift: string;
  completed: number;
  total: number;
  completionRate: number;
};

type PettyCashRow = {
  id: number;
  amount: string;
  description: string;
  status: 'pending_ops' | 'ops_approved' | 'ops_rejected' | string;
  storeName: string;
  submittedByName: string;
  createdAt: string;
};

type IssueRow = {
  id: string;
  title: string;
  storeName: string;
  reporterName: string;
  createdAt: string;
};

type DashboardData = {
  date: string;
  scope: 'all_areas' | 'area';
  storeCount: number;
  tasks: {
    today: TaskBucket;
    shiftToday: ShiftBucket[];
    month: { completed: number; total: number; completionRate: number };
  };
  attendance: {
    total: number;
    present: number;
    late: number;
    absent: number;
    excused: number;
    unset: number;
    rate: number;
  };
  pettyCash: {
    pendingCount: number;
    recent: PettyCashRow[];
  };
  issues: {
    unreviewedCount: number;
    recent: IssueRow[];
  };
};

// ─── Design tokens ───────────────────────────────────────────────────────────
// One small palette, reused everywhere as dots / bars / chips — color always
// carries meaning (status), never decoration.

const TONE = {
  emerald: { ring: '#10b981', chip: 'bg-emerald-50', text: 'text-emerald-600' },
  amber: { ring: '#f59e0b', chip: 'bg-amber-50', text: 'text-amber-600' },
  rose: { ring: '#e11d48', chip: 'bg-rose-50', text: 'text-rose-600' },
  sky: { ring: '#0ea5e9', chip: 'bg-sky-50', text: 'text-sky-600' },
  indigo: { ring: '#4f46e5', chip: 'bg-indigo-50', text: 'text-indigo-600' },
  slate: { ring: '#cbd5e1', chip: 'bg-slate-50', text: 'text-slate-400' },
} as const;

type Tone = keyof typeof TONE;

const STATUS_WORD: Record<'emerald' | 'amber' | 'rose', string> = {
  emerald: 'On track',
  amber: 'Watch',
  rose: 'Behind',
};

const SHIFT_LABEL: Record<string, string> = {
  morning: 'Pagi',
  evening: 'Sore',
  full_day: 'Full day',
  unknown: 'Lainnya',
};

const SHIFT_DOT: Record<string, string> = {
  morning: '#f59e0b',
  evening: '#7c3aed',
  full_day: '#0ea5e9',
  unknown: '#94a3b8',
};

const PETTY_CASH_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_ops: { label: 'Pending', tone: 'amber' },
  ops_approved: { label: 'Approved', tone: 'emerald' },
  ops_rejected: { label: 'Rejected', tone: 'rose' },
};

// ─── Formatting helpers ─────────────────────────────────────────────────────

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayFull() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function timeShort(d: Date) {
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function relativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  const hours = Math.floor(diffMs / 3_600_000);
  const days = Math.floor(diffMs / 86_400_000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins}m lalu`;
  if (hours < 24) return `${hours}j lalu`;
  if (days < 7) return `${days}h lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function rateTone(rate: number): 'emerald' | 'amber' | 'rose' {
  if (rate >= 80) return 'emerald';
  if (rate >= 50) return 'amber';
  return 'rose';
}

// ─── Shared visual atoms ────────────────────────────────────────────────────

function SectionHeading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{children}</p>
      {right && <div className="text-[11px] text-slate-400">{right}</div>}
    </div>
  );
}

function CardIcon({ icon: Icon, tone }: { icon: typeof Users; tone: Tone }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE[tone].chip} ${TONE[tone].text}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function TrendChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[tone].chip} ${TONE[tone].text}`}
    >
      {children}
    </span>
  );
}

function Bar({ pct, tone }: { pct: number; tone: Tone }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{ width: `${clamped}%`, background: TONE[tone].ring }}
      />
    </div>
  );
}

function SegmentedBar({ segments }: { segments: Array<{ value: number; tone: Tone }> }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) {
    return <div className="h-2.5 w-full rounded-full bg-slate-100" />;
  }
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
      {segments
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <div
            key={i}
            className="h-full transition-all duration-700 ease-out"
            style={{ width: `${(s.value / total) * 100}%`, background: TONE[s.tone].ring }}
          />
        ))}
    </div>
  );
}

function LegendGrid({ items }: { items: Array<{ label: string; value: number; tone: Tone }> }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
      {items.map(({ label, value, tone }) => (
        <div key={label} className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE[tone].ring }} />
            {label}
          </span>
          <span className="font-semibold tabular-nums text-slate-900">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ViewLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="group flex shrink-0 items-center gap-1 text-xs font-medium text-slate-500 transition-colors hover:text-indigo-600"
    >
      {children}
      <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// ─── KPI card (top row) ──────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  tone,
  footer,
}: {
  label: string;
  value: string;
  tone?: 'emerald' | 'amber' | 'rose';
  footer?: ReactNode;
}) {
  return (
    <Card className="rounded-2xl border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
          {tone && <TrendChip tone={tone}>{STATUS_WORD[tone]}</TrendChip>}
        </div>
        <p className="mt-2 text-[32px] font-semibold leading-none tracking-tight text-slate-900">{value}</p>
        {footer && <div className="mt-4">{footer}</div>}
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
      <CardContent className="p-5">
        <div className="h-3 w-24 animate-pulse rounded bg-slate-100" />
        <div className="mt-3 h-8 w-16 animate-pulse rounded bg-slate-100" />
        <div className="mt-4 h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
      </CardContent>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function OpsDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') setLoading(true);
    else setRefreshing(true);

    try {
      const res = await fetch(`/api/ops/dashboard?date=${todayKey()}`, { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
        setLastUpdated(new Date());
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
    const id = setInterval(() => void load('refresh'), 60_000);
    return () => clearInterval(id);
  }, [load]);

  const today = data?.tasks.today;
  const month = data?.tasks.month;
  const shiftToday = (data?.tasks.shiftToday ?? []).filter((s) => s.total > 0);
  const att = data?.attendance;
  const pettyCashPending = data?.pettyCash.pendingCount ?? 0;
  const issuesUnreviewed = data?.issues.unreviewedCount ?? 0;
  const needsAttentionTotal = pettyCashPending + issuesUnreviewed;

  const scopeLabel = data
    ? `${data.scope === 'all_areas' ? 'All Areas' : 'Area'} · ${data.storeCount} store${data.storeCount === 1 ? '' : 's'}`
    : '';

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Overview"
        title="Dashboard"
        subtitle={todayFull()}
        onRefresh={() => void load('refresh')}
        refreshing={refreshing}
        contentClassName="w-full"
      />

      <div className="mx-auto max-w-[1400px] space-y-10 p-6 lg:p-10">
        {/* ── Snapshot ─────────────────────────────────────────────────────── */}
        <section>
          <SectionHeading
            right={
              data && (
                <span>
                  {scopeLabel}
                  {lastUpdated && <> · Updated {timeShort(lastUpdated)}</>}
                </span>
              )
            }
          >
            Today&apos;s Snapshot
          </SectionHeading>

          {loading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <KpiSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard
                label="Attendance Rate"
                value={`${att?.rate ?? 0}%`}
                tone={rateTone(att?.rate ?? 0)}
                footer={
                  <>
                    <Bar pct={att?.rate ?? 0} tone={rateTone(att?.rate ?? 0)} />
                    <p className="mt-2 text-xs text-slate-500">
                      {(att?.present ?? 0) + (att?.late ?? 0)}/{att?.total ?? 0} hadir hari ini
                    </p>
                  </>
                }
              />

              <KpiCard
                label="Completion — Today"
                value={`${today?.completionRate ?? 0}%`}
                tone={rateTone(today?.completionRate ?? 0)}
                footer={
                  <>
                    <Bar pct={today?.completionRate ?? 0} tone={rateTone(today?.completionRate ?? 0)} />
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {shiftToday.length ? (
                        shiftToday.map((s) => (
                          <span key={s.shift} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: SHIFT_DOT[s.shift] ?? SHIFT_DOT.unknown }}
                            />
                            {SHIFT_LABEL[s.shift] ?? s.shift}
                            <span className="font-semibold text-slate-900">{s.completionRate}%</span>
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-400">Belum ada task hari ini</span>
                      )}
                    </div>
                  </>
                }
              />

              <KpiCard
                label="Completion — Month"
                value={`${month?.completionRate ?? 0}%`}
                tone={rateTone(month?.completionRate ?? 0)}
                footer={
                  <>
                    <Bar pct={month?.completionRate ?? 0} tone={rateTone(month?.completionRate ?? 0)} />
                    <p className="mt-2 text-xs text-slate-500">
                      {month?.completed ?? 0} dari {month?.total ?? 0} task bulan ini
                    </p>
                  </>
                }
              />

              <KpiCard
                label="Needs Attention"
                value={String(needsAttentionTotal)}
                tone={needsAttentionTotal > 0 ? 'amber' : 'emerald'}
                footer={
                  <div className="-mx-1.5 space-y-0.5">
                    <Link
                      href="/ops/petty-cash"
                      className="flex items-center justify-between rounded-lg px-1.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE.amber.ring }} />
                        Petty cash pending
                      </span>
                      <span className="flex items-center gap-0.5 font-semibold text-slate-900">
                        {pettyCashPending}
                        <ChevronRight className="h-3 w-3 text-slate-300" />
                      </span>
                    </Link>
                    <Link
                      href="/ops/issues"
                      className="flex items-center justify-between rounded-lg px-1.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE.rose.ring }} />
                        Unreviewed issues
                      </span>
                      <span className="flex items-center gap-0.5 font-semibold text-slate-900">
                        {issuesUnreviewed}
                        <ChevronRight className="h-3 w-3 text-slate-300" />
                      </span>
                    </Link>
                  </div>
                }
              />
            </div>
          )}
        </section>

        {/* ── Operations health ────────────────────────────────────────────── */}
        <section>
          <SectionHeading>Operations Health</SectionHeading>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                  <CardIcon icon={ListChecks} tone="indigo" />
                  Task Breakdown — Today
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-2">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-xs text-slate-500">{today?.total ?? 0} task hari ini</p>
                  <p className="text-xs font-semibold text-slate-900">{today?.completionRate ?? 0}% selesai</p>
                </div>
                <SegmentedBar
                  segments={[
                    { value: today?.completed ?? 0, tone: 'emerald' },
                    { value: today?.inProgress ?? 0, tone: 'indigo' },
                    { value: today?.pending ?? 0, tone: 'amber' },
                    { value: today?.notStarted ?? 0, tone: 'slate' },
                  ]}
                />
                <div className="mt-5">
                  <LegendGrid
                    items={[
                      { label: 'Completed', value: today?.completed ?? 0, tone: 'emerald' },
                      { label: 'In Progress', value: today?.inProgress ?? 0, tone: 'indigo' },
                      { label: 'Pending', value: today?.pending ?? 0, tone: 'amber' },
                      { label: 'Not Started', value: today?.notStarted ?? 0, tone: 'slate' },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                    <CardIcon icon={Users} tone="emerald" />
                    Attendance — All Stores
                  </CardTitle>
                  <ViewLink href="/ops/attendance">View Detail</ViewLink>
                </div>
              </CardHeader>
              <CardContent className="p-6 pt-2">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-xs text-slate-500">{att?.total ?? 0} jadwal hari ini</p>
                  <p className="text-xs font-semibold text-slate-900">{att?.rate ?? 0}% hadir</p>
                </div>
                <SegmentedBar
                  segments={[
                    { value: att?.present ?? 0, tone: 'emerald' },
                    { value: att?.late ?? 0, tone: 'amber' },
                    { value: att?.unset ?? 0, tone: 'slate' },
                    { value: att?.excused ?? 0, tone: 'sky' },
                  ]}
                />
                <div className="mt-5">
                  <LegendGrid
                    items={[
                      { label: 'Present', value: att?.present ?? 0, tone: 'emerald' },
                      { label: 'Late', value: att?.late ?? 0, tone: 'amber' },
                      { label: 'Not Yet Attended', value: att?.unset ?? 0, tone: 'slate' },
                      { label: 'Leave', value: att?.excused ?? 0, tone: 'sky' },
                    ]}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Requests & follow-ups ────────────────────────────────────────── */}
        <section>
          <SectionHeading>Requests &amp; Follow-ups</SectionHeading>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                    <CardIcon icon={Wallet} tone="amber" />
                    Recent Petty Cash
                    {pettyCashPending > 0 && <TrendChip tone="amber">{pettyCashPending} pending</TrendChip>}
                  </CardTitle>
                  <ViewLink href="/ops/petty-cash">View all</ViewLink>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0 pb-2">
                {!data?.pettyCash.recent.length ? (
                  <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                    <Wallet className="h-5 w-5 text-slate-300" />
                    <p className="text-sm text-slate-500">Belum ada request bulan ini</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="px-6 py-2.5 font-medium">Store</th>
                        <th className="px-6 py-2.5 font-medium">Amount</th>
                        <th className="px-6 py-2.5 font-medium">Status</th>
                        <th className="px-6 py-2.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pettyCash.recent.map((row) => {
                        const meta = PETTY_CASH_STATUS[row.status] ?? { label: row.status, tone: 'slate' as Tone };
                        return (
                          <tr
                            key={row.id}
                            className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70"
                          >
                            <td className="max-w-[140px] truncate px-6 py-3 text-slate-700">{row.storeName}</td>
                            <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900">
                              {IDR.format(Number(row.amount))}
                            </td>
                            <td className="px-6 py-3">
                              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                                <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE[meta.tone].ring }} />
                                {meta.label}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500">
                              {relativeTime(row.createdAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card className="rounded-2xl border-slate-200 bg-white shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                    <CardIcon icon={AlertTriangle} tone="rose" />
                    Unreviewed Issues
                    {issuesUnreviewed > 0 && <TrendChip tone="rose">{issuesUnreviewed} open</TrendChip>}
                  </CardTitle>
                  <ViewLink href="/ops/issues">View all</ViewLink>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0 pb-2">
                {!data?.issues.recent.length ? (
                  <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <p className="text-sm text-slate-500">Semua issue sudah direview</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <th className="px-6 py-2.5 font-medium">Issue</th>
                        <th className="px-6 py-2.5 font-medium">Store</th>
                        <th className="px-6 py-2.5 font-medium">Reporter</th>
                        <th className="px-6 py-2.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.issues.recent.map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70"
                        >
                          <td className="max-w-[180px] truncate px-6 py-3 font-medium text-slate-900">{row.title}</td>
                          <td className="max-w-[120px] truncate px-6 py-3 text-slate-700">{row.storeName}</td>
                          <td className="max-w-[120px] truncate px-6 py-3 text-slate-500">{row.reporterName}</td>
                          <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500">
                            {relativeTime(row.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
