'use client';
// app/ops/petty-cash/stores/page.tsx
//
// Ops · Petty Cash · Stores
//
// Every store in scope with where its petty cash stands RIGHT NOW: the period in use, the cash PIC 1 can spend
// (bar against Rp 1.000.000), what was used in that period, what is still open (waiting on OPS / on PIC 1) and
// where its Refill is — ONE status per store. An OPS Area user only ever gets their own area's stores (the API is
// scoped server-side); OPS HO / IT see every area and can narrow by area and store.
//
// Read-only: a row opens the store's slide-over (its requests and Refills); approving / rejecting stays on the
// Requests and Refills tabs. Drawn like those two (Finance-style sheet, same toolbar, KPI strip, tabs), with
// cards on phones. Logic: lib/ops-petty-cash-stores.ts, data: lib/db/utils/petty-cash-ops-stores.ts.

import { useMemo, useState } from 'react';
import { AlertTriangle, Store } from 'lucide-react';

import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput, OpsSortControl } from '@/components/ops/layout/OpsToolbar';
import { KpiStrip, type KpiItem } from '@/components/finance/shared/sheet-kit';
import { ChipScroller } from '@/components/ops/mobile/MobileKit';
import {
  CardListSkeleton,
  MobileFilterRow,
  MobileKpiScroller,
  MobileSearch,
  MobileSelect,
  MobileSort,
  PettyCashMobileHeader,
} from '@/components/ops/mobile/PettyCashMobile';
import { StoreCombobox } from '@/components/shared/store-combobox';
import {
  Pager,
  PettyCashTabs,
  ROW_HEAD,
  SheetEmpty,
  SheetFrame,
  SheetSkeleton,
  SortTh,
  StoreCell,
  TD,
  TH,
  fmtWhen,
  num,
  rp,
  useJsonFeed,
  usePettyCashPending,
} from '@/components/ops/petty-cash/shared';
import {
  BalanceCell,
  OpenCounts,
  Pic1Cell,
  RefillCell,
  StoreStatusChip,
} from '@/components/ops/petty-cash/store-pieces';
import { StoreDetailSheet } from '@/components/ops/petty-cash/StoreDetailSheet';
import { PeriodBadge } from '@/components/petty-cash/PeriodBadge';
import { PAGE_SIZE, pageCount } from '@/lib/ops-petty-cash';
import { periodMonthName, periodRangeLabel } from '@/lib/petty-cash-period';
import {
  PETTY_CASH_MAX,
  STORE_SORT_OPTIONS,
  STORE_STATUS_DOT,
  STORE_STATUS_META,
  STORE_STATUS_ORDER,
  countStoresByStatus,
  defaultStoreSortDir,
  filterStoresExceptStatus,
  sortStores,
  storeStatusOf,
  totalsOfStores,
  type PettyCashStoreRow,
  type PettyCashStoresResponse,
  type SortDir,
  type StoreSortKey,
  type StoreStatusKey,
} from '@/lib/ops-petty-cash-stores';

export default function OpsPettyCashStoresPage() {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<'all' | number>('all');
  const [store, setStore] = useState<number | null>(null);
  const [status, setStatus] = useState<'all' | StoreStatusKey>('all');
  const [sort, setSort] = useState<{ key: StoreSortKey; dir: SortDir }>({ key: 'priority', dir: 'asc' });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<number | null>(null);

  const feed = useJsonFeed<PettyCashStoresResponse>('/api/ops/petty-cash/stores');
  const { pending, refresh: refreshPending } = usePettyCashPending();

  const rows = useMemo(() => feed.data?.stores ?? [], [feed.data]);
  const isHo = feed.data?.scope === 'all_areas';
  const max = feed.data?.maxBalance ?? PETTY_CASH_MAX;
  const loadingFirst = feed.loading && !feed.data;

  const areaOptions = useMemo(
    () =>
      [...new Map(rows.map((r) => [r.areaId, r.areaName])).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows],
  );
  // The store picker follows the area picked.
  const storeOptions = useMemo(
    () =>
      rows
        .filter((r) => area === 'all' || r.areaId === area)
        .map((r) => ({ id: r.storeId, storeNo: r.storeNo, name: r.storeName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [rows, area],
  );

  const scoped = filterStoresExceptStatus(rows, { query, area: isHo ? area : 'all', store });
  const counts = countStoresByStatus(scoped);
  const totals = totalsOfStores(scoped);

  const filtered = status === 'all' ? scoped : scoped.filter((r) => storeStatusOf(r) === status);
  const sorted = sortStores(filtered, sort.key, sort.dir);

  const pages = pageCount(sorted.length);
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(offset, offset + PAGE_SIZE);

  const opened = openId == null ? null : (rows.find((r) => r.storeId === openId) ?? null);
  const filtersActive = query.trim() !== '' || area !== 'all' || store != null || status !== 'all';

  // The period most stores are in — named in the header line (a store a Refill moved ahead shows its own).
  const commonPeriod = useMemo(() => {
    const tally = new Map<string, number>();
    for (const r of rows) tally.set(r.periodMonth, (tally.get(r.periodMonth) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [rows]);

  const resetPage = () => setPage(1);

  function clearFilters() {
    setQuery('');
    setArea('all');
    setStore(null);
    setStatus('all');
    setPage(1);
  }

  function sortBy(key: StoreSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultStoreSortDir(key) }));
    setPage(1);
  }

  const refreshAll = () => {
    feed.reload();
    refreshPending();
  };

  const statusChips = [
    { key: 'all' as const, label: 'All', count: scoped.length },
    ...STORE_STATUS_ORDER.filter((s) => s !== 'closed' || counts.closed > 0).map((s) => ({
      key: s,
      label: STORE_STATUS_META[s].label,
      count: counts[s],
      tone: STORE_STATUS_DOT[s],
    })),
  ];

  const kpis: KpiItem[] = [
    { label: 'Stores', value: String(totals.stores), sub: commonPeriod ? `Periode ${periodMonthName(commonPeriod)}` : undefined },
    { label: 'Cash in stores', value: rp(totals.spendable), sub: 'what PIC 1 can spend now' },
    { label: 'Used this period', value: rp(totals.used), sub: 'completed requests, actual amount' },
    {
      label: 'Waiting OPS',
      value: String(totals.waitingOps),
      sub: totals.waitingOps > 0 ? 'requests + refills to approve' : 'nothing to approve',
      warn: totals.waitingOps > 0,
    },
    {
      label: 'Refill overdue',
      value: String(totals.refillOverdue),
      sub: totals.refillOverdue > 0 ? 'PIC 1 blocked until sent' : 'every ended period sent',
      warn: totals.refillOverdue > 0,
    },
    {
      label: 'Low balance',
      value: String(totals.lowBalance),
      sub: 'below 30% of Rp 1.000.000',
      warn: totals.lowBalance > 0,
    },
  ];

  const changeArea = (v: string) => {
    setArea(v === 'all' ? 'all' : Number(v));
    setStore(null);
    resetPage();
  };

  const emptyTitle = filtersActive ? 'No stores match your filters.' : 'No stores with petty cash in your scope.';

  return (
    <div className="min-h-full bg-slate-50">
      <StoreDetailSheet store={opened} maxBalance={max} showArea={isHo} onClose={() => setOpenId(null)} />

      {/* ── Phones ─────────────────────────────────────────────────────────── */}
      <div className="md:hidden">
        <PettyCashMobileHeader isHo={isHo} pending={pending} onRefresh={refreshAll} refreshing={feed.loading} />

        <div className="space-y-3 px-4 pb-8 pt-3">
          {feed.data && <MobileKpiScroller items={kpis} />}

          <MobileSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              resetPage();
            }}
            placeholder="Search store, code or PIC 1…"
          />

          <ChipScroller
            items={statusChips}
            value={status}
            onChange={(s) => {
              setStatus(s);
              resetPage();
            }}
          />

          <MobileFilterRow>
            <MobileSort
              options={STORE_SORT_OPTIONS}
              sortKey={sort.key}
              sortDir={sort.dir}
              onChange={({ key, dir, keyChanged }) => {
                setSort({ key, dir: keyChanged ? defaultStoreSortDir(key) : dir });
                resetPage();
              }}
            />
            {isHo && areaOptions.length > 1 && (
              <MobileSelect
                label="Area"
                value={String(area)}
                active={area !== 'all'}
                onChange={changeArea}
                options={[{ value: 'all', label: 'All areas' }, ...areaOptions.map((a) => ({ value: String(a.id), label: a.name }))]}
              />
            )}
            {storeOptions.length > 1 && (
              <MobileSelect
                label="Store"
                value={store == null ? 'all' : String(store)}
                active={store != null}
                onChange={(v) => {
                  setStore(v === 'all' ? null : Number(v));
                  resetPage();
                }}
                options={[
                  { value: 'all', label: 'All stores' },
                  ...storeOptions.map((s) => ({ value: String(s.id), label: `${s.storeNo} · ${s.name}` })),
                ]}
              />
            )}
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="shrink-0 px-2 text-xs font-semibold text-slate-500 underline">
                Clear
              </button>
            )}
          </MobileFilterRow>

          {feed.error && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
              <p className="text-sm font-medium text-rose-700">{feed.error}</p>
            </div>
          )}

          {loadingFirst ? (
            <CardListSkeleton />
          ) : feed.data && sorted.length === 0 ? (
            <SheetEmpty icon={Store} title={emptyTitle} onClear={filtersActive ? clearFilters : undefined} />
          ) : feed.data ? (
            <>
              <ul className={cn('space-y-2.5 transition-opacity', feed.loading && 'opacity-60')}>
                {pageRows.map((r) => (
                  <StoreCard key={r.storeId} row={r} max={max} showArea={isHo} onOpen={() => setOpenId(r.storeId)} />
                ))}
              </ul>
              <Pager
                page={currentPage}
                pages={pages}
                from={offset + 1}
                to={offset + pageRows.length}
                total={sorted.length}
                noun="store"
                onPage={setPage}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* ── Desktop ────────────────────────────────────────────────────────── */}
      <OpsPageHeader
        display="desktop"
        className="hidden md:block"
        scope={isHo ? 'OPS HO · All areas' : 'OPS · Your area'}
        title="Petty Cash"
        subtitle={
          commonPeriod ? (
            <span>
              Where every store stands now · Periode {periodMonthName(commonPeriod)} ({periodRangeLabel(commonPeriod)})
            </span>
          ) : undefined
        }
        tabs={<PettyCashTabs pending={pending} />}
        onRefresh={refreshAll}
        refreshing={feed.loading}
      />

      <div className="hidden space-y-4 px-4 py-5 sm:px-6 md:block lg:px-8">
        {feed.data && <KpiStrip items={kpis} />}

        {/* Search / filter / sort */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                resetPage();
              }}
              placeholder="Search store, code or PIC 1…"
              className="max-w-md"
            />

            {isHo && areaOptions.length > 1 && (
              <OpsFilterSelect label="Area" value={String(area)} onChange={changeArea}>
                <option value="all">All areas</option>
                {areaOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </OpsFilterSelect>
            )}

            {storeOptions.length > 1 && (
              <StoreCombobox
                stores={storeOptions}
                value={store}
                onChange={(id) => {
                  setStore(id);
                  resetPage();
                }}
                allLabel="All stores"
                accent="cyan"
                className="w-64"
              />
            )}

            <div className="ml-auto">
              <OpsSortControl
                options={STORE_SORT_OPTIONS}
                sortKey={sort.key}
                sortDir={sort.dir}
                onChange={({ key, dir, keyChanged }) => {
                  setSort({ key, dir: keyChanged ? defaultStoreSortDir(key) : dir });
                  resetPage();
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <OpsChipTabs
              items={statusChips}
              value={status}
              onChange={(s) => {
                setStatus(s);
                resetPage();
              }}
            />
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-semibold text-slate-500 underline hover:text-slate-700"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {feed.error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{feed.error}</p>
          </div>
        )}

        {loadingFirst ? (
          <SheetSkeleton />
        ) : feed.data && sorted.length === 0 ? (
          <SheetEmpty icon={Store} title={emptyTitle} onClear={filtersActive ? clearFilters : undefined} />
        ) : feed.data ? (
          <>
            <SheetFrame dimmed={feed.loading}>
              <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <SortTh label="Store" sortKey="store" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <th className={cn(TH, 'text-left')}>PIC 1</th>
                    <SortTh label="Balance (Rp)" sortKey="balance" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <SortTh label="Used (Rp)" sortKey="used" active={sort.key} dir={sort.dir} onSort={sortBy} align="right" />
                    <th className={cn(TH, 'text-left')}>Open requests</th>
                    <th className={cn(TH, 'text-left')}>Refill</th>
                    <SortTh label="Last request" sortKey="activity" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <SortTh label="Status" sortKey="priority" active={sort.key} dir={sort.dir} onSort={sortBy} />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => (
                    <tr
                      key={r.storeId}
                      onClick={() => setOpenId(r.storeId)}
                      className={cn(
                        'cursor-pointer text-[13px] transition-colors hover:bg-indigo-50/40',
                        r.storeStatus === 'close' ? 'bg-slate-50 text-slate-400' : 'bg-white',
                      )}
                    >
                      <td className={cn(ROW_HEAD, 'w-11')}>{offset + i + 1}</td>
                      <td className={cn(TD, 'min-w-52')}>
                        <StoreCell name={r.storeName} code={r.storeNo} area={isHo ? r.areaName : undefined} />
                        {/* Only when a Refill already moved this store to a later period than the rest. */}
                        {r.periodMonth !== commonPeriod && <PeriodBadge month={r.periodMonth} className="mt-1" />}
                      </td>
                      <td className={cn(TD, 'min-w-36')}>
                        <Pic1Cell pic1={r.pic1} />
                      </td>
                      <td className={TD}>
                        <BalanceCell row={r} max={max} />
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-right tabular-nums')}>
                        <p className="font-semibold text-slate-900">{num(r.used)}</p>
                        <p className="text-[11px] text-slate-400">
                          {r.completedCount} request{r.completedCount === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className={TD}>
                        <OpenCounts row={r} />
                      </td>
                      <td className={TD}>
                        <RefillCell refill={r.refill} />
                      </td>
                      <td className={cn(TD, 'whitespace-nowrap text-slate-600')}>
                        {r.lastRequestAt ? fmtWhen(r.lastRequestAt) : <span className="text-slate-300">–</span>}
                      </td>
                      <td className={TD}>
                        <StoreStatusChip status={storeStatusOf(r)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SheetFrame>

            <Pager
              page={currentPage}
              pages={pages}
              from={offset + 1}
              to={offset + pageRows.length}
              total={sorted.length}
              noun="store"
              onPage={setPage}
            />

            <p className="text-[11px] text-slate-500">
              <span className="font-semibold">Balance</span> is the cash PIC 1 can spend now — the period&apos;s balance
              minus the previous period&apos;s Refill the store hasn&apos;t received yet.{' '}
              <span className="font-semibold">Used</span> counts completed requests of the period in use at the actual
              amount (requests Finance turned down are left out). Open a store for its requests and Refills.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ─── Phone card ──────────────────────────────────────────────────────────────

function StoreCard({
  row,
  max,
  showArea,
  onOpen,
}: {
  row: PettyCashStoreRow;
  max: number;
  showArea: boolean;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'w-full rounded-2xl border border-slate-200 p-3.5 text-left shadow-sm transition active:scale-[0.99]',
          row.storeStatus === 'close' ? 'bg-slate-50' : 'bg-white',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{row.storeName}</p>
            <p className="truncate font-mono text-[11px] text-slate-400">
              {row.storeNo}
              {showArea && <span className="font-sans"> · {row.areaName}</span>}
              <span className="font-sans"> · {row.pic1[0]?.name ?? 'No PIC 1'}</span>
            </p>
          </div>
          <StoreStatusChip status={storeStatusOf(row)} className="shrink-0" />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Balance · {periodMonthName(row.periodMonth)}</p>
            <div className="mt-1">
              <BalanceCell row={row} max={max} wide />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Used</p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{rp(row.used)}</p>
            <p className="text-[11px] text-slate-400">
              {row.completedCount} request{row.completedCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-start justify-between gap-3 border-t border-slate-100 pt-2.5">
          <OpenCounts row={row} />
          <RefillCell refill={row.refill} />
        </div>
      </button>
    </li>
  );
}
