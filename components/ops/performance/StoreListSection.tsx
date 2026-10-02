'use client';
// components/ops/performance/StoreListSection.tsx
//
// The Performance Targets overview: a one-glance summary, a search / filter /
// sort bar, and the store list. Numbers, rings and colours carry the message —
// words are limited to labels.
//
//   ┌ summary tiles ─ Sales · Transaksi · Toko (health split) · Target (setup)
//   ├ toolbar ─ search · area · sort · group · chips (On track / Waspada / …)
//   └ list ─ one row per store: ring · name+code · sales · transaksi

import { useMemo, type ElementType, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarPlus,
  CircleAlert,
  CloudOff,
  FilterX,
  Layers,
  Plus,
  Receipt,
  SearchX,
  Store,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { OpsList, OpsListRow, OpsListSkeleton } from '@/components/ops/layout/OpsList';
import {
  OpsChipTabs,
  OpsFilterSelect,
  OpsSearchInput,
  OpsSortControl,
} from '@/components/ops/layout/OpsToolbar';
import {
  classifyProgress,
  fmtCount,
  fmtMonthShort,
  fmtRpCompact,
  HEALTH_META,
  pctOf,
  SORT_OPTIONS,
  type AssessedStore,
  type HealthFilter,
  type MonthPhase,
  type NetworkSummary,
  type SortKey,
  type Tone,
} from '@/lib/performance/target-view';
import {
  ActualOfTarget,
  CodeChip,
  LifecycleBadge,
  MicroLabel,
  ProgressRing,
  SetupChip,
  TargetBar,
  TONE,
} from './atoms';
import type { StoreListView } from './useStoreListView';

// Column widths — the header strip and every row share them so they line up.
// Rows are laid out by the list's own width (container queries), not the
// viewport: the Ops sidebar takes a quarter of the screen, so a 1024px laptop
// has less room than its width suggests.
//   < @2xl   two lines: the name gets a full line, sales + transaksi sit beneath it
//   @2xl+    one line per store: ring · name · sales
//   @4xl+    …plus the transaksi column (hidden in between so names stay readable)
const ROW_LAYOUT = 'md:flex-wrap @2xl:flex-nowrap';
// Narrow: ring + name fill the first line exactly (100% − 44px ring − 16px gap).
const COL_NAME = 'min-w-0 w-[calc(100%-3.75rem)] @2xl:w-auto @2xl:flex-1 @2xl:basis-48';
const COL_SALES = 'min-w-[9.5rem] flex-1 @2xl:w-44 @2xl:flex-none';
const COL_TX = 'w-28 shrink-0 @2xl:hidden @4xl:block';

// ─── Summary ──────────────────────────────────────────────────────────────────

function Tile({
  icon: Icon,
  tone,
  label,
  right,
  children,
}: {
  icon: ElementType;
  tone: Tone;
  label: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg', TONE[tone].soft)}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <MicroLabel>{label}</MicroLabel>
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Sales / Transaksi tile: the network total against its target. */
function ProgressTile({
  icon,
  label,
  actual,
  actualAll,
  target,
  format,
  phase,
}: {
  icon: ElementType;
  label: string;
  /** Actual over the stores that have a target — the like-for-like base of the %. */
  actual: number;
  /** Actual over every store in scope — shown while no store has a target. */
  actualAll: number;
  target: number;
  format: (n: number) => string;
  phase: MonthPhase;
}) {
  const hasTarget = target > 0;
  const upcoming = phase.phase === 'future';
  const pct = pctOf(actual, target);
  const tone: Tone = !hasTarget ? 'slate' : upcoming ? 'indigo' : HEALTH_META[classifyProgress(pct, phase)].tone;

  return (
    <Tile
      icon={icon}
      tone={tone}
      label={label}
      right={
        hasTarget && !upcoming ? (
          <span className={cn('text-sm font-black tabular-nums', TONE[tone].text)}>{pct}%</span>
        ) : null
      }
    >
      <p className="truncate text-2xl font-black tabular-nums text-slate-900">
        {!hasTarget ? format(actualAll) : upcoming ? format(target) : format(actual)}
      </p>
      {!hasTarget ? (
        <p className="mt-2.5 text-[11px] font-semibold text-amber-600">Belum ada target</p>
      ) : upcoming ? (
        <p className="mt-2.5 text-[11px] font-semibold text-slate-400">Target bulan ini</p>
      ) : (
        <>
          <TargetBar pct={pct} tone={tone} className="mt-3" />
          <p
            className="mt-1.5 text-[11px] tabular-nums text-slate-400"
            title="Dihitung dari toko yang sudah punya target"
          >
            dari {format(target)}
          </p>
        </>
      )}
    </Tile>
  );
}

const SEGMENT_ORDER: { key: 'good' | 'watch' | 'behind' | 'upcoming'; tone: Tone; label: string }[] = [
  { key: 'good', tone: 'emerald', label: 'On track' },
  { key: 'watch', tone: 'amber', label: 'Waspada' },
  { key: 'behind', tone: 'rose', label: 'Tertinggal' },
  { key: 'upcoming', tone: 'indigo', label: 'Siap' },
];

/** Toko tile: how many stores sit in each health bucket; the legend filters the list. */
function HealthTile({
  summary,
  active,
  onFilter,
}: {
  summary: NetworkSummary;
  active: HealthFilter;
  onFilter: (f: HealthFilter) => void;
}) {
  const c = summary.counts;
  const counts = {
    good: c.achieved + c.on_track,
    watch: c.watch,
    behind: c.behind,
    upcoming: c.upcoming,
  };
  const other = c.no_target + c.no_data;
  const total = summary.storeCount || 1;

  return (
    <Tile icon={Store} tone="slate" label="Toko">
      <p className="text-2xl font-black tabular-nums text-slate-900">{summary.storeCount}</p>
      <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {SEGMENT_ORDER.map((s) =>
          counts[s.key] > 0 ? (
            <span
              key={s.key}
              className={TONE[s.tone].bar}
              style={{ width: `${(counts[s.key] / total) * 100}%` }}
            />
          ) : null,
        )}
        {other > 0 && <span className="bg-slate-300" style={{ width: `${(other / total) * 100}%` }} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {SEGMENT_ORDER.filter((s) => counts[s.key] > 0).map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onFilter(active === s.key ? 'all' : s.key)}
            aria-pressed={active === s.key}
            className={cn(
              'inline-flex items-center gap-1 rounded-md text-[11px] font-semibold transition-colors hover:text-slate-900',
              active === s.key ? 'text-slate-900' : 'text-slate-500',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', TONE[s.tone].bar)} />
            <span className="font-black tabular-nums">{counts[s.key]}</span>
            {s.label}
          </button>
        ))}
        {summary.storeCount === 0 && <span className="text-[11px] text-slate-400">—</span>}
      </div>
    </Tile>
  );
}

/** Target tile: how many stores have a target set, and what still needs setup. */
function SetupTile({
  summary,
  active,
  onFilter,
}: {
  summary: NetworkSummary;
  active: HealthFilter;
  onFilter: (f: HealthFilter) => void;
}) {
  const missing = summary.storeCount - summary.plannedCount;
  const complete = summary.storeCount > 0 && missing === 0 && summary.noTeamCount === 0;
  const pct = pctOf(summary.plannedCount, summary.storeCount);

  return (
    <Tile
      icon={Target}
      tone={complete ? 'emerald' : 'amber'}
      label="Target"
      right={complete ? <span className="text-[11px] font-bold text-emerald-600">Lengkap</span> : null}
    >
      <p className="text-2xl font-black tabular-nums text-slate-900">
        {summary.plannedCount}
        <span className="text-base font-bold text-slate-300">/{summary.storeCount}</span>
      </p>
      <TargetBar pct={pct} tone={complete ? 'emerald' : 'amber'} className="mt-3" />
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {missing > 0 && (
          <button
            type="button"
            onClick={() => onFilter(active === 'setup' ? 'all' : 'setup')}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
          >
            <CircleAlert className="h-3 w-3" />
            <span className="font-black tabular-nums">{missing}</span> belum target
          </button>
        )}
        {summary.noTeamCount > 0 && (
          <button
            type="button"
            onClick={() => onFilter(active === 'setup' ? 'all' : 'setup')}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-900"
          >
            <Users className="h-3 w-3" />
            <span className="font-black tabular-nums">{summary.noTeamCount}</span> tanpa Team
          </button>
        )}
        {complete && <span className="text-[11px] text-slate-400">Semua toko siap</span>}
      </div>
    </Tile>
  );
}

function SummaryTiles({ view }: { view: StoreListView }) {
  const { summary, phase, healthFilter, setHealthFilter } = view;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <ProgressTile
        icon={TrendingUp}
        label="Sales"
        actual={summary.salesActual}
        actualAll={summary.salesActualAll}
        target={summary.salesTarget}
        format={fmtRpCompact}
        phase={phase}
      />
      <ProgressTile
        icon={Receipt}
        label="Transaksi"
        actual={summary.transactionActual}
        actualAll={summary.transactionActualAll}
        target={summary.transactionTarget}
        format={fmtCount}
        phase={phase}
      />
      <HealthTile summary={summary} active={healthFilter} onFilter={setHealthFilter} />
      <SetupTile summary={summary} active={healthFilter} onFilter={setHealthFilter} />
    </div>
  );
}

function SummaryHeading({
  yearMonth,
  phase,
  nextYearMonth,
  onGoNextMonth,
}: {
  yearMonth: string;
  phase: MonthPhase;
  nextYearMonth: string;
  onGoNextMonth: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
        <span>{fmtMonthShort(yearMonth)}</span>
        {phase.phase === 'current' && (
          <>
            <span className="text-slate-300">·</span>
            <span>
              Hari {phase.elapsed}/{phase.days}
            </span>
          </>
        )}
        {phase.phase === 'past' && <span className="text-slate-300">· Selesai</span>}
        {phase.phase === 'future' && <span className="text-indigo-500">· Persiapan</span>}
      </p>

      {yearMonth < nextYearMonth && (
        <button
          type="button"
          onClick={onGoNextMonth}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-indigo-200 bg-white px-3 text-xs font-bold text-indigo-700 transition hover:bg-indigo-50"
        >
          <CalendarPlus className="h-3.5 w-3.5" />
          Siapkan {fmtMonthShort(nextYearMonth)}
        </button>
      )}
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({ view }: { view: StoreListView }) {
  const {
    search, setSearch, areaFilter, setAreaFilter, sortKey, sortDir, setSort,
    groupByArea, setGroupByArea, areas, chips, healthFilter, setHealthFilter,
    filtersActive, clearFilters, visible, scoped, closedCount, showClosed, setShowClosed,
  } = view;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <OpsSearchInput value={search} onChange={setSearch} placeholder="Cari kode, nama, atau area…" />

        {areas.length > 1 && (
          <OpsFilterSelect label="Area" value={areaFilter} onChange={setAreaFilter}>
            <option value="all">Semua area</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </OpsFilterSelect>
        )}

        <OpsSortControl options={SORT_OPTIONS} sortKey={sortKey} sortDir={sortDir} onChange={setSort} />

        {areas.length > 1 && (
          <button
            type="button"
            onClick={() => setGroupByArea(!groupByArea)}
            aria-pressed={groupByArea}
            title={groupByArea ? 'Per area — klik untuk satu daftar' : 'Satu daftar — klik untuk per area'}
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
              groupByArea
                ? 'border-indigo-300 bg-indigo-50 text-indigo-700'
                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50',
            )}
          >
            <Layers className="h-4 w-4" />
          </button>
        )}

        {filtersActive && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <FilterX className="h-4 w-4" />
            Reset
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <OpsChipTabs
          items={chips}
          value={healthFilter}
          onChange={setHealthFilter}
        />
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {closedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowClosed(!showClosed)}
              aria-pressed={showClosed}
              className={cn(
                'rounded-full px-2.5 py-1 font-bold transition-colors',
                showClosed ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              )}
            >
              Tutup · {closedCount}
            </button>
          )}
          <span className="tabular-nums">
            {visible.length === scoped.length ? `${visible.length} toko` : `${visible.length} dari ${scoped.length} toko`}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function SortHeader({ label, sortKey, view }: { label: string; sortKey: SortKey; view: StoreListView }) {
  const active = view.sortKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => view.toggleSortBy(sortKey)}
      className={cn(
        'inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors hover:text-slate-700',
        active ? 'text-indigo-600' : 'text-slate-400',
      )}
    >
      {label}
      {active && (view.sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
    </button>
  );
}

function ListHeader({ view }: { view: StoreListView }) {
  return (
    <li className="hidden items-center gap-x-4 border-b border-slate-100 bg-slate-50/70 px-4 py-2 sm:px-5 @2xl:flex">
      <span className="w-11 shrink-0" />
      <div className="min-w-0 flex-1">
        <SortHeader label="Toko" sortKey="name" view={view} />
      </div>
      <div className="w-44 shrink-0">
        <SortHeader label="Sales" sortKey="achievement" view={view} />
      </div>
      <div className="hidden w-28 shrink-0 @4xl:block">
        <SortHeader label="Transaksi" sortKey="transactions" view={view} />
      </div>
      <span className="w-4 shrink-0" />
    </li>
  );
}

function AreaRow({ name, summary, phase }: { name: string; summary: NetworkSummary; phase: MonthPhase }) {
  const pct = pctOf(summary.salesActual, summary.salesTarget);
  const hasTarget = summary.salesTarget > 0;
  const tone: Tone = !hasTarget || phase.phase === 'future'
    ? 'slate'
    : HEALTH_META[classifyProgress(pct, phase)].tone;

  return (
    <li className="flex items-center gap-3 border-y border-slate-100 bg-slate-50 px-4 py-2 first:border-t-0 sm:px-5">
      <p className="min-w-0 truncate text-[11px] font-bold uppercase tracking-widest text-slate-500">{name}</p>
      <span className="shrink-0 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
        {summary.storeCount} toko
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {hasTarget && phase.phase !== 'future' && (
          <>
            <span className="hidden whitespace-nowrap text-[11px] tabular-nums text-slate-400 @2xl:inline">
              {fmtRpCompact(summary.salesActual)} / {fmtRpCompact(summary.salesTarget)}
            </span>
            <TargetBar pct={pct} tone={tone} thin className="w-14 @2xl:w-24" />
            <span className={cn('w-9 text-right text-[11px] font-black tabular-nums', TONE[tone].text)}>{pct}%</span>
          </>
        )}
      </div>
    </li>
  );
}

function RingContent({ item }: { item: AssessedStore }) {
  const { a } = item;
  const tone = HEALTH_META[a.health].tone;

  switch (a.health) {
    case 'achieved':
    case 'on_track':
    case 'watch':
    case 'behind':
      return <span className={cn('text-[11px] font-black tabular-nums', TONE[tone].text)}>{a.pct}%</span>;
    case 'upcoming':
      return <Target className="h-4 w-4 text-indigo-400" />;
    case 'no_target':
      return <Plus className="h-4 w-4 text-amber-500" strokeWidth={3} />;
    case 'no_data':
      return <CloudOff className="h-4 w-4 text-slate-400" />;
  }
}

function StoreRowItem({
  item,
  phase,
  showArea,
  onOpen,
}: {
  item: AssessedStore;
  phase: MonthPhase;
  showArea: boolean;
  onOpen: () => void;
}) {
  const { row, a } = item;
  const r = row.rollup;
  const meta = HEALTH_META[a.health];
  const performing = a.health === 'achieved' || a.health === 'on_track' || a.health === 'watch' || a.health === 'behind';
  const upcoming = a.health === 'upcoming';

  const showActuals = r.actualsAvailable && phase.phase !== 'future';
  const txTone: Tone = performing && r.storeMonthlyTransactionTarget > 0
    ? HEALTH_META[classifyProgress(a.txPct, phase)].tone
    : 'slate';

  return (
    <OpsListRow onClick={onOpen} ariaLabel={`Buka ${row.name}`} className={cn('hover:bg-indigo-50/30', ROW_LAYOUT)}>
      <ProgressRing
        pct={performing ? a.pct : 0}
        tone={meta.tone}
        dashed={!performing && !upcoming}
        size={44}
      >
        <RingContent item={item} />
      </ProgressRing>

      <div className={COL_NAME}>
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-bold text-slate-900" title={row.name}>{row.name}</p>
          <LifecycleBadge status={row.status} />
          {(a.health === 'no_target' || a.health === 'no_data') && <SetupChip health={a.health} />}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
          <CodeChip>{row.storeNo}</CodeChip>
          {showArea && row.areaName && <span className="truncate">{row.areaName}</span>}
          <span
            className={cn('inline-flex shrink-0 items-center gap-1 tabular-nums', a.noTeam && 'font-bold text-amber-600')}
            title={a.noTeam ? 'Belum ada karyawan di Team' : `${r.rosterCount} karyawan di Team`}
          >
            <Users className="h-3 w-3" />
            {r.rosterCount}
          </span>
        </div>
      </div>

      <div className={COL_SALES}>
        <ActualOfTarget
          actual={showActuals ? r.storeActualSales : null}
          target={r.storeMonthlySalesTarget}
          format={fmtRpCompact}
          dim={!showActuals}
        />
        <TargetBar pct={performing ? a.pct : 0} tone={meta.tone} className="mt-1.5" />
      </div>

      <div className={COL_TX}>
        <ActualOfTarget
          actual={showActuals ? r.storeActualTransactionCount : null}
          target={r.storeMonthlyTransactionTarget}
          format={fmtCount}
          dim={!showActuals}
        />
        <TargetBar
          pct={performing ? a.txPct : 0}
          tone={txTone}
          thin
          className="mt-2"
        />
      </div>
    </OpsListRow>
  );
}

function EmptyState({ view }: { view: StoreListView }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <SearchX className="h-5 w-5" />
      </div>
      <p className="text-sm font-bold text-slate-700">Tidak ada toko yang cocok</p>
      {view.filtersActive && (
        <button
          type="button"
          onClick={view.clearFilters}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-500"
        >
          <FilterX className="h-3.5 w-3.5" />
          Reset filter
        </button>
      )}
    </div>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-3 w-16 animate-pulse rounded bg-slate-100" />
          <div className="h-7 w-24 animate-pulse rounded bg-slate-100" />
          <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function StoreListSection({
  view,
  yearMonth,
  nextYearMonth,
  loading,
  onOpenStore,
  onGoNextMonth,
}: {
  view: StoreListView;
  yearMonth: string;
  nextYearMonth: string;
  loading: boolean;
  onOpenStore: (storeId: number) => void;
  onGoNextMonth: () => void;
}) {
  const { phase, visible, groups, groupByArea } = view;
  const showArea = !groupByArea && view.areas.length > 1;

  const rows = useMemo(() => {
    if (!groupByArea) {
      return visible.map((item) => (
        <StoreRowItem key={item.row.id} item={item} phase={phase} showArea={showArea} onOpen={() => onOpenStore(item.row.id)} />
      ));
    }
    return groups.flatMap((g) => [
      <AreaRow key={`area-${g.name}`} name={g.name} summary={g.summary} phase={phase} />,
      ...g.items.map((item) => (
        <StoreRowItem key={item.row.id} item={item} phase={phase} showArea={false} onOpen={() => onOpenStore(item.row.id)} />
      )),
    ]);
  }, [groupByArea, groups, visible, phase, showArea, onOpenStore]);

  return (
    <div className="space-y-4">
      <SummaryHeading yearMonth={yearMonth} phase={phase} nextYearMonth={nextYearMonth} onGoNextMonth={onGoNextMonth} />

      {loading ? <SummarySkeleton /> : <SummaryTiles view={view} />}

      <Toolbar view={view} />

      {loading ? (
        <OpsListSkeleton rows={8} />
      ) : visible.length === 0 ? (
        <EmptyState view={view} />
      ) : (
        <OpsList className="@container">
          <ListHeader view={view} />
          {rows}
        </OpsList>
      )}
    </div>
  );
}
