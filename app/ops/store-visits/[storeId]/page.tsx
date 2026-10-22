'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MapPin, MapPinOff, CheckCircle2, AlertCircle, Camera, ChevronDown, Eye } from 'lucide-react';
import OpsPageHeader from '@/components/ops/layout/OpsPageHeader';
import VisitForm from '@/components/ops/store-visits/VisitForm';
import { Pill, ProgressBar, VisitStatusPill, daysAgoLabel, shortDate, visitState } from '@/components/ops/store-visits/shared';
import { VISIT_CATEGORY_LABELS, type VisitDetail } from '@/lib/store-visit/types';
import { jakartaDateKey, jakartaTime } from '@/lib/day-bucket';

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
    <OpsPageHeader title={store?.name || 'Visit Toko'} scope="OPS · Visit Toko" subtitle={store?.storeNo || 'Checklist kunjungan'} className="[&_h1]:whitespace-normal [&_h1]:overflow-visible [&_h1]:text-clip max-md:[&_h1]:text-xl" />
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

        {detail.canSubmit ? saved ? <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-800"><CheckCircle2 className="mb-2 h-7 w-7" /><p className="font-bold">Visit berhasil disimpan.</p><p className="mt-1 text-sm">Foto dan geotag tercatat di riwayat toko ini.</p><Link href="/ops/store-visits" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white">Kembali ke daftar toko</Link></div>
          : <VisitForm key={`${storeId}-${detail.version}`} detail={detail} onDone={() => { setSaved(true); void load(); }} />
          : <p className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><Eye className="mt-0.5 h-4 w-4 shrink-0" />Ops HO memantau kunjungan. Pengisian checklist dilakukan oleh Ops Area.</p>}

        <section className="space-y-3" aria-label="Riwayat visit">
          <div className="flex items-center justify-between"><h2 className="font-bold text-slate-900">Riwayat visit</h2>{detail.visits.length > 0 && <span className="text-xs text-slate-500">{detail.visits.length} kunjungan</span>}</div>
          {!detail.visits.length && <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">Belum ada visit yang disimpan.</p>}
          {detail.visits.map((visit) => {
            const findings = visit.tasks.filter((t) => visit.answers[t.id]?.answer === 'tidak').length;
            return <details key={visit.id} className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900">{jakartaDateKey(visit.visitedAt)} · {jakartaTime(visit.visitedAt)} WIB</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{visit.visitorName || 'Ops'} · Lokasi tervalidasi ({visit.distanceM} m)</p>
                </div>
                <Pill tone={findings ? 'amber' : 'emerald'}>{findings ? `${findings} temuan` : 'Tanpa temuan'}</Pill>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
              </summary>
              <div className="space-y-4 border-t border-slate-100 p-3.5">
                <a href={visit.photoUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visit.photoUrl} alt="Foto toko saat visit" loading="lazy" className="max-h-64 w-full object-contain" />
                </a>
                <a href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700"><MapPin className="h-4 w-4" />Geotag: {visit.lat}, {visit.lng} · ±{Math.round(Number(visit.accuracy))} m</a>
                <ul className="divide-y divide-slate-100">
                  {visit.tasks.map((task) => {
                    const a = visit.answers[task.id];
                    const ok = a?.answer === 'ya';
                    return <li key={task.id} className="flex gap-3 py-3 text-sm first:pt-0">
                      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold leading-snug text-slate-900">{task.label}</p>
                        <p className={`mt-0.5 text-xs font-bold ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>{ok ? 'Ya, sesuai' : 'Tidak, ada temuan'}</p>
                        {a?.note && <p className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-600">{a.note}</p>}
                        {a?.photoUrl && <a className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-indigo-700" href={a.photoUrl} target="_blank" rel="noreferrer"><Camera className="h-3.5 w-3.5" />Lihat foto task</a>}
                      </div>
                    </li>;
                  })}
                </ul>
                {visit.notes && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><span className="font-semibold text-slate-700">Catatan kunjungan: </span>{visit.notes}</p>}
              </div>
            </details>;
          })}
          {detail.visits.length === 30 && <p className="text-xs text-slate-500">Menampilkan 30 kunjungan terbaru.</p>}
        </section>
      </>}
    </div>
  </div>;
}
