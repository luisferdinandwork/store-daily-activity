'use client';
// app/employee/tasks/cek-bin/[id]/page.tsx

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, AlertCircle, Box, Check, CheckCircle2, ChevronDown,
  Cloud, CloudOff, Loader2, LogIn, Navigation, NavigationOff,
  RefreshCw, Save, Search, X,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';
import { useAutoSave } from '@/lib/hooks/useAutoSave';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'rejected' | 'discrepancy';

type AccessStatus =
  | { status: 'ok' }
  | { status: 'not_checked_in' }
  | { status: 'outside_geofence'; distanceM: number; radiusM: number }
  | { status: 'geo_unavailable' };

interface BinItem {
  id: string; storeId: string; bin: string;
  qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number; nama: string;
}

interface CheckedBin {
  id: string; taskId: string; binId: string; bin: string;
  qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number;
  nama: string; notes: string | null;
}

interface SelectedBinDraft {
  binId: number; qtyBc: number; qtySesuaiBin: number; qtyTidakSesuaiBin: number; notes?: string;
}

interface CekBinData {
  id: string; scheduleId: string; userId?: string; storeId: string;
  shift: string; date: string; status: TaskStatus; notes: string | null;
  completedAt: string | null; verifiedBy?: string | null; verifiedAt: string | null;
  totalStoreBins: number; minimumBinsToCheck: number; checkedBinsCount: number;
  availableBins: BinItem[]; checkedBins: CheckedBin[]; selectedBinIds: string[];
}

// ─── Geo hook ─────────────────────────────────────────────────────────────────

function useGeo() {
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoReady, setGeoReady] = useState(false);
  const refresh = useCallback(() => {
    setGeoReady(false); setGeoError(null);
    if (!navigator.geolocation) { setGeoError('Geolocation tidak didukung.'); setGeoReady(true); return; }
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

function useAccessStatus(scheduleId: string, storeId: string, geo: { lat: number; lng: number } | null, geoReady: boolean, taskStatus?: TaskStatus) {
  const [accessStatus, setAccessStatus] = useState<AccessStatus | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const check = useCallback(async () => {
    if (taskStatus && ['completed', 'verified', 'rejected'].includes(taskStatus)) { setAccessStatus({ status: 'ok' }); setAccessLoading(false); return; }
    if (!scheduleId || !storeId) return;
    setAccessLoading(true);
    try {
      const p = new URLSearchParams({ scheduleId, storeId });
      if (geo) { p.set('lat', String(geo.lat)); p.set('lng', String(geo.lng)); }
      setAccessStatus(await fetch(`/api/employee/tasks/access?${p}`).then(r => r.json()) as AccessStatus);
    } catch { setAccessStatus({ status: 'geo_unavailable' }); }
    finally { setAccessLoading(false); }
  }, [scheduleId, storeId, geo, taskStatus]);
  useEffect(() => { if (geoReady) check(); }, [geoReady, check]);
  return { accessStatus, accessLoading, refreshAccess: check };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNonNegativeInt(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function fmtLong(iso: string | null) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Save indicator ───────────────────────────────────────────────────────────

function SaveIndicator({ status, lastSaved }: { status: 'idle'|'saving'|'saved'|'error'; lastSaved: Date|null }) {
  if (status === 'idle') return null;
  return (
    <div className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50 text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50 text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud   className="h-3 w-3" />Tersimpan{lastSaved ? ` ${new Date(lastSaved).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'})}` : ''}</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

// ─── Access banner — Store Opening colors ─────────────────────────────────────

function AccessBanner({ accessStatus, accessLoading, geoReady, geo, geoError, onRefreshGeo, onRefreshAccess }: {
  accessStatus: AccessStatus|null; accessLoading: boolean; geoReady: boolean;
  geo: {lat:number;lng:number}|null; geoError: string|null;
  onRefreshGeo: ()=>void; onRefreshAccess: ()=>void;
}) {
  if (!geoReady || accessLoading) return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary px-4 py-2.5">
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{!geoReady ? 'Mendapatkan lokasi…' : 'Memeriksa akses…'}</p>
    </div>
  );
  if (!accessStatus) return null;
  if (accessStatus.status === 'not_checked_in') return (
    <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
      <LogIn className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
      <div className="flex-1 min-w-0"><p className="text-sm font-bold text-red-700">Belum absen masuk</p><p className="mt-0.5 text-xs text-red-600">Kamu harus melakukan absensi masuk terlebih dahulu.</p></div>
      <button onClick={onRefreshAccess} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-red-100 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-200 transition-colors"><RefreshCw className="h-3 w-3" />Cek ulang</button>
    </div>
  );
  if (accessStatus.status === 'outside_geofence') return (
    <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3.5">
      <NavigationOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-600" />
      <div className="flex-1 min-w-0"><p className="text-sm font-bold text-orange-700">Di luar area toko</p><p className="mt-0.5 text-xs text-orange-600">Kamu berada {accessStatus.distanceM}m dari toko (batas: {accessStatus.radiusM}m).</p></div>
      <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-orange-100 px-2.5 py-1.5 text-[11px] font-semibold text-orange-700 hover:bg-orange-200 transition-colors"><RefreshCw className="h-3 w-3" />Perbarui</button>
    </div>
  );
  if (accessStatus.status === 'geo_unavailable') return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <NavigationOff className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
      <div className="flex-1 min-w-0"><p className="text-xs font-semibold text-amber-800">Lokasi tidak terdeteksi</p><p className="mt-0.5 text-xs text-amber-600">{geoError ?? 'Izin lokasi belum diberikan.'} Task dapat dilanjutkan tanpa rekaman lokasi.</p></div>
      <button onClick={onRefreshGeo} className="flex-shrink-0 flex items-center gap-1 rounded-lg bg-amber-100 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-200 transition-colors"><RefreshCw className="h-3 w-3" />Coba lagi</button>
    </div>
  );
  return (
    <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
      <Navigation className="h-4 w-4 flex-shrink-0 text-green-600" />
      <p className="text-xs font-medium text-green-700">Lokasi terdeteksi ({geo?.lat.toFixed(5)}, {geo?.lng.toFixed(5)})</p>
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

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// ─── Quantity input ───────────────────────────────────────────────────────────

function QuantityInput({ label, value, onChange, disabled }: {
  label: string; value: number; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
      <input type="number" min="0" inputMode="numeric" value={value} disabled={disabled}
        onChange={e => onChange(toNonNegativeInt(e.target.value))}
        className="h-11 w-full rounded-xl border border-border bg-secondary px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
      />
    </label>
  );
}

// ─── Bin card ─────────────────────────────────────────────────────────────────
// THE FIX: outer row is <div role="button"> — chevron <button> inside is now valid HTML.

function BinCard({ bin, selected, isOpen, disabled, onToggle, onToggleOpen, onUpdate }: {
  bin: BinItem; selected: SelectedBinDraft | undefined;
  isOpen: boolean; disabled: boolean;
  onToggle: () => void; onToggleOpen: () => void;
  onUpdate: (patch: Partial<SelectedBinDraft>) => void;
}) {
  const isSelected = Boolean(selected);

  return (
    <article className={cn(
      'overflow-hidden rounded-xl border-2 bg-card transition-colors',
      isSelected ? 'border-primary/30 bg-primary/5' : 'border-border',
    )}>

      {/* ── Header row — <div role="button"> prevents nested-button hydration error ── */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onToggle()}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !disabled && onToggle()}
        className={cn(
          'flex w-full cursor-pointer select-none items-center gap-3 px-4 py-4 text-left',
          disabled && 'cursor-default opacity-60',
        )}
      >
        {/* Circular checkbox */}
        <div className={cn(
          'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          isSelected ? 'border-primary bg-primary' : 'border-border',
        )}>
          {isSelected && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-sm font-bold text-foreground">{bin.bin}</p>
            {isSelected && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Dicek</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{bin.nama}</p>
        </div>

        {/* Chevron — <button> is safe here because parent is a <div>, not a <button> */}
        {isSelected && !disabled && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onToggleOpen(); }}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-secondary hover:bg-border transition-colors"
            aria-label="Toggle detail"
          >
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
          </button>
        )}
      </div>

      {/* ── Default qty (from master data) ── */}
      <div className="grid grid-cols-3 border-t border-border text-center">
        {[
          { label: 'QTY BC',       val: bin.qtyBc             },
          { label: 'SESUAI',       val: bin.qtySesuaiBin      },
          { label: 'TIDAK SESUAI', val: bin.qtyTidakSesuaiBin },
        ].map(({ label, val }) => (
          <div key={label} className={cn('py-2.5', isSelected ? 'bg-primary/5' : 'bg-secondary/40')}>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-0.5 text-xs font-bold text-foreground">{val}</p>
          </div>
        ))}
      </div>

      {/* ── Editable qty inputs (when selected + open) ── */}
      {isSelected && isOpen && selected && (
        <div className="space-y-3 border-t border-border px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <QuantityInput label="QTY BC"               value={selected.qtyBc}             disabled={disabled} onChange={v => onUpdate({ qtyBc: v })} />
            <QuantityInput label="QTY SESUAI BIN"       value={selected.qtySesuaiBin}      disabled={disabled} onChange={v => onUpdate({ qtySesuaiBin: v })} />
            <QuantityInput label="QTY TIDAK SESUAI BIN" value={selected.qtyTidakSesuaiBin} disabled={disabled} onChange={v => onUpdate({ qtyTidakSesuaiBin: v })} />
          </div>
          <label className="block space-y-1">
            <span className="text-[10px] font-semibold text-muted-foreground">Catatan BIN ini</span>
            <textarea value={selected.notes ?? ''} disabled={disabled} rows={2}
              onChange={e => onUpdate({ notes: e.target.value })}
              placeholder="Opsional…"
              className="w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            />
          </label>
        </div>
      )}
    </article>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CekBinDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const { geo, geoError, geoReady, refresh: refreshGeo } = useGeo();

  const [taskData,     setTaskData]     = useState<CekBinData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState<string | null>(null);
  const [selectedBins, setSelectedBins] = useState<SelectedBinDraft[]>([]);
  const [notes,        setNotes]        = useState('');
  const [search,       setSearch]       = useState('');
  const [expandedId,   setExpandedId]   = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks');
      const data = await res.json() as { tasks: { type: string; data: CekBinData }[] };
      const found = data.tasks?.find(t => t.type === 'cek_bin' && t.data.id === taskId);
      if (!found) { setTaskData(null); return; }
      const d = found.data;
      setTaskData(d);
      setNotes(d.notes ?? '');
      const restored = d.checkedBins.map(b => ({
        binId: Number(b.binId), qtyBc: b.qtyBc ?? 0,
        qtySesuaiBin: b.qtySesuaiBin ?? 0, qtyTidakSesuaiBin: b.qtyTidakSesuaiBin ?? 0,
        notes: b.notes ?? undefined,
      }));
      setSelectedBins(restored);
      setExpandedId(restored[0]?.binId ?? null);
    } catch (e) {
      console.error('[CekBinDetailPage] load error:', e);
      toast.error('Gagal memuat data task.');
    } finally { setLoading(false); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);

  const { accessStatus, accessLoading, refreshAccess } = useAccessStatus(
    taskData?.scheduleId ?? '', taskData?.storeId ?? '', geo, geoReady, taskData?.status,
  );

  const taskIdNum = taskData ? Number(taskData.id) : 0;
  const { status: saveStatus, lastSaved, save: autoSave } = useAutoSave({
    url: '/api/employee/tasks/cek-bin', baseBody: { taskId: taskIdNum }, debounceMs: 700,
  });

  const taskStatus = taskData?.status;
  const readonly   = taskStatus === 'completed' || taskStatus === 'verified';
  const isRejected = taskStatus === 'rejected';
  const locked     = !readonly && !!accessStatus &&
    (accessStatus.status === 'not_checked_in' || accessStatus.status === 'outside_geofence');
  const dis = readonly || locked;

  const selectedById       = useMemo(() => new Map(selectedBins.map(b => [b.binId, b])), [selectedBins]);
  const totalStoreBins     = taskData?.totalStoreBins     || taskData?.availableBins.length || 0;
  const minimumBinsToCheck = taskData?.minimumBinsToCheck || Math.ceil(totalStoreBins * 0.3);
  const selectedCount      = selectedBins.length;
  const meetsMin           = selectedCount >= minimumBinsToCheck;

  const filteredBins = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bins = taskData?.availableBins ?? [];
    return q ? bins.filter(b => b.bin.toLowerCase().includes(q) || b.nama.toLowerCase().includes(q)) : bins;
  }, [taskData?.availableBins, search]);

  const canSubmit = !locked && !!taskData && totalStoreBins > 0 && meetsMin &&
    selectedBins.every(b =>
      Number.isInteger(b.qtyBc) && b.qtyBc >= 0 &&
      Number.isInteger(b.qtySesuaiBin) && b.qtySesuaiBin >= 0 &&
      Number.isInteger(b.qtyTidakSesuaiBin) && b.qtyTidakSesuaiBin >= 0,
    );

  function persistSelected(next: SelectedBinDraft[]) {
    setSelectedBins(next);
    autoSave({ selectedBins: next });
  }

  function toggleBin(bin: BinItem) {
    if (dis) return;
    const id = Number(bin.id);
    if (selectedById.has(id)) {
      const next = selectedBins.filter(b => b.binId !== id);
      persistSelected(next);
      if (expandedId === id) setExpandedId(next[0]?.binId ?? null);
    } else {
      const next = [...selectedBins, { binId: id, qtyBc: bin.qtyBc ?? 0, qtySesuaiBin: bin.qtySesuaiBin ?? 0, qtyTidakSesuaiBin: bin.qtyTidakSesuaiBin ?? 0 }];
      persistSelected(next);
      setExpandedId(id);
    }
  }

  function updateSelectedBin(binId: number, patch: Partial<SelectedBinDraft>) {
    persistSelected(selectedBins.map(b => b.binId === binId ? { ...b, ...patch } : b));
  }

  async function handleSubmit() {
    if (!taskData) return;
    setSubmitError(null); setSubmitting(true);
    try {
      const res = await fetch('/api/employee/tasks/cek-bin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId: Number(taskData.scheduleId), storeId: Number(taskData.storeId),
          geo: geo ?? null, skipGeo: geo === null, selectedBins, notes: notes || undefined,
        }),
      });
      let json: Record<string, unknown> = {};
      if (res.headers.get('content-type')?.includes('application/json')) json = await res.json();
      if (!res.ok || json.success === false) {
        const msg = (typeof json.error === 'string' && json.error) || `HTTP ${res.status}`;
        setSubmitError(msg); toast.error(msg, { duration: 6000 }); return;
      }
      toast.success('Cek BIN berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal terhubung ke server.';
      setSubmitError(msg); toast.error(msg, { duration: 6000 });
    } finally { setSubmitting(false); }
  }

  const submitHint = !taskData || locked ? '' :
    totalStoreBins === 0 ? 'Belum ada data BIN aktif untuk store ini.' :
    !meetsMin ? `Pilih minimal ${minimumBinsToCheck} BIN dari total ${totalStoreBins} BIN aktif.` : '';

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Cek BIN</p>
          {taskData && <p className="text-[10px] capitalize text-muted-foreground">{taskData.shift} shift · {taskData.status.replace('_', ' ')}</p>}
        </div>
        {!readonly && !loading && taskData && <SaveIndicator status={saveStatus} lastSaved={lastSaved} />}
        {taskStatus === 'completed' && <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {taskStatus === 'verified'  && <span className="flex items-center gap-1 rounded-full bg-green-200 px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {taskStatus === 'rejected'  && <span className="flex items-center gap-1 rounded-full bg-red-100   px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle   className="h-3 w-3" />Ditolak</span>}
      </div>

      {/* Body */}
      <main className="flex-1 space-y-5 px-4 py-4 pb-32">

        {!readonly && !loading && taskData && (
          <AccessBanner accessStatus={accessStatus} accessLoading={accessLoading} geoReady={geoReady}
            geo={geo} geoError={geoError} onRefreshGeo={refreshGeo} onRefreshAccess={refreshAccess} />
        )}

        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1"><p className="text-xs font-bold text-red-700">Submit gagal</p><p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p></div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400"><X className="h-4 w-4" /></button>
          </div>
        )}

        {isRejected && taskData?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div><p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p><p className="mt-0.5 text-xs text-red-600">{taskData.notes}</p><p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p></div>
          </div>
        )}

        {taskStatus === 'verified' && taskData?.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{fmtLong(taskData.verifiedAt)}</p>
          </div>
        )}

        {!readonly && !locked && !loading && taskData && (
          <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2.5">
            <Save className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <p className="text-xs text-blue-700">Perubahan otomatis tersimpan. Rekan shift lain dapat melanjutkan task ini.</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-secondary" />)}</div>
        ) : !taskData ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Box className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <div className="relative space-y-6">
            <LockedOverlay accessStatus={accessStatus} />

            {/* Progress */}
            <Section title="Progress Cek BIN">
              <div className={cn(
                'flex items-center justify-between rounded-xl border px-3.5 py-2.5',
                meetsMin ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50',
              )}>
                <p className={cn('text-xs font-semibold', meetsMin ? 'text-green-700' : 'text-amber-700')}>
                  {meetsMin ? `${selectedCount} BIN dipilih — syarat terpenuhi ✓` : `Pilih minimal ${minimumBinsToCheck} BIN (30% dari ${totalStoreBins})`}
                </p>
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold',
                  meetsMin ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
                )}>
                  {selectedCount}/{minimumBinsToCheck}+
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[{ label: 'Total BIN', val: totalStoreBins }, { label: 'Minimum', val: minimumBinsToCheck }, { label: 'Dipilih', val: selectedCount }].map(({ label, val }) => (
                  <div key={label} className="rounded-xl border border-border bg-secondary py-3">
                    <p className="text-[10px] font-semibold text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-lg font-bold text-foreground">{val}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* BIN list */}
            <Section title="Daftar BIN">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
                <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Cari BIN atau nama barang…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
                {search && <button onClick={() => setSearch('')} className="text-muted-foreground"><X className="h-3.5 w-3.5" /></button>}
              </div>

              {taskData.availableBins.length === 0 ? (
                <div className="flex flex-col items-center rounded-xl border border-border bg-secondary px-4 py-10 text-center">
                  <Box className="mb-2 h-7 w-7 text-muted-foreground/40" />
                  <p className="text-sm font-semibold text-foreground">Belum ada BIN aktif</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">Hubungi admin/OPS untuk mengisi data BIN master store ini.</p>
                  <button onClick={load} className="mt-4 flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-secondary transition-colors">
                    <RefreshCw className="h-3.5 w-3.5" />Muat ulang
                  </button>
                </div>
              ) : filteredBins.length === 0 ? (
                <div className="rounded-xl border border-border bg-secondary px-4 py-8 text-center text-sm text-muted-foreground">
                  Tidak ada BIN yang cocok dengan pencarian.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredBins.map(bin => {
                    const id = Number(bin.id);
                    return (
                      <BinCard key={bin.id} bin={bin}
                        selected={selectedById.get(id)}
                        isOpen={expandedId === id}
                        disabled={dis}
                        onToggle={() => toggleBin(bin)}
                        onToggleOpen={() => setExpandedId(p => p === id ? null : id)}
                        onUpdate={patch => updateSelectedBin(id, patch)}
                      />
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Read-only: checked bins summary */}
            {readonly && taskData.checkedBins.length > 0 && (
              <Section title="BIN yang Sudah Dicek">
                <div className="space-y-2">
                  {taskData.checkedBins.map(bin => (
                    <div key={bin.id} className="overflow-hidden rounded-xl border-2 border-primary/30 bg-primary/5">
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 border-primary bg-primary">
                          <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-sm font-bold text-foreground">{bin.bin}</p>
                          <p className="text-xs text-muted-foreground">{bin.nama}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 border-t border-primary/20 text-center">
                        {[{ label: 'QTY BC', val: bin.qtyBc }, { label: 'SESUAI', val: bin.qtySesuaiBin }, { label: 'TIDAK SESUAI', val: bin.qtyTidakSesuaiBin }].map(({ label, val }) => (
                          <div key={label} className="bg-primary/5 py-2.5">
                            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                            <p className="mt-0.5 text-xs font-bold text-foreground">{val}</p>
                          </div>
                        ))}
                      </div>
                      {bin.notes && <p className="border-t border-primary/20 px-4 py-2 text-[11px] text-muted-foreground">{bin.notes}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Global notes */}
            <Section title="Catatan Task (opsional)">
              <textarea value={notes} disabled={dis} rows={3}
                onChange={e => { setNotes(e.target.value); autoSave({ notes: e.target.value }); }}
                placeholder="Tambahkan catatan umum jika ada…"
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </Section>
          </div>
        )}
      </main>

      {/* Sticky submit */}
      {!readonly && !loading && taskData && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm supports-[padding:max(0px)]:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40">
            {submitting
              ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
              : <><CheckCircle2 className="h-4 w-4" />Submit Cek BIN</>}
          </button>
          {!canSubmit && submitHint && <p className="mt-2 text-center text-[11px] text-muted-foreground">{submitHint}</p>}
        </div>
      )}
    </div>
  );
}