'use client';
// app/employee/tasks/item-dropping/[id]/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
  PackageOpen, PackageCheck, Clock, AlertTriangle,
  History, ChevronDown, ChevronUp,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending' | 'in_progress' | 'completed'
  | 'discrepancy' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface ItemDroppingData {
  id:               string;
  scheduleId:       string;
  userId:           string;
  storeId:          string;
  shift:            'morning' | 'evening';
  date:             string;
  status:           TaskStatus;
  notes:            string | null;
  completedAt:      string | null;
  verifiedBy:       string | null;
  verifiedAt:       string | null;
  parentTaskId:     number | null;
  hasDropping:      boolean;
  dropTime:         string | null;
  droppingPhotos:   string[];
  isReceived:       boolean;
  receiveTime:      string | null;
  receivePhotos:    string[];
  receivedByUserId: string | null;
}

// ─── Photo rules (mirrors server) ─────────────────────────────────────────────

const PHOTO_RULES = {
  dropping: { min: 1, max: 5 },
  receive:  { min: 1, max: 5 },
} as const;

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo() {
  const [geo,      setGeo]      = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);

  const refresh = useCallback(() => {
    setGeoReady(false);
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError('Geolocation tidak didukung.');
      setGeoReady(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => { setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoReady(true); },
      ()  => { setGeoError('Lokasi tidak dapat diperoleh.'); setGeoReady(true); },
      { timeout: 10_000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { geo, geoError, geoReady, refresh };
}

// ─── Access hook ──────────────────────────────────────────────────────────────

function useAccessStatus(
  scheduleId: string,
  storeId:    string,
  geo:        { lat: number; lng: number } | null,
  geoReady:   boolean,
  taskStatus: TaskStatus | undefined,
) {
  const [accessStatus,  setAccessStatus]  = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetchAccess = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) {
      setAccessStatus({ status: 'ok' });
      setAccessLoading(false);
      return;
    }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const params = new URLSearchParams({ scheduleId, storeId });
      if (geo) { params.set('lat', String(geo.lat)); params.set('lng', String(geo.lng)); }
      const res  = await fetch(`/api/employee/tasks/access?${params}`);
      const data = await res.json() as AccessStatus;
      setAccessStatus(data);
    } catch {
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => { if (geoReady) fetchAccess(); }, [geoReady, fetchAccess]);
  return { accessStatus, accessLoading, refreshAccess: fetchAccess };
}

// ─── Access banner ────────────────────────────────────────────────────────────

function AccessBanner({
  accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess,
}: {
  accessStatus: AccessStatus | null; accessLoading: boolean; geoReady: boolean;
  geo: { lat: number; lng: number } | null; geoError: string | null;
  onRefreshGeo: () => void; onRefreshAccess: () => void;
}) {
  if (!geoReady || accessLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
      </div>
    );
  }
  if (!accessStatus) return null;
  if (accessStatus.status === 'not_checked_in') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
        <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-red-700">Belum absen masuk</p>
          <p className="mt-0.5 text-xs text-red-600">Lakukan absensi masuk terlebih dahulu.</p>
        </div>
        <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Cek ulang
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'outside_geofence') {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
        <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-orange-700">Di luar area toko</p>
          <p className="mt-0.5 text-xs text-orange-600">
            Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).
          </p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Perbarui
        </button>
      </div>
    );
  }
  if (accessStatus.status === 'geo_unavailable') {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p>
          <p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan tanpa rekam lokasi.</p>
        </div>
        <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Coba lagi
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})
      </p>
    </div>
  );
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ status, lastSaved }: {
  status: 'idle' | 'saving' | 'saved' | 'error'; lastSaved: Date | null;
}) {
  if (status === 'idle') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50  text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50   text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud    className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}` : ''}</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

// ─── Photo Uploader ───────────────────────────────────────────────────────────

function PhotoUploader({
  label, photoType, photos, onChange, min, max, disabled, hint,
}: {
  label: string; photoType: string; photos: string[];
  onChange: (urls: string[]) => void;
  min?: number; max: number; disabled?: boolean; hint?: string;
}) {
  const inputRef          = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const needed = min ? Math.max(0, min - photos.length) : 0;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length >= max) { toast.error(`Maksimal ${max} foto`); return; }
    setUploading(true);
    try {
      const toUpload = Array.from(files).slice(0, max - photos.length);
      const urls: string[] = [];
      for (const file of toUpload) {
        const form = new FormData();
        form.append('file', file);
        form.append('photoType', photoType);
        const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload gagal');
        urls.push(data.url);
      }
      onChange([...photos, ...urls]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">{label}</p>
        {needed > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">Butuh {needed} lagi</span>
        )}
        {needed === 0 && photos.length > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
            <Check className="h-3 w-3" strokeWidth={3} />Cukup
          </span>
        )}
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!disabled && (
              <button onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label={`Hapus foto ${i + 1}`}>
                <X className="h-3 w-3" />
              </button>
            )}
            <div className="absolute bottom-0.5 left-0.5 rounded-full bg-black/60 px-1 py-0 text-[9px] font-bold text-white">{i + 1}</div>
          </div>
        ))}
        {!disabled && photos.length < max && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50">
            {uploading
              ? <Loader2 className="h-5 w-5 animate-spin" />
              : <><Camera className="h-5 w-5" /><span className="text-[9px] font-semibold">Tambah</span></>}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        multiple={max > 1} className="hidden" onChange={e => handleFiles(e.target.files)} />
      <p className="text-[10px] text-muted-foreground">
        {photos.length}/{max} foto{min ? ` · minimal ${min}` : ''}
      </p>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children, accent }: {
  title: string; children: React.ReactNode; accent?: string;
}) {
  return (
    <div className="space-y-3">
      <p className={cn('text-[10px] font-bold uppercase tracking-widest', accent ?? 'text-muted-foreground')}>{title}</p>
      {children}
    </div>
  );
}

// ─── Option button ────────────────────────────────────────────────────────────

function OptionButton({ selected, onClick, icon: Icon, label, description, color, disabled }: {
  selected: boolean; onClick: () => void; icon: React.ElementType;
  label: string; description: string; color: 'green' | 'amber'; disabled?: boolean;
}) {
  const c = {
    green: { active: 'border-green-400 bg-green-50', icon: 'bg-green-100 text-green-700', label: 'text-green-800', inactive: 'border-border bg-card hover:border-green-200' },
    amber: { active: 'border-amber-400 bg-amber-50', icon: 'bg-amber-100 text-amber-700', label: 'text-amber-800', inactive: 'border-border bg-card hover:border-amber-200' },
  }[color];
  return (
    <button type="button" onClick={() => !disabled && onClick()}
      className={cn('flex w-full items-start gap-3 rounded-2xl border-2 p-4 text-left transition-all', selected ? c.active : c.inactive, disabled && 'cursor-default opacity-60')}>
      <div className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl transition-colors', selected ? c.icon : 'bg-secondary text-muted-foreground')}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center gap-2">
          <p className={cn('text-sm font-bold', selected ? c.label : 'text-foreground')}>{label}</p>
          {selected && (
            <span className={cn('flex h-4 w-4 items-center justify-center rounded-full', color === 'green' ? 'bg-green-500' : 'bg-amber-500')}>
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

// ─── Time field ───────────────────────────────────────────────────────────────

function TimeField({ label, hint, value, onChange, disabled }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className="relative">
        <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input type="datetime-local" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
          className="w-full rounded-xl border border-border bg-secondary py-3 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
      </div>
    </div>
  );
}

// ─── Locked overlay ───────────────────────────────────────────────────────────

function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') return null;
  const isCheckIn = accessStatus.status === 'not_checked_in';
  return (
    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-10">
      <div className={cn('flex h-12 w-12 items-center justify-center rounded-full', isCheckIn ? 'bg-red-100' : 'bg-orange-100')}>
        {isCheckIn ? <LogIn className="h-6 w-6 text-red-600" /> : <NavigationOff className="h-6 w-6 text-orange-600" />}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-orange-700')}>
        {isCheckIn ? 'Absen masuk dulu' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}

// ─── Carry-forward banner ─────────────────────────────────────────────────────

function CarryForwardBanner({
  task, onConfirmReceipt, disabled,
}: {
  task: ItemDroppingData; onConfirmReceipt: () => void; disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const dropDate    = task.date     ? new Date(task.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '–';
  const dropTimeStr = task.dropTime ? new Date(task.dropTime).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '–';

  return (
    <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <History className="h-5 w-5 text-amber-700" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-800">Item Dropping Belum Diterima</p>
          <p className="mt-0.5 text-[11px] text-amber-700">
            Dropping dari {dropDate} pukul {dropTimeStr} belum dikonfirmasi penerimaannya.
          </p>
        </div>
        <button onClick={() => setExpanded(e => !e)}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1.5 text-[10px] font-semibold text-amber-700">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Detail
        </button>
      </div>

      {expanded && task.droppingPhotos.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Foto dropping kemarin</p>
          <div className="flex flex-wrap gap-2">
            {task.droppingPhotos.map((url, i) => (
              <div key={i} className="relative h-16 w-16 overflow-hidden rounded-xl border border-amber-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {!disabled && (
        <div className="border-t border-amber-200 px-4 py-3">
          <button type="button" onClick={onConfirmReceipt}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white hover:bg-amber-600 active:scale-[0.98]">
            <PackageCheck className="h-4 w-4" />
            Konfirmasi Penerimaan Item
          </button>
          <p className="mt-1.5 text-center text-[10px] text-amber-600">
            Upload foto penerimaan untuk menyelesaikan task ini
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Confirm Receipt Modal (with photo upload) ────────────────────────────────

function ConfirmReceiptModal({
  open, onClose, onConfirm, submitting,
}: {
  open: boolean; onClose: () => void;
  onConfirm: (receiveTime: string, receivePhotos: string[], notes: string) => void;
  submitting: boolean;
}) {
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  const [receiveTime,   setReceiveTime]   = useState(localNow);
  const [receivePhotos, setReceivePhotos] = useState<string[]>([]);
  const [notes,         setNotes]         = useState('');

  useEffect(() => {
    if (open) {
      const n = new Date();
      setReceiveTime(new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      setReceivePhotos([]);
      setNotes('');
    }
  }, [open]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const photosSatisfied = receivePhotos.length >= PHOTO_RULES.receive.min;
  const canConfirm      = !!receiveTime && photosSatisfied && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center bottom-16"
      onClick={onClose} role="dialog" aria-modal="true">
      <div className="relative w-full max-w-md rounded-t-3xl bg-background shadow-xl sm:rounded-3xl max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-foreground">Konfirmasi Penerimaan</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Catat waktu & upload foto bukti penerimaan.</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <TimeField
            label="Waktu Penerimaan"
            hint="Waktu saat item diterima oleh karyawan toko."
            value={receiveTime}
            onChange={setReceiveTime}
          />

          {/* Receive photos — REQUIRED */}
          <PhotoUploader
            label="Foto Penerimaan"
            photoType="item_dropping_receive"
            photos={receivePhotos}
            min={PHOTO_RULES.receive.min}
            max={PHOTO_RULES.receive.max}
            hint="Foto barang yang sudah diterima sebagai bukti penerimaan. Wajib minimal 1."
            onChange={setReceivePhotos}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Catatan (opsional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Catatan tambahan…"
              className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-border px-5 py-4">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-foreground">
            Batal
          </button>
          <button onClick={() => onConfirm(receiveTime, receivePhotos, notes)}
            disabled={!canConfirm}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-bold transition-all',
              canConfirm
                ? 'bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.98]'
                : 'bg-secondary text-muted-foreground opacity-60',
            )}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
            Konfirmasi
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ItemDroppingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<ItemDroppingData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [priorTask,          setPriorTask]          = useState<ItemDroppingData | null>(null);
  const [confirmReceiptOpen, setConfirmReceiptOpen] = useState(false);
  const [confirmingReceipt,  setConfirmingReceipt]  = useState(false);

  // Form state
  const [hasDropping,    setHasDropping]    = useState<boolean | null>(null);
  const [dropTime,       setDropTime]       = useState('');
  const [droppingPhotos, setDroppingPhotos] = useState<string[]>([]);
  const [isReceived,     setIsReceived]     = useState(false);
  const [receiveTime,    setReceiveTime]    = useState('');
  const [receivePhotos,  setReceivePhotos]  = useState<string[]>([]);
  const [notes,          setNotes]          = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: ItemDroppingData }[] };

      const found = data.tasks?.find(t => t.type === 'item_dropping' && t.data.id === taskId);
      if (found) {
        const d = found.data;
        setTaskData(d);
        setHasDropping(d.hasDropping);
        setIsReceived(d.isReceived);
        setDroppingPhotos(d.droppingPhotos ?? []);
        setReceivePhotos(d.receivePhotos ?? []);
        setNotes(d.notes ?? '');

        const toLocal = (iso: string | null) => {
          if (!iso) return '';
          const dt = new Date(iso);
          return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        };
        setDropTime(toLocal(d.dropTime));
        setReceiveTime(toLocal(d.receiveTime));

        if (d.status === 'discrepancy' && !d.parentTaskId) setPriorTask(d);
      } else {
        setTaskData(null);
      }
    } catch (e) {
      console.error('[ItemDroppingDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/item-dropping', baseBody: { scheduleId }, debounceMs: 800,
  });

  const taskStatus    = taskData?.status;
  const readonly      = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected    = taskStatus === 'rejected';
  const isDiscrepancy = taskStatus === 'discrepancy';
  const locked        = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  // ── Submit gate ───────────────────────────────────────────────────────────
  const scenarioAReady = hasDropping === false;

  const dropTimeFilled        = !!dropTime;
  const droppingPhotosFilled  = droppingPhotos.length >= PHOTO_RULES.dropping.min;
  const receivePhotosFilled   = receivePhotos.length  >= PHOTO_RULES.receive.min;
  // Scenario B is ready to submit when:
  //   - drop details filled
  //   - if isReceived=true: receiveTime + receivePhotos also filled
  //   - if isReceived=false: ok (will become discrepancy)
  const scenarioBReady =
    hasDropping === true &&
    dropTimeFilled &&
    droppingPhotosFilled &&
    (!isReceived || (!!receiveTime && receivePhotosFilled));

  const canSubmit = !locked && (scenarioAReady || scenarioBReady);

  const submitHint = (() => {
    if (locked || hasDropping === null) return '';
    if (hasDropping === false) return '';
    if (!dropTimeFilled)         return 'Isi waktu dropping terlebih dahulu.';
    if (!droppingPhotosFilled)   return `Upload minimal ${PHOTO_RULES.dropping.min} foto dropping.`;
    if (isReceived && !receiveTime)        return 'Isi waktu penerimaan.';
    if (isReceived && !receivePhotosFilled) return `Upload minimal ${PHOTO_RULES.receive.min} foto penerimaan.`;
    return '';
  })();

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/item-dropping', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId, storeId,
          geo: geo ?? null, skipGeo: geo === null,
          hasDropping: hasDropping ?? false,
          dropTime:    dropTime   ? new Date(dropTime).toISOString()   : undefined,
          droppingPhotos,
          isReceived,
          receiveTime: receiveTime ? new Date(receiveTime).toISOString() : undefined,
          receivePhotos,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }

      const successMsg = !hasDropping
        ? 'Item Dropping berhasil disubmit! Tidak ada dropping hari ini. ✓'
        : isReceived
          ? 'Item Dropping berhasil disubmit! Item sudah diterima. ✓'
          : 'Item Dropping disubmit. Item belum diterima — akan dilanjutkan besok.';

      toast.success(successMsg, { duration: 5000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirm receipt (carry-forward) ───────────────────────────────────────
  async function handleConfirmReceipt(rcvTime: string, rcvPhotos: string[], rcvNotes: string) {
    if (!priorTask) return;
    setConfirmingReceipt(true);
    try {
      const res = await fetch('/api/employee/tasks/item-dropping', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId:       parseInt(priorTask.id, 10),
          scheduleId, storeId,
          geo:          geo ?? null, skipGeo: geo === null,
          receiveTime:  rcvTime  ? new Date(rcvTime).toISOString() : undefined,
          receivePhotos: rcvPhotos,
          notes:        rcvNotes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        toast.error(msg, { duration: 6000 }); return;
      }

      toast.success('Penerimaan item berhasil dikonfirmasi! ✓', { duration: 4000 });
      setConfirmReceiptOpen(false);
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      toast.error(msg, { duration: 6000 });
    } finally {
      setConfirmingReceipt(false);
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  const statusLabel: Record<TaskStatus, string> = {
    pending: 'Menunggu', in_progress: 'Sedang Diisi', completed: 'Selesai',
    discrepancy: 'Belum Diterima', verified: 'Terverifikasi', rejected: 'Ditolak',
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Item Dropping</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {statusLabel[taskData.status]}</p>}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
        {taskStatus === 'completed'   && <span className="flex items-center gap-1 rounded-full bg-green-100  px-2.5 py-1 text-[10px] font-bold text-green-700" ><CheckCircle2  className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'    && <span className="flex items-center gap-1 rounded-full bg-green-200  px-2.5 py-1 text-[10px] font-bold text-green-800" ><CheckCircle2  className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'discrepancy' && <span className="flex items-center gap-1 rounded-full bg-amber-100  px-2.5 py-1 text-[10px] font-bold text-amber-700" ><AlertTriangle className="h-3 w-3" />Belum Diterima</span>}
        {taskStatus === 'rejected'    && <span className="flex items-center gap-1 rounded-full bg-red-100    px-2.5 py-1 text-[10px] font-bold text-red-700"  ><AlertCircle   className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 p-4 pb-10">

        {!readonly && !loading && taskData && (
          <AccessBanner accessStatus={accessStatus} accessLoading={accessLoading} geoReady={geoReady}
            geo={geo} geoError={geoError} onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess} />
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
          </div>
        )}

        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{fmt(taskData.verifiedAt)}</p>
          </div>
        )}

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-2xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="relative">
            <LockedOverlay accessStatus={accessStatus} />
            <div className="space-y-6">

              {/* Carry-forward banner */}
              {isDiscrepancy && priorTask && (
                <Section title="Pending dari Hari Sebelumnya" accent="text-amber-600">
                  <CarryForwardBanner task={priorTask} onConfirmReceipt={() => setConfirmReceiptOpen(true)} disabled={dis} />
                </Section>
              )}

              {/* Read-only detail view */}
              {(readonly || isDiscrepancy) && (
                <Section title="Detail Task">
                  <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Ada Item Dropping?</span>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-bold', taskData.hasDropping ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>
                        {taskData.hasDropping ? 'Ya' : 'Tidak'}
                      </span>
                    </div>
                    {taskData.hasDropping && (
                      <>
                        <div className="flex items-center justify-between border-t border-border pt-3">
                          <span className="text-xs text-muted-foreground">Waktu Dropping</span>
                          <span className="text-xs font-semibold">{fmt(taskData.dropTime)}</span>
                        </div>

                        {taskData.droppingPhotos.length > 0 && (
                          <div className="border-t border-border pt-3 space-y-2">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Foto Dropping</p>
                            <div className="flex flex-wrap gap-2">
                              {taskData.droppingPhotos.map((url, i) => (
                                <div key={i} className="h-16 w-16 overflow-hidden rounded-xl border border-border">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={url} alt="" className="h-full w-full object-cover" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between border-t border-border pt-3">
                          <span className="text-xs text-muted-foreground">Status Penerimaan</span>
                          <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-bold', taskData.isReceived ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
                            {taskData.isReceived ? 'Sudah Diterima' : 'Belum Diterima'}
                          </span>
                        </div>

                        {taskData.isReceived && (
                          <>
                            <div className="flex items-center justify-between border-t border-border pt-3">
                              <span className="text-xs text-muted-foreground">Waktu Penerimaan</span>
                              <span className="text-xs font-semibold">{fmt(taskData.receiveTime)}</span>
                            </div>
                            {taskData.receivePhotos.length > 0 && (
                              <div className="border-t border-border pt-3 space-y-2">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Foto Penerimaan</p>
                                <div className="flex flex-wrap gap-2">
                                  {taskData.receivePhotos.map((url, i) => (
                                    <div key={i} className="h-16 w-16 overflow-hidden rounded-xl border border-border">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={url} alt="" className="h-full w-full object-cover" />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                    {taskData.notes && (
                      <div className="border-t border-border pt-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Catatan</p>
                        <p className="mt-1 text-xs text-foreground">{taskData.notes}</p>
                      </div>
                    )}
                    <div className="border-t border-border pt-3">
                      <p className="text-[10px] text-muted-foreground">Tanggal: {fmt(taskData.date)}</p>
                      {taskData.completedAt && <p className="text-[10px] text-muted-foreground">Selesai: {fmt(taskData.completedAt)}</p>}
                    </div>
                  </div>
                </Section>
              )}

              {/* Editable form */}
              {!readonly && !isDiscrepancy && (
                <>
                  {/* Scenario selector */}
                  <Section title="Ada Item Dropping Hari Ini?">
                    <div className="space-y-2.5">
                      <OptionButton selected={hasDropping === false}
                        onClick={() => { setHasDropping(false); autoSave({ hasDropping: false }); }}
                        icon={PackageCheck} label="Tidak Ada Dropping"
                        description="Tidak ada pengiriman barang hari ini. Task langsung selesai."
                        color="green" disabled={dis} />
                      <OptionButton selected={hasDropping === true}
                        onClick={() => { setHasDropping(true); autoSave({ hasDropping: true }); }}
                        icon={PackageOpen} label="Ada Item Dropping"
                        description="Ada barang yang dikirim hari ini. Isi detail dropping di bawah."
                        color="amber" disabled={dis} />
                    </div>
                  </Section>

                  {/* Dropping details */}
                  {hasDropping === true && (
                    <>
                      <Section title="Detail Dropping">
                        <div className="space-y-4">
                          <TimeField label="Waktu Dropping" hint="Waktu saat barang tiba di toko."
                            value={dropTime} disabled={dis}
                            onChange={v => { setDropTime(v); autoSave({ dropTime: v ? new Date(v).toISOString() : null }); }} />
                          <PhotoUploader label="Foto Dropping" photoType="item_dropping"
                            photos={droppingPhotos} min={PHOTO_RULES.dropping.min} max={PHOTO_RULES.dropping.max}
                            disabled={dis} hint="Foto barang yang tiba di toko sebagai bukti dropping. Minimal 1 foto."
                            onChange={urls => { setDroppingPhotos(urls); autoSave({ droppingPhotos: urls }, { immediate: true }); }} />
                        </div>
                      </Section>

                      {/* Receipt section */}
                      <Section title="Penerimaan Barang">
                        <div className={cn('rounded-2xl border-2 p-4 space-y-4 transition-all', isReceived ? 'border-green-300 bg-green-50' : 'border-border bg-card')}>
                          {/* Toggle */}
                          <button type="button" disabled={dis}
                            onClick={() => {
                              const next = !isReceived;
                              setIsReceived(next);
                              if (!next) { setReceiveTime(''); setReceivePhotos([]); }
                              autoSave({ isReceived: next, receiveTime: next ? receiveTime || null : null, receivePhotos: next ? receivePhotos : [] });
                            }}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
                              isReceived ? 'border-green-400 bg-green-100' : 'border-border bg-secondary hover:border-green-200',
                              dis && 'cursor-default opacity-60',
                            )}>
                            <div className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors', isReceived ? 'border-green-500 bg-green-500' : 'border-border')}>
                              {isReceived && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="text-sm font-semibold text-foreground">Barang sudah diterima karyawan toko</span>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Centang jika barang sudah diperiksa dan diterima saat ini.</p>
                            </div>
                          </button>

                          {/* Receipt details — shown when isReceived=true */}
                          {isReceived && (
                            <div className="space-y-4">
                              <TimeField label="Waktu Penerimaan" hint="Waktu saat karyawan toko menerima barang."
                                value={receiveTime} disabled={dis}
                                onChange={v => { setReceiveTime(v); autoSave({ receiveTime: v ? new Date(v).toISOString() : null }); }} />
                              <PhotoUploader label="Foto Penerimaan" photoType="item_dropping_receive"
                                photos={receivePhotos} min={PHOTO_RULES.receive.min} max={PHOTO_RULES.receive.max}
                                disabled={dis} hint="Foto barang yang sudah diterima sebagai bukti. Minimal 1 foto."
                                onChange={urls => { setReceivePhotos(urls); autoSave({ receivePhotos: urls }, { immediate: true }); }} />
                            </div>
                          )}

                          {/* Warning when not yet received */}
                          {!isReceived && (
                            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                              <p className="text-[11px] text-amber-700">
                                Jika barang belum diterima saat submit, task akan dilanjutkan ke shift besok dan perlu foto penerimaan saat dikonfirmasi.
                              </p>
                            </div>
                          )}
                        </div>
                      </Section>
                    </>
                  )}

                  {/* Notes */}
                  <Section title="Catatan (opsional)">
                    <textarea value={notes} disabled={dis} rows={3}
                      onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                      placeholder="Tambahkan catatan jika ada…"
                      className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
                  </Section>

                  {/* Submit */}
                  <button type="button" onClick={handleSubmit} disabled={!canSubmit || submitting}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40">
                    {submitting
                      ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
                      : <><CheckCircle2 className="h-4 w-4" />Submit Item Dropping</>}
                  </button>

                  {!canSubmit && submitHint && (
                    <p className="text-center text-[11px] text-muted-foreground">{submitHint}</p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Confirm Receipt Modal */}
      <ConfirmReceiptModal
        open={confirmReceiptOpen}
        onClose={() => setConfirmReceiptOpen(false)}
        onConfirm={handleConfirmReceipt}
        submitting={confirmingReceipt}
      />
    </div>
  );
}