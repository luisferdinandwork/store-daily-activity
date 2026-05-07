'use client';
// app/employee/tasks/setoran/[id]/page.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft, AlertTriangle, Camera, CheckCircle2, Loader2,
  Receipt, Wallet, CreditCard, X, Cloud, CloudOff,
  AlertCircle, Check,
} from 'lucide-react';
import { cn }    from '@/lib/utils';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'discrepancy' | 'verified' | 'rejected';

type SetoranTaskData = {
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

  // API field names
  amount:                  string | null;
  expectedAmount:          string | null;
  carriedDeficit:          string | null;
  carriedDeficitFetchedAt: string | null;
  unpaidAmount:            string | null;

  // Cleaner aliases (may also be present)
  actualReceivedAmount?: string | null;
  previousUnpaidAmount?: string | null;
  requiredStoreAmount?:  string | null;
  storedAmount?:         string | null;

  resiPhoto:          string | null;
  atmCardSelfiePhoto: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rupiah(value: string | number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return `Rp ${n.toLocaleString('id-ID')}`;
}

function onlyDigits(raw: string): string { return raw.replace(/[^0-9]/g, ''); }

function toNumber(raw: string | null | undefined): number {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtLong(iso: string | null) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ─── Save indicator ───────────────────────────────────────────────────────────

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  return (
    <div className={cn(
      'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold',
      status === 'saving' && 'bg-blue-50  text-blue-600',
      status === 'saved'  && 'bg-green-50 text-green-700',
      status === 'error'  && 'bg-red-50   text-red-600',
    )}>
      {status === 'saving' && <><Loader2 className="h-3 w-3 animate-spin" />Menyimpan…</>}
      {status === 'saved'  && <><Cloud   className="h-3 w-3" />Tersimpan</>}
      {status === 'error'  && <><CloudOff className="h-3 w-3" />Simpan gagal</>}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

// ─── Money row (read-only summary) ────────────────────────────────────────────

function MoneyRow({ label, value, bold, highlight }: {
  label: string; value: string; bold?: boolean; highlight?: 'amber' | 'green' | 'red';
}) {
  return (
    <div className={cn(
      'flex items-center justify-between rounded-xl px-4 py-3',
      highlight === 'amber' && 'border border-amber-200 bg-amber-50',
      highlight === 'green' && 'border border-green-200 bg-green-50',
      highlight === 'red'   && 'border border-red-200   bg-red-50',
      !highlight            && 'border border-border bg-secondary',
    )}>
      <span className={cn('text-xs', highlight ? 'font-medium' : 'text-muted-foreground')}>
        {label}
      </span>
      <span className={cn(
        bold ? 'text-base font-bold' : 'text-sm font-semibold',
        highlight === 'amber' && 'text-amber-900',
        highlight === 'green' && 'text-green-800',
        highlight === 'red'   && 'text-red-700',
        !highlight            && 'text-foreground',
      )}>
        {value}
      </span>
    </div>
  );
}

// ─── Rupiah input ─────────────────────────────────────────────────────────────

function RupiahInput({
  label, hint, value, onChange, onBlur, disabled, error,
}: {
  label: string; hint?: string; value: string;
  onChange: (raw: string) => void; onBlur?: () => void;
  disabled?: boolean; error?: string;
}) {
  const [focused, setFocused] = useState(false);
  const n = Number(value || '0');
  const displayVal = focused ? value : (value ? n.toLocaleString('id-ID') : '');

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-foreground">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      <div className={cn(
        'flex items-center rounded-xl border-2 bg-secondary px-4 py-3 gap-2 transition-colors',
        focused && !error && 'border-primary/40 bg-background',
        error   && 'border-red-400 bg-red-50',
        !focused && !error && 'border-border',
        disabled && 'opacity-60',
      )}>
        <span className="text-sm font-semibold text-muted-foreground flex-shrink-0">Rp</span>
        <input
          inputMode="numeric"
          disabled={disabled}
          value={displayVal}
          onChange={e => onChange(onlyDigits(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          placeholder="0"
          className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {error && <p className="text-[10px] font-semibold text-red-600">{error}</p>}
    </div>
  );
}

// ─── Photo slot (single required) ────────────────────────────────────────────

function PhotoSlot({
  label, description, photoType, photo, onUpload, onClear, disabled, loading, icon,
}: {
  label:       string;
  description: string;
  photoType:   string;
  photo:       string | null;
  onUpload:    (file: File) => void;
  onClear:     () => void;
  disabled?:   boolean;
  loading?:    boolean;
  icon?:       'camera' | 'card';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const Icon = icon === 'card' ? CreditCard : Camera;
  const hasPhoto = Boolean(photo);

  return (
    <button
      type="button"
      onClick={() => !disabled && !loading && inputRef.current?.click()}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border-2 px-4 py-3.5 text-left transition-all',
        hasPhoto  ? 'border-primary/30 bg-primary/5' : 'border-border bg-card hover:border-primary/20',
        disabled  && 'cursor-default opacity-60',
      )}
    >
      {/* Circle indicator */}
      <div className={cn(
        'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        hasPhoto ? 'border-primary bg-primary' : 'border-border',
      )}>
        {hasPhoto && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
      </div>

      <div className="min-w-0 flex-1">
        {/* Label + badge */}
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-sm font-medium', hasPhoto ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <span className={cn(
            'flex-shrink-0 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
            hasPhoto ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
          )}>
            <Icon className="h-2.5 w-2.5" />
            {hasPhoto ? '1/1' : '0/1'}
          </span>
        </div>

        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {hasPhoto ? 'Ketuk untuk mengganti foto.' : description}
        </p>

        {/* Preview or placeholder */}
        {hasPhoto ? (
          <div
            className="relative mt-3 h-32 w-full overflow-hidden rounded-xl border border-border"
            onClick={e => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo!} alt={label} className="h-full w-full object-cover" />
            {!disabled && (
              <button
                onClick={e => { e.stopPropagation(); onClear(); }}
                className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ) : (
          !disabled && (
            <div className="mt-3 flex h-20 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border bg-secondary text-muted-foreground">
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <><Icon className="h-4 w-4" /><span className="text-[11px] font-medium">Ambil foto</span></>}
            </div>
          )
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
      />
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SetoranTaskPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const taskId = String(params?.id ?? '');

  const [task,     setTask]     = useState<SetoranTaskData | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [uploading, setUploading]  = useState<'resi' | 'atm' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [actualReceivedAmount, setActualReceivedAmount] = useState('');
  const [storedAmount,         setStoredAmount]         = useState('');
  const [resiPhoto,            setResiPhoto]            = useState<string | null>(null);
  const [atmCardSelfiePhoto,   setAtmCardSelfiePhoto]   = useState<string | null>(null);
  const [notes,                setNotes]                = useState('');

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/employee/tasks', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Gagal memuat task.');

      const found = (data.tasks ?? []).find(
        (item: { type: string; data: SetoranTaskData }) =>
          item.type === 'setoran' && String(item.data.id) === taskId,
      );
      if (!found) throw new Error('Setoran task tidak ditemukan.');

      const d: SetoranTaskData = found.data;
      setTask(d);
      setActualReceivedAmount(String(d.actualReceivedAmount ?? d.expectedAmount ?? ''));
      setStoredAmount(String(d.storedAmount ?? d.amount ?? ''));
      setResiPhoto(d.resiPhoto ?? null);
      setAtmCardSelfiePhoto(d.atmCardSelfiePhoto ?? null);
      setNotes(d.notes ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal memuat task.');
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  // ── Derived money values ──────────────────────────────────────────────────

  const previousUnpaid = useMemo(
    () => toNumber(task?.previousUnpaidAmount ?? task?.carriedDeficit),
    [task],
  );
  const actualNum      = useMemo(() => toNumber(actualReceivedAmount), [actualReceivedAmount]);
  const requiredTotal  = useMemo(() => actualNum + previousUnpaid, [actualNum, previousUnpaid]);
  const storedNum      = useMemo(() => toNumber(storedAmount), [storedAmount]);
  const unpaidRemain   = useMemo(() => Math.max(0, requiredTotal - storedNum), [requiredTotal, storedNum]);
  const isOverStored   = storedNum > requiredTotal && requiredTotal > 0;

  const readonly = task?.status === 'completed' || task?.status === 'verified';
  const isRejected = task?.status === 'rejected';

  // ── Auto-save ─────────────────────────────────────────────────────────────

  const autoSave = useCallback(async (patch?: Record<string, unknown>) => {
    if (!task || readonly) return;
    setSaveStatus('saving');
    try {
      // Build base body — omit null photo fields so we don't accidentally
      // overwrite a previously saved photo with null on every keystroke.
      const base: Record<string, unknown> = {
        scheduleId:          Number(task.scheduleId),
        actualReceivedAmount,
        storedAmount,
        notes,
      };
      if (resiPhoto          !== null) base.resiPhoto          = resiPhoto;
      if (atmCardSelfiePhoto !== null) base.atmCardSelfiePhoto = atmCardSelfiePhoto;

      await fetch('/api/employee/tasks/setoran', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, ...(patch ?? {}) }),
      });
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  }, [actualReceivedAmount, atmCardSelfiePhoto, notes, readonly, resiPhoto, storedAmount, task]);

  // ── Photo upload ──────────────────────────────────────────────────────────

  async function uploadPhoto(file: File, type: 'resi' | 'atm') {
    if (!task || readonly) return;
    setUploading(type);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('photoType', type === 'resi' ? 'resi' : 'atm_card_selfie');
      const res  = await fetch('/api/employee/tasks/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data?.error ?? 'Upload gagal.');
      if (type === 'resi') {
        setResiPhoto(data.url);
        await autoSave({ resiPhoto: data.url });
      } else {
        setAtmCardSelfiePhoto(data.url);
        await autoSave({ atmCardSelfiePhoto: data.url });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload gagal.');
    } finally {
      setUploading(null);
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!task || readonly) return;
    setSubmitError(null);
    setSaving(true);
    try {
      if (actualNum <= 0)          throw new Error('Nominal uang aktual diterima wajib diisi.');
      if (storedNum <= 0)          throw new Error('Nominal uang disetor wajib diisi.');
      if (isOverStored)            throw new Error('Uang disetor tidak boleh lebih besar dari total wajib disetor.');
      if (!resiPhoto)              throw new Error('Foto resi wajib diupload.');
      if (!atmCardSelfiePhoto)     throw new Error('Foto selfie dengan kartu ATM wajib diupload.');

      const res  = await fetch('/api/employee/tasks/setoran', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId:          Number(task.scheduleId),
          storeId:             Number(task.storeId),
          actualReceivedAmount, storedAmount, resiPhoto, atmCardSelfiePhoto, notes,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data?.error ?? 'Gagal submit Setoran.');

      toast.success('Setoran Penjualan berhasil disubmit! ✓', { duration: 4000 });
      router.back();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Terjadi kesalahan.';
      setSubmitError(msg);
      toast.error(msg, { duration: 6000 });
    } finally {
      setSaving(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-card px-4 py-3">
        <button onClick={() => router.back()}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">Setoran Penjualan</p>
          {task && (
            <p className="text-[10px] capitalize text-muted-foreground">
              {task.shift} shift · {task.status.replace('_', ' ')}
            </p>
          )}
        </div>
        {!readonly && task && <SaveIndicator status={saveStatus} />}
        {task?.status === 'completed'  && <span className="flex items-center gap-1 rounded-full bg-green-100  px-2.5 py-1 text-[10px] font-bold text-green-700"><CheckCircle2 className="h-3 w-3" />Selesai</span>}
        {task?.status === 'verified'   && <span className="flex items-center gap-1 rounded-full bg-green-200  px-2.5 py-1 text-[10px] font-bold text-green-800"><CheckCircle2 className="h-3 w-3" />Terverifikasi</span>}
        {task?.status === 'rejected'   && <span className="flex items-center gap-1 rounded-full bg-red-100    px-2.5 py-1 text-[10px] font-bold text-red-700"><AlertCircle   className="h-3 w-3" />Ditolak</span>}
        {task?.status === 'discrepancy'&& <span className="flex items-center gap-1 rounded-full bg-amber-100  px-2.5 py-1 text-[10px] font-bold text-amber-700"><AlertTriangle  className="h-3 w-3" />Diskrepansi</span>}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 space-y-6 p-4 pb-28">

        {/* Submit error */}
        {submitError && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-300 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-red-700">Submit gagal</p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{submitError}</p>
            </div>
            <button onClick={() => setSubmitError(null)} className="flex-shrink-0 text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Rejected notice */}
        {isRejected && task?.notes && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
            <div>
              <p className="text-xs font-bold text-red-700">Ditolak oleh OPS</p>
              <p className="mt-0.5 text-xs text-red-600">{task.notes}</p>
              <p className="mt-1.5 text-xs font-medium text-red-700">Silakan perbaiki dan submit ulang.</p>
            </div>
          </div>
        )}

        {/* Verified notice */}
        {task?.status === 'verified' && task.verifiedAt && (
          <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-xs font-semibold text-green-800">Task telah diverifikasi</p>
            <p className="mt-0.5 text-xs text-green-600">{fmtLong(task.verifiedAt)}</p>
          </div>
        )}

        {/* Previous unpaid warning */}
        {previousUnpaid > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-bold text-amber-900">Ada kekurangan dari setoran sebelumnya</p>
              <p className="mt-0.5 text-xs text-amber-800 leading-relaxed">
                Sisa unpaid <span className="font-bold">{rupiah(previousUnpaid)}</span> otomatis ditambahkan ke total wajib disetor hari ini.
              </p>
            </div>
          </div>
        )}

        {!task ? (
          <div className="flex flex-col items-center py-20 text-center">
            <AlertCircle className="mb-3 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">Task tidak ditemukan</p>
          </div>
        ) : (
          <>
            {/* ── Nominal Setoran ──────────────────────────────────────────── */}
            <Section title="Nominal Setoran">
              <div className="space-y-3">
                <RupiahInput
                  label="Uang aktual diterima hari ini"
                  hint="Total kas yang diterima toko hari ini."
                  value={actualReceivedAmount}
                  onChange={setActualReceivedAmount}
                  onBlur={() => autoSave({ actualReceivedAmount })}
                  disabled={readonly}
                />

                {previousUnpaid > 0 && (
                  <MoneyRow label="Sisa unpaid sebelumnya" value={rupiah(previousUnpaid)} highlight="amber" />
                )}

                <MoneyRow
                  label="Total wajib disetor"
                  value={rupiah(requiredTotal)}
                  bold
                  highlight={requiredTotal > 0 ? undefined : undefined}
                />

                <RupiahInput
                  label="Uang yang disetor / disimpan"
                  hint="Nominal yang benar-benar disetorkan ke rekening atau disimpan."
                  value={storedAmount}
                  onChange={setStoredAmount}
                  onBlur={() => autoSave({ storedAmount })}
                  disabled={readonly}
                  error={isOverStored ? 'Tidak boleh lebih besar dari total wajib disetor.' : undefined}
                />

                <MoneyRow
                  label={unpaidRemain > 0 ? 'Sisa belum disetor (carry forward)' : 'Setoran cukup ✓'}
                  value={rupiah(unpaidRemain)}
                  bold
                  highlight={unpaidRemain > 0 ? 'amber' : 'green'}
                />

                {unpaidRemain > 0 && (
                  <p className="text-[10px] text-muted-foreground px-1">
                    Nominal ini akan menjadi beban setoran morning shift berikutnya.
                  </p>
                )}
              </div>
            </Section>

            {/* ── Bukti Foto ───────────────────────────────────────────────── */}
            <Section title="Bukti Foto">
              <div className="space-y-2">
                <PhotoSlot
                  label="Foto Resi"
                  description="Upload foto resi bukti setoran."
                  photoType="resi"
                  photo={resiPhoto}
                  loading={uploading === 'resi'}
                  disabled={readonly || uploading !== null}
                  onUpload={f => uploadPhoto(f, 'resi')}
                  onClear={() => { setResiPhoto(null); autoSave({ resiPhoto: null }); }}
                  icon="camera"
                />

                <PhotoSlot
                  label="Selfie dengan Kartu ATM"
                  description="Upload selfie kamu sambil memegang kartu ATM."
                  photoType="atm_card_selfie"
                  photo={atmCardSelfiePhoto}
                  loading={uploading === 'atm'}
                  disabled={readonly || uploading !== null}
                  onUpload={f => uploadPhoto(f, 'atm')}
                  onClear={() => { setAtmCardSelfiePhoto(null); autoSave({ atmCardSelfiePhoto: null }); }}
                  icon="card"
                />
              </div>
            </Section>

            {/* ── Catatan ──────────────────────────────────────────────────── */}
            <Section title="Catatan (opsional)">
              <textarea
                value={notes}
                disabled={readonly}
                rows={3}
                onChange={e => setNotes(e.target.value)}
                onBlur={() => autoSave({ notes })}
                placeholder="Tambahkan catatan jika ada…"
                className="w-full resize-none rounded-xl border border-border bg-secondary px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              />
            </Section>
          </>
        )}
      </div>

      {/* ── Sticky submit ────────────────────────────────────────────────────── */}
      {task && !readonly && (
        <div className="fixed inset-x-0 bottom-14 z-30 border-t border-border bg-background/95 px-4 py-4 backdrop-blur-sm">
          <button
            type="button"
            disabled={saving || uploading !== null || isOverStored}
            onClick={handleSubmit}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-bold text-primary-foreground transition-all active:scale-[0.98] disabled:opacity-40"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" />Menyimpan…</>
              : <><CheckCircle2 className="h-4 w-4" />Submit Setoran Penjualan</>}
          </button>

          {/* Inline hint */}
          {!saving && (() => {
            if (actualNum <= 0)       return <p className="mt-2 text-center text-[11px] text-muted-foreground">Isi nominal uang aktual diterima.</p>;
            if (isOverStored)         return <p className="mt-2 text-center text-[11px] text-red-600">Uang disetor melebihi total wajib disetor.</p>;
            if (storedNum <= 0)       return <p className="mt-2 text-center text-[11px] text-muted-foreground">Isi nominal uang yang disetor.</p>;
            if (!resiPhoto)           return <p className="mt-2 text-center text-[11px] text-muted-foreground">Upload foto resi terlebih dahulu.</p>;
            if (!atmCardSelfiePhoto)  return <p className="mt-2 text-center text-[11px] text-muted-foreground">Upload selfie dengan kartu ATM.</p>;
            return null;
          })()}
        </div>
      )}
    </div>
  );
}