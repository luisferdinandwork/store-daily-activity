'use client';
// app/ops/petty-cash/refills/page.tsx
//
// Ops · Petty Cash · Refills
//
// A PIC 1 asks for a top-up when the store's petty cash runs low; Ops approves or
// rejects it (Finance then sends the cash and the store confirms receipt — the
// Status column follows it, with Finance's words). To decide, Ops sees per request:
//
//   Used    what the store spent since its last refill (completed spending)
//   Refill  what it takes to bring the store back to the maximum — max − balance
//
// and opens the row for the plain list of items that makes up the usage. Same
// sheet look, search, filters and sorting as the Requests page.
//
// A month is when the request was filed; requests still waiting on Ops are listed
// whatever their month. See lib/db/utils/petty-cash-ops.ts for how the spending
// behind a request is worked out.
//
// Phones (below `md`) get cards instead of the sheet — same state, filters,
// opened rows and approve / reject (components/ops/mobile/PettyCashMobile.tsx).

import { Fragment, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput, OpsSortControl } from '@/components/ops/layout/OpsToolbar';
import { KpiStrip, PhotoLightbox, type KpiItem } from '@/components/finance/shared/sheet-kit';
import { ChipScroller, MonthStepper } from '@/components/ops/mobile/MobileKit';
import {
  CardListSkeleton,
  MobileFilterRow,
  MobileKpiScroller,
  MobileSearch,
  MobileSelect,
  MobileSort,
  PettyCashMobileHeader,
  RefillCard,
} from '@/components/ops/mobile/PettyCashMobile';
import {
  DecisionButtons,
  Pager,
  PettyCashTabs,
  ReceiptThumb,
  RefillStateChip,
  ROW_HEAD,
  SheetEmpty,
  SheetFrame,
  SheetSkeleton,
  SortTh,
  StoreCell,
  TD,
  TH,
  WhenCell,
  fmtDay,
  num,
  rp,
  useJsonFeed,
  usePettyCashPending,
} from '@/components/ops/petty-cash/shared';
import {
  PAGE_SIZE,
  REFILL_SORT_OPTIONS,
  REFILL_STATE_LABEL,
  REFILL_STATE_ORDER,
  REFILL_STATE_TONE,
  countRefillsByState,
  defaultSortDir,
  filterRefillsExceptState,
  pageCount,
  sortRefills,
  totalsOfRefills,
  type OpsRefillRow,
  type OpsRefillsResponse,
  type RefillSortKey,
  type RefillState,
  type SortDir,
} from '@/lib/ops-petty-cash';

/** First day of this month in Jakarta, as YYYY-MM-01 (what OpsPageHeader's month picker works in). */
function currentMonthStart() {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return `${now.slice(0, 7)}-01`;
}

// ─── Used cell: the amount + how much of the float it is ─────────────────────

function UsedCell({ row, max }: { row: OpsRefillRow; max: number }) {
  const usedPct = Math.min(100, Math.max(0, ((max - row.balance) / max) * 100));
  const leftPct = 100 - usedPct;
  // Same bands as Finance's balance colour: the less is left, the louder it gets.
  const bar = leftPct < 30 ? 'bg-rose-500' : leftPct < 60 ? 'bg-amber-400' : 'bg-slate-400';

  return (
    <div className="flex flex-col items-end gap-1" title={`${rp(row.balance)} left of ${rp(max)}`}>
      <span className={cn('tabular-nums', row.used === 0 ? 'text-slate-300' : 'text-slate-700')}>
        {row.used === 0 ? '–' : num(row.used)}
      </span>
      <span className="h-[3px] w-full max-w-24 overflow-hidden rounded-full bg-slate-200">
        <span className={cn('block h-full rounded-full', bar)} style={{ width: `${usedPct}%` }} />
      </span>
    </div>
  );
}

// ─── Opened row: the items behind the usage ──────────────────────────────────

function ItemsPanel({
  row,
  max,
  onOpenReceipt,
}: {
  row: OpsRefillRow;
  max: number;
  onOpenReceipt: (url: string) => void;
}) {
  const gap = Math.abs(row.refill - row.used);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-xs font-semibold text-slate-700">
          Items used {row.sinceAt ? `since the last refill · ${fmtDay(row.sinceAt)}` : 'since the store started'}
        </p>
        <p className="text-[11px] text-slate-400">
          {row.items.length} item{row.items.length === 1 ? '' : 's'}
        </p>
        <p className="ml-auto text-[11px] text-slate-500">
          Balance left <span className="font-semibold tabular-nums text-slate-700">{rp(row.balance)}</span> of {rp(max)}
        </p>
      </div>

      {row.notes && (
        <p className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600">
          PIC note: &ldquo;{row.notes}&rdquo;
        </p>
      )}
      {row.state === 'rejected' && row.rejectionReason && (
        <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-700">
          Rejected: {row.rejectionReason}
        </p>
      )}

      {row.items.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-5 text-center text-sm italic text-slate-400">
          No completed spending in this period.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-300 bg-white">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-[13px] [&_tbody>tr:last-child>td]:border-b-0">
            <thead>
              <tr>
                <th className={cn(TH, 'w-32 text-left')}>Date</th>
                <th className={cn(TH, 'text-left')}>Item</th>
                <th className={cn(TH, 'w-16 text-center')}>Receipt</th>
                <th className={cn(TH, 'w-36 text-right')}>Amount (Rp)</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map((item) => (
                <tr key={item.id} className="bg-white">
                  <td className={cn(TD, 'whitespace-nowrap text-slate-500')}>{fmtDay(item.createdAt)}</td>
                  <td className={cn(TD, 'max-w-0')}>
                    <div className="flex items-center gap-1.5">
                      {item.categoryName && (
                        <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                          {item.categoryName}
                        </span>
                      )}
                      <span className="truncate text-slate-600" title={item.description}>
                        {item.description}
                      </span>
                    </div>
                  </td>
                  <td className={cn(TD, 'py-1')}>
                    <span className="flex justify-center">
                      <ReceiptThumb size="sm" url={item.imageUrl} onOpen={() => item.imageUrl && onOpenReceipt(item.imageUrl)} />
                    </span>
                  </td>
                  <td className={cn(TD, 'text-right tabular-nums text-slate-900')}>{num(item.amount)}</td>
                </tr>
              ))}
              <tr className="bg-indigo-50 font-semibold text-slate-900">
                <td colSpan={3} className={cn(TD, 'text-right text-xs uppercase tracking-wide')}>
                  Total used
                </td>
                <td className={cn(TD, 'text-right tabular-nums')}>{num(row.used)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {gap >= 1 && (
        <p className="text-[11px] text-amber-700">
          The items add up to {rp(row.used)}, but the balance left means {rp(row.refill)} was used.
        </p>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function OpsPettyCashRefillsPage() {
  const [date, setDate] = useState(currentMonthStart);
  const month = date.slice(0, 7);

  const [query, setQuery] = useState('');
  const [area, setArea] = useState<'all' | number>('all');
  const [state, setState] = useState<'all' | RefillState>('all');
  const [sort, setSort] = useState<{ key: RefillSortKey; dir: SortDir }>({ key: 'priority', dir: 'asc' });
  const [page, setPage] = useState(1);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ title: string; url: string } | null>(null);

  const feed = useJsonFeed<OpsRefillsResponse>(`/api/ops/petty-cash/refill-requests?month=${month}`);
  const { pending, refresh: refreshPending } = usePettyCashPending();

  const rows = feed.data?.requests ?? [];
  const max = feed.data?.maxBalance ?? 1_000_000;
  const isHo = feed.data?.scope === 'all_areas';
  const loadingFirst = feed.loading && !feed.data;

  const areaOptions = [...new Map(rows.map((r) => [r.areaId, r.areaName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Every filter but the status: the chips then count what each would give, and
  // the key numbers keep the whole breakdown while one status is picked.
  const scoped = filterRefillsExceptState(rows, { query, area: isHo ? area : 'all' });
  const counts = countRefillsByState(scoped);
  const totals = totalsOfRefills(scoped);

  const filtered = state === 'all' ? scoped : scoped.filter((r) => r.state === state);
  const sorted = sortRefills(filtered, sort.key, sort.dir);

  const pages = pageCount(sorted.length);
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(offset, offset + PAGE_SIZE);

  const allOpen = pageRows.length > 0 && pageRows.every((r) => expanded.has(r.id));
  const filtersActive = query.trim() !== '' || area !== 'all' || state !== 'all';
  const colCount = 8;

  function clearFilters() {
    setQuery('');
    setArea('all');
    setState('all');
    setPage(1);
  }

  function sortBy(key: RefillSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultSortDir(key) }));
    setPage(1);
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (allOpen) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  }

  async function decide(row: OpsRefillRow, action: 'approve' | 'reject', rejectionReason = '') {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/ops/petty-cash/refill-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Action failed.');

      toast.success(
        action === 'approve'
          ? `Refill approved — ${row.storeName}, ${rp(row.refill)}.`
          : `Refill rejected — ${row.storeName}.`,
      );
      feed.reload();
      refreshPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  const stateChips = [
    { key: 'all' as const, label: 'All', count: scoped.length },
    ...REFILL_STATE_ORDER.map((s) => ({ key: s, label: REFILL_STATE_LABEL[s], count: counts[s], tone: REFILL_STATE_TONE[s] })),
  ];

  const kpis: KpiItem[] = [
    {
      label: 'Waiting OPS',
      value: String(totals.waiting),
      sub: totals.waiting > 0 ? `${rp(totals.waitingAmount)} to refill` : 'nothing to approve',
      warn: totals.waiting > 0,
    },
    {
      label: 'Approved',
      value: String(totals.inProgress),
      sub: totals.inProgress > 0 ? `${rp(totals.inProgressAmount)} · cash not received yet` : 'cash not received yet',
    },
    {
      label: 'Received',
      value: String(totals.received),
      sub: totals.received > 0 ? `${rp(totals.receivedAmount)} · confirmed by store` : 'confirmed by store',
    },
    { label: 'Rejected', value: String(totals.rejected), sub: 'by OPS' },
    { label: 'Total refill', value: rp(totals.refillAmount), sub: 'excluding rejected' },
  ];

  const refreshAll = () => {
    feed.reload();
    refreshPending();
  };

  const changeMonth = (d: string) => {
    setDate(d);
    setPage(1);
  };

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={[{ url: lightbox.url, label: 'Receipt' }]}
          index={0}
          onIndex={() => {}}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* ── Phones ─────────────────────────────────────────────────────────── */}
      <div className="md:hidden">
        <PettyCashMobileHeader isHo={isHo} pending={pending} onRefresh={refreshAll} refreshing={feed.loading} />

        <div className="space-y-3 px-4 pb-8 pt-3">
          <MonthStepper date={date} onChange={changeMonth} currentMonthStart={currentMonthStart()} />

          {feed.data && <MobileKpiScroller items={kpis} />}

          <MobileSearch
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="Search store, code or PIC…"
          />

          <ChipScroller
            items={stateChips}
            value={state}
            onChange={(st) => {
              setState(st);
              setPage(1);
            }}
          />

          <MobileFilterRow>
            <MobileSort
              options={REFILL_SORT_OPTIONS}
              sortKey={sort.key}
              sortDir={sort.dir}
              onChange={({ key, dir, keyChanged }) => {
                setSort({ key, dir: keyChanged ? defaultSortDir(key) : dir });
                setPage(1);
              }}
            />
            {isHo && areaOptions.length > 1 && (
              <MobileSelect
                label="Area"
                value={String(area)}
                active={area !== 'all'}
                onChange={(v) => {
                  setArea(v === 'all' ? 'all' : Number(v));
                  setPage(1);
                }}
                options={[{ value: 'all', label: 'All areas' }, ...areaOptions.map((a) => ({ value: String(a.id), label: a.name }))]}
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
            <SheetEmpty
              icon={Wallet}
              title={filtersActive ? 'No refill requests match your filters.' : 'No refill requests this month.'}
              hint={filtersActive ? undefined : 'Try another month with the arrows above.'}
              onClear={filtersActive ? clearFilters : undefined}
            />
          ) : feed.data ? (
            <>
              <div className={cn('space-y-2.5 transition-opacity', feed.loading && 'opacity-60')}>
                {pageRows.map((r) => (
                  <RefillCard
                    key={r.id}
                    row={r}
                    max={max}
                    isHo={isHo}
                    busy={busyId === r.id}
                    open={expanded.has(r.id)}
                    onToggle={() => toggle(r.id)}
                    onApprove={() => void decide(r, 'approve')}
                    onReject={(reason) => void decide(r, 'reject', reason)}
                    onOpenReceipt={(url) => setLightbox({ title: `${r.storeNo} · ${r.storeName}`, url })}
                  />
                ))}
              </div>
              <Pager
                page={currentPage}
                pages={pages}
                from={offset + 1}
                to={offset + pageRows.length}
                total={sorted.length}
                noun="request"
                onPage={setPage}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* ── Desktop ────────────────────────────────────────────────────────── */}
      <OpsPageHeader
        className="hidden md:block"
        scope={isHo ? 'OPS HO · All areas' : 'OPS · Area Approval'}
        title="Petty Cash"
        tabs={<PettyCashTabs pending={pending} />}
        periodProps={{
          period: 'monthly',
          date,
          onDateChange: changeMonth,
        }}
        onRefresh={refreshAll}
        refreshing={feed.loading}
      />

      <div className="mx-auto hidden space-y-4 px-4 py-5 sm:px-6 md:block lg:px-8">
        {/* Key numbers */}
        {feed.data && <KpiStrip items={kpis} />}

        {/* Search / filter / sort */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder="Search store, code or PIC…"
              className="max-w-md"
            />

            {isHo && areaOptions.length > 1 && (
              <OpsFilterSelect
                label="Area"
                value={String(area)}
                onChange={(v) => {
                  setArea(v === 'all' ? 'all' : Number(v));
                  setPage(1);
                }}
              >
                <option value="all">All areas</option>
                {areaOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </OpsFilterSelect>
            )}

            <div className="ml-auto">
              <OpsSortControl
                options={REFILL_SORT_OPTIONS}
                sortKey={sort.key}
                sortDir={sort.dir}
                onChange={({ key, dir, keyChanged }) => {
                  setSort({ key, dir: keyChanged ? defaultSortDir(key) : dir });
                  setPage(1);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <OpsChipTabs
              items={stateChips}
              value={state}
              onChange={(s) => {
                setState(s);
                setPage(1);
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
            {pageRows.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="ml-auto text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
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

        {/* Sheet */}
        {loadingFirst ? (
          <SheetSkeleton rows={6} />
        ) : feed.data && sorted.length === 0 ? (
          <SheetEmpty
            icon={Wallet}
            title={filtersActive ? 'No refill requests match your filters.' : 'No refill requests this month.'}
            hint={filtersActive ? undefined : 'Try another month with the arrows above.'}
            onClear={filtersActive ? clearFilters : undefined}
          />
        ) : feed.data ? (
          <>
            <SheetFrame dimmed={feed.loading}>
              <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-14 text-center')}>No</th>
                    <SortTh label="Store" sortKey="store" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <SortTh label="Requested / PIC" sortKey="date" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <th className={cn(TH, 'text-center')}>Items</th>
                    <SortTh label="Used (Rp)" sortKey="used" active={sort.key} dir={sort.dir} onSort={sortBy} align="right" />
                    <SortTh label="Refill (Rp)" sortKey="refill" active={sort.key} dir={sort.dir} onSort={sortBy} align="right" />
                    <SortTh label="Status" sortKey="priority" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <th className={cn(TH, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const open = expanded.has(r.id);
                    const waiting = r.state === 'pending';
                    const rejected = r.state === 'rejected';

                    return (
                      <Fragment key={r.id}>
                        <tr
                          onClick={() => toggle(r.id)}
                          onKeyDown={(e) => {
                            if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault();
                              toggle(r.id);
                            }
                          }}
                          tabIndex={0}
                          aria-expanded={open}
                          className={cn(
                            'cursor-pointer text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500',
                            open
                              ? 'bg-indigo-50/60'
                              : waiting
                                ? 'bg-amber-50/50 hover:bg-amber-50'
                                : 'bg-white hover:bg-indigo-50/40',
                          )}
                        >
                          <td className={cn(ROW_HEAD, 'w-14')}>
                            <span className="flex items-center justify-center gap-0.5">
                              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              {offset + i + 1}
                            </span>
                          </td>
                          <td className={cn(TD, 'min-w-52')}>
                            <StoreCell name={r.storeName} code={r.storeNo} area={isHo ? r.areaName : undefined} />
                          </td>
                          <td className={TD}>
                            <WhenCell iso={r.requestedAt} who={r.requestedByName ?? 'PIC'} />
                          </td>
                          <td className={cn(TD, 'text-center tabular-nums text-slate-600')}>
                            {r.items.length === 0 ? <span className="text-slate-300">–</span> : r.items.length}
                          </td>
                          <td className={cn(TD, 'w-32')}>
                            <UsedCell row={r} max={max} />
                          </td>
                          <td
                            className={cn(
                              TD,
                              'whitespace-nowrap text-right font-semibold tabular-nums',
                              rejected ? 'font-normal text-slate-400 line-through' : 'text-slate-900',
                            )}
                          >
                            {r.refill === 0 ? <span className="font-normal text-slate-300 no-underline">–</span> : num(r.refill)}
                          </td>
                          <td className={TD}>
                            <RefillStateChip state={r.state} />
                          </td>
                          <td className={TD} onClick={(e) => e.stopPropagation()}>
                            {waiting ? (
                              <DecisionButtons
                                busy={busyId === r.id}
                                onApprove={() => void decide(r, 'approve')}
                                onReject={(reason) => void decide(r, 'reject', reason)}
                              />
                            ) : (
                              <span className="block text-right text-slate-300">–</span>
                            )}
                          </td>
                        </tr>

                        {open && (
                          <tr>
                            <td colSpan={colCount} className="border-b border-slate-300 bg-slate-50 p-3">
                              <ItemsPanel
                                row={r}
                                max={max}
                                onOpenReceipt={(url) => setLightbox({ title: `${r.storeNo} · ${r.storeName}`, url })}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </SheetFrame>

            <Pager
              page={currentPage}
              pages={pages}
              from={offset + 1}
              to={offset + pageRows.length}
              total={sorted.length}
              noun="request"
              onPage={setPage}
            />

            <p className="text-[11px] text-slate-500">
              <span className="font-semibold">Used</span> is the completed spending since the store&apos;s last refill;{' '}
              <span className="font-semibold">Refill</span> is what it takes to bring the store back to {rp(max)}. Open a row
              to see the items. Anything still waiting for OPS is listed whatever the month.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
