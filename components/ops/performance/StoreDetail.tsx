'use client';
// components/ops/performance/StoreDetail.tsx
//
// One store's performance. Reads top to bottom:
//   hero     ring + Sales / Transaksi (actual, target, pace tick, what's left)
//   facts    ATV · Team size · where we are in the month
//   target   the monthly target Ops sets (inline edit)
//   team     per-employee actual vs target, % share, history
//   notes    collapsed until needed
// plus ‹ › to step through the stores in the list's current filter and sort.

import { useState, type ElementType, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDashed,
  Clock,
  CloudOff,
  Gauge,
  Receipt,
  StickyNote,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  classifyProgress,
  fmtCount,
  fmtDayShort,
  fmtMonthShort,
  fmtRp,
  fmtRpCompact,
  heroTargets,
  HEALTH_META,
  monthPhase,
  pctOf,
  runRate,
  type DetailResponse,
  type EligibleEmployee,
  type MonthPhase,
  type StoreHealth,
  type StoreRow,
  type Tone,
  type ViewPeriod,
} from '@/lib/performance/target-view';
import { CodeChip, HealthChip, LifecycleBadge, MicroLabel, ProgressRing, TargetBar, TONE } from './atoms';
import MonthlyTargetEditor from './MonthlyTargetEditor';
import TeamSection from './TeamSection';

export type StoreNav = {
  /** 1-based position in the filtered list. */
  position: number;
  total: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
};

// ─── Pieces ───────────────────────────────────────────────────────────────────

function TopBar({ onBack, nav }: { onBack: () => void; nav: StoreNav | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 shadow-sm hover:bg-slate-50"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Semua toko
      </button>

      {nav && nav.total > 1 && (
        <div className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={nav.onPrev ?? undefined}
            disabled={!nav.onPrev}
            aria-label="Toko sebelumnya"
            className="flex h-full w-9 items-center justify-center rounded-l-xl text-slate-500 hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="border-x border-slate-200 px-3 text-xs font-bold tabular-nums text-slate-500">
            {nav.position}/{nav.total}
          </span>
          <button
            type="button"
            onClick={nav.onNext ?? undefined}
            disabled={!nav.onNext}
            aria-label="Toko berikutnya"
            className="flex h-full w-9 items-center justify-center rounded-r-xl text-slate-500 hover:bg-slate-50 disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function SetupStep({ done, children }: { done: boolean; children: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset',
        done ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-amber-50 text-amber-700 ring-amber-200',
      )}
    >
      {done ? <Check className="h-3 w-3" strokeWidth={3} /> : <CircleDashed className="h-3 w-3" />}
      {children}
    </span>
  );
}

/** Two-step "is this store set up?" chips — only shown while something is missing. */
function SetupSteps({ targetSet, teamSet }: { targetSet: boolean; teamSet: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <SetupStep done={targetSet}>Target</SetupStep>
      <SetupStep done={teamSet}>Team</SetupStep>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  actual,
  target,
  available,
  tone,
  paceMarker,
  format,
  closing,
  perDay,
}: {
  icon: ElementType;
  label: string;
  actual: number;
  target: number;
  available: boolean;
  tone: Tone;
  paceMarker: number | null;
  format: (n: number) => string;
  /** 'Kurang' for a past month, 'Sisa' otherwise. */
  closing: 'Sisa' | 'Kurang';
  /** Daily run-rate still needed (current month only). */
  perDay: number | null;
}) {
  const pct = pctOf(actual, target);
  const remaining = Math.max(0, target - actual);
  const hasTarget = target > 0;

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TONE[tone].soft)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <MicroLabel>{label}</MicroLabel>
        </div>
        {hasTarget && available && (
          <span className={cn('text-sm font-black tabular-nums', TONE[tone].text)}>{pct}%</span>
        )}
      </div>

      <p className="mt-3 truncate text-[26px] font-black leading-none tabular-nums text-slate-900">
        {available ? format(actual) : '—'}
      </p>

      <TargetBar
        pct={available ? pct : 0}
        tone={tone}
        paceMarker={hasTarget && available ? paceMarker : null}
        className="mt-3.5"
      />

      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] tabular-nums text-slate-400">
        <span>Target {hasTarget ? format(target) : '—'}</span>
        {hasTarget && available && (
          remaining > 0
            ? <span>{closing} <span className="font-bold text-slate-600">{format(remaining)}</span></span>
            : <span className="inline-flex items-center gap-1 font-bold text-emerald-600"><Check className="h-3 w-3" strokeWidth={3} /> Tercapai</span>
        )}
      </div>

      {perDay !== null && perDay > 0 && available && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 text-[11px] font-semibold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
          <Clock className="h-3 w-3 text-slate-400" />
          Perlu <span className="font-black text-slate-800">{format(perDay)}</span>/hari
        </p>
      )}
    </div>
  );
}

function Fact({ icon: Icon, label, children }: { icon: ElementType; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <MicroLabel>{label}</MicroLabel>
        <div className="truncate text-sm font-black tabular-nums text-slate-900">{children}</div>
      </div>
    </div>
  );
}

function NotesSection({
  storeId,
  yearMonth,
  initial,
  onSaved,
}: {
  storeId: number;
  yearMonth: string;
  initial: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(initial.trim() !== '');
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = notes !== initial;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/ops/performance-targets/${storeId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yearMonth, notes }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal menyimpan catatan.');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan catatan.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 text-xs font-bold text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <StickyNote className="h-3.5 w-3.5" /> Catatan
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <MicroLabel className="flex items-center gap-1.5">
        <StickyNote className="h-3 w-3" /> Catatan {fmtMonthShort(yearMonth)}
      </MicroLabel>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Catatan untuk target bulan ini…"
        aria-label="Catatan target bulanan"
        className="mt-2 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
      />
      {error && <p className="mt-1 text-xs font-semibold text-rose-600">{error}</p>}
      {dirty && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {saving ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Hero maths ───────────────────────────────────────────────────────────────

/**
 * Colour + health of a store-level figure, in a monthly or daily view.
 * `performing` = there is a real achievement % to show (a target, data, and a
 * period that has started).
 */
function progressState(args: {
  pct: number;
  target: number;
  monthly: boolean;
  phase: MonthPhase;
  available: boolean;
}): { tone: Tone; health: StoreHealth | null; gapPt: number | null; performing: boolean } {
  const { pct, target, monthly, phase, available } = args;
  if (target <= 0) return { tone: 'slate', health: 'no_target', gapPt: null, performing: false };
  if (monthly && phase.phase === 'future') return { tone: 'indigo', health: 'upcoming', gapPt: null, performing: false };
  if (!available) return { tone: 'slate', health: 'no_data', gapPt: null, performing: false };
  if (monthly) {
    const { health, gapPt } = classifyProgress(pct, phase);
    return { tone: HEALTH_META[health].tone, health, gapPt, performing: true };
  }
  // A single day has no pace to compare against — just done / in progress / nothing yet.
  if (pct >= 100) return { tone: 'emerald', health: 'achieved', gapPt: null, performing: true };
  return { tone: pct > 0 ? 'indigo' : 'slate', health: null, gapPt: null, performing: true };
}

// ─── Body ─────────────────────────────────────────────────────────────────────

function DetailBody({
  detail,
  identity,
  eligible,
  yearMonth,
  dateKey,
  onRefresh,
}: {
  detail: DetailResponse;
  identity: { name: string; storeNo: string; areaName: string | null; status: StoreRow['status'] | null };
  eligible: EligibleEmployee[];
  yearMonth: string;
  dateKey: string;
  onRefresh: () => void;
}) {
  const period: ViewPeriod = detail.period;
  const monthly = period === 'monthly';
  const phase = monthPhase(yearMonth);
  const available = detail.actuals.available;

  const targets = heroTargets(detail);
  const salesActual = detail.actuals.storeActualSales;
  const txActual = detail.actuals.storeActualTransactionCount;
  const salesPct = pctOf(salesActual, targets.sales);
  const txPct = pctOf(txActual, targets.transactions);

  const sales = progressState({ pct: salesPct, target: targets.sales, monthly, phase, available });
  const tx = progressState({ pct: txPct, target: targets.transactions, monthly, phase, available });

  const salesRate = monthly ? runRate(targets.sales, salesActual, phase) : { remaining: 0, perDay: null };
  const txRate = monthly ? runRate(targets.transactions, txActual, phase) : { remaining: 0, perDay: null };
  const pace = monthly && phase.phase === 'current' ? phase.expectedPct : null;
  const closing = monthly && phase.phase === 'past' ? 'Kurang' : 'Sisa';

  const targetSet = detail.rollup.storeMonthlySalesTarget > 0 || detail.rollup.storeMonthlyTransactionTarget > 0;
  const teamSet = detail.employeeTargets.length > 0;
  const atvActual = txActual > 0 ? salesActual / txActual : 0;

  const ringPerforming = sales.performing;
  const periodBadge = monthly ? fmtMonthShort(yearMonth) : fmtDayShort(dateKey);

  return (
    <div className="space-y-4">
      <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing pct={ringPerforming ? salesPct : 0} tone={sales.tone} size={84} stroke={7} dashed={!ringPerforming && sales.health !== 'upcoming'}>
            {ringPerforming ? (
              <span className={cn('text-xl font-black tabular-nums', TONE[sales.tone].text)}>{salesPct}%</span>
            ) : sales.health === 'upcoming' ? (
              <Target className="h-6 w-6 text-indigo-400" />
            ) : sales.health === 'no_data' ? (
              <CloudOff className="h-6 w-6 text-slate-400" />
            ) : (
              <Gauge className="h-6 w-6 text-slate-300" />
            )}
          </ProgressRing>

          <div className="min-w-0 flex-1 basis-56">
            <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">{identity.name}</h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <CodeChip>{identity.storeNo}</CodeChip>
              {identity.areaName && <span className="truncate">{identity.areaName}</span>}
              {identity.status && <LifecycleBadge status={identity.status} />}
              {sales.health && ringPerforming && (
                <HealthChip
                  health={sales.health}
                  gapPt={sales.gapPt}
                  detail={pace !== null ? `Aktual ${salesPct}% · pace ${pace}%` : undefined}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700 ring-1 ring-inset ring-indigo-100">
              {periodBadge}
            </span>
            {(!targetSet || !teamSet) && <SetupSteps targetSet={targetSet} teamSet={teamSet} />}
          </div>
        </div>

        {!available && (
          <div
            className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700"
            title={detail.actuals.error}
          >
            <CloudOff className="h-3.5 w-3.5 shrink-0" />
            <p className="text-[11px] font-semibold">Data aktual Business Central tidak tersedia</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MetricCard
            icon={TrendingUp}
            label={monthly ? 'Sales' : 'Sales hari ini'}
            actual={salesActual}
            target={targets.sales}
            available={available && !(monthly && phase.phase === 'future')}
            tone={sales.tone}
            paceMarker={pace}
            format={fmtRp}
            closing={closing}
            perDay={salesRate.perDay}
          />
          <MetricCard
            icon={Receipt}
            label={monthly ? 'Transaksi' : 'Transaksi hari ini'}
            actual={txActual}
            target={targets.transactions}
            available={available && !(monthly && phase.phase === 'future')}
            tone={tx.tone}
            paceMarker={pace}
            format={fmtCount}
            closing={closing}
            perDay={txRate.perDay}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <Fact icon={Receipt} label="ATV">
            {available && atvActual > 0 ? fmtRpCompact(atvActual) : '—'}
            {detail.rollup.storeMonthlyAtvTarget > 0 && (
              <span className="ml-1.5 text-[11px] font-semibold text-slate-400">/ {fmtRpCompact(detail.rollup.storeMonthlyAtvTarget)}</span>
            )}
          </Fact>
          <Fact icon={Users} label="Team">
            {detail.rollup.rosterCount}
            <span className="ml-1 text-[11px] font-semibold text-slate-400">orang</span>
          </Fact>
          <Fact icon={Clock} label={monthly ? 'Bulan berjalan' : 'Hari'}>
            {!monthly
              ? fmtDayShort(dateKey)
              : phase.phase === 'current'
                ? <>Hari {phase.elapsed}/{phase.days}<span className="ml-1.5 text-[11px] font-semibold text-slate-400">pace {phase.expectedPct}%</span></>
                : phase.phase === 'past'
                  ? 'Selesai'
                  : 'Persiapan'}
          </Fact>
        </div>
      </article>

      <MonthlyTargetEditor
        key={`${detail.store.id}-${yearMonth}`}
        storeId={detail.store.id}
        yearMonth={yearMonth}
        salesTarget={detail.rollup.storeMonthlySalesTarget}
        transactionTarget={detail.rollup.storeMonthlyTransactionTarget}
        onSaved={onRefresh}
      />

      <TeamSection
        key={detail.store.id}
        detail={detail}
        eligible={eligible}
        yearMonth={yearMonth}
        period={period}
        phase={phase}
        onRefresh={onRefresh}
      />

      <NotesSection
        key={`${detail.store.id}-${yearMonth}-${detail.plan?.notes ?? ''}`}
        storeId={detail.store.id}
        yearMonth={yearMonth}
        initial={detail.plan?.notes ?? ''}
        onSaved={onRefresh}
      />
    </div>
  );
}

function DetailSkeleton({ identity }: { identity: { name: string; storeNo: string; areaName: string | null } | null }) {
  return (
    <div className="space-y-4" aria-busy="true">
      <article className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex items-center gap-4">
          <div className="h-[84px] w-[84px] shrink-0 animate-pulse rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-2.5">
            {identity ? (
              <>
                <h2 className="truncate text-xl font-bold tracking-tight text-slate-900">{identity.name}</h2>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <CodeChip>{identity.storeNo}</CodeChip>
                  {identity.areaName && <span>{identity.areaName}</span>}
                </div>
              </>
            ) : (
              <>
                <div className="h-5 w-1/2 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
              <div className="h-7 w-2/3 animate-pulse rounded bg-slate-100" />
              <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </article>
      <div className="h-16 animate-pulse rounded-2xl border border-slate-200 bg-white" />
      <div className="h-48 animate-pulse rounded-2xl border border-slate-200 bg-white" />
    </div>
  );
}

// ─── Public ───────────────────────────────────────────────────────────────────

export default function StoreDetail({
  store,
  detail,
  loading,
  error,
  eligible,
  yearMonth,
  dateKey,
  nav,
  onBack,
  onRefresh,
}: {
  /** The overview row — names the store instantly, before its detail has loaded. */
  store: StoreRow | null;
  detail: DetailResponse | null;
  loading: boolean;
  error: string | null;
  eligible: EligibleEmployee[];
  yearMonth: string;
  dateKey: string;
  nav: StoreNav | null;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const identity = detail
    ? {
        name: detail.store.name,
        storeNo: detail.store.storeNo,
        areaName: detail.store.areaName,
        status: store?.status ?? null,
      }
    : store
      ? { name: store.name, storeNo: store.storeNo, areaName: store.areaName, status: store.status }
      : null;

  return (
    <div className="space-y-4">
      <TopBar onBack={onBack} nav={nav} />
      {error ? (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
          <CircleAlert className="h-4 w-4 shrink-0" />
          <p className="min-w-0 flex-1 text-sm font-semibold">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
          >
            Coba lagi
          </button>
        </div>
      ) : loading || !detail || !identity ? (
        <DetailSkeleton identity={identity} />
      ) : (
        <DetailBody
          detail={detail}
          identity={identity}
          eligible={eligible}
          yearMonth={yearMonth}
          dateKey={dateKey}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
}
