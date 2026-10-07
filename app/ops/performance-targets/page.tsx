'use client';
// app/ops/performance-targets/page.tsx
//
// Performance Targets — monthly-fixed-percentage model.
//
//   • Ops sets ONE monthly sales + transaction target per store.
//   • The store's Team (PIC1, PIC2, SA1, …) gets a fixed % share of it, defaulted
//     from the IT-managed allocation grid; override one and the rest rebalance.
//   • An employee's daily target is flat: monthly target ÷ days they're scheduled.
//   • OPS HO sees every area, OPS Area only their own.
//
// This page is just the data layer: it loads the overview + a store's detail and
// switches between the two views.
//   components/ops/performance/StoreListSection.tsx  summary · search/filter/sort · rows
//   components/ops/performance/StoreDetail.tsx       hero · target · team · notes
//   components/ops/performance/useStoreListView.ts   list state (shared with the detail's ‹ ›)
//   lib/performance/target-view.ts                   month progress, health, sort, formatting

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import StoreListSection from '@/components/ops/performance/StoreListSection';
import StoreDetail from '@/components/ops/performance/StoreDetail';
import { useStoreListView } from '@/components/ops/performance/useStoreListView';
import { jakartaTodayKey } from '@/lib/day-bucket';
import {
  fmtDateLabel,
  fmtMonthLabel,
  shiftYearMonth,
  type DetailResponse,
  type EligibleEmployee,
  type OverviewResponse,
  type StoreRow,
  type ViewPeriod,
} from '@/lib/performance/target-view';

const NO_STORES: StoreRow[] = [];

type OverviewState = { key: string; data: OverviewResponse | null; error: string | null };
type DetailState = { key: string; data: DetailResponse | null; eligible: EligibleEmployee[]; error: string | null };

/** The element the page scrolls in (the Ops shell's <main>), for restoring position. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  return (el?.closest('main') as HTMLElement | null) ?? null;
}

export default function PerformanceTargetsPage() {
  const [dateKey, setDateKey] = useState(jakartaTodayKey());
  const [viewPeriod, setViewPeriod] = useState<ViewPeriod>('monthly');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);
  const [overviewState, setOverviewState] = useState<OverviewState | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  const [inflight, setInflight] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);
  const overviewRequest = useRef(0);
  const detailRequest = useRef(0);

  const yearMonth = dateKey.slice(0, 7);
  const detailKey = selectedStoreId != null
    ? `${selectedStoreId}|${yearMonth}|${viewPeriod}|${viewPeriod === 'daily' ? dateKey : ''}`
    : null;

  // ── Data ────────────────────────────────────────────────────────────────────
  // Both loaders keep what's on screen while they refetch ("refresh in place"),
  // and ignore a response once a newer request has started.

  const loadOverview = useCallback(async () => {
    const request = ++overviewRequest.current;
    setInflight((n) => n + 1);
    try {
      const res = await fetch(`/api/ops/performance-targets?yearMonth=${yearMonth}`, { cache: 'no-store' });
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok || !json.success) throw new Error(json.error ?? 'Gagal memuat data target.');
      if (request === overviewRequest.current) setOverviewState({ key: yearMonth, data: json, error: null });
    } catch (err) {
      if (request === overviewRequest.current) {
        setOverviewState({
          key: yearMonth,
          data: null,
          error: err instanceof Error ? err.message : 'Gagal memuat data target.',
        });
      }
    } finally {
      setInflight((n) => n - 1);
    }
  }, [yearMonth]);

  const loadDetail = useCallback(
    async (storeId: number, key: string) => {
      const request = ++detailRequest.current;
      setInflight((n) => n + 1);
      try {
        const params = new URLSearchParams({ yearMonth, period: viewPeriod });
        if (viewPeriod === 'daily') params.set('date', dateKey);

        const [detailRes, eligibleRes] = await Promise.all([
          fetch(`/api/ops/performance-targets/${storeId}?${params.toString()}`, { cache: 'no-store' }),
          fetch(`/api/ops/performance-targets/${storeId}/employees?yearMonth=${yearMonth}`, { cache: 'no-store' }),
        ]);
        const detailJson = (await detailRes.json()) as DetailResponse;
        const eligibleJson = await eligibleRes.json();
        if (!detailRes.ok || !detailJson.success) throw new Error(detailJson.error ?? 'Gagal memuat detail toko.');
        if (request === detailRequest.current) {
          setDetailState({
            key,
            data: detailJson,
            eligible: eligibleJson.success ? eligibleJson.employees : [],
            error: null,
          });
        }
      } catch (err) {
        if (request === detailRequest.current) {
          setDetailState({
            key,
            data: null,
            eligible: [],
            error: err instanceof Error ? err.message : 'Gagal memuat detail toko.',
          });
        }
      } finally {
        setInflight((n) => n - 1);
      }
    },
    [yearMonth, viewPeriod, dateKey],
  );

  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    if (selectedStoreId != null && detailKey != null) void loadDetail(selectedStoreId, detailKey);
  }, [selectedStoreId, detailKey, loadDetail]);

  const handleRefresh = useCallback(() => {
    void loadOverview();
    if (selectedStoreId != null && detailKey != null) void loadDetail(selectedStoreId, detailKey);
  }, [loadOverview, loadDetail, selectedStoreId, detailKey]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const overview = overviewState?.key === yearMonth ? overviewState.data : null;
  const overviewLoading = overviewState?.key !== yearMonth;
  const overviewError = overviewState?.key === yearMonth ? overviewState.error : null;

  const view = useStoreListView(overview?.stores ?? NO_STORES, yearMonth);

  const detailReady = detailState != null && detailState.key === detailKey;
  const detailLoading = detailKey != null && !detailReady;
  const detail = detailReady ? detailState.data : null;
  const detailError = detailReady ? detailState.error : null;

  const isHo = overview?.scope === 'all_areas';
  const headingScope = isHo ? 'Semua area' : (overview?.stores[0]?.areaName ?? 'Area Anda');
  const showingDetail = selectedStoreId != null;
  const selectedStore = overview?.stores.find((s) => s.id === selectedStoreId) ?? null;

  // ‹ › step through the list as currently filtered and sorted, in on-screen order.
  const position = view.ordered.findIndex((item) => item.row.id === selectedStoreId);
  const nav = showingDetail && position >= 0
    ? {
        position: position + 1,
        total: view.ordered.length,
        onPrev: position > 0 ? () => setSelectedStoreId(view.ordered[position - 1].row.id) : null,
        onNext: position < view.ordered.length - 1 ? () => setSelectedStoreId(view.ordered[position + 1].row.id) : null,
      }
    : null;

  // ── Actions ─────────────────────────────────────────────────────────────────

  // Remember where the list was scrolled to, so "Semua toko" lands back on it.
  const openStore = useCallback((storeId: number) => {
    const scroller = scrollParent(rootRef.current);
    if (scroller) savedScroll.current = scroller.scrollTop;
    setSelectedStoreId(storeId);
  }, []);

  const backToList = useCallback(() => setSelectedStoreId(null), []);

  // A store opens at the top (including when stepping with ‹ ›); going back to
  // the list restores its scroll position.
  useLayoutEffect(() => {
    const scroller = scrollParent(rootRef.current);
    if (!scroller) return;
    scroller.scrollTo({ top: selectedStoreId != null ? 0 : savedScroll.current });
  }, [selectedStoreId]);

  // Back to Harian inside the current month → today, not the 1st.
  const handlePeriodChange = (next: ViewPeriod) => {
    setViewPeriod(next);
    if (next === 'daily' && yearMonth === jakartaTodayKey().slice(0, 7)) setDateKey(jakartaTodayKey());
  };

  // Setting up next month is the common job — one click from the list.
  const nextYearMonth = shiftYearMonth(jakartaTodayKey().slice(0, 7), 1);
  const goToNextMonth = () => {
    setViewPeriod('monthly');
    setDateKey(`${nextYearMonth}-01`);
  };

  const subtitle = showingDetail && viewPeriod === 'daily'
    ? `${headingScope} · ${fmtDateLabel(dateKey)}`
    : `${headingScope} · ${fmtMonthLabel(yearMonth)}`;

  return (
    <div ref={rootRef} className="min-h-full bg-slate-50">
      <OpsPageHeader
        scope="OPS · Operations"
        title="Performance Targets"
        subtitle={subtitle}
        periodProps={
          showingDetail
            ? {
                period: viewPeriod,
                periods: ['daily', 'monthly'],
                onPeriodChange: (p) => handlePeriodChange(p as ViewPeriod),
                date: dateKey,
                onDateChange: setDateKey,
              }
            : {
                // The list is always a month view — just the month picker.
                period: 'monthly',
                date: dateKey,
                onDateChange: setDateKey,
              }
        }
        onRefresh={handleRefresh}
        refreshing={inflight > 0}
      />

      <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {overviewError && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 text-sm font-semibold">{overviewError}</p>
            <button
              type="button"
              onClick={() => void loadOverview()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Coba lagi
            </button>
          </div>
        )}

        {/* The list stays mounted while a store is open, so its search, filters
            and sort are exactly as they were when you come back. */}
        <div className={showingDetail ? 'hidden' : undefined}>
          <StoreListSection
            view={view}
            yearMonth={yearMonth}
            nextYearMonth={nextYearMonth}
            loading={overviewLoading}
            onOpenStore={openStore}
            onGoNextMonth={goToNextMonth}
          />
        </div>

        {showingDetail && (
          <StoreDetail
            store={selectedStore}
            detail={detail}
            loading={detailLoading}
            error={detailError}
            eligible={detailReady ? detailState.eligible : []}
            yearMonth={yearMonth}
            dateKey={dateKey}
            nav={nav}
            onBack={backToList}
            onRefresh={handleRefresh}
          />
        )}
      </div>
    </div>
  );
}
