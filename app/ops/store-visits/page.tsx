'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, MapPinOff, AlertCircle, History } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import { OpsListSkeleton } from '@/components/ops/layout/OpsList';
import { OpsSearchInput, OpsFilterSelect, OpsChipTabs } from '@/components/ops/layout/OpsToolbar';
import VisitTabs from '@/components/ops/store-visits/VisitTabs';
import { Pill, ProgressBar, StatTile, VisitStatusPill, daysAgoLabel, shortDate, visitState } from '@/components/ops/store-visits/shared';
import { VISIT_CATEGORY_LABELS, type VisitStore } from '@/lib/store-visit/types';

type StatusKey = 'all' | 'due' | 'done' | 'unset';

export default function StoreVisitsPage() {
  const [stores, setStores] = useState<VisitStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState<StatusKey>('all');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/ops/store-visits', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Daftar visit gagal dimuat.');
      setStores(data.stores);
    } catch (e) { setError(e instanceof Error ? e.message : 'Daftar visit gagal dimuat.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const due = stores.filter((s) => visitState(s) === 'due').length;
    const done = stores.filter((s) => visitState(s) === 'done').length;
    return { due, done, unset: stores.length - due - done, withPolicy: due + done };
  }, [stores]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((s) => {
      if (q && !`${s.name} ${s.storeNo} ${s.areaName} ${s.policy?.city ?? ''}`.toLowerCase().includes(q)) return false;
      if (category !== 'all' && s.policy?.category !== category) return false;
      return status === 'all' || visitState(s) === status;
    }).sort((a, b) => b.progress.remaining - a.progress.remaining || a.name.localeCompare(b.name));
  }, [stores, query, category, status]);

  return (
    <div className="min-h-full bg-slate-50">
      <OpsPageHeader title="Visit Toko" scope="OPS · Kunjungan Area" subtitle="Checklist, foto toko, dan geotag dalam satu kunjungan." onRefresh={load} refreshing={loading} className="max-md:[&_h1]:text-xl" />
      <div className="space-y-4 p-4 pb-8 sm:space-y-5 sm:p-6">
        <VisitTabs />

        {!error && (
          <section aria-label="Ringkasan visit" className="space-y-3">
            <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-700 p-4 text-white shadow-sm sm:p-5">
              {loading ? <div className="h-14 animate-pulse rounded-xl bg-white/10" /> : <>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-100 sm:text-xs">Target visit saat ini</p>
                    <p className="mt-0.5 text-3xl font-bold tabular-nums">{counts.done}<span className="text-base font-semibold text-indigo-200 sm:text-lg"> / {counts.withPolicy} toko</span></p>
                  </div>
                  <p className="pb-1 text-right text-sm font-semibold leading-tight text-indigo-50">{counts.due ? <>{counts.due} toko<br className="sm:hidden" /> perlu dikunjungi</> : 'Semua target terpenuhi'}</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${counts.withPolicy ? Math.round((counts.done / counts.withPolicy) * 100) : 0}%` }} /></div>
                <p className="mt-2.5 text-xs leading-5 text-indigo-100 sm:hidden">7 hari = Senin–Minggu. Visit di hari yang sama dihitung sekali.</p>
                <p className="mt-3 hidden text-xs leading-5 text-indigo-100 sm:block">Periode visit berjalan berurutan (7 hari = Senin–Minggu); kunjungi toko kapan saja sebelum periode berakhir. Beberapa visit di hari yang sama dihitung sekali.</p>
              </>}
            </div>
            {/* The filter chips below carry the same three counts on a phone */}
            <div className="hidden grid-cols-3 gap-3 sm:grid">
              <StatTile label="Perlu visit" value={loading ? '–' : counts.due} tone="amber" />
              <StatTile label="Terpenuhi" value={loading ? '–' : counts.done} tone="emerald" />
              <StatTile label="Belum diatur" value={loading ? '–' : counts.unset} />
            </div>
          </section>
        )}

        <div className="space-y-2.5 sm:space-y-3">
          <div className="flex items-center gap-2">
            <OpsSearchInput value={query} onChange={setQuery} placeholder="Cari toko / kota…" className="min-w-0 flex-1 sm:max-w-sm sm:flex-none" />
            <OpsFilterSelect label="Kategori visit" value={category} onChange={setCategory} className="shrink-0">
              <option value="all">Kategori</option>
              <option value="in_city">Dalam kota</option><option value="out_city">Luar kota</option>
            </OpsFilterSelect>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden [&>div]:flex-nowrap sm:[&>div]:flex-wrap">
            <OpsChipTabs<StatusKey> value={status} onChange={setStatus} items={[
              { key: 'all', label: 'Semua', count: stores.length },
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
          <ul className="space-y-2.5">
            {visible.map((store) => <StoreCard key={store.id} store={store} />)}
          </ul>
        )}

        <Link href="/ops/impact-visits/results" className="flex min-h-11 items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 hover:bg-slate-50">
          <History className="h-4 w-4" />Lihat hasil Impact Visit<ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
        </Link>
      </div>
    </div>
  );
}

function StoreCard({ store }: { store: VisitStore }) {
  const state = visitState(store);
  const policy = store.policy;
  const edge = state === 'due' ? 'bg-amber-400' : state === 'done' ? 'bg-emerald-500' : 'bg-slate-200';
  return (
    <li>
      <Link href={`/ops/store-visits/${store.id}`} aria-label={`Buka visit ${store.name}`}
        className="relative flex overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition active:scale-[0.99] hover:border-indigo-200 hover:shadow-md focus-visible:ring-2 focus-visible:ring-indigo-500">
        <span aria-hidden className={`w-1.5 shrink-0 ${edge}`} />
        <div className="min-w-0 flex-1 space-y-2.5 p-3.5 sm:p-4">
          <div className="space-y-1">
            <p className="line-clamp-2 font-bold leading-snug text-slate-900">{store.name}</p>
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-sm text-slate-500">{store.storeNo} · {policy?.city || store.areaName}</p>
              <VisitStatusPill store={store} className="shrink-0 px-2 py-0.5 text-[11px] sm:px-2.5 sm:py-1 sm:text-xs" />
            </div>
          </div>

          {policy ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <ProgressBar className="flex-1" value={policy.minimumVisits - store.progress.remaining} max={policy.minimumVisits} tone={state === 'done' ? 'emerald' : 'amber'} />
                <span className="text-xs font-bold tabular-nums text-slate-600">{policy.minimumVisits - store.progress.remaining}/{policy.minimumVisits}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs text-slate-500">
                <span>{VISIT_CATEGORY_LABELS[policy.category]} · {policy.minimumVisits}× / {policy.intervalDays} hari</span>
                <span className="font-semibold text-slate-600">
                  {state === 'due' ? `Terakhir ${daysAgoLabel(store.progress.lastVisit).toLowerCase()}` : `Berikutnya ${shortDate(store.progress.dueDate)}`}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Kategori dan jumlah wajib belum diatur IT. Visit tetap bisa dicatat.</p>
          )}

          {!store.hasCoordinates && <Pill tone="rose" className="whitespace-normal"><MapPinOff className="h-3.5 w-3.5 shrink-0" />Koordinat toko perlu diatur IT</Pill>}
        </div>
        <div className="flex items-center pr-3 text-slate-300"><ChevronRight className="h-5 w-5" /></div>
      </Link>
    </li>
  );
}
