'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, MapPin, Check, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import CameraCapture from '@/components/shared/CameraCapture';
import { Button } from '@/components/ui/button';
import { ProgressBar } from '@/components/ops/store-visits/shared';
import type { VisitDetail, VisitPhotoGeo } from '@/lib/store-visit/types';
import { createVisitId } from '@/lib/store-visit/client';

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
  const [answers, setAnswers] = useState<Record<string, { answer: string; note: string }>>({});
  const [photos, setPhotos] = useState<Record<string, Capture>>({});
  const [cameraKey, setCameraKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
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

  const photoKeys = ['store', ...detail.tasks.filter((t) => t.requirePhoto).map((t) => `task_${t.id}`)];
  const taskDone = (t: VisitDetail['tasks'][number]) => !!answers[t.id]?.answer && (answers[t.id]?.answer !== 'tidak' || !!answers[t.id]?.note.trim()) && (!t.requirePhoto || !!photos[`task_${t.id}`]);
  const complete = detail.tasks.filter(taskDone).length;
  const ready = complete === detail.tasks.length && photoKeys.every((key) => !!photos[key]);
  const steps = detail.tasks.length + 1;
  const stepsDone = complete + (photos.store ? 1 : 0);
  const findings = detail.tasks.filter((t) => answers[t.id]?.answer === 'tidak').length;

  async function submit() {
    setBusy(true); setError('');
    try {
      const geo = await location();
      const form = new FormData();
      form.append('data', JSON.stringify({ id, version: detail.version, answers, notes, geo, photos: Object.fromEntries(photoKeys.map((key) => [key, photos[key].geo])) }));
      photoKeys.forEach((key) => form.append(key, photos[key].file));
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

  const ANSWER_STYLE = {
    ya: { on: 'border-emerald-600 bg-emerald-600 text-white', off: 'border-slate-200 bg-white text-slate-700 hover:bg-emerald-50', label: 'Ya, sesuai', icon: Check },
    tidak: { on: 'border-rose-600 bg-rose-600 text-white', off: 'border-slate-200 bg-white text-slate-700 hover:bg-rose-50', label: 'Tidak, ada temuan', icon: X },
  } as const;

  return <div className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between text-sm"><h2 className="font-bold text-slate-900">Checklist visit</h2><span className="font-semibold tabular-nums text-slate-600">{stepsDone}/{steps} langkah</span></div>
      <ProgressBar value={stepsDone} max={steps} tone={ready ? 'emerald' : 'indigo'} className="mt-2.5" />
      <p className="mt-3 text-xs leading-5 text-slate-500">Mulai dari foto toko, lalu periksa setiap poin. Pilih “Tidak” jika ada temuan dan tuliskan catatannya. Foto diambil langsung lewat kamera beserta lokasi GPS.</p>
    </div>
    <fieldset disabled={busy} className="space-y-3 disabled:opacity-70">
      <div className={`space-y-3 rounded-2xl border bg-white p-4 ${photos.store ? 'border-emerald-200' : 'border-slate-200'}`}>
        <div className="flex items-center gap-2.5"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${photos.store ? 'bg-emerald-600 text-white' : 'bg-indigo-100 text-indigo-700'}`}>{photos.store ? <Check className="h-4 w-4" /> : <Camera className="h-3.5 w-3.5" />}</span><h3 className="font-semibold">Foto toko <span className="text-xs font-medium text-rose-600">wajib</span></h3></div>
        {photoControl('store', 'Ambil foto toko')}
      </div>
      {detail.tasks.map((task, index) => {
        const done = taskDone(task);
        const current = answers[task.id]?.answer;
        return <div key={task.id} className={`space-y-3 rounded-2xl border bg-white p-4 ${done ? 'border-emerald-200' : 'border-slate-200'}`}>
          <div className="flex items-start gap-2.5">
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{done ? <Check className="h-4 w-4" /> : index + 1}</span>
            <h3 id={`task-${task.id}`} className="font-semibold leading-6 text-slate-900">{task.label}</h3>
          </div>
          <div role="group" aria-labelledby={`task-${task.id}`} className="grid grid-cols-2 gap-2">
            {(['ya', 'tidak'] as const).map((answer) => {
              const s = ANSWER_STYLE[answer]; const Icon = s.icon; const active = current === answer;
              return <button key={answer} type="button" aria-pressed={active} onClick={() => setAnswers((prev) => ({ ...prev, [task.id]: { note: prev[task.id]?.note ?? '', answer } }))}
                className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-indigo-500 ${active ? s.on : s.off}`}>
                {active && <Icon className="h-4 w-4 shrink-0" />}{s.label}
              </button>;
            })}
          </div>
          {current && <label className="block text-sm text-slate-600">Catatan {current === 'tidak' ? <span className="text-rose-600">(wajib)</span> : '(opsional)'}
            <textarea maxLength={1000} rows={2} value={answers[task.id]?.note ?? ''} onChange={(e) => setAnswers((prev) => ({ ...prev, [task.id]: { answer: prev[task.id]?.answer ?? '', note: e.target.value } }))} placeholder="Jelaskan temuan…" className="mt-1 w-full rounded-xl border border-slate-200 bg-white p-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-200" />
          </label>}
          {task.requirePhoto && <div className="space-y-1.5"><p className="text-xs font-semibold text-slate-600">Foto bukti <span className="text-rose-600">wajib</span></p>{photoControl(`task_${task.id}`, 'Ambil foto task')}</div>}
        </div>;
      })}
      <label className="block rounded-2xl border border-slate-200 bg-white p-4 text-sm font-semibold text-slate-700">Catatan kunjungan <span className="font-normal text-slate-500">(opsional)</span><textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-base font-normal focus:outline-none focus:ring-2 focus:ring-indigo-200" /></label>
    </fieldset>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    <p className="text-xs leading-5 text-slate-500">Foto berlaku selama 30 menit. Lokasi diperiksa kembali saat dikirim. Visit yang disimpan masuk riwayat dan tidak dapat diubah.</p>
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
      <div className="mb-2 flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{ready ? 'Siap dikirim' : `${steps - stepsDone} langkah lagi`}</span>{findings > 0 && <span className="font-semibold text-rose-600">{findings} temuan</span>}</div>
      <Button type="button" onClick={submit} disabled={busy || !ready || !detail.store.hasCoordinates} className="min-h-12 w-full bg-indigo-600 hover:bg-indigo-700">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}{busy ? 'Memvalidasi lokasi dan menyimpan…' : 'Validasi lokasi & kirim visit'}
      </Button>
    </div>
    <CameraCapture open={cameraKey !== null} onClose={() => setCameraKey(null)} onCapture={capture} title={cameraKey === 'store' ? 'Foto toko' : 'Foto checklist visit'} />
  </div>;
}
