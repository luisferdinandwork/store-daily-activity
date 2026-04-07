'use client';
// app/employee/tasks/[type]/[id]/page.tsx

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter }  from 'next/navigation';
import {
  ArrowLeft, CheckCircle2, Camera, X, Loader2,
  MapPin, AlertCircle, Check, Cloud, CloudOff, Save,
  LogIn, Navigation, NavigationOff, RefreshCw,
} from 'lucide-react';
import { cn }          from '@/lib/utils';
import { toast }       from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskType =
  | 'store_opening' | 'setoran'    | 'cek_bin'
  | 'product_check' | 'receiving'
  | 'briefing'      | 'edc_summary'| 'edc_settlement'
  | 'eod_z_report'  | 'open_statement'
  | 'grooming';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected';

/**
 * Mirrors TaskAccessStatus from lib/db/utils/tasks.ts.
 * Returned by GET /api/employee/tasks/access?scheduleId=…&storeId=…&lat=…&lng=…
 */
type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface TaskBase {
  id: string; scheduleId: string; userId: string; storeId: string;
  shift: 'morning' | 'evening'; date: string; status: TaskStatus;
  notes: string | null; completedAt: string | null;
  verifiedBy: string | null; verifiedAt: string | null;
}
interface StoreOpeningData extends TaskBase {
  loginPos: boolean; checkAbsenSunfish: boolean; tarikSohSales: boolean;
  fiveR: boolean; cekLamp: boolean; cekSoundSystem: boolean;
  storeFrontPhotos: string[]; cashDrawerPhotos: string[];
}
interface SetoranData      extends TaskBase { amount: string | null; linkSetoran: string | null; moneyPhotos: string[]; }
interface CekBinData       extends TaskBase {}
interface ProductCheckData extends TaskBase { display: boolean; price: boolean; saleTag: boolean; shoeFiller: boolean; labelIndo: boolean; barcode: boolean; }
interface ReceivingData    extends TaskBase { hasReceiving: boolean; receivingPhotos: string[]; }
interface BriefingData     extends TaskBase { done: boolean; }
interface EdcSummaryData    extends TaskBase { edcSummaryPhotos: string[]; }
interface EdcSettlementData extends TaskBase { edcSettlementPhotos: string[]; }
interface EodZReportData    extends TaskBase { zReportPhotos: string[]; }
interface OpenStatementData extends TaskBase { openStatementPhotos: string[]; }
interface GroomingData     extends TaskBase {
  uniformActive: boolean; hairActive: boolean; nailsActive: boolean;
  accessoriesActive: boolean; shoeActive: boolean;
  uniformComplete: boolean | null; hairGroomed: boolean | null;
  nailsClean: boolean | null; accessoriesCompliant: boolean | null;
  shoeCompliant: boolean | null; selfiePhotos: string[];
}
type AnyTaskData =
  StoreOpeningData | SetoranData | CekBinData | ProductCheckData |
  ReceivingData | BriefingData | EdcSummaryData | EdcSettlementData |
  EodZReportData | OpenStatementData | GroomingData;

// ─── Config ───────────────────────────────────────────────────────────────────

const TASK_TITLES: Record<TaskType, string> = {
  store_opening: 'Store Opening', setoran: 'Setoran', cek_bin: 'Cek Bin',
  product_check: 'Product Check', receiving: 'Receiving', briefing: 'Briefing',
  edc_summary: 'Summary EDC', edc_settlement: 'Settlement EDC',
  eod_z_report: 'EOD Z-Report', open_statement: 'Open Statement', grooming: 'Grooming Check',
};

// ─── Form props shared by all task forms ─────────────────────────────────────

interface FormProps {
  onSubmit:   (payload: Record<string, unknown>) => void;
  submitting: boolean;
  readonly:   boolean;
  /** Disabled = task is locked (not checked in or outside geofence). */
  locked:     boolean;
  autoSave:   (patch: Record<string, unknown>, opts?: { immediate?: boolean }) => void;
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
      { timeout: 10_000, maximumAge: 0 },  // maximumAge 0 forces a fresh fix on refresh
    );
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { geo, geoError, geoReady, refresh };
}

// ─── Access-status hook ───────────────────────────────────────────────────────

/**
 * Fetches task access status from the server once geo is ready.
 * Re-fetches whenever geo changes.
 *
 * Returns:
 *   accessStatus  — null while loading
 *   refreshAccess — call after the employee checks in to re-validate
 */
function useAccessStatus(
  scheduleId: string,
  storeId:    string,
  geo:        { lat: number; lng: number } | null,
  geoReady:   boolean,
  taskStatus: TaskStatus | undefined,
) {
  const [accessStatus,  setAccessStatus]  = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    // Already completed/verified/rejected — no access check needed
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
      // Network error — don't block the employee, treat as geo_unavailable
      setAccessStatus({ status: 'geo_unavailable' });
    } finally {
      setAccessLoading(false);
    }
  }, [scheduleId, storeId, geo, taskStatus]);

  useEffect(() => {
    if (geoReady) fetch_();
  }, [geoReady, fetch_]);

  return { accessStatus, accessLoading, refreshAccess: fetch_ };
}

// ─── Access banners ───────────────────────────────────────────────────────────

function AccessBanner({
  accessStatus,
  accessLoading,
  geoReady,
  geo,
  geoError,
  onRefreshGeo,
  onRefreshAccess,
}: {
  accessStatus:    AccessStatus | null;
  accessLoading:   boolean;
  geoReady:        boolean;
  geo:             { lat: number; lng: number } | null;
  geoError:        string | null;
  onRefreshGeo:    () => void;
  onRefreshAccess: () => void;
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
          <p className="mt-0.5 text-xs text-red-600">
            Kamu harus melakukan absensi masuk terlebih dahulu sebelum dapat mengerjakan task.
          </p>
        </div>
        <button
          onClick={onRefreshAccess}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Cek ulang
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
            Pastikan kamu berada di dalam toko.
          </p>
        </div>
        <button
          onClick={() => { onRefreshGeo(); }}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Perbarui
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
          <p className="mt-0.5 text-xs text-amber-600">
            {geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan, namun lokasi tidak akan direkam.
          </p>
        </div>
        <button
          onClick={onRefreshGeo}
          className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          Coba lagi
        </button>
      </div>
    );
  }

  // status === 'ok'
  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">
        Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})
      </p>
    </div>
  );
}

// ─── Save status indicator ─────────────────────────────────────────────────

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

// ─── Shared UI ────────────────────────────────────────────────────────────────

function PhotoUploader({ label, photoType, photos, onChange, max = 3, disabled }: {
  label: string; photoType: string; photos: string[];
  onChange: (urls: string[]) => void; max?: number; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length >= max) { toast.error(`Maksimal ${max} foto`); return; }
    setUploading(true);
    try {
      const toUpload = Array.from(files).slice(0, max - photos.length);
      const urls: string[] = [];
      for (const file of toUpload) {
        const form = new FormData();
        form.append('file', file); form.append('photoType', photoType);
        const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload gagal');
        urls.push(data.url);
      }
      onChange([...photos, ...urls]);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload gagal'); }
    finally { setUploading(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {photos.map((url, i) => (
          <div key={i} className="relative h-20 w-20 overflow-hidden rounded-xl border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-full w-full object-cover" />
            {!disabled && (
              <button onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {!disabled && photos.length < max && (
          <button onClick={() => inputRef.current?.click()} disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground hover:border-primary/40 hover:text-primary disabled:opacity-50">
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Camera className="h-5 w-5" /><span className="text-[9px] font-semibold">Tambah</span></>}
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment"
        multiple={max > 1} className="hidden" onChange={e => handleFiles(e.target.files)} />
      <p className="text-[10px] text-muted-foreground">{photos.length}/{max} foto</p>
    </div>
  );
}

function CheckItem({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={() => !disabled && onChange(!checked)}
      className={cn('flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        checked ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:border-primary/20',
        disabled && 'cursor-default opacity-60')}>
      <div className={cn('flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        checked ? 'border-primary bg-primary' : 'border-border')}>
        {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>
      <span className={cn('text-sm font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function NotesField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Section title="Catatan (opsional)">
      <textarea value={value} onChange={e => onChange(e.target.value)} disabled={disabled} rows={3}
        placeholder="Tambahkan catatan jika ada…"
        className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
    </Section>
  );
}

function SubmitBtn({ label, disabled, submitting, onClick }: {
  label: string; disabled: boolean; submitting: boolean; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || submitting}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40">
      {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</> : <><CheckCircle2 className="h-4 w-4" />{label}</>}
    </button>
  );
}

/** Overlay shown over the form when the task is locked due to access restrictions. */
function LockedOverlay({ accessStatus }: { accessStatus: AccessStatus | null }) {
  if (!accessStatus || accessStatus.status === 'ok' || accessStatus.status === 'geo_unavailable') return null;

  const isCheckIn = accessStatus.status === 'not_checked_in';

  return (
    <div className="pointer-events-none absolute inset-0 rounded-2xl bg-background/70 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 z-10">
      <div className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full',
        isCheckIn ? 'bg-red-100' : 'bg-orange-100',
      )}>
        {isCheckIn
          ? <LogIn       className="h-6 w-6 text-red-600"    />
          : <NavigationOff className="h-6 w-6 text-orange-600" />}
      </div>
      <p className={cn('text-sm font-bold', isCheckIn ? 'text-red-700' : 'text-orange-700')}>
        {isCheckIn ? 'Absen masuk dulu' : 'Kamu di luar area toko'}
      </p>
    </div>
  );
}

// ─── Task forms ───────────────────────────────────────────────────────────────

function StoreOpeningForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: StoreOpeningData }) {
  const dis = readonly || locked;
  const [loginPos,          setLoginPos]          = useState(data.loginPos);
  const [checkAbsenSunfish, setCheckAbsenSunfish] = useState(data.checkAbsenSunfish);
  const [tarikSohSales,     setTarikSohSales]     = useState(data.tarikSohSales);
  const [fiveR,             setFiveR]             = useState(data.fiveR);
  const [cekLamp,           setCekLamp]           = useState(data.cekLamp);
  const [cekSoundSystem,    setCekSoundSystem]    = useState(data.cekSoundSystem);
  const [storeFrontPhotos,  setStoreFrontPhotos]  = useState<string[]>(data.storeFrontPhotos);
  const [cashDrawerPhotos,  setCashDrawerPhotos]  = useState<string[]>(data.cashDrawerPhotos);
  const [notes,             setNotes]             = useState(data.notes ?? '');

  const chk = (field: string, setter: (v: boolean) => void, v: boolean) => { setter(v); autoSave({ [field]: v }); };
  const allChecked = loginPos && checkAbsenSunfish && tarikSohSales && fiveR && cekLamp && cekSoundSystem;
  const canSubmit  = !locked && allChecked && storeFrontPhotos.length > 0;

  return (
    <div className="space-y-6">
      <Section title="Checklist Pembukaan">
        <div className="space-y-2">
          <CheckItem label="Log-in POS / Buka komputer kasir"  checked={loginPos}          onChange={v => chk('loginPos', setLoginPos, v)}                   disabled={dis} />
          <CheckItem label="Tarik & cek absen di Sunfish"       checked={checkAbsenSunfish} onChange={v => chk('checkAbsenSunfish', setCheckAbsenSunfish, v)} disabled={dis} />
          <CheckItem label="Tarik SOH & Sales"                  checked={tarikSohSales}     onChange={v => chk('tarikSohSales', setTarikSohSales, v)}         disabled={dis} />
          <CheckItem label="5R — Kebersihan toko"              checked={fiveR}             onChange={v => chk('fiveR', setFiveR, v)}                         disabled={dis} />
          <CheckItem label="Cek semua lampu menyala"            checked={cekLamp}           onChange={v => chk('cekLamp', setCekLamp, v)}                     disabled={dis} />
          <CheckItem label="Cek sound system"                   checked={cekSoundSystem}    onChange={v => chk('cekSoundSystem', setCekSoundSystem, v)}       disabled={dis} />
        </div>
      </Section>
      <Section title="Foto Tampak Depan Toko (wajib)">
        <PhotoUploader label="Store Front (max 3)" photoType="store_front" photos={storeFrontPhotos}
          onChange={urls => { setStoreFrontPhotos(urls); autoSave({ storeFrontPhotos: urls }, { immediate: true }); }}
          max={3} disabled={dis} />
      </Section>
      <Section title="Foto Laci Kasir">
        <PhotoUploader label="Cash Drawer (max 2)" photoType="cash_drawer" photos={cashDrawerPhotos}
          onChange={urls => { setCashDrawerPhotos(urls); autoSave({ cashDrawerPhotos: urls }, { immediate: true }); }}
          max={2} disabled={dis} />
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <>
        <SubmitBtn label="Submit Store Opening" disabled={!canSubmit} submitting={submitting}
          onClick={() => onSubmit({ loginPos, checkAbsenSunfish, tarikSohSales, fiveR, cekLamp, cekSoundSystem, storeFrontPhotos, cashDrawerPhotos, notes: notes || undefined })} />
        {!canSubmit && !locked && <p className="text-center text-[11px] text-muted-foreground">{!allChecked ? 'Lengkapi semua checklist terlebih dahulu.' : 'Upload minimal 1 foto tampak depan toko.'}</p>}
      </>}
    </div>
  );
}

function SetoranForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: SetoranData }) {
  const dis = readonly || locked;
  const [amount,      setAmount]      = useState(data.amount ?? '');
  const [linkSetoran, setLinkSetoran] = useState(data.linkSetoran ?? '');
  const [moneyPhotos, setMoneyPhotos] = useState<string[]>(data.moneyPhotos);
  const [notes,       setNotes]       = useState(data.notes ?? '');
  const canSubmit = !locked && !!amount && !!linkSetoran && moneyPhotos.length > 0;

  return (
    <div className="space-y-6">
      <Section title="Nominal Setoran (Rp)">
        <input type="number" value={amount} disabled={dis} placeholder="Contoh: 1500000"
          onChange={e => { setAmount(e.target.value); autoSave({ amount: e.target.value }); }}
          className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
      </Section>
      <Section title="Link / No. Referensi Transfer">
        <input type="text" value={linkSetoran} disabled={dis} placeholder="Paste link atau nomor referensi"
          onChange={e => { setLinkSetoran(e.target.value); autoSave({ linkSetoran: e.target.value }); }}
          className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60" />
      </Section>
      <Section title="Foto Uang (min 1, wajib)">
        <PhotoUploader label="Foto uang setoran" photoType="money" photos={moneyPhotos}
          onChange={urls => { setMoneyPhotos(urls); autoSave({ moneyPhotos: urls }, { immediate: true }); }}
          max={3} disabled={dis} />
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label="Submit Setoran" disabled={!canSubmit} submitting={submitting}
        onClick={() => onSubmit({ amount, linkSetoran, moneyPhotos, notes: notes || undefined })} />}
    </div>
  );
}

function ProductCheckForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: ProductCheckData }) {
  const dis = readonly || locked;
  const [display,    setDisplay]    = useState(data.display);
  const [price,      setPrice]      = useState(data.price);
  const [saleTag,    setSaleTag]    = useState(data.saleTag);
  const [shoeFiller, setShoeFiller] = useState(data.shoeFiller);
  const [labelIndo,  setLabelIndo]  = useState(data.labelIndo);
  const [barcode,    setBarcode]    = useState(data.barcode);
  const [notes,      setNotes]      = useState(data.notes ?? '');
  const chk = (field: string, setter: (v: boolean) => void, v: boolean) => { setter(v); autoSave({ [field]: v }); };
  const allChecked = display && price && saleTag && shoeFiller && labelIndo && barcode;

  return (
    <div className="space-y-6">
      <Section title="Checklist Produk">
        <div className="space-y-2">
          <CheckItem label="Display produk sesuai standar" checked={display}    onChange={v => chk('display',    setDisplay,    v)} disabled={dis} />
          <CheckItem label="Harga / price tag terpasang"   checked={price}      onChange={v => chk('price',      setPrice,      v)} disabled={dis} />
          <CheckItem label="Sale tag terpasang"             checked={saleTag}    onChange={v => chk('saleTag',    setSaleTag,    v)} disabled={dis} />
          <CheckItem label="Shoe filler terpasang"          checked={shoeFiller} onChange={v => chk('shoeFiller', setShoeFiller, v)} disabled={dis} />
          <CheckItem label="Label Indo tersedia"            checked={labelIndo}  onChange={v => chk('labelIndo',  setLabelIndo,  v)} disabled={dis} />
          <CheckItem label="Barcode dapat terbaca"          checked={barcode}    onChange={v => chk('barcode',    setBarcode,    v)} disabled={dis} />
        </div>
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label="Submit Product Check" disabled={locked || !allChecked} submitting={submitting}
        onClick={() => onSubmit({ display, price, saleTag, shoeFiller, labelIndo, barcode, notes: notes || undefined })} />}
    </div>
  );
}

function ReceivingForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: ReceivingData }) {
  const dis = readonly || locked;
  const [hasReceiving,    setHasReceiving]    = useState(data.hasReceiving);
  const [receivingPhotos, setReceivingPhotos] = useState<string[]>(data.receivingPhotos);
  const [notes,           setNotes]           = useState(data.notes ?? '');
  const canSubmit = !locked && (!hasReceiving || receivingPhotos.length > 0);

  return (
    <div className="space-y-6">
      <Section title="Ada Penerimaan Barang Hari Ini?">
        <div className="grid grid-cols-2 gap-2">
          {([true, false] as const).map(val => (
            <button key={String(val)} type="button"
              onClick={() => { if (!dis) { setHasReceiving(val); autoSave({ hasReceiving: val }); } }}
              className={cn('rounded-2xl border-2 py-4 text-sm font-bold transition-all',
                hasReceiving === val ? (val ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-400 bg-slate-50 text-slate-600') : 'border-border bg-card text-muted-foreground',
                dis && 'cursor-default opacity-60')}>
              {val ? 'Ya, Ada' : 'Tidak Ada'}
            </button>
          ))}
        </div>
      </Section>
      {hasReceiving && (
        <Section title="Foto Barang Diterima (min 1)">
          <PhotoUploader label="Foto receiving" photoType="receiving" photos={receivingPhotos}
            onChange={urls => { setReceivingPhotos(urls); autoSave({ receivingPhotos: urls }, { immediate: true }); }}
            max={5} disabled={dis} />
        </Section>
      )}
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label="Submit Receiving" disabled={!canSubmit} submitting={submitting}
        onClick={() => onSubmit({ hasReceiving, receivingPhotos, notes: notes || undefined })} />}
    </div>
  );
}

function BriefingForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: BriefingData }) {
  const dis = readonly || locked;
  const [done,  setDone]  = useState(data.done);
  const [notes, setNotes] = useState(data.notes ?? '');
  return (
    <div className="space-y-6">
      <Section title="Status Briefing">
        <CheckItem label="Briefing shift malam telah dilakukan" checked={done}
          onChange={v => { setDone(v); autoSave({ done: v }); }} disabled={dis} />
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label="Submit Briefing" disabled={locked || !done} submitting={submitting}
        onClick={() => onSubmit({ done, notes: notes || undefined })} />}
    </div>
  );
}

function CekBinForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: CekBinData }) {
  const dis = readonly || locked;
  const [notes, setNotes] = useState(data.notes ?? '');
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-800">Cek Bin</p>
        <p className="mt-1 text-xs text-amber-600">Lakukan pemeriksaan bin dan konfirmasi selesai di bawah.</p>
      </div>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label="Selesai Cek Bin" disabled={locked} submitting={submitting}
        onClick={() => onSubmit({ notes: notes || undefined })} />}
    </div>
  );
}

function PhotoOnlyForm({ data, photoField, photoKey, photoType, sectionTitle, submitLabel,
  onSubmit, submitting, readonly, locked, autoSave, max = 3 }: FormProps & {
  data: AnyTaskData; photoField: string; photoKey: string; photoType: string;
  sectionTitle: string; submitLabel: string; max?: number;
}) {
  const dis = readonly || locked;
  const raw = (data as unknown as Record<string, unknown>)[photoField];
  const [photos, setPhotos] = useState<string[]>(Array.isArray(raw) ? raw as string[] : []);
  const [notes,  setNotes]  = useState((data as TaskBase).notes ?? '');
  return (
    <div className="space-y-6">
      <Section title={sectionTitle}>
        <PhotoUploader label={`Foto (min 1, max ${max})`} photoType={photoType} photos={photos}
          onChange={urls => { setPhotos(urls); autoSave({ [photoKey]: urls }, { immediate: true }); }}
          max={max} disabled={dis} />
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <SubmitBtn label={submitLabel} disabled={locked || photos.length === 0} submitting={submitting}
        onClick={() => onSubmit({ photos, notes: notes || undefined })} />}
    </div>
  );
}

function GroomingForm({ data, onSubmit, submitting, readonly, locked, autoSave }: FormProps & { data: GroomingData }) {
  const dis = readonly || locked;
  const [uniformComplete,      setUniformComplete]      = useState<boolean>(data.uniformComplete      ?? false);
  const [hairGroomed,          setHairGroomed]          = useState<boolean>(data.hairGroomed          ?? false);
  const [nailsClean,           setNailsClean]           = useState<boolean>(data.nailsClean           ?? false);
  const [accessoriesCompliant, setAccessoriesCompliant] = useState<boolean>(data.accessoriesCompliant ?? false);
  const [shoeCompliant,        setShoeCompliant]        = useState<boolean>(data.shoeCompliant        ?? false);
  const [selfiePhotos,         setSelfiePhotos]         = useState<string[]>(data.selfiePhotos);
  const [notes,                setNotes]                = useState(data.notes ?? '');

  const chk = (field: string, setter: (v: boolean) => void, v: boolean) => { setter(v); autoSave({ [field]: v }); };

  const activeItems = [
    data.uniformActive     && { key: 'uniform',    label: 'Seragam lengkap',          value: uniformComplete,      set: (v: boolean) => chk('uniformComplete',      setUniformComplete,      v) },
    data.hairActive        && { key: 'hair',        label: 'Rambut rapi',              value: hairGroomed,          set: (v: boolean) => chk('hairGroomed',          setHairGroomed,          v) },
    data.nailsActive       && { key: 'nails',       label: 'Kuku bersih',              value: nailsClean,           set: (v: boolean) => chk('nailsClean',           setNailsClean,           v) },
    data.accessoriesActive && { key: 'accessories', label: 'Aksesoris sesuai standar', value: accessoriesCompliant, set: (v: boolean) => chk('accessoriesCompliant', setAccessoriesCompliant, v) },
    data.shoeActive        && { key: 'shoe',        label: 'Sepatu sesuai standar',    value: shoeCompliant,        set: (v: boolean) => chk('shoeCompliant',        setShoeCompliant,        v) },
  ].filter(Boolean) as { key: string; label: string; value: boolean; set: (v: boolean) => void }[];

  const allChecked = activeItems.every(i => i.value);
  const canSubmit  = !locked && allChecked && selfiePhotos.length > 0;

  return (
    <div className="space-y-6">
      {activeItems.length > 0 && (
        <Section title="Checklist Penampilan">
          <div className="space-y-2">
            {activeItems.map(item => <CheckItem key={item.key} label={item.label} checked={item.value} onChange={item.set} disabled={dis} />)}
          </div>
        </Section>
      )}
      <Section title="Foto Selfie Full Body (wajib)">
        <PhotoUploader label="Selfie (min 1, max 2)" photoType="selfie" photos={selfiePhotos}
          onChange={urls => { setSelfiePhotos(urls); autoSave({ selfiePhotos: urls }, { immediate: true }); }}
          max={2} disabled={dis} />
      </Section>
      <NotesField value={notes} onChange={v => { setNotes(v); autoSave({ notes: v }); }} disabled={dis} />
      {!readonly && <>
        <SubmitBtn label="Submit Grooming" disabled={!canSubmit} submitting={submitting}
          onClick={() => onSubmit({ uniformComplete, hairGroomed, nailsClean, accessoriesCompliant, shoeCompliant, selfiePhotos, notes: notes || undefined })} />
        {!canSubmit && !locked && <p className="text-center text-[11px] text-muted-foreground">{!allChecked ? 'Lengkapi semua checklist.' : 'Upload minimal 1 foto selfie.'}</p>}
      </>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TaskDetailPage() {
  const params   = useParams();
  const router   = useRouter();

  const taskType = params.type as TaskType;
  const taskId   = params.id   as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,    setTaskData]    = useState<AnyTaskData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { tasks: { type: string; data: AnyTaskData }[] };
      const found = data.tasks?.find(t => t.type === taskType && t.data.id === taskId);
      setTaskData(found?.data ?? null);
    } catch (e) {
      console.error('[TaskDetailPage] load error:', e);
      toast.error('Gagal memuat data task. Coba refresh halaman.');
    } finally {
      setLoading(false);
    }
  }, [taskType, taskId]);

  useEffect(() => { load(); }, [load]);

  // Access status check — re-evaluates when geo changes
  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '',
    taskData?.storeId    ?? '',
    geo,
    geoReady,
    taskData?.status,
  );

  const scheduleId = taskData ? parseInt(taskData.scheduleId, 10) : 0;
  const storeId    = taskData ? parseInt(taskData.storeId,    10) : 0;

  const { status: saveStatus, lastSaved, error: saveError, save: autoSave } = useAutoSave({
    url:        `/api/employee/tasks/${taskType}`,
    baseBody:   { scheduleId, storeId },
    debounceMs: 800,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';

  /**
   * A task is "locked" when:
   *   - the employee hasn't checked in, OR
   *   - they are outside the geofence.
   *
   * geo_unavailable is NOT a lock — we degrade gracefully (skipGeo path).
   */
  const locked =
    !readonly &&
    !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');

  async function handleSubmit(payload: Record<string, unknown>) {
    if (!taskData) return;
    setSubmitError(null);

    if (!storeId || !scheduleId) {
      const msg = 'Data task tidak valid. Coba muat ulang halaman.';
      setSubmitError(msg); toast.error(msg); return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/employee/tasks/${taskType}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          scheduleId,
          storeId,
          geo:     geo ?? null,
          skipGeo: geo === null,
          ...payload,
        }),
      });

      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();

      if (!res.ok || json.success === false) {
        const serverMsg =
          (typeof json.error   === 'string' && json.error)   ||
          (typeof json.message === 'string' && json.message) || null;
        const hint = (() => {
          if (res.status === 401) return 'Sesi habis, silakan login ulang.';
          if (res.status === 403) return 'Tidak punya akses untuk task ini.';
          if (res.status === 404) return 'Task tidak ditemukan. Coba refresh halaman.';
          if (serverMsg?.toLowerCase().includes('absen'))
            return serverMsg; // surface check-in message directly
          if (serverMsg?.toLowerCase().includes('meter') || serverMsg?.toLowerCase().includes('geofence') || serverMsg?.toLowerCase().includes('area'))
            return 'Kamu terlalu jauh dari toko. Pastikan berada di dalam toko dan coba lagi.';
          return null;
        })();
        const displayMsg = hint ?? serverMsg ?? `HTTP ${res.status} ${res.statusText}`;
        setSubmitError(displayMsg);
        toast.error(displayMsg, { duration: 6000 });
        return;
      }

      toast.success('Task berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? `Koneksi gagal: ${e.message}` : 'Gagal terhubung ke server.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSubmitting(false);
    }
  }

  // When geo refreshes, also re-check access
  const handleRefreshGeo = useCallback(() => {
    refreshGeo();
    // refreshAccess will fire automatically via the useEffect in useAccessStatus
    // once geoReady flips back to true with the new coords
  }, [refreshGeo]);

  const title     = TASK_TITLES[taskType] ?? taskType;
  const formProps: FormProps = { onSubmit: handleSubmit, submitting, readonly, locked, autoSave };

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{title}</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {taskData.status.replace('_', ' ')}</p>}
        </div>

        {/* Auto-save indicator */}
        {!readonly && !loading && taskData && (
          <SaveIndicator status={saveStatus} lastSaved={lastSaved} />
        )}

        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100  px-2.5 py-1 text-[10px] font-bold text-green-700" ><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200  px-2.5 py-1 text-[10px] font-bold text-green-800" ><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100    px-2.5 py-1 text-[10px] font-bold text-red-700"  ><AlertCircle  className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 p-4 pb-10">

        {/* Access / geo banners — always shown when task is not yet readonly */}
        {!readonly && !loading && taskData && (
          <AccessBanner
            accessStatus={accessStatus}
            accessLoading={accessLoading}
            geoReady={geoReady}
            geo={geo}
            geoError={geoError}
            onRefreshGeo={handleRefreshGeo}
            onRefreshAccess={refreshAccess}
          />
        )}

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-red-700">Submit gagal</p><p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p></div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
          </div>
        )}

        {/* Auto-save error */}
        {saveError && !readonly && (
          <div className="flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2.5">
            <CloudOff className="h-4 w-4 flex-shrink-0 text-orange-600" />
            <p className="text-xs text-orange-700">Auto-save gagal: {saveError}</p>
          </div>
        )}

        {/* Rejection note */}
        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div><p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p><p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p><p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p></div>
          </div>
        )}

        {/* Verified banner */}
        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{new Date(taskData.verifiedAt).toLocaleString('id-ID',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'})}</p>
          </div>
        )}

        {/* Collaborative hint — only for non-locked shared tasks */}
        {!readonly && !locked && !loading && taskData && taskType !== 'grooming' && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.</p>
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-14 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
            <p className="mt-1 text-xs text-muted-foreground">Task mungkin sudah tidak tersedia.</p>
          </div>
        ) : (
          /* Wrapper with relative positioning for the LockedOverlay */
          <div className="relative">
            <LockedOverlay accessStatus={accessStatus} />
            {taskType === 'store_opening'  && <StoreOpeningForm  data={taskData as StoreOpeningData}  {...formProps} />}
            {taskType === 'setoran'        && <SetoranForm        data={taskData as SetoranData}        {...formProps} />}
            {taskType === 'cek_bin'        && <CekBinForm         data={taskData as CekBinData}         {...formProps} />}
            {taskType === 'product_check'  && <ProductCheckForm   data={taskData as ProductCheckData}   {...formProps} />}
            {taskType === 'receiving'      && <ReceivingForm       data={taskData as ReceivingData}      {...formProps} />}
            {taskType === 'briefing'       && <BriefingForm        data={taskData as BriefingData}       {...formProps} />}
            {taskType === 'edc_summary'    && <PhotoOnlyForm data={taskData} photoField="edcSummaryPhotos"    photoKey="photos" photoType="edc_summary"    sectionTitle="Foto Summary EDC"        submitLabel="Submit EDC Summary"    {...formProps} />}
            {taskType === 'edc_settlement' && <PhotoOnlyForm data={taskData} photoField="edcSettlementPhotos" photoKey="photos" photoType="edc_settlement" sectionTitle="Foto Settlement EDC"     submitLabel="Submit EDC Settlement" {...formProps} />}
            {taskType === 'eod_z_report'   && <PhotoOnlyForm data={taskData} photoField="zReportPhotos"       photoKey="photos" photoType="z_report"       sectionTitle="Foto Z-Report"           submitLabel="Submit Z-Report"       {...formProps} />}
            {taskType === 'open_statement' && <PhotoOnlyForm data={taskData} photoField="openStatementPhotos" photoKey="photos" photoType="open_statement" sectionTitle="Foto Open Statement List" submitLabel="Submit Open Statement" {...formProps} />}
            {taskType === 'grooming'       && <GroomingForm        data={taskData as GroomingData}       {...formProps} />}
          </div>
        )}
      </div>
    </div>
  );
}