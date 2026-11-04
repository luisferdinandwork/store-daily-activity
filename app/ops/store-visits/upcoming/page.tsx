'use client';
// app/ops/store-visits/upcoming/page.tsx
//
// Visit Toko ▸ Upcoming Visit — the stores that still owe a visit this period, nearest
// deadline first, with the days left in a colour that gets hotter as the deadline nears
// (rose = today / tomorrow, amber = up to 3 days, indigo = more). Nothing is scheduled:
// "days left" is the days until the store's period (7 days = Monday–Sunday) ends.
//
// Ops Area sees only their own area (resolved server-side); Ops HO / IT see every area,
// grouped by area, or pick one.

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ChevronRight, Plane } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsChipTabs, OpsFilterSelect, OpsSearchInput } from '@/components/ops/layout/OpsToolbar';
import { StoreCombobox } from '@/components/shared/store-combobox';
import VisitTabs from '@/components/ops/store-visits/VisitTabs';
import { TonePill, daysAgoLabel } from '@/components/ops/store-visits/shared';
import { TONE } from '@/components/ops/store-visits/tones';
import { useApi } from '@/lib/client/use-api';
import { jakartaDateKey } from '@/lib/day-bucket';
import { cycleName } from '@/lib/store-visit/cycles';
import type { VisitUpcoming } from '@/lib/store-visit/report';
import { SOON_DAYS, daysLeftLabel, deadlineLabel, upcomingRows, upcomingSummary, type UpcomingRow } from '@/lib/store-visit/upcoming';
import { cn } from '@/lib/utils';

type Band = 'all' | 'overdue' | 'soon' | 'planned';

export default function UpcomingVisitPage() {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [storeId, setStoreId] = useState<number | null>(null);
  const [category, setCategory] = useState('all');
  const [band, setBand] = useState<Band>('all');

  const api = useApi<VisitUpcoming & { success: boolean; error?: string }>('/api/ops/store-visits/upcoming');
  const data = api.data?.success ? api.data : null;
  const loading = !data && api.validating;
  const error = api.data && !api.data.success ? (api.data.error || 'Upcoming visit gagal dimuat.') : api.error ? 'Upcoming visit gagal dimuat.' : '';
  const load = () => void api.refresh();

  const isHO = data?.scope === 'all';
  const multiArea = (data?.areas.length ?? 0) > 1;

  // Area, category and store narrow the whole page (the chip counts too); search and the chips narrow the table.
  const pool = useMemo(() => (data?.stores ?? []).filter((s) =>
    (area === 'all' || String(s.areaId) === area) && (category === 'all' || s.policy?.category === category),
  ), [data, area, category]);
  const scoped = useMemo(() => (storeId == null ? pool : pool.filter((s) => s.id === storeId)), [pool, storeId]);
  const owing = useMemo(() => upcomingRows(scoped), [scoped]);
  const summary = useMemo(() => upcomingSummary(owing), [owing]);
  const metCount = scoped.filter((s) => s.cycle?.met).length;
  const unsetCount = scoped.filter((s) => !s.policy).length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return owing.filter((r) =>
      (band === 'all' || r.tone === band)
      && (!q || `${r.store.name} ${r.store.storeNo} ${r.store.areaName} ${r.store.policy?.city ?? ''}`.toLowerCase().includes(q)));
  }, [owing, band, query]);

  // HO looking at every area: one section per area, the area with the nearest deadline first.
  const groupByArea = isHO && area === 'all' && multiArea;
  const groups = useMemo(() => {
    if (!groupByArea) return [{ key: 'all', rows: visible, name: null as string | null, ops: [] as string[] }];
    const map = new Map<number, UpcomingRow[]>();
    for (const r of visible) map.set(r.store.areaId, [...(map.get(r.store.areaId) ?? []), r]);
    return [...map.values()]
      .sort((a, b) => a[0].daysLeft - b[0].daysLeft || b.length - a.length || a[0].store.areaName.localeCompare(b[0].store.areaName))
      .map((rows) => ({ key: String(rows[0].store.areaId), rows, name: rows[0].store.areaName as string | null, ops: rows[0].store.opsNames }));
  }, [visible, groupByArea]);

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Upcoming Visit"
        scope="OPS · Kunjungan Area"
        subtitle={isHO ? 'Toko yang harus segera dikunjungi, per area — yang paling dekat batasnya di atas.' : 'Toko yang harus Anda kunjungi, dari batas yang paling dekat.'}
        onRefresh={load}
        refreshing={api.validating}
        className="max-md:[&_h1]:text-xl"
        contentClassName="w-full"
      />
      <div className="space-y-3 p-4 pb-8 sm:space-y-4 sm:p-6 lg:px-8">
        <VisitTabs />

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{error}</p><button className="mt-1 min-h-11 text-sm font-semibold underline" onClick={load}>Coba lagi</button></div>
          </div>
        ) : loading ? (
          <OpsListSkeleton />
        ) : (
          <>
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko / kota…" className="min-w-full flex-1 sm:min-w-0 sm:max-w-sm sm:flex-none" />
            <StoreCombobox stores={pool} value={storeId} onChange={setStoreId} allLabel="Semua toko" className="min-w-0 flex-1 sm:w-56 sm:flex-none" />
                {isHO && multiArea && (
                  <OpsFilterSelect label="Area" value={area} onChange={(v) => { setArea(v); setStoreId(null); }} className="min-w-0 shrink-0 [&>select]:max-w-[150px] sm:[&>select]:max-w-[240px]">
                    <option value="all">Semua area</option>
                    {data?.areas.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
                  </OpsFilterSelect>
                )}
                <OpsFilterSelect label="Kategori visit" value={category} onChange={(v) => { setCategory(v); setStoreId(null); }} className="shrink-0">
                  <option value="all">Kategori</option>
                  <option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option>
                </OpsFilterSelect>
              </div>
              <div className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [&>div]:flex-nowrap sm:[&>div]:flex-wrap">
                <OpsChipTabs<Band> value={band} onChange={setBand} items={[
                  { key: 'all', label: 'Semua', count: summary.total },
                  { key: 'overdue', label: 'Hari ini / besok', count: summary.byTone.overdue, tone: 'rose' },
                  { key: 'soon', label: `2–${SOON_DAYS} hari`, count: summary.byTone.soon, tone: 'amber' },
                  { key: 'planned', label: `> ${SOON_DAYS} hari`, count: summary.byTone.planned, tone: 'indigo' },
                ]} />
              </div>
            </div>

            {summary.total === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white p-5 text-emerald-800">
                <CheckCircle2 className="h-6 w-6 shrink-0" />
                <div>
                  <p className="font-bold">Semua toko sudah terpenuhi</p>
                  <p className="text-sm text-emerald-700">Tidak ada kunjungan yang tertunda pada periode ini.</p>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                      <th scope="col" className="w-24 px-3 py-2 sm:px-4">Sisa waktu</th>
                      <th scope="col" className="px-3 py-2">Toko</th>
                      <th scope="col" className="hidden px-3 py-2 xl:table-cell">Kota</th>
                      <th scope="col" className="hidden px-3 py-2 2xl:table-cell">Periode</th>
                      <th scope="col" className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">Perlu visit</th>
                      <th scope="col" className="hidden whitespace-nowrap px-3 py-2 xl:table-cell">Batas</th>
                      <th scope="col" className="hidden px-3 py-2 2xl:table-cell">Terakhir visit</th>
                      <th scope="col" className="w-8 py-2 pr-2"><span className="sr-only">Buka</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {groups.map((g) => (
                      <Fragment key={g.key}>
                        {g.name && (
                          <tr className="bg-slate-50/80">
                            <th scope="colgroup" colSpan={8} className="px-3 py-1.5 text-left sm:px-4">
                              <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                                <span className="text-xs font-bold text-slate-800">{g.name}</span>
                                {g.ops.length > 0 && <span className="text-[11px] font-medium text-slate-500">Ops: {g.ops.join(', ')}</span>}
                                <span className="text-[11px] font-semibold tabular-nums text-slate-500">{g.rows.length} toko</span>
                              </span>
                            </th>
                          </tr>
                        )}
                        {g.rows.map((r) => <UpcomingTableRow key={r.store.id} row={r} />)}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Warna = sisa waktu:</span>
              <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.overdue.dot)} />hari ini / besok</span>
              <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.soon.dot)} />2–{SOON_DAYS} hari</span>
              <span className="inline-flex items-center gap-1.5"><i className={cn('h-3 w-3 rounded-[4px]', TONE.planned.dot)} />lebih dari {SOON_DAYS} hari</span>
              <span className="inline-flex items-center gap-1.5"><Plane className="h-3.5 w-3.5 text-slate-400" />luar kota</span>
            </div>
            <p className="px-1 text-xs leading-5 text-slate-500">
              Sisa waktu = hari sampai periode toko berakhir (7 hari = Senin–Minggu). Visit boleh kapan saja sebelum itu.
              {metCount > 0 && ` ${metCount} toko sudah terpenuhi periode ini.`}
              {unsetCount > 0 && ` ${unsetCount} toko belum diatur IT.`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function UpcomingTableRow({ row }: { row: UpcomingRow }) {
  const { store, tone } = row;
  const policy = store.policy!;
  const cycle = store.cycle!;
  return (
    <tr className="group transition-colors hover:bg-indigo-50/40">
      <td className="px-3 py-2 sm:px-4">
        <TonePill tone={tone} className={cn('w-[4.75rem] justify-center px-2 py-0.5 text-xs tabular-nums', row.daysLeft <= 1 && 'text-[11px]')}>{daysLeftLabel(row.daysLeft)}</TonePill>
      </td>
      <td className="px-3 py-2 sm:min-w-[11rem]">
        <Link href={`/ops/store-visits/${store.id}`} aria-label={`Buka visit ${store.name}`} className="flex min-w-0 max-w-[12rem] items-center gap-2 focus-visible:outline-none sm:max-w-[22rem]">
          <span aria-hidden className={cn('h-7 w-1 shrink-0 rounded-full', TONE[tone].dot)} />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="line-clamp-2 font-semibold leading-snug text-slate-900 sm:line-clamp-1">{store.name}</span>
              {policy.category === 'out_city' && <Plane aria-label="Luar kota" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            </span>
            <span className="block truncate text-xs text-slate-500">{store.storeNo}<span className="xl:hidden"> · {policy.city || store.areaName} · batas {deadlineLabel(row.deadline)}</span>{row.missedBefore && <span className="font-semibold text-rose-600"> · periode lalu terlewat</span>}</span>
          </span>
        </Link>
      </td>
      <td className="hidden px-3 py-2 text-slate-600 xl:table-cell">{policy.city || '—'}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-600 2xl:table-cell">{cycleName(policy.intervalDays)} · {policy.minimumVisits}×</td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs sm:table-cell">
        <span className={cn('font-bold tabular-nums', TONE[tone].text)}>{row.remaining} visit</span>
        <span className="text-slate-400"> · {Math.min(cycle.count, policy.minimumVisits)}/{policy.minimumVisits}</span>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-700 xl:table-cell">{deadlineLabel(row.deadline)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-500 2xl:table-cell">{store.lastVisit ? daysAgoLabel(jakartaDateKey(store.lastVisit.at)) : 'Belum pernah'}</td>
      <td className="py-2 pr-2 text-slate-300 group-hover:text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
    </tr>
  );
}
