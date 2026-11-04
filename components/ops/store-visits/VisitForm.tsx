'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, MapPin, Check, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import CameraCapture from '@/components/shared/CameraCapture';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ops/store-visits/shared';
import type { VisitDetail, VisitPhotoGeo } from '@/lib/store-visit/types';
import { createVisitId } from '@/lib/store-visit/client';
import { VISIT_FIELDS, VISIT_FIELD_MAX } from '@/lib/store-visit/fields';

type Capture = { file: File; preview: string; geo: VisitPhotoGeo };
async function location(): Promise<VisitPhotoGeo> {
  if (!window.isSecureContext || !navigator.geolocation) throw new Error('Kamera dan GPS memerlukan HTTPS serta izin lokasi.');
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (p) => {
      if (p.coords.accuracy > 100) { reject(new Error('GPS belum akurat (maksimal ±100 m). Coba dekat pintu toko.')); return; }
      resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, capturedAt: new Date(p.timestamp).toISOString() });
    },
    (e) => reject(new Error(e.code === 1 ? 'Izinkan akses lokasi untuk memvalidasi visit.' : 'Lokasi belum tersedia. Aktifkan GPS dan coba kembali.')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
  ));
}

export default function VisitForm({ detail, onDone }: { detail: VisitDetail; onDone: () => void }) {
  const [id] = useState(createVisitId);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, Capture>>({});
  const [cameraKey, setCameraKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  async function capture(file: File) {
    const key = cameraKey;
    setCameraKey(null);
    if (!key) return;
    setBusy(true); setError('');
    try {
      const geo = await location();
      const preview = URL.createObjectURL(file);
      urls.current.push(preview);
      setPhotos((prev) => ({ ...prev, [key]: { file, preview, geo } }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Geotag foto gagal diambil.'); }
    finally { setBusy(false); }
  }

  // The store photo (with its geotag) is the only photo; then the three written reports.
  const filled = VISIT_FIELDS.filter((f) => !!texts[f.id]?.trim()).length;
  const ready = filled === VISIT_FIELDS.length && !!photos.store;
  const steps = VISIT_FIELDS.length + 1;
  const stepsDone = filled + (photos.store ? 1 : 0);

  async function submit() {
    setBusy(true); setError('');
    try {
      const geo = await location();
      const form = new FormData();
      form.append('data', JSON.stringify({ id, fields: texts, geo, photos: { store: photos.store.geo } }));
      form.append('store', photos.store.file);
      const res = await fetch(`/api/ops/store-visits/${detail.store.id}`, { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Visit gagal disimpan.');
      toast.success('Visit berhasil disimpan dengan foto dan geotag.');
      onDone();
    } catch (e) { setError(e instanceof Error ? e.message : 'Visit gagal disimpan.'); }
    finally { setBusy(false); }
  }

  function photoControl(key: string, label: string) {
    const photo = photos[key];
    if (!photo) return <button type="button" onClick={() => setCameraKey(key)} className="flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 px-3 py-4 text-sm font-semibold text-indigo-700 active:bg-indigo-50"><Camera className="h-6 w-6" />{label}</button>;
    return <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.preview} alt={label} className="h-20 w-20 shrink-0 rounded-lg border object-cover" />
      <div className="min-w-0 flex-1 text-xs leading-5 text-slate-600">
        <p className="flex items-center gap-1 font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />Foto tersimpan</p>
        <p className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0 text-indigo-600" />{photo.geo.lat.toFixed(5)}, {photo.geo.lng.toFixed(5)}</p>
        <p>Akurasi ±{Math.round(photo.geo.accuracy)} m</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <button type="button" aria-label="Ambil ulang foto" onClick={() => setCameraKey(key)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"><RefreshCw className="h-4 w-4" /></button>
      </div>
    </div>;
  }

  return <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between text-sm"><h2 className="font-bold text-slate-900">Laporan visit</h2><span className="font-semibold tabular-nums text-slate-600">{stepsDone}/{steps} langkah</span></div>
      <ProgressBar value={stepsDone} max={steps} tone={ready ? 'emerald' : 'indigo'} className="mt-2.5" />
      <p className="mt-3 text-xs leading-5 text-slate-500">Mulai dari foto toko, lalu tuliskan laporan Anda pada tiga bagian di bawah. Tulis selengkapnya; jika tidak ada yang perlu dilaporkan, tulis “Tidak ada”. Foto diambil langsung lewat kamera beserta lokasi GPS.</p>
    </div>
    <fieldset disabled={busy} className="space-y-3 disabled:opacity-70">
      <div className={`space-y-3 rounded-2xl border bg-white p-4 ${photos.store ? 'border-emerald-200' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2.5"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${photos.store ? 'bg-emerald-600 text-white' : 'bg-indigo-100 text-indigo-700'}`}>{photos.store ? <Check className="h-4 w-4" /> : <Camera className="h-3.5 w-3.5" />}</span><h3 className="font-semibold">Foto toko <span className="text-xs font-medium text-rose-600">wajib</span></h3></div>
        {photoControl('store', 'Ambil foto toko')}
      </div>
      {VISIT_FIELDS.map((field, index) => {
        const text = texts[field.id] ?? '';
        const done = !!text.trim();
        return <div key={field.id} className={`space-y-2.5 rounded-2xl border bg-white p-4 ${done ? 'border-emerald-200' : 'border-slate-200'}`}>
          <label htmlFor={`field-${field.id}`} className="flex items-center gap-2.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>
            <span className="font-semibold leading-6 text-slate-900">{field.label} <span className="text-xs font-medium text-rose-600">wajib</span></span>
          </label>
          <textarea id={`field-${field.id}`} rows={6} maxLength={VISIT_FIELD_MAX} value={text} onChange={(e) => setTexts((prev) => ({ ...prev, [field.id]: e.target.value }))} placeholder={field.placeholder} className="block w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-base leading-6 focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          <p className="text-right text-xs tabular-nums text-slate-400">{text.length.toLocaleString('id-ID')} / {VISIT_FIELD_MAX.toLocaleString('id-ID')}</p>
        </div>;
      })}
    </fieldset>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    <p className="text-xs leading-5 text-slate-500">Foto berlaku selama 30 menit. Lokasi diperiksa kembali saat dikirim. Visit yang disimpan masuk riwayat dan tidak dapat diubah.</p>
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
      <div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{ready ? 'Siap dikirim' : `${steps - stepsDone} langkah lagi`}</span></div>
      <Button type="button" onClick={submit} disabled={busy || !ready || !detail.store.hasCoordinates} className="min-h-12 w-full bg-indigo-600 hover:bg-indigo-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}{busy ? 'Memvalidasi lokasi dan menyimpan…' : 'Validasi lokasi & kirim visit'}
      </Button>
    </div>
    <CameraCapture open={cameraKey !== null} onClose={() => setCameraKey(null)} onCapture={capture} title="Foto toko" />
  </div>;
}
