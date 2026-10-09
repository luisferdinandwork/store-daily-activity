'use client';
// app/ops/sales-returns/page.tsx
//
// Ops · Sales Return
//
// The sales returns the stores have filed — the receipt number the employee typed,
// the photos of the receipt, and (recorded automatically at upload) who filed it
// and when. Ops Area sees their own area's stores; HO / IT see every store and can
// narrow to one area. A month there is when the return was uploaded (Jakarta).
//
// Drawn like Ops Petty Cash — Finance's sheet cells under the Ops header, search
// and filters — and shares its table with Finance's own Sales Return page.

import { useState } from 'react';
import { AlertTriangle, ReceiptText } from 'lucide-react';

import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import { KpiStrip, PhotoLightbox, type LightboxPhoto } from '@/components/finance/shared/sheet-kit';
import { Pager, SheetEmpty, SheetFrame, SheetSkeleton, useJsonFeed } from '@/components/ops/petty-cash/shared';
import { SalesReturnsTable, salesReturnKpis, useDebouncedValue } from '@/components/sales-returns/shared';
import { monthRange, type SalesReturnsPage } from '@/lib/sales-returns';

type OpsSalesReturnsResponse = SalesReturnsPage & { success: true; scope: 'all_areas' | 'area' };

/** First day of this month in Jakarta, as YYYY-MM-01 (what OpsPageHeader's month picker works in). */
function currentMonthStart() {
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  return `${now.slice(0, 7)}-01`;
}

export default function OpsSalesReturnsPage() {
  const [date, setDate] = useState(currentMonthStart);
  const month = date.slice(0, 7);

  const [search, setSearch] = useState('');
  const [area, setArea] = useState<'all' | number>('all');
  const [page, setPage] = useState(1);
  const [lightbox, setLightbox] = useState<{ title: string; photos: LightboxPhoto[]; index: number } | null>(null);

  const q = useDebouncedValue(search.trim());
  const { from, to } = monthRange(month);
  const params = new URLSearchParams({ from, to, page: String(page) });
  if (q) params.set('q', q);
  if (area !== 'all') params.set('areaId', String(area));

  const feed = useJsonFeed<OpsSalesReturnsResponse>(`/api/ops/sales-returns?${params}`);
  const data = feed.data;
  const rows = data?.rows ?? [];
  const isHo = data?.scope === 'all_areas';
  const loadingFirst = feed.loading && !data;

  const filtersActive = search.trim() !== '' || area !== 'all';
  const currentPage = data?.page ?? page;
  const offset = data ? (data.page - 1) * data.pageSize : 0;

  function clearFilters() {
    setSearch('');
    setArea('all');
    setPage(1);
  }

  function changeMonth(d: string) {
    setDate(d);
    setPage(1);
  }

  return (
    <div className="min-h-full bg-slate-50">
      {lightbox && (
        <PhotoLightbox
          title={lightbox.title}
          photos={lightbox.photos}
          index={lightbox.index}
          onIndex={(index) => setLightbox((l) => (l ? { ...l, index } : l))}
          onClose={() => setLightbox(null)}
        />
      )}

      <OpsPageHeader
        scope={isHo ? 'OPS HO · All areas' : 'OPS · Your area'}
        title="Sales Return"
        periodProps={{ period: 'monthly', date, onDateChange: changeMonth }}
        onRefresh={feed.reload}
        refreshing={feed.loading}
      />

      <div className="mx-auto space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {/* Key numbers */}
        {data && !feed.error && <KpiStrip items={salesReturnKpis(data.summary)} />}

        {/* Search / filter */}
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search receipt no., staff, store…"
            className="max-w-md"
          />

          {isHo && data && data.areas.length > 1 && (
            <OpsFilterSelect
              label="Area"
              value={String(area)}
              onChange={(v) => {
                setArea(v === 'all' ? 'all' : Number(v));
                setPage(1);
              }}
            >
              <option value="all">All areas</option>
              {data.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </OpsFilterSelect>
          )}

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

        {feed.error && (
          <div className="flex items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm font-medium text-rose-700">{feed.error}</p>
          </div>
        )}

        {/* Sheet */}
        {loadingFirst ? (
          <SheetSkeleton />
        ) : data && rows.length === 0 ? (
          <SheetEmpty
            icon={ReceiptText}
            title={filtersActive ? 'No sales returns match your filters.' : 'No sales returns this month.'}
            hint={filtersActive ? undefined : 'Try another month with the arrows above.'}
            onClear={filtersActive ? clearFilters : undefined}
          />
        ) : data ? (
          <>
            <SheetFrame dimmed={feed.loading}>
              <SalesReturnsTable
                rows={rows}
                startIndex={offset}
                variant="ops"
                showArea={isHo}
                onOpenPhoto={(r, index) =>
                  setLightbox({
                    title: `${r.storeNo} · ${r.receiptNumber}`,
                    photos: r.imageUrls.map((url, n) => ({ url, label: `Struk ${n + 1}` })),
                    index,
                  })
                }
              />
            </SheetFrame>

            <Pager
              page={currentPage}
              pages={data.totalPages}
              from={offset + 1}
              to={offset + rows.length}
              total={data.matching}
              noun="sales return"
              onPage={setPage}
            />

            <p className="text-[11px] text-slate-500">
              <span className="font-semibold">Tanggal</span> is when the employee uploaded the receipt, and{' '}
              <span className="font-semibold">Diunggah Oleh</span> is the account signed in at that moment — both are
              recorded automatically. <span className="font-semibold">No. Struk</span> is typed by the employee from the
              return receipt; click a photo to enlarge it.
            </p>
          </>
        ) : null}
      </div>

    </div>
  );
}
