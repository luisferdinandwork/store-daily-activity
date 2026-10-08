'use client';
// app/ops/petty-cash/requests/page.tsx
//
// Ops · Petty Cash · Requests
//
// The spending requests PIC 1 files ("buy a galon, Rp 45.000") — Ops approves or
// rejects each one. Drawn like Finance's Transactions sheet so a request reads the
// same in either panel, with search, filters (area, category, status) and sorting
// (dropdown or column headers) over the month picked in the header.
//
// A month is when the request was filed; anything still waiting on Ops is listed
// whatever its month so the queue can't hide (see lib/db/utils/petty-cash-ops.ts).
// "Total used" counts completed requests only, at the actual amount the PIC
// recorded — the same rule as Finance.
//
// Top-ups for a low cash box live on the Refills page.

import { useState } from 'react';
import { AlertTriangle, Wallet } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput, OpsSortControl } from '@/components/ops/layout/OpsToolbar';
import { KpiStrip, PhotoLightbox } from '@/components/finance/shared/sheet-kit';
import {
  DecisionButtons,
  Pager,
  PettyCashTabs,
  ReceiptThumb,
  ROW_HEAD,
  SheetEmpty,
  SheetFrame,
  SheetSkeleton,
  SortTh,
  StoreCell,
  TD,
  TH,
  TxStatusChip,
  WhenCell,
  num,
  rp,
  useJsonFeed,
  usePettyCashPending,
} from '@/components/ops/petty-cash/shared';
import {
  PAGE_SIZE,
  REQUEST_SORT_OPTIONS,
  TX_STATUS_LABEL,
  TX_STATUS_ORDER,
  TX_STATUS_TONE,
  countRequestsByStatus,
  defaultSortDir,
  filterRequestsExceptStatus,
  pageCount,
  sortRequests,
  totalsOfRequests,
  type OpsRequestRow,
  type OpsRequestsResponse,
  type RequestSortKey,
  type SortDir,
  type TxStatus,
} from '@/lib/ops-petty-cash';

/** First day of this month in Jakarta, as YYYY-MM-01 (what OpsPageHeader's month picker works in). */
function currentMonthStart() {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return `${now.slice(0, 7)}-01`;
}

export default function OpsPettyCashRequestsPage() {
  const [date, setDate] = useState(currentMonthStart);
  const month = date.slice(0, 7);

  const [query, setQuery] = useState('');
  const [area, setArea] = useState<'all' | number>('all');
  const [category, setCategory] = useState<'all' | string>('all');
  const [status, setStatus] = useState<'all' | TxStatus>('all');
  const [sort, setSort] = useState<{ key: RequestSortKey; dir: SortDir }>({ key: 'priority', dir: 'asc' });
  const [page, setPage] = useState(1);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<{ title: string; url: string } | null>(null);

  const feed = useJsonFeed<OpsRequestsResponse>(`/api/ops/petty-cash?month=${month}`);
  const { pending, refresh: refreshPending } = usePettyCashPending();

  const rows = feed.data?.data ?? [];
  const isHo = feed.data?.scope === 'all_areas';
  const loadingFirst = feed.loading && !feed.data;

  // HO sees every area and can narrow to one; an Area OPS has a single area, so
  // the dropdown would only ever hold one entry — it is left out entirely.
  const areaOptions = [...new Map(rows.map((r) => [r.areaId, r.areaName])).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const categoryOptions = [...new Set(rows.map((r) => r.categoryName).filter((c): c is string => Boolean(c)))].sort((a, b) =>
    a.localeCompare(b),
  );

  // Every filter but the status: the chips then count what each would give, and
  // the key numbers keep the whole breakdown while one status is picked.
  const scoped = filterRequestsExceptStatus(rows, { query, area: isHo ? area : 'all', category });
  const counts = countRequestsByStatus(scoped);
  const totals = totalsOfRequests(scoped);

  const filtered = status === 'all' ? scoped : scoped.filter((r) => r.status === status);
  const sorted = sortRequests(filtered, sort.key, sort.dir);

  const pages = pageCount(sorted.length);
  const currentPage = Math.min(page, pages);
  const offset = (currentPage - 1) * PAGE_SIZE;
  const pageRows = sorted.slice(offset, offset + PAGE_SIZE);

  const filtersActive = query.trim() !== '' || area !== 'all' || category !== 'all' || status !== 'all';

  function clearFilters() {
    setQuery('');
    setArea('all');
    setCategory('all');
    setStatus('all');
    setPage(1);
  }

  function sortBy(key: RequestSortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultSortDir(key) }));
    setPage(1);
  }

  async function decide(row: OpsRequestRow, action: 'approve' | 'reject', rejectionReason = '') {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/ops/petty-cash/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, rejectionReason }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error ?? 'Action failed.');

      toast.success(
        action === 'approve'
          ? `Approved — ${row.storeName}, ${rp(row.amount)}.`
          : `Rejected — ${row.storeName}, ${rp(row.amount)}.`,
      );
      feed.reload();
      refreshPending();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  const statusChips = [
    { key: 'all' as const, label: 'All', count: scoped.length },
    ...TX_STATUS_ORDER.map((s) => ({ key: s, label: TX_STATUS_LABEL[s], count: counts[s], tone: TX_STATUS_TONE[s] })),
  ];

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

      <OpsPageHeader
        scope={isHo ? 'OPS HO · All areas' : 'OPS · Area Approval'}
        title="Petty Cash"
        tabs={<PettyCashTabs pending={pending} />}
        periodProps={{
          period: 'monthly',
          date,
          onDateChange: (d) => {
            setDate(d);
            setPage(1);
          },
        }}
        onRefresh={() => {
          feed.reload();
          refreshPending();
        }}
        refreshing={feed.loading}
      />

      <div className="mx-auto space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {/* Key numbers */}
        {feed.data && (
          <KpiStrip
            items={[
              {
                label: 'Waiting OPS',
                value: String(totals.waiting),
                sub: totals.waiting > 0 ? `${rp(totals.waitingAmount)} requested` : 'nothing to approve',
                warn: totals.waiting > 0,
              },
              { label: 'Awaiting actual amount', value: String(totals.awaitingActual), sub: 'approved, PIC yet to record' },
              { label: 'Completed', value: String(totals.completed), sub: 'actual amount recorded' },
              { label: 'Rejected', value: String(totals.rejected), sub: 'by OPS' },
              { label: 'Total used', value: rp(totals.used), sub: 'completed requests, actual amount' },
            ]}
          />
        )}

        {/* Search / filter / sort */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput
              value={query}
              onChange={(v) => {
                setQuery(v);
                setPage(1);
              }}
              placeholder="Search store, code, item or PIC…"
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

            {categoryOptions.length > 0 && (
              <OpsFilterSelect
                label="Category"
                value={category}
                onChange={(v) => {
                  setCategory(v);
                  setPage(1);
                }}
              >
                <option value="all">All categories</option>
                {categoryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </OpsFilterSelect>
            )}

            <div className="ml-auto">
              <OpsSortControl
                options={REQUEST_SORT_OPTIONS}
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
              items={statusChips}
              value={status}
              onChange={(s) => {
                setStatus(s);
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
          <SheetSkeleton />
        ) : feed.data && sorted.length === 0 ? (
          <SheetEmpty
            icon={Wallet}
            title={filtersActive ? 'No requests match your filters.' : 'No petty cash requests this month.'}
            hint={filtersActive ? undefined : 'Try another month with the arrows above.'}
            onClear={filtersActive ? clearFilters : undefined}
          />
        ) : feed.data ? (
          <>
            <SheetFrame dimmed={feed.loading}>
              <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
                <thead>
                  <tr>
                    <th className={cn(TH, 'w-11 text-center')}>No</th>
                    <SortTh label="Date / PIC" sortKey="date" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <SortTh label="Store" sortKey="store" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <th className={cn(TH, 'text-left')}>Item</th>
                    <SortTh label="Requested (Rp)" sortKey="amount" active={sort.key} dir={sort.dir} onSort={sortBy} align="right" />
                    <th className={cn(TH, 'text-right')}>Actual (Rp)</th>
                    <th className={cn(TH, 'text-center')}>Receipt</th>
                    <SortTh label="Status" sortKey="priority" active={sort.key} dir={sort.dir} onSort={sortBy} />
                    <th className={cn(TH, 'text-right')}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((r, i) => {
                    const waiting = r.status === 'pending_ops';
                    const rejected = r.status === 'ops_rejected';

                    return (
                      <tr
                        key={r.id}
                        className={cn(
                          'text-[13px] transition-colors',
                          waiting ? 'bg-amber-50/50 hover:bg-amber-50' : 'bg-white hover:bg-indigo-50/40',
                        )}
                      >
                        <td className={cn(ROW_HEAD, 'w-11')}>{offset + i + 1}</td>
                        <td className={TD}>
                          <WhenCell iso={r.createdAt} who={r.submittedByName} />
                        </td>
                        <td className={cn(TD, 'min-w-52')}>
                          <StoreCell name={r.storeName} code={r.storeNo} area={isHo ? r.areaName : undefined} />
                        </td>
                        <td className={cn(TD, 'min-w-52')}>
                          <p className="line-clamp-2 leading-snug text-slate-700" title={r.description}>
                            {r.categoryName && (
                              <span className="mr-1.5 rounded bg-indigo-50 px-1.5 py-0.5 align-middle text-[10px] font-bold text-indigo-700">
                                {r.categoryName}
                              </span>
                            )}
                            {r.description}
                          </p>
                          {rejected && r.rejectionReason && (
                            <p className="mt-0.5 line-clamp-1 text-[11px] text-rose-600" title={r.rejectionReason}>
                              Rejected: {r.rejectionReason}
                            </p>
                          )}
                        </td>
                        <td
                          className={cn(
                            TD,
                            'whitespace-nowrap text-right tabular-nums',
                            rejected ? 'text-slate-400 line-through' : 'text-slate-700',
                          )}
                        >
                          {num(r.amount)}
                        </td>
                        <td className={cn(TD, 'whitespace-nowrap text-right tabular-nums text-slate-900')}>
                          {r.actualAmount != null ? num(r.actualAmount) : <span className="text-slate-300">–</span>}
                        </td>
                        <td className={cn(TD, 'py-1')}>
                          <span className="flex justify-center">
                            <ReceiptThumb
                              url={r.imageUrl}
                              onOpen={() => r.imageUrl && setLightbox({ title: `${r.storeNo} · ${r.storeName}`, url: r.imageUrl })}
                            />
                          </span>
                        </td>
                        <td className={TD}>
                          <TxStatusChip status={r.status} />
                        </td>
                        <td className={TD}>
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
              <span className="font-semibold">Requested</span> is the PIC&apos;s estimate;{' '}
              <span className="font-semibold">Actual</span> appears once the PIC records what was really spent. Total used
              counts completed requests only. Anything still waiting for OPS is listed whatever the month.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
