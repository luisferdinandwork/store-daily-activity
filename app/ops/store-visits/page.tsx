'use client';
// app/ops/store-visits/page.tsx
//
// Visit Toko ▸ Visits — the stores in scope as one compact table; a row opens that store's
// visit form. Ops Area sees only their own area (resolved server-side); Ops HO / IT pick an
// area (or all). Impact Visit is a different programme and lives under its own menu.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ChevronRight, MapPinOff } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsSearchInput, OpsFilterSelect, OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import { StoreCombobox } from '@/components/shared/store-combobox';
import VisitTabs from '@/components/ops/store-visits/VisitTabs';
import { ProgressBar, VisitStatusPill, daysAgoLabel, shortDate, visitState } from '@/components/ops/store-visits/shared';
import { VISIT_CATEGORY_LABELS, type VisitStore } from '@/lib/store-visit/types';
import { cn } from '@/lib/utils';

type StatusKey = 'all' | 'due' | 'done' | 'unset';

export default function StoreVisitsPage() {
  const router = useRouter();
  const [stores, setStores] = useState<VisitStore[]>([]);
  const [isHO, setIsHO] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('all');
  const [storeId, setStoreId] = useState<number | null>(null);
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<StatusKey>('all');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ops/store-visits', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Daftar visit gagal dimuat.');
      setStores(data.stores);
      setIsHO(data.scope === 'all');
    } catch (e) { setError(e instanceof Error ? e.message : 'Daftar visit gagal dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const areas = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of stores) map.set(s.areaId, s.areaName);
    return [...map.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [stores]);

  // Area, category and store narrow the whole page (the chip counts too); search and the status chips narrow the table.
  const pool = useMemo(() => stores.filter((s) =>
    (area === 'all' || String(s.areaId) === area) && (category === 'all' || s.policy?.category === category),
  ), [stores, area, category]);
  const scoped = useMemo(() => (storeId == null ? pool : pool.filter((s) => s.id === storeId)), [pool, storeId]);

  const counts = useMemo(() => {
    const due = scoped.filter((s) => visitState(s) === 'due').length;
    const done = scoped.filter((s) => visitState(s) === 'done').length;
    return { due, done, unset: scoped.length - due - done };
  }, [scoped]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter((s) => {
      if (q && !`${s.name} ${s.storeNo} ${s.areaName} ${s.policy?.city ?? ''}`.toLowerCase().includes(q)) return false;
      return status === 'all' || visitState(s) === status;
    }).sort((a, b) => b.progress.remaining - a.progress.remaining || a.name.localeCompare(b.name));
  }, [scoped, query, status]);

  const showArea = isHO && area === 'all';
  const areaName = !isHO ? stores[0]?.areaName : null;

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader
        title="Visit Toko"
        scope={areaName ? `OPS · ${areaName}` : 'OPS · Kunjungan Area'}
        subtitle="Pilih toko untuk mengisi visit: laporan tertulis, foto toko, dan geotag."
        onRefresh={load}
        refreshing={loading}
        className="max-md:[&_h1]:text-xl"
      />
      <div className="space-y-3 p-4 pb-8 sm:space-y-4 sm:p-6">
        <VisitTabs />

        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko / kota…" className="min-w-full flex-1 sm:min-w-0 sm:max-w-sm sm:flex-none" />
            <StoreCombobox stores={pool} value={storeId} onChange={setStoreId} allLabel="Semua toko" className="min-w-0 flex-1 sm:w-56 sm:flex-none" />
            {isHO && areas.length > 1 && (
              <OpsFilterSelect label="Area" value={area} onChange={(v) => { setArea(v); setStoreId(null); }} className="min-w-0 shrink-0 [&>select]:max-w-[160px] sm:[&>select]:max-w-[240px]">
                <option value="all">Semua area</option>
                {areas.map((a) => <option key={a.id} value={String(a.id)}>{a.name}</option>)}
              </OpsFilterSelect>
            )}
            <OpsFilterSelect label="Kategori visit" value={category} onChange={(v) => { setCategory(v); setStoreId(null); }} className="shrink-0">
              <option value="all">Kategori</option>
              <option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option>
            </OpsFilterSelect>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [&>div]:flex-nowrap sm:[&>div]:flex-wrap">
            <OpsChipTabs<StatusKey> value={status} onChange={setStatus} items={[
              { key: 'all', label: 'Semua', count: scoped.length },
              { key: 'due', label: 'Perlu visit', count: counts.due, tone: 'amber' },
              { key: 'done', label: 'Terpenuhi', count: counts.done, tone: 'emerald' },
              { key: 'unset', label: 'Belum diatur', count: counts.unset, tone: 'slate' },
            ]} />
          </div>
        </div>

        {error ? (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div><p className="font-semibold">{error}</p><button className="mt-1 min-h-11 text-sm font-semibold underline" onClick={load}>Coba lagi</button></div>
          </div>
        ) : loading ? <OpsListSkeleton /> : visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">Tidak ada toko yang sesuai.</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-3 py-2 sm:px-4">Toko</th>
                  {showArea && <th scope="col" className="hidden px-3 py-2 xl:table-cell">Area</th>}
                  <th scope="col" className="hidden px-3 py-2 lg:table-cell">Kota</th>
                  <th scope="col" className="hidden px-3 py-2 xl:table-cell">Target</th>
                  <th scope="col" className="hidden w-36 px-3 py-2 lg:table-cell">Progres</th>
                  <th scope="col" className="hidden px-3 py-2 2xl:table-cell">Terakhir</th>
                  <th scope="col" className="px-3 py-2 text-right sm:text-left">Status</th>
                  <th scope="col" className="w-8 py-2 pr-2"><span className="sr-only">Buka</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((store) => (
                  <StoreRow key={store.id} store={store} showArea={showArea} onOpen={() => router.push(`/ops/store-visits/${store.id}`)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StoreRow({ store, showArea, onOpen }: { store: VisitStore; showArea: boolean; onOpen: () => void }) {
  const state = visitState(store);
  const policy = store.policy;
  const done = policy ? policy.minimumVisits - store.progress.remaining : 0;
  return (
    <tr onClick={onOpen} className="group cursor-pointer transition-colors hover:bg-indigo-50/40">
      <td className="px-3 py-2 sm:min-w-[11rem] sm:px-4">
        <Link href={`/ops/store-visits/${store.id}`} onClick={(e) => e.stopPropagation()} aria-label={`Buka visit ${store.name}`} className="flex min-w-0 max-w-[12.5rem] items-center gap-2 focus-visible:outline-none sm:max-w-[20rem]">
          <span className={cn('h-6 w-1 shrink-0 rounded-full', state === 'due' ? 'bg-amber-400' : state === 'done' ? 'bg-emerald-500' : 'bg-slate-200')} aria-hidden />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5">
              <span className="line-clamp-2 font-semibold leading-snug text-slate-900 sm:line-clamp-1">{store.name}</span>
              {!store.hasCoordinates && <span title="Koordinat toko perlu diatur IT" className="shrink-0"><MapPinOff aria-label="Koordinat toko perlu diatur IT" className="h-3.5 w-3.5 text-rose-500" /></span>}
            </span>
            <span className="block truncate text-xs text-slate-500 lg:hidden">{store.storeNo} · {policy?.city || store.areaName}</span>
            <span className="hidden text-xs text-slate-500 lg:block">{store.storeNo}</span>
          </span>
        </Link>
      </td>
      {showArea && <td className="hidden max-w-[11rem] truncate px-3 py-2 text-slate-600 xl:table-cell">{store.areaName}</td>}
      <td className="hidden px-3 py-2 text-slate-600 lg:table-cell">{policy?.city || '—'}</td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-600 xl:table-cell">
        {policy ? `${VISIT_CATEGORY_LABELS[policy.category]} · ${policy.minimumVisits}× / ${policy.intervalDays} hari` : <span className="text-slate-400">Belum diatur IT</span>}
      </td>
      <td className="hidden px-3 py-2 lg:table-cell">
        {policy ? (
          <div className="flex items-center gap-2">
            <ProgressBar className="h-1.5 flex-1" value={done} max={policy.minimumVisits} tone={state === 'done' ? 'emerald' : 'amber'} />
            <span className="text-xs font-bold tabular-nums text-slate-600">{done}/{policy.minimumVisits}</span>
          </div>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2 text-xs text-slate-500 2xl:table-cell">
        {store.progress.lastVisit ? <>{daysAgoLabel(store.progress.lastVisit)}<span className="text-slate-400"> · {shortDate(store.progress.lastVisit)}</span></> : 'Belum ada visit'}
      </td>
      <td className="px-3 py-2 text-right sm:text-left"><VisitStatusPill store={store} className="px-2 py-0.5 text-[11px]" /></td>
      <td className="py-2 pr-2 text-slate-300 group-hover:text-indigo-500"><ChevronRight className="h-4 w-4" /></td>
    </tr>
  );
}
