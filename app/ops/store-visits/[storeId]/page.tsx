'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MapPinOff, CheckCircle2, AlertCircle, Eye } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import VisitForm from '@/components/ops/store-visits/VisitForm';
import { ProgressBar, VisitStatusPill, daysAgoLabel, shortDate, visitState } from '@/components/ops/store-visits/shared';
import { VISIT_CATEGORY_LABELS, type VisitDetail } from '@/lib/store-visit/types';

export default function StoreVisitPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = use(params);
  const [detail, setDetail] = useState<VisitDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/ops/store-visits/${storeId}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Visit gagal dimuat.');
      setDetail(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Visit gagal dimuat.'); }
    finally { setLoading(false); }
  }, [storeId]);
  useEffect(() => { void load(); }, [load]);

  const store = detail?.store;
  const policy = store?.policy;
  const state = store ? visitState(store) : 'unset';

  return <div className="min-h-full bg-slate-50">
    <OpsPageHeader title={store?.name || 'Visit Toko'} scope="OPS · Visit Toko" subtitle={store?.storeNo || 'Laporan kunjungan'} className="[&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip max-md:[&_h1]:text-xl" />
    <div className="space-y-5 p-4 pb-6 sm:p-6">
      <Link href="/ops/store-visits" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700"><ArrowLeft className="h-4 w-4" />Daftar toko</Link>
      {error && <div role="alert" className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">{error}</p><button onClick={load} className="mt-1 min-h-11 text-sm font-semibold underline">Coba lagi</button></div></div>}
      {loading ? <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : detail && store && <>
        <section aria-label="Status visit" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-bold text-slate-900">{policy ? `${VISIT_CATEGORY_LABELS[policy.category]} · ${policy.minimumVisits} visit / ${policy.intervalDays} hari` : 'Kategori dan jumlah wajib belum diatur IT'}</p>
            <VisitStatusPill store={store} />
          </div>
          {policy && <>
            <ProgressBar value={policy.minimumVisits - store.progress.remaining} max={policy.minimumVisits} tone={state === 'done' ? 'emerald' : 'amber'} className="h-2.5" />
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2.5"><dt className="text-[11px] font-semibold text-slate-500">Hari visit</dt><dd className="mt-0.5 font-bold tabular-nums text-slate-900">{store.progress.completed}<span className="text-slate-400"> / {policy.minimumVisits}</span></dd></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><dt className="text-[11px] font-semibold text-slate-500">Terakhir</dt><dd className="mt-0.5 text-sm font-bold text-slate-900">{daysAgoLabel(store.progress.lastVisit)}</dd></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><dt className="text-[11px] font-semibold text-slate-500">{state === 'done' ? 'Periode berikutnya' : 'Batas periode'}</dt><dd className="mt-0.5 text-sm font-bold text-slate-900">{shortDate(store.progress.dueDate)}</dd></div>
            </dl>
          </>}
          {!store.hasCoordinates && <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />Koordinat toko belum diatur. Hubungi IT untuk mengatur lokasi toko sebelum melakukan visit.</p>}
        </section>

        {detail.canSubmit ? saved ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="mb-2 h-7 w-7" /><p className="font-bold">Visit berhasil disimpan.</p><p className="mt-1 text-sm">Laporan, foto toko, dan geotag bisa dilihat di tab Report.</p><div className="mt-3 flex flex-wrap gap-2"><Link href="/ops/store-visits" className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white">Kembali ke daftar toko</Link><Link href="/ops/store-visits/report" className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-white px-4 text-sm font-semibold text-emerald-800">Lihat di Report</Link></div></div>
          : <VisitForm key={storeId} detail={detail} onDone={() => { setSaved(true); void load(); }} />
          : <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><Eye className="mt-0.5 h-4 w-4 shrink-0" />Ops HO memantau kunjungan. Pengisian laporan visit dilakukan oleh Ops Area.</p>}

        <p className="text-center text-xs text-slate-500">Hasil visit yang sudah disimpan dibaca di <Link href="/ops/store-visits/report" className="font-semibold text-indigo-700 underline">tab Report</Link>.</p>
      </>}
    </div>
  </div>;
}
