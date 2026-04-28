'use client';
// app/employee/tasks/item-dropping/[id]/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter }                      from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
  PackageOpen, PackageCheck, Clock, Hash,
  ChevronDown, ChevronUp, WifiOff,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';
import type { AvailableTo } from '@/app/api/employee/tasks/item-dropping/available-tos/route';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus =
  | 'pending' | 'in_progress' | 'completed'
  | 'discrepancy' | 'verified' | 'rejected';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface ToEntry {
  id:             string;
  taskId:         string;
  userId:         string;
  storeId:        string;
  toNumber:       string;
  dropTime:       string | null;
  droppingPhotos: string[];
  notes:          string | null;
  createdAt:      string | null;
}

interface ItemDroppingData {
  id:          string;
  scheduleId:  string;
  userId:      string;
  storeId:     string;
  shift:       'morning' | 'evening' | 'full_day';
  date:        string;
  status:      TaskStatus;
  notes:       string | null;
  completedAt: string | null;
  verifiedBy:  string | null;
  verifiedAt:  string | null;
  hasDropping: boolean;
  entries:     ToEntry[];
}

interface DraftEntry {
  localId:        string;
  toNumber:       string;
  description:    string | null;
  dropTime:       string;
  droppingPhotos: string[];
  notes:          string;
}

const PHOTO_RULES = { dropping: { min: 1, max: 5 } } as const;

function makeDraft(to: AvailableTo): DraftEntry {
  return {
    localId:        crypto.randomUUID(),
    toNumber:       to.toNumber,
    description:    to.description,
    dropTime:       '',
    droppingPhotos: [],
    notes:          '',
  };
}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
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

// ─── TO Selector ──────────────────────────────────────────────────────────────

function ToSelector({
  availableTos, loadingTos, tosError, selectedNumbers, onToggle, onRetry, disabled,
}: {
  availableTos:    AvailableTo[];
  loadingTos:      boolean;
  tosError:        string | null;
  selectedNumbers: Set<string>;
  onToggle:        (to: AvailableTo) => void;
  onRetry:         () => void;
  disabled?:       boolean;
}) {
  if (loadingTos) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-secondary px-4 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
        <p className="text-xs text-muted-foreground">Memuat daftar TO untuk toko ini…</p>
      </div>
    );
  }

  if (tosError) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
        <WifiOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-red-700">Gagal memuat daftar TO</p>
          <p className="mt-0.5 text-[11px] text-red-600">{tosError}</p>
        </div>
        <button onClick={onRetry}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors">
          <RefreshCw className="h-3 w-3" />Coba lagi
        </button>
      </div>
    );
  }

  if (availableTos.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-secondary px-4 py-5 text-center">
        <p className="text-xs font-semibold text-foreground">Tidak ada TO terdaftar</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Belum ada TO yang dialokasikan untuk toko ini hari ini.
        </p>
        <button onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-secondary transition-colors">
          <RefreshCw className="h-3 w-3" />Muat ulang
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {selectedNumbers.size > 0
            ? `${selectedNumbers.size} dari ${availableTos.length} TO dipilih`
            : `${availableTos.length} TO tersedia — pilih yang tiba hari ini`}
        </p>
        <button onClick={onRetry} disabled={disabled}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40">
          <RefreshCw className="h-3 w-3" />Muat ulang
        </button>
      </div>

      {availableTos.map(to => {
        const selected = selectedNumbers.has(to.toNumber);
        return (
          <button key={to.toNumber} type="button"
            onClick={() => !disabled && onToggle(to)}
            className={cn(
              'flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition-all',
              selected ? 'border-amber-400 bg-amber-50' : 'border-border bg-card hover:border-amber-200',
              disabled && 'cursor-default opacity-60',
            )}>
            <div className={cn(
              'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors',
              selected ? 'border-amber-500 bg-amber-500' : 'border-border bg-background',
            )}>
              {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <p className={cn('text-sm font-bold font-mono truncate', selected ? 'text-amber-800' : 'text-foreground')}>
                  {to.toNumber}
                </p>
              </div>
              {to.description && (
                <p className="mt-0.5 text-[11px] text-muted-foreground truncate pl-5">
                  {to.description}
                </p>
              )}
              {to.expectedAt && (
                <p className="mt-0.5 text-[10px] text-muted-foreground pl-5">
                  Estimasi: {new Date(to.expectedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            {selected && (
              <span className="flex-shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                Dipilih
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Draft Entry Card ─────────────────────────────────────────────────────────

function DraftEntryCard({
  entry, index, onChange, onDeselect, disabled,
}: {
  entry:      DraftEntry;
  index:      number;
  disabled?:  boolean;
  onChange:   (patch: Partial<DraftEntry>) => void;
  onDeselect: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const valid = entry.dropTime.length > 0 && entry.droppingPhotos.length >= PHOTO_RULES.dropping.min;

  return (
    <div className={cn(
      'rounded-2xl border-2 transition-colors',
      valid ? 'border-amber-300 bg-amber-50/40' : 'border-amber-200 bg-amber-50/20',
    )}>
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <div className={cn(
          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full',
          valid ? 'bg-amber-500' : 'bg-amber-200',
        )}>
          {valid
            ? <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />
            : <span className="text-[10px] font-bold text-amber-700">{index + 1}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-800 font-mono truncate">{entry.toNumber}</p>
          {entry.description && (
            <p className="text-[10px] text-amber-700 truncate">{entry.description}</p>
          )}
        </div>
        {!disabled && (
          <button type="button"
            onClick={e => { e.stopPropagation(); onDeselect(); }}
            className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors mr-1">
            <X className="h-3 w-3" />Batal
          </button>
        )}
        {expanded
          ? <ChevronUp   className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-amber-200 px-4 pb-4 pt-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Waktu Dropping</label>
            <p className="text-[10px] text-muted-foreground">Waktu saat barang tiba di toko.</p>
            <div className="relative">
              <Clock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input type="datetime-local" value={entry.dropTime} disabled={disabled}
                onChange={e => onChange({ dropTime: e.target.value })}
                className="w-full rounded-xl border border-border bg-secondary py-3 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
            </div>
          </div>

          <PhotoUploader
            label="Foto Dropping"
            photoType="item_dropping"
            photos={entry.droppingPhotos}
            min={PHOTO_RULES.dropping.min}
            max={PHOTO_RULES.dropping.max}
            disabled={disabled}
            hint="Foto barang yang tiba sebagai bukti. Minimal 1 foto."
            onChange={urls => onChange({ droppingPhotos: urls })}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Catatan (opsional)</label>
            <textarea value={entry.notes} disabled={disabled} rows={2}
              onChange={e => onChange({ notes: e.target.value })}
              placeholder="Catatan untuk TO ini…"
              className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Saved Entry Card ─────────────────────────────────────────────────────────

function SavedEntryCard({ entry, index }: { entry: ToEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);

  function fmt(iso: string | null) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
          <Check className="h-3.5 w-3.5 text-green-700" strokeWidth={3} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold font-mono text-foreground truncate">{entry.toNumber}</p>
          <p className="text-[10px] text-muted-foreground">{fmt(entry.dropTime)}</p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700 mr-1">
          TO #{index + 1}
        </span>
        {expanded
          ? <ChevronUp   className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-3">
          {entry.droppingPhotos.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Foto</p>
              <div className="flex flex-wrap gap-2">
                {entry.droppingPhotos.map((url, i) => (
                  <div key={i} className="h-16 w-16 overflow-hidden rounded-xl border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            </div>
          )}
          {entry.notes && <p className="text-[11px] text-muted-foreground">{entry.notes}</p>}
        </div>
      )}
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

  const [availableTos, setAvailableTos] = useState<AvailableTo[]>([]);
  const [loadingTos,   setLoadingTos]   = useState(false);
  const [tosError,     setTosError]     = useState<string | null>(null);

  const [hasDropping,  setHasDropping]  = useState<boolean | null>(null);
  const [selectedNums, setSelectedNums] = useState<Set<string>>(new Set());
  const [drafts,       setDrafts]       = useState<DraftEntry[]>([]);
  const [notes,        setNotes]        = useState('');

  // ── Load task ──────────────────────────────────────────────────────────────

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
        setNotes(d.notes ?? '');
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

  // ── Load available TOs ─────────────────────────────────────────────────────

  const loadTos = useCallback(async (storeId: string, date: string) => {
    setLoadingTos(true);
    setTosError(null);
    try {
      const dateStr = new Date(date).toISOString().slice(0, 10);
      const res  = await fetch(`/api/employee/tasks/item-dropping/available-tos?storeId=${storeId}&date=${dateStr}`);
      const data = await res.json() as { success: boolean; tos?: AvailableTo[]; error?: string };
      if (!data.success) throw new Error(data.error ?? 'Gagal memuat TO');
      setAvailableTos(data.tos ?? []);
    } catch (e) {
      setTosError(e instanceof Error ? e.message : 'Gagal memuat daftar TO.');
    } finally {
      setLoadingTos(false);
    }
  }, []);

  useEffect(() => {
    if (taskData && hasDropping === true) {
      loadTos(taskData.storeId, taskData.date);
    }
  }, [taskData, hasDropping, loadTos]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;
  const taskIdNum  = taskData ? parseInt(taskData.id,         10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/item-dropping', baseBody: { taskId: taskIdNum }, debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked     = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  // ── TO selection ──────────────────────────────────────────────────────────

  function toggleTo(to: AvailableTo) {
    const next = new Set(selectedNums);
    if (next.has(to.toNumber)) {
      next.delete(to.toNumber);
      setDrafts(prev => prev.filter(d => d.toNumber !== to.toNumber));
    } else {
      next.add(to.toNumber);
      setDrafts(prev => [...prev, makeDraft(to)]);
    }
    setSelectedNums(next);
  }

  function deselectTo(toNumber: string) {
    setSelectedNums(prev => { const n = new Set(prev); n.delete(toNumber); return n; });
    setDrafts(prev => prev.filter(d => d.toNumber !== toNumber));
  }

  function patchDraft(localId: string, patch: Partial<DraftEntry>) {
    setDrafts(prev => prev.map(d => d.localId === localId ? { ...d, ...patch } : d));
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function isDraftValid(d: DraftEntry) {
    return d.dropTime.length > 0 && d.droppingPhotos.length >= PHOTO_RULES.dropping.min;
  }

  const canSubmitNoDrop   = hasDropping === false;
  const canSubmitWithDrop = hasDropping === true && drafts.length > 0 && drafts.every(isDraftValid);
  const canSubmit         = !locked && (canSubmitNoDrop || canSubmitWithDrop);

  const submitHint = (() => {
    if (locked || hasDropping === null) return '';
    if (hasDropping === false) return '';
    if (drafts.length === 0)  return 'Pilih minimal satu TO dari daftar di atas.';
    const invalid = drafts.findIndex(d => !isDraftValid(d));
    if (invalid >= 0) {
      const d = drafts[invalid];
      if (!d.dropTime)                   return `${d.toNumber}: Isi waktu dropping.`;
      if (d.droppingPhotos.length === 0) return `${d.toNumber}: Upload minimal 1 foto.`;
    }
    return '';
  })();

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const entries = hasDropping
        ? drafts.map(d => ({
            toNumber:       d.toNumber,
            dropTime:       new Date(d.dropTime).toISOString(),
            droppingPhotos: d.droppingPhotos,
            notes:          d.notes || undefined,
          }))
        : undefined;

      const res = await fetch('/api/employee/tasks/item-dropping', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'submit',
          scheduleId, storeId,
          lat: geo?.lat, lng: geo?.lng,
          skipGeo: geo === null,
          hasDropping: hasDropping ?? false,
          entries,
          notes: notes || undefined,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }

      toast.success(
        hasDropping
          ? `${drafts.length} TO berhasil dicatat. ✓`
          : 'Tidak ada dropping hari ini. Task selesai. ✓',
        { duration: 4000 },
      );
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  function fmt(iso: string | null) {
    if (!iso) return '–';
    return new Date(iso).toLocaleString('id-ID', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  const statusLabel: Record<TaskStatus, string> = {
    pending: 'Menunggu', in_progress: 'Sedang Diisi', completed: 'Selesai',
    discrepancy: 'Perlu Ditindaklanjuti', verified: 'Terverifikasi', rejected: 'Ditolak',
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
          {taskData && (
            <p className="text-[10px] capitalize text-muted-foreground">
              {taskData.shift} shift · {statusLabel[taskData.status]}
            </p>
          )}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"  ><AlertCircle   className="h-3 w-3" />Ditolak</span>}
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
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan.</p>
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

              {/* ── READ-ONLY ──────────────────────────────────────────────── */}
              {readonly && (
                <Section title="Detail Task">
                  <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Ada Item Dropping?</span>
                      <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                        taskData.hasDropping ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')}>
                        {taskData.hasDropping ? `Ya · ${taskData.entries.length} TO` : 'Tidak'}
                      </span>
                    </div>
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
                  {taskData.entries.length > 0 && (
                    <div className="space-y-2 mt-2">
                      {taskData.entries.map((e, i) => <SavedEntryCard key={e.id} entry={e} index={i} />)}
                    </div>
                  )}
                </Section>
              )}

              {/* ── EDITABLE FORM ──────────────────────────────────────────── */}
              {!readonly && (
                <>
                  {/* Step 1 */}
                  <Section title="Ada Item Dropping Hari Ini?">
                    <div className="space-y-2.5">
                      <OptionButton selected={hasDropping === false}
                        onClick={() => {
                          setHasDropping(false);
                          setSelectedNums(new Set());
                          setDrafts([]);
                          autoSave({ hasDropping: false });
                        }}
                        icon={PackageCheck} label="Tidak Ada Dropping"
                        description="Tidak ada pengiriman barang hari ini. Task langsung selesai."
                        color="green" disabled={dis} />
                      <OptionButton selected={hasDropping === true}
                        onClick={() => { setHasDropping(true); autoSave({ hasDropping: true }); }}
                        icon={PackageOpen} label="Ada Item Dropping"
                        description="Ada barang yang dikirim hari ini. Pilih nomor TO dari daftar."
                        color="amber" disabled={dis} />
                    </div>
                  </Section>

                  {/* Step 2 — TO list */}
                  {hasDropping === true && (
                    <Section title={`Pilih Nomor TO${selectedNums.size > 0 ? ` · ${selectedNums.size} dipilih` : ''}`}>
                      <ToSelector
                        availableTos={availableTos}
                        loadingTos={loadingTos}
                        tosError={tosError}
                        selectedNumbers={selectedNums}
                        onToggle={toggleTo}
                        onRetry={() => taskData && loadTos(taskData.storeId, taskData.date)}
                        disabled={dis}
                      />
                    </Section>
                  )}

                  {/* Step 3 — detail per TO */}
                  {hasDropping === true && drafts.length > 0 && (
                    <Section title={`Detail Dropping · ${drafts.length} TO`}>
                      <div className="space-y-3">
                        {drafts.map((d, i) => (
                          <DraftEntryCard
                            key={d.localId}
                            entry={d}
                            index={i}
                            disabled={dis}
                            onChange={patch => patchDraft(d.localId, patch)}
                            onDeselect={() => deselectTo(d.toNumber)}
                          />
                        ))}
                      </div>
                    </Section>
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
    </div>
  );
}