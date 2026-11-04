'use client';
// components/ops/store-visits/VisitResultSheet.tsx
//
// The Report's result preview: opens one saved visit — store photo, geotag, who/when and
// what Ops wrote (Informasi Product / Informasi VM / Human Problem). Visits made with the
// old Ya / Tidak checklist still read back as that checklist. The visit FORM lives on
// /ops/store-visits/[storeId]; this is only for reading what was submitted.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Camera, Loader2, MapPin, ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Pill } from '@/components/ops/store-visits/shared';
import { isTextVisit } from '@/lib/store-visit/fields';
import { jakartaDateKey, jakartaTime } from '@/lib/day-bucket';
import type { VisitResult } from '@/lib/store-visit/types';

type State = { id: string; visit: VisitResult | null; error: string };

const longDate = (iso: string) => new Date(`${jakartaDateKey(iso)}T00:00:00Z`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function VisitResultSheet({ visitId, onClose }: { visitId: string | null; onClose: () => void }) {
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    if (!visitId) return;
    let alive = true;
    fetch(`/api/ops/store-visits/result/${visitId}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || 'Hasil visit gagal dimuat.');
        if (alive) setState({ id: visitId, visit: data.visit, error: '' });
      })
      .catch((e) => { if (alive) setState({ id: visitId, visit: null, error: e instanceof Error ? e.message : 'Hasil visit gagal dimuat.' }); });
    return () => { alive = false; };
  }, [visitId]);

  // Only trust a result that belongs to the visit currently asked for.
  const current = state && state.id === visitId ? state : null;
  const visit = current?.visit ?? null;

  return (
    <Sheet open={!!visitId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-slate-100 pr-12">
          <SheetTitle className="text-base leading-snug text-slate-900">{visit ? visit.storeName : 'Hasil visit'}</SheetTitle>
          <SheetDescription className="text-xs">
            {visit ? `${visit.storeNo} · ${visit.areaName}` : 'Memuat…'}
          </SheetDescription>
        </SheetHeader>

        {!current ? (
          <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : current.error || !visit ? (
          <div role="alert" className="m-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-rose-700">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><p className="text-sm font-semibold">{current.error || 'Hasil visit tidak ditemukan.'}</p>
          </div>
        ) : <ResultBody visit={visit} />}
      </SheetContent>
    </Sheet>
  );
}

function ResultBody({ visit }: { visit: VisitResult }) {
  const written = isTextVisit(visit);
  const findings = visit.tasks.filter((t) => visit.answers[t.id]?.answer === 'tidak').length;
  return (
    <div className="space-y-4 p-4 pb-8">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold capitalize text-slate-900">{longDate(visit.visitedAt)}</p>
          <p className="text-xs text-slate-500">{jakartaTime(visit.visitedAt)} WIB · oleh {visit.visitorName || 'Ops'}</p>
        </div>
        {written ? <Pill tone="indigo">Laporan tertulis</Pill> : <Pill tone={findings ? 'amber' : 'emerald'}>{findings ? `${findings} temuan` : 'Tanpa temuan'}</Pill>}
      </div>

      <a href={visit.photoUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={visit.photoUrl} alt="Foto toko saat visit" loading="lazy" className="max-h-72 w-full object-contain" />
      </a>
      <a href={`https://www.google.com/maps?q=${visit.lat},${visit.lng}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700">
        <MapPin className="h-4 w-4" />Lokasi tervalidasi ({visit.distanceM} m dari toko) · ±{Math.round(Number(visit.accuracy))} m
      </a>

      {written ? (
        <div className="space-y-3">
          {visit.tasks.map((task) => (
            <section key={task.id} className="rounded-xl bg-slate-50 p-3">
              <h4 className="text-xs font-bold uppercase tracking-wide text-indigo-700">{task.label}</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{visit.answers[task.id]?.note || '—'}</p>
            </section>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 px-3">
          {visit.tasks.map((task) => {
            const a = visit.answers[task.id];
            const ok = a?.answer === 'ya';
            return (
              <li key={task.id} className="flex gap-3 py-3 text-sm">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : 'bg-rose-500'}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug text-slate-900">{task.label}</p>
                  <p className={`mt-0.5 text-xs font-bold ${ok ? 'text-emerald-700' : 'text-rose-700'}`}>{ok ? 'Ya, sesuai' : 'Tidak, ada temuan'}</p>
                  {a?.note && <p className="mt-1 rounded-lg bg-slate-50 p-2 text-slate-600">{a.note}</p>}
                  {a?.photoUrl && <a className="mt-1 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-indigo-700" href={a.photoUrl} target="_blank" rel="noreferrer"><Camera className="h-3.5 w-3.5" />Lihat foto task</a>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {visit.notes && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><span className="font-semibold text-slate-700">Catatan kunjungan: </span>{visit.notes}</p>}

      <Link href={`/ops/store-visits/${visit.storeId}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-indigo-700">
        <ExternalLink className="h-4 w-4" />Buka halaman toko
      </Link>
    </div>
  );
}
